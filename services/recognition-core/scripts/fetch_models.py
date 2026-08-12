"""Fetches model weights at image-build time and verifies every digest.

Specification section 20's S0 gate has not run in this environment — no
consented evaluation set, no hardware to benchmark on — so
`models/manifest.lock.json` currently lists no models, and running this
script is a deliberate no-op. When the S0 promotion workflow adds a reviewed
entry, this script becomes the only thing that downloads it: the runtime
image never makes an outbound request, and nothing here trusts a filename
enough to write outside the output directory.

Not part of the installed `recognition_core` package: this lives under
`scripts/` on purpose, so it is never shipped in the runtime image and never
imported at request time.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath
from typing import Any

_CHUNK_SIZE = 1024 * 1024
_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
_REVISION_RE = re.compile(r"^[0-9a-f]{40}$")


class ManifestError(Exception):
    pass


@dataclass(frozen=True)
class ManifestFile:
    path: str
    sha256: str


@dataclass(frozen=True)
class ManifestModel:
    id: str
    description: str
    repo_id: str
    revision: str
    licence: str
    preprocessing_id: str
    files: tuple[ManifestFile, ...]


@dataclass(frozen=True)
class Manifest:
    schema_version: int
    models: tuple[ManifestModel, ...]


def _required_object(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{context} must be an object.")
    return value


def _required_string(value: Any, field: str, context: str) -> str:
    if not isinstance(value, str):
        raise ManifestError(f"{context}.{field} must be a string.")
    if value.strip() == "":
        raise ManifestError(f"{context}.{field} must be non-empty.")
    return value


def _validate_file_path(value: Any, context: str) -> str:
    path = _required_string(value, "path", context)
    if (
        path.startswith(("/", "\\"))
        or "\\" in path
        or PureWindowsPath(path).drive
        or any(component in ("", ".", "..") for component in path.split("/"))
    ):
        raise ManifestError(f"{context}.path must be a safe relative path.")
    return path


def _validate_sha256(value: Any, context: str) -> str:
    sha256 = _required_string(value, "sha256", context)
    if _SHA256_RE.fullmatch(sha256) is None:
        raise ManifestError(f"{context}.sha256 must be 64 lowercase hexadecimal characters.")
    return sha256


def _reject_unknown_fields(value: dict[str, Any], allowed: set[str], context: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ManifestError(f"{context} has unknown fields: {', '.join(unknown)}.")


def load_manifest(path: Path) -> Manifest:
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as error:
        raise ManifestError(f"No manifest at {path}.") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"{path} is not valid JSON.") from error

    raw_object = _required_object(raw, "Manifest")
    _reject_unknown_fields(raw_object, {"schemaVersion", "models"}, "Manifest")
    missing_top_level = {"schemaVersion", "models"} - set(raw_object)
    if missing_top_level:
        raise ManifestError(
            "Manifest is missing required fields: " + ", ".join(sorted(missing_top_level)) + "."
        )

    schema_version = raw_object.get("schemaVersion")
    if type(schema_version) is not int:
        raise ManifestError("Manifest.schemaVersion must be an integer.")
    if schema_version != 1:
        raise ManifestError("Unsupported manifest schemaVersion.")

    raw_models = raw_object.get("models")
    if not isinstance(raw_models, list):
        raise ManifestError("Manifest.models must be an array.")

    models = []
    model_ids: set[str] = set()
    final_destinations: set[str] = set()
    required_model_fields = {
        "id",
        "description",
        "repoId",
        "revision",
        "licence",
        "preprocessingId",
        "files",
    }
    required_file_fields = {"path", "sha256"}

    for model_index, raw_entry in enumerate(raw_models):
        context = f"Manifest.models[{model_index}]"
        entry = _required_object(raw_entry, context)
        _reject_unknown_fields(entry, required_model_fields, context)

        missing = sorted(required_model_fields - set(entry))
        if missing:
            raise ManifestError(f"{context} is missing required fields: {', '.join(missing)}.")

        model_id = _required_string(entry["id"], "id", context)
        if model_id in model_ids:
            raise ManifestError(f"Duplicate model id: {model_id}.")
        model_ids.add(model_id)
        if (
            "/" in model_id
            or "\\" in model_id
            or model_id in {".", ".."}
            or PureWindowsPath(model_id).drive
        ):
            raise ManifestError(f"{context}.id must be a safe directory name.")

        description = _required_string(entry["description"], "description", context)
        repo_id = _required_string(entry["repoId"], "repoId", context)
        revision = _required_string(entry["revision"], "revision", context)
        if _REVISION_RE.fullmatch(revision) is None:
            raise ManifestError(
                f"{context}.revision must be a 40-character lowercase immutable revision."
            )
        licence = _required_string(entry["licence"], "licence", context)
        preprocessing_id = _required_string(entry["preprocessingId"], "preprocessingId", context)

        raw_files = entry["files"]
        if not isinstance(raw_files, list):
            raise ManifestError(f"{context}.files must be an array.")
        if not raw_files:
            raise ManifestError(f"{context}.files must not be empty.")

        files: list[ManifestFile] = []
        file_paths: set[str] = set()
        for file_index, raw_file in enumerate(raw_files):
            file_context = f"{context}.files[{file_index}]"
            file_entry = _required_object(raw_file, file_context)
            _reject_unknown_fields(file_entry, required_file_fields, file_context)
            missing_file_fields = sorted(required_file_fields - set(file_entry))
            if missing_file_fields:
                raise ManifestError(
                    f"{file_context} is missing required fields: {', '.join(missing_file_fields)}."
                )

            file_path = _validate_file_path(file_entry["path"], file_context)
            if file_path in file_paths:
                raise ManifestError(f"Duplicate file path in {model_id}: {file_path}.")
            file_paths.add(file_path)

            if file_path in final_destinations:
                raise ManifestError(f"Duplicate final destination path: {file_path}.")
            final_destinations.add(file_path)
            files.append(
                ManifestFile(
                    path=file_path,
                    sha256=_validate_sha256(file_entry["sha256"], file_context),
                )
            )

        models.append(
            ManifestModel(
                id=model_id,
                description=description,
                repo_id=repo_id,
                revision=revision,
                licence=licence,
                preprocessing_id=preprocessing_id,
                files=tuple(files),
            )
        )

    return Manifest(schema_version=schema_version, models=tuple(models))


def _manifest_model_to_dict(model: ManifestModel) -> dict[str, Any]:
    return {
        "id": model.id,
        "description": model.description,
        "repoId": model.repo_id,
        "revision": model.revision,
        "licence": model.licence,
        "preprocessingId": model.preprocessing_id,
        "files": [{"path": file.path, "sha256": file.sha256} for file in model.files],
    }


def _manifest_to_dict(manifest: Manifest) -> dict[str, Any]:
    return {
        "schemaVersion": manifest.schema_version,
        "models": [_manifest_model_to_dict(model) for model in manifest.models],
    }


def manifest_version(manifest: Manifest) -> str:
    canonical = json.dumps(
        _manifest_to_dict(manifest), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(canonical).hexdigest()}"


def _write_runtime_metadata(output_dir: Path, manifest: Manifest) -> None:
    metadata = {
        "manifestVersion": manifest_version(manifest),
        **_manifest_to_dict(manifest),
    }
    destination = output_dir / "manifest.runtime.json"
    temporary = destination.with_suffix(destination.suffix + ".partial")
    temporary.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(destination)


def _resolve_url(repo_id: str, revision: str, filename: str) -> str:
    return f"https://huggingface.co/{repo_id}/resolve/{revision}/{filename}"


def _safe_destination(output_dir: Path, model_id: str, file_path: str) -> Path:
    # file_path comes from a reviewed, checked-in manifest, not a request —
    # but a stray ".." is cheap to reject outright rather than trust.
    destination = (output_dir / model_id / file_path).resolve()
    if output_dir.resolve() not in destination.parents:
        raise ManifestError(f"Refusing to write outside the output directory: {file_path}")
    return destination


def _download_and_verify(url: str, destination: Path, expected_sha256: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    temporary = destination.with_suffix(destination.suffix + ".partial")

    try:
        with urllib.request.urlopen(url) as response, open(temporary, "wb") as handle:
            while chunk := response.read(_CHUNK_SIZE):
                digest.update(chunk)
                handle.write(chunk)
    except Exception as error:
        temporary.unlink(missing_ok=True)
        raise ManifestError(f"Download failed for {destination.name}.") from error

    actual_sha256 = digest.hexdigest()
    if actual_sha256 != expected_sha256:
        temporary.unlink(missing_ok=True)
        raise ManifestError(
            f"Checksum mismatch for {destination.name}: "
            f"expected {expected_sha256}, got {actual_sha256}."
        )

    temporary.replace(destination)


def fetch_all(manifest: Manifest, output_dir: Path) -> None:
    # Always created, even empty: the image build COPYs this directory
    # verbatim into the runtime stage, and that COPY needs a source to exist.
    output_dir.mkdir(parents=True, exist_ok=True)

    verified_models: list[ManifestModel] = []
    for model in manifest.models:
        for file in model.files:
            url = _resolve_url(model.repo_id, model.revision, file.path)
            destination = _safe_destination(output_dir, model.id, file.path)
            print(f"Fetching {model.id}/{file.path} from {url}")
            _download_and_verify(url, destination, file.sha256)
        verified_models.append(model)

    if not manifest.models:
        print("manifest.lock.json lists no models; nothing to fetch.")

    _write_runtime_metadata(
        output_dir, Manifest(schema_version=manifest.schema_version, models=tuple(verified_models))
    )


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)

    try:
        manifest = load_manifest(args.manifest)
        fetch_all(manifest, args.output)
    except ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
