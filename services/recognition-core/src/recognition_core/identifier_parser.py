"""The deterministic parser, specification section 7.5.

Extracts candidate values from OCR text without asking a model to decide
identity. Every function here is pure: given the same lines of recognised
text, it returns the same candidates, which is what makes it possible to test
against fixed text fixtures rather than photographs and weights this session
does not have.

The one rule everything below exists to protect: a number is never treated as
a stock quantity. A labelled pack count is kept as evidence, and even that is
never carried into the receipt field automatically — the person types the
quantity they counted, not whatever a label printed.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from recognition_core.contracts import ParsedIdentifiers, VariantAttribute

MAX_CANDIDATES = 5
MAX_VARIANTS = 8

# Legal-form and generic distributor words that would otherwise be read as
# part of a manufacturer name. Kept short and specific: a false negative here
# is only a missed hint, but a false positive can merge two manufacturers.
_LEGAL_FORM_SUFFIXES = re.compile(
    r"\b(LTD|LIMITED|LLC|INC|INCORPORATED|PLC|GMBH|CO|CORP|SA|SAS|AG|BV)\.?\b", re.IGNORECASE
)

# A part/model/SKU token: at least one letter and one digit, 3-24 characters,
# hyphens and slashes allowed as printed separators. Deliberately does not
# match a bare number (that is pack-quantity or dimension territory, handled
# separately) or a bare word (that is a name fragment).
_PART_NUMBER_PATTERN = re.compile(
    r"\b(?=[A-Z0-9\-/]{3,24}\b)(?=[A-Z0-9\-/]*[A-Z])(?=[A-Z0-9\-/]*[0-9])[A-Z0-9\-/]{3,24}\b"
)

# GTIN-shaped runs of 8, 12, 13 or 14 digits. Validated against a real check
# digit downstream (packages/modules/stock-capture on the TypeScript side);
# this parser only proposes candidates, it does not decide validity.
_BARCODE_LIKE_PATTERN = re.compile(r"\b\d{8}\b|\b\d{12,14}\b")

# Explicit unit markers only. "50 mm" is a dimension; a bare "50" beside a
# part number is not read as anything, because a marker-free number is
# exactly the ambiguous case section 7.5 says must not become a variant, let
# alone a quantity.
#
# Single-letter units (m, l, v, w, a, g) require a space before them. Without
# one, a part number's trailing revision letter reads as a unit: "RS-1234A"
# would otherwise parse as "1234 a" (amps). Multi-letter units are unambiguous
# enough to allow the no-space form real labels print ("50mm").
_DIMENSION_PATTERN = re.compile(
    r"\b(\d+(?:\.\d+)?)\s?(mm|cm|inch|in|kg|ml)\b"
    r"|\b(\d+(?:\.\d+)?)\s+(m|l|v|w|a|g)\b",
    re.IGNORECASE,
)

_COLOUR_WORDS = frozenset(
    {
        "black",
        "white",
        "red",
        "blue",
        "green",
        "yellow",
        "grey",
        "gray",
        "silver",
        "brass",
        "chrome",
        "bronze",
    }
)

# "Pack of 10", "10 pack", "10 x", "qty 10" — an explicit marker, not a bare
# number. This is the one place a quantity-shaped number is allowed to
# surface at all, and only ever as `labelled_pack_quantity`, kept apart from
# every other identifier list.
_PACK_QUANTITY_PATTERN = re.compile(
    r"\b(?:pack of|qty|quantity)\s*[:.]?\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:x|pack|pcs|pieces)\b",
    re.IGNORECASE,
)

_WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z'&-]{1,30}")


@dataclass
class _Accumulator:
    manufacturer_tokens: list[str] = field(default_factory=list)
    name_fragments: list[str] = field(default_factory=list)
    part_number_candidates: list[str] = field(default_factory=list)
    barcode_like_candidates: list[str] = field(default_factory=list)
    variant_attributes: list[VariantAttribute] = field(default_factory=list)
    labelled_pack_quantity: str | None = None


def _add_unique(target: list[str], value: str, limit: int) -> None:
    if value not in target and len(target) < limit:
        target.append(value)


def _parse_line(line: str, accumulator: _Accumulator) -> None:
    stripped = line.strip()
    if stripped == "":
        return

    for match in _BARCODE_LIKE_PATTERN.finditer(stripped):
        _add_unique(accumulator.barcode_like_candidates, match.group(0), MAX_CANDIDATES)

    for match in _PART_NUMBER_PATTERN.finditer(stripped.upper()):
        candidate = match.group(0)
        # A run already captured as a barcode-like candidate is not also a
        # part number — the two lists exist so a caller can tell which query
        # to run, and a pure digit run only ever supports the barcode query.
        if candidate.isdigit():
            continue
        _add_unique(accumulator.part_number_candidates, candidate, MAX_CANDIDATES)

    for match in _DIMENSION_PATTERN.finditer(stripped):
        if len(accumulator.variant_attributes) >= MAX_VARIANTS:
            break
        number = match.group(1) or match.group(3)
        unit = match.group(2) or match.group(4)
        value = f"{number} {unit.lower()}"
        accumulator.variant_attributes.append(VariantAttribute(label="dimension", value=value))

    for word in _WORD_PATTERN.findall(stripped):
        lowered = word.lower()
        if lowered in _COLOUR_WORDS and len(accumulator.variant_attributes) < MAX_VARIANTS:
            accumulator.variant_attributes.append(
                VariantAttribute(label="colour", value=lowered.capitalize())
            )

    if accumulator.labelled_pack_quantity is None:
        pack_match = _PACK_QUANTITY_PATTERN.search(stripped)
        if pack_match is not None:
            accumulator.labelled_pack_quantity = pack_match.group(1) or pack_match.group(2)

    # A line the legal-form pattern matches, once stripped of that suffix, is
    # read as a manufacturer token; anything else becomes a name fragment.
    # This is a heuristic, not a claim of correctness — the fusion stage in
    # the worker treats it as one weak signal among several, and a person
    # confirms the final identity regardless.
    legal_form_match = _LEGAL_FORM_SUFFIXES.search(stripped)
    if legal_form_match is not None:
        manufacturer = _LEGAL_FORM_SUFFIXES.sub("", stripped).strip(" .,")
        if manufacturer != "":
            _add_unique(accumulator.manufacturer_tokens, manufacturer, MAX_CANDIDATES)
        return

    if not _BARCODE_LIKE_PATTERN.fullmatch(stripped):
        _add_unique(accumulator.name_fragments, stripped, MAX_CANDIDATES)


def parse_identifiers(ocr_lines: list[str]) -> ParsedIdentifiers:
    """Parses recognised text lines into candidate identifiers and variants.

    Order-preserving and bounded: at most five of each identifier kind and
    eight variant attributes, matching the caps every other stage in this
    pipeline uses so one label with unusually dense text cannot dominate the
    response.
    """

    accumulator = _Accumulator()
    for line in ocr_lines:
        _parse_line(line, accumulator)

    return ParsedIdentifiers(
        manufacturer_tokens=accumulator.manufacturer_tokens,
        name_fragments=accumulator.name_fragments,
        part_number_candidates=accumulator.part_number_candidates,
        barcode_like_candidates=accumulator.barcode_like_candidates,
        variant_attributes=accumulator.variant_attributes,
        labelled_pack_quantity=accumulator.labelled_pack_quantity,
    )
