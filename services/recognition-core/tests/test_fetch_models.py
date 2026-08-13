"""Tests for the build-time model fetcher.

`scripts/` sits outside the installed `recognition_core` package on purpose
(specification section 20: it must never ship in the runtime image), so this
test imports it by file path rather than as a package.
"""

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
    # dataclasses resolves postponed (`from __future__ import annotations`)
    # type hints via sys.modules, so the module must be registered before
    # its body — which defines the dataclasses — actually runs.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


fetch_models = _load_fetch_models()


def test_an_empty_models_list_is_a_no_op(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    manifest = fetch_models.Manifest(schema_version=1, models=())

    fetch_models.fetch_all(manifest, tmp_path)

    assert list(tmp_path.iterdir()) == []
    assert "nothing to fetch" in capsys.readouterr().out


def test_the_output_directory_is_created_even_when_there_is_nothing_to_fetch(
    tmp_path: Path,
) -> None:
    # The image build COPYs this directory verbatim into the runtime stage;
    # that COPY needs a source to exist even for an empty fixture manifest.
    manifest = fetch_models.Manifest(schema_version=1, models=())
    output_dir = tmp_path / "models"
    assert not output_dir.exists()

    fetch_models.fetch_all(manifest, output_dir)

    assert output_dir.is_dir()


def test_loads_a_real_manifest_file(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    manifest_path.write_text(
        json.dumps(
            {
                "schemaVersion": 1,
                "models": [
                    {
                        "id": "example",
                        "description": "An example model.",
                        "repoId": "example-org/example-model",
                        "revision": "abc123",
                        "licence": "Apache-2.0",
                        "preprocessingId": "example-v1",
                        "files": [{"path": "weights.onnx", "sha256": "a" * 64}],
                    }
                ],
            }
        )
    )

    manifest = fetch_models.load_manifest(manifest_path)

    assert manifest.schema_version == 1
    assert len(manifest.models) == 1
    assert manifest.models[0].id == "example"
    assert manifest.models[0].files[0].sha256 == "a" * 64


def test_rejects_a_missing_manifest_file(tmp_path: Path) -> None:
    with pytest.raises(fetch_models.ManifestError):
        fetch_models.load_manifest(tmp_path / "does-not-exist.json")


def test_rejects_malformed_json(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    manifest_path.write_text("not json")

    with pytest.raises(fetch_models.ManifestError):
        fetch_models.load_manifest(manifest_path)


def test_rejects_an_unsupported_schema_version(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    manifest_path.write_text(json.dumps({"schemaVersion": 2, "models": []}))

    with pytest.raises(fetch_models.ManifestError):
        fetch_models.load_manifest(manifest_path)


def test_resolves_a_huggingface_style_url() -> None:
    url = fetch_models._resolve_url("example-org/example-model", "abc123", "weights.onnx")

    assert url == "https://huggingface.co/example-org/example-model/resolve/abc123/weights.onnx"


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
    expected_sha256 = hashlib.sha256(payload).hexdigest()
    destination = tmp_path / "weights.onnx"

    monkeypatch.setattr(fetch_models.urllib.request, "urlopen", _fake_urlopen(payload))

    fetch_models._download_and_verify(
        "https://example.invalid/weights.onnx", destination, expected_sha256
    )

    assert destination.read_bytes() == payload
    assert not destination.with_suffix(destination.suffix + ".partial").exists()


def test_download_and_verify_rejects_a_checksum_mismatch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = b"pretend model weights"
    destination = tmp_path / "weights.onnx"

    monkeypatch.setattr(fetch_models.urllib.request, "urlopen", _fake_urlopen(payload))

    with pytest.raises(fetch_models.ManifestError):
        fetch_models._download_and_verify(
            "https://example.invalid/weights.onnx", destination, "0" * 64
        )

    assert not destination.exists()
    assert not destination.with_suffix(destination.suffix + ".partial").exists()


def _fake_urlopen(payload: bytes) -> Callable[[str], AbstractContextManager[io.BytesIO]]:
    @contextmanager
    def opener(url: str) -> Iterator[io.BytesIO]:
        yield io.BytesIO(payload)

    return opener


def test_main_with_an_empty_manifest_exits_zero(tmp_path: Path) -> None:
    manifest_path = tmp_path / "manifest.lock.json"
    manifest_path.write_text(json.dumps({"schemaVersion": 1, "models": []}))
    output_dir = tmp_path / "models"

    exit_code = fetch_models.main(["--manifest", str(manifest_path), "--output", str(output_dir)])

    assert exit_code == 0


def test_main_with_a_missing_manifest_exits_nonzero(tmp_path: Path) -> None:
    exit_code = fetch_models.main(
        ["--manifest", str(tmp_path / "missing.json"), "--output", str(tmp_path / "models")]
    )

    assert exit_code == 1
