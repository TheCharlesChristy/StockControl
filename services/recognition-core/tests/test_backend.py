"""CLIP adapter and backend-orchestration contract tests.

The fake encoder here tests image conversion, validation, category caching, and
orchestration only. It is not evidence about real CLIP weights, accuracy,
latency, memory usage, or downloaded-model compatibility.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from recognition_core.backend import load_backends
from recognition_core.category_taxonomy import CategoryDefinition
from recognition_core.clip_backend import ClipCategoryBackend, ClipEmbeddingBackend
from recognition_core.contracts import EmbeddingResult
from recognition_core.errors import ModelUnavailableError
from recognition_core.runtime_manifest import RuntimeManifestFile, RuntimeManifestModel

MODEL_REVISION = "example-org/clip@" + "a" * 40 + "#clip-vit-b-32-v1"


def _metadata(model_id: str = "clip") -> RuntimeManifestModel:
    return RuntimeManifestModel(
        id=model_id,
        description="synthetic test model",
        repo_id="example-org/clip",
        revision="a" * 40,
        licence="review-required",
        preprocessing_id="clip-vit-b-32-v1",
        files=(
            # This file is only a declared fixture path, never model weights.
            RuntimeManifestFile("snapshot/config.json", "b" * 64),
        ),
    )


class FakeEncoder:
    def __init__(self, output: object) -> None:
        self.output = output
        self.calls: list[dict[str, Any]] = []

    def encode(
        self,
        sentences: Sequence[object],
        *,
        normalize_embeddings: bool,
        convert_to_numpy: bool,
        show_progress_bar: bool,
    ) -> object:
        self.calls.append(
            {
                "sentences": sentences,
                "normalize_embeddings": normalize_embeddings,
                "convert_to_numpy": convert_to_numpy,
                "show_progress_bar": show_progress_bar,
            }
        )
        return self.output


def test_empty_manifest_keeps_ocr_embedding_and_category_unavailable(tmp_path: Path) -> None:
    (tmp_path / "manifest.runtime.json").write_text(
        json.dumps(
            {
                "manifestVersion": "sha256:" + "0" * 64,
                "schemaVersion": 1,
                "models": [],
            }
        )
    )
    backends = load_backends(str(tmp_path))

    assert backends.all_loaded is False
    with pytest.raises(ModelUnavailableError):
        backends.embedding.embed_image(np.zeros((4, 4, 3), dtype=np.uint8))
    with pytest.raises(ModelUnavailableError):
        backends.category.classify(EmbeddingResult(model_revision="synthetic", vector=[1.0]))


def test_missing_clip_files_leave_both_model_stages_unavailable(tmp_path: Path) -> None:
    metadata = _metadata()
    (tmp_path / "manifest.runtime.json").write_text(
        json.dumps(
            {
                "manifestVersion": "sha256:" + "0" * 64,
                "schemaVersion": 1,
                "models": [
                    {
                        "id": metadata.id,
                        "description": metadata.description,
                        "repoId": metadata.repo_id,
                        "revision": metadata.revision,
                        "licence": metadata.licence,
                        "preprocessingId": metadata.preprocessing_id,
                        "files": [
                            {"path": file.path, "sha256": file.sha256} for file in metadata.files
                        ],
                    }
                ],
            }
        )
    )
    backends = load_backends(str(tmp_path), model_loader=lambda _: FakeEncoder([[1.0] * 512]))

    assert backends.all_loaded is False
    with pytest.raises(ModelUnavailableError):
        backends.embedding.embed_image(np.zeros((4, 4, 3), dtype=np.uint8))
    with pytest.raises(ModelUnavailableError):
        backends.category.classify(EmbeddingResult(model_revision=MODEL_REVISION, vector=[1.0]))


def test_image_conversion_and_normalisation_use_the_injected_encoder() -> None:
    fake = FakeEncoder([[3.0, 0.0, 0.0]])
    backend = ClipEmbeddingBackend(fake, _metadata(), expected_dimension=3)

    result = backend.embed_image(np.array([[[1], [2]], [[3], [4]]], dtype=np.uint8))

    assert result.model_revision == MODEL_REVISION
    assert result.vector == [1.0, 0.0, 0.0]
    assert fake.calls[0]["normalize_embeddings"] is True
    image = fake.calls[0]["sentences"][0]
    assert image.mode == "RGB"
    assert image.size == (2, 2)


@pytest.mark.parametrize(
    "output",
    [[], [[1.0, 2.0]], [[0.0, 0.0, 0.0]], [[float("nan"), 0.0, 0.0]], [[float("inf"), 0.0, 0.0]]],
)
def test_invalid_dimensions_zero_and_nonfinite_encoder_output_is_unavailable(
    output: object,
) -> None:
    backend = ClipEmbeddingBackend(FakeEncoder(output), _metadata(), expected_dimension=3)

    with pytest.raises(ModelUnavailableError):
        backend.embed_image(np.zeros((2, 2, 3), dtype=np.uint8))


def test_category_prompts_are_encoded_once_and_scores_are_bounded_and_ordered() -> None:
    taxonomy = (
        CategoryDefinition("one", "one", "prompt one"),
        CategoryDefinition("two", "two", "prompt two"),
        CategoryDefinition("three", "three", "prompt three"),
        CategoryDefinition("four", "four", "prompt four"),
        CategoryDefinition("five", "five", "prompt five"),
        CategoryDefinition("six", "six", "prompt six"),
    )
    fake = FakeEncoder(
        [
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, -1.0, 0.0],
        ]
    )
    backend = ClipCategoryBackend(fake, _metadata(), taxonomy=taxonomy, expected_dimension=3)
    embedding = EmbeddingResult(model_revision=MODEL_REVISION, vector=[1.0, 0.0, 0.0])

    first = backend.classify(embedding)
    second = backend.classify(embedding)

    assert len(fake.calls) == 1
    assert len(first) == 5
    assert first == second
    assert [entry.label for entry in first[:2]] == ["one", "two"]
    assert all(0.0 <= entry.score <= 1.0 for entry in first)


def test_category_rejects_an_embedding_from_a_different_revision() -> None:
    backend = ClipCategoryBackend(
        FakeEncoder([[1.0, 0.0, 0.0]]),
        _metadata(),
        taxonomy=(CategoryDefinition("one", "one", "prompt one"),),
        expected_dimension=3,
    )

    with pytest.raises(ModelUnavailableError):
        backend.classify(
            EmbeddingResult(model_revision="synthetic-other-revision", vector=[1.0, 0.0, 0.0])
        )


def test_all_loaded_remains_false_even_when_clip_loads(tmp_path: Path) -> None:
    metadata = _metadata()
    model_file = tmp_path / metadata.id / metadata.files[0].path
    model_file.parent.mkdir(parents=True)
    model_file.write_text("synthetic fixture")
    (tmp_path / "manifest.runtime.json").write_text(
        json.dumps(
            {
                "manifestVersion": "sha256:" + "0" * 64,
                "schemaVersion": 1,
                "models": [
                    {
                        "id": metadata.id,
                        "description": metadata.description,
                        "repoId": metadata.repo_id,
                        "revision": metadata.revision,
                        "licence": metadata.licence,
                        "preprocessingId": metadata.preprocessing_id,
                        "files": [
                            {"path": file.path, "sha256": file.sha256} for file in metadata.files
                        ],
                    }
                ],
            }
        )
    )
    fake = FakeEncoder([[1.0] * 512 for _ in range(6)])

    backends = load_backends(str(tmp_path), model_loader=lambda _: fake)

    assert backends.all_loaded is False
