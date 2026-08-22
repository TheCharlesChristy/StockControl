import { createHash, randomUUID } from "node:crypto";

import {
  createMigratorDatabase,
  createRuntimeDatabase,
  loadMigrationDatabaseRoles,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MCP_SCOPES, OAuthService } from "../../src/integrations/mcp/oauth.service";

const clientId = "oauth-integration-client";
const redirectUri = "https://chatgpt.example/oauth/callback";
const resourceUri = "https://stockcontrol.example/mcp";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
const configuration = {
  accessTokenMinutes: 15,
  refreshTokenDays: 30,
  clientId,
  redirectUri,
  tokenHashKey: "test-only-mcp-token-hash-key-that-is-long-enough",
  resourceUri,
} as never;

describe.sequential("OAuth grant lifecycle against PostgreSQL", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;
  let userId: string;
  let currentTime = Date.parse("2026-08-21T00:00:00.000Z");
  let oauth: OAuthService;

  beforeAll(async () => {
    const migratorConfiguration = loadMigratorDatabaseConfiguration();
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    const { runtimeRole } = loadMigrationDatabaseRoles(
      process.env,
      migratorConfiguration.connectionString,
    );
    migrator = createMigratorDatabase(migratorConfiguration);
    await runMigrations(migrator, { runtimeRole });
    runtime = createRuntimeDatabase(runtimeConfiguration);
    userId = randomUUID();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .insertInto("users")
      .values({
        id: userId,
        username: `oauth.${process.pid}.${Date.now()}`,
        email: null,
        display_name: "OAuth integration user",
        role: "Office",
        password_hash: "unused",
        is_active: true,
      })
      .execute();
    oauth = new OAuthService(runtime, configuration, () => new Date(currentTime));
  });

  afterAll(async () => {
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_grant_events")
      .where("user_id", "=", userId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_authorization_requests")
      .where("user_id", "=", userId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_refresh_tokens")
      .where("grant_id", "in", (builder) =>
        builder.selectFrom("oauth_grants").select("id").where("user_id", "=", userId),
      )
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("oauth_grants")
      .where("user_id", "=", userId)
      .execute();
    await migrator
      .withSchema(STOCKCONTROL_SCHEMA)
      .deleteFrom("users")
      .where("id", "=", userId)
      .execute();
    await runtime.destroy();
    await migrator.destroy();
  });

  it("supports PKCE exchange, refresh rotation, reauthorization invalidation and revoke outcomes", async () => {
    const requestId = await oauth.createAuthorizationRequest({
      userId,
      clientId,
      redirectUri,
      state: "state-1",
      scopes: [MCP_SCOPES[0], MCP_SCOPES[1]],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      resourceUri,
    });
    const approval = await oauth.approveAuthorizationRequest(requestId, userId);
    expect(approval.state).toBe("state-1");

    const first = await oauth.exchangeAuthorizationCode(
      approval.code,
      clientId,
      redirectUri,
      verifier,
      resourceUri,
    );
    expect(await oauth.resolveAccessToken(first.accessToken)).not.toBeNull();

    const refreshed = await oauth.refresh(first.refreshToken, clientId, resourceUri);
    expect(await oauth.resolveAccessToken(first.accessToken)).toBeNull();
    expect(await oauth.resolveAccessToken(refreshed.accessToken)).not.toBeNull();

    const narrowerRequest = await oauth.createAuthorizationRequest({
      userId,
      clientId,
      redirectUri,
      state: null,
      scopes: [MCP_SCOPES[0]],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      resourceUri,
    });
    const narrowerApproval = await oauth.approveAuthorizationRequest(narrowerRequest, userId);
    const narrower = await oauth.exchangeAuthorizationCode(
      narrowerApproval.code,
      clientId,
      redirectUri,
      verifier,
      resourceUri,
    );
    expect(await oauth.resolveAccessToken(refreshed.accessToken)).toBeNull();
    expect((await oauth.resolveAccessToken(narrower.accessToken))?.scopes).toEqual([MCP_SCOPES[0]]);

    expect(await oauth.revokeGrant("not-a-grant", userId, false)).toBe("not-found");

    const grant = await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("oauth_grants")
      .select("id")
      .where("user_id", "=", userId)
      .where("revoked_at", "is", null)
      .executeTakeFirstOrThrow();
    expect(await oauth.revokeGrant(grant.id, userId, false)).toBe("revoked");
    expect(await oauth.revokeGrant(grant.id, userId, false)).toBe("already-revoked");
    expect(await oauth.resolveAccessToken(narrower.accessToken)).toBeNull();
  });

  it("rejects replay, bad PKCE and expired authorization requests", async () => {
    await expect(oauth.approveAuthorizationRequest("not-a-request", userId)).rejects.toMatchObject({
      code: "invalid_request",
    });

    const requestId = await oauth.createAuthorizationRequest({
      userId,
      clientId,
      redirectUri,
      state: null,
      scopes: [MCP_SCOPES[0]],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      resourceUri,
    });
    const approval = await oauth.approveAuthorizationRequest(requestId, userId);

    await expect(
      oauth.exchangeAuthorizationCode(
        approval.code,
        clientId,
        redirectUri,
        "x".repeat(64),
        resourceUri,
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    await oauth.exchangeAuthorizationCode(
      approval.code,
      clientId,
      redirectUri,
      verifier,
      resourceUri,
    );
    await expect(
      oauth.exchangeAuthorizationCode(approval.code, clientId, redirectUri, verifier, resourceUri),
    ).rejects.toMatchObject({ code: "invalid_grant" });

    currentTime += 11 * 60_000;
    const expired = await oauth.createAuthorizationRequest({
      userId,
      clientId,
      redirectUri,
      state: null,
      scopes: [MCP_SCOPES[0]],
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      resourceUri,
    });
    currentTime += 11 * 60_000;
    await expect(oauth.approveAuthorizationRequest(expired, userId)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(await oauth.deleteExpiredAuthorizationRequests()).toBeGreaterThan(0);
  });
});
