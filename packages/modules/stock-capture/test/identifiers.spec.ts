import { describe, expect, it } from "vitest";

import {
  canonicalGtin,
  distinctProductCodes,
  isValidGtin,
  normaliseManufacturer,
  normalisePartNumber,
  normaliseText,
  stripControlCharacters,
  validateProductCode,
} from "../src/identifiers";

describe("barcode validation", () => {
  it("accepts real GTINs of every published length", () => {
    expect(isValidGtin("96385074")).toBe(true);
    expect(isValidGtin("036000291452")).toBe(true);
    expect(isValidGtin("5901234123457")).toBe(true);
    expect(isValidGtin("00012345600012")).toBe(true);
  });

  it("rejects a barcode whose check digit does not match", () => {
    expect(isValidGtin("5901234123458")).toBe(false);
  });

  it("rejects lengths GS1 does not define, however plausible the digits", () => {
    expect(isValidGtin("1234567890")).toBe(false);
  });

  /*
   * A UPC-A and its EAN-13 form name one trade item. Comparing the printed
   * strings would show two candidates for one product and split the evidence
   * that should have made it the obvious answer.
   */
  it("treats a UPC-A and its zero-padded EAN-13 as one code", () => {
    expect(canonicalGtin("036000291452")).toBe("00036000291452");
    expect(canonicalGtin("0036000291452")).toBe("00036000291452");
  });

  it("refuses a symbology that can carry arbitrary text", () => {
    expect(validateProductCode({ value: "5901234123457", symbology: "QRCode" })).toBeNull();
  });

  /*
   * A misread digit produces a string that still looks like a barcode. Passing
   * it through as a free-form identifier would let it match the wrong item,
   * which is the entire reason the symbology carries a check digit.
   */
  it("rejects a numeric value at GTIN length that fails its check digit", () => {
    expect(validateProductCode({ value: "5901234123458", symbology: "EAN-13" })).toBeNull();
  });

  it("keeps a non-GTIN Code128 value as evidence without a canonical form", () => {
    const validated = validateProductCode({ value: "RS-1234-A", symbology: "Code128" });
    expect(validated).toEqual({ value: "RS-1234-A", symbology: "Code128", canonicalGtin: null });
  });

  it("strips control characters before length checks", () => {
    const validated = validateProductCode({
      value: "\u00025901234123457\u0003",
      symbology: "EAN-13",
    });
    expect(validated?.canonicalGtin).toBe("05901234123457");
  });

  it("counts two readings of one label as a single distinct code", () => {
    const codes = [
      validateProductCode({ value: "036000291452", symbology: "UPC-A" }),
      validateProductCode({ value: "0036000291452", symbology: "EAN-13" }),
    ].filter((code) => code !== null);

    expect(distinctProductCodes(codes)).toEqual(["00036000291452"]);
  });

  it("counts genuinely different codes separately so early return is suppressed", () => {
    const codes = [
      validateProductCode({ value: "036000291452", symbology: "UPC-A" }),
      validateProductCode({ value: "5901234123457", symbology: "EAN-13" }),
    ].filter((code) => code !== null);

    expect(distinctProductCodes(codes)).toHaveLength(2);
  });
});

describe("text normalisation", () => {
  it("removes bidirectional overrides that make two strings render alike", () => {
    expect(stripControlCharacters("AB‮CD")).toBe("ABCD");
  });

  it("removes zero-width characters", () => {
    expect(stripControlCharacters("AB​CD﻿")).toBe("ABCD");
  });

  it("collapses whitespace so one printed token stays one token", () => {
    expect(normaliseText("  M10   ×   50  ")).toBe("M10 × 50");
  });
});

describe("part number normalisation", () => {
  it("matches the same part printed with different separators", () => {
    expect(normalisePartNumber("RS-1234/A")).toBe("RS1234A");
    expect(normalisePartNumber("rs 1234 a")).toBe("RS1234A");
  });

  it("refuses a token too short to identify anything", () => {
    expect(normalisePartNumber("A1")).toBeNull();
  });
});

describe("manufacturer normalisation", () => {
  it("treats legal-form suffixes as noise", () => {
    expect(normaliseManufacturer("Acme Ltd")).toBe("ACME");
    expect(normaliseManufacturer("ACME Limited.")).toBe("ACME");
  });

  it("returns null when nothing identifying survives", () => {
    expect(normaliseManufacturer("Ltd.")).toBeNull();
  });
});
