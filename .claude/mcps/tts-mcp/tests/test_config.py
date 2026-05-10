"""Tests for TTS MCP config."""

import os
from unittest.mock import patch

from tts_mcp.config import (
    ElevenLabsConfig,
    PlaybackConfig,
    TTSConfig,
    VoicevoxConfig,
    _parse_bool,
)


class TestParseBool:
    """Tests for _parse_bool helper."""

    def test_true_values(self):
        for val in ("1", "true", "True", "TRUE", "yes", "on"):
            assert _parse_bool(val, False) is True

    def test_false_values(self):
        for val in ("0", "false", "False", "no", "off", ""):
            assert _parse_bool(val, True) is False

    def test_none_returns_default(self):
        assert _parse_bool(None, True) is True
        assert _parse_bool(None, False) is False


class TestElevenLabsConfig:
    """Tests for ElevenLabs config."""

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key"}, clear=False)
    def test_from_env(self):
        os.environ.pop("ELEVENLABS_VOICE_ID", None)
        config = ElevenLabsConfig.from_env()
        assert config is not None
        assert config.api_key == "test-key"
        assert config.voice_id == "uYp2UUDeS74htH10iY2e"

    @patch.dict(os.environ, {}, clear=False)
    def test_returns_none_without_api_key(self):
        os.environ.pop("ELEVENLABS_API_KEY", None)
        config = ElevenLabsConfig.from_env()
        assert config is None


class TestVoicevoxConfig:
    """Tests for VOICEVOX config."""

    @patch.dict(os.environ, {"VOICEVOX_URL": "http://localhost:50021"}, clear=False)
    @patch("tts_mcp.config.get_behavior", return_value=None)
    def test_from_env(self, _mock_behavior):
        config = VoicevoxConfig.from_env()
        assert config is not None
        assert config.url == "http://localhost:50021"
        assert config.speaker == 3

    @patch.dict(
        os.environ,
        {"VOICEVOX_URL": "http://localhost:50021/", "VOICEVOX_SPEAKER": "8"},
        clear=False,
    )
    def test_trailing_slash_stripped(self):
        config = VoicevoxConfig.from_env()
        assert config is not None
        assert config.url == "http://localhost:50021"
        assert config.speaker == 8

    @patch.dict(os.environ, {}, clear=False)
    def test_returns_none_without_url(self):
        os.environ.pop("VOICEVOX_URL", None)
        config = VoicevoxConfig.from_env()
        assert config is None


