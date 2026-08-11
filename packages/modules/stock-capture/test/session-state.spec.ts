import { describe, expect, it } from "vitest";

import { recognitionSessionStatuses } from "@stockcontrol/contracts";

import {
  InvalidSessionTransitionError,
  canTransition,
  isProcessing,
  isReviewable,
  isTerminal,
  progressLabel,
  requireTransition,
} from "../src/session-state";

describe("recognition session states", () => {
  it("walks the ordinary pipeline from queue to review", () => {
    const pipeline = [
      "Queued",
      "ProcessingBarcode",
      "ProcessingImages",
      "Enriching",
      "Fusing",
      "ReviewReady",
    ] as const;

    for (let index = 0; index + 1 < pipeline.length; index += 1) {
      const from = pipeline[index];
      const to = pipeline[index + 1];
      if (from === undefined || to === undefined) throw new Error("bad fixture");
      expect(canTransition(from, to)).toBe(true);
    }
  });

  /* The exact-barcode path never uploads a photograph but still needs a person. */
  it("lets a barcode-only session reach review without processing images", () => {
    expect(canTransition("AwaitingUpload", "ReviewReady")).toBe(true);
    expect(canTransition("ReviewReady", "Committed")).toBe(true);
  });

  it("refuses to move backwards through the pipeline", () => {
    expect(canTransition("Fusing", "ProcessingImages")).toBe(false);
    expect(canTransition("ReviewReady", "Queued")).toBe(false);
  });

  /*
   * A model result that arrives after the person cancelled must lose. This is
   * the check that stops a late duplicate overwriting a finished session.
   */
  it("refuses every transition out of a finished session", () => {
    for (const terminal of ["Committed", "Cancelled", "Failed", "Expired"] as const) {
      expect(isTerminal(terminal)).toBe(true);
      for (const status of recognitionSessionStatuses) {
        expect(canTransition(terminal, status)).toBe(false);
      }
    }
  });

  it("allows cancellation and expiry from every unfinished state", () => {
    for (const status of recognitionSessionStatuses) {
      if (isTerminal(status)) continue;
      expect(canTransition(status, "Cancelled")).toBe(true);
      expect(canTransition(status, "Expired")).toBe(true);
    }
  });

  it("names the states in which the worker still owns the session", () => {
    expect(isProcessing("Enriching")).toBe(true);
    expect(isProcessing("ReviewReady")).toBe(false);
    expect(isReviewable("ReviewReady")).toBe(true);
  });

  it("throws a transition error naming both states", () => {
    expect(() => requireTransition("Committed", "Queued")).toThrow(InvalidSessionTransitionError);
    expect(requireTransition("Queued", "ProcessingBarcode")).toBe("ProcessingBarcode");
  });

  it("has plain-English progress wording for every state", () => {
    for (const status of recognitionSessionStatuses) {
      const label = progressLabel(status);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/[A-Z]{2,}|_/u);
    }
  });
});
