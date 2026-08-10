"""Wire shapes for the `/v1/analyse-session` and `/v1/render-exemplar` contract.

Specification section 9.1. Nothing here trusts the caller — the worker sends
bounded image bytes and an opaque request id, and receives observations, not
decisions. This service does not know what an item is, does not see catalogue
rows, and never receives database or bucket credentials.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


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


class BarcodeObservation(BaseModel):
    """A decoded value. Confidence is not reported: a value either decoded
    with a passing check digit or it did not decode at all."""

    model_config = ConfigDict(frozen=True)

    value: str
    symbology: BarcodeSymbology


class OcrLine(BaseModel):
    """One recognised text line, with its polygon in normalised (0-1)
    coordinates so the caller does not need this service's pixel geometry."""

    model_config = ConfigDict(frozen=True)

    text: str = Field(max_length=200)
    score: float = Field(ge=0.0, le=1.0)
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=8)


class VariantAttribute(BaseModel):
    model_config = ConfigDict(frozen=True)

    label: str = Field(max_length=40)
    value: str = Field(max_length=80)


class ParsedIdentifiers(BaseModel):
    """The deterministic parser's output. Section 7.5: numbers are never
    promoted to a stock quantity here, and nothing in this model claims
    identity — the worker's catalogue query and fusion stage do that."""

    model_config = ConfigDict(frozen=True)

    manufacturer_tokens: list[str] = Field(default_factory=list, max_length=5)
    name_fragments: list[str] = Field(default_factory=list, max_length=5)
    part_number_candidates: list[str] = Field(default_factory=list, max_length=5)
    barcode_like_candidates: list[str] = Field(default_factory=list, max_length=5)
    variant_attributes: list[VariantAttribute] = Field(default_factory=list, max_length=8)
    # Evidence only, never promoted to a stock count.
    labelled_pack_quantity: str | None = None


class ImageQuality(BaseModel):
    model_config = ConfigDict(frozen=True)

    blur_score: float = Field(ge=0.0, le=1.0)
    foreground_area_ratio: float = Field(ge=0.0, le=1.0)


class CropBox(BaseModel):
    """A normalised (0-1) box, so it survives independent of pixel geometry."""

    model_config = ConfigDict(frozen=True)

    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    width: float = Field(gt=0.0, le=1.0)
    height: float = Field(gt=0.0, le=1.0)
    label: str = Field(max_length=40)


class EmbeddingResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    model_revision: str
    vector: list[float]


class CategoryLabel(BaseModel):
    model_config = ConfigDict(frozen=True)

    label: str = Field(max_length=60)
    score: float = Field(ge=0.0, le=1.0)


class StageAvailability(str, Enum):
    SUCCEEDED = "Succeeded"
    NOT_APPLICABLE = "NotApplicable"
    UNAVAILABLE = "Unavailable"
    FAILED = "Failed"


class PhotoResult(BaseModel):
    """Everything this service found in one photograph. Independent of every
    other photograph in the session — fan-in happens in the worker."""

    model_config = ConfigDict(frozen=True)

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


class AnalyseSessionResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    request_id: str
    model_manifest_version: str
    photo_results: list[PhotoResult] = Field(min_length=1, max_length=5)


class RenderExemplarResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    media_type: str = "image/webp"
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    byte_length: int = Field(gt=0)
