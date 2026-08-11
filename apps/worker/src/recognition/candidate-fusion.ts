import { CAPTURE_MAX_CANDIDATES } from "@stockcontrol/contracts";
import {
  fuseCandidates,
  type CandidateIdentityInput,
  type FusionOutcome,
  type StageResult,
} from "@stockcontrol/module-stock-capture";

import type { CatalogueMatch } from "./catalogue-retrieval";
import type { VlmProposal } from "./fusion-client";
import type { VisualNeighbour } from "./visual-index";
import type { WebSearchResult } from "./web-evidence";

/*
 * Thin adapters from each stage's own result shape into Phase 1's
 * `StageResult` — the one shape `fuseCandidates` (specification section
 * 7.10) understands. Nothing here scores or ranks anything; that is the
 * pure module's job, and keeping the mapping this dumb is what makes the
 * fusion weights the only place tuning ever has to happen.
 */

const describeCatalogueMatch = (matchedBy: CatalogueMatch["matchedBy"]): string => {
  switch (matchedBy) {
    case "Barcode":
      return "Matched by barcode";
    case "PartNumber":
      return "Matched by part number";
    case "Name":
      return "Matched by name";
  }
};

export const barcodeStageResult = (
  match: { readonly itemId: string; readonly isActive: boolean },
  imageOrdinal: number,
  rank: number,
): StageResult => ({
  stage: "Barcode",
  imageOrdinal,
  rank,
  identity: { itemId: match.itemId },
  summary: "Matched by barcode",
  selectable: match.isActive,
});

export const catalogueStageResult = (
  match: CatalogueMatch,
  imageOrdinal: number,
  rank: number,
): StageResult => ({
  stage: "Ocr",
  imageOrdinal,
  rank,
  identity: {
    itemId: match.itemId,
    barcode: match.barcode,
    partNumber: match.partNumber,
    name: match.name,
  },
  summary: describeCatalogueMatch(match.matchedBy),
  selectable: match.isActive,
});

export const visualStageResult = (
  neighbour: VisualNeighbour,
  imageOrdinal: number,
  rank: number,
): StageResult => ({
  stage: "VisualExample",
  imageOrdinal,
  rank,
  identity: { itemId: neighbour.itemId },
  summary: `Looks similar to a confirmed item (${String(Math.round(neighbour.similarity * 100))}% visual match)`,
});

export const categoryStageResult = (
  label: string,
  imageOrdinal: number,
  rank: number,
): StageResult => ({
  stage: "Category",
  imageOrdinal,
  rank,
  // A category is never enough to identify a product on its own, so it never
  // carries an item id or an external identity — only a name-shaped hint
  // that other stages' evidence can agree or disagree with.
  identity: { name: label },
  summary: `Looks like: ${label}`,
});

export const webStageResult = (result: WebSearchResult, rank: number): StageResult => ({
  stage: "Web",
  imageOrdinal: null,
  rank,
  identity: { name: result.title },
  summary: result.snippet.length > 0 ? result.snippet : result.title,
  sourceUrl: result.url,
});

/**
 * The VLM's own confidence is never read (fusion-client.ts already omits it
 * from the parsed type); this only turns its identity claim into ordinary
 * evidence — the fusion weights decide how much that evidence is worth, not
 * this function and not the model.
 */
export const vlmStageResult = (
  proposal: VlmProposal,
  candidateIdentities: ReadonlyMap<string, CandidateIdentityInput>,
): StageResult | null => {
  if (proposal.kind === "Unknown") return null;

  const imageOrdinal = proposal.evidenceImageOrdinals[0] ?? null;

  if (proposal.kind === "InternalCandidate") {
    const identity = candidateIdentities.get(proposal.candidateId);
    // The allowlist in fusion-client.ts should make this unreachable; treated
    // as no evidence rather than trusted, because a network response is
    // still a network response.
    if (identity === undefined) return null;
    return {
      stage: "Vlm",
      imageOrdinal,
      rank: 1,
      identity,
      summary: "Suggested by image analysis",
    };
  }

  return {
    stage: "Vlm",
    imageOrdinal,
    rank: 1,
    identity: {
      manufacturer: proposal.manufacturer,
      name: proposal.name,
      partNumber: proposal.partNumber,
      barcode: proposal.barcode,
    },
    summary: "Suggested by image analysis",
  };
};

export const runFusion = (results: readonly StageResult[]): FusionOutcome =>
  fuseCandidates(results, { limit: CAPTURE_MAX_CANDIDATES });
