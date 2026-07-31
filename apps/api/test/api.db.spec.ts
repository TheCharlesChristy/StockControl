import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { InjectOptions } from "fastify";
import type { ItemDetailView, JobResponse, StockOperationResponse } from "@stockcontrol/contracts";
import {
  createMigratorDatabase,
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "../src/auth/password";
import { createApiApplication } from "../src/bootstrap";

/**
 * Exercises the real HTTP surface against a real PostgreSQL database. These are
 * the checks that cannot be faked: authorisation actually enforced server-side,
 * stock actually atomic, and two concurrent collections of one reservation
 * unable to over-issue.
 */

const PASSWORD = "integration-password";

interface Actor {
  readonly id: string;
  readonly email: string;
  readonly cookie: string;
}

let app: NestFastifyApplication;
let migrator: Kysely<StockControlDatabase>;
let admin: Actor;
let office: Actor;
let engineer: Actor;

const schema = (): ReturnType<Kysely<StockControlDatabase>["withSchema"]> =>
  migrator.withSchema(STOCKCONTROL_SCHEMA);

async function signIn(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in",
    payload: { email, password: PASSWORD },
  });

  expect(response.statusCode, `sign-in for ${email}: ${response.body}`).toBe(201);
  const cookie = response.cookies.find((candidate) => candidate.name === "stockcontrol.session");
  expect(cookie).toBeDefined();

  return `stockcontrol.session=${cookie?.value ?? ""}`;
}

async function createUser(
  email: string,
  role: "Engineer" | "Office" | "Admin",
): Promise<{ readonly id: string; readonly email: string }> {
  const id = randomUUID();

  await schema()
    .insertInto("users")
    .values({
      id,
      email,
      display_name: `${role} user`,
      role,
      password_hash: await hashPassword(PASSWORD),
      is_active: true,
    })
    .execute();

  return { id, email };
}

async function request(
  actor: Actor | null,
  method: "GET" | "POST" | "PATCH",
  url: string,
  payload?: unknown,
): Promise<{ readonly status: number; readonly body: unknown }> {
  /* Built up rather than spread, so optional properties stay truly optional. */
  const options: InjectOptions = { method, url: `/api/v1${url}` };

  if (actor !== null) {
    options.headers = { cookie: actor.cookie };
  }

  if (payload !== undefined) {
    options.payload = payload as NonNullable<InjectOptions["payload"]>;
  }

  const response = await app.inject(options);

  return {
    status: response.statusCode,
    body: response.body.length === 0 ? undefined : (JSON.parse(response.body) as unknown),
  };
}

async function seedItem(reference: string): Promise<string> {
  const id = randomUUID();

  await schema()
    .insertInto("items")
    .values({
      id,
      reference,
      name: `${reference} test item`,
      unit: "ea",
      barcode: null,
      part_number: null,
      low_stock_threshold: null,
      is_active: true,
    })
    .execute();

  return id;
}

async function seedLocation(code: string): Promise<string> {
  const id = randomUUID();

  await schema()
    .insertInto("locations")
    .values({ id, code, name: `${code} store`, kind: "Store", job_id: null, is_active: true })
    .execute();

  return id;
}

async function clearBusinessData(): Promise<void> {
  await schema().deleteFrom("transactions").execute();
  await schema().deleteFrom("reservations").execute();
  await schema().deleteFrom("stock_levels").execute();
  await schema().deleteFrom("items").execute();
  await schema().deleteFrom("locations").execute();
  await schema().deleteFrom("jobs").execute();
}

beforeAll(async () => {
  const configuration = loadMigratorDatabaseConfiguration();
  const { runtimeRole } = loadMigrationDatabaseRoles(process.env, configuration.connectionString);
  migrator = createMigratorDatabase(configuration);
  await runMigrations(migrator, { runtimeRole });

  await schema().deleteFrom("transactions").execute();
  await schema().deleteFrom("reservations").execute();
  await schema().deleteFrom("stock_levels").execute();
  await schema().deleteFrom("items").execute();
  await schema().deleteFrom("locations").execute();
  await schema().deleteFrom("jobs").execute();
  await schema().deleteFrom("sessions").execute();
  await schema().deleteFrom("users").execute();

  const adminUser = await createUser("integration.admin@example.com", "Admin");
  const officeUser = await createUser("integration.office@example.com", "Office");
  const engineerUser = await createUser("integration.engineer@example.com", "Engineer");

  app = await createApiApplication();

  admin = { ...adminUser, cookie: await signIn(adminUser.email) };
  office = { ...officeUser, cookie: await signIn(officeUser.email) };
  engineer = { ...engineerUser, cookie: await signIn(engineerUser.email) };
});

