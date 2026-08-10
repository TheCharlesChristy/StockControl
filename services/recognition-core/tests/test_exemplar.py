"""Crop-and-encode tests for `/v1/render-exemplar`, specification section 9.1."""

from __future__ import annotations

import numpy as np
import pyvips

from recognition_core.exemplar import render_crop


def _read_back(webp_bytes: bytes) -> pyvips.Image:
    return pyvips.Image.new_from_buffer(webp_bytes, "")


def test_crops_to_the_requested_normalised_box() -> None:
    pixels = np.zeros((200, 400, 3), dtype=np.uint8)

    webp_bytes, width, height = render_crop(pixels, x=0.25, y=0.25, width=0.5, height=0.5)

    assert width == 200
    assert height == 100
    decoded = _read_back(webp_bytes)
    assert decoded.width == 200
    assert decoded.height == 100


def test_the_full_frame_box_keeps_the_original_aspect_ratio() -> None:
    pixels = np.zeros((300, 600, 3), dtype=np.uint8)

    _, width, height = render_crop(pixels, x=0.0, y=0.0, width=1.0, height=1.0)

    assert width / height == 600 / 300


def test_downscales_a_crop_larger_than_the_long_edge_cap() -> None:
    pixels = np.zeros((2000, 2000, 3), dtype=np.uint8)

    _, width, height = render_crop(pixels, x=0.0, y=0.0, width=1.0, height=1.0, max_long_edge=512)

    assert max(width, height) == 512


def test_a_crop_smaller_than_the_cap_is_not_upscaled() -> None:
    pixels = np.zeros((100, 100, 3), dtype=np.uint8)

    _, width, height = render_crop(pixels, x=0.0, y=0.0, width=1.0, height=1.0, max_long_edge=512)

    assert (width, height) == (100, 100)


def test_output_is_a_valid_webp_image() -> None:
    pixels = np.full((100, 100, 3), 60, dtype=np.uint8)

    webp_bytes, _, _ = render_crop(pixels, x=0.0, y=0.0, width=1.0, height=1.0)

    decoded = _read_back(webp_bytes)
    assert decoded.get("vips-loader") == "webpload_buffer"


def test_a_greyscale_source_is_handled() -> None:
    pixels = np.full((80, 80), 90, dtype=np.uint8)

    webp_bytes, width, height = render_crop(pixels, x=0.0, y=0.0, width=1.0, height=1.0)

    assert (width, height) == (80, 80)
    assert len(webp_bytes) > 0