class TestPlaybackConfig:
    """Tests for playback/camera config."""

    @patch.dict(os.environ, {}, clear=False)
    @patch("tts_mcp.config.get_behavior", return_value=None)
    def test_camera_defaults(self, _mock_behavior):
        for key in ("TTS_CAMERA_FFMPEG", "TAPO_CAMERA_HOST",
                     "TAPO_CLOUD_PASSWORD", "TTS_SPEAKER", "TTS_SPEAKER_TARGET",
                     "TTS_PLAY_AUDIO", "ELEVENLABS_PLAY_AUDIO",
                     "TTS_PLAYBACK", "ELEVENLABS_PLAYBACK",
                     "TTS_SAVE_DIR", "ELEVENLABS_SAVE_DIR"):
            os.environ.pop(key, None)
        config = PlaybackConfig.from_env()
        assert config.camera_backend == "auto"
        assert config.camera_ffmpeg == "ffmpeg"
        assert config.tapo_camera_host is None
        assert config.tapo_cloud_password is None
        assert config.speaker_target is None
        assert config.has_camera_output() is False

    @patch.dict(
        os.environ,
        {
            "TTS_CAMERA_FFMPEG": "/usr/local/bin/ffmpeg",
            "TAPO_CAMERA_HOST": "10.0.0.1",
            "TAPO_CLOUD_PASSWORD": "cloud123",
        },
        clear=False,
    )
    def test_tapo_from_env(self):
        config = PlaybackConfig.from_env()
        assert config.camera_ffmpeg == "/usr/local/bin/ffmpeg"
        assert config.tapo_camera_host == "10.0.0.1"
        assert config.tapo_cloud_password == "cloud123"

    @patch.dict(os.environ, {}, clear=False)
    def test_cloud_password_defaults_to_none(self):
        os.environ.pop("TAPO_CLOUD_PASSWORD", None)
        config = PlaybackConfig.from_env()
        assert config.tapo_cloud_password is None

    @patch.dict(os.environ, {}, clear=False)
    def test_behavior_fallbacks(self):
        for key in (
            "TTS_CAMERA_FFMPEG",
            "TTS_SPEAKER", "TTS_SPEAKER_TARGET", "TTS_PLAY_AUDIO", "ELEVENLABS_PLAY_AUDIO",
            "TTS_CAMERA_BACKEND",
        ):
            os.environ.pop(key, None)

        values = {
            "camera_ffmpeg": "/usr/local/bin/ffmpeg",
            "camera_backend": "tapo",
            "speaker": "camera",
            "play_audio": False,
        }

        with patch(
            "tts_mcp.config.get_behavior",
            side_effect=lambda section, key, default=None: values.get(key, default),
        ):
            config = PlaybackConfig.from_env()

        assert config.camera_ffmpeg == "/usr/local/bin/ffmpeg"
        assert config.camera_backend == "tapo"
        assert config.speaker_target == "camera"
        assert config.play_audio is False
        assert config.resolve_camera_backend() is None

    @patch.dict(os.environ, {"TTS_CAMERA_FFMPEG": "env_ffmpeg"}, clear=False)
    def test_env_takes_precedence_over_behavior(self):
        with patch(
            "tts_mcp.config.get_behavior",
            side_effect=lambda section, key, default=None: {
                "camera_ffmpeg": "behavior_ffmpeg",
                "speaker": "camera",
            }.get(key, default),
        ):
            config = PlaybackConfig.from_env()

        assert config.camera_ffmpeg == "env_ffmpeg"
        assert config.speaker_target == "camera"

    @patch.dict(
        os.environ,
        {
            "TTS_CAMERA_BACKEND": "tapo",
            "TAPO_CAMERA_HOST": "192.168.1.60",
            "TAPO_CLOUD_PASSWORD": "cloud-pass",
        },
        clear=False,
    )
    def test_tapo_camera_backend(self):
        config = PlaybackConfig.from_env()
        assert config.camera_backend == "tapo"
        assert config.has_camera_output() is True
        assert config.resolve_camera_backend() == "tapo"

    @patch.dict(
        os.environ,
        {
            "TTS_CAMERA_BACKEND": "auto",
            "TAPO_CAMERA_HOST": "192.168.1.60",
            "TAPO_CLOUD_PASSWORD": "cloud-pass",
        },
        clear=False,
    )
    def test_auto_uses_tapo_when_configured(self):
        config = PlaybackConfig.from_env()
        assert config.resolve_camera_backend() == "tapo"


class TestTTSConfig:
    """Tests for top-level TTS config."""

    @patch.dict(os.environ, {"ELEVENLABS_API_KEY": "test-key"}, clear=False)
    @patch("tts_mcp.config.get_behavior", return_value=None)
    def test_resolve_elevenlabs_default(self, _mock_behavior):
        os.environ.pop("TTS_DEFAULT_ENGINE", None)
        os.environ.pop("VOICEVOX_URL", None)
        config = TTSConfig.from_env()
        assert config.resolve_engine() == "elevenlabs"

    @patch.dict(os.environ, {"VOICEVOX_URL": "http://localhost:50021"}, clear=False)
    def test_resolve_voicevox_default(self):
        os.environ.pop("TTS_DEFAULT_ENGINE", None)
        os.environ.pop("ELEVENLABS_API_KEY", None)
        config = TTSConfig.from_env()
        assert config.resolve_engine() == "voicevox"

    @patch.dict(
        os.environ,
        {"TTS_DEFAULT_ENGINE": "voicevox", "VOICEVOX_URL": "http://localhost:50021",
         "ELEVENLABS_API_KEY": "test-key"},
        clear=False,
    )
    def test_resolve_explicit_engine(self):
        config = TTSConfig.from_env()
        assert config.resolve_engine() == "voicevox"
        assert config.resolve_engine("elevenlabs") == "elevenlabs"

    @patch.dict(os.environ, {}, clear=False)
    def test_behavior_default_engine(self):
        os.environ.pop("TTS_DEFAULT_ENGINE", None)
        os.environ["VOICEVOX_URL"] = "http://localhost:50021"
        with patch(
            "tts_mcp.config.get_behavior",
            side_effect=lambda section, key, default=None: (
                "voicevox" if key == "default_engine" else default
            ),
        ):
            config = TTSConfig.from_env()
        assert config.resolve_engine() == "voicevox"

    @patch.dict(os.environ, {}, clear=False)
    @patch("tts_mcp.config.get_behavior", return_value=None)
    def test_resolve_raises_when_no_engine(self, _mock_behavior):
        os.environ.pop("TTS_DEFAULT_ENGINE", None)
        os.environ.pop("ELEVENLABS_API_KEY", None)
        os.environ.pop("VOICEVOX_URL", None)
        config = TTSConfig.from_env()
        try:
            config.resolve_engine()
            assert False, "Should have raised ValueError"
        except ValueError:
            pass
