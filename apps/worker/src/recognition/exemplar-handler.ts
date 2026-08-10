import { randomUUID } from "node:crypto";

import type { Kysely } from "kysely";

import type { BackgroundJobEnvelope } from "@stockcontrol/contracts";
import type { StructuredLogger } from "@stockcontrol/platform";
import type { STOCKCONTROL_SCHEMA, StockControlDatabase } from "@stockcontrol/platform-database";

import { RecognitionCoreClient, type CoreCropBox, type CoreImageQuality } from "./core-client";
import type { ImageStorage } from "./image-storage";
import type { RecognitionPipelineConfiguration } from "./recognition-configuration";

/*
 * The "BuildExemplars" job handler, specification section 9.1's
 * `/v1/render-exemplar` half. Only a human-confirmed commit ever reaches
 * this handler — `stock-capture.service.ts` enqueues it in the same
 * transaction as the receipt, never speculatively — and it re-crops
 * evidence the "Recognize" job already gathered rather than calling
 * recognition-core a second time for the same photograph.
 *
 * An item accrues at most `MAX_EXEMPLARS_PER_ITEM` active exemplars, ever.
 * That budget is spent across every commit that ever runs this job for the
 * item, not per run: once it is spent, later commits build none.
 */

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";
const MAX_EXEMPLARS_PER_ITEM = 3;

interface StoredImageEvidence {
  readonly crops: readonly CoreCropBox[];
  readonly quality: CoreImageQuality | null;
}

/** Reads back exactly what `persistImageEvidence` (recognition-handler.ts)
 * wrote. Tolerant of anything else: an image the Recognize job never
 * reached (an exact barcode match needs none) simply contributes nothing. */
const parseStoredEvidence = (raw: unknown): StoredImageEvidence => {
  if (typeof raw !== "object" || raw === null) return { crops: [], quality: null };
  const record = raw as Record<string, unknown>;
  const crops = Array.isArray(record.crops) ? (record.crops as CoreCropBox[]) : [];
  const quality =
    typeof record.quality === "object" && record.quality !== null
      ? (record.quality as CoreImageQuality)
      : null;
  return { crops, quality };
};

const qualityScoreOf = (quality: CoreImageQuality | null): number => {
  if (quality === null) return 0.5;
  const combined = (quality.blurScore + quality.foregroundAreaRatio) / 2;
  return Math.min(1, Math.max(0, combined));
};

export interface ExemplarHandlerDependencies {
  readonly database: Kysely<StockControlDatabase>;
  readonly imageStorage: ImageStorage;
  readonly configuration: RecognitionPipelineConfiguration;
  readonly logger: StructuredLogger;
}

export const createExemplarHandler = (
  dependencies: ExemplarHandlerDependencies,
): ((
  job: BackgroundJobEnvelope<{ readonly sessionId: string; readonly itemId: string }>,
) => Promise<void>) => {
  const { database, imageStorage, configuration, logger } = dependencies;

  return async (job) => {
    const { sessionId, itemId } = job.payload;

    if (configuration.recognitionCoreUrl === undefined) {
      logger.log({ event: "capture.exemplar.core_unavailable", sessionId, itemId });
      return;
    }

    const active = await database
      .withSchema(SCHEMA)
      .selectFrom("item_visual_examples")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("item_id", "=", itemId)
      .where("retired_at", "is", null)
      .executeTakeFirstOrThrow();

    const budget = MAX_EXEMPLARS_PER_ITEM - Number(active.count);
    if (budget <= 0) {
      logger.log({ event: "capture.exemplar.budget_exhausted", sessionId, itemId });
      return;
    }

    const session = await database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .select("actor_user_id")
      .where("id", "=", sessionId)
      .executeTakeFirst();
    if (session === undefined) {
      logger.log({ event: "capture.exemplar.session_missing", sessionId, itemId });
      return;
    }

    const images = await database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_images")
      .select(["id", "ordinal", "object_key", "embedding", "embedding_model", "crop_metadata"])
      .where("session_id", "=", sessionId)
      .where("status", "=", "Verified")
      .where("embedding", "is not", null)
      .orderBy("ordinal")
      .execute();

    const client = new RecognitionCoreClient({
      baseUrl: configuration.recognitionCoreUrl,
      timeoutMilliseconds: configuration.recognitionCoreTimeoutMilliseconds,
    });

    let built = 0;
    for (const image of images) {
      if (built >= budget) break;
      if (image.embedding === null || image.embedding_model === null) continue;

      const { crops, quality } = parseStoredEvidence(image.crop_metadata);
      const crop = crops[0];
      if (crop === undefined) continue;

      try {
        const downloaded = await imageStorage.getObject(image.object_key);
        const rendered = await client.renderExemplar(
          { ordinal: image.ordinal, bytes: downloaded.bytes, mediaType: downloaded.mediaType },
          crop,
        );

        const exemplarKey = `stock-capture/exemplars/${itemId}/${randomUUID()}.webp`;
        await imageStorage.putObject(exemplarKey, rendered.bytes, rendered.mediaType);

        await database
          .withSchema(SCHEMA)
          .insertInto("item_visual_examples")
          .values({
            id: randomUUID(),
            item_id: itemId,
            embedding: image.embedding,
            embedding_model: image.embedding_model,
            crop_object_key: exemplarKey,
            source_session_id: sessionId,
            source_image_id: image.id,
            verified_by_user_id: session.actor_user_id,
            quality_score: qualityScoreOf(quality),
          })
          .onConflict((conflict) => conflict.column("crop_object_key").doNothing())
          .execute();

        built += 1;
      } catch (error: unknown) {
        logger.error({
          event: "capture.exemplar.render_failed",
          sessionId,
          itemId,
          imageId: image.id,
          errorName: error instanceof Error ? error.name : "Unknown",
        });
      }
    }

    logger.log({ event: "capture.exemplar.completed", sessionId, itemId, built });
  };
};
