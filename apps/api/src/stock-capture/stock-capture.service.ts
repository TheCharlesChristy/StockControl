import { createHash, randomUUID } from "node:crypto";

import type {
  CaptureUploadGrant,
  CaptureUploadGrantResponse,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import {
  canonicalRequest,
  describeImageProblem,
  validateImageDeclarations,
  type DeclaredImage,
} from "@stockcontrol/module-stock-capture";
import {
  enqueueJob,
  type STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

import { S3PrivateObjectStorage, type PresigningObjectStorage } from "../media/media-storage";
import type { ItemDetailOptions } from "../persistence/read-models";
import { readLocalCodes, resolveLocalCodes } from "./barcode-resolution";
import type { StockCaptureConfiguration } from "./capture-configuration";
import {
  batchNotOpen,
  captureNotFound,
  idempotencyConflict,
  sessionExpired,
  sessionNotReady,
  uploadInvalid,
} from "./capture-failures";
import { presentRecognitionSession } from "./recognition-presenter";

const SCHEMA: typeof STOCKCONTROL_SCHEMA = "stockcontrol";

type CaptureTransaction = Transaction<StockControlDatabase>;

const hashOf = (canonical: string): string =>
  createHash("sha256").update(canonical, "utf8").digest("hex");

export interface StartBatchCommand {
  readonly actorUserId: string;
  readonly clientBatchId: string;
  readonly defaultLocationId: string | null;
}

export interface StartSessionCommand {
  readonly actorUserId: string;
  readonly clientSessionId: string;
  readonly batchId: string;
  readonly photoCount: number;
  readonly localCodes: readonly unknown[];
}

export interface StartSessionResult {
  readonly session: RecognitionSessionSummaryView;
  /** Present when a barcode resolved without any photograph being uploaded. */
  readonly exactItemId: string | null;
  readonly exactItemIsActive: boolean;
}

export interface RequestUploadsCommand {
  readonly actorUserId: string;
  readonly sessionId: string;
  readonly images: readonly DeclaredImage[];
}

/**
 * Batches, sessions and uploads. Everything a browser can reach before a
 * person has confirmed anything, which is why every method takes the actor and
 * scopes its queries by it rather than trusting the UUID in the path.
 */
export class StockCaptureService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly configuration: StockCaptureConfiguration,
    private readonly storage: PresigningObjectStorage = new S3PrivateObjectStorage(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Opens a batch, or returns the one this id already opened.
   *
   * The client picks the id so a lost response is not a lost batch. What makes
   * the replay safe is the hash: the same id with the same request returns the
   * original, and the same id with a different request is a conflict rather
   * than a silent overwrite of somebody's default location.
   */
  public async startBatch(command: StartBatchCommand): Promise<StockCaptureBatchView> {
    const requestHash = hashOf(
      canonicalRequest("start-batch", {
        actorUserId: command.actorUserId,
        defaultLocationId: command.defaultLocationId,
      }),
    );

    await this.database
      .withSchema(SCHEMA)
      .insertInto("stock_capture_batches")
      .values({
        id: command.clientBatchId,
        actor_user_id: command.actorUserId,
        default_location_id: command.defaultLocationId,
        request_hash: requestHash,
      })
      .onConflict((conflict) => conflict.column("id").doNothing())
      .execute();

    const batch = await this.loadOwnedBatch(command.clientBatchId, command.actorUserId);

    if (batch.request_hash !== requestHash) throw idempotencyConflict();

    return this.presentBatch(command.clientBatchId, command.actorUserId);
  }

  public async getBatch(batchId: string, actorUserId: string): Promise<StockCaptureBatchView> {
    await this.loadOwnedBatch(batchId, actorUserId);
    return this.presentBatch(batchId, actorUserId);
  }

  public async completeBatch(batchId: string, actorUserId: string): Promise<StockCaptureBatchView> {
    const batch = await this.loadOwnedBatch(batchId, actorUserId);

    if (batch.status === "Open") {
      await this.database
        .withSchema(SCHEMA)
        .updateTable("stock_capture_batches")
        .set({ status: "Completed", closed_at: this.now(), updated_at: this.now() })
        .where("id", "=", batchId)
        .where("actor_user_id", "=", actorUserId)
        .where("status", "=", "Open")
        .execute();
    }

    return this.presentBatch(batchId, actorUserId);
  }

  /**
   * Creates a recognition session, and decides in the same breath whether any
   * photograph needs uploading at all.
   *
   * The session and its recognition job are inserted in one transaction. A
   * session without its job would sit queued forever; a job without its
   * session would fail on the first attempt.
   */
  public async startSession(command: StartSessionCommand): Promise<StartSessionResult> {
    const observations = readLocalCodes(command.localCodes);
    const requestHash = hashOf(
      canonicalRequest("start-session", {
        actorUserId: command.actorUserId,
        batchId: command.batchId,
        photoCount: command.photoCount,
        codes: observations.map((code) => `${code.symbology}:${code.value}`).sort(),
      }),
    );

    const batch = await this.loadOwnedBatch(command.batchId, command.actorUserId);
    if (batch.status !== "Open") throw batchNotOpen();

    const existing = await this.findSession(command.clientSessionId, command.actorUserId);
    if (existing !== undefined) {
      if (existing.request_hash !== requestHash) throw idempotencyConflict();
      return {
        session: this.presentSession(existing),
        exactItemId: existing.committed_item_id,
        exactItemIsActive: true,
      };
    }

    const resolution = await resolveLocalCodes(this.database, observations);

    /*
     * Ambiguity suppresses the short cut rather than failing: the full
     * pipeline is exactly the thing that can sort out which item it was.
     */
    const takeShortCut = resolution.outcome.kind === "ExactMatch";
    const expiresAt = new Date(
      this.now().getTime() + this.configuration.sessionLifetimeSeconds * 1_000,
    );

    const row = await this.database.transaction().execute(async (tx) => {
      const inserted = await tx
        .withSchema(SCHEMA)
        .insertInto("stock_recognition_sessions")
        .values({
          id: command.clientSessionId,
          batch_id: command.batchId,
          actor_user_id: command.actorUserId,
          request_hash: requestHash,
          status: takeShortCut ? "ReviewReady" : "AwaitingUpload",
          photo_count: takeShortCut ? 0 : command.photoCount,
          local_codes: JSON.stringify(observations),
          model_manifest: JSON.stringify({ pipeline: "barcode-only" }),
          expires_at: expiresAt,
        })
        .onConflict((conflict) => conflict.column("id").doNothing())
        .returningAll()
        .executeTakeFirst();

      if (inserted === undefined) return undefined;

      /* `takeShortCut` already narrows `resolution.outcome` to the exact-match case. */
      if (takeShortCut) {
        await this.publishExactCandidate(tx, command.clientSessionId, resolution.outcome);
      }

      return inserted;
    });

    if (row === undefined) {
      /* Two requests raced on the same client id; the loser reads the winner. */
      const winner = await this.findSession(command.clientSessionId, command.actorUserId);
      if (winner === undefined) throw idempotencyConflict();
      if (winner.request_hash !== requestHash) throw idempotencyConflict();
      return { session: this.presentSession(winner), exactItemId: null, exactItemIsActive: true };
    }

    return {
      session: this.presentSession(row),
      exactItemId: resolution.outcome.kind === "ExactMatch" ? resolution.outcome.itemId : null,
      exactItemIsActive:
        resolution.outcome.kind === "ExactMatch" ? resolution.outcome.isActive : true,
    };
  }

  /**
   * Issues one short-lived write grant per declared photograph.
   *
   * Object keys are generated here and never accepted from the client. A
   * client-chosen key is a client-chosen destination, and a grant is a grant to
   * write wherever the key points.
   */
  public async requestUploads(command: RequestUploadsCommand): Promise<CaptureUploadGrantResponse> {
    const session = await this.requireSession(command.sessionId, command.actorUserId);

    if (session.status !== "AwaitingUpload") throw sessionNotReady();
    if (session.expires_at.getTime() <= this.now().getTime()) throw sessionExpired();

    const problems = validateImageDeclarations(command.images);
    if (problems.length > 0) {
      throw uploadInvalid(problems.map(describeImageProblem).join(" "));
    }

    if (command.images.length !== session.photo_count) {
      throw uploadInvalid("Those photographs do not match the ones this item started with.");
    }

    const grants: CaptureUploadGrant[] = [];

    for (const image of command.images) {
      const imageId = randomUUID();
      const objectKey = `stock-capture/${command.sessionId}/${String(image.ordinal)}-${imageId}`;

      const grant = await this.storage.createPresignedUpload({
        key: objectKey,
        mediaType: image.mediaType,
        expiresInSeconds: this.configuration.uploadGrantSeconds,
      });

      await this.database
        .withSchema(SCHEMA)
        .insertInto("stock_recognition_images")
        .values({
          id: imageId,
          session_id: command.sessionId,
          ordinal: image.ordinal,
          object_key: objectKey,
          sha256: image.sha256,
          media_type: image.mediaType === "image/webp" ? "image/webp" : "image/jpeg",
          byte_length: image.byteLength,
          width: image.width,
          height: image.height,
          /* The hard limit from section 15, whatever else happens to the job. */
          delete_after: new Date(this.now().getTime() + 24 * 60 * 60 * 1_000),
        })
        .onConflict((conflict) => conflict.columns(["session_id", "ordinal"]).doNothing())
        .execute();

      grants.push({
        imageId,
        ordinal: image.ordinal,
        url: grant.url,
        mediaType: image.mediaType === "image/webp" ? "image/webp" : "image/jpeg",
        expiresAt: grant.expiresAt.toISOString(),
      });
    }

    return { session: this.presentSession(session), grants };
  }

  /**
   * Accepts the browser's word that the uploads finished, and queues the work.
   *
   * "Accepts the browser's word" is precise: this only moves the session into
   * the queue. Nothing here has seen the bytes, and the worker re-checks magic
   * bytes, dimensions, digest and decompression on what actually arrived
   * before any model is given it.
   */
  public async completeUploads(
    sessionId: string,
    actorUserId: string,
  ): Promise<RecognitionSessionSummaryView> {
    const session = await this.requireSession(sessionId, actorUserId);

    if (session.status === "Queued") return this.presentSession(session);
    if (session.status !== "AwaitingUpload") throw sessionNotReady();
    if (session.expires_at.getTime() <= this.now().getTime()) throw sessionExpired();

    const declared = await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_images")
      .select("id")
      .where("session_id", "=", sessionId)
      .execute();

    if (declared.length !== session.photo_count || declared.length === 0) {
      throw uploadInvalid("Not every photograph finished uploading. Try again.");
    }

    const updated = await this.database.transaction().execute(async (tx) => {
      const moved = await tx
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_sessions")
        .set({ status: "Queued", updated_at: this.now() })
        .where("id", "=", sessionId)
        .where("actor_user_id", "=", actorUserId)
        .where("status", "=", "AwaitingUpload")
        .returningAll()
        .executeTakeFirst();

      if (moved === undefined) return undefined;

      await enqueueJob(tx, {
        id: randomUUID(),
        sessionId,
        jobType: "Recognize",
        payloadVersion: 1,
        payload: { sessionId },
        deduplicationKey: `recognize:${sessionId}`,
        maxAttempts: this.configuration.recognitionMaxAttempts,
      });

      return moved;
    });

    if (updated === undefined) {
      const current = await this.requireSession(sessionId, actorUserId);
      return this.presentSession(current);
    }

    return this.presentSession(updated);
  }

  /** Cancels uncommitted work and schedules the photographs for deletion. */
  public async cancelSession(
    sessionId: string,
    actorUserId: string,
  ): Promise<RecognitionSessionSummaryView> {
    const session = await this.requireSession(sessionId, actorUserId);

    if (session.status === "Committed") throw sessionNotReady();
    if (session.status === "Cancelled") return this.presentSession(session);

    const cancelled = await this.database.transaction().execute(async (tx) => {
      const moved = await tx
        .withSchema(SCHEMA)
        .updateTable("stock_recognition_sessions")
        .set({ status: "Cancelled", updated_at: this.now() })
        .where("id", "=", sessionId)
        .where("actor_user_id", "=", actorUserId)
        .where("status", "!=", "Committed")
        .returningAll()
        .executeTakeFirst();

      if (moved === undefined) return undefined;

      await this.scheduleObjectDeletion(tx, sessionId);
      return moved;
    });

    if (cancelled === undefined) throw sessionNotReady();
    return this.presentSession(cancelled);
  }

  /** The full review view: candidates, evidence, and the manual-entry hint. */
  public async getSession(
    sessionId: string,
    actorUserId: string,
    viewer: ItemDetailOptions,
  ): Promise<RecognitionSessionView> {
    await this.requireSession(sessionId, actorUserId);
    return presentRecognitionSession(this.database, sessionId, viewer);
  }

  /**
   * Queues the janitor. Deduplicated per session so cancelling twice, or
   * cancelling after a commit already queued it, does not create a second job.
   */
  public async scheduleObjectDeletion(tx: CaptureTransaction, sessionId: string): Promise<void> {
    await enqueueJob(tx, {
      id: randomUUID(),
      sessionId,
      jobType: "DeleteObjects",
      payloadVersion: 1,
      payload: { sessionId },
      deduplicationKey: `delete-objects:${sessionId}`,
      maxAttempts: 10,
    });
  }

  private async publishExactCandidate(
    tx: CaptureTransaction,
    sessionId: string,
    match: { readonly itemId: string; readonly isActive: boolean },
  ): Promise<void> {
    await tx
      .withSchema(SCHEMA)
      .insertInto("stock_recognition_candidates")
      .values({
        id: randomUUID(),
        session_id: sessionId,
        rank: 1,
        kind: "InternalItem",
        item_id: match.itemId,
        identity: JSON.stringify({}),
        /*
         * A validated barcode that resolves to exactly one active item is the
         * one piece of evidence that earns Strong without a model. It still
         * requires a person to confirm.
         */
        confidence_band: "Strong",
        fusion_score: 100,
        evidence: JSON.stringify([
          { stage: "Barcode", imageOrdinals: [], summary: "barcode", sourceUrl: null },
        ]),
        model_manifest: JSON.stringify({ pipeline: "barcode-only" }),
      })
      .onConflict((conflict) => conflict.columns(["session_id", "rank"]).doNothing())
      .execute();
  }

  private async loadOwnedBatch(
    batchId: string,
    actorUserId: string,
  ): Promise<{
    readonly id: string;
    readonly status: string;
    readonly request_hash: string;
  }> {
    const batch = await this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_capture_batches")
      .select(["id", "status", "request_hash"])
      .where("id", "=", batchId)
      .where("actor_user_id", "=", actorUserId)
      .executeTakeFirst();

    /*
     * Another person's batch reads as missing rather than forbidden. Telling a
     * caller that a UUID exists but is not theirs is a way of confirming
     * records they cannot see.
     */
    if (batch === undefined) throw captureNotFound("That capture session");

    return batch;
  }

  private async findSession(
    sessionId: string,
    actorUserId: string,
  ): Promise<SessionRow | undefined> {
    return this.database
      .withSchema(SCHEMA)
      .selectFrom("stock_recognition_sessions")
      .selectAll()
      .where("id", "=", sessionId)
      .where("actor_user_id", "=", actorUserId)
      .executeTakeFirst();
  }

  private async requireSession(sessionId: string, actorUserId: string): Promise<SessionRow> {
    const session = await this.findSession(sessionId, actorUserId);
    if (session === undefined) throw captureNotFound("That item");
    return session;
  }

  private presentSession(row: SessionRow): RecognitionSessionSummaryView {
    return {
      id: row.id,
      status: row.status,
      photoCount: row.photo_count,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
      committedItemId: row.committed_item_id,
      failureCode: row.failure_code,
    };
  }

  private async presentBatch(batchId: string, actorUserId: string): Promise<StockCaptureBatchView> {
    const [batch, sessions, entries] = await Promise.all([
      this.database
        .withSchema(SCHEMA)
        .selectFrom("stock_capture_batches")
        .selectAll()
        .where("id", "=", batchId)
        .where("actor_user_id", "=", actorUserId)
        .executeTakeFirstOrThrow(),
      this.database
        .withSchema(SCHEMA)
        .selectFrom("stock_recognition_sessions")
        .selectAll()
        .where("batch_id", "=", batchId)
        .orderBy("created_at")
        .limit(200)
        .execute(),
      this.database
        .withSchema(SCHEMA)
        .selectFrom("stock_capture_entries")
        .select("id")
        .where("batch_id", "=", batchId)
        .where("status", "=", "Committed")
        .execute(),
    ]);

    return {
      id: batch.id,
      status: batch.status,
      defaultLocationId: batch.default_location_id,
      createdAt: batch.created_at.toISOString(),
      closedAt: batch.closed_at?.toISOString() ?? null,
      sessions: sessions.map((session) => this.presentSession(session)),
      committedEntryCount: entries.length,
    };
  }
}

interface SessionRow {
  readonly id: string;
  readonly batch_id: string;
  readonly actor_user_id: string;
  readonly request_hash: string;
  readonly status: RecognitionSessionSummaryView["status"];
  readonly photo_count: number;
  readonly committed_item_id: string | null;
  readonly failure_code: string | null;
  readonly created_at: Date;
  readonly expires_at: Date;
}
