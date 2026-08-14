import type {
  RecognitionAnalysisOutcome,
  RecognitionSessionStatus,
  RecognitionStage,
  RecognitionStageOutcome,
} from "@stockcontrol/contracts";

/*
 * Telling "we looked and found nothing" apart from "nothing looked".
 *
 * The pipeline degrades stage by stage: an installation without
 * recognition-core has no label text, one without recognition-fusion has no
 * photo analysis, one without a Brave key checks no manufacturer page. Every
 * one of those produces a session that reaches ReviewReady with no
 * candidates — exactly what a fully-equipped installation produces for an
 * item it genuinely cannot place. The two mean opposite things to whoever is
 * holding the stock, and until this rule existed the screen said the same
 * words for both.
 */

/** The stage outcomes a session recorded, in the shape the view carries. */
export interface StageOutcomeSummary {
  readonly stage: RecognitionStage;
  readonly outcome: RecognitionStageOutcome;
}

/** A stage that reached a conclusion, whether or not that conclusion was a match. */
const concluded = (outcome: RecognitionStageOutcome): boolean =>
  outcome === "Succeeded" || outcome === "NotApplicable";

/** A stage that could not run, so its silence carries no information. */
const silent = (outcome: RecognitionStageOutcome): boolean =>
  outcome === "Unavailable" || outcome === "Failed";

export interface AnalysisOutcomeInput {
  readonly status: RecognitionSessionStatus;
  readonly stageReports: readonly StageOutcomeSummary[];
}

/**
 * What to tell a person about a result that contains nothing.
 *
 * A session still working is `Partial` rather than `Completed`: it has not
 * finished, so the absence of candidates so far means nothing yet.
 */
export const analysisOutcomeFrom = (input: AnalysisOutcomeInput): RecognitionAnalysisOutcome => {
  if (input.status === "Failed" || input.status === "Expired") return "Failed";

  /*
   * `Cancelled` belongs here rather than with the working statuses: nothing
   * further is going to run, so whatever the record already holds is the whole
   * story. Calling it `Partial` would say the analysis is still going when
   * somebody has just stopped it — and a session cancelled before anything
   * looked reads as `NotRun`, which is exactly what happened.
   */
  const settled =
    input.status === "ReviewReady" || input.status === "Committed" || input.status === "Cancelled";
  if (!settled) return "Partial";

  /* No record at all is the honest "nothing looked": a session that ran the
   * pipeline always records what each stage did, even when every one of them
   * found nothing. */
  if (input.stageReports.length === 0) return "NotRun";

  const anyConcluded = input.stageReports.some((report) => concluded(report.outcome));
  if (!anyConcluded) return "NotRun";

  const anySilent = input.stageReports.some((report) => silent(report.outcome));
  return anySilent ? "Partial" : "Completed";
};
