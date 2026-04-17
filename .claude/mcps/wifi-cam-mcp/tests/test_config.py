import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wifi_cam_mcp.config import CameraConfig, ServerConfig


def test_camera_config_reads_mount_mode_from_behavior_toml(tmp_path, monkeypatch):
    behavior_path = tmp_path / "mcpBehavior.toml"
    behavior_path.write_text(
        (
            "[wifi-cam]\n"
            "mount_mode = 'ceiling'\n"
            "image_rotation = 180\n"
            "capture_max_width = 640\n"
            "capture_max_height = 480\n"
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("MCP_BEHAVIOR_TOML", str(behavior_path))
    monkeypatch.setenv("TAPO_CAMERA_HOST", "192.168.0.10")
    monkeypatch.setenv("TAPO_USERNAME", "user")
    monkeypatch.setenv("TAPO_PASSWORD", "pass")
    monkeypatch.delenv("TAPO_MOUNT_MODE", raising=False)
    monkeypatch.delenv("CAPTURE_MAX_WIDTH", raising=False)
    monkeypatch.delenv("CAPTURE_MAX_HEIGHT", raising=False)

    config = CameraConfig.from_env()

    assert config.mount_mode == "ceiling"
    assert config.image_rotation == 180
    assert config.max_width == 640
    assert config.max_height == 480


def test_server_config_reads_capture_dir_and_mic_source_from_behavior_toml(
    tmp_path, monkeypatch
):
    behavior_path = tmp_path / "mcpBehavior.toml"
    behavior_path.write_text(
        "[wifi-cam]\nmic_source = 'local'\ncapture_dir = '/tmp/custom-cam'\n",
        encoding="utf-8",
    )

    monkeypatch.setenv("MCP_BEHAVIOR_TOML", str(behavior_path))
    monkeypatch.delenv("MIC_SOURCE", raising=False)
    monkeypatch.delenv("CAPTURE_DIR", raising=False)

    config = ServerConfig.from_env()

    assert config.mic_source == "local"
    assert config.capture_dir == "/tmp/custom-cam"
