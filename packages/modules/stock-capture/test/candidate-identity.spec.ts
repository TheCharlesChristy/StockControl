import { describe, expect, it } from "vitest";

import {
  candidateIdentityKey,
  contradictions,
  identityKeyToString,
  mergeIdentities,
} from "../src/candidate-identity";

describe("candidate identity", () => {
  it("prefers the internal item id the catalogue already resolved", () => {
    expect(
      candidateIdentityKey({ itemId: "item-1", barcode: "5901234123457" }, "fallback"),
    ).toEqual({ kind: "InternalItem", key: "item-1" });
  });

  /*
   * A GTIN is globally unique and check-digit protected; a part number is only
   * unique within one manufacturer, and this catalogue does not enforce it at
   * all. So the barcode decides when both are present.
   */
  it("prefers a GTIN over a manufacturer and part number", () => {
    expect(
      candidateIdentityKey(
        { barcode: "5901234123457", manufacturer: "Acme", partNumber: "AA-100" },
        "fallback",
      ),
    ).toEqual({ kind: "Gtin", key: "05901234123457" });
  });

  it("falls back to manufacturer and part number together", () => {
    expect(
      candidateIdentityKey({ manufacturer: "Acme Ltd", partNumber: "rs-1234/a" }, "fallback"),
    ).toEqual({ kind: "ManufacturerPart", key: "ACME RS1234A" });
  });

  /* Section 7.10 step 1: name alone cannot merge two candidates. */
  it("refuses to group on a name, so two variants stay separate", () => {
    const left = candidateIdentityKey({ name: "M10 Hex Bolt" }, "first");
    const right = candidateIdentityKey({ name: "M10 Hex Bolt" }, "second");

    expect(left.kind).toBe("Unmergeable");
    expect(identityKeyToString(left)).not.toBe(identityKeyToString(right));
  });

  it("ignores a part number with no manufacturer beside it", () => {
    expect(candidateIdentityKey({ partNumber: "AA-100" }, "fallback").kind).toBe("Unmergeable");
  });

  it("ignores a barcode that fails its check digit", () => {
    expect(candidateIdentityKey({ barcode: "5901234123458" }, "fallback").kind).toBe("Unmergeable");
  });
});

describe("contradictions", () => {
  it("finds nothing when one side simply knows less", () => {
    expect(contradictions({ partNumber: "AA-100" }, { name: "Hex bolt" })).toEqual([]);
  });

  it("reports a disagreeing part number", () => {
    expect(contradictions({ partNumber: "AA-100" }, { partNumber: "AA-999" })).toEqual([
      { field: "partNumber" },
    ]);
  });

  it("does not report separator differences as disagreement", () => {
    expect(contradictions({ partNumber: "AA-100" }, { partNumber: "aa 100" })).toEqual([]);
  });

  it("reports a disagreeing barcode and manufacturer", () => {
    const found = contradictions(
      { barcode: "5901234123457", manufacturer: "Acme" },
      { barcode: "036000291452", manufacturer: "Other" },
    );
    expect(found).toEqual([{ field: "barcode" }, { field: "manufacturer" }]);
  });

  it("treats a UPC-A and its EAN-13 form as agreement", () => {
    expect(contradictions({ barcode: "036000291452" }, { barcode: "0036000291452" })).toEqual([]);
  });
});

describe("merging what two stages know", () => {
  it("fills gaps without overwriting a value that is already there", () => {
    expect(
      mergeIdentities(
        { name: "Hex bolt", partNumber: null },
        { name: "M10 hex bolt", partNumber: "AA-100", manufacturer: "Acme" },
      ),
    ).toEqual({
      itemId: null,
      barcode: null,
      manufacturer: "Acme",
      name: "Hex bolt",
      partNumber: "AA-100",
    });
  });

  it("normalises whitespace as it merges", () => {
    expect(mergeIdentities({ name: "  Hex   bolt " }, {}).name).toBe("Hex bolt");
  });
});
