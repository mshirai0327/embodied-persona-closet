"""Hearing worker subprocess.

Runs as a completely separate process from the MCP server to avoid
GIL contention and file descriptor issues. Manages ffmpeg capture
and Whisper transcription in one process.

Usage:
    python -m hearing --source <rtsp_url|local> --model small --language ja
"""

from __future__ import annotations

import argparse
import logging
import os
import platform
import signal
import subprocess
import sys
import threading
import time
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

from ._behavior import get_behavior
from .buffer import append_to_buffer
from .config import (
    BUFFER_FILE,
    PID_FILE,
    POLL_INTERVAL,
    SEGMENT_DIR,
    SEGMENT_LIST,
)
from .filters import Debouncer, should_skip

logger = logging.getLogger("hearing.worker")

_shutdown = False


def _handle_signal(signum: int, _frame: object) -> None:
    global _shutdown
    _shutdown = True
    logger.info("Received signal %d, shutting down...", signum)


# ── ffmpeg management ─────────────────────────────────────────────────


def _is_wsl() -> bool:
    if os.getenv("WSL_DISTRO_NAME") or os.getenv("WSL_INTEROP"):
        return True

    release = platform.release().lower()
    if "microsoft" in release or "wsl" in release:
        return True

    try:
        version = Path("/proc/version").read_text(encoding="utf-8").lower()
    except OSError:
        return False
    return "microsoft" in version or "wsl" in version


def _default_input_device(input_format: str) -> str:
    defaults = {
        "alsa": "default",
        "avfoundation": ":0",
        "openal": "default",
        "pulse": os.getenv("PULSE_SOURCE", "default"),
    }
    return defaults.get(input_format, "default")


def _dedupe_input_args(candidates: list[list[str]]) -> list[list[str]]:
    seen: set[tuple[str, ...]] = set()
    deduped: list[list[str]] = []
    for args in candidates:
        key = tuple(args)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(args)
    return deduped


def _local_input_candidates() -> list[list[str]]:
    configured_format = str(
        os.getenv("HEARING_LOCAL_INPUT_FORMAT")
        or get_behavior("hearing", "local_input_format", "")
    ).strip()
    configured_device = str(
        os.getenv("HEARING_LOCAL_INPUT_DEVICE")
        or get_behavior("hearing", "local_input_device", "")
    ).strip()

    candidates: list[list[str]] = []
    if configured_format:
        input_device = configured_device or _default_input_device(configured_format)
        candidates.append(
            ["-f", configured_format, "-i", input_device]
        )

    system = platform.system()
    if system == "Darwin":
        candidates.append(["-f", "avfoundation", "-i", ":0"])
        return _dedupe_input_args(candidates)

    if system == "Linux":
        if _is_wsl():
            candidates.append(["-f", "pulse", "-i", os.getenv("PULSE_SOURCE", "default")])
            candidates.append(["-f", "alsa", "-i", "default"])
        else:
            candidates.append(["-f", "alsa", "-i", "default"])
            if os.getenv("PULSE_SERVER"):
                candidates.append(["-f", "pulse", "-i", os.getenv("PULSE_SOURCE", "default")])
        return _dedupe_input_args(candidates)

    raise RuntimeError(f"Unsupported platform for local microphone: {system}")


def _build_ffmpeg_cmds(source: str, segment_seconds: int) -> list[list[str]]:
    if source == "local":
        input_args_list = _local_input_candidates()
    else:
        input_args_list = [["-rtsp_transport", "tcp", "-i", source]]

    seg_pattern = str(SEGMENT_DIR / "seg_%03d.wav")
    seg_list = str(SEGMENT_LIST)

    return [
        [
            "ffmpeg",
            "-loglevel", "warning",
            *input_args,
            "-ar", "16000",
            "-ac", "1",
            "-f", "segment",
            "-segment_time", str(segment_seconds),
            "-segment_list", seg_list,
            "-segment_list_type", "csv",
            "-segment_list_flags", "+live",
            "-y",
            seg_pattern,
        ]
        for input_args in input_args_list
    ]


