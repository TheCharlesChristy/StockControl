import type { ConfidenceBand, RecognitionStage } from "@stockcontrol/contracts";

import {
  candidateIdentityKey,
  contradictions,
  identityKeyToString,
  mergeIdentities,
  type CandidateIdentityInput,
} from "./candidate-identity";

/*
 * Deterministic fusion, specification section 7.10.
 *
 * The load-bearing decision here is what is *not* done: raw OCR confidence,
 * cosine similarity, search rank and token probability are never averaged
 * together. They are not on comparable scales and no amount of weighting makes
 * them so. Instead each stage contributes a reciprocal-rank score — a stage
 * only has to get the ordering right, not the magnitude — and stage weights
 * come from a versioned configuration that a benchmark run can change without
 * touching this code.
 */

export interface StageResult {
  readonly stage: RecognitionStage;
  /** Which photograph produced it. Null for the item-level stages. */
  readonly imageOrdinal: number | null;
  /** 1-based within its stage and photograph. */
  readonly rank: number;
  readonly identity: CandidateIdentityInput;
  readonly summary: string;
  readonly sourceUrl?: string | null;
  /** Archived internal matches are shown as evidence but cannot receive stock. */
  readonly selectable?: boolean;
}

export interface FusionWeights {
  readonly version: string;
  readonly stageWeight: Readonly<Record<RecognitionStage, number>>;
  /** Added per extra stage that agrees, capped by `maxConsensusBonus`. */
  readonly consensusBonus: number;
  readonly maxConsensusBonus: number;
  /** Added per extra photograph that agrees, capped by `maxMultiPhotoBonus`. */
  readonly multiPhotoBonus: number;
  readonly maxMultiPhotoBonus: number;
  /** Subtracted per contradicted identifier. Deliberately larger than any bonus. */
  readonly contradictionPenalty: number;
  readonly strongThreshold: number;
  readonly possibleThreshold: number;
  /** Stages that can carry a candidate to Strong on their own evidence. */
  readonly strongCapableStages: readonly RecognitionStage[];
}

/**
 * The first release's configuration, tuned on the pilot set. These numbers are
 * expected to be replaced by a calibrated model release once enough reviewed
 * production outcomes exist; that is an evaluated release, not online learning.
 */
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = Object.freeze({
  version: "wrr-2026-08-09",
  stageWeight: Object.freeze({
    Barcode: 10,
    Ocr: 4,
    VisualExample: 3,
    Category: 0.5,
    Web: 2,
    Vlm: 2,
  }),
  consensusBonus: 0.6,
  maxConsensusBonus: 1.8,
  /*
   * Weighted so that a candidate seen in every photograph at rank two overtakes
   * one seen once at rank one. Extra angles are the cheapest evidence a person
   * can supply and the whole reason the feature accepts five photographs; a
   * result that survives all of them has been corroborated, while a single
   * top-one has not. Still capped, so five photographs of one blurry label
   * cannot manufacture confidence on their own.
   */
  multiPhotoBonus: 0.6,
  maxMultiPhotoBonus: 1.8,
  contradictionPenalty: 6,
  strongThreshold: 7,
  possibleThreshold: 2,
  strongCapableStages: Object.freeze(["Barcode", "Ocr"] as const),
});

/**
 * Reciprocal rank with a constant, the standard smoothing that stops rank 1
 * from dominating rank 2 by a factor the underlying stage never claimed.
 */
const RANK_CONSTANT = 3;
const reciprocalRank = (rank: number): number => 1 / (RANK_CONSTANT + Math.max(1, rank));

export interface FusedEvidence {
  readonly stage: RecognitionStage;
  readonly imageOrdinals: readonly number[];
  readonly summary: string;
  readonly sourceUrl: string | null;
}

export interface FusedCandidate {
  readonly identityKey: string;
  readonly identity: CandidateIdentityInput;
  readonly score: number;
  readonly confidence: ConfidenceBand;
  readonly selectable: boolean;
  readonly evidence: readonly FusedEvidence[];
  readonly stages: readonly RecognitionStage[];
  readonly imageOrdinals: readonly number[];
}

interface Accumulator {
  readonly identityKey: string;
  identity: CandidateIdentityInput;
  selectable: boolean;
  /** Best reciprocal rank seen per stage — the maximum, never a sum. */
  readonly bestPerStage: Map<RecognitionStage, number>;
  readonly evidence: Map<
    RecognitionStage,
    { summary: string; sourceUrl: string | null; ordinals: Set<number> }
  >;
  readonly imageOrdinals: Set<number>;
  /** Preserves the order results arrived so ties break deterministically. */
  readonly firstSeen: number;
}

/**
 * Groups results by identity, keeping the strongest evidence per stage.
 *
 * Every stage's top five reach this function, including ranks that were never
 * a per-image top one. A candidate that comes second in three photographs is
 * frequently the right answer and must not be discarded before it can benefit
 * from the multi-photo bonus.
 */
