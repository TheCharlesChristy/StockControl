import { describe, expect, it } from "vitest";

import { readLocalCodes, resolveLocalCodes } from "../../src/stock-capture/barcode-resolution";

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

/*
 * Both branches below decide before the catalogue is ever consulted, which is
 * the point: the barcode short cut skips the whole recognition pipeline, so
 * the rules for refusing it have to hold without a database in the picture.
 * The stub throws rather than returning a fixture — a query reaching it would
 * mean the short cut had been taken on evidence these tests say is unsafe.
 */
const databaseThatMustNotBeUsed = new Proxy(
  {},
  {
    get(): never {
      throw new Error("resolveLocalCodes queried the catalogue when it should have returned first");
    },
  },
) as Parameters<typeof resolveLocalCodes>[0];

describe("resolving local barcodes before any catalogue lookup", () => {
  it("reports no codes when nothing validated", async () => {
    await expect(
      resolveLocalCodes(databaseThatMustNotBeUsed, [
        /* Too short to be any product code, so it never reaches the catalogue. */
        { value: "abc", symbology: "EAN-13", imageOrdinal: 1, readerVersion: "test" },
        /* A symbology the catalogue does not carry product codes for. */
        {
          value: "https://example.test/thing",
          symbology: "QR-CODE",
          imageOrdinal: 2,
          readerVersion: "test",
        },
      ]),
    ).resolves.toEqual({ validated: [], outcome: { kind: "NoCodes" } });
  });

  it("reports no codes for an empty list", async () => {
    await expect(resolveLocalCodes(databaseThatMustNotBeUsed, [])).resolves.toMatchObject({
      outcome: { kind: "NoCodes" },
    });
  });

  /*
   * Two different products across one item's photographs means the frame
   * caught a neighbour. Taking the short cut there would receive stock
   * against whichever code happened to be read first.
   */
  it("refuses the short cut when the photographs carry two different products", async () => {
    const resolution = await resolveLocalCodes(databaseThatMustNotBeUsed, [
      { value: "5901234123457", symbology: "EAN-13", imageOrdinal: 1, readerVersion: "test" },
      { value: "4006381333931", symbology: "EAN-13", imageOrdinal: 2, readerVersion: "test" },
    ]);

    expect(resolution.outcome).toEqual({ kind: "Ambiguous" });
    expect(resolution.validated).toHaveLength(2);
  });

  it("does not call the same code read twice ambiguous", async () => {
    /* Reaching the catalogue is the correct behaviour here, so the throwing
     * stub is what proves the two reads collapsed to one product. */
    await expect(
      resolveLocalCodes(databaseThatMustNotBeUsed, [
        { value: "5901234123457", symbology: "EAN-13", imageOrdinal: 1, readerVersion: "test" },
        { value: "5901234123457", symbology: "EAN-13", imageOrdinal: 2, readerVersion: "test" },
      ]),
    ).rejects.toThrow(/queried the catalogue/u);
  });
});
