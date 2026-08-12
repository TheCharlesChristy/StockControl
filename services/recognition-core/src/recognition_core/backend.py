"""Model seams and runtime backend loading.

OCR remains intentionally unavailable in this preparatory change. A verified
local CLIP snapshot, when a later manifest promotion supplies one, provides
both visual embeddings and broad-category text comparisons through one loaded
SentenceTransformers model instance.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

import numpy as np

from recognition_core.clip_backend import (
    ClipCategoryBackend,
    ClipEmbeddingBackend,
    SentenceEncoder,
    model_files_exist,
)
from recognition_core.contracts import CategoryLabel, EmbeddingResult, OcrLine
from recognition_core.errors import ModelUnavailableError
from recognition_core.runtime_manifest import RuntimeManifestModel, load_runtime_manifest


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


def _load_sentence_transformer(model_path: Path) -> SentenceEncoder:
    # The import is kept inside the loader so an empty-manifest deployment can
    # still start its barcode and HTTP surfaces without trying to initialise a
    # model. local_files_only is the runtime egress boundary.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from sentence_transformers import SentenceTransformer

    return cast(
        SentenceEncoder,
        SentenceTransformer(
            str(model_path),
            device="cpu",
            local_files_only=True,
        ),
    )


def _is_visual_model(model: RuntimeManifestModel) -> bool:
    model_id = model.id.lower()
    # Schema-version 1 predates an explicit role field. Promotion therefore
    # reserves the visual/CLIP ID namespace; the model identity itself still
    # comes only from repoId@revision#preprocessingId.
    return model_id == "clip" or model_id.startswith("clip-") or model_id.startswith("visual-")


def _find_visual_model(models: tuple[RuntimeManifestModel, ...]) -> RuntimeManifestModel | None:
    candidates = tuple(model for model in models if _is_visual_model(model))
    return candidates[0] if len(candidates) == 1 else None


def load_backends(
    model_directory: str,
    *,
    model_loader: Callable[[Path], SentenceEncoder] | None = None,
) -> Backends:
    unavailable_embedding = _UnavailableEmbeddingBackend()
    unavailable_category = _UnavailableCategoryBackend()

    try:
        runtime_manifest = load_runtime_manifest(Path(model_directory) / "manifest.runtime.json")
        visual_model = _find_visual_model(runtime_manifest.models)
        if visual_model is None or not model_files_exist(Path(model_directory), visual_model):
            raise ModelUnavailableError(
                "recognition.embedding_unavailable", "The verified CLIP model files are absent."
            )

        loader = model_loader if model_loader is not None else _load_sentence_transformer
        model = loader(Path(model_directory) / visual_model.id)
        embedding = ClipEmbeddingBackend(model, visual_model)
        category = ClipCategoryBackend(model, visual_model)
        return Backends(
            ocr=_UnavailableOcrBackend(),
            embedding=embedding,
            category=category,
            # OCR is not implemented in this preparatory change.
            all_loaded=False,
        )
    except Exception:
        # An incomplete or unloadable promoted model must make only its model
        # stages unavailable. In particular, it must not prevent barcode and
        # HTTP startup, nor make readiness truthful before OCR exists.
        return Backends(
            ocr=_UnavailableOcrBackend(),
            embedding=unavailable_embedding,
            category=unavailable_category,
            all_loaded=False,
        )