afterAll(async () => {
  await app.close();
  await migrator.destroy();
});

beforeEach(async () => {
  await clearBusinessData();
});

describe("authentication", () => {
  it("refuses a protected route without a session", async () => {
    const response = await request(null, "GET", "/items");

    expect(response.status).toBe(401);
  });

  it("leaves the health endpoints public", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/health/live" });

    expect(response.statusCode).toBe(200);
  });

  it("rejects a wrong password without saying which detail was wrong", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in",
      payload: { email: office.email, password: "not-the-password" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Those sign-in details were not recognised.");
  });

  it("gives the same answer for an unknown account", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in",
      payload: { email: "nobody@example.com", password: PASSWORD },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain("Those sign-in details were not recognised.");
  });

  it("returns the session and the role's capabilities", async () => {
    const response = await request(engineer, "GET", "/auth/session");
    const body = response.body as { session: { user: { role: string } }; capabilities: string[] };

    expect(response.status).toBe(200);
    expect(body.session.user.role).toBe("Engineer");
    expect(body.capabilities).toEqual(["view", "issue", "reserve", "collect"]);
  });

  it("ends the session on sign-out", async () => {
    const cookie = await signIn(office.email);
    const actor: Actor = { ...office, cookie };

    expect((await request(actor, "GET", "/items")).status).toBe(200);
    expect((await request(actor, "POST", "/auth/sign-out")).status).toBe(201);
    expect((await request(actor, "GET", "/items")).status).toBe(401);
  });
});

describe("authorisation is enforced on the server", () => {
  it.each([
    ["POST", "/stock/receive"],
    ["POST", "/stock/transfer"],
    ["POST", "/stock/adjust"],
    ["POST", "/items"],
    ["POST", "/locations"],
    ["POST", "/jobs"],
  ] as const)("refuses an Engineer %s %s", async (method, url) => {
    const response = await request(engineer, method, url, {});

    expect(response.status).toBe(403);
  });

  it("refuses an Office user managing users", async () => {
    expect((await request(office, "GET", "/users")).status).toBe(403);
  });

  it("allows an Admin to manage users", async () => {
    expect((await request(admin, "GET", "/users")).status).toBe(200);
  });

  it("lets every role read the inventory", async () => {
    for (const actor of [engineer, office, admin]) {
      expect((await request(actor, "GET", "/items")).status).toBe(200);
    }
  });
});

