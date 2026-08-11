"""The ML seam. No trained weights exist in this environment: no consented
evaluation set, no S0 benchmark run (specification section 20), nowhere to
verify accuracy against. Every stage that would need real weights — OCR,
image embedding, category classification — is declared here as a `Protocol`
so `routes.py` never depends on a concrete model, and `load_backends` is the
single place that decides what actually answers each call.

Promoting real weights means adding an implementation of one of these
Protocols and registering it in `load_backends`; it is deliberately not a
change to `routes.py` or the response contracts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np

from recognition_core.contracts import CategoryLabel, EmbeddingResult, OcrLine
from recognition_core.errors import ModelUnavailableError


class OcrBackend(Protocol):
    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]: ...


class EmbeddingBackend(Protocol):
    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult: ...


class CategoryBackend(Protocol):
    def classify(self, embedding: EmbeddingResult) -> list[CategoryLabel]: ...


class _UnavailableOcrBackend:
    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]:
        del pixels
        raise ModelUnavailableError(
            "recognition.ocr_unavailable", "The text recognition model is not loaded."
        )


class _UnavailableEmbeddingBackend:
    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult:
        del pixels
        raise ModelUnavailableError(
            "recognition.embedding_unavailable", "The image embedding model is not loaded."
        )


class _UnavailableCategoryBackend:
    def classify(self, embedding: EmbeddingResult) -> list[CategoryLabel]:
        del embedding
        raise ModelUnavailableError(
            "recognition.category_unavailable", "The category model is not loaded."
        )


@dataclass(frozen=True)
class Backends:
    ocr: OcrBackend
    embedding: EmbeddingBackend
    category: CategoryBackend
    # True only once every stage above is a real, weight-backed
    # implementation. `/health/ready` refuses to report ready otherwise.
    all_loaded: bool


def load_backends(model_directory: str) -> Backends:
    # `model_directory` is threaded through now so wiring a real backend
    # later — reading its ONNX exports from this path — does not touch any
    # call site outside this function.
    del model_directory
    return Backends(
        ocr=_UnavailableOcrBackend(),
        embedding=_UnavailableEmbeddingBackend(),
        category=_UnavailableCategoryBackend(),
        all_loaded=False,
    )
