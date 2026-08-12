"""Tests for the standard-library-only build-time model fetcher."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from types import ModuleType

import pytest

_SCRIPT_PATH = Path(__file__).parent.parent / "scripts" / "fetch_models.py"


def _load_fetch_models() -> ModuleType:
    spec = importlib.util.spec_from_file_location("fetch_models", _SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


fetch_models = _load_fetch_models()

VALID_REVISION = "a" * 40
VALID_SHA256 = "b" * 64


def _model(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "id": "example",
        "description": "An example model.",
        "repoId": "example-org/example-model",
        "revision": VALID_REVISION,
        "licence": "review-required",
        "preprocessingId": "example-v1",
        "files": [{"path": "weights.onnx", "sha256": VALID_SHA256}],
    }
    value.update(overrides)
    return value


def _manifest(*models: dict[str, object]) -> dict[str, object]:
    return {"schemaVersion": 1, "models": list(models)}


def _committed_manifest_path() -> Path:
    for parent in Path(__file__).parents:
        candidate = parent / "models" / "manifest.lock.json"
        if candidate.exists():
            return candidate
    raise AssertionError("Could not locate the committed model manifest")


def _write_manifest(path: Path, value: dict[str, object], *, indent: int | None = None) -> None:
    path.write_text(json.dumps(value, indent=indent))


def test_committed_empty_manifest_parses_successfully() -> None:
    manifest = fetch_models.load_manifest(_committed_manifest_path())

    assert manifest.schema_version == 1
    assert manifest.models == ()


def test_empty_manifest_writes_runtime_metadata(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    output_dir = tmp_path / "models"
    fetch_models.fetch_all(fetch_models.Manifest(schema_version=1, models=()), output_dir)

    runtime = json.loads((output_dir / "manifest.runtime.json").read_text())
    assert runtime["schemaVersion"] == 1
    assert runtime["models"] == []
    assert runtime["manifestVersion"].startswith("sha256:")
    assert "nothing to fetch" in capsys.readouterr().out


def test_the_output_directory_is_created_even_when_there_is_nothing_to_fetch(
    tmp_path: Path,
) -> None:
    output_dir = tmp_path / "models"
    fetch_models.fetch_all(fetch_models.Manifest(schema_version=1, models=()), output_dir)
    assert output_dir.is_dir()


def test_loads_a_real_manifest_file_and_maps_json_fields_to_dataclass_fields(
    tmp_path: Path,
) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    payload = _model()
    _write_manifest(manifest_path, _manifest(payload))

    manifest = fetch_models.load_manifest(manifest_path)
    model = manifest.models[0]
    json_to_dataclass = {
        "id": "id",
        "description": "description",
        "repoId": "repo_id",
        "revision": "revision",
        "licence": "licence",
        "preprocessingId": "preprocessing_id",
    }

    for json_name, dataclass_name in json_to_dataclass.items():
        assert getattr(model, dataclass_name) == payload[json_name]
    assert model.files[0].path == payload["files"][0]["path"]  # type: ignore[index]
    assert model.files[0].sha256 == payload["files"][0]["sha256"]  # type: ignore[index]


@pytest.mark.parametrize("field", ["schemaVersion", "models"])
def test_rejects_missing_top_level_required_fields(tmp_path: Path, field: str) -> None:
    payload = _manifest(_model())
    del payload[field]
    path = tmp_path / "manifest.json"
    _write_manifest(path, payload)

    with pytest.raises(fetch_models.ManifestError, match="required"):
        fetch_models.load_manifest(path)


@pytest.mark.parametrize(
    "field",
    ["id", "description", "repoId", "revision", "licence", "preprocessingId", "files"],
)
def test_rejects_missing_model_required_fields(tmp_path: Path, field: str) -> None:
    model = _model()
    del model[field]
    path = tmp_path / "manifest.json"
    _write_manifest(path, _manifest(model))

    with pytest.raises(fetch_models.ManifestError, match="required"):
        fetch_models.load_manifest(path)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schemaVersion", "1"),
        ("models", {}),
        ("id", 1),
        ("description", 1),
        ("repoId", 1),
        ("revision", 1),
        ("licence", 1),
        ("preprocessingId", 1),
        ("files", {}),
    ],
)
def test_rejects_invalid_field_types(tmp_path: Path, field: str, value: object) -> None:
    payload = _manifest(_model())
    if field in {"schemaVersion", "models"}:
        payload[field] = value
    else:
        payload["models"][0][field] = value  # type: ignore[index]
    path = tmp_path / "manifest.json"
    _write_manifest(path, payload)

    with pytest.raises(fetch_models.ManifestError):
        fetch_models.load_manifest(path)


def test_rejects_an_empty_file_list(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(path, _manifest(_model(files=[])))

    with pytest.raises(fetch_models.ManifestError, match="must not be empty"):
        fetch_models.load_manifest(path)


def test_rejects_duplicate_model_ids(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(path, _manifest(_model(), _model(description="second")))

    with pytest.raises(fetch_models.ManifestError, match="Duplicate model id"):
        fetch_models.load_manifest(path)


def test_rejects_duplicate_file_paths_within_one_model(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(
        path,
        _manifest(
            _model(
                files=[
                    {"path": "weights.onnx", "sha256": VALID_SHA256},
                    {"path": "weights.onnx", "sha256": VALID_SHA256},
                ]
            )
        ),
    )

    with pytest.raises(fetch_models.ManifestError, match="Duplicate file path"):
        fetch_models.load_manifest(path)


def test_rejects_duplicate_final_destination_paths(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(
        path,
        _manifest(
            _model(id="visual-a"),
            _model(id="visual-b"),
        ),
    )

    with pytest.raises(fetch_models.ManifestError):
        fetch_models.load_manifest(path)


@pytest.mark.parametrize(
    "file_path",
    ["/weights.onnx", "weights//onnx", "./weights.onnx", "weights/../x", "weights\\x.onnx", ""],
)
def test_rejects_unsafe_relative_paths(tmp_path: Path, file_path: str) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(
        path,
        _manifest(_model(files=[{"path": file_path, "sha256": VALID_SHA256}])),
    )

    with pytest.raises(fetch_models.ManifestError, match="(safe relative path|non-empty)"):
        fetch_models.load_manifest(path)


@pytest.mark.parametrize("sha256", ["A" * 64, "a" * 63, "a" * 65, "not-a-sha"])
def test_rejects_malformed_sha256_values(tmp_path: Path, sha256: str) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(path, _manifest(_model(files=[{"path": "weights.onnx", "sha256": sha256}])))

    with pytest.raises(fetch_models.ManifestError, match="64 lowercase"):
        fetch_models.load_manifest(path)


@pytest.mark.parametrize("revision", ["abc123", "A" * 40, "a" * 39, "a" * 41, "a" * 40 + " "])
def test_rejects_non_immutable_revisions(tmp_path: Path, revision: str) -> None:
    path = tmp_path / "manifest.json"
    _write_manifest(path, _manifest(_model(revision=revision)))

    with pytest.raises(fetch_models.ManifestError, match="immutable"):
        fetch_models.load_manifest(path)


def test_resolves_a_huggingface_style_url() -> None:
    url = fetch_models._resolve_url("example-org/example-model", VALID_REVISION, "weights.onnx")
    assert url == (
        f"https://huggingface.co/example-org/example-model/resolve/{VALID_REVISION}/weights.onnx"
    )


def test_safe_destination_stays_under_the_output_directory(tmp_path: Path) -> None:
    destination = fetch_models._safe_destination(tmp_path, "example", "weights.onnx")
    assert destination == (tmp_path / "example" / "weights.onnx").resolve()


def test_safe_destination_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(fetch_models.ManifestError):
        fetch_models._safe_destination(tmp_path, "example", "../../etc/passwd")


def test_download_and_verify_accepts_a_matching_checksum(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"pretend model weights"
    destination = tmp_path / "weights.onnx"
    monkeypatch.setattr(fetch_models.urllib.request, "urlopen", _fake_urlopen(payload))

    fetch_models._download_and_verify(
        "https://example.invalid/weights.onnx", destination, hashlib.sha256(payload).hexdigest()
    )

    assert destination.read_bytes() == payload
    assert not destination.with_suffix(destination.suffix + ".partial").exists()


def test_download_and_verify_rejects_a_checksum_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    destination = tmp_path / "weights.onnx"
    monkeypatch.setattr(fetch_models.urllib.request, "urlopen", _fake_urlopen(b"payload"))

    with pytest.raises(fetch_models.ManifestError):
        fetch_models._download_and_verify(
            "https://example.invalid/weights.onnx", destination, "0" * 64
        )

    assert not destination.exists()
    assert not destination.with_suffix(destination.suffix + ".partial").exists()


def test_runtime_metadata_is_not_written_after_a_failed_download(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    manifest = fetch_models.Manifest(
        schema_version=1,
        models=(
            fetch_models.ManifestModel(
                id="clip",
                description="synthetic",
                repo_id="example/model",
                revision=VALID_REVISION,
                licence="review-required",
                preprocessing_id="synthetic-v1",
                files=(fetch_models.ManifestFile("weights.onnx", VALID_SHA256),),
            ),
        ),
    )
    monkeypatch.setattr(fetch_models.urllib.request, "urlopen", _fake_urlopen(b"wrong"))

    with pytest.raises(fetch_models.ManifestError):
        fetch_models.fetch_all(manifest, tmp_path / "models")

    assert not (tmp_path / "models" / "manifest.runtime.json").exists()


def test_manifest_version_ignores_source_whitespace(tmp_path: Path) -> None:
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    payload = _manifest(_model())
    _write_manifest(first, payload, indent=2)
    _write_manifest(second, payload, indent=4)

    assert fetch_models.manifest_version(
        fetch_models.load_manifest(first)
    ) == fetch_models.manifest_version(fetch_models.load_manifest(second))


def _fake_urlopen(payload: bytes) -> Callable[[str], AbstractContextManager[io.BytesIO]]:
    @contextmanager
    def opener(url: str) -> Iterator[io.BytesIO]:
        del url
        yield io.BytesIO(payload)

    return opener


def test_main_with_an_empty_manifest_exits_zero(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    _write_manifest(manifest_path, _manifest())
    output_dir = tmp_path / "models"

    exit_code = fetch_models.main(["--manifest", str(manifest_path), "--output", str(output_dir)])

    assert exit_code == 0
    assert (output_dir / "manifest.runtime.json").exists()


def test_main_with_a_missing_manifest_exits_nonzero(tmp_path: Path) -> None:
    exit_code = fetch_models.main(
        ["--manifest", str(tmp_path / "missing.json"), "--output", str(tmp_path / "models")]
    )
    assert exit_code == 1
