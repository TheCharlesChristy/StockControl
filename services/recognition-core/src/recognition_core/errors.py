"""Stable failure codes. Never carries the driver or decoder's own message —
image libraries put file paths and library internals in their exceptions, and
none of that belongs in a log line or a response.
"""

from __future__ import annotations


class RecognitionCoreError(Exception):
    """Base for every error this service raises deliberately."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class ImageDecodeError(RecognitionCoreError):
    """The bytes are not a decodable image, or fail a bound this service
    enforces before any model sees them."""


class ImageTooLargeError(RecognitionCoreError):
    pass


class ModelUnavailableError(RecognitionCoreError):
    """A model file this service expected under `model_directory` is missing.
    Distinct from a decode failure: the deployment is misconfigured, not the
    input."""
