import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type { StructuredLogger } from "@stockcontrol/platform";
import {
  enqueueJob,
  type STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";

/*
 * The backstop the heartbeat runs, specification sections 10 and 15. Two
 * things can leave a capture session's photographs sitting in the Bucket
 * with nobody left to finish the job that would otherwise queue their
 * deletion:
 *
 *  - a session nobody ever returns to. Its own expiry (`expires_at`) is the
 *    signal — this sweep is what actually turns `AwaitingUpload`/`Queued`/…
 *    into `Expired` and queues the same "DeleteObjects" job commit and
 *    cancel already use.
 *  - the 30-day hard limit on any image (`delete_after`), independent of
 *    the session's own state. This exists because "the session moved on
 *    normally" and "its cleanup job actually ran" are different claims —
 *    a crash between the two, or a code path that forgot to schedule one,
 *    must not be the reason bytes outlive the limit the specification sets.
 *
 * Both branches enqueue through the session's `delete-objects:<id>`
 * deduplication key, so scheduling it twice is a no-op rather than a race.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";
const TERMINAL_STATUSES = ["Committed", "Cancelled", "Expired"] as const;

const scheduleDeletion = (
  tx: Transaction<StockControlDatabase>,
  sessionId: string,
): Promise<boolean> =>
  enqueueJob(tx, {
    id: randomUUID(),
    sessionId,
    jobType: "DeleteObjects",
    payloadVersion: 1,
    payload: { sessionId },
    deduplicationKey: `delete-objects:${sessionId}`,
    maxAttempts: 10,
  });

export interface CaptureLifecycleSweepResult {
  readonly expiredSessions: number;
  readonly backstoppedSessions: number;
}

export const sweepCaptureLifecycle = async (
  database: Kysely<StockControlDatabase>,
  logger: StructuredLogger,
  now: Date = new Date(),
): Promise<CaptureLifecycleSweepResult> => {
  const expiring = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_recognition_sessions")
    .select("id")
    .where("expires_at", "<=", now)
    .where("status", "not in", TERMINAL_STATUSES)
    .execute();

  let expiredSessions = 0;
  for (const session of expiring) {
    const moved = await database.transaction().execute(async (tx) => {
      const result = await tx
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_sessions")
        .set({ status: "Expired", failure_code: "capture.session_expired", updated_at: now })
        .where("id", "=", session.id)
        .where("status", "not in", TERMINAL_STATUSES)
        .executeTakeFirst();

      if (Number(result.numUpdatedRows) === 0) return false;
      await scheduleDeletion(tx, session.id);
      return true;
    });

    if (moved) expiredSessions += 1;
  }

  const overdue = await database
    .withSchema(SCHEMA)
    .selectFrom("stock_recognition_images")
    .select("session_id")
    .where("delete_after", "<=", now)
    .where("deleted_at", "is", null)
    .groupBy("session_id")
    .execute();

  let backstoppedSessions = 0;
  for (const row of overdue) {
    const enqueued = await database
      .transaction()
      .execute((tx) => scheduleDeletion(tx, row.session_id));
    if (enqueued) backstoppedSessions += 1;
  }

  if (expiredSessions > 0 || backstoppedSessions > 0) {
    logger.log({ event: "capture.lifecycle.swept", expiredSessions, backstoppedSessions });
  }

  return { expiredSessions, backstoppedSessions };
};
