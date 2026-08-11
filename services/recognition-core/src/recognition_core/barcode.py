"""Server-side barcode fallback, specification section 7.4.

The browser already tried `BarcodeDetector` and `zxing-wasm` on the original
image before any upload; this is the second attempt, over the normalised
image plus deterministic rotation/contrast variants, for the codes the
browser's pass missed. It reports every decode as raw evidence — validation,
check digits, and the exact-match decision all happen in the worker and the
API, never here. A server exact match is real work saved, but the person
still confirms.
"""

from __future__ import annotations

import numpy as np
import zxingcpp

from recognition_core.contracts import BarcodeObservation, BarcodeSymbology

# zxing-cpp's own format enum is far broader than the symbologies StockControl
# treats as product identifiers (spec section 7.2's `PRODUCT_CODE_SYMBOLOGIES`).
# A QR code is deliberately excluded: it can carry arbitrary text, and that
# path belongs to the browser's authorised internal-URL resolution, not to
# free-form barcode evidence.
_FORMAT_TO_SYMBOLOGY: dict[zxingcpp.BarcodeFormat, BarcodeSymbology] = {
    zxingcpp.BarcodeFormat.EAN8: BarcodeSymbology.EAN_8,
    zxingcpp.BarcodeFormat.EAN13: BarcodeSymbology.EAN_13,
    zxingcpp.BarcodeFormat.UPCA: BarcodeSymbology.UPC_A,
    zxingcpp.BarcodeFormat.UPCE: BarcodeSymbology.UPC_E,
    zxingcpp.BarcodeFormat.ITF: BarcodeSymbology.ITF,
    zxingcpp.BarcodeFormat.Code128: BarcodeSymbology.CODE_128,
    zxingcpp.BarcodeFormat.Code39: BarcodeSymbology.CODE_39,
    zxingcpp.BarcodeFormat.DataBar: BarcodeSymbology.DATA_BAR,
}


def _read_formats() -> zxingcpp.BarcodeFormats:
    formats_iterator = iter(_FORMAT_TO_SYMBOLOGY)
    combined = zxingcpp.BarcodeFormats(next(formats_iterator))
    for barcode_format in formats_iterator:
        combined = combined | barcode_format
    return combined


_READ_FORMATS = _read_formats()

# Deterministic variants, not an open-ended search: the four 90-degree
# rotations catch a sideways or upside-down label without the combinatorial
# cost of trying arbitrary angles.
_ROTATIONS = (0, 90, 180, 270)


def _rotated(pixels: np.ndarray, degrees: int) -> np.ndarray:
    if degrees == 0:
        return pixels
    # k counts 90-degree counter-clockwise turns; negate for a clockwise
    # degrees value so "90" reads as "rotate the photo 90 degrees clockwise".
    return np.ascontiguousarray(np.rot90(pixels, k=-(degrees // 90)))


def decode_barcodes(pixels: np.ndarray) -> list[BarcodeObservation]:
    """Runs every rotation variant and returns the union of distinct decoded
    values, in the order first seen. Bounded to five, matching the evidence
    cap every other stage in this pipeline uses."""

    seen: dict[tuple[str, BarcodeSymbology], None] = {}

    for degrees in _ROTATIONS:
        variant = _rotated(pixels, degrees)
        results = zxingcpp.read_barcodes(
            variant,
            formats=_READ_FORMATS,
            try_rotate=False,  # the rotation loop above already covers this
        )
        for result in results:
            symbology = _FORMAT_TO_SYMBOLOGY.get(result.format)
            if symbology is None or result.error is not None:
                continue
            key = (result.text, symbology)
            if key not in seen:
                seen[key] = None
        if len(seen) >= 5:
            break

    return [
        BarcodeObservation(value=value, symbology=symbology)
        for value, symbology in list(seen.keys())[:5]
    ]
