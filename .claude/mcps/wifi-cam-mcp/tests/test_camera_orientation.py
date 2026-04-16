import io
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from wifi_cam_mcp.camera import _apply_image_orientation


def _make_corner_image() -> Image.Image:
    image = Image.new("RGB", (20, 20))
    for x in range(20):
        for y in range(20):
            if x < 10 and y < 10:
                color = (255, 0, 0)
            elif x >= 10 and y < 10:
                color = (0, 255, 0)
            elif x < 10 and y >= 10:
                color = (0, 0, 255)
            else:
                color = (255, 255, 0)
            image.putpixel((x, y), color)
    return image


def _make_exif_rotated_image() -> Image.Image:
    source = _make_corner_image()
    exif = source.getexif()
    exif[274] = 3

    buffer = io.BytesIO()
    source.save(buffer, format="JPEG", exif=exif)
    buffer.seek(0)
    return Image.open(buffer)


def test_apply_image_orientation_keeps_normal_mount_upright():
    corrected = _apply_image_orientation(_make_corner_image(), 0)

    assert corrected.getpixel((5, 5)) == (255, 0, 0)
    assert corrected.getpixel((15, 5)) == (0, 255, 0)
    assert corrected.getpixel((5, 15)) == (0, 0, 255)
    assert corrected.getpixel((15, 15)) == (255, 255, 0)


def test_apply_image_orientation_rotates_180_degrees():
    corrected = _apply_image_orientation(_make_corner_image(), 180)

    assert corrected.getpixel((5, 5)) == (255, 255, 0)
    assert corrected.getpixel((15, 5)) == (0, 0, 255)
    assert corrected.getpixel((5, 15)) == (0, 255, 0)
    assert corrected.getpixel((15, 15)) == (255, 0, 0)


def test_apply_image_orientation_normalizes_exif_before_mount_rotation():
    corrected = _apply_image_orientation(_make_exif_rotated_image(), 0)

    top_left = corrected.getpixel((5, 5))
    top_right = corrected.getpixel((15, 5))
    bottom_left = corrected.getpixel((5, 15))
    bottom_right = corrected.getpixel((15, 15))

    assert top_left[0] > 200 and top_left[1] > 200 and top_left[2] < 100
    assert top_right[2] > 200 and top_right[0] < 100 and top_right[1] < 100
    assert bottom_left[1] > 200 and bottom_left[0] < 100 and bottom_left[2] < 100
    assert bottom_right[0] > 200 and bottom_right[1] < 100 and bottom_right[2] < 100


def test_apply_image_orientation_supports_quarter_turn_rotation():
    corrected = _apply_image_orientation(_make_corner_image(), 90)

    assert corrected.getpixel((5, 5)) == (0, 255, 0)
    assert corrected.getpixel((15, 5)) == (255, 255, 0)
    assert corrected.getpixel((5, 15)) == (255, 0, 0)
    assert corrected.getpixel((15, 15)) == (0, 0, 255)
