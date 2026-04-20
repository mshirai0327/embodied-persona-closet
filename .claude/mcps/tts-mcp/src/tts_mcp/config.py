"""Configuration for TTS MCP Server."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from ._behavior import get_behavior

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _parse_boolish(value: object, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return _parse_bool(str(value), default)


def _get_tts_setting(
    *env_keys: str, behavior_key: str, default: Any = None,
) -> Any:
    for key in env_keys:
        value = os.getenv(key)
        if value not in (None, ""):
            return value
    behavior_value = get_behavior("tts", behavior_key, default)
    return default if behavior_value in (None, "") else behavior_value


def _normalize_speaker_target(value: object) -> str | None:
    if value in (None, ""):
        return None
    speaker = str(value).strip().lower()
    if speaker in {"camera", "local", "both"}:
        return speaker
    return None


def _detect_pulse_server() -> str | None:
    explicit = os.getenv("ELEVENLABS_PULSE_SERVER") or os.getenv("PULSE_SERVER")
    if explicit:
        return explicit
    wslg_socket = "/mnt/wslg/PulseServer"
    if os.path.exists(wslg_socket):
        return f"unix:{wslg_socket}"
    return None


@dataclass(frozen=True)
class ElevenLabsConfig:
    """ElevenLabs-specific configuration."""

    api_key: str
    voice_id: str
    model_id: str
    output_format: str

    @classmethod
    def from_env(cls) -> "ElevenLabsConfig | None":
        """Create config from environment variables. Returns None if not configured."""
        api_key = os.getenv("ELEVENLABS_API_KEY", "")
        if not api_key:
            return None
        return cls(
            api_key=api_key,
            voice_id=str(
                _get_tts_setting(
                    "ELEVENLABS_VOICE_ID",
                    behavior_key="voice_id",
                    default="uYp2UUDeS74htH10iY2e",
                )
            ),
            model_id=str(
                _get_tts_setting(
                    "ELEVENLABS_MODEL_ID",
                    behavior_key="model_id",
                    default="eleven_v3",
                )
            ),
            output_format=str(
                _get_tts_setting(
                    "ELEVENLABS_OUTPUT_FORMAT",
                    behavior_key="output_format",
                    default="mp3_44100_128",
                )
            ),
        )


@dataclass(frozen=True)
class VoicevoxConfig:
    """VOICEVOX-specific configuration."""

    url: str
    speaker: int

    @classmethod
    def from_env(cls) -> "VoicevoxConfig | None":
        """Create config from environment variables. Returns None if not configured."""
        url = os.getenv("VOICEVOX_URL", "")
        if not url:
            return None
        return cls(
            url=url.rstrip("/"),
            speaker=int(
                _get_tts_setting(
                    "VOICEVOX_SPEAKER",
                    behavior_key="voicevox_speaker",
                    default="3",
                )
            ),
        )


@dataclass(frozen=True)
class PlaybackConfig:
    """Playback and camera-speaker configuration (shared across engines)."""

    play_audio: bool
    save_dir: str
    playback: str
    pulse_sink: str | None
    pulse_server: str | None
    camera_backend: str
    speaker_target: str | None
    camera_ffmpeg: str
    tapo_camera_host: str | None
    tapo_cloud_password: str | None

    @classmethod
    def from_env(cls) -> "PlaybackConfig":
        """Create config from environment variables."""
        return cls(
            play_audio=_parse_boolish(
                _get_tts_setting(
                    "TTS_PLAY_AUDIO",
                    "ELEVENLABS_PLAY_AUDIO",
                    behavior_key="play_audio",
                    default=True,
                ),
                True,
            ),
            save_dir=str(
                _get_tts_setting(
                    "TTS_SAVE_DIR",
                    "ELEVENLABS_SAVE_DIR",
                    behavior_key="save_dir",
                    default="/tmp/tts-mcp",
                )
            ),
            playback=str(
                _get_tts_setting(
                    "TTS_PLAYBACK",
                    "ELEVENLABS_PLAYBACK",
                    behavior_key="playback",
                    default="auto",
                )
            ),
            pulse_sink=os.getenv("ELEVENLABS_PULSE_SINK") or None,
            pulse_server=_detect_pulse_server(),
            camera_backend=str(
                _get_tts_setting(
                    "TTS_CAMERA_BACKEND",
                    behavior_key="camera_backend",
                    default="auto",
                )
            ).strip().lower(),
            speaker_target=_normalize_speaker_target(
                _get_tts_setting(
                    "TTS_SPEAKER_TARGET",
                    "TTS_SPEAKER",
                    behavior_key="speaker",
                    default=None,
                )
            ),
            camera_ffmpeg=str(
                _get_tts_setting(
                    "TTS_CAMERA_FFMPEG",
                    behavior_key="camera_ffmpeg",
                    default="ffmpeg",
                )
            ),
            tapo_camera_host=os.getenv("TAPO_CAMERA_HOST") or None,
            tapo_cloud_password=os.getenv("TAPO_CLOUD_PASSWORD") or None,
        )

    def has_camera_output(self) -> bool:
        """Return whether any camera playback backend is configured."""
        return self.resolve_camera_backend() is not None

    def resolve_camera_backend(self) -> str | None:
        """Resolve which camera playback backend should be used."""
        if self.camera_backend in {"auto", "tapo"}:
            backend = self.camera_backend
        else:
            backend = "auto"
        has_tapo = bool(self.tapo_camera_host and self.tapo_cloud_password)

        if backend == "tapo":
            return "tapo" if has_tapo else None
        if has_tapo:
            return "tapo"
        return None


@dataclass(frozen=True)
class TTSConfig:
    """Top-level TTS configuration."""

    default_engine: str | None
    elevenlabs: ElevenLabsConfig | None
    voicevox: VoicevoxConfig | None
    playback: PlaybackConfig

    @classmethod
    def from_env(cls) -> "TTSConfig":
        """Create config from environment variables."""
        return cls(
            default_engine=_get_tts_setting(
                "TTS_DEFAULT_ENGINE",
                behavior_key="default_engine",
                default=None,
            ),
            elevenlabs=ElevenLabsConfig.from_env(),
            voicevox=VoicevoxConfig.from_env(),
            playback=PlaybackConfig.from_env(),
        )

    def resolve_engine(self, requested: str | None = None) -> str:
        """Resolve which engine to use.

        Priority:
        1. Explicit request (from tool call)
        2. TTS_DEFAULT_ENGINE env var
        3. Auto-detect (elevenlabs first for backward compat, then voicevox)
        """
        if requested:
            return requested
        if self.default_engine:
            return self.default_engine
        if self.elevenlabs:
            return "elevenlabs"
        if self.voicevox:
            return "voicevox"
        raise ValueError("No TTS engine configured. Set ELEVENLABS_API_KEY or VOICEVOX_URL.")


@dataclass(frozen=True)
class ServerConfig:
    """MCP Server configuration."""

    name: str = "tts"
    version: str = "0.2.0"

    @classmethod
    def from_env(cls) -> "ServerConfig":
        """Create config from environment variables."""
        return cls(
            name=os.getenv("MCP_SERVER_NAME", "tts"),
            version=os.getenv("MCP_SERVER_VERSION", "0.2.0"),
        )
