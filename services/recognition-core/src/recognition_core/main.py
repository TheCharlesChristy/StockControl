"""FastAPI application factory, specification section 9.1's health surface.

No public domain is created for this service — the worker reaches it over a
private Railway network — so the interactive API docs are disabled along
with everything else that assumes a public audience.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import FastAPI, Response

from recognition_core.backend import Backends, load_backends
from recognition_core.config import Settings, load_settings
from recognition_core.routes import build_router


def _manifest_version(model_directory: str) -> str:
    path = Path(model_directory) / "manifest.lock.json"
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return "unset"


def create_app(settings: Settings | None = None, backends: Backends | None = None) -> FastAPI:
    resolved_settings = settings if settings is not None else load_settings()
    resolved_backends = (
        backends
        if backends is not None
        else load_backends(
            resolved_settings.model_directory,
            intra_op_threads=resolved_settings.intra_op_threads,
        )
    )
    manifest_version = _manifest_version(resolved_settings.model_directory)

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
