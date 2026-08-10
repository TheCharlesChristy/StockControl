"""Deterministic quality/crop heuristics, specification section 7.7."""

from __future__ import annotations

import numpy as np

from recognition_core.quality import compute_quality, generate_crops


def test_a_flat_image_has_a_low_blur_score() -> None:
    flat = np.full((100, 100, 3), 128, dtype=np.uint8)

    quality = compute_quality(flat)

    assert quality.blur_score == 0.0


def test_a_noisy_image_has_a_higher_blur_score_than_a_flat_one() -> None:
    rng = np.random.default_rng(seed=42)
    noisy = rng.integers(0, 256, size=(100, 100, 3), dtype=np.uint8)
    flat = np.full((100, 100, 3), 128, dtype=np.uint8)

    assert compute_quality(noisy).blur_score > compute_quality(flat).blur_score


def test_a_uniform_image_has_no_foreground() -> None:
    flat = np.full((100, 100, 3), 128, dtype=np.uint8)

    quality = compute_quality(flat)

    assert quality.foreground_area_ratio == 0.0


def test_a_bright_centre_square_on_a_dark_border_is_read_as_foreground() -> None:
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    image[25:75, 25:75] = 255  # a 50x50 bright square inside a 100x100 dark frame

    quality = compute_quality(image)

    # The square is 25% of the frame; a border-sampled background estimate
    # should read it as foreground and nothing else.
    assert 0.2 < quality.foreground_area_ratio < 0.3


def test_quality_scores_stay_within_their_declared_bounds() -> None:
    rng = np.random.default_rng(seed=7)
    image = rng.integers(0, 256, size=(64, 64, 3), dtype=np.uint8)

    quality = compute_quality(image)

    assert 0.0 <= quality.blur_score <= 1.0
    assert 0.0 <= quality.foreground_area_ratio <= 1.0


def test_generate_crops_returns_the_fixed_normalised_set() -> None:
    crops = generate_crops()

    labels = [crop.label for crop in crops]
    assert labels == ["full", "centre", "centre-tight"]
    for crop in crops:
        assert crop.x + crop.width <= 1.0
        assert crop.y + crop.height <= 1.0


def test_generate_crops_is_deterministic() -> None:
    assert generate_crops() == generate_crops()
