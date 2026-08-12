"""Read the verified manifest metadata baked into the runtime image."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_VERSION_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


class RuntimeManifestError(ValueError):
    """The build-generated runtime manifest is missing or malformed."""


@dataclass(frozen=True)
class RuntimeManifestFile:
    path: str
    sha256: str


@dataclass(frozen=True)
class RuntimeManifestModel:
    id: str
    description: str
    repo_id: str
    revision: str
    licence: str
    preprocessing_id: str
    files: tuple[RuntimeManifestFile, ...]


@dataclass(frozen=True)
class RuntimeManifest:
    manifest_version: str
    schema_version: int
    models: tuple[RuntimeManifestModel, ...]


def _object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeManifestError(f"{context} must be an object.")
    return value


def _string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise RuntimeManifestError(f"{context} must be a non-empty string.")
    return value


def load_runtime_manifest(path: Path) -> RuntimeManifest:
    try:
        raw = json.loads(path.read_text())
    except (FileNotFoundError, OSError, json.JSONDecodeError) as error:
        raise RuntimeManifestError(f"Unable to read runtime manifest at {path}.") from error

    root = _object(raw, "Runtime manifest")
    version = _string(root.get("manifestVersion"), "Runtime manifest.manifestVersion")
    if _VERSION_RE.fullmatch(version) is None:
        raise RuntimeManifestError("Runtime manifest.manifestVersion is invalid.")
    schema_version = root.get("schemaVersion")
    if type(schema_version) is not int or schema_version != 1:
        raise RuntimeManifestError("Runtime manifest.schemaVersion is invalid.")
    raw_models = root.get("models")
    if not isinstance(raw_models, list):
        raise RuntimeManifestError("Runtime manifest.models must be an array.")

    models: list[RuntimeManifestModel] = []
    for model_index, raw_model in enumerate(raw_models):
        model = _object(raw_model, f"Runtime manifest.models[{model_index}]")
        raw_files = model.get("files")
        if not isinstance(raw_files, list) or not raw_files:
            raise RuntimeManifestError("Runtime manifest model files must be non-empty.")
        files: list[RuntimeManifestFile] = []
        for file_index, raw_file in enumerate(raw_files):
            file = _object(raw_file, f"Runtime manifest.models[{model_index}].files[{file_index}]")
            files.append(
                RuntimeManifestFile(
                    path=_string(file.get("path"), "Runtime manifest file.path"),
                    sha256=_string(file.get("sha256"), "Runtime manifest file.sha256"),
                )
            )
        models.append(
            RuntimeManifestModel(
                id=_string(model.get("id"), "Runtime manifest model.id"),
                description=_string(model.get("description"), "Runtime manifest model.description"),
                repo_id=_string(model.get("repoId"), "Runtime manifest model.repoId"),
                revision=_string(model.get("revision"), "Runtime manifest model.revision"),
                licence=_string(model.get("licence"), "Runtime manifest model.licence"),
                preprocessing_id=_string(
                    model.get("preprocessingId"), "Runtime manifest model.preprocessingId"
                ),
                files=tuple(files),
            )
        )

    return RuntimeManifest(
        manifest_version=version,
        schema_version=schema_version,
        models=tuple(models),
    )


def model_revision(model: RuntimeManifestModel) -> str:
    return f"{model.repo_id}@{model.revision}#{model.preprocessing_id}"
