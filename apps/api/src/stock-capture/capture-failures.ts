import {
  applicationFailure,
  resourceUnavailable,
  type StockCaptureFailureCode,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";

/*
 * The `capture.*` codes from specification section 10, mapped onto the
 * Problem Details vocabulary the rest of the API already uses. Following
 * `stockFailure` in stock.service.ts: one factory per family, so a route never
 * invents a second error shape and the browser has a stable code to branch on.
 */

const failure = (
  kind: "Validation" | "ResourceUnavailable" | "ResourceExpired" | "IdempotencyConflict",
  code: StockCaptureFailureCode,
  detail: string,
): ApplicationFailureException =>
  new ApplicationFailureException(applicationFailure(kind, { code, detail }));

export const captureDisabled = (): ApplicationFailureException =>
  failure(
    "ResourceUnavailable",
    "capture.disabled",
    "Assisted stock capture is not switched on for this installation.",
  );

export const batchNotOpen = (): ApplicationFailureException =>
  failure(
    "Validation",
    "capture.batch_not_open",
    "That capture session has been finished. Start a new one to add more stock.",
  );

export const sessionNotReady = (): ApplicationFailureException =>
  failure(
    "Validation",
    "capture.session_not_ready",
    "This item is still being looked at. Wait for the suggestions, or enter it yourself.",
  );

export const sessionExpired = (): ApplicationFailureException =>
  failure(
    "ResourceExpired",
    "capture.session_expired",
    "Those photographs have been deleted. Take them again to carry on.",
  );

export const uploadInvalid = (detail: string): ApplicationFailureException =>
  failure("Validation", "capture.upload_invalid", detail);

export const recognitionUnavailable = (): ApplicationFailureException =>
  failure(
    "ResourceUnavailable",
    "capture.recognition_unavailable",
    "Photograph recognition is unavailable. You can still add the item yourself.",
  );

/*
 * Deliberately says nothing about the request it collided with. The same id
 * from another person means somebody guessed or reused a UUID, and confirming
 * whose it was would tell them something about a record they cannot see.
 */
export const idempotencyConflict = (): ApplicationFailureException =>
  failure(
    "IdempotencyConflict",
    "capture.idempotency_conflict",
    "That request was already sent with different details. Start it again.",
  );

export const ambiguousIdentifier = (): ApplicationFailureException =>
  failure(
    "Validation",
    "capture.ambiguous_identifier",
    "Those codes point at more than one item. Check the suggestions and choose one.",
  );

export const itemChanged = (): ApplicationFailureException =>
  failure(
    "Validation",
    "capture.item_changed",
    "That item was edited while you were checking it. Look at it again before adding stock.",
  );

export const locationUnavailable = (): ApplicationFailureException =>
  failure(
    "Validation",
    "capture.location_unavailable",
    "Stock can only be received into an active store.",
  );

/*
 * Ownership failures read as "not found": a UUID is not a permission, and
 * confirming that a record exists but belongs to someone else would disclose
 * something about a record the caller cannot see. This is the same generic
 * `resource.unavailable` code the rest of the API uses for the same reason —
 * section 10's `capture.*` list has no bespoke code for it, and inventing one
 * that no client can usefully branch on differently would only be noise.
 */
export const captureNotFound = (what: string): ApplicationFailureException =>
  new ApplicationFailureException(resourceUnavailable({ detail: `${what} could not be found.` }));
