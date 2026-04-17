#!/usr/bin/env python3
"""
capture-brightness-wifi.py -- wifi-cam (RTSP) から部屋の明るさを測定して stdout に出力する。

使用方法:
  python capture-brightness-wifi.py

環境変数:
  TAPO_CAMERA_HOST  カメラのIPアドレス (必須)
  TAPO_USERNAME     ユーザー名 (デフォルト: admin)
  TAPO_PASSWORD     パスワード (必須)

出力:
  明るさ（0-255の浮動小数点）を1行で出力。
  エラー時は非ゼロ終了。

推奨実行方法:
  cd .claude/mcps/wifi-cam-mcp && uv run python ../../scripts/capture-brightness-wifi.py
"""

from __future__ import annotations

import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def load_env() -> None:
    env_path = Path(__file__).parent.parent / "mcps" / "wifi-cam-mcp" / ".env"
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


def capture_brightness() -> float:
    host = os.environ.get("TAPO_CAMERA_HOST", "")
    username = os.environ.get("TAPO_USERNAME", "admin")
    password = os.environ.get("TAPO_PASSWORD", "")

    if not host or not password:
        raise RuntimeError("TAPO_CAMERA_HOST and TAPO_PASSWORD must be set")

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
            gray = img.convert("L")
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
