import type { LocalBarcodeObservation } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import type { CorePhotoResult } from "../src/recognition/core-client";
import {
  buildPerPhotoVlmRequests,
  mergeDetectedBarcodes,
  suggestedDraftFromEvidence,
} from "../src/recognition/recognition-handler";

const photoResult = (barcodes: CorePhotoResult["barcodes"], imageOrdinal = 1): CorePhotoResult => ({
  imageOrdinal,
  barcodeOutcome: barcodes.length > 0 ? "Succeeded" : "NotApplicable",
  barcodes,
  ocrOutcome: "NotApplicable",
  ocrLines: [],
  identifiers: {
    manufacturerTokens: [],
    nameFragments: [],
    partNumberCandidates: [],
    barcodeLikeCandidates: [],
    variantAttributes: [],
    labelledPackQuantity: null,
  },
  embeddingOutcome: "NotApplicable",
  embedding: null,
  categoryOutcome: "NotApplicable",
  categories: [],
  quality: { blurScore: 0, foregroundAreaRatio: 0 },
  crops: [],
});

describe("mergeDetectedBarcodes", () => {
  it("retains a barcode decoded by recognition-core for later review", () => {
    expect(
      mergeDetectedBarcodes([], [photoResult([{ value: "5012345678900", symbology: "EAN-13" }])]),
    ).toEqual([
      {
        value: "5012345678900",
        symbology: "EAN-13",
        imageOrdinal: 1,
        readerVersion: "recognition-core",
      },
    ]);
  });

  it("deduplicates a server decode already supplied by the browser", () => {
    const browser: LocalBarcodeObservation = {
      value: "5012345678900",
      symbology: "EAN-13",
      imageOrdinal: 1,
      readerVersion: "browser-reader",
    };

    expect(
      mergeDetectedBarcodes(
        [browser],
        [photoResult([{ value: "5012345678900", symbology: "EAN-13" }])],
      ),
    ).toEqual([browser]);
  });
});

describe("suggestedDraftFromEvidence", () => {
  it("preserves OCR fields for the editable form when there is no catalogue match", () => {
    const photo = photoResult([]);
    const result = suggestedDraftFromEvidence(
      {
        barcodeLikeCandidates: ["5023226600023"],
        partNumberCandidates: ["W7752E2004"],
        nameFragments: ["Excel 10 Fan Coil Controller"],
        manufacturerTokens: ["Honeywell"],
        validatedGtin: "5023226600023",
      },
      [
        {
          ...photo,
          identifiers: {
            ...photo.identifiers,
            variantAttributes: [{ label: "voltage", value: "230 V" }],
          },
        },
      ],
      [],
    );

    expect(result).toEqual({
      manufacturer: "Honeywell",
      name: "Honeywell Excel 10 Fan Coil Controller",
      partNumber: "W7752E2004",
      barcode: "5023226600023",
      unit: null,
      variantAttributes: [{ label: "voltage", value: "230 V" }],
    });
  });

  it("returns no draft when recognition found no usable product detail", () => {
    expect(
      suggestedDraftFromEvidence(
        {
          barcodeLikeCandidates: [],
          partNumberCandidates: [],
          nameFragments: [],
          manufacturerTokens: [],
          validatedGtin: null,
        },
        [],
        [],
      ),
    ).toBeNull();
  });
});

describe("buildPerPhotoVlmRequests", () => {
  it("keeps every photograph in its own bounded VLM request", () => {
    const first = {
      ...photoResult([], 1),
      ocrLines: [{ text: "Honeywell", score: 0.9 }],
      categories: [{ label: "Controller", score: 0.8 }],
    };
    const second = {
      ...photoResult([], 2),
      ocrLines: [{ text: "W7752E2004", score: 0.9 }],
      categories: [{ label: "HVAC part", score: 0.7 }],
    };

    const requests = buildPerPhotoVlmRequests(
      [
        { ordinal: 1, bytes: Buffer.from("first"), mediaType: "image/jpeg" },
        { ordinal: 2, bytes: Buffer.from("second"), mediaType: "image/jpeg" },
      ],
      [first, second],
      [],
      [],
    );

    expect(requests).toHaveLength(2);
    expect(requests.map(({ request }) => request.images)).toEqual([
      [{ ordinal: 1, base64: Buffer.from("first").toString("base64"), mediaType: "image/jpeg" }],
      [{ ordinal: 2, base64: Buffer.from("second").toString("base64"), mediaType: "image/jpeg" }],
    ]);
    expect(requests[0]?.request.observations).toEqual([{ imageOrdinal: 1, text: "Honeywell" }]);
    expect(requests[1]?.request.observations).toEqual([{ imageOrdinal: 2, text: "W7752E2004" }]);
  });
});
