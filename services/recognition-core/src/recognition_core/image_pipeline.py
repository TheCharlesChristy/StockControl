"""Decoding bytes nobody should trust.

Section 7.3 and 16.2: the server does not trust a client-declared extension or
MIME type. Magic bytes, decoded dimensions, decompression ratio and the actual
media type are checked before any model sees the image. This module is the
only place in the service allowed to hand a decoded buffer onward — every
other module receives its output, never raw bytes.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pyvips

from recognition_core.errors import ImageDecodeError, ImageTooLargeError

# vips loader names for the formats this service accepts. Nothing else —
# never SVG (it is a script, not an image), never PDF or an archive format
# pyvips also happens to be able to open.
ALLOWED_LOADERS = frozenset({"jpegload_buffer", "pngload_buffer", "webpload_buffer"})

LOADER_MEDIA_TYPES = {
    "jpegload_buffer": "image/jpeg",
    "pngload_buffer": "image/png",
    "webpload_buffer": "image/webp",
}

# A decoded image far larger, pixel for pixel, than its encoded bytes implied
# is the classic decompression-bomb shape: a tiny file that expands to
# gigabytes in memory. The ratio is generous because ordinary photographs
# compress well; it exists to catch pathological input, not everyday JPEGs.
MAX_DECOMPRESSION_RATIO = 2_000


@dataclass(frozen=True)
class DecodedImage:
    width: int
    height: int
    media_type: str
    # Grayscale or interleaved RGB(A), row-major, uint8. The only shape every
    # downstream stage (barcode, OCR, embedding) is asked to accept.
    pixels: np.ndarray


def decode_image(
    data: bytes,
    *,
    max_source_bytes: int,
    max_source_pixels: int,
) -> DecodedImage:
    """Validates and decodes one image. Raises `ImageDecodeError` or
    `ImageTooLargeError` rather than returning a partial result — a stage that
    receives a `DecodedImage` from here may assume it is safe to process."""

    if len(data) < 1:
        raise ImageDecodeError("recognition.image_empty", "The image has no bytes.")
    if len(data) > max_source_bytes:
        raise ImageTooLargeError(
            "recognition.image_too_large", "The image exceeds the per-file byte limit."
        )

    try:
        image = pyvips.Image.new_from_buffer(data, "", access="sequential")
    except pyvips.Error as error:
        raise ImageDecodeError(
            "recognition.image_undecodable", "The image could not be decoded."
        ) from error

    loader = image.get("vips-loader") if image.get_typeof("vips-loader") != 0 else None
    if loader not in ALLOWED_LOADERS:
        raise ImageDecodeError(
            "recognition.image_format_not_allowed",
            "Only JPEG, PNG and WebP images are accepted.",
        )

    width, height = image.width, image.height
    if width < 1 or height < 1:
        raise ImageDecodeError("recognition.image_undecodable", "The image has no dimensions.")
    if width * height > max_source_pixels:
        raise ImageTooLargeError(
            "recognition.image_too_large", "The image exceeds the decoded pixel limit."
        )

    decompression_ratio = (width * height) / max(len(data), 1)
    if decompression_ratio > MAX_DECOMPRESSION_RATIO:
        raise ImageTooLargeError(
            "recognition.image_decompression_bomb",
            "The image expands far beyond what its encoded size would suggest.",
        )

    # Bands: 1 (grayscale) or 3/4 (RGB/RGBA). Anything else is a colour space
    # this pipeline was not built to reason about — CMYK separations and the
    # like — and is refused rather than silently reinterpreted.
    if image.bands not in (1, 3, 4):
        raise ImageDecodeError(
            "recognition.image_format_not_allowed", "The image has an unsupported colour format."
        )

    memory_view = image.write_to_memory()
    pixels = np.ndarray(
        buffer=memory_view,
        dtype=np.uint8,
        shape=[height, width, image.bands],
    )

    media_type = LOADER_MEDIA_TYPES[loader]
    return DecodedImage(width=width, height=height, media_type=media_type, pixels=pixels)
