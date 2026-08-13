import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import type {
  CaptureUploadGrantResponse,
  RecognitionSessionSummaryView,
  RecognitionSessionView,
  StockCaptureBatchView,
} from "@stockcontrol/contracts";
import {
  createMigratorDatabase,
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashPassword } from "../src/auth/password";

/*
 * The routes exist only when `STOCK_CAPTURE_ENABLED` is set, and `app.module.ts`
 * decides that once, at import time. Vitest gives every test file its own
 * module graph, so setting the flag here and reaching `createApiApplication`
 * through a dynamic import — rather than a static one — is what makes the
 * decision land before `AppModule` is first evaluated in this process. See
 * stock-capture-disabled.db.spec.ts for the opposite setting.
 */
process.env.STOCK_CAPTURE_ENABLED = "true";
/*
 * Presigned URLs are computed locally by the AWS SDK — no network round trip —
 * so syntactically valid credentials are enough to exercise the real signing
 * path without a reachable object store.
 */
process.env.FLOOR_PLAN_S3_ENDPOINT ??= "http://127.0.0.1:9000";
process.env.FLOOR_PLAN_S3_BUCKET ??= "stockcontrol-test";
process.env.FLOOR_PLAN_S3_REGION ??= "us-east-1";
process.env.FLOOR_PLAN_S3_ACCESS_KEY ??= "test-access-key";
process.env.FLOOR_PLAN_S3_SECRET_KEY ??= "test-secret-key";
process.env.FLOOR_PLAN_S3_URL_STYLE ??= "path";

const PASSWORD = "integration-password";

interface Actor {
  readonly id: string;
  readonly email: string;
  readonly cookie: string;
}

/* Two products that canonicalise to different GTINs, plus a third nobody owns. */
const ACTIVE_ITEM_BARCODE = "5901234123457";
const ARCHIVED_ITEM_BARCODE = "036000291452";
const UNKNOWN_BARCODE = "00012345600012";

let app: NestFastifyApplication;
let migrator: Kysely<StockControlDatabase>;
let office: Actor;
let engineer: Actor;
let stranger: Actor;
let activeItemId: string;
let archivedItemId: string;
let locationId: string;

const schema = (): ReturnType<Kysely<StockControlDatabase>["withSchema"]> =>
  migrator.withSchema(STOCKCONTROL_SCHEMA);

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in",
    payload: { email, password: PASSWORD },
  });
  const cookie = response.cookies.find((candidate) => candidate.name === "stockcontrol.session");
  expect(cookie, `sign-in for ${email}: ${response.body}`).toBeDefined();
  return `stockcontrol.session=${cookie?.value ?? ""}`;
}

async function createUser(email: string, role: "Engineer" | "Office" | "Admin"): Promise<Actor> {
  const id = randomUUID();
  await schema()
    .insertInto("users")
    .values({
      id,
      email,
      display_name: `${role} capture fixture`,
      role,
      password_hash: await hashPassword(PASSWORD),
      is_active: true,
    })
    .execute();
  return { id, email, cookie: await signIn(email) };
}

async function request(
  actor: Actor | null,
  method: "DELETE" | "GET" | "PATCH" | "POST",
  url: string,
  payload?: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const options: InjectOptions = { method, url: `/api/v1${url}` };
  if (actor !== null) options.headers = { cookie: actor.cookie };
  if (payload !== undefined) options.payload = payload as NonNullable<InjectOptions["payload"]>;

  const response = await app.inject(options);
  return {
    status: response.statusCode,
    body: response.body.length === 0 ? undefined : (JSON.parse(response.body) as unknown),
  };
}

async function seedItem(input: {
  readonly reference: string;
  readonly barcode: string | null;
  readonly isActive: boolean;
}): Promise<string> {
  const id = randomUUID();
  await schema()
    .insertInto("items")
    .values({
      id,
      reference: input.reference,
      name: `${input.reference} test item`,
      unit: "ea",
      barcode: input.barcode,
      part_number: null,
      low_stock_threshold: null,
      is_active: input.isActive,
    })
    .execute();
  return id;
}

const validImage = (ordinal: number): Record<string, unknown> => ({
  ordinal,
  mediaType: "image/jpeg",
  byteLength: 500_000,
  sha256: "a".repeat(64),
  width: 1_600,
  height: 1_200,
});

