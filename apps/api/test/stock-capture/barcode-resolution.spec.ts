import { describe, expect, it } from "vitest";

import { readLocalCodes } from "../../src/stock-capture/barcode-resolution";

const observation = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  value: "5901234123457",
  symbology: "EAN-13",
  imageOrdinal: 1,
  readerVersion: "zxing-wasm-0.9.0",
  ...over,
});

describe("reading a browser's local barcode observations", () => {
  it("keeps a well-formed observation", () => {
    expect(readLocalCodes([observation()])).toEqual([
      {
        value: "5901234123457",
        symbology: "EAN-13",
        imageOrdinal: 1,
        readerVersion: "zxing-wasm-0.9.0",
      },
    ]);
  });

  /*
   * A bad decode among several photographs is ordinary. Refusing the whole
   * session over one malformed entry would be worse than dropping it.
   */
  it("drops a malformed entry instead of refusing the whole list", () => {
    expect(readLocalCodes([observation(), "not an observation", null, 42])).toHaveLength(1);
  });

  it.each([
    ["value", 12345],
    ["symbology", null],
    ["imageOrdinal", "one"],
    ["readerVersion", undefined],
  ])("drops an observation with a wrongly-typed %s", (field, value) => {
    expect(readLocalCodes([observation({ [field]: value })])).toEqual([]);
  });

  it("caps the list so an unbounded client array cannot be forced through", () => {
    const many = Array.from({ length: 100 }, () => observation());
    expect(readLocalCodes(many)).toHaveLength(20);
  });

  it("clamps an out-of-range image ordinal rather than trusting it", () => {
    expect(readLocalCodes([observation({ imageOrdinal: -3 })])[0]?.imageOrdinal).toBe(0);
    expect(readLocalCodes([observation({ imageOrdinal: 99 })])[0]?.imageOrdinal).toBe(5);
    expect(readLocalCodes([observation({ imageOrdinal: 2.9 })])[0]?.imageOrdinal).toBe(2);
  });

  it("truncates fields that could otherwise carry unbounded text", () => {
    const [kept] = readLocalCodes([
      observation({
        value: "x".repeat(500),
        symbology: "y".repeat(100),
        readerVersion: "z".repeat(200),
      }),
    ]);
    expect(kept?.value).toHaveLength(200);
    expect(kept?.symbology).toHaveLength(40);
    expect(kept?.readerVersion).toHaveLength(60);
  });

  it("returns nothing for an empty list", () => {
    expect(readLocalCodes([])).toEqual([]);
  });
});
