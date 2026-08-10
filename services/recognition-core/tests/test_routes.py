"""HTTP surface tests, specification section 9.1.

Exercises the real FastAPI app end to end with real image bytes — no model
weights exist in this environment, so OCR/embedding/category stages are
expected to report `Unavailable`, and the tests assert exactly that rather
than skipping them.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from recognition_core.backend import load_backends
from recognition_core.config import Settings
from recognition_core.main import create_app


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "host": "0.0.0.0",
        "port": 8000,
        "inference_concurrency": 1,
        "intra_op_threads": 4,
        "model_directory": "/models",
        "max_images_per_request": 5,
        "max_source_bytes": 12 * 1024 * 1024,
        "max_source_pixels": 40_000_000,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def _client(**settings_overrides: object) -> TestClient:
    settings = _settings(**settings_overrides)
    app = create_app(settings=settings, backends=load_backends(settings.model_directory))
    return TestClient(app)


def test_analyse_session_returns_one_photo_result_per_image(jpeg_bytes: bytes) -> None:
    client = _client()

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-1"},
        files=[("images", ("a.jpg", jpeg_bytes, "image/jpeg"))],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "req-1"
    assert len(body["photo_results"]) == 1
    photo = body["photo_results"][0]
    assert photo["image_ordinal"] == 1
    assert photo["barcode_outcome"] == "Succeeded"
    assert photo["ocr_outcome"] == "Unavailable"
    assert photo["embedding_outcome"] == "Unavailable"
    assert photo["category_outcome"] == "NotApplicable"
    assert len(photo["crops"]) == 3


def test_analyse_session_handles_multiple_images_independently(jpeg_bytes: bytes) -> None:
    client = _client()

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-2"},
        files=[
            ("images", ("a.jpg", jpeg_bytes, "image/jpeg")),
            ("images", ("b.jpg", jpeg_bytes, "image/jpeg")),
            ("images", ("c.jpg", jpeg_bytes, "image/jpeg")),
        ],
    )

    assert response.status_code == 200
    ordinals = [photo["image_ordinal"] for photo in response.json()["photo_results"]]
    assert ordinals == [1, 2, 3]


def test_analyse_session_rejects_more_images_than_the_configured_limit(jpeg_bytes: bytes) -> None:
    client = _client(max_images_per_request=2)

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-3"},
        files=[
            ("images", ("a.jpg", jpeg_bytes, "image/jpeg")),
            ("images", ("b.jpg", jpeg_bytes, "image/jpeg")),
            ("images", ("c.jpg", jpeg_bytes, "image/jpeg")),
        ],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "recognition.image_count_invalid"


def test_analyse_session_rejects_undecodable_bytes() -> None:
    client = _client()

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-4"},
        files=[("images", ("bad.jpg", b"not an image", "image/jpeg"))],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "recognition.image_undecodable"


def test_analyse_session_rejects_an_oversized_upload_without_buffering_it(
    jpeg_bytes: bytes,
) -> None:
    client = _client(max_source_bytes=10)

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-5"},
        files=[("images", ("a.jpg", jpeg_bytes, "image/jpeg"))],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "recognition.image_too_large"


def test_analyse_session_ignores_a_lying_content_type(jpeg_bytes: bytes) -> None:
    # Section 7.3: never trust a client-declared MIME type. Real JPEG bytes
    # labelled as something else must still decode.
    client = _client()

    response = client.post(
        "/v1/analyse-session",
        data={"request_id": "req-6"},
        files=[("images", ("a.png", jpeg_bytes, "image/png"))],
    )

    assert response.status_code == 200


def test_render_exemplar_returns_a_webp_image(jpeg_bytes: bytes) -> None:
    client = _client()

    response = client.post(
        "/v1/render-exemplar",
        data={"x": "0.1", "y": "0.1", "width": "0.5", "height": "0.5"},
        files=[("image", ("a.jpg", jpeg_bytes, "image/jpeg"))],
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert int(response.headers["x-recognition-width"]) > 0
    assert int(response.headers["x-recognition-height"]) > 0
    assert len(response.content) > 0


def test_render_exemplar_rejects_a_crop_box_outside_the_image(jpeg_bytes: bytes) -> None:
    client = _client()

    response = client.post(
        "/v1/render-exemplar",
        data={"x": "0.6", "y": "0.6", "width": "0.6", "height": "0.6"},
        files=[("image", ("a.jpg", jpeg_bytes, "image/jpeg"))],
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "recognition.crop_out_of_bounds"


def test_render_exemplar_rejects_undecodable_bytes() -> None:
    client = _client()

    response = client.post(
        "/v1/render-exemplar",
        data={"x": "0.0", "y": "0.0", "width": "1.0", "height": "1.0"},
        files=[("image", ("bad.jpg", b"garbage", "image/jpeg"))],
    )

    assert response.status_code == 422


def test_health_live_is_always_ok() -> None:
    client = _client()

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_ready_reports_not_ready_without_real_weights() -> None:
    client = _client()

    response = client.get("/health/ready")

    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}


def test_no_public_api_docs_are_exposed() -> None:
    client = _client()

    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404
