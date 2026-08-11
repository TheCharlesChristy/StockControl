"""Server barcode fallback tests, specification section 7.4."""

from __future__ import annotations

import numpy as np
import zxingcpp

from recognition_core.barcode import decode_barcodes
from recognition_core.contracts import BarcodeSymbology


def _render_barcode_pixels(text: str, barcode_format: zxingcpp.BarcodeFormat) -> np.ndarray:
    encoded = zxingcpp.write_barcode(barcode_format, text)
    return np.asarray(encoded)


def _code128_pixels(text: str) -> np.ndarray:
    return _render_barcode_pixels(text, zxingcpp.BarcodeFormat.Code128)


def test_decodes_a_straight_code128_barcode() -> None:
    pixels = _code128_pixels("012345")

    observations = decode_barcodes(pixels)

    assert len(observations) == 1
    assert observations[0].value == "012345"
    assert observations[0].symbology == BarcodeSymbology.CODE_128


def test_decodes_a_barcode_rotated_ninety_degrees() -> None:
    pixels = _code128_pixels("987654")
    rotated = np.ascontiguousarray(np.rot90(pixels, k=-1))

    observations = decode_barcodes(rotated)

    assert len(observations) == 1
    assert observations[0].value == "987654"


def test_returns_nothing_for_an_image_with_no_barcode() -> None:
    pixels = np.full((200, 200), 255, dtype=np.uint8)

    assert decode_barcodes(pixels) == []


def test_a_qr_code_is_not_decoded() -> None:
    # QR codes carry arbitrary text and are deliberately excluded — that
    # path belongs to the browser's authorised internal-URL resolution, not
    # to free-form barcode evidence (section 7.2's PRODUCT_CODE_SYMBOLOGIES).
    pixels = _render_barcode_pixels(
        "https://example.com/not-a-product", zxingcpp.BarcodeFormat.QRCode
    )

    assert decode_barcodes(pixels) == []