def _drain_stderr(proc: subprocess.Popen[bytes]) -> None:
    """Drain ffmpeg stderr to prevent buffer deadlock."""
    stderr = proc.stderr
    if stderr is None:
        return
    try:
        for raw_line in stderr:
            line = raw_line.decode(errors="replace").rstrip() if isinstance(
                raw_line, bytes
            ) else raw_line.rstrip()
            if line:
                logger.debug("ffmpeg: %s", line)
    except (ValueError, OSError):
        pass


def _run_ffmpeg(source: str, segment_seconds: int) -> subprocess.Popen[bytes]:
    """Start ffmpeg and return the Popen handle."""
    errors: list[str] = []

    for cmd in _build_ffmpeg_cmds(source, segment_seconds):
        logger.info("ffmpeg cmd: %s", " ".join(cmd))
        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        time.sleep(0.5)

        if proc.poll() is None:
            threading.Thread(
                target=_drain_stderr, args=(proc,), daemon=True, name="ffmpeg-stderr"
            ).start()
            return proc

        stderr_text = ""
        if proc.stderr is not None:
            stderr_text = proc.stderr.read().decode(errors="replace").strip()
        input_desc = " ".join(cmd[3:7])
        errors.append(f"{input_desc}: {stderr_text or f'rc={proc.returncode}'}")

    detail = "; ".join(errors) if errors else "no ffmpeg input candidates available"
    raise RuntimeError(f"Failed to start local audio capture: {detail}")


# ── Main worker loop ──────────────────────────────────────────────────


def _run(source: str, model_name: str, language: str, segment_seconds: int,
         vad_energy_threshold: float = 0.0) -> None:
    """Main worker: start ffmpeg, load model, watch segments, transcribe."""
    from .transcriber import Transcriber

    # Prepare directories
    SEGMENT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in SEGMENT_DIR.glob("seg_*.wav"):
        stale.unlink(missing_ok=True)
    if SEGMENT_LIST.exists():
        SEGMENT_LIST.unlink()
    BUFFER_FILE.touch(exist_ok=True)

    # Write PID for hearing-hook.sh
    PID_FILE.write_text(str(os.getpid()))

    # Start ffmpeg
    ffmpeg_proc = _run_ffmpeg(source, segment_seconds)
    logger.info("ffmpeg started (pid=%d)", ffmpeg_proc.pid)

    # Load Whisper model
    logger.info("Loading Whisper model '%s' (lang=%s)...", model_name, language)
    transcriber = Transcriber(model_name=model_name, language=language)
    logger.info("Model ready")

    # Transcription loop
    debouncer = Debouncer()
    known_count = 0
    seg_counter = 0

    while not _shutdown:
        # Check ffmpeg health
        if ffmpeg_proc.poll() is not None:
            logger.warning(
                "ffmpeg exited (rc=%s), restarting in 2s...",
                ffmpeg_proc.returncode,
            )
            time.sleep(2)
            if _shutdown:
                break
            ffmpeg_proc = _run_ffmpeg(source, segment_seconds)
            logger.info("ffmpeg restarted (pid=%d)", ffmpeg_proc.pid)

        # Watch segment list
        try:
            if not SEGMENT_LIST.exists():
                time.sleep(POLL_INTERVAL)
                continue

            text = SEGMENT_LIST.read_text(encoding="utf-8").strip()
            lines = [ln for ln in text.splitlines() if ln.strip()]
            complete_count = max(0, len(lines) - 1)

            for i in range(known_count, complete_count):
                if _shutdown:
                    break
                seg_name = lines[i].split(",")[0]
                seg_path = SEGMENT_DIR / seg_name
                if not seg_path.exists():
                    continue

                seg_counter += 1
                try:
                    _process_segment(
                        transcriber, seg_path, seg_counter, debouncer,
                        vad_energy_threshold=vad_energy_threshold,
                    )
                except Exception as e:
                    logger.error("Error processing %s: %s", seg_path.name, e)
                finally:
                    try:
                        seg_path.unlink(missing_ok=True)
                    except Exception:
                        pass

            known_count = complete_count

        except Exception as e:
            logger.error("Worker loop error: %s", e)

        time.sleep(POLL_INTERVAL)

    # Cleanup
    logger.info("Shutting down ffmpeg...")
    if ffmpeg_proc.poll() is None:
        ffmpeg_proc.terminate()
        try:
            ffmpeg_proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            ffmpeg_proc.kill()

    PID_FILE.unlink(missing_ok=True)


