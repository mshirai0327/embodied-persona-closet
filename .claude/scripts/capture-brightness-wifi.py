#!/usr/bin/env python3
"""
capture-brightness-wifi.py -- wifi-cam (RTSP) から部屋の明るさを測定して stdout に出力する。

使用方法:
  python capture-brightness-wifi.py

環境変数:
  TAPO_CAMERA_HOST  カメラのIPアドレス (必須)
  TAPO_USERNAME     ユーザー名 (デフォルト: admin)
  TAPO_PASSWORD     パスワード (必須)
  TAPO_ONVIF_PORT   ONVIF ポート (デフォルト: mcpBehavior.toml または 2020)

出力:
  明るさ（0-255の浮動小数点）を1行で出力。
  エラー時は非ゼロ終了。

推奨実行方法:
  cd .claude/mcps/wifi-cam-mcp && uv run python ../../scripts/capture-brightness-wifi.py
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
WIFI_CAM_MCP_DIR = SCRIPT_DIR.parent / "mcps" / "wifi-cam-mcp"
WIFI_CAM_SRC_DIR = WIFI_CAM_MCP_DIR / "src"
if str(WIFI_CAM_SRC_DIR) not in sys.path:
    sys.path.insert(0, str(WIFI_CAM_SRC_DIR))


def load_env() -> None:
    env_path = WIFI_CAM_MCP_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key not in os.environ:
            os.environ[key] = value.strip()


def parse_roi_spec(raw: str | None) -> tuple[float, float, float, float] | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None

    parts = [part.strip() for part in text.split(",")]
    if len(parts) != 4:
        raise ValueError("ROI must be x,y,w,h")

    values = [float(part) for part in parts]
    if any(not (0.0 <= value <= 1.0) for value in values):
        raise ValueError("ROI values must be normalized between 0.0 and 1.0")

    left, top, width, height = values
    if width <= 0 or height <= 0:
        raise ValueError("ROI width and height must be positive")
    if left + width > 1.0 or top + height > 1.0:
        raise ValueError("ROI must stay within the frame")

    return left, top, width, height


def crop_to_roi(img, roi: tuple[float, float, float, float] | None):
    if roi is None:
        return img

    left_ratio, top_ratio, width_ratio, height_ratio = roi
    width, height = img.size
    left = max(0, min(width - 1, int(round(width * left_ratio))))
    top = max(0, min(height - 1, int(round(height * top_ratio))))
    right = max(left + 1, min(width, int(round(width * (left_ratio + width_ratio)))))
    bottom = max(top + 1, min(height, int(round(height * (top_ratio + height_ratio)))))
    return img.crop((left, top, right, bottom))


def get_onvif_port() -> int:
    raw = os.environ.get("TAPO_ONVIF_PORT") or os.environ.get("ONVIF_PORT")
    if raw:
        return int(raw)

    try:
        from wifi_cam_mcp._behavior import get_behavior

        return int(get_behavior("wifi-cam", "onvif_port", 2020))
    except Exception:
        return 2020


def get_night_vision_settle_seconds() -> float:
    raw = os.environ.get("WARDROBE_NIGHT_VISION_SETTLE_SECONDS", "1.0")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 1.0


async def force_night_vision_off(host: str, username: str, password: str) -> bool:
    from wifi_cam_mcp.camera import NightVisionMode, TapoCamera
    from wifi_cam_mcp.config import CameraConfig

    camera = TapoCamera(
        CameraConfig(
            host=host,
            username=username,
            password=password,
            onvif_port=get_onvif_port(),
        )
    )
    try:
        current_mode = await camera.get_night_vision_mode()
        if current_mode == NightVisionMode.OFF:
            return False

        result = await camera.set_night_vision_mode(NightVisionMode.OFF)
        if not result.success or result.mode != NightVisionMode.OFF:
            raise RuntimeError(result.message)
        return True
    finally:
        await camera.disconnect()


def ensure_night_vision_off(host: str, username: str, password: str) -> None:
    changed = asyncio.run(force_night_vision_off(host, username, password))
    if changed:
        time.sleep(get_night_vision_settle_seconds())


def capture_brightness() -> float:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--roi")
    args, _ = parser.parse_known_args()

    host = os.environ.get("TAPO_CAMERA_HOST", "")
    username = os.environ.get("TAPO_USERNAME", "admin")
    password = os.environ.get("TAPO_PASSWORD", "")
    roi = parse_roi_spec(args.roi or os.environ.get("WARDROBE_BRIGHTNESS_ROI"))

    if not host or not password:
        raise RuntimeError("TAPO_CAMERA_HOST and TAPO_PASSWORD must be set")

    ensure_night_vision_off(host, username, password)

    rtsp_url = f"rtsp://{username}:{password}@{host}:554/stream2"

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-frames:v", "1",
                "-f", "image2",
                "-y",
                tmp_path,
            ],
            capture_output=True,
            timeout=15,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr.decode(errors='replace')[-300:]}")

        from PIL import Image, ImageStat

        with Image.open(tmp_path) as img:
            gray = crop_to_roi(img, roi).convert("L")
            return ImageStat.Stat(gray).mean[0]
    finally:
        Path(tmp_path).unlink(missing_ok=True)


if __name__ == "__main__":
    load_env()
    try:
        brightness = capture_brightness()
        print(f"{brightness:.1f}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
