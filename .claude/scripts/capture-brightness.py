#!/usr/bin/env python3
"""
capture-brightness.py -- カメラで部屋の明るさを測定して stdout に出力する。

使用方法:
  python capture-brightness.py [device]

推奨実行方法:
  cd .claude/mcps/usb-webcam-mcp && uv run python ../../scripts/capture-brightness.py

出力:
  明るさ（0-255の浮動小数点）を1行で出力。
  エラー時は非ゼロ終了。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_VIDEOIO_DEBUG"] = "0"


RECOMMENDED_COMMAND = (
    "cd .claude/mcps/usb-webcam-mcp && uv run python ../../scripts/capture-brightness.py"
)


try:
    import cv2
    import numpy as np
except ModuleNotFoundError as exc:
    print(
        "ERROR: OpenCV dependencies are not installed in this Python "
        f"({exc.name}). Use `{RECOMMENDED_COMMAND}`.",
        file=sys.stderr,
    )
    sys.exit(1)


DEFAULT_DEVICE = "/dev/video0"


def _iter_linux_video_devices() -> list[Path]:
    devices = list(Path("/dev").glob("video*"))

    def sort_key(path: Path) -> tuple[int, str]:
        suffix = path.name.removeprefix("video")
        return (int(suffix), path.name) if suffix.isdigit() else (9999, path.name)

    return sorted(devices, key=sort_key)


def _describe_linux_video_devices() -> str:
    devices = _iter_linux_video_devices()
    if not devices:
        return "none"
    return ", ".join(str(path) for path in devices)


def _normalize_device(device: int | str) -> int | str:
    if isinstance(device, int):
        return device

    value = device.strip()
    if value.isdigit():
        return int(value)
    if value == DEFAULT_DEVICE:
        devices = _iter_linux_video_devices()
        if devices:
            return str(devices[0])
    return value


def _open_capture(source: int | str) -> cv2.VideoCapture:
    attempts: list[cv2.VideoCapture] = []

    if isinstance(source, str):
        attempts.append(cv2.VideoCapture(source, cv2.CAP_V4L2))
        attempts.append(cv2.VideoCapture(source))
    else:
        attempts.append(cv2.VideoCapture(source))
        attempts.append(cv2.VideoCapture(source, cv2.CAP_V4L2))

    for cap in attempts:
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
            return cap
        cap.release()

    return cv2.VideoCapture()


def capture_brightness(device: int | str = DEFAULT_DEVICE) -> float:
    source = _normalize_device(device)
    cap = _open_capture(source)
    if not cap.isOpened():
        raise RuntimeError(
            "カメラを開けませんでした "
            f"(source={source}, /dev/video*={_describe_linux_video_devices()}). "
            "WSL2 では usbipd でカメラをアタッチしてから実行してください。"
        )

    try:
        # WSL2 の UVC カメラでは MJPG を要求しないと select() timeout になりやすい。
        for _ in range(5):
            cap.read()

        ret, frame = cap.read()
        if not ret or frame is None:
            raise RuntimeError(
                f"フレームを取得できませんでした (source={source}). "
                "MJPG は要求済みです。転送済みのデバイスか確認してください。"
            )

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(np.mean(gray))
    finally:
        cap.release()


if __name__ == "__main__":
    device: int | str = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_DEVICE
    try:
        brightness = capture_brightness(device)
        print(f"{brightness:.1f}")
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
