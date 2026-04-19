"""Tests for playback backend selection."""

import hashlib
from unittest.mock import MagicMock, patch

from tts_mcp.config import PlaybackConfig
from tts_mcp.playback import play_to_camera
from tts_mcp.tapo import (
    TapoBackchannelClient,
    _build_digest_authorization,
    _derive_tapo_password,
)


class TestCameraPlayback:
    @patch(
        "tts_mcp.playback.play_with_tapo",
        return_value=(True, "played directly via tapo → 192.168.1.60"),
    )
    def test_play_to_camera_uses_tapo_backend(self, mock_tapo):
        config = PlaybackConfig(
            play_audio=True,
            save_dir="/tmp/tts-mcp",
            playback="auto",
            pulse_sink=None,
            pulse_server=None,
            camera_backend="tapo",
            speaker_target="camera",
            camera_ffmpeg="ffmpeg",
            tapo_camera_host="192.168.1.60",
            tapo_cloud_password="cloud-pass",
        )

        ok, message = play_to_camera("/tmp/test.wav", config)

        assert ok is True
        assert "played directly via tapo" in message
        mock_tapo.assert_called_once_with(
            file_path="/tmp/test.wav",
            camera_host="192.168.1.60",
            cloud_password="cloud-pass",
            ffmpeg_bin="ffmpeg",
        )

    @patch(
        "tts_mcp.playback.play_with_tapo",
        return_value=(True, "played directly via tapo → 192.168.1.60"),
    )
    def test_play_to_camera_uses_auto_backend_when_tapo_is_configured(self, mock_tapo):
        config = PlaybackConfig(
            play_audio=True,
            save_dir="/tmp/tts-mcp",
            playback="auto",
            pulse_sink=None,
            pulse_server=None,
            camera_backend="auto",
            speaker_target="camera",
            camera_ffmpeg="ffmpeg",
            tapo_camera_host="192.168.1.60",
            tapo_cloud_password="cloud-pass",
        )

        ok, message = play_to_camera("/tmp/test.wav", config)

        assert ok is True
        assert "played directly via tapo" in message
        mock_tapo.assert_called_once_with(
            file_path="/tmp/test.wav",
            camera_host="192.168.1.60",
            cloud_password="cloud-pass",
            ffmpeg_bin="ffmpeg",
        )

    def test_play_to_camera_reports_missing_tapo_config(self):
        config = PlaybackConfig(
            play_audio=True,
            save_dir="/tmp/tts-mcp",
            playback="auto",
            pulse_sink=None,
            pulse_server=None,
            camera_backend="tapo",
            speaker_target="camera",
            camera_ffmpeg="ffmpeg",
            tapo_camera_host="192.168.1.60",
            tapo_cloud_password=None,
        )

        ok, message = play_to_camera("/tmp/test.wav", config)

        assert ok is False
        assert "TAPO_CLOUD_PASSWORD" in message


class TestTapoAuthHelpers:
    def test_derive_tapo_password_md5(self):
        username, password = _derive_tapo_password(
            "cloud-pass",
            'Digest realm="Tapo", nonce="abcd", qop="auth", encrypt_type="1"',
        )

        assert username == "admin"
        assert password == hashlib.md5(b"cloud-pass").hexdigest().upper()

    def test_build_digest_authorization(self):
        header = _build_digest_authorization(
            method="POST",
            uri="/stream",
            username="admin",
            password="HASHED",
            auth_header='Digest realm="Tapo", nonce="abcd", qop="auth", opaque="ef01"',
        )

        assert header.startswith("Digest ")
        assert 'username="admin"' in header
        assert 'uri="/stream"' in header
        assert 'opaque="ef01"' in header

    @patch("tts_mcp.tapo.http.client.HTTPResponse")
    def test_request_stream_uses_socket(self, mock_http_response):
        client = TapoBackchannelClient(host="192.168.1.60", cloud_password="cloud-pass")
        fake_socket = MagicMock()
        fake_reader = MagicMock()
        client._socket = fake_socket
        client._reader = fake_reader

        response = MagicMock()
        mock_http_response.return_value = response

        result = client._request_stream()

        assert result is response
        args, _kwargs = mock_http_response.call_args
        assert args[0].__class__.__name__ == "_SockLike"
        assert args[0]._reader is fake_reader
        response.begin.assert_called_once()
        response.read.assert_called_once()
