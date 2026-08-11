"""Untrusted-bytes decode tests, specification sections 7.3 and 16.2."""

from __future__ import annotations

import io

import pytest
import pyvips
from PIL import Image

from recognition_core.errors import ImageDecodeError, ImageTooLargeError
from recognition_core.image_pipeline import decode_image

_DEFAULT_MAX_BYTES = 12 * 1024 * 1024
_DEFAULT_MAX_PIXELS = 40_000_000


def _encode(
    width: int, height: int, image_format: str, colour: tuple[int, int, int] = (128, 64, 32)
) -> bytes:
    image = Image.new("RGB", (width, height), color=colour)
    buffer = io.BytesIO()
    image.save(buffer, format=image_format)
    return buffer.getvalue()


def test_decodes_a_real_jpeg() -> None:
    data = _encode(64, 48, "JPEG")

    decoded = decode_image(
        data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
    )

    assert decoded.width == 64
    assert decoded.height == 48
    assert decoded.media_type == "image/jpeg"
    assert decoded.pixels.shape[:2] == (48, 64)


def test_decodes_a_real_png() -> None:
    data = _encode(32, 32, "PNG")

    decoded = decode_image(
        data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
    )

    assert decoded.media_type == "image/png"


def test_decodes_a_real_webp() -> None:
    data = _encode(32, 32, "WEBP")

    decoded = decode_image(
        data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
    )

    assert decoded.media_type == "image/webp"


def test_rejects_empty_bytes() -> None:
    with pytest.raises(ImageDecodeError):
        decode_image(
            b"", max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
        )


def test_rejects_bytes_that_are_not_an_image() -> None:
    with pytest.raises(ImageDecodeError):
        decode_image(
            b"not an image, just text pretending to be one" * 10,
            max_source_bytes=_DEFAULT_MAX_BYTES,
            max_source_pixels=_DEFAULT_MAX_PIXELS,
        )


def test_rejects_a_disguised_svg() -> None:
    # A script, not an image — must never reach a decoder that executes it.
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"

    with pytest.raises(ImageDecodeError):
        decode_image(
            svg, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
        )


def test_rejects_bytes_over_the_byte_limit() -> None:
    data = _encode(64, 48, "JPEG")

    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_source_bytes=len(data) - 1, max_source_pixels=_DEFAULT_MAX_PIXELS)


def test_rejects_decoded_dimensions_over_the_pixel_limit() -> None:
    data = _encode(200, 200, "PNG")

    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=200)


def test_rejects_a_decompression_bomb_shape() -> None:
    # A flat-colour image, lossless-WebP-encoded, compresses to a few
    # kilobytes yet decodes to a hundred million pixels — exactly the shape
    # MAX_DECOMPRESSION_RATIO exists to catch, independent of the absolute
    # pixel cap (raised here so that cap is not what trips the test).
    flat_image = pyvips.Image.black(10_000, 10_000) + 10
    data = flat_image.webpsave_buffer(lossless=True, Q=100)

    with pytest.raises(ImageTooLargeError):
        decode_image(data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=200_000_000)


def test_pixels_are_the_expected_shape_and_dtype() -> None:
    data = _encode(10, 5, "PNG")

    decoded = decode_image(
        data, max_source_bytes=_DEFAULT_MAX_BYTES, max_source_pixels=_DEFAULT_MAX_PIXELS
    )

    assert decoded.pixels.dtype.name == "uint8"
    assert decoded.pixels.shape[0] == 5
    assert decoded.pixels.shape[1] == 10
    assert decoded.pixels.shape[2] in (1, 3, 4)
