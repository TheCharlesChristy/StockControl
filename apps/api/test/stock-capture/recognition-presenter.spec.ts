import { describe, expect, it } from "vitest";

import {
  barcodeStageReports,
  detectedBarcodesFrom,
  evidenceFrom,
  identityDraftFrom,
  presentRecognitionSession,
  stageReportsFromManifest,
  suggestedDraftFromManifest,
} from "../../src/stock-capture/recognition-presenter";

interface PresenterQueryStub {
  selectAll(): PresenterQueryStub;
  select(): PresenterQueryStub;
  where(): PresenterQueryStub;
  orderBy(): PresenterQueryStub;
  executeTakeFirstOrThrow(): Promise<unknown>;
  execute(): Promise<readonly unknown[]>;
}

describe("presenting a stored candidate identity", () => {
  it("reads every field a candidate can carry", () => {
    expect(
      identityDraftFrom({
        manufacturer: "Acme",
        name: "Hex bolt",
        partNumber: "AA-100",
        barcode: "5901234123457",
        unit: "ea",
        variantAttributes: [{ label: "colour", value: "Brass" }],
      }),
    ).toEqual({
      manufacturer: "Acme",
      name: "Hex bolt",
      partNumber: "AA-100",
      barcode: "5901234123457",
      unit: "ea",
      variantAttributes: [{ label: "colour", value: "Brass" }],
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

  it("retains server-decoded values for review without duplicating their stage report", () => {
    const stored = [
      {
        value: "5012345678900",
        symbology: "EAN-13",
        imageOrdinal: 1,
        readerVersion: "recognition-core",
      },
    ];

    expect(detectedBarcodesFrom(stored)).toEqual([
      { value: "5012345678900", symbology: "EAN-13", imageOrdinal: 1 },
    ]);
    expect(barcodeStageReports(stored)).toEqual([]);
  });

  it("drops impossible photo ordinals and normalises barcode text", () => {
    const stored = [
      { value: " 5012345678900 ", symbology: " ean-13 ", imageOrdinal: 1 },
      { value: "invalid", symbology: "EAN-13", imageOrdinal: 0 },
      { value: "invalid", symbology: "EAN-13", imageOrdinal: Number.NaN },
    ];

    expect(detectedBarcodesFrom(stored)).toEqual([
      { value: "5012345678900", symbology: "ean-13", imageOrdinal: 1 },
    ]);
    expect(barcodeStageReports(stored)).toHaveLength(1);
  });
});

describe("presenting the recognised editable draft", () => {
  it("retains structured fields recovered before candidate fusion", () => {
    expect(
      suggestedDraftFromManifest({
        suggestedDraft: {
          manufacturer: "Honeywell",
          name: "Excel 10 Fan Coil Controller",
          partNumber: "W7752E2004",
          barcode: "5023226600023",
          unit: null,
          variantAttributes: [{ label: "voltage", value: "230 V" }],
        },
      }),
    ).toEqual({
      manufacturer: "Honeywell",
      name: "Excel 10 Fan Coil Controller",
      partNumber: "W7752E2004",
      barcode: "5023226600023",
      unit: null,
      variantAttributes: [{ label: "voltage", value: "230 V" }],
    });
  });

  it("does not expose an empty or malformed manifest value", () => {
    expect(suggestedDraftFromManifest({ suggestedDraft: {} })).toBeNull();
    expect(suggestedDraftFromManifest(null)).toBeNull();
  });
});

describe("presenting stored recognition stage reports", () => {
  it("reads valid reports from the session model manifest", () => {
    expect(
      stageReportsFromManifest({
        fusionWeights: "v1",
        stageReports: [
          {
            stage: "Ocr",
            outcome: "Unavailable",
            imageOrdinal: 1,
            observations: ["The recognition service could not be reached."],
          },
        ],
      }),
    ).toEqual([
      {
        stage: "Ocr",
        outcome: "Unavailable",
        imageOrdinal: 1,
        observations: ["The recognition service could not be reached."],
      },
    ]);
  });

  it("drops malformed or unknown reports rather than trusting stored JSON", () => {
    expect(
      stageReportsFromManifest({
        stageReports: [
          { stage: "MadeUp", outcome: "Unavailable", imageOrdinal: 1 },
          { stage: "Ocr", outcome: "MadeUp", imageOrdinal: 1 },
          { stage: "Ocr", outcome: "Unavailable", imageOrdinal: "one" },
        ],
      }),
    ).toEqual([]);
    expect(stageReportsFromManifest(null)).toEqual([]);
  });

  it("returns nothing when the manifest has no report list", () => {
    expect(stageReportsFromManifest({ fusionWeights: "v1" })).toEqual([]);
    expect(stageReportsFromManifest("not a manifest")).toEqual([]);
  });

  it("filters malformed entries and observations while preserving session-wide reports", () => {
    expect(
      stageReportsFromManifest({
        stageReports: [
          null,
          "not a report",
          {
            stage: "Vlm",
            outcome: "Succeeded",
            imageOrdinal: null,
            observations: ["Photo analysis completed.", 42, null],
          },
          {
            stage: "Category",
            outcome: "NotApplicable",
            imageOrdinal: 2,
          },
        ],
      }),
    ).toEqual([
      {
        stage: "Vlm",
        outcome: "Succeeded",
        imageOrdinal: null,
        observations: ["Photo analysis completed."],
      },
      {
        stage: "Category",
        outcome: "NotApplicable",
        imageOrdinal: 2,
        observations: [],
      },
    ]);
  });
});

describe("presenting a stored recognition session", () => {
  it("combines persisted stage reports with reviewable candidates", async () => {
    const session = {
      id: "session-1",
      batch_id: "batch-1",
      status: "ReviewReady",
      photo_count: 1,
      local_codes: [],
      model_manifest: {
        suggestedDraft: {
          manufacturer: "Acme",
          name: "Unidentified fitting",
          partNumber: "AF-100",
          barcode: null,
          unit: null,
          variantAttributes: [],
        },
        stageReports: [
          {
            stage: "Ocr",
            outcome: "Unavailable",
            imageOrdinal: 1,
            observations: ["The recognition service could not be reached."],
          },
        ],
      },
      committed_item_id: null,
      failure_code: null,
      created_at: new Date("2026-08-14T10:00:00.000Z"),
      expires_at: new Date("2026-08-14T11:00:00.000Z"),
    };
    const candidate = {
      id: "candidate-1",
      rank: 1,
      kind: "ExternalDraft",
      item_id: null,
      identity: { name: "Unidentified fitting", unit: "ea" },
      confidence_band: "Weak",
      evidence: [],
    };
    const queryFor = (rows: readonly unknown[], first?: unknown): PresenterQueryStub => ({
      selectAll() {
        return this;
      },
      select() {
        return this;
      },
      where() {
        return this;
      },
      orderBy() {
        return this;
      },
      executeTakeFirstOrThrow: () => Promise.resolve(first),
      execute: () => Promise.resolve(rows),
    });
    const database = {
      withSchema: () => ({
        selectFrom: (table: string): PresenterQueryStub => {
          if (table === "stock_recognition_sessions") return queryFor([], session);
          if (table === "stock_recognition_images") {
            return queryFor([{ id: "image-1", ordinal: 1, media_type: "image/jpeg" }]);
          }
          return queryFor([candidate]);
        },
      }),
    };

    const result = await presentRecognitionSession(database as never, "session-1", {} as never);

    expect(result).toMatchObject({
      id: "session-1",
      batchId: "batch-1",
      status: "ReviewReady",
      photos: [
        {
          id: "image-1",
          ordinal: 1,
          url: "/api/v1/stock-capture/sessions/session-1/images/image-1",
        },
      ],
      candidates: [
        {
          id: "candidate-1",
          kind: "ExternalDraft",
          identity: { name: "Unidentified fitting", unit: "ea" },
          selectable: true,
        },
      ],
      suggestedDraft: {
        manufacturer: "Acme",
        name: "Unidentified fitting",
        partNumber: "AF-100",
      },
      stageReports: [
        {
          stage: "Ocr",
          outcome: "Unavailable",
          imageOrdinal: 1,
        },
      ],
      recommendManualEntry: false,
    });
  });
});