describe("stock operations", () => {
  let itemId: string;
  let storeA: string;
  let storeB: string;

  beforeEach(async () => {
    itemId = await seedItem("ITM-9001");
    storeA = await seedLocation("TEST-A");
    storeB = await seedLocation("TEST-B");
  });

  const receive = async (quantity: string, locationId = storeA): Promise<void> => {
    const response = await request(office, "POST", "/stock/receive", {
      itemId,
      locationId,
      quantity,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };

  const detail = async (): Promise<ItemDetailView> => {
    const response = await request(office, "GET", `/items/${itemId}`);

    return (response.body as { item: ItemDetailView }).item;
  };

  it("receives stock and records a transaction", async () => {
    await receive("250");
    const item = await detail();

    expect(item.onHand).toBe("250.000");
    expect(item.available).toBe("250.000");
    expect(item.recentTransactions[0]?.kind).toBe("Receive");
    expect(item.recentTransactions[0]?.actorName).toBe("Office user");
  });

  it("refuses to issue more than is on hand and leaves the balance untouched", async () => {
    await receive("10");

    const response = await request(engineer, "POST", "/stock/issue", {
      itemId,
      locationId: storeA,
      quantity: "11",
    });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("stock.insufficient_stock");
    expect((await detail()).onHand).toBe("10.000");
  });

  it("transfers between locations without changing the total", async () => {
    await receive("100");

    const response = await request(office, "POST", "/stock/transfer", {
      itemId,
      fromLocationId: storeA,
      toLocationId: storeB,
      quantity: "40",
    });

    expect(response.status).toBe(201);
    const item = await detail();
    expect(item.onHand).toBe("100.000");
    expect(item.balances.find((balance) => balance.locationCode === "TEST-A")?.quantity).toBe(
      "60.000",
    );
    expect(item.balances.find((balance) => balance.locationCode === "TEST-B")?.quantity).toBe(
      "40.000",
    );
  });

  it("requires a reason to adjust", async () => {
    await receive("10");

    const response = await request(office, "POST", "/stock/adjust", {
      itemId,
      locationId: storeA,
      countedQuantity: "9",
    });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("reason");
  });

  it("adjusts to a counted figure and keeps the reason on the transaction", async () => {
    await receive("10");

    const response = await request(office, "POST", "/stock/adjust", {
      itemId,
      locationId: storeA,
      countedQuantity: "8",
      reason: "Cycle count",
    });

    expect(response.status).toBe(201);
    const item = (response.body as StockOperationResponse).item;
    expect(item.onHand).toBe("8.000");
    expect(item.recentTransactions[0]?.reason).toBe("Cycle count");
  });

  it("keeps fractional arithmetic exact across operations", async () => {
    await receive("0.1");
    await receive("0.2");

    expect((await detail()).onHand).toBe("0.300");
  });

  it("rejects a quantity with too many decimal places", async () => {
    const response = await request(office, "POST", "/stock/receive", {
      itemId,
      locationId: storeA,
      quantity: "1.2345",
    });

    expect(response.status).toBe(422);
  });
});

describe("jobs, reservations and collection", () => {
  let itemId: string;
  let storeA: string;
  let jobId: string;

  beforeEach(async () => {
    itemId = await seedItem("ITM-9002");
    storeA = await seedLocation("TEST-J");
    await request(office, "POST", "/stock/receive", {
      itemId,
      locationId: storeA,
      quantity: "100",
    });

    const created = await request(office, "POST", "/jobs", {
      name: "Integration job",
      customer: "Test customer",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    jobId = (created.body as JobResponse).job.id;
  });

  it("creates a job with exactly one job-site location", async () => {
    const rows = await schema()
      .selectFrom("locations")
      .select("id")
      .where("job_id", "=", jobId)
      .execute();

    expect(rows).toHaveLength(1);
  });

  it("reduces availability on reserve without moving stock", async () => {
    const response = await request(engineer, "POST", `/jobs/${jobId}/reservations`, {
      itemId,
      quantity: "30",
    });

    expect(response.status).toBe(201);
    const item = (response.body as StockOperationResponse).item;
    expect(item.onHand).toBe("100.000");
    expect(item.reserved).toBe("30.000");
    expect(item.available).toBe("70.000");
  });

  it("refuses to reserve more than is available", async () => {
    await request(engineer, "POST", `/jobs/${jobId}/reservations`, { itemId, quantity: "80" });

    const response = await request(engineer, "POST", `/jobs/${jobId}/reservations`, {
      itemId,
      quantity: "21",
    });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("stock.insufficient_availability");
  });

  it("moves collected stock to the job site and leaves the remainder reserved", async () => {
    const reserved = await request(engineer, "POST", `/jobs/${jobId}/reservations`, {
      itemId,
      quantity: "20",
    });
    const reservationId = await openReservationId(jobId);
    expect(reserved.status).toBe(201);

    const collected = await request(engineer, "POST", `/reservations/${reservationId}/collect`, {
      sourceLocationId: storeA,
      quantity: "12",
    });

    expect(collected.status, JSON.stringify(collected.body)).toBe(201);
    const item = (collected.body as StockOperationResponse).item;
    expect(item.onHand).toBe("100.000");
    expect(item.inStores).toBe("88.000");
    expect(item.atJobSites).toBe("12.000");
    expect(item.reserved).toBe("8.000");
    expect(item.available).toBe("80.000");
  });

  it("refuses an Engineer releasing a reservation but allows Office", async () => {
    await request(engineer, "POST", `/jobs/${jobId}/reservations`, { itemId, quantity: "5" });
    const reservationId = await openReservationId(jobId);

    expect(
      (await request(engineer, "POST", `/reservations/${reservationId}/release`, { reason: "x" }))
        .status,
    ).toBe(403);
    expect(
      (
        await request(office, "POST", `/reservations/${reservationId}/release`, {
          reason: "No longer needed",
        })
      ).status,
    ).toBe(201);
  });

  it("releases uncollected reservations when the job closes", async () => {
    await request(engineer, "POST", `/jobs/${jobId}/reservations`, { itemId, quantity: "25" });

    const closed = await request(office, "POST", `/jobs/${jobId}/close`);

    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    const job = (closed.body as JobResponse).job;
    expect(job.status).toBe("Closed");
    expect(job.reservations.every((reservation) => reservation.status === "Released")).toBe(true);

    const item = await request(office, "GET", `/items/${itemId}`);
    expect((item.body as { item: ItemDetailView }).item.available).toBe("100.000");
  });
});

async function openReservationId(jobId: string): Promise<string> {
  const row = await migrator
    .withSchema(STOCKCONTROL_SCHEMA)
    .selectFrom("reservations")
    .select("id")
    .where("job_id", "=", jobId)
    .where("status", "=", "Open")
    .orderBy("created_at", "desc")
    .executeTakeFirstOrThrow();

  return row.id;
}

describe("concurrency", () => {
  it("cannot over-issue when one reservation is collected twice at once", async () => {
    const itemId = await seedItem("ITM-9003");
    const storeA = await seedLocation("TEST-C");
    await request(office, "POST", "/stock/receive", {
      itemId,
      locationId: storeA,
      quantity: "100",
    });

    const created = await request(office, "POST", "/jobs", {
      name: "Concurrency job",
      customer: "Test customer",
    });
    const jobId = (created.body as JobResponse).job.id;
    await request(engineer, "POST", `/jobs/${jobId}/reservations`, { itemId, quantity: "10" });
    const reservationId = await openReservationId(jobId);

    /* Both ask for the whole reservation at the same moment. */
    const [first, second] = await Promise.all([
      request(engineer, "POST", `/reservations/${reservationId}/collect`, {
        sourceLocationId: storeA,
        quantity: "10",
      }),
      request(engineer, "POST", `/reservations/${reservationId}/collect`, {
        sourceLocationId: storeA,
        quantity: "10",
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses, `${JSON.stringify(first.body)} / ${JSON.stringify(second.body)}`).toEqual([
      201, 422,
    ]);

    const reservation = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("reservations")
      .select(["quantity_collected", "status"])
      .where("id", "=", reservationId)
      .executeTakeFirstOrThrow();

    expect(reservation.quantity_collected).toBe("10.000");
    expect(reservation.status).toBe("Fulfilled");

    const item = await request(office, "GET", `/items/${itemId}`);
    const view = (item.body as { item: ItemDetailView }).item;
    expect(view.onHand).toBe("100.000");
    expect(view.atJobSites).toBe("10.000");
    expect(view.inStores).toBe("90.000");

    const collections = await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("transactions")
      .select("id")
      .where("reservation_id", "=", reservationId)
      .where("kind", "=", "Collect")
      .execute();

    expect(collections, "exactly one collection must have been recorded").toHaveLength(1);
  });

  it("cannot issue the same stock twice at once", async () => {
    const itemId = await seedItem("ITM-9004");
    const storeA = await seedLocation("TEST-D");
    await request(office, "POST", "/stock/receive", { itemId, locationId: storeA, quantity: "10" });

    const [first, second] = await Promise.all([
      request(engineer, "POST", "/stock/issue", { itemId, locationId: storeA, quantity: "10" }),
      request(engineer, "POST", "/stock/issue", { itemId, locationId: storeA, quantity: "10" }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 422]);

    const item = await request(office, "GET", `/items/${itemId}`);
    expect((item.body as { item: ItemDetailView }).item.onHand).toBe("0.000");
  });
});

describe("users", () => {
  it("creates a user who can then sign in", async () => {
    const email = `new.user.${Date.now()}@example.com`;
    const created = await request(admin, "POST", "/users", {
      email,
      displayName: "New User",
      role: "Office",
      password: "another-long-password",
    });

    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const signedIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in",
      payload: { email, password: "another-long-password" },
    });
    expect(signedIn.statusCode).toBe(201);
  });

  it("rejects a short password", async () => {
    const response = await request(admin, "POST", "/users", {
      email: "short@example.com",
      displayName: "Short",
      role: "Office",
      password: "short",
    });

    expect(response.status).toBe(422);
  });

  it("ends active sessions when a user is disabled", async () => {
    const email = `disabled.${Date.now()}@example.com`;
    const created = await request(admin, "POST", "/users", {
      email,
      displayName: "To Disable",
      role: "Office",
      password: "another-long-password",
    });
    const userId = (created.body as { user: { id: string } }).user.id;
    const cookie = `stockcontrol.session=${await sessionValueFor(email)}`;
    const actor: Actor = { id: userId, email, cookie };

    expect((await request(actor, "GET", "/items")).status).toBe(200);

    await request(admin, "PATCH", `/users/${userId}`, { isActive: false });

    expect((await request(actor, "GET", "/items")).status).toBe(401);
  });

  it("will not let the last active Admin be demoted", async () => {
    const response = await request(admin, "PATCH", `/users/${admin.id}`, { role: "Office" });

    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("your own role");
  });
});

async function sessionValueFor(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/auth/sign-in",
    payload: { email, password: "another-long-password" },
  });

  return response.cookies.find((cookie) => cookie.name === "stockcontrol.session")?.value ?? "";
}

describe("dashboard", () => {
  it("returns low stock, the user's reservations and recent activity", async () => {
    const response = await request(engineer, "GET", "/dashboard");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      lowStock: expect.any(Array),
      myReservations: expect.any(Array),
      recentTransactions: expect.any(Array),
      counts: expect.any(Object),
    });
  });
});
