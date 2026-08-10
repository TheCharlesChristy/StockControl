import { randomUUID } from "node:crypto";

import type { InjectOptions } from "fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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
import { createApiApplication } from "../src/bootstrap";

/*
 * `STOCK_CAPTURE_ENABLED` is not set for this file, which is the point: an
 * existing installation that deploys this commit gets exactly the routes it
 * had before. The other capture spec turns the flag on inside its own
 * process — Vitest gives every test file a fresh module graph, so the two
 * files' opposite settings of `app.module.ts`'s frozen decision never collide.
 */
describe("assisted stock capture, disabled", () => {
  let app: NestFastifyApplication;
  let migrator: Kysely<StockControlDatabase>;
  let cookie: string;

  const schema = (): ReturnType<Kysely<StockControlDatabase>["withSchema"]> =>
    migrator.withSchema(STOCKCONTROL_SCHEMA);

  beforeAll(async () => {
    const configuration = loadMigratorDatabaseConfiguration();
    const { runtimeRole } = loadMigrationDatabaseRoles(process.env, configuration.connectionString);
    migrator = createMigratorDatabase(configuration);
    await runMigrations(migrator, { runtimeRole });

    const email = `capture-disabled.${randomUUID()}@example.invalid`;
    await schema()
      .insertInto("users")
      .values({
        id: randomUUID(),
        email,
        display_name: "Capture disabled fixture",
        role: "Office",
        password_hash: await hashPassword("integration-password"),
        is_active: true,
      })
      .execute();

    app = await createApiApplication();

    const signIn = await app.inject({
      method: "POST",
      url: "/api/v1/auth/sign-in",
      payload: { email, password: "integration-password" },
    });
    const sessionCookie = signIn.cookies.find(
      (candidate) => candidate.name === "stockcontrol.session",
    );
    cookie = `stockcontrol.session=${sessionCookie?.value ?? ""}`;
  });

  afterAll(async () => {
    await app.close();
    await schema().deleteFrom("sessions").execute();
    await schema().deleteFrom("users").where("email", "like", "capture-disabled.%").execute();
    await migrator.destroy();
  });

  const inject = (options: InjectOptions): ReturnType<NestFastifyApplication["inject"]> =>
    app.inject({ ...options, headers: { ...options.headers, cookie } });

  it("does not register the capture routes at all", async () => {
    const response = await inject({
      method: "POST",
      url: "/api/v1/stock-capture/batches",
      payload: { clientBatchId: randomUUID(), defaultLocationId: null },
    });

    /*
     * 404 from Fastify's own router, not from the application. A route that
     * existed and refused the request would answer 403 or an application
     * failure; this is what "never wired up" looks like on the wire.
     */
    expect(response.statusCode).toBe(404);
  });

  it("leaves every other route working", async () => {
    expect((await inject({ method: "GET", url: "/api/v1/items" })).statusCode).toBe(200);
  });
});
