"""faster-whisper transcription wrapper."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


def _describe_model_load_failure(model_name: str, exc: Exception) -> str:
    """Convert Whisper load failures into actionable messages."""
    message = str(exc)
    if "Unable to open file 'model.bin'" in message:
        return (
            f"Whisper model '{model_name}' could not be loaded because its local cache "
            "looks incomplete or corrupted. Try removing the broken Hugging Face cache "
            "for that model and downloading it again, or switch [hearing].whisper_model "
            "to a model that already has a valid local model.bin."
        )
    return f"Whisper model '{model_name}' could not be loaded: {message}"


class Transcriber:
    """Wraps faster-whisper model loading, warmup, and inference."""

    def __init__(self, model_name: str = "small", language: str = "ja"):
        self._language = language
        logger.info("Whisper モデル '%s' を読み込み中...", model_name)
        try:
            self._model = WhisperModel(model_name, device="cpu", compute_type="int8")
        except Exception as exc:
            raise RuntimeError(_describe_model_load_failure(model_name, exc)) from exc
        logger.info("Whisper モデル '%s' の読み込み完了", model_name)
        self._warmup()

    def _warmup(self) -> None:
        """Run a dummy inference to reduce first-call latency."""
        dummy = np.zeros(16000, dtype=np.float32)
        list(self._model.transcribe(dummy, language=self._language))
        logger.info("Whisper ウォームアップ完了")

    def transcribe(self, audio_path: Path) -> tuple[str, float]:
        """Transcribe an audio file.

        Returns:
            (text, min_no_speech_prob) tuple.
            text is empty string if no speech detected.
        """
        segments, _info = self._model.transcribe(
            str(audio_path),
            language=self._language,
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.2,
        )

        texts = []
        min_no_speech = 1.0
        for seg in segments:
            texts.append(seg.text)
            if seg.no_speech_prob < min_no_speech:
                min_no_speech = seg.no_speech_prob

        text = " ".join(texts).strip()
        return text, min_no_speech
