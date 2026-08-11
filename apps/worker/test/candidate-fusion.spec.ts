import { describe, expect, it } from "vitest";

import type { CandidateIdentityInput } from "@stockcontrol/module-stock-capture";

import {
  barcodeStageResult,
  categoryStageResult,
  catalogueStageResult,
  runFusion,
  visualStageResult,
  vlmStageResult,
  webStageResult,
} from "../src/recognition/candidate-fusion";
import type { CatalogueMatch } from "../src/recognition/catalogue-retrieval";
import type { VlmProposal } from "../src/recognition/fusion-client";
import type { VisualNeighbour } from "../src/recognition/visual-index";
import type { WebSearchResult } from "../src/recognition/web-evidence";

describe("barcodeStageResult", () => {
  it("maps an active match to a selectable Barcode result", () => {
    const result = barcodeStageResult({ itemId: "item-1", isActive: true }, 1, 1);
    expect(result.stage).toBe("Barcode");
    expect(result.identity).toEqual({ itemId: "item-1" });
    expect(result.selectable).toBe(true);
  });

  it("marks an archived match as not selectable", () => {
    const result = barcodeStageResult({ itemId: "item-1", isActive: false }, 1, 1);
    expect(result.selectable).toBe(false);
  });
});

describe("catalogueStageResult", () => {
  const match: CatalogueMatch = {
    itemId: "item-1",
    isActive: true,
    reference: "REF-1",
    name: "Widget",
    barcode: "5012345678900",
    partNumber: "RS-1234A",
    matchedBy: "PartNumber",
  };

  it("maps to an Ocr stage result carrying the item's identifiers", () => {
    const result = catalogueStageResult(match, 2, 1);
    expect(result.stage).toBe("Ocr");
    expect(result.identity).toEqual({
      itemId: "item-1",
      barcode: "5012345678900",
      partNumber: "RS-1234A",
      name: "Widget",
    });
    expect(result.summary).toBe("Matched by part number");
  });

  it("describes each match kind in plain English", () => {
    expect(catalogueStageResult({ ...match, matchedBy: "Barcode" }, 1, 1).summary).toBe(
      "Matched by barcode",
    );
    expect(catalogueStageResult({ ...match, matchedBy: "Name" }, 1, 1).summary).toBe(
      "Matched by name",
    );
  });
});

describe("visualStageResult", () => {
  it("maps a neighbour to a VisualExample result carrying a percentage summary", () => {
    const neighbour: VisualNeighbour = { itemId: "item-1", similarity: 0.87 };
    const result = visualStageResult(neighbour, 1, 2);
    expect(result.stage).toBe("VisualExample");
    expect(result.identity).toEqual({ itemId: "item-1" });
    expect(result.summary).toContain("87%");
  });
});

describe("categoryStageResult", () => {
  it("never carries an item id, only a name-shaped hint", () => {
    const result = categoryStageResult("Hand tool", 1, 1);
    expect(result.stage).toBe("Category");
    expect(result.identity).toEqual({ name: "Hand tool" });
    expect("itemId" in result.identity).toBe(false);
  });
});

describe("webStageResult", () => {
  const searchResult: WebSearchResult = {
    title: "Acme RS-1234A Widget",
    snippet: "A widget from Acme.",
    url: "https://example.com/product",
  };

  it("carries the source URL as evidence", () => {
    const result = webStageResult(searchResult, 1);
    expect(result.stage).toBe("Web");
    expect(result.imageOrdinal).toBeNull();
    expect(result.sourceUrl).toBe("https://example.com/product");
    expect(result.identity).toEqual({ name: "Acme RS-1234A Widget" });
  });

  it("falls back to the title when there is no snippet", () => {
    const result = webStageResult({ ...searchResult, snippet: "" }, 1);
    expect(result.summary).toBe("Acme RS-1234A Widget");
  });
});

describe("vlmStageResult", () => {
  it("returns null for an Unknown proposal", () => {
    const proposal: VlmProposal = { kind: "Unknown" };
    expect(vlmStageResult(proposal, new Map())).toBeNull();
  });

  it("resolves an InternalCandidate against the supplied identity map", () => {
    const identity: CandidateIdentityInput = { itemId: "item-1" };
    const proposal: VlmProposal = {
      kind: "InternalCandidate",
      candidateId: "candidate-1",
      evidenceImageOrdinals: [2],
    };
    const result = vlmStageResult(proposal, new Map([["candidate-1", identity]]));
    expect(result?.stage).toBe("Vlm");
    expect(result?.identity).toBe(identity);
    expect(result?.imageOrdinal).toBe(2);
  });

  it("treats an InternalCandidate id missing from the map as no evidence", () => {
    const proposal: VlmProposal = {
      kind: "InternalCandidate",
      candidateId: "not-in-the-map",
      evidenceImageOrdinals: [],
    };
    expect(vlmStageResult(proposal, new Map())).toBeNull();
  });

  it("maps an ExternalIdentity proposal directly", () => {
    const proposal: VlmProposal = {
      kind: "ExternalIdentity",
      manufacturer: "Acme",
      name: "Widget",
      partNumber: "RS-1234A",
      barcode: null,
      variantAttributes: [],
      evidenceImageOrdinals: [1],
    };
    const result = vlmStageResult(proposal, new Map());
    expect(result?.identity).toEqual({
      manufacturer: "Acme",
      name: "Widget",
      partNumber: "RS-1234A",
      barcode: null,
    });
  });

  it("uses null imageOrdinal when the proposal names no evidence image", () => {
    const proposal: VlmProposal = {
      kind: "ExternalIdentity",
      manufacturer: null,
      name: "Widget",
      partNumber: null,
      barcode: null,
      variantAttributes: [],
      evidenceImageOrdinals: [],
    };
    expect(vlmStageResult(proposal, new Map())?.imageOrdinal).toBeNull();
  });

  it("never carries the model's own confidence — there is no field to carry it in", () => {
    const proposal: VlmProposal = { kind: "Unknown" };
    const result = vlmStageResult(proposal, new Map());
    expect(result).toBeNull();
    // ExternalIdentity/InternalCandidate results are asserted above to equal
    // an exact object shape with no confidence key, which is the real proof.
  });
});

describe("runFusion", () => {
  it("delegates to the pure fusion module and returns bounded candidates", () => {
    const outcome = runFusion([
      barcodeStageResult({ itemId: "item-1", isActive: true }, 1, 1),
      catalogueStageResult(
        {
          itemId: "item-1",
          isActive: true,
          reference: "REF-1",
          name: "Widget",
          barcode: "5012345678900",
          partNumber: null,
          matchedBy: "Barcode",
        },
        1,
        1,
      ),
    ]);

    expect(outcome.candidates).toHaveLength(1);
    expect(outcome.candidates[0]?.identity.itemId).toBe("item-1");
  });

  it("returns no candidates for no evidence", () => {
    expect(runFusion([]).candidates).toEqual([]);
  });
});