def _rms_energy(seg_path: Path) -> float:
    """Compute RMS energy of a WAV segment. Returns 0.0 on error."""
    try:
        with wave.open(str(seg_path), "rb") as wf:
            frames = wf.readframes(wf.getnframes())
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            return float(np.sqrt(np.mean(audio**2)))
    except Exception:
        return 0.0


def _tail_rms(seg_path: Path, tail_sec: float = 0.5) -> float:
    """Compute RMS energy of the last tail_sec of a WAV segment."""
    try:
        with wave.open(str(seg_path), "rb") as wf:
            sr = wf.getframerate()
            n = wf.getnframes()
            tail_frames = int(sr * tail_sec)
            wf.setpos(max(0, n - tail_frames))
            frames = wf.readframes(tail_frames)
            audio = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
            return float(np.sqrt(np.mean(audio**2)))
    except Exception:
        return 0.0


def _process_segment(
    transcriber: object, seg_path: Path, seg_num: int,
    debouncer: Debouncer | None = None,
    vad_energy_threshold: float = 0.0,
) -> None:
    t0 = time.monotonic()

    # VAD: skip silent segments before Whisper
    if vad_energy_threshold > 0:
        rms = _rms_energy(seg_path)
        if rms < vad_energy_threshold:
            logger.debug(
                "Segment %d: silent (rms=%.4f < %.4f, %.2fs)",
                seg_num, rms, vad_energy_threshold, time.monotonic() - t0,
            )
            return
        logger.debug("Segment %d: rms=%.4f", seg_num, rms)

    text, no_speech_prob = transcriber.transcribe(seg_path)  # type: ignore[attr-defined]
    elapsed = time.monotonic() - t0

    if not text:
        logger.debug("Segment %d: no speech (%.2fs)", seg_num, elapsed)
        return

    if should_skip(text):
        logger.debug(
            "Segment %d: filtered '%s' (%.2fs)", seg_num, text[:60], elapsed
        )
        return

    if debouncer and debouncer.is_duplicate(text):
        logger.debug(
            "Segment %d: debounced '%s' (%.2fs)", seg_num, text[:60], elapsed
        )
        return

    # 末尾に音声が残っているか（発話途中の可能性）
    # セグメント全体はVADを通過済みなので、末尾の閾値はVADより低くてOK
    tail_rms = _tail_rms(seg_path) if vad_energy_threshold > 0 else 0.0
    tail_has_speech = tail_rms >= vad_energy_threshold * 0.5
    logger.debug("Segment %d: tail_rms=%.5f threshold=%.5f tail_speech=%s",
                 seg_num, tail_rms, vad_energy_threshold * 0.5, tail_has_speech)

    entry = {
        "ts": datetime.now().astimezone().isoformat(),
        "text": text,
        "no_speech_prob": round(no_speech_prob, 4),
        "seg": seg_num,
        "tail_speech": tail_has_speech,
    }

    append_to_buffer(entry)
    logger.info(
        "Segment %d: '%s' (no_speech=%.3f, %.2fs)",
        seg_num,
        text[:80],
        no_speech_prob,
        elapsed,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Hearing worker")
    parser.add_argument("--source", default="local", help="Audio source (rtsp URL or 'local')")
    parser.add_argument("--model", default="small", help="Whisper model name")
    parser.add_argument("--language", default="ja", help="Language code")
    parser.add_argument("--segment-seconds", type=int, default=5, help="Segment duration")
    parser.add_argument("--vad-energy-threshold", type=float, default=0.0,
                        help="RMS energy threshold for VAD (0=disabled)")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    args = parser.parse_args(argv)

    level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        stream=sys.stderr,
    )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    import setproctitle
    setproctitle.setproctitle("hearing-worker")

    try:
        _run(args.source, args.model, args.language, args.segment_seconds,
             vad_energy_threshold=args.vad_energy_threshold)
    except Exception as e:
        logger.error("Worker crashed: %s", e)
        sys.exit(1)

    logger.info("Worker exited cleanly")


if __name__ == "__main__":
    main()
