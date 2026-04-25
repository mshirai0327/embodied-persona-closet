import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wifi_cam_mcp.camera import NightVisionMode, TapoCamera
from wifi_cam_mcp.config import CameraConfig


class FakeImagingService:
    def __init__(self, *, mode: str = "AUTO", supported_modes: list[str] | None = None):
        self.mode = mode
        self.supported_modes = supported_modes or ["ON", "OFF", "AUTO"]
        self.last_request = None

    def __getattr__(self, name):
        mapping = {
            "GetOptions": self.get_options,
            "GetImagingSettings": self.get_imaging_settings,
            "SetImagingSettings": self.set_imaging_settings,
        }
        try:
            return mapping[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    async def get_options(self, request):
        assert request["VideoSourceToken"] == "video-source-1"
        return SimpleNamespace(IrCutFilterModes=self.supported_modes)

    async def get_imaging_settings(self, request):
        assert request["VideoSourceToken"] == "video-source-1"
        return SimpleNamespace(IrCutFilter=self.mode)

    async def set_imaging_settings(self, request):
        self.last_request = request
        self.mode = request["ImagingSettings"]["IrCutFilter"]


def make_camera(service: FakeImagingService) -> TapoCamera:
    camera = TapoCamera(
        CameraConfig(
            host="192.168.0.10",
            username="user",
            password="pass",
        )
    )
    camera._connected = True
    camera._cam = object()
    camera._imaging_service = service
    camera._video_source_token = "video-source-1"
    return camera


@pytest.mark.asyncio
async def test_get_night_vision_mode_reads_ir_cut_filter():
    camera = make_camera(FakeImagingService(mode="OFF"))

    mode = await camera.get_night_vision_mode()

    assert mode == NightVisionMode.OFF


@pytest.mark.asyncio
async def test_set_night_vision_mode_sets_ir_cut_filter_and_persists():
    service = FakeImagingService(mode="AUTO")
    camera = make_camera(service)

    result = await camera.set_night_vision_mode("off")

    assert result.success is True
    assert result.mode == NightVisionMode.OFF
    assert service.last_request == {
        "VideoSourceToken": "video-source-1",
        "ImagingSettings": {"IrCutFilter": "OFF"},
        "ForcePersistence": True,
    }


@pytest.mark.asyncio
async def test_set_night_vision_mode_rejects_unsupported_mode():
    camera = make_camera(FakeImagingService(supported_modes=["AUTO", "ON"]))

    with pytest.raises(RuntimeError, match="Supported modes: auto, on"):
        await camera.set_night_vision_mode("off")
