import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { describe, expect, it } from "vitest";

import { loadMigratorDatabaseConfiguration } from "../src/configuration";
import { createMigratorDatabase } from "../src/connection";
import { mcpOAuthInteroperabilityMigrationDefinition } from "../src/migrations/0011-mcp-oauth-interoperability";
import { STOCKCONTROL_SCHEMA } from "../src/schema";

/*
 * The down path specifically, against a real server: the up migration
 * relaxes oauth_grant_events' event_type check to allow
 * 'RefreshReplayDetected', and the down path reinstates the narrower one — a
 * plain "add constraint" that fails outright once a row of that type exists,
 * unless it is dealt with first. Run inside one transaction that never
 * commits, so the fixture and the rollback both leave no trace.
 */
describe("0011 mcp oauth interoperability migration — down path", () => {
  it("reinstates the narrower event_type constraint even after a replay was recorded", async () => {
    const migrator = createMigratorDatabase(loadMigratorDatabaseConfiguration());
    const rollbackSentinel = new Error("intentional rollback — fixture only, never committed");

    try {
      await migrator.transaction().execute(async (tx) => {
        const userId = randomUUID();
        const grantId = randomUUID();

        await tx
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("users")
          .values({
            id: userId,
            username: `down-migration.${userId.slice(0, 12)}`,
            display_name: "Down migration fixture",
            email: null,
            role: "Office",
            password_hash: "not-a-real-hash",
          })
          .execute();

        await tx
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("oauth_grants")
          .values({
            id: grantId,
            user_id: userId,
            client_id: "down-migration-fixture",
            redirect_uri: "https://example.invalid/callback",
          })
          .execute();

        /* The row type the narrower constraint this reinstates has no slot for. */
        await tx
          .withSchema(STOCKCONTROL_SCHEMA)
          .insertInto("oauth_grant_events")
          .values({
            id: randomUUID(),
            grant_id: grantId,
            user_id: userId,
            event_type: "RefreshReplayDetected",
            scopes: JSON.stringify([]),
          })
          .execute();

        /*
         * Only the statements relevant to the constraint: dropping the real
         * table this migration creates would also need every later
         * migration's own down path run first, which is a bigger, riskier
         * operation this test has no need for to prove the one thing in
         * question.
         */
        const relevant = mcpOAuthInteroperabilityMigrationDefinition.downStatements.filter(
          (statement) => statement.includes("oauth_grant_events"),
        );
        expect(relevant.length).toBeGreaterThan(0);

        for (const statement of relevant) {
          await sql.raw(statement).execute(tx);
        }

        const remaining = await tx
          .withSchema(STOCKCONTROL_SCHEMA)
          .selectFrom("oauth_grant_events")
          .select("id")
          .where("grant_id", "=", grantId)
          .execute();

        expect(remaining).toEqual([]);

        throw rollbackSentinel;
      });
    } catch (error: unknown) {
      if (error !== rollbackSentinel) throw error;
    } finally {
      await migrator.destroy();
    }
  });
});
