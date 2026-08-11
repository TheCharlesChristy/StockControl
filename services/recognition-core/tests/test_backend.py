"""The ML seam has no real weights in this environment (specification
section 20's S0 gates are unmet). These tests pin the honest, currently
correct behaviour: every stage is unavailable, and `all_loaded` says so.
"""

from __future__ import annotations

import numpy as np
import pytest

from recognition_core.backend import load_backends
from recognition_core.contracts import EmbeddingResult
from recognition_core.errors import ModelUnavailableError


def test_every_stage_is_unavailable_without_real_weights() -> None:
    backends = load_backends("/models")

    assert backends.all_loaded is False

    with pytest.raises(ModelUnavailableError):
        backends.ocr.recognise_text(np.zeros((4, 4, 3), dtype=np.uint8))

    with pytest.raises(ModelUnavailableError):
        backends.embedding.embed_image(np.zeros((4, 4, 3), dtype=np.uint8))


def test_category_backend_is_unavailable_given_any_embedding() -> None:
    backends = load_backends("/models")
    embedding = EmbeddingResult(model_revision="test", vector=[0.1, 0.2])

    with pytest.raises(ModelUnavailableError):
        backends.category.classify(embedding)
