"""Deterministic parser tests, specification section 7.5.

Fixtures are hand-written OCR-line lists rather than photographs: the parser
is pure text-in, structured-candidates-out, so a fixed line list is a
complete and repeatable test of it.
"""

from __future__ import annotations

from recognition_core.contracts import VariantAttribute
from recognition_core.identifier_parser import MAX_CANDIDATES, MAX_VARIANTS, parse_identifiers


def test_reads_a_legal_form_suffix_as_a_manufacturer_token() -> None:
    result = parse_identifiers(["Acme Tools Ltd"])

    assert result.manufacturer_tokens == ["Acme Tools"]
    assert "Acme Tools Ltd" not in result.name_fragments


def test_a_line_without_a_legal_form_suffix_is_a_name_fragment() -> None:
    result = parse_identifiers(["Heavy Duty Widget"])

    assert result.name_fragments == ["Heavy Duty Widget"]
    assert result.manufacturer_tokens == []


def test_reads_an_alphanumeric_token_as_a_part_number_candidate() -> None:
    result = parse_identifiers(["Model: RS-1234A"])

    assert result.part_number_candidates == ["RS-1234A"]


def test_a_pure_digit_run_is_barcode_like_not_a_part_number() -> None:
    result = parse_identifiers(["50123456"])

    assert result.barcode_like_candidates == ["50123456"]
    assert result.part_number_candidates == []


def test_a_pure_barcode_line_is_not_also_a_name_fragment() -> None:
    result = parse_identifiers(["5012345678900"])

    assert result.barcode_like_candidates == ["5012345678900"]
    assert result.name_fragments == []


def test_a_trailing_revision_letter_is_not_read_as_a_unit() -> None:
    # Regression: the unit "a" (amps) used to match with no space, so
    # "RS-1234A" parsed as a 1234-amp dimension instead of a part number.
    result = parse_identifiers(["RS-1234A"])

    assert result.part_number_candidates == ["RS-1234A"]
    assert result.variant_attributes == []


def test_a_spaced_single_letter_unit_is_still_read_as_a_dimension() -> None:
    result = parse_identifiers(["3 A"])

    assert result.variant_attributes == [VariantAttribute(label="dimension", value="3 a")]


def test_a_multi_letter_unit_needs_no_space() -> None:
    result = parse_identifiers(["8mm"])

    assert VariantAttribute(label="dimension", value="8 mm") in result.variant_attributes


def test_a_bare_number_beside_a_part_number_is_not_a_dimension() -> None:
    result = parse_identifiers(["50 RS-1234A"])

    assert result.variant_attributes == []


def test_reads_a_known_colour_word() -> None:
    result = parse_identifiers(["Black"])

    assert result.variant_attributes == [VariantAttribute(label="colour", value="Black")]


def test_a_colour_word_inside_a_longer_word_does_not_match() -> None:
    result = parse_identifiers(["Blacksmith"])

    assert result.variant_attributes == []


def test_pack_of_n_is_read_as_a_labelled_pack_quantity() -> None:
    result = parse_identifiers(["Pack of 10"])

    assert result.labelled_pack_quantity == "10"


def test_n_pack_is_read_as_a_labelled_pack_quantity() -> None:
    result = parse_identifiers(["10 pack"])

    assert result.labelled_pack_quantity == "10"


def test_qty_marker_is_read_as_a_labelled_pack_quantity() -> None:
    result = parse_identifiers(["qty 10"])

    assert result.labelled_pack_quantity == "10"


def test_only_the_first_labelled_pack_quantity_is_kept() -> None:
    result = parse_identifiers(["Pack of 10", "5 x"])

    assert result.labelled_pack_quantity == "10"


def test_a_bare_number_is_never_a_labelled_pack_quantity() -> None:
    result = parse_identifiers(["10"])

    assert result.labelled_pack_quantity is None


def test_manufacturer_tokens_are_deduplicated() -> None:
    result = parse_identifiers(["Acme Ltd", "Acme Ltd"])

    assert result.manufacturer_tokens == ["Acme"]


def test_part_number_candidates_are_deduplicated() -> None:
    result = parse_identifiers(["RS-1234A", "RS-1234A"])

    assert result.part_number_candidates == ["RS-1234A"]


def test_name_fragments_are_bounded_to_the_candidate_cap() -> None:
    lines = [f"Fragment number {i}" for i in range(MAX_CANDIDATES + 5)]

    result = parse_identifiers(lines)

    assert len(result.name_fragments) == MAX_CANDIDATES


def test_variant_attributes_are_bounded_to_the_variant_cap() -> None:
    lines = [f"{i} mm" for i in range(MAX_VARIANTS + 5)]

    result = parse_identifiers(lines)

    assert len(result.variant_attributes) == MAX_VARIANTS


def test_blank_lines_are_ignored() -> None:
    result = parse_identifiers(["", "   ", "Black"])

    assert result.variant_attributes == [VariantAttribute(label="colour", value="Black")]


def test_no_lines_returns_empty_candidates() -> None:
    result = parse_identifiers([])

    assert result.manufacturer_tokens == []
    assert result.name_fragments == []
    assert result.part_number_candidates == []
    assert result.barcode_like_candidates == []
    assert result.variant_attributes == []
    assert result.labelled_pack_quantity is None


def test_a_full_label_produces_every_kind_of_candidate() -> None:
    result = parse_identifiers(
        [
            "Acme Tools Ltd",
            "Model: RS-1234A",
            "50 mm",
            "Black",
            "Pack of 10",
            "5012345678900",
        ]
    )

    assert result.manufacturer_tokens == ["Acme Tools"]
    assert result.part_number_candidates == ["RS-1234A"]
    assert result.barcode_like_candidates == ["5012345678900"]
    assert VariantAttribute(label="dimension", value="50 mm") in result.variant_attributes
    assert VariantAttribute(label="colour", value="Black") in result.variant_attributes
    assert result.labelled_pack_quantity == "10"
