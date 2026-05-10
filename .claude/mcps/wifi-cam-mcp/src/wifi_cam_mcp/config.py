"""Configuration for WiFi Camera MCP Server."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from ._behavior import get_behavior

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _get_wifi_cam_setting(*env_keys: str, behavior_key: str, default: Any) -> Any:
    for key in env_keys:
        value = os.getenv(key)
        if value not in (None, ""):
            return value

    behavior_value = get_behavior("wifi-cam", behavior_key, default)
    return default if behavior_value in (None, "") else behavior_value


def _normalize_mount_mode(value: object) -> str:
    mount_mode = str(value).strip().lower()
    if mount_mode not in ("normal", "ceiling"):
        raise ValueError(f"Invalid mount mode '{mount_mode}'. Must be 'normal' or 'ceiling'.")
    return mount_mode


def _normalize_image_rotation(value: object) -> int:
    rotation = int(value)
    if rotation not in (0, 90, 180, 270):
        raise ValueError(
            f"Invalid image rotation '{rotation}'. Must be one of 0, 90, 180, 270."
        )
    return rotation


@dataclass(frozen=True)
class CameraConfig:
    """Camera connection configuration."""

    host: str
    username: str
    password: str
    onvif_port: int = 2020
    stream_url: str | None = None
    max_width: int = 1920
    max_height: int = 1080
    mount_mode: str = "normal"  # "normal" (desktop) or "ceiling" (inverted)
    image_rotation: int = 0

    @classmethod
    def from_env(cls, prefix: str = "TAPO") -> "CameraConfig":
        """Create config from environment variables.

        Args:
            prefix: Environment variable prefix (default: "TAPO")
                    For right camera, use "TAPO_RIGHT"
        """
        host = os.getenv(f"{prefix}_CAMERA_HOST", "") or os.getenv("TAPO_CAMERA_HOST", "")
        username = os.getenv(f"{prefix}_USERNAME", "") or os.getenv("TAPO_USERNAME", "")
        password = os.getenv(f"{prefix}_PASSWORD", "") or os.getenv("TAPO_PASSWORD", "")
        onvif_port = int(
            _get_wifi_cam_setting(
                f"{prefix}_ONVIF_PORT",
                "TAPO_ONVIF_PORT",
                behavior_key="onvif_port",
                default="2020",
            )
        )
        stream_url = os.getenv(f"{prefix}_STREAM_URL") or os.getenv("TAPO_STREAM_URL")
        mount_mode = _normalize_mount_mode(
            _get_wifi_cam_setting(
                f"{prefix}_MOUNT_MODE",
                "TAPO_MOUNT_MODE",
                behavior_key="mount_mode",
                default="normal",
            )
        )
        max_width = int(
            _get_wifi_cam_setting(
                "CAPTURE_MAX_WIDTH",
                behavior_key="capture_max_width",
                default="1920",
            )
        )
        max_height = int(
            _get_wifi_cam_setting(
                "CAPTURE_MAX_HEIGHT",
                behavior_key="capture_max_height",
                default="1080",
            )
        )
        image_rotation = _normalize_image_rotation(
            _get_wifi_cam_setting(
                f"{prefix}_IMAGE_ROTATION",
                "TAPO_IMAGE_ROTATION",
                behavior_key="image_rotation",
                default="0",
            )
        )

        if not host:
            raise ValueError(f"{prefix}_CAMERA_HOST environment variable is required")
        if not username:
            raise ValueError(f"{prefix}_USERNAME environment variable is required")
        if not password:
            raise ValueError(f"{prefix}_PASSWORD environment variable is required")

        return cls(
            host=host,
            username=username,
            password=password,
            onvif_port=onvif_port,
            stream_url=stream_url,
            mount_mode=mount_mode,
            image_rotation=image_rotation,
            max_width=max_width,
            max_height=max_height,
        )

    @classmethod
    def right_camera_from_env(cls) -> "CameraConfig | None":
        """Create config for right camera if configured.

        Returns:
            CameraConfig for right camera, or None if not configured
        """
        host = os.getenv("TAPO_RIGHT_CAMERA_HOST", "")
        if not host:
            return None

        # Right camera can share username/password with left, or have its own
        username = os.getenv("TAPO_RIGHT_USERNAME", "") or os.getenv("TAPO_USERNAME", "")
        password = os.getenv("TAPO_RIGHT_PASSWORD", "") or os.getenv("TAPO_PASSWORD", "")
        onvif_port = int(
            _get_wifi_cam_setting(
                "TAPO_RIGHT_ONVIF_PORT",
                "TAPO_ONVIF_PORT",
                behavior_key="onvif_port",
                default="2020",
            )
        )
        stream_url = os.getenv("TAPO_RIGHT_STREAM_URL")
        mount_mode = _normalize_mount_mode(
            _get_wifi_cam_setting(
                "TAPO_RIGHT_MOUNT_MODE",
                "TAPO_MOUNT_MODE",
                behavior_key="mount_mode",
                default="normal",
            )
        )
        max_width = int(
            _get_wifi_cam_setting(
                "CAPTURE_MAX_WIDTH",
                behavior_key="capture_max_width",
                default="1920",
            )
        )
        max_height = int(
            _get_wifi_cam_setting(
                "CAPTURE_MAX_HEIGHT",
                behavior_key="capture_max_height",
                default="1080",
            )
        )
        image_rotation = _normalize_image_rotation(
            _get_wifi_cam_setting(
                "TAPO_RIGHT_IMAGE_ROTATION",
                "TAPO_IMAGE_ROTATION",
                behavior_key="image_rotation",
                default="0",
            )
        )

        if not username or not password:
            return None

        return cls(
            host=host,
            username=username,
            password=password,
            onvif_port=onvif_port,
            stream_url=stream_url,
            mount_mode=mount_mode,
            image_rotation=image_rotation,
            max_width=max_width,
            max_height=max_height,
        )


@dataclass(frozen=True)
class ServerConfig:
    """MCP Server configuration."""

    name: str = "wifi-cam-mcp"
    version: str = "0.1.0"
    capture_dir: str = "/tmp/wifi-cam-mcp"
    mic_source: str = "camera"  # "camera" (RTSP) or "local" (PC microphone)

    @classmethod
    def from_env(cls) -> "ServerConfig":
        """Create config from environment variables."""
        mic_source = str(
            _get_wifi_cam_setting(
                "MIC_SOURCE",
                behavior_key="mic_source",
                default="camera",
            )
        ).lower()
        if mic_source not in ("camera", "local"):
            raise ValueError(f"Invalid MIC_SOURCE '{mic_source}'. Must be 'camera' or 'local'.")
        return cls(
            name=os.getenv("MCP_SERVER_NAME", "wifi-cam-mcp"),
            version=os.getenv("MCP_SERVER_VERSION", "0.1.0"),
            capture_dir=str(
                _get_wifi_cam_setting(
                    "CAPTURE_DIR",
                    behavior_key="capture_dir",
                    default="/tmp/wifi-cam-mcp",
                )
            ),
            mic_source=mic_source,
        )
