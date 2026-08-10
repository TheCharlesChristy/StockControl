import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import type {
  CommitCaptureEntryResponse,
  RecognitionSessionSummaryView,
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
 * Atomic commit, specification section 12: `StockCaptureService.commitEntry`
 * owns one transaction across the extracted `createItemInTransaction` and
 * `receiveInTransaction` writers. These tests exist because none of that is
 * true unless proven against a real PostgreSQL — a mocked query builder would
 * assert the SQL this code writes, not that it actually commits atomically,
 * rolls back cleanly, or serialises against a concurrent batch close.
 */
process.env.STOCK_CAPTURE_ENABLED = "true";
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

const ACTIVE_ITEM_BARCODE = "5901234123457";

let app: NestFastifyApplication;
let migrator: Kysely<StockControlDatabase>;
let office: Actor;
let activeItemId: string;
let storeLocationId: string;
let inactiveLocationId: string;

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
      display_name: `${role} commit fixture`,
      role,
      password_hash: await hashPassword(PASSWORD),
      is_active: true,
    })
    .execute();
  return { id, email, cookie: await signIn(email) };
}

async function request(
  actor: Actor | null,
  method: "GET" | "POST",
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
  readonly partNumber?: string | null;
  readonly isActive?: boolean;
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
      part_number: input.partNumber ?? null,
      low_stock_threshold: null,
      is_active: input.isActive ?? true,
    })
    .execute();
  return id;
}

const codeFor = (value: string, ordinal = 1): Record<string, unknown> => ({
  value,
  symbology: "EAN-13",
  imageOrdinal: ordinal,
  readerVersion: "test-reader-1.0",
});

