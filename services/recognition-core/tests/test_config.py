"""Runtime configuration tests, specification section 9.1."""

from __future__ import annotations

import pytest

from recognition_core.config import ConfigurationError, load_settings


def test_defaults_match_the_specification() -> None:
    settings = load_settings({})

    assert settings.port == 8000
    assert settings.inference_concurrency == 1
    assert settings.intra_op_threads == 4
    assert settings.model_directory == "/models"
    assert settings.max_images_per_request == 5


def test_railway_port_is_read_from_the_platform_variable() -> None:
    settings = load_settings({"PORT": "9090"})

    assert settings.port == 9090


def test_overrides_are_applied() -> None:
    settings = load_settings(
        {
            "RECOGNITION_CORE_CONCURRENCY": "2",
            "RECOGNITION_CORE_INTRA_OP_THREADS": "8",
            "RECOGNITION_CORE_MODEL_DIR": "/data/models",
            "RECOGNITION_CORE_MAX_IMAGES": "3",
        }
    )

    assert settings.inference_concurrency == 2
    assert settings.intra_op_threads == 8
    assert settings.model_directory == "/data/models"
    assert settings.max_images_per_request == 3


def test_blank_values_fall_back_to_the_default() -> None:
    settings = load_settings({"PORT": "  ", "RECOGNITION_CORE_MODEL_DIR": ""})

    assert settings.port == 8000
    assert settings.model_directory == "/models"


@pytest.mark.parametrize("value", ["not-a-number", "1.5"])
def test_a_non_integer_value_is_rejected(value: str) -> None:
    with pytest.raises(ConfigurationError):
        load_settings({"PORT": value})


def test_zero_is_rejected() -> None:
    with pytest.raises(ConfigurationError):
        load_settings({"RECOGNITION_CORE_CONCURRENCY": "0"})


def test_negative_is_rejected() -> None:
    with pytest.raises(ConfigurationError):
        load_settings({"RECOGNITION_CORE_MAX_IMAGES": "-1"})
