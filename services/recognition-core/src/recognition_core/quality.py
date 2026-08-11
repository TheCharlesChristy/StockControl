"""Deterministic quality and crop-box heuristics, specification section 7.7.

No general object detector or saliency model is deployed in v1 — a fixed
full-frame plus centred multiscale crop set covers ordinary product-photo
framing more reliably than a detector trained on unrelated classes. Blur and
foreground scores are cheap image-statistics heuristics, not a learned
quality model; they have not been tuned against a real evaluation set
(section 20's gates are not met in this environment) and should be revisited
once one exists.
"""

from __future__ import annotations

import numpy as np

from recognition_core.contracts import CropBox, ImageQuality

# Variance-of-Laplacian sharpness, scaled so an ordinary in-focus photograph
# lands near the top of the 0-1 range. Chosen by inspection, not a fitted
# threshold — see the module docstring.
_BLUR_NORMALISATION = 500.0

# A pixel further than this from the estimated background shade counts as
# foreground. 0-255 greyscale units.
_FOREGROUND_DISTANCE_THRESHOLD = 25.0


def _to_greyscale(pixels: np.ndarray) -> np.ndarray:
    if pixels.ndim == 2:
        return pixels.astype(np.float64)
    return pixels[:, :, :3].astype(np.float64).mean(axis=2)


def _estimate_background_shade(greyscale: np.ndarray) -> float:
    # Product photographs are usually shot against a plain surface, so the
    # border is a cheap, model-free stand-in for the background colour.
    border = np.concatenate([greyscale[0, :], greyscale[-1, :], greyscale[:, 0], greyscale[:, -1]])
    return float(np.median(border))


def compute_quality(pixels: np.ndarray) -> ImageQuality:
    greyscale = _to_greyscale(pixels)

    laplacian = (
        -4 * greyscale[1:-1, 1:-1]
        + greyscale[:-2, 1:-1]
        + greyscale[2:, 1:-1]
        + greyscale[1:-1, :-2]
        + greyscale[1:-1, 2:]
    )
    sharpness = float(np.var(laplacian)) if laplacian.size > 0 else 0.0
    blur_score = min(sharpness / _BLUR_NORMALISATION, 1.0)

    background_shade = _estimate_background_shade(greyscale)
    distance = np.abs(greyscale - background_shade)
    foreground_area_ratio = float(np.mean(distance > _FOREGROUND_DISTANCE_THRESHOLD))

    return ImageQuality(blur_score=blur_score, foreground_area_ratio=foreground_area_ratio)


def generate_crops() -> list[CropBox]:
    """Fixed, normalised crop boxes tried for every photo.

    `render-exemplar` re-crops the source image with whichever of these the
    caller selects, so the set has to be small and stable across requests —
    not derived from this specific image.
    """

    return [
        CropBox(x=0.0, y=0.0, width=1.0, height=1.0, label="full"),
        CropBox(x=0.15, y=0.15, width=0.7, height=0.7, label="centre"),
        CropBox(x=0.3, y=0.3, width=0.4, height=0.4, label="centre-tight"),
    ]
