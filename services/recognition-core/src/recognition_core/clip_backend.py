"""Local SentenceTransformers CLIP adapters for visual evidence.

This module deliberately has no model download path. ``load_backends`` only
constructs it after the build-generated runtime manifest identifies a local
snapshot whose every declared file exists under the model directory.
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image

from recognition_core.category_taxonomy import CategoryDefinition, load_category_taxonomy
from recognition_core.contracts import CategoryLabel, EmbeddingResult
from recognition_core.errors import ModelUnavailableError
from recognition_core.runtime_manifest import RuntimeManifestModel, model_revision

CLIP_EMBEDDING_DIMENSION = 512


class SentenceEncoder(Protocol):
    def encode(
        self,
        sentences: Sequence[object],
        *,
        normalize_embeddings: bool,
        convert_to_numpy: bool,
        show_progress_bar: bool,
    ) -> object: ...


def _unavailable(code: str, detail: str) -> ModelUnavailableError:
    return ModelUnavailableError(code, detail)


def _as_vector(
    raw: object,
    *,
    expected_dimension: int,
    context: str,
    error_code: str = "recognition.embedding_unavailable",
) -> np.ndarray:
    try:
        if hasattr(raw, "detach"):
            raw = raw.detach().cpu().numpy()  # type: ignore[union-attr]
        array = np.asarray(raw, dtype=np.float64)
    except Exception as error:
        raise _unavailable(error_code, f"Invalid {context} vector.") from error

    if array.ndim == 2 and array.shape[0] == 1:
        array = array[0]
    if array.ndim != 1 or array.size == 0 or array.size != expected_dimension:
        raise _unavailable(error_code, f"{context} vector has an invalid dimension.")
    if not np.isfinite(array).all():
        raise _unavailable(error_code, f"{context} vector is not finite.")
    norm = float(np.linalg.norm(array))
    if not np.isfinite(norm) or norm == 0.0:
        raise _unavailable(error_code, f"{context} vector is zero.")
    return array / norm


def _image_from_pixels(pixels: np.ndarray) -> Image.Image:
    if pixels.dtype != np.uint8 or pixels.ndim != 3 or pixels.shape[2] not in (1, 3, 4):
        raise _unavailable(
            "recognition.embedding_unavailable", "Decoded image has an unsupported shape."
        )
    try:
        if pixels.shape[2] == 1:
            return Image.fromarray(pixels[:, :, 0], mode="L").convert("RGB")
        if pixels.shape[2] == 4:
            return Image.fromarray(pixels, mode="RGBA").convert("RGB")
        return Image.fromarray(pixels, mode="RGB")
    except Exception as error:
        raise _unavailable(
            "recognition.embedding_unavailable", "Decoded image could not be converted."
        ) from error


class ClipEmbeddingBackend:
    def __init__(
        self,
        model: SentenceEncoder,
        model_metadata: RuntimeManifestModel,
        *,
        expected_dimension: int = CLIP_EMBEDDING_DIMENSION,
    ) -> None:
        self.model = model
        self.model_metadata = model_metadata
        self.model_revision = model_revision(model_metadata)
        self.expected_dimension = expected_dimension

    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult:
        image = _image_from_pixels(pixels)
        try:
            encoded = self.model.encode(
                [image],
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        except Exception as error:
            raise _unavailable(
                "recognition.embedding_unavailable", "The CLIP image encoder could not run."
            ) from error
        vector = _as_vector(
            encoded, expected_dimension=self.expected_dimension, context="CLIP image"
        )
        return EmbeddingResult(
            model_revision=self.model_revision,
            vector=[float(value) for value in vector],
        )


class ClipCategoryBackend:
    def __init__(
        self,
        model: SentenceEncoder,
        model_metadata: RuntimeManifestModel,
        *,
        taxonomy: tuple[CategoryDefinition, ...] | None = None,
        expected_dimension: int = CLIP_EMBEDDING_DIMENSION,
    ) -> None:
        self.model = model
        self.model_metadata = model_metadata
        self.model_revision = model_revision(model_metadata)
        self.expected_dimension = expected_dimension
        self.taxonomy = taxonomy if taxonomy is not None else load_category_taxonomy()
        try:
            encoded = self.model.encode(
                [category.prompt for category in self.taxonomy],
                normalize_embeddings=True,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        except Exception as error:
            raise _unavailable(
                "recognition.category_unavailable", "The CLIP category encoder could not run."
            ) from error

        try:
            matrix = np.asarray(encoded, dtype=np.float64)
        except Exception as error:
            raise _unavailable(
                "recognition.category_unavailable", "Invalid CLIP category vectors."
            ) from error
        if matrix.ndim != 2 or matrix.shape != (len(self.taxonomy), expected_dimension):
            raise _unavailable(
                "recognition.category_unavailable", "CLIP category vectors have an invalid shape."
            )
        self.prompt_embeddings = tuple(
            _as_vector(
                matrix[index],
                expected_dimension=expected_dimension,
                context="CLIP category",
                error_code="recognition.category_unavailable",
            )
            for index in range(len(self.taxonomy))
        )

    def classify(self, embedding: EmbeddingResult) -> list[CategoryLabel]:
        if embedding.model_revision != self.model_revision:
            raise _unavailable(
                "recognition.category_unavailable",
                "The category input belongs to a different model revision.",
            )
        image_vector = _as_vector(
            embedding.vector,
            expected_dimension=self.expected_dimension,
            context="CLIP image",
            error_code="recognition.category_unavailable",
        )
        scored: list[tuple[CategoryDefinition, float]] = []
        for category, prompt_vector in zip(self.taxonomy, self.prompt_embeddings, strict=True):
            cosine = float(np.dot(image_vector, prompt_vector))
            score = min(1.0, max(0.0, (cosine + 1.0) / 2.0))
            scored.append((category, score))
        scored.sort(key=lambda item: (-item[1], item[0].label))
        return [CategoryLabel(label=category.label, score=score) for category, score in scored[:5]]


def model_files_exist(model_directory: Path, model: RuntimeManifestModel) -> bool:
    root = model_directory / model.id
    return all((root / file.path).is_file() for file in model.files)
