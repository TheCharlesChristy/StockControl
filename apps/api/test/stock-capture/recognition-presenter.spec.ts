import { describe, expect, it } from "vitest";

import {
  barcodeStageReports,
  evidenceFrom,
  identityDraftFrom,
  workerStageReports,
} from "../../src/stock-capture/recognition-presenter";

describe("presenting a stored candidate identity", () => {
  it("reads every field a candidate can carry", () => {
    expect(
      identityDraftFrom({
        manufacturer: "Acme",
        name: "Hex bolt",
        partNumber: "AA-100",
        barcode: "5901234123457",
        unit: "ea",
      }),
    ).toEqual({
      manufacturer: "Acme",
      name: "Hex bolt",
      partNumber: "AA-100",
      barcode: "5901234123457",
      unit: "ea",
      variantAttributes: [],
    });
  });

  it("treats an empty string the same as an absent field", () => {
    expect(identityDraftFrom({ manufacturer: "" }).manufacturer).toBeNull();
  });

  /* The name is the one field the review screen always has room to show. */
  it("defaults a missing name to an empty string, never null", () => {
    expect(identityDraftFrom({}).name).toBe("");
  });

  it("survives a stored value that is not an object", () => {
    expect(identityDraftFrom(null)).toMatchObject({ name: "", manufacturer: null });
    expect(identityDraftFrom("not an object")).toMatchObject({ name: "" });
    expect(identityDraftFrom(42)).toMatchObject({ name: "" });
  });

  it("ignores a field of the wrong type rather than throwing", () => {
    expect(identityDraftFrom({ name: 12345 }).name).toBe("");
  });
});

describe("presenting stored candidate evidence", () => {
  it("reads a well-formed evidence entry", () => {
    expect(
      evidenceFrom([
        { stage: "Ocr", imageOrdinals: [1, 2], summary: "label text", sourceUrl: null },
      ]),
    ).toEqual([{ stage: "Ocr", imageOrdinals: [1, 2], summary: "label text", sourceUrl: null }]);
  });

  it("defaults a missing source url to null rather than omitting the field", () => {
    expect(evidenceFrom([{ stage: "Web", summary: "manufacturer page" }])[0]?.sourceUrl).toBeNull();
  });

  it("drops an entry missing the fields a person needs to see", () => {
    expect(evidenceFrom([{ stage: "Ocr" }, { summary: "no stage" }])).toEqual([]);
  });

  it("drops non-numeric ordinals rather than passing them through", () => {
    expect(
      evidenceFrom([{ stage: "Ocr", imageOrdinals: [1, "two", 3], summary: "x" }])[0]
        ?.imageOrdinals,
    ).toEqual([1, 3]);
  });

  it("returns nothing for anything that is not an array", () => {
    expect(evidenceFrom(null)).toEqual([]);
    expect(evidenceFrom({})).toEqual([]);
    expect(evidenceFrom("evidence")).toEqual([]);
  });
});

describe("synthesising the barcode stage report", () => {
  it("reports every code that was read, tied to its photograph", () => {
    expect(
      barcodeStageReports([
        { value: "5901234123457", symbology: "EAN-13", imageOrdinal: 1 },
        { value: "5901234123457", symbology: "EAN-13", imageOrdinal: 2 },
      ]),
    ).toEqual([
      {
        stage: "Barcode",
        outcome: "Succeeded",
        imageOrdinal: 1,
        observations: ["Decoded 5901234123457"],
      },
      {
        stage: "Barcode",
        outcome: "Succeeded",
        imageOrdinal: 2,
        observations: ["Decoded 5901234123457"],
      },
    ]);
  });

  /* No barcode read is not evidence of failure — it is simply not applicable. */
  it("reports nothing when no code was ever read", () => {
    expect(barcodeStageReports([])).toEqual([]);
    expect(barcodeStageReports(null)).toEqual([]);
    expect(barcodeStageReports(undefined)).toEqual([]);
  });

  it("skips a malformed stored entry rather than throwing", () => {
    expect(barcodeStageReports([{ value: "only a value" }, "not an object"])).toEqual([]);
  });
});

describe("reading the stage record the worker left behind", () => {
  it("reads every stage the worker reported", () => {
    expect(
      workerStageReports({
        fusionWeights: "v1",
        stages: [
          { stage: "Ocr", outcome: "Succeeded", imageOrdinal: null, observations: ["Read text."] },
          { stage: "Vlm", outcome: "Unavailable", imageOrdinal: null, observations: [] },
        ],
      }),
    ).toEqual([
      { stage: "Ocr", outcome: "Succeeded", imageOrdinal: null, observations: ["Read text."] },
      { stage: "Vlm", outcome: "Unavailable", imageOrdinal: null, observations: [] },
    ]);
  });

  /*
   * Sessions analysed before the worker recorded stages have a manifest with
   * no `stages` key. Reporting nothing is what makes the analysis outcome
   * call them `NotRun` rather than inventing a result they never produced.
   */
  it("reports nothing for a manifest that predates stage recording", () => {
    expect(workerStageReports({ fusionWeights: "v1" })).toEqual([]);
    expect(workerStageReports(null)).toEqual([]);
    expect(workerStageReports(undefined)).toEqual([]);
    expect(workerStageReports("not an object")).toEqual([]);
  });

  it("skips an entry naming a stage or outcome it does not recognise", () => {
    expect(
      workerStageReports({
        stages: [
          { stage: "Telepathy", outcome: "Succeeded", observations: [] },
          { stage: "Ocr", outcome: "Vibes", observations: [] },
          { stage: "Ocr", outcome: "Succeeded", observations: [] },
        ],
      }),
    ).toEqual([{ stage: "Ocr", outcome: "Succeeded", imageOrdinal: null, observations: [] }]);
  });

  /* A stage that examined one photograph in particular says which, so the
   * details table can point at the photograph rather than the whole session. */
  it("keeps the photograph a stage was tied to", () => {
    expect(
      workerStageReports({
        stages: [{ stage: "Ocr", outcome: "Succeeded", imageOrdinal: 3, observations: [] }],
      }),
    ).toEqual([{ stage: "Ocr", outcome: "Succeeded", imageOrdinal: 3, observations: [] }]);
  });

  it("drops observations that are not text", () => {
    expect(
      workerStageReports({
        stages: [{ stage: "Web", outcome: "Failed", observations: ["fine", 42, null] }],
      })[0]?.observations,
    ).toEqual(["fine"]);
  });
});
