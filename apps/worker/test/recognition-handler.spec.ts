import type { LocalBarcodeObservation } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import type { CorePhotoResult } from "../src/recognition/core-client";
import { mergeDetectedBarcodes } from "../src/recognition/recognition-handler";

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
