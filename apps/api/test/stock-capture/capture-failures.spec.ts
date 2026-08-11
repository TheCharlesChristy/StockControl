import { ApplicationFailureException } from "@stockcontrol/platform";
import { describe, expect, it } from "vitest";

import {
  ambiguousIdentifier,
  batchNotOpen,
  captureDisabled,
  captureNotFound,
  idempotencyConflict,
  itemChanged,
  locationUnavailable,
  recognitionUnavailable,
  sessionExpired,
  sessionNotReady,
  uploadInvalid,
} from "../../src/stock-capture/capture-failures";

describe("capture failure vocabulary", () => {
  it.each([
    ["capture.batch_not_open", 422, batchNotOpen()],
    ["capture.session_not_ready", 422, sessionNotReady()],
    ["capture.session_expired", 410, sessionExpired()],
    ["capture.recognition_unavailable", 404, recognitionUnavailable()],
    ["capture.idempotency_conflict", 409, idempotencyConflict()],
    ["capture.ambiguous_identifier", 422, ambiguousIdentifier()],
    ["capture.item_changed", 422, itemChanged()],
    ["capture.location_unavailable", 422, locationUnavailable()],
    ["capture.disabled", 404, captureDisabled()],
  ])("maps %s to status %d", (code, status, exception) => {
    expect(exception).toBeInstanceOf(ApplicationFailureException);
    expect(exception.failure.code).toBe(code);
    expect(exception.getStatus()).toBe(status);
  });

  it("carries the caller's detail on an upload failure", () => {
    const failure = uploadInvalid("Retake photo 2.");
    expect(failure.failure).toMatchObject({
      code: "capture.upload_invalid",
      detail: "Retake photo 2.",
    });
    expect(failure.getStatus()).toBe(422);
  });

  /*
   * Never discloses whose row it collided with — the same code and a fixed
   * detail regardless of what the real conflict was.
   */
  it("says nothing about the request an idempotency conflict collided with", () => {
    expect(idempotencyConflict().failure.detail).not.toMatch(/user|actor|owner/iu);
  });

  /* Ownership reads as not-found, sharing the generic resource-unavailable code. */
  it("hides ownership behind the same code every other missing resource uses", () => {
    const notFound = captureNotFound("That batch");
    expect(notFound.getStatus()).toBe(404);
    expect(notFound.failure.detail).toBe("That batch could not be found.");
  });

  it("keeps every stable code in the dotted lower-case family the rest of the API uses", () => {
    for (const exception of [
      captureDisabled(),
      batchNotOpen(),
      sessionNotReady(),
      sessionExpired(),
      recognitionUnavailable(),
      idempotencyConflict(),
      ambiguousIdentifier(),
      itemChanged(),
      locationUnavailable(),
    ]) {
      expect(exception.failure.code).toMatch(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]+)+$/u);
    }
  });
});
