"""FastAPI application factory, specification section 9.1's health surface.

No public domain is created for this service — the worker reaches it over a
private Railway network — so the interactive API docs are disabled along
with everything else that assumes a public audience.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Response

from recognition_core.backend import Backends, load_backends
from recognition_core.config import Settings, load_settings
from recognition_core.routes import build_router
from recognition_core.runtime_manifest import RuntimeManifestError, load_runtime_manifest


def _read_manifest_version(model_directory: str) -> str:
    try:
        return load_runtime_manifest(
            Path(model_directory) / "manifest.runtime.json"
        ).manifest_version
    except (RuntimeManifestError, OSError):
        # The build always writes this file, including for the empty manifest.
        # A local source checkout without a built /models directory is not a
        # deployable model runtime, so do not present it as one.
        return "unavailable"


def create_app(settings: Settings | None = None, backends: Backends | None = None) -> FastAPI:
    resolved_settings = settings if settings is not None else load_settings()
    resolved_backends = (
        backends if backends is not None else load_backends(resolved_settings.model_directory)
    )
    manifest_version = _read_manifest_version(resolved_settings.model_directory)

    app = FastAPI(title="recognition-core", docs_url=None, redoc_url=None, openapi_url=None)
    app.include_router(
        build_router(resolved_settings, resolved_backends, model_manifest_version=manifest_version)
    )

    @app.get("/health/live")
    async def health_live() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/health/ready")
    async def health_ready(response: Response) -> dict[str, str]:
        if not resolved_backends.all_loaded:
            response.status_code = 503
            return {"status": "not_ready"}
        return {"status": "ok"}

    return app


app = create_app()
