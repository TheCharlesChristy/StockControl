import { describe, expect, it } from "vitest";

import { analysisOutcomeFrom, type StageOutcomeSummary } from "../src/analysis-outcome";

const stage = (
  stageName: StageOutcomeSummary["stage"],
  outcome: StageOutcomeSummary["outcome"],
): StageOutcomeSummary => ({ stage: stageName, outcome });

describe("analysisOutcomeFrom", () => {
  it("reports a finished run where every stage concluded as Completed", () => {
    expect(
      analysisOutcomeFrom({
        status: "ReviewReady",
        stageReports: [stage("Ocr", "Succeeded"), stage("Vlm", "Succeeded")],
      }),
    ).toBe("Completed");
  });

  it("counts a stage that had nothing to do as having concluded", () => {
    expect(
      analysisOutcomeFrom({
        status: "ReviewReady",
        stageReports: [stage("Ocr", "Succeeded"), stage("VisualExample", "NotApplicable")],
      }),
    ).toBe("Completed");
  });

  /*
   * The distinction this whole rule exists for. An installation missing
   * recognition-fusion still runs OCR, so it can honestly say it looked — but
   * not that it looked properly, and "no match" from a half-run pipeline is
   * not evidence the item is unknown.
   */
  it("reports a run with an unavailable stage as Partial", () => {
    expect(
      analysisOutcomeFrom({
        status: "ReviewReady",
        stageReports: [stage("Ocr", "Succeeded"), stage("Vlm", "Unavailable")],
      }),
    ).toBe("Partial");
  });

  it("reports a run with a failed stage as Partial", () => {
    expect(
      analysisOutcomeFrom({
        status: "ReviewReady",
        stageReports: [stage("Ocr", "Succeeded"), stage("Web", "Failed")],
      }),
    ).toBe("Partial");
  });

  it("reports a run where nothing could run at all as NotRun", () => {
    expect(
      analysisOutcomeFrom({
        status: "ReviewReady",
        stageReports: [
          stage("Ocr", "Unavailable"),
          stage("Category", "Unavailable"),
          stage("VisualExample", "Unavailable"),
          stage("Web", "Unavailable"),
          stage("Vlm", "Unavailable"),
        ],
      }),
    ).toBe("NotRun");
  });

  /* Sessions that predate stage recording have no stages to read, and
   * claiming they completed would be inventing a result. */
  it("reports a session that recorded no stages at all as NotRun", () => {
    expect(analysisOutcomeFrom({ status: "ReviewReady", stageReports: [] })).toBe("NotRun");
  });

  it.each(["Failed", "Expired"] as const)("reports a %s session as Failed", (status) => {
    expect(analysisOutcomeFrom({ status, stageReports: [stage("Ocr", "Succeeded")] })).toBe(
      "Failed",
    );
  });

  /* Still running is not a finding either way: no candidates yet means only
   * that the pipeline has not got there. */
  it.each(["Queued", "ProcessingImages", "Enriching", "Fusing", "AwaitingUpload"] as const)(
    "reports a session still at %s as Partial",
    (status) => {
      expect(analysisOutcomeFrom({ status, stageReports: [] })).toBe("Partial");
    },
  );

  it("treats a committed session like a finished one", () => {
    expect(
      analysisOutcomeFrom({ status: "Committed", stageReports: [stage("Barcode", "Succeeded")] }),
    ).toBe("Completed");
  });
});
