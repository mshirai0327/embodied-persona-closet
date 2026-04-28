import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wifi_cam_mcp.camera import NightVisionMode

SCRIPT_PATH = (
    Path(__file__).resolve().parents[3] / "scripts" / "capture-brightness-wifi.py"
)


def load_capture_module():
    spec = importlib.util.spec_from_file_location("capture_brightness_wifi", SCRIPT_PATH)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_force_night_vision_off_sets_off_before_capture(monkeypatch):
    module = load_capture_module()

    class FakeTapoCamera:
        instances = []

        def __init__(self, config):
            self.config = config
            self.requested_mode = None
            self.disconnected = False
            FakeTapoCamera.instances.append(self)

        async def get_night_vision_mode(self):
            return NightVisionMode.AUTO

        async def set_night_vision_mode(self, mode):
            self.requested_mode = mode
            return SimpleNamespace(success=True, mode=mode, message="ok")

        async def disconnect(self):
            self.disconnected = True

    import wifi_cam_mcp.camera as camera_module

    monkeypatch.setattr(camera_module, "TapoCamera", FakeTapoCamera)
    monkeypatch.setenv("TAPO_ONVIF_PORT", "2021")

    changed = await module.force_night_vision_off("192.168.0.10", "user", "pass")

    assert changed is True
    camera = FakeTapoCamera.instances[0]
    assert camera.config.onvif_port == 2021
    assert camera.requested_mode == NightVisionMode.OFF
    assert camera.disconnected is True


@pytest.mark.asyncio
async def test_force_night_vision_off_skips_setting_when_already_off(monkeypatch):
    module = load_capture_module()

    class FakeTapoCamera:
        instances = []

        def __init__(self, config):
            self.requested_mode = None
            FakeTapoCamera.instances.append(self)

        async def get_night_vision_mode(self):
            return NightVisionMode.OFF

        async def set_night_vision_mode(self, mode):
            self.requested_mode = mode
            return SimpleNamespace(success=True, mode=mode, message="ok")

        async def disconnect(self):
            pass

    import wifi_cam_mcp.camera as camera_module

    monkeypatch.setattr(camera_module, "TapoCamera", FakeTapoCamera)

    changed = await module.force_night_vision_off("192.168.0.10", "user", "pass")

    assert changed is False
    assert FakeTapoCamera.instances[0].requested_mode is None


def test_capture_brightness_forces_night_vision_off_before_ffmpeg(monkeypatch, tmp_path):
    module = load_capture_module()
    calls = []

    def fake_ensure_night_vision_off(host, username, password):
        calls.append(("night_vision", host, username, password))

    def fake_run(args, capture_output, timeout):
        calls.append(("ffmpeg",))
        from PIL import Image

        Image.new("L", (2, 2), color=10).save(args[-1])
        return SimpleNamespace(returncode=0, stderr=b"")

    monkeypatch.setenv("TAPO_CAMERA_HOST", "192.168.0.10")
    monkeypatch.setenv("TAPO_USERNAME", "user")
    monkeypatch.setenv("TAPO_PASSWORD", "pass")
    monkeypatch.setattr(module, "ensure_night_vision_off", fake_ensure_night_vision_off)
    monkeypatch.setattr(module.subprocess, "run", fake_run)
    monkeypatch.setattr(sys, "argv", ["capture-brightness-wifi.py"])
    monkeypatch.setenv("TMPDIR", str(tmp_path))

    brightness = module.capture_brightness()

    assert brightness == 10
    assert calls == [
        ("night_vision", "192.168.0.10", "user", "pass"),
        ("ffmpeg",),
    ]
