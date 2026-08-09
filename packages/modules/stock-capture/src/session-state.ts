import type { RecognitionSessionStatus } from "@stockcontrol/contracts";

/*
 * The session state machine from specification section 7.1, as data.
 *
 * It is written as an explicit transition table rather than a series of `if`
 * statements because the worker, the API and the tests all need to agree on
 * exactly one question: given the state a row is in now, is this write still
 * the newest thing that happened to it? A late model result arriving after a
 * cancellation must lose, and the only way to be sure of that is a table
 * somebody can read.
 */

const TRANSITIONS: Readonly<Record<RecognitionSessionStatus, readonly RecognitionSessionStatus[]>> =
  Object.freeze({
    AwaitingUpload: ["Queued", "ReviewReady", "Failed", "Cancelled", "Expired"],
    Queued: ["ProcessingBarcode", "Failed", "Cancelled", "Expired"],
    ProcessingBarcode: ["ProcessingImages", "ReviewReady", "Failed", "Cancelled", "Expired"],
    ProcessingImages: ["Enriching", "Failed", "Cancelled", "Expired"],
    Enriching: ["Fusing", "Failed", "Cancelled", "Expired"],
    Fusing: ["ReviewReady", "Failed", "Cancelled", "Expired"],
    ReviewReady: ["Committed", "Cancelled", "Expired"],
    Committed: [],
    Failed: [],
    Cancelled: [],
    Expired: [],
  });

/**
 * `AwaitingUpload -> ReviewReady` is the exact-barcode path: a session that
 * resolved from a code alone never uploads a photograph, but still requires a
 * person to confirm.
 */
export const canTransition = (
  from: RecognitionSessionStatus,
  to: RecognitionSessionStatus,
): boolean => TRANSITIONS[from].includes(to);

export const isTerminal = (status: RecognitionSessionStatus): boolean =>
  TRANSITIONS[status].length === 0;

/** States in which the worker still owns the session and may publish results. */
export const isProcessing = (status: RecognitionSessionStatus): boolean =>
  status === "Queued" ||
  status === "ProcessingBarcode" ||
  status === "ProcessingImages" ||
  status === "Enriching" ||
  status === "Fusing";

export const isReviewable = (status: RecognitionSessionStatus): boolean => status === "ReviewReady";

export class InvalidSessionTransitionError extends Error {
  public constructor(
    public readonly from: RecognitionSessionStatus,
    public readonly to: RecognitionSessionStatus,
  ) {
    super(`A recognition session cannot move from ${from} to ${to}.`);
    this.name = "InvalidSessionTransitionError";
  }
}

export const requireTransition = (
  from: RecognitionSessionStatus,
  to: RecognitionSessionStatus,
): RecognitionSessionStatus => {
  if (!canTransition(from, to)) throw new InvalidSessionTransitionError(from, to);
  return to;
};

/**
 * The status a person should see while work is queued. Polling shows words, not
 * a percentage, because the stages do not have comparable durations.
 */
export const progressLabel = (status: RecognitionSessionStatus): string => {
  switch (status) {
    case "AwaitingUpload":
      return "Waiting for the photographs";
    case "Queued":
      return "Waiting to start";
    case "ProcessingBarcode":
      return "Looking for a barcode";
    case "ProcessingImages":
      return "Reading the labels";
    case "Enriching":
      return "Checking product details";
    case "Fusing":
      return "Putting the suggestions together";
    case "ReviewReady":
      return "Ready for you to check";
    case "Committed":
      return "Added to stock";
    case "Failed":
      return "Could not identify this one";
    case "Cancelled":
      return "Cancelled";
    case "Expired":
      return "Expired";
  }
};