async function openBatch(): Promise<string> {
  const response = await request(office, "POST", "/stock-capture/batches", {
    clientBatchId: randomUUID(),
    defaultLocationId: null,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { readonly batch: StockCaptureBatchView }).batch.id;
}

/** A session that reached `ReviewReady` through the exact-barcode short cut, with a real published candidate. */
async function reviewReadySessionForActiveItem(
  batchId: string,
): Promise<{ readonly sessionId: string; readonly candidateId: string }> {
  const response = await request(office, "POST", "/stock-capture/sessions", {
    clientSessionId: randomUUID(),
    batchId,
    photoCount: 0,
    localCodes: [codeFor(ACTIVE_ITEM_BARCODE)],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const body = response.body as { readonly session: RecognitionSessionSummaryView };
  expect(body.session.status).toBe("ReviewReady");

  const candidate = await schema()
    .selectFrom("stock_recognition_candidates")
    .select("id")
    .where("session_id", "=", body.session.id)
    .executeTakeFirstOrThrow();

  return { sessionId: body.session.id, candidateId: candidate.id };
}

/**
 * No barcode and no worker running in this suite, so a session that must
 * reach `ReviewReady` without a candidate is moved there directly — the same
 * shortcut `stock-capture.db.spec.ts` uses for expiry, applied to status.
 */
async function reviewReadySessionWithoutCandidate(batchId: string): Promise<string> {
  const response = await request(office, "POST", "/stock-capture/sessions", {
    clientSessionId: randomUUID(),
    batchId,
    photoCount: 1,
    localCodes: [],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const sessionId = (response.body as { readonly session: RecognitionSessionSummaryView }).session
    .id;

  await schema()
    .updateTable("stock_recognition_sessions")
    .set({ status: "ReviewReady" })
    .where("id", "=", sessionId)
    .execute();

  return sessionId;
}

const newItemSelection = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: "NewItem",
  candidateId: null,
  reference: null,
  name: `Captured widget ${randomUUID()}`,
  unit: "ea",
  barcode: null,
  partNumber: null,
  ...overrides,
});

describe("assisted stock capture: commitEntry", () => {
  beforeAll(async () => {
    const { createApiApplication } = await import("../src/bootstrap");

    const configuration = loadMigratorDatabaseConfiguration();
    const { runtimeRole } = loadMigrationDatabaseRoles(process.env, configuration.connectionString);
    migrator = createMigratorDatabase(configuration);
    await runMigrations(migrator, { runtimeRole });

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

    office = await createUser("commit.office@example.invalid", "Office");

    activeItemId = await seedItem({ reference: "COMMIT-ACTIVE", barcode: ACTIVE_ITEM_BARCODE });

    storeLocationId = randomUUID();
    await schema()
      .insertInto("locations")
      .values({
        id: storeLocationId,
        code: "COMMIT-STORE",
        name: "Commit test store",
        kind: "Store",
        job_id: null,
        is_active: true,
        map_id: null,
        geometry: null,
        derived_parent_id: null,
      })
      .execute();

    inactiveLocationId = randomUUID();
    await schema()
      .insertInto("locations")
      .values({
        id: inactiveLocationId,
        code: "COMMIT-CLOSED",
        name: "Closed commit test store",
        kind: "Store",
        job_id: null,
        is_active: false,
        map_id: null,
        geometry: null,
        derived_parent_id: null,
      })
      .execute();
  });

  afterAll(async () => {
    await app.close();

    const actorIds = [office.id];
    const capturedSessions = schema()
      .selectFrom("stock_recognition_sessions")
      .select("id")
      .where("actor_user_id", "in", actorIds);
    const capturedBatches = schema()
      .selectFrom("stock_capture_batches")
      .select("id")
      .where("actor_user_id", "in", actorIds);

    await schema()
      .deleteFrom("recognition_feedback")
      .where("session_id", "in", capturedSessions)
      .execute();
    await schema()
      .deleteFrom("stock_capture_entries")
      .where("batch_id", "in", capturedBatches)
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
    await schema().deleteFrom("transactions").where("actor_user_id", "in", actorIds).execute();
    await schema().deleteFrom("stock_levels").execute();
    await schema().deleteFrom("items").execute();
    await schema().deleteFrom("locations").execute();
    await schema().deleteFrom("sessions").where("user_id", "in", actorIds).execute();
    await schema().deleteFrom("users").where("id", "in", actorIds).execute();

    await migrator.destroy();
  });

  it("receives stock against an existing item, writing exactly one entry and one transaction", async () => {
    const batchId = await openBatch();
    const { sessionId, candidateId } = await reviewReadySessionForActiveItem(batchId);
    const clientEntryId = randomUUID();

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId,
      sessionId,
      selection: { kind: "ExistingItem", itemId: activeItemId, candidateId },
      quantity: "12",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const body = response.body as CommitCaptureEntryResponse;
    expect(body.createdItem).toBe(false);
    expect(body.item.id).toBe(activeItemId);
    expect(body.batch.committedEntryCount).toBe(1);

    const entries = await schema()
      .selectFrom("stock_capture_entries")
      .selectAll()
      .where("session_id", "=", sessionId)
      .execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("Committed");
    expect(entries[0]?.transaction_id).toBe(body.transactionId);

    const transactions = await schema()
      .selectFrom("transactions")
      .select("id")
      .where("item_id", "=", activeItemId)
      .where("id", "=", body.transactionId)
      .execute();
    expect(transactions).toHaveLength(1);

    const session = await schema()
      .selectFrom("stock_recognition_sessions")
      .select(["status", "committed_item_id"])
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(session.status).toBe("Committed");
    expect(session.committed_item_id).toBe(activeItemId);

    const feedback = await schema()
      .selectFrom("recognition_feedback")
      .select(["outcome", "selected_rank", "final_item_id"])
      .where("session_id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(feedback.outcome).toBe("Accepted");
    expect(feedback.final_item_id).toBe(activeItemId);
  });

  it("creates item, balance, transaction, feedback and exemplar job atomically for a new item", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);
    const clientEntryId = randomUUID();
    const partNumber = `PN-${randomUUID().slice(0, 8)}`;

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId,
      sessionId,
      selection: newItemSelection({ partNumber }),
      quantity: "5",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const body = response.body as CommitCaptureEntryResponse;
    expect(body.createdItem).toBe(true);

    const items = await schema()
      .selectFrom("items")
      .select(["id", "part_number"])
      .where("id", "=", body.item.id)
      .execute();
    expect(items).toHaveLength(1);
    expect(items[0]?.part_number).toBe(partNumber);

    const levels = await schema()
      .selectFrom("stock_levels")
      .select("quantity")
      .where("item_id", "=", body.item.id)
      .where("location_id", "=", storeLocationId)
      .executeTakeFirstOrThrow();
    expect(Number(levels.quantity)).toBe(5);

    const jobs = await schema()
      .selectFrom("stock_recognition_jobs")
      .select(["job_type", "deduplication_key"])
      .where("session_id", "=", sessionId)
      .where("job_type", "=", "BuildExemplars")
      .execute();
    expect(jobs).toHaveLength(1);

    const feedback = await schema()
      .selectFrom("recognition_feedback")
      .select("outcome")
      .where("session_id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(feedback.outcome).toBe("RejectedAll");
  });

  it("replays an identical commit exactly once, never creating a second item or transaction", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);
    const clientEntryId = randomUUID();
    const payload = {
      clientEntryId,
      sessionId,
      selection: newItemSelection(),
      quantity: "3",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    };

    const first = await request(
      office,
      "POST",
      `/stock-capture/batches/${batchId}/entries`,
      payload,
    );
    expect(first.status).toBe(201);
    const firstBody = first.body as CommitCaptureEntryResponse;

    const second = await request(
      office,
      "POST",
      `/stock-capture/batches/${batchId}/entries`,
      payload,
    );
    expect(second.status).toBe(201);
    const secondBody = second.body as CommitCaptureEntryResponse;

    expect(secondBody.item.id).toBe(firstBody.item.id);
    expect(secondBody.transactionId).toBe(firstBody.transactionId);

    const items = await schema()
      .selectFrom("items")
      .select("id")
      .where("id", "=", firstBody.item.id)
      .execute();
    expect(items).toHaveLength(1);

    const transactions = await schema()
      .selectFrom("transactions")
      .select("id")
      .where("item_id", "=", firstBody.item.id)
      .execute();
    expect(transactions).toHaveLength(1);

    const entries = await schema()
      .selectFrom("stock_capture_entries")
      .select("id")
      .where("id", "=", clientEntryId)
      .execute();
    expect(entries).toHaveLength(1);
  });

  it("refuses the same entry id sent with different details", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);
    const clientEntryId = randomUUID();

    const first = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId,
      sessionId,
      selection: newItemSelection(),
      quantity: "1",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });
    expect(first.status).toBe(201);

    const second = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId,
      sessionId,
      selection: newItemSelection(),
      quantity: "2",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });
    expect(second.status).toBe(409);
    expect((second.body as { readonly code: string }).code).toBe("capture.idempotency_conflict");
  });

  it("rolls back entirely when the selected item was archived since the candidate was shown", async () => {
    const batchId = await openBatch();
    const { sessionId, candidateId } = await reviewReadySessionForActiveItem(batchId);

    const archivedId = await seedItem({
      reference: `COMMIT-ARCHIVED-${randomUUID().slice(0, 8)}`,
      barcode: null,
      isActive: false,
    });
    await schema()
      .updateTable("stock_recognition_candidates")
      .set({ item_id: archivedId })
      .where("id", "=", candidateId)
      .execute();

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      selection: { kind: "ExistingItem", itemId: archivedId, candidateId },
      quantity: "1",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status).toBe(422);
    expect((response.body as { readonly code: string }).code).toBe("capture.item_changed");

    /* The whole transaction rolled back: no stray Pending entry, no stock movement. */
    const entries = await schema()
      .selectFrom("stock_capture_entries")
      .select("id")
      .where("session_id", "=", sessionId)
      .execute();
    expect(entries).toHaveLength(0);

    const transactions = await schema()
      .selectFrom("transactions")
      .select("id")
      .where("item_id", "=", archivedId)
      .execute();
    expect(transactions).toHaveLength(0);

    const session = await schema()
      .selectFrom("stock_recognition_sessions")
      .select("status")
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(session.status).toBe("ReviewReady");
  });

  it("rolls back a newly created item when the receive step itself refuses the quantity", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);
    const partNumber = `PN-ROLLBACK-${randomUUID().slice(0, 8)}`;

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      /* Passes canonicalisation (a well-formed number) but `receive()`'s own
       * decision engine refuses a non-positive quantity — the failure this
       * test needs happens inside the writer, after the item already exists
       * in this transaction, not before it. */
      selection: newItemSelection({ partNumber }),
      quantity: "0",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect((response.body as { readonly code: string }).code).toBe("stock.quantity_not_positive");

    const items = await schema()
      .selectFrom("items")
      .select("id")
      .where("part_number", "=", partNumber)
      .execute();
    expect(items).toHaveLength(0);

    const entries = await schema()
      .selectFrom("stock_capture_entries")
      .select("id")
      .where("session_id", "=", sessionId)
      .execute();
    expect(entries).toHaveLength(0);

    const session = await schema()
      .selectFrom("stock_recognition_sessions")
      .select("status")
      .where("id", "=", sessionId)
      .executeTakeFirstOrThrow();
    expect(session.status).toBe("ReviewReady");
  });

  it("refuses to commit into a location that is not an active store", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      selection: newItemSelection(),
      quantity: "1",
      locationId: inactiveLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status).toBe(422);
    expect((response.body as { readonly code: string }).code).toBe("capture.location_unavailable");
  });

  it("refuses a batch that has already been completed", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);

    const closed = await request(office, "POST", `/stock-capture/batches/${batchId}/complete`);
    expect(closed.status).toBe(201);

    const response = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      selection: newItemSelection(),
      quantity: "1",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(response.status).toBe(422);
    expect((response.body as { readonly code: string }).code).toBe("capture.batch_not_open");
  });

  it("refuses a session that has not reached ReviewReady", async () => {
    const batchId = await openBatch();
    const response = await request(office, "POST", `/stock-capture/sessions`, {
      clientSessionId: randomUUID(),
      batchId,
      photoCount: 1,
      localCodes: [],
    });
    const sessionId = (response.body as { readonly session: RecognitionSessionSummaryView }).session
      .id;

    const commit = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      selection: newItemSelection(),
      quantity: "1",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });

    expect(commit.status).toBe(422);
    expect((commit.body as { readonly code: string }).code).toBe("capture.session_not_ready");
  });

  it("blocks a duplicate part number until the person acknowledges it, then allows it", async () => {
    const partNumber = `DUP-${randomUUID().slice(0, 8)}`;
    await seedItem({
      reference: `COMMIT-DUP-${randomUUID().slice(0, 8)}`,
      barcode: null,
      partNumber,
    });

    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);

    const blocked = await request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
      clientEntryId: randomUUID(),
      sessionId,
      selection: newItemSelection({ partNumber }),
      quantity: "1",
      locationId: storeLocationId,
      acknowledgedDuplicatePartNumber: false,
    });
    expect(blocked.status).toBe(422);

    const acknowledged = await request(
      office,
      "POST",
      `/stock-capture/batches/${batchId}/entries`,
      {
        clientEntryId: randomUUID(),
        sessionId,
        selection: newItemSelection({ partNumber }),
        quantity: "1",
        locationId: storeLocationId,
        acknowledgedDuplicatePartNumber: true,
      },
    );
    expect(acknowledged.status, JSON.stringify(acknowledged.body)).toBe(201);
  });

  it("generates distinct references for two concurrently committed new items", async () => {
    const batchA = await openBatch();
    const batchB = await openBatch();
    const sessionA = await reviewReadySessionWithoutCandidate(batchA);
    const sessionB = await reviewReadySessionWithoutCandidate(batchB);

    const [responseA, responseB] = await Promise.all([
      request(office, "POST", `/stock-capture/batches/${batchA}/entries`, {
        clientEntryId: randomUUID(),
        sessionId: sessionA,
        selection: newItemSelection(),
        quantity: "1",
        locationId: storeLocationId,
        acknowledgedDuplicatePartNumber: false,
      }),
      request(office, "POST", `/stock-capture/batches/${batchB}/entries`, {
        clientEntryId: randomUUID(),
        sessionId: sessionB,
        selection: newItemSelection(),
        quantity: "1",
        locationId: storeLocationId,
        acknowledgedDuplicatePartNumber: false,
      }),
    ]);

    expect(responseA.status, JSON.stringify(responseA.body)).toBe(201);
    expect(responseB.status, JSON.stringify(responseB.body)).toBe(201);
    const bodyA = responseA.body as CommitCaptureEntryResponse;
    const bodyB = responseB.body as CommitCaptureEntryResponse;

    expect(bodyA.item.id).not.toBe(bodyB.item.id);
    expect(bodyA.item.reference).not.toBe(bodyB.item.reference);

    const references = await schema()
      .selectFrom("items")
      .select("reference")
      .where("id", "in", [bodyA.item.id, bodyB.item.id])
      .execute();
    expect(new Set(references.map((row) => row.reference)).size).toBe(2);
  });

  it("serialises a batch close racing a concurrent commit rather than corrupting either", async () => {
    const batchId = await openBatch();
    const sessionId = await reviewReadySessionWithoutCandidate(batchId);

    const [commitResult, closeResult] = await Promise.all([
      request(office, "POST", `/stock-capture/batches/${batchId}/entries`, {
        clientEntryId: randomUUID(),
        sessionId,
        selection: newItemSelection(),
        quantity: "1",
        locationId: storeLocationId,
        acknowledgedDuplicatePartNumber: false,
      }),
      request(office, "POST", `/stock-capture/batches/${batchId}/complete`),
    ]);

    /* Whichever finished first, the other observes a consistent, final state. */
    expect([201, 422]).toContain(commitResult.status);
    expect(closeResult.status).toBe(201);

    const entries = await schema()
      .selectFrom("stock_capture_entries")
      .select(["status"])
      .where("session_id", "=", sessionId)
      .execute();
    const batch = await schema()
      .selectFrom("stock_capture_batches")
      .select("status")
      .where("id", "=", batchId)
      .executeTakeFirstOrThrow();

    if (commitResult.status === 201) {
      expect(entries).toHaveLength(1);
      expect(entries[0]?.status).toBe("Committed");
    } else {
      expect(entries).toHaveLength(0);
      expect((commitResult.body as { readonly code: string }).code).toBe("capture.batch_not_open");
    }
    expect(batch.status).toBe("Completed");
  });
});