const accumulate = (results: readonly StageResult[]): readonly Accumulator[] => {
  const byIdentity = new Map<string, Accumulator>();

  results.forEach((result, index) => {
    const key = identityKeyToString(
      candidateIdentityKey(result.identity, `result-${String(index)}`),
    );
    const existing = byIdentity.get(key);
    const accumulator: Accumulator = existing ?? {
      identityKey: key,
      identity: result.identity,
      selectable: result.selectable ?? true,
      bestPerStage: new Map<RecognitionStage, number>(),
      evidence: new Map(),
      imageOrdinals: new Set<number>(),
      firstSeen: index,
    };

    if (existing !== undefined) {
      accumulator.identity = mergeIdentities(accumulator.identity, result.identity);
      /* One unselectable sighting is enough: an archived item cannot receive stock. */
      accumulator.selectable = accumulator.selectable && (result.selectable ?? true);
    }

    const contribution = reciprocalRank(result.rank);
    const best = accumulator.bestPerStage.get(result.stage) ?? 0;
    if (contribution > best) accumulator.bestPerStage.set(result.stage, contribution);

    const evidence = accumulator.evidence.get(result.stage);
    if (evidence === undefined) {
      accumulator.evidence.set(result.stage, {
        summary: result.summary,
        sourceUrl: result.sourceUrl ?? null,
        ordinals: new Set(result.imageOrdinal === null ? [] : [result.imageOrdinal]),
      });
    } else if (result.imageOrdinal !== null) {
      evidence.ordinals.add(result.imageOrdinal);
    }

    if (result.imageOrdinal !== null) accumulator.imageOrdinals.add(result.imageOrdinal);
    byIdentity.set(key, accumulator);
  });

  return [...byIdentity.values()];
};

const scoreOf = (accumulator: Accumulator, weights: FusionWeights): number => {
  let base = 0;
  for (const [stage, contribution] of accumulator.bestPerStage) {
    base += weights.stageWeight[stage] * contribution * (RANK_CONSTANT + 1);
  }

  const agreeingStages = accumulator.bestPerStage.size;
  const consensus = Math.min(
    weights.maxConsensusBonus,
    Math.max(0, agreeingStages - 1) * weights.consensusBonus,
  );
  const multiPhoto = Math.min(
    weights.maxMultiPhotoBonus,
    Math.max(0, accumulator.imageOrdinals.size - 1) * weights.multiPhotoBonus,
  );

  return base + consensus + multiPhoto;
};

/**
 * A candidate reaches Strong only when a stage that can identify a product
 * outright supports it. Visual similarity alone never does: two variants of the
 * same fitting are visually identical and are separated by a number on a label,
 * so a confident-looking image match is exactly the case where a person must
 * still read the box.
 */
const bandOf = (
  accumulator: Accumulator,
  score: number,
  penalised: boolean,
  weights: FusionWeights,
): ConfidenceBand => {
  const hasIdentifyingStage = weights.strongCapableStages.some((stage) =>
    accumulator.bestPerStage.has(stage),
  );
  if (!penalised && hasIdentifyingStage && score >= weights.strongThreshold) return "Strong";
  return score >= weights.possibleThreshold ? "Possible" : "Weak";
};

export interface FusionOutcome {
  readonly candidates: readonly FusedCandidate[];
  readonly weightsVersion: string;
}

export const fuseCandidates = (
  results: readonly StageResult[],
  options: { readonly limit: number; readonly weights?: FusionWeights },
): FusionOutcome => {
  const weights = options.weights ?? DEFAULT_FUSION_WEIGHTS;
  const accumulators = accumulate(results);

  const scored = accumulators.map((accumulator) => {
    /*
     * Contradiction is measured against the best-supported candidate, not
     * pairwise across the whole set: a low-ranked result disagreeing with
     * another low-ranked result says nothing worth penalising.
     */
    const rawScore = scoreOf(accumulator, weights);
    return { accumulator, rawScore };
  });

  const leader = scored.reduce<{ accumulator: Accumulator; rawScore: number } | null>(
    (best, entry) => (best === null || entry.rawScore > best.rawScore ? entry : best),
    null,
  );

  const finished = scored.map(({ accumulator, rawScore }) => {
    const conflicting =
      leader === null || leader.accumulator.identityKey === accumulator.identityKey
        ? []
        : contradictions(leader.accumulator.identity, accumulator.identity);
    const penalty = conflicting.length * weights.contradictionPenalty;
    const score = rawScore - penalty;

    const evidence: FusedEvidence[] = [...accumulator.evidence.entries()].map(([stage, entry]) => ({
      stage,
      imageOrdinals: [...entry.ordinals].sort((left, right) => left - right),
      summary: entry.summary,
      sourceUrl: entry.sourceUrl,
    }));

    return {
      identityKey: accumulator.identityKey,
      identity: accumulator.identity,
      score,
      confidence: bandOf(accumulator, score, conflicting.length > 0, weights),
      selectable: accumulator.selectable,
      evidence,
      stages: [...accumulator.bestPerStage.keys()],
      imageOrdinals: [...accumulator.imageOrdinals].sort((left, right) => left - right),
      firstSeen: accumulator.firstSeen,
    };
  });

  /* Ties break on arrival order so the same evidence always ranks the same way. */
  const ordered = [...finished].sort((left, right) =>
    right.score === left.score ? left.firstSeen - right.firstSeen : right.score - left.score,
  );

  return {
    weightsVersion: weights.version,
    candidates: ordered.slice(0, options.limit).map((candidate): FusedCandidate => ({
      identityKey: candidate.identityKey,
      identity: candidate.identity,
      score: candidate.score,
      confidence: candidate.confidence,
      selectable: candidate.selectable,
      evidence: candidate.evidence,
      stages: candidate.stages,
      imageOrdinals: candidate.imageOrdinals,
    })),
  };
};