async function openBatch(actor: Actor): Promise<string> {
  const clientBatchId = randomUUID();
  const response = await request(actor, "POST", "/stock-capture/batches", {
    clientBatchId,
    defaultLocationId: null,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { readonly batch: StockCaptureBatchView }).batch.id;
}

async function startSession(
  actor: Actor,
  batchId: string,
  over: {
    readonly photoCount?: number;
    readonly localCodes?: readonly unknown[];
  } = {},
): Promise<{
  readonly status: number;
  readonly session: RecognitionSessionSummaryView | undefined;
  readonly exactItemId: string | null | undefined;
}> {
  const response = await request(actor, "POST", "/stock-capture/sessions", {
    clientSessionId: randomUUID(),
    batchId,
    photoCount: over.photoCount ?? 2,
    localCodes: over.localCodes ?? [],
  });
  const body = response.body as
    | { readonly session: RecognitionSessionSummaryView; readonly exactItemId: string | null }
    | undefined;
  return { status: response.status, session: body?.session, exactItemId: body?.exactItemId };
}

const codeFor = (value: string, ordinal = 1): Record<string, unknown> => ({
  value,
  symbology: "EAN-13",
  imageOrdinal: ordinal,
  readerVersion: "test-reader-1.0",
});

describe("assisted stock capture", () => {
  beforeAll(async () => {
    const { createApiApplication } = await import("../src/bootstrap");

    const configuration = loadMigratorDatabaseConfiguration();
    const { runtimeRole } = loadMigrationDatabaseRoles(process.env, configuration.connectionString);
    migrator = createMigratorDatabase(configuration);
    await runMigrations(migrator, { runtimeRole });

    /* Order matters: capture rows reference items, locations and users. */
    await schema().deleteFrom("recognition_feedback").execute();
    await schema().deleteFrom("stock_capture_entries").execute();
    await schema().deleteFrom("item_visual_examples").execute();
    await schema().deleteFrom("stock_recognition_jobs").execute();
    await schema().deleteFrom("stock_recognition_candidates").execute();
    await schema().deleteFrom("stock_recognition_images").execute();
    await schema().deleteFrom("stock_recognition_sessions").execute();
    await schema().deleteFrom("stock_capture_batches").execute();
    await schema().deleteFrom("transactions").execute();
    await schema().deleteFrom("stock_requests").execute();
    await schema().deleteFrom("reservations").execute();
    await schema().deleteFrom("stock_levels").execute();
    await schema().deleteFrom("item_photos").execute();
    await schema().deleteFrom("items").execute();
    await schema().deleteFrom("locations").execute();
    await schema().deleteFrom("sessions").execute();
    await schema().deleteFrom("users").execute();

    app = await createApiApplication();

    office = await createUser("capture.office@example.invalid", "Office");
    engineer = await createUser("capture.engineer@example.invalid", "Engineer");
    stranger = await createUser("capture.stranger@example.invalid", "Office");

    activeItemId = await seedItem({
      reference: "CAP-ACTIVE",
      barcode: ACTIVE_ITEM_BARCODE,
      isActive: true,
    });
    archivedItemId = await seedItem({
      reference: "CAP-ARCHIVED",
      barcode: ARCHIVED_ITEM_BARCODE,
      isActive: false,
    });

    locationId = randomUUID();
    await schema()
      .insertInto("locations")
      .values({
        id: locationId,
        code: "CAP-STORE",
        name: "Capture test store",
        kind: "Store",
        job_id: null,
        is_active: true,
        map_id: null,
        geometry: null,
        derived_parent_id: null,
      })
      .execute();
  });

  afterAll(async () => {
    await app.close();

    /*
     * Every capture row this file created is scoped to these three actors, so
     * deleting by actor is precise without tracking each generated id. This
     * matters beyond tidiness: a `Ready` job left behind is a real row in the
     * shared queue table, and the worker's own integration suite runs against
     * this same database next and claims whatever it finds `Ready` — a stray
     * leftover here silently steals a claim meant for that suite's own job.
     */
    const actorIds = [office.id, engineer.id, stranger.id];
    const capturedSessions = schema()
      .selectFrom("stock_recognition_sessions")
      .select("id")
      .where("actor_user_id", "in", actorIds);

    await schema()
      .deleteFrom("stock_recognition_images")
      .where("session_id", "in", capturedSessions)
      .execute();
    await schema()
      .deleteFrom("stock_recognition_candidates")
      .where("session_id", "in", capturedSessions)
      .execute();
    await schema()
      .deleteFrom("stock_recognition_jobs")
      .where("session_id", "in", capturedSessions)
      .execute();
    await schema()
      .deleteFrom("stock_recognition_sessions")
      .where("actor_user_id", "in", actorIds)
      .execute();
    await schema()
      .deleteFrom("stock_capture_batches")
      .where("actor_user_id", "in", actorIds)
      .execute();
    await schema().deleteFrom("items").where("id", "in", [activeItemId, archivedItemId]).execute();
    await schema().deleteFrom("locations").where("id", "=", locationId).execute();
    await schema().deleteFrom("sessions").where("user_id", "in", actorIds).execute();
    await schema().deleteFrom("users").where("id", "in", actorIds).execute();

    await migrator.destroy();
  });

  describe("authentication and capability", () => {
    it("rejects an unauthenticated request", async () => {
      const response = await request(null, "POST", "/stock-capture/batches", {
        clientBatchId: randomUUID(),
        defaultLocationId: null,
      });
      expect(response.status).toBe(401);
    });

    it("rejects a role without manageStock", async () => {
      const response = await request(engineer, "POST", "/stock-capture/batches", {
        clientBatchId: randomUUID(),
        defaultLocationId: null,
      });
      expect(response.status).toBe(403);
    });
  });

  describe("batches", () => {
    it("opens a batch and reads it back", async () => {
      const clientBatchId = randomUUID();
      const started = await request(office, "POST", "/stock-capture/batches", {
        clientBatchId,
        defaultLocationId: locationId,
      });
      expect(started.status).toBe(201);
      const batch = (started.body as { readonly batch: StockCaptureBatchView }).batch;
      expect(batch).toMatchObject({
        id: clientBatchId,
        status: "Open",
        defaultLocationId: locationId,
        sessions: [],
        committedEntryCount: 0,
      });

      const fetched = await request(office, "GET", `/stock-capture/batches/${clientBatchId}`);
      expect(fetched.status).toBe(200);
      expect((fetched.body as { readonly batch: StockCaptureBatchView }).batch.id).toBe(
        clientBatchId,
      );
    });

    it("returns the original batch when the same id and request are replayed", async () => {
      const clientBatchId = randomUUID();
      const first = await request(office, "POST", "/stock-capture/batches", {
        clientBatchId,
        defaultLocationId: null,
      });
      const second = await request(office, "POST", "/stock-capture/batches", {
        clientBatchId,
        defaultLocationId: null,
      });

      expect(second.status).toBe(201);
      expect(second.body).toEqual(first.body);
    });

    /*
     * Same id, different fields: a conflict, not a silent overwrite of
     * whatever default location the first request chose.
     */
    it("refuses to reuse a batch id for a different request", async () => {
      const clientBatchId = randomUUID();
      await request(office, "POST", "/stock-capture/batches", {
        clientBatchId,
        defaultLocationId: null,
      });
      const conflicting = await request(office, "POST", "/stock-capture/batches", {
        clientBatchId,
        defaultLocationId: locationId,
      });

      expect(conflicting.status).toBe(409);
      expect((conflicting.body as { readonly code: string }).code).toBe(
        "capture.idempotency_conflict",
      );
    });

    /* Another person's UUID reads as not found, never as forbidden. */
    it("hides a batch that belongs to somebody else", async () => {
      const batchId = await openBatch(office);
      const response = await request(stranger, "GET", `/stock-capture/batches/${batchId}`);
      expect(response.status).toBe(404);
    });

    it("refuses a malformed batch id before it reaches the database", async () => {
      const response = await request(office, "GET", "/stock-capture/batches/not-a-uuid");
      expect(response.status).toBe(422);
    });

    it("completes a batch and then refuses new sessions against it", async () => {
      const batchId = await openBatch(office);

      const completed = await request(office, "POST", `/stock-capture/batches/${batchId}/complete`);
      expect(completed.status).toBe(201);
      const batch = (completed.body as { readonly batch: StockCaptureBatchView }).batch;
      expect(batch.status).toBe("Completed");
      expect(batch.closedAt).not.toBeNull();

      const session = await startSession(office, batchId);
      expect(session.status).toBe(422);
    });
  });

  describe("the exact-barcode short cut", () => {
    it("returns an active item without asking for an upload", async () => {
      const batchId = await openBatch(office);
      const result = await startSession(office, batchId, {
        photoCount: 3,
        localCodes: [codeFor(ACTIVE_ITEM_BARCODE)],
      });

      expect(result.status).toBe(201);
      expect(result.session).toMatchObject({ status: "ReviewReady", photoCount: 0 });
      expect(result.exactItemId).toBe(activeItemId);

      const reviewed = await request(
        office,
        "GET",
        `/stock-capture/sessions/${result.session?.id}`,
      );
      const session = (reviewed.body as { readonly session: RecognitionSessionView }).session;
      expect(session.candidates).toHaveLength(1);
      expect(session.candidates[0]).toMatchObject({
        kind: "InternalItem",
        confidence: "Strong",
        selectable: true,
      });
      expect(session.candidates[0]?.item?.id).toBe(activeItemId);
    });

    /*
     * An archived match is shown, not hidden — but it must not look like a
     * completed shortcut, because an archived item cannot receive stock.
     */
    it("shows an archived match without offering it as a no-upload shortcut", async () => {
      const batchId = await openBatch(office);
      const result = await startSession(office, batchId, {
        photoCount: 2,
        localCodes: [codeFor(ARCHIVED_ITEM_BARCODE)],
      });

      expect(result.session?.status).toBe("ReviewReady");
      expect(result.exactItemId).toBeNull();

      const reviewed = await request(
        office,
        "GET",
        `/stock-capture/sessions/${result.session?.id}`,
      );
      const session = (reviewed.body as { readonly session: RecognitionSessionView }).session;
      expect(session.candidates[0]).toMatchObject({ selectable: false });
      expect(session.candidates[0]?.item?.id).toBe(archivedItemId);
    });

    it("falls through to the full pipeline when two different codes are seen", async () => {
      const batchId = await openBatch(office);
      const result = await startSession(office, batchId, {
        photoCount: 2,
        localCodes: [codeFor(ACTIVE_ITEM_BARCODE, 1), codeFor(UNKNOWN_BARCODE, 2)],
      });

      expect(result.session).toMatchObject({ status: "AwaitingUpload", photoCount: 2 });
      expect(result.exactItemId).toBeNull();
    });

    it("keeps a valid but uncatalogued code as evidence rather than a match", async () => {
      const batchId = await openBatch(office);
      const result = await startSession(office, batchId, {
        photoCount: 1,
        localCodes: [codeFor(UNKNOWN_BARCODE)],
      });

      expect(result.session).toMatchObject({ status: "AwaitingUpload", photoCount: 1 });
    });

    it("takes the ordinary path when no barcode was read at all", async () => {
      const batchId = await openBatch(office);
      const result = await startSession(office, batchId, { photoCount: 4, localCodes: [] });

      expect(result.session).toMatchObject({ status: "AwaitingUpload", photoCount: 4 });
    });

    it("replays a session start idempotently and rejects a changed one", async () => {
      const batchId = await openBatch(office);
      const clientSessionId = randomUUID();
      const body = { clientSessionId, batchId, photoCount: 2, localCodes: [] };

      const first = await request(office, "POST", "/stock-capture/sessions", body);
      const replay = await request(office, "POST", "/stock-capture/sessions", body);
      expect(replay.status).toBe(201);
      expect(replay.body).toEqual(first.body);

      const changed = await request(office, "POST", "/stock-capture/sessions", {
        ...body,
        photoCount: 3,
      });
      expect(changed.status).toBe(409);
    });
  });

  describe("uploads", () => {
    it("issues one same-origin upload route per declared photograph", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 2 });

      const uploads = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads`,
        { images: [validImage(1), validImage(2)] },
      );

      expect(uploads.status).toBe(201);
      const body = uploads.body as CaptureUploadGrantResponse;
      expect(body.grants).toHaveLength(2);
      for (const grant of body.grants) {
        expect(grant.url).toBe(
          `/api/v1/stock-capture/sessions/${session?.id}/uploads/${grant.imageId}`,
        );
        expect(new Date(grant.expiresAt).getTime()).toBeGreaterThan(Date.now());
      }
    });

    it("refuses an upload declaration that does not match the photo count", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 2 });

      const uploads = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads`,
        { images: [validImage(1)] },
      );

      expect(uploads.status).toBe(422);
      expect((uploads.body as { readonly code: string }).code).toBe("capture.upload_invalid");
    });

    it("refuses a declared image the pipeline cannot decode", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      const uploads = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads`,
        { images: [{ ...validImage(1), mediaType: "image/gif" }] },
      );

      expect(uploads.status).toBe(422);
    });

    it("refuses to complete uploads before every photograph is declared", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 2 });

      const completed = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads/complete`,
      );

      expect(completed.status).toBe(422);
    });

    it("queues recognition exactly once, even if completion is replayed", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });
      await request(office, "POST", `/stock-capture/sessions/${session?.id}/uploads`, {
        images: [validImage(1)],
      });

      const first = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads/complete`,
      );
      expect(first.status).toBe(201);
      expect(
        (first.body as { readonly session: RecognitionSessionSummaryView }).session.status,
      ).toBe("Queued");

      const replay = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads/complete`,
      );
      expect(replay.status).toBe(201);

      const jobs = await schema()
        .selectFrom("stock_recognition_jobs")
        .select("id")
        .where("session_id", "=", session?.id ?? "")
        .where("job_type", "=", "Recognize")
        .execute();
      expect(jobs).toHaveLength(1);
    });

    it("hides another actor's session behind a not-found", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      const response = await request(stranger, "GET", `/stock-capture/sessions/${session?.id}`);
      expect(response.status).toBe(404);
    });

    it("refuses uploads once a session has expired", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      await schema()
        .updateTable("stock_recognition_sessions")
        .set({ expires_at: new Date(Date.now() - 60_000) })
        .where("id", "=", session?.id ?? "")
        .execute();

      const uploads = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/uploads`,
        { images: [validImage(1)] },
      );

      expect(uploads.status).toBe(410);
      expect((uploads.body as { readonly code: string }).code).toBe("capture.session_expired");
    });
  });

  describe("cancellation", () => {
    it("cancels an in-progress session and queues its cleanup", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      const cancelled = await request(
        office,
        "POST",
        `/stock-capture/sessions/${session?.id}/cancel`,
      );
      expect(cancelled.status).toBe(201);
      expect(
        (cancelled.body as { readonly session: RecognitionSessionSummaryView }).session.status,
      ).toBe("Cancelled");

      const jobs = await schema()
        .selectFrom("stock_recognition_jobs")
        .select("id")
        .where("session_id", "=", session?.id ?? "")
        .where("job_type", "=", "DeleteObjects")
        .execute();
      expect(jobs).toHaveLength(1);
    });

    it("is idempotent when cancelled twice", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      await request(office, "POST", `/stock-capture/sessions/${session?.id}/cancel`);
      const second = await request(office, "POST", `/stock-capture/sessions/${session?.id}/cancel`);

      expect(second.status).toBe(201);
      expect(
        (second.body as { readonly session: RecognitionSessionSummaryView }).session.status,
      ).toBe("Cancelled");
    });
  });

  describe("session review", () => {
    it("recommends manual entry only once nothing was found and review is due", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, { photoCount: 1 });

      const reviewed = await request(office, "GET", `/stock-capture/sessions/${session?.id}`);
      const view = (reviewed.body as { readonly session: RecognitionSessionView }).session;

      /* Still AwaitingUpload: nothing has failed yet, so no recommendation. */
      expect(view.candidates).toEqual([]);
      expect(view.recommendManualEntry).toBe(false);
    });

    it("reports the barcode stage as evidence once one was read", async () => {
      const batchId = await openBatch(office);
      const { session } = await startSession(office, batchId, {
        photoCount: 3,
        localCodes: [codeFor(ACTIVE_ITEM_BARCODE)],
      });

      const reviewed = await request(office, "GET", `/stock-capture/sessions/${session?.id}`);
      const view = (reviewed.body as { readonly session: RecognitionSessionView }).session;

      expect(view.stageReports).toContainEqual(
        expect.objectContaining({ stage: "Barcode", outcome: "Succeeded", imageOrdinal: 1 }),
      );
    });
  });
});
