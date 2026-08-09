import { describe, expect, it } from "vitest";

import { fuseCandidates, type StageResult } from "../src/fusion";

const result = (over: Partial<StageResult> & Pick<StageResult, "stage">): StageResult => ({
  imageOrdinal: 1,
  rank: 1,
  identity: { name: "Something" },
  summary: "evidence",
  ...over,
});

describe("deterministic fusion", () => {
  it("puts an exact barcode above a confident-looking image match", () => {
    const { candidates } = fuseCandidates(
      [
        result({
          stage: "VisualExample",
          identity: { itemId: "item-visual" },
          summary: "looks like a confirmed item",
        }),
        result({
          stage: "Barcode",
          identity: { itemId: "item-barcode" },
          summary: "barcode",
        }),
      ],
      { limit: 5 },
    );

    expect(candidates[0]?.identity.itemId).toBe("item-barcode");
    expect(candidates[0]?.confidence).toBe("Strong");
  });

  /*
   * Visual similarity cannot separate two variants of the same fitting; the
   * number on the label does. A Strong band on an image match alone would send
   * a person past exactly the check that catches the wrong variant.
   */
  it("never reaches Strong on visual evidence alone", () => {
    const { candidates } = fuseCandidates(
      [1, 2, 3, 4, 5].map((ordinal) =>
        result({
          stage: "VisualExample",
          imageOrdinal: ordinal,
          identity: { itemId: "item-visual" },
          summary: "looks like a confirmed item",
        }),
      ),
      { limit: 5 },
    );

    expect(candidates[0]?.confidence).not.toBe("Strong");
  });

  /*
   * Section 7.10 step 2: a candidate that ranks second repeatedly must survive.
   * Keeping only per-image top ones would delete the answer three photographs
   * agreed on.
   */
  it("keeps a candidate that was never any photograph's top result", () => {
    const results: StageResult[] = [];
    for (const ordinal of [1, 2, 3]) {
      results.push(
        result({
          stage: "Ocr",
          imageOrdinal: ordinal,
          rank: 1,
          identity: { manufacturer: "Acme", partNumber: `TOP-${String(ordinal)}` },
          summary: "label text",
        }),
        result({
          stage: "Ocr",
          imageOrdinal: ordinal,
          rank: 2,
          identity: { manufacturer: "Acme", partNumber: "RUNNER-UP" },
          summary: "label text",
        }),
      );
    }

    const { candidates } = fuseCandidates(results, { limit: 5 });
    const runnerUp = candidates.find((candidate) => candidate.identity.partNumber === "RUNNER-UP");

    expect(runnerUp).toBeDefined();
    expect(runnerUp?.imageOrdinals).toEqual([1, 2, 3]);
    expect(candidates[0]?.identity.partNumber).toBe("RUNNER-UP");
  });

  it("rewards agreement across stages over one loud stage", () => {
    const agreeing = fuseCandidates(
      [
        result({ stage: "Ocr", identity: { manufacturer: "Acme", partNumber: "AA-100" } }),
        result({ stage: "Web", identity: { manufacturer: "Acme", partNumber: "AA-100" } }),
        result({ stage: "Vlm", identity: { manufacturer: "Acme", partNumber: "AA-100" } }),
      ],
      { limit: 5 },
    );
    const alone = fuseCandidates(
      [result({ stage: "Ocr", identity: { manufacturer: "Acme", partNumber: "AA-100" } })],
      { limit: 5 },
    );

    expect(agreeing.candidates[0]?.score).toBeGreaterThan(alone.candidates[0]?.score ?? 0);
    expect(agreeing.candidates[0]?.stages).toHaveLength(3);
  });

  it("penalises a candidate whose part number contradicts the leader", () => {
    const { candidates } = fuseCandidates(
      [
        result({
          stage: "Barcode",
          identity: { manufacturer: "Acme", partNumber: "AA-100", barcode: "5901234123457" },
          summary: "barcode",
        }),
        result({
          stage: "VisualExample",
          identity: { manufacturer: "Acme", partNumber: "AA-999" },
          summary: "looks like a confirmed item",
        }),
      ],
      { limit: 5 },
    );

    const contradicted = candidates.find((candidate) => candidate.identity.partNumber === "AA-999");
    expect(contradicted?.confidence).toBe("Weak");
    expect(contradicted?.score).toBeLessThan(0);
  });

  /*
   * OCR reads the same words off two different boxes of different lengths.
   * Merging on the name would present one of them as the other and hide the
   * variant a person needed to choose between.
   */
  it("does not merge two candidates that share only a name", () => {
    const { candidates } = fuseCandidates(
      [
        result({ stage: "Ocr", imageOrdinal: 1, identity: { name: "M10 Hex Bolt" } }),
        result({ stage: "Ocr", imageOrdinal: 2, identity: { name: "M10 Hex Bolt" } }),
      ],
      { limit: 5 },
    );

    expect(candidates).toHaveLength(2);
  });

  it("merges what two stages know about one product", () => {
    const { candidates } = fuseCandidates(
      [
        result({ stage: "Ocr", identity: { barcode: "5901234123457", name: "Hex bolt" } }),
        result({
          stage: "Web",
          imageOrdinal: null,
          identity: { barcode: "5901234123457", manufacturer: "Acme", partNumber: "AA-100" },
          sourceUrl: "https://example.test/product",
        }),
      ],
      { limit: 5 },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.identity).toMatchObject({
      manufacturer: "Acme",
      name: "Hex bolt",
      partNumber: "AA-100",
    });
    expect(candidates[0]?.evidence.find((entry) => entry.stage === "Web")?.sourceUrl).toBe(
      "https://example.test/product",
    );
  });

  it("marks the group unselectable when any sighting was archived", () => {
    const { candidates } = fuseCandidates(
      [
        result({ stage: "Barcode", identity: { itemId: "item-1" }, selectable: false }),
        result({ stage: "Ocr", identity: { itemId: "item-1" } }),
      ],
      { limit: 5 },
    );

    expect(candidates[0]?.selectable).toBe(false);
  });

  it("returns at most the requested number of candidates", () => {
    const results = [1, 2, 3, 4, 5, 6, 7].map((index) =>
      result({
        stage: "Ocr",
        rank: index,
        identity: { manufacturer: "Acme", partNumber: `AA-${String(index)}00` },
      }),
    );

    expect(fuseCandidates(results, { limit: 5 }).candidates).toHaveLength(5);
  });

  it("orders identical scores by arrival so a rerun ranks them the same way", () => {
    const results = [
      result({ stage: "Ocr", identity: { manufacturer: "Acme", partNumber: "AA-100" } }),
      result({ stage: "Ocr", identity: { manufacturer: "Acme", partNumber: "BB-200" } }),
    ];

    const first = fuseCandidates(results, { limit: 5 }).candidates.map((c) => c.identityKey);
    const second = fuseCandidates(results, { limit: 5 }).candidates.map((c) => c.identityKey);

    expect(first).toEqual(second);
    expect(first[0]).toBe("ManufacturerPart:ACME AA100");
  });

  it("reports which configuration produced the ordering", () => {
    expect(fuseCandidates([], { limit: 5 }).weightsVersion).toBe("wrr-2026-08-09");
  });

  it("returns nothing when every stage found nothing", () => {
    expect(fuseCandidates([], { limit: 5 }).candidates).toEqual([]);
  });
});
