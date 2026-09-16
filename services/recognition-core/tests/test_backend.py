"""The ML seam has no real weights in this environment (specification
section 20's S0 gates are unmet). These tests pin the honest, currently
correct behaviour: every stage is unavailable, and `all_loaded` says so.
"""

from __future__ import annotations

import numpy as np
import pytest

from recognition_core.backend import LoadedModels, OnDemandModels, load_backends
from recognition_core.contracts import EmbeddingResult, OcrLine
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


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


class _FakeOcr:
    def recognise_text(self, pixels: np.ndarray) -> list[OcrLine]:
        del pixels
        return [OcrLine(text="SKU-1", score=0.9, polygon=[(0, 0), (1, 0), (1, 1), (0, 1)])]


class _FakeEmbedding:
    def embed_image(self, pixels: np.ndarray) -> EmbeddingResult:
        del pixels
        return EmbeddingResult(model_revision="test", vector=[1.0])


class _Loader:
    def __init__(self) -> None:
        self.loads = 0
        self.fail = False

    def __call__(self) -> LoadedModels:
        self.loads += 1
        if self.fail:
            raise RuntimeError("out of memory")
        return LoadedModels(ocr=_FakeOcr(), embedding=_FakeEmbedding())


_PIXELS = np.zeros((4, 4, 3), dtype=np.uint8)


def _models(
    loader: _Loader, clock: _FakeClock, released: list[bool], idle_unload_seconds: int = 120
) -> OnDemandModels:
    return OnDemandModels(
        loader,
        idle_unload_seconds=idle_unload_seconds,
        loaded=loader(),
        clock=clock,
        release_memory=lambda: released.append(True),
    )


def test_models_stay_loaded_while_requests_keep_arriving() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released)

    for _ in range(5):
        clock.now += 60
        models.ocr.recognise_text(_PIXELS)
        assert models.unload_if_idle() is False

    assert models.is_loaded
    assert loader.loads == 1


# Railway bills resident memory even when nobody is capturing stock, so the
# weights have to leave memory on their own once the service goes quiet.
def test_models_leave_memory_after_the_idle_period() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released)

    clock.now += 119
    assert models.unload_if_idle() is False
    clock.now += 1
    assert models.unload_if_idle() is True

    assert not models.is_loaded
    assert released == [True]


def test_the_next_photograph_after_an_unload_reloads_the_models() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released)
    clock.now += 120
    models.unload_if_idle()

    lines = models.ocr.recognise_text(_PIXELS)
    embedding = models.embedding.embed_image(_PIXELS)

    assert [line.text for line in lines] == ["SKU-1"]
    assert embedding.vector == [1.0]
    assert loader.loads == 2


def test_models_are_never_unloaded_part_way_through_a_request() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released)

    with models.in_use():
        clock.now += 600
        assert models.unload_if_idle() is False

    assert models.is_loaded


def test_zero_idle_seconds_keeps_the_models_loaded_forever() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released, idle_unload_seconds=0)

    clock.now += 1_000_000

    assert models.unload_if_idle() is False
    assert models.is_loaded


def test_a_failed_reload_degrades_the_stage_instead_of_failing_the_request() -> None:
    loader, clock = _Loader(), _FakeClock()
    released: list[bool] = []
    models = _models(loader, clock, released)
    clock.now += 120
    models.unload_if_idle()
    loader.fail = True

    with pytest.raises(ModelUnavailableError):
        models.ocr.recognise_text(_PIXELS)

    loader.fail = False
    assert models.embedding.embed_image(_PIXELS).vector == [1.0]
