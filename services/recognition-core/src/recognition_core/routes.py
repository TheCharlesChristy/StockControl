"""HTTP surface, specification section 9.1.

Every response is built from bytes this process decoded and validated
itself; nothing here trusts a client-declared content type, array length, or
crop box beyond what the response contracts already bound.
"""

from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from recognition_core.backend import Backends
from recognition_core.barcode import decode_barcodes
from recognition_core.config import Settings
from recognition_core.contracts import (
    AnalyseSessionResponse,
    BarcodeObservation,
    CategoryLabel,
    EmbeddingResult,
    OcrLine,
    PhotoResult,
    RenderExemplarResponse,
    StageAvailability,
)
from recognition_core.errors import ModelUnavailableError, RecognitionCoreError
from recognition_core.exemplar import render_crop
from recognition_core.identifier_parser import parse_identifiers
from recognition_core.image_pipeline import DecodedImage, decode_image
from recognition_core.quality import compute_quality, generate_crops

# request_id is opaque and merely echoed back for the caller's own
# correlation (section 9.1: duplicate request IDs are safe because this
# service is stateless) — bounded so a caller cannot use it to smuggle a
# large payload into a log line.
_MAX_REQUEST_ID_LENGTH = 200


async def _read_bounded(upload: UploadFile, limit: int, code: str) -> bytes:
    # Reads at most limit+1 bytes so an oversized upload is rejected without
    # first buffering the whole thing into memory.
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=422, detail=code)
    return data


def _decode_or_422(data: bytes, settings: Settings) -> DecodedImage:
    try:
        return decode_image(
            data,
            max_source_bytes=settings.max_source_bytes,
            max_source_pixels=settings.max_source_pixels,
        )
    except RecognitionCoreError as error:
        raise HTTPException(status_code=422, detail=error.code) from error


def _run_barcode_stage(decoded: DecodedImage) -> tuple[StageAvailability, list[BarcodeObservation]]:
    try:
        return StageAvailability.SUCCEEDED, decode_barcodes(decoded.pixels)
    except Exception:
        # zxing-cpp is a native binding this process does not fully control;
        # one photo's decode failure must not fail the whole session.
        return StageAvailability.FAILED, []


def _run_ocr_stage(
    decoded: DecodedImage, backends: Backends
) -> tuple[StageAvailability, list[OcrLine]]:
    try:
        return StageAvailability.SUCCEEDED, backends.ocr.recognise_text(decoded.pixels)
    except ModelUnavailableError:
        return StageAvailability.UNAVAILABLE, []


def _run_embedding_stage(
    decoded: DecodedImage, backends: Backends
) -> tuple[StageAvailability, EmbeddingResult | None]:
    try:
        return StageAvailability.SUCCEEDED, backends.embedding.embed_image(decoded.pixels)
    except ModelUnavailableError:
        return StageAvailability.UNAVAILABLE, None


def _run_category_stage(
    embedding: EmbeddingResult | None, backends: Backends
) -> tuple[StageAvailability, list[CategoryLabel]]:
    if embedding is None:
        return StageAvailability.NOT_APPLICABLE, []
    try:
        return StageAvailability.SUCCEEDED, backends.category.classify(embedding)
    except ModelUnavailableError:
        return StageAvailability.UNAVAILABLE, []


def _analyse_photo(ordinal: int, decoded: DecodedImage, backends: Backends) -> PhotoResult:
    barcode_outcome, barcodes = _run_barcode_stage(decoded)
    ocr_outcome, ocr_lines = _run_ocr_stage(decoded, backends)
    identifiers = parse_identifiers([line.text for line in ocr_lines])
    embedding_outcome, embedding = _run_embedding_stage(decoded, backends)
    category_outcome, categories = _run_category_stage(embedding, backends)

    return PhotoResult(
        image_ordinal=ordinal,
        barcode_outcome=barcode_outcome,
        barcodes=barcodes,
        ocr_outcome=ocr_outcome,
        ocr_lines=ocr_lines,
        identifiers=identifiers,
        embedding_outcome=embedding_outcome,
        embedding=embedding,
        category_outcome=category_outcome,
        categories=categories,
        quality=compute_quality(decoded.pixels),
        crops=generate_crops(),
    )


def build_router(
    settings: Settings, backends: Backends, *, model_manifest_version: str
) -> APIRouter:
    router = APIRouter()

    @router.post(
        "/v1/analyse-session", response_model=AnalyseSessionResponse, response_model_by_alias=True
    )
    async def analyse_session(
        request_id: str = Form(..., max_length=_MAX_REQUEST_ID_LENGTH),
        images: list[UploadFile] = File(...),
    ) -> AnalyseSessionResponse:
        if not (1 <= len(images) <= settings.max_images_per_request):
            raise HTTPException(status_code=422, detail="recognition.image_count_invalid")

        photo_results = []
        for ordinal, upload in enumerate(images, start=1):
            data = await _read_bounded(
                upload, settings.max_source_bytes, "recognition.image_too_large"
            )
            decoded = _decode_or_422(data, settings)
            photo_results.append(_analyse_photo(ordinal, decoded, backends))

        return AnalyseSessionResponse(
            request_id=request_id,
            model_manifest_version=model_manifest_version,
            photo_results=photo_results,
        )

    @router.post("/v1/render-exemplar")
    async def render_exemplar(
        x: float = Form(..., ge=0.0, le=1.0),
        y: float = Form(..., ge=0.0, le=1.0),
        width: float = Form(..., gt=0.0, le=1.0),
        height: float = Form(..., gt=0.0, le=1.0),
        image: UploadFile = File(...),
    ) -> Response:
        if x + width > 1.0 or y + height > 1.0:
            raise HTTPException(status_code=422, detail="recognition.crop_out_of_bounds")

        data = await _read_bounded(image, settings.max_source_bytes, "recognition.image_too_large")
        decoded = _decode_or_422(data, settings)

        webp_bytes, width_px, height_px = render_crop(
            decoded.pixels, x=x, y=y, width=width, height=height
        )
        metadata = RenderExemplarResponse(
            width=width_px, height=height_px, byte_length=len(webp_bytes)
        )
        return Response(
            content=webp_bytes,
            media_type=metadata.media_type,
            headers={
                "X-Recognition-Width": str(metadata.width),
                "X-Recognition-Height": str(metadata.height),
            },
        )

    return router
