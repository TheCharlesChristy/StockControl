"""Stable-failure-code tests.

The one behaviour that matters here: the exception's own message stays out
of `code`, since `code` is what a caller is allowed to log.
"""

from __future__ import annotations

import pytest

from recognition_core.errors import (
    ImageDecodeError,
    ImageTooLargeError,
    ModelUnavailableError,
    RecognitionCoreError,
)


def test_carries_a_stable_code_and_a_human_detail() -> None:
    error = RecognitionCoreError("recognition.example_code", "Something human-readable.")

    assert error.code == "recognition.example_code"
    assert error.detail == "Something human-readable."
    assert str(error) == "Something human-readable."


def test_subclasses_are_still_the_base_error() -> None:
    for error in (
        ImageDecodeError("recognition.image_undecodable", "detail"),
        ImageTooLargeError("recognition.image_too_large", "detail"),
        ModelUnavailableError("recognition.ocr_unavailable", "detail"),
    ):
        assert isinstance(error, RecognitionCoreError)


def test_is_raisable_and_catchable_by_the_base_class() -> None:
    with pytest.raises(RecognitionCoreError):
        raise ImageDecodeError("recognition.image_undecodable", "detail")
