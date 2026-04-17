"""CLI entry point for TTS — fire-and-forget from shell scripts."""

from __future__ import annotations

import argparse
import asyncio
import sys

from . import playback
from ._behavior import load_behavior
from .config import TTSConfig
from .engines.elevenlabs import ElevenLabsEngine


def _normalize_speaker(value: str | None) -> str | None:
    if value is None:
        return None
    v = value.strip().lower()
    return v if v in {"camera", "local", "both"} else None


async def _say(text: str, speaker_override: str | None) -> None:
    config = TTSConfig.from_env()
    pb = config.playback
    behavior = load_behavior("tts")

    # Engine selection
    engines: dict[str, object] = {}
    if config.elevenlabs:
        el = config.elevenlabs
        engines["elevenlabs"] = ElevenLabsEngine(
            api_key=el.api_key,
            voice_id=el.voice_id,
            model_id=el.model_id,
            output_format=el.output_format,
        )
    if config.voicevox:
        from .engines.voicevox import VoicevoxEngine
        vv = config.voicevox
        engines["voicevox"] = VoicevoxEngine(url=vv.url, speaker=vv.speaker)

    if not engines:
        print(
            "Error: no TTS engine configured (set ELEVENLABS_API_KEY or VOICEVOX_URL)",
            file=sys.stderr,
        )
        sys.exit(1)

    toml_engine = behavior.get("default_engine", "") or None
    engine_name = config.resolve_engine(toml_engine)
    engine = engines.get(engine_name)
    if engine is None:
        print(f"Error: engine '{engine_name}' not available", file=sys.stderr)
        sys.exit(1)

    # Speaker target
    speaker_target = (
        _normalize_speaker(speaker_override)
        or _normalize_speaker(behavior.get("speaker"))
        or pb.speaker_target
        or ("both" if pb.has_camera_output() else "local")
    )
    use_local = speaker_target in {"local", "both"}
    use_camera = speaker_target in {"camera", "both"} and pb.has_camera_output()

    # Synthesize
    audio_bytes, audio_format = await asyncio.to_thread(engine.synthesize, text)
    file_path = playback.save_audio(audio_bytes, audio_format, pb.save_dir)

    # Local playback
    if use_local:
        status = await asyncio.to_thread(
            playback.play_audio,
            audio_bytes,
            file_path,
            pb.playback,
            pb.pulse_sink,
            pb.pulse_server,
        )
        print(f"local: {status}")

    # Camera speaker
    if use_camera:
        ok, cam_msg = await asyncio.to_thread(
            playback.play_to_camera,
            file_path,
            pb,
        )
        print(f"camera: {cam_msg}")


def main() -> None:
    parser = argparse.ArgumentParser(description="TTS CLI")
    parser.add_argument("text", help="Text to speak")
    parser.add_argument(
        "--speaker",
        choices=["local", "camera", "both"],
        default=None,
        help="Output target (default: from mcpBehavior.toml or 'local')",
    )
    args = parser.parse_args()

    text = args.text.strip()
    if not text:
        print("Error: text is empty", file=sys.stderr)
        sys.exit(1)

    asyncio.run(_say(text, args.speaker))


if __name__ == "__main__":
    main()
