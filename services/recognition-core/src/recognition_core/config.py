"""Runtime configuration.

Section 9.1: inference concurrency starts at one session, intra-op threads are
capped at four. Both are read here rather than hard-coded so a Railway
resource change does not need a code change, but the defaults are exactly the
values the specification names.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigurationError(Exception):
    pass


def _read_positive_int(environment: dict[str, str], name: str, default: int) -> int:
    value = environment.get(name, "").strip()
    if value == "":
        return default
    try:
        parsed = int(value)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be a positive integer.") from error
    if parsed < 1:
        raise ConfigurationError(f"{name} must be a positive integer.")
    return parsed


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    inference_concurrency: int
    intra_op_threads: int
    # Directory the build process copied verified local model snapshots into.
    # Never a URL: this service downloads nothing at runtime.
    model_directory: str
    max_images_per_request: int
    max_source_bytes: int
    max_source_pixels: int


DEFAULT_PORT = 8000
DEFAULT_INFERENCE_CONCURRENCY = 1
DEFAULT_INTRA_OP_THREADS = 4
DEFAULT_MAX_IMAGES_PER_REQUEST = 5
DEFAULT_MAX_SOURCE_BYTES = 12 * 1024 * 1024
DEFAULT_MAX_SOURCE_PIXELS = 40_000_000


def load_settings(environment: dict[str, str] | None = None) -> Settings:
    env = environment if environment is not None else dict(os.environ)

    return Settings(
        host=env.get("RECOGNITION_CORE_HOST", "0.0.0.0").strip() or "0.0.0.0",
        port=_read_positive_int(env, "PORT", DEFAULT_PORT),
        inference_concurrency=_read_positive_int(
            env, "RECOGNITION_CORE_CONCURRENCY", DEFAULT_INFERENCE_CONCURRENCY
        ),
        intra_op_threads=_read_positive_int(
            env, "RECOGNITION_CORE_INTRA_OP_THREADS", DEFAULT_INTRA_OP_THREADS
        ),
        model_directory=env.get("RECOGNITION_CORE_MODEL_DIR", "/models").strip() or "/models",
        max_images_per_request=_read_positive_int(
            env, "RECOGNITION_CORE_MAX_IMAGES", DEFAULT_MAX_IMAGES_PER_REQUEST
        ),
        max_source_bytes=_read_positive_int(
            env, "RECOGNITION_CORE_MAX_SOURCE_BYTES", DEFAULT_MAX_SOURCE_BYTES
        ),
        max_source_pixels=_read_positive_int(
            env, "RECOGNITION_CORE_MAX_SOURCE_PIXELS", DEFAULT_MAX_SOURCE_PIXELS
        ),
    )
