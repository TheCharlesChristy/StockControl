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
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

_CHUNK_SIZE = 1024 * 1024


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


def load_manifest(path: Path) -> Manifest:
    try:
        raw = json.loads(path.read_text())
    except FileNotFoundError as error:
        raise ManifestError(f"No manifest at {path}.") from error
    except json.JSONDecodeError as error:
        raise ManifestError(f"{path} is not valid JSON.") from error

    if raw.get("schemaVersion") != 1:
        raise ManifestError("Unsupported manifest schemaVersion.")

    models = []
    for entry in raw.get("models", []):
        files = tuple(
            ManifestFile(path=file_entry["path"], sha256=file_entry["sha256"])
            for file_entry in entry["files"]
        )
        models.append(
            ManifestModel(
                id=entry["id"],
                description=entry["description"],
                repo_id=entry["repoId"],
                revision=entry["revision"],
                licence=entry["licence"],
                preprocessing_id=entry["preprocessingId"],
                files=files,
            )
        )

    return Manifest(schema_version=raw["schemaVersion"], models=tuple(models))


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

    with urllib.request.urlopen(url) as response, open(temporary, "wb") as handle:
        while chunk := response.read(_CHUNK_SIZE):
            digest.update(chunk)
            handle.write(chunk)

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

    if not manifest.models:
        print("manifest.lock.json lists no models; nothing to fetch.")
        return

    for model in manifest.models:
        for file in model.files:
            url = _resolve_url(model.repo_id, model.revision, file.path)
            destination = _safe_destination(output_dir, model.id, file.path)
            print(f"Fetching {model.id}/{file.path} from {url}")
            _download_and_verify(url, destination, file.sha256)


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
