"""Renders one confirmed crop as a small exemplar image, specification
section 9.1's `/v1/render-exemplar`. Runs on an already-decoded, already
size-checked image — nothing here re-validates untrusted bytes, that is
`image_pipeline.decode_image`'s job.
"""

from __future__ import annotations

import numpy as np
import pyvips

# Item exemplars are for nearest-neighbour comparison, not a customer-facing
# photograph — small and consistent beats high resolution.
MAX_LONG_EDGE = 512
WEBP_QUALITY = 82


def render_crop(
    pixels: np.ndarray,
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    max_long_edge: int = MAX_LONG_EDGE,
) -> tuple[bytes, int, int]:
    """Crops the normalised (0-1) box out of `pixels`, downscales it to at
    most `max_long_edge` on its longer side, and encodes it as WebP.

    Returns `(bytes, width, height)` of the encoded image.
    """

    source_height, source_width = pixels.shape[0], pixels.shape[1]
    left = min(round(x * source_width), source_width - 1)
    top = min(round(y * source_height), source_height - 1)
    crop_width = max(1, min(round(width * source_width), source_width - left))
    crop_height = max(1, min(round(height * source_height), source_height - top))

    cropped = np.ascontiguousarray(pixels[top : top + crop_height, left : left + crop_width])
    bands = 1 if cropped.ndim == 2 else cropped.shape[2]

    vips_image = pyvips.Image.new_from_memory(
        cropped.tobytes(), cropped.shape[1], cropped.shape[0], bands, "uchar"
    )

    long_edge = max(vips_image.width, vips_image.height)
    if long_edge > max_long_edge:
        vips_image = vips_image.resize(max_long_edge / long_edge)

    # `write_to_memory`-derived buffers carry no EXIF to begin with, and
    # webpsave_buffer emits none unless explicitly asked to keep it.
    webp_bytes = vips_image.webpsave_buffer(Q=WEBP_QUALITY)
    return webp_bytes, vips_image.width, vips_image.height
