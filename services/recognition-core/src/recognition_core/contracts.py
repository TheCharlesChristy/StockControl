"""Wire shapes for the `/v1/analyse-session` and `/v1/render-exemplar` contract.

Specification section 9.1. Nothing here trusts the caller — the worker sends
bounded image bytes and an opaque request id, and receives observations, not
decisions. This service does not know what an item is, does not see catalogue
rows, and never receives database or bucket credentials.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _WireModel(BaseModel):
    """Base for every model on this contract.

    Python code throughout this service reads and writes the snake_case
    field names below (`populate_by_name`); the JSON wire format is
    camelCase (`alias_generator`), matching every other service contract in
    this repository (packages/contracts). routes.py serialises with
    `by_alias=True` so the two stay in sync rather than by convention alone.
    """

    model_config = ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True)


class BarcodeSymbology(str, Enum):
    """Symbologies this service will attempt to decode.

    Deliberately narrower than everything ZXing-C++ supports. A QR code can
    carry arbitrary text, so it is not treated as a product identifier here —
    the worker's internal-URL resolution is a separate, authorised path.
    """

    EAN_8 = "EAN-8"
    EAN_13 = "EAN-13"
    UPC_A = "UPC-A"
    UPC_E = "UPC-E"
    ITF = "ITF"
    CODE_128 = "Code128"
    CODE_39 = "Code39"
    DATA_BAR = "DataBar"


class BarcodeObservation(_WireModel):
    """A decoded value. Confidence is not reported: a value either decoded
    with a passing check digit or it did not decode at all."""

    value: str
    symbology: BarcodeSymbology


class OcrLine(_WireModel):
    """One recognised text line, with its polygon in normalised (0-1)
    coordinates so the caller does not need this service's pixel geometry."""

    text: str = Field(max_length=200)
    score: float = Field(ge=0.0, le=1.0)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=8)


class VariantAttribute(_WireModel):
    label: str = Field(max_length=40)
    value: str = Field(max_length=80)


class ParsedIdentifiers(_WireModel):
    """The deterministic parser's output. Section 7.5: numbers are never
    promoted to a stock quantity here, and nothing in this model claims
    identity — the worker's catalogue query and fusion stage do that."""

    manufacturer_tokens: list[str] = Field(default_factory=list, max_length=5)
    name_fragments: list[str] = Field(default_factory=list, max_length=5)
    part_number_candidates: list[str] = Field(default_factory=list, max_length=5)
    barcode_like_candidates: list[str] = Field(default_factory=list, max_length=5)
    variant_attributes: list[VariantAttribute] = Field(default_factory=list, max_length=8)
    # Evidence only, never promoted to a stock count.
    labelled_pack_quantity: str | None = None


class ImageQuality(_WireModel):
    blur_score: float = Field(ge=0.0, le=1.0)
    foreground_area_ratio: float = Field(ge=0.0, le=1.0)


class CropBox(_WireModel):
    """A normalised (0-1) box, so it survives independent of pixel geometry."""

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)
    label: str = Field(max_length=40)


class EmbeddingResult(_WireModel):
    model_revision: str
    vector: list[float]


class CategoryLabel(_WireModel):
    label: str = Field(max_length=60)
    score: float = Field(ge=0.0, le=1.0)


class StageAvailability(str, Enum):
    SUCCEEDED = "Succeeded"
    NOT_APPLICABLE = "NotApplicable"
    UNAVAILABLE = "Unavailable"
    FAILED = "Failed"


class PhotoResult(_WireModel):
    """Everything this service found in one photograph. Independent of every
    other photograph in the session — fan-in happens in the worker."""

    image_ordinal: int = Field(ge=1, le=5)
    barcode_outcome: StageAvailability
    barcodes: list[BarcodeObservation] = Field(default_factory=list, max_length=5)
    ocr_outcome: StageAvailability
    ocr_lines: list[OcrLine] = Field(default_factory=list, max_length=64)
    identifiers: ParsedIdentifiers
    embedding_outcome: StageAvailability
    embedding: EmbeddingResult | None = None
    category_outcome: StageAvailability
    categories: list[CategoryLabel] = Field(default_factory=list, max_length=5)
    quality: ImageQuality
    crops: list[CropBox] = Field(default_factory=list, max_length=8)


class AnalyseSessionResponse(_WireModel):
    request_id: str
    model_manifest_version: str
    photo_results: list[PhotoResult] = Field(min_length=1, max_length=5)


class RenderExemplarResponse(_WireModel):
    media_type: str = "image/webp"
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    byte_length: int = Field(gt=0)
