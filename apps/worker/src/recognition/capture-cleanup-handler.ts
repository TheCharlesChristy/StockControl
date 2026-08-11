import type { Kysely } from "kysely";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";
import type { StructuredLogger } from "@stockcontrol/platform";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";

import type { ImageStorage } from "./image-storage";

/*
 * The "DeleteObjects" job handler, specification section 15: every
 * photograph a capture session ever held is deleted from the Bucket no later
 * than 24 hours after it was declared, whether the session was committed,
 * cancelled, or simply abandoned. `stock-capture.service.ts` enqueues this on
 * commit and cancellation; `capture-expiry-sweeper.ts` is the backstop for
 * every other way a session can stop moving.
 *
 * Deleting is idempotent by design — S3-compatible `DeleteObject` succeeds on
 * a key that is already gone — so a row is only marked `deleted_at` after its
 * object delete has actually returned, and a retried job silently skips
 * whatever an earlier attempt already finished. Nothing here ever needs to
 * know why the session ended.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

export interface CaptureCleanupHandlerDependencies {
  readonly database: Kysely<StockControlDatabase>;
  readonly imageStorage: ImageStorage;
  readonly logger: StructuredLogger;
}

export const createCaptureCleanupHandler = (
  dependencies: CaptureCleanupHandlerDependencies,
): ((job: BackgroundJobEnvelope<{ readonly sessionId: string }>) => Promise<void>) => {
  const { database, imageStorage, logger } = dependencies;

  return async (job) => {
    const { sessionId } = job.payload;

    const images = await database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_images")
      .select(["id", "object_key"])
      .where("session_id", "=", sessionId)
      .where("deleted_at", "is", null)
      .execute();

    let deletedCount = 0;

    for (const image of images) {
      await imageStorage.deleteObject(image.object_key);

      await database
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_images")
        .set({ status: "Deleted", deleted_at: new Date() })
        .where("id", "=", image.id)
        .where("deleted_at", "is", null)
        .execute();

      deletedCount += 1;
    }

    logger.log({
      event: "capture.cleanup.completed",
      sessionId,
      deletedCount,
    });
  };
};
