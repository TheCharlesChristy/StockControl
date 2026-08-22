import { createHash, randomBytes, randomUUID, timingSafeEqual, webcrypto } from "node:crypto";

import type { McpConnectionView } from "@stockcontrol/contracts";
import type {
  JsonValue,
  OAuthGrantEventType,
  StockControlDatabase,
} from "@stockcontrol/platform-database";
import { sql, type Kysely, type Transaction } from "kysely";

import type { CurrentUser } from "../../auth/session-service";
import type { McpConfiguration } from "./mcp-configuration";

export const MCP_SCOPES = [
  "stock:read",
  "activity:read",
  "stock:request",
  "stock:write",
  "requests:review",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

const SCHEMA = "stockcontrol" as const;
const AUTHORIZATION_CODE_BYTES = 32;
const TOKEN_BYTES = 32;
const AUTHORIZATION_REQUEST_MINUTES = 10;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface McpPrincipal {
  readonly grantId: string;
  readonly clientId: string;
  readonly scopes: readonly McpScope[];
  readonly user: CurrentUser;
}

export interface AuthorizationRequestInput {
  readonly userId: string | null;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly scopes: readonly McpScope[];
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly resourceUri: string;
}

export interface AuthorizationApproval {
  readonly redirectUri: string;
  readonly state: string | null;
  readonly code: string;
}

export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly McpScope[];
}

export type GrantRevokeOutcome = "revoked" | "already-revoked" | "not-found";

interface AuthorizationRequestRow {
  readonly id: string;
  readonly user_id: string | null;
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly resource_uri: string | null;
  readonly approval_handle_hash: string | null;
  readonly state: string | null;
  readonly requested_scopes: JsonValue;
  readonly code_challenge: string;
  readonly code_challenge_method: string;
  readonly authorization_code_hash: string | null;
  readonly expires_at: Date;
  readonly approved_at: Date | null;
  readonly consumed_at: Date | null;
  readonly authorization_code_expires_at: Date | null;
  readonly denied_at: Date | null;
  readonly created_at: Date;
}

interface GrantTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly client_id: string;
  readonly redirect_uri: string;
  readonly resource_uri: string | null;
  readonly granted_scopes: JsonValue;
  readonly authorization_code_used_at: Date | null;
  readonly refresh_token_expires_at: Date | null;
}

const opaqueToken = (bytes: number): string => randomBytes(bytes).toString("base64url");

const sameSecret = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const readScopes = (value: JsonValue | null | undefined): readonly McpScope[] => {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (scope): scope is McpScope =>
      typeof scope === "string" && (MCP_SCOPES as readonly string[]).includes(scope),
  );
};

const scopeJson = (scopes: readonly string[]): string => JSON.stringify(scopes);

const scopeSet = (scopes: readonly string[]): string => [...new Set(scopes)].sort().join(" ");

const insertEvent = async (
  database: Kysely<StockControlDatabase> | Transaction<StockControlDatabase>,
  grantId: string,
  userId: string,
  eventType: OAuthGrantEventType,
  scopes: readonly string[],
  occurredAt: Date,
): Promise<void> => {
  await database
    .withSchema(SCHEMA)
    .insertInto("oauth_grant_events")
    .values({
      id: randomUUID(),
      grant_id: grantId,
      user_id: userId,
      event_type: eventType,
      scopes: scopeJson(scopes),
      occurred_at: occurredAt,
    })
    .execute();
};

export class OAuthTokenError extends Error {
  public constructor(
    public readonly code:
      | "invalid_request"
      | "invalid_scope"
      | "invalid_grant"
      | "invalid_client"
      | "unsupported_grant_type",
    message: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

export class OAuthService {
  private readonly tokenHashKey: Promise<CryptoKey>;

  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly configuration: McpConfiguration,
    private readonly now: () => Date = () => new Date(),
  ) {
    /*
     * These values are 256-bit random bearer secrets, not passwords. HMAC
     * keeps indexed lookup cheap without blocking the event loop, while a
     * database-only compromise cannot verify candidate tokens without the
     * deployment's separate key.
     */
    this.tokenHashKey = webcrypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(configuration.tokenHashKey),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
  }

  private async hashToken(token: string): Promise<string> {
    const digest = await webcrypto.subtle.sign(
      "HMAC",
      await this.tokenHashKey,
      new TextEncoder().encode(token),
    );
    return Buffer.from(digest).toString("hex");
  }

  public async createAuthorizationRequest(input: AuthorizationRequestInput): Promise<string> {
    this.validateRequest(input);
    const id = randomUUID();
    const handle = opaqueToken(TOKEN_BYTES);
    const createdAt = this.now();
    await this.database
      .withSchema(SCHEMA)
      .insertInto("oauth_authorization_requests")
      .values({
        id,
        user_id: input.userId,
        client_id: input.clientId,
        redirect_uri: input.redirectUri,
        resource_uri: input.resourceUri,
        approval_handle_hash: await this.hashToken(handle),
        state: input.state,
        requested_scopes: scopeJson(input.scopes),
        code_challenge: input.codeChallenge,
        code_challenge_method: input.codeChallengeMethod,
        authorization_code_hash: null,
        expires_at: new Date(createdAt.getTime() + AUTHORIZATION_REQUEST_MINUTES * 60_000),
        approved_at: null,
        consumed_at: null,
        authorization_code_expires_at: null,
        denied_at: null,
        created_at: createdAt,
      })
      .execute();
    return handle;
  }

  public async deleteExpiredAuthorizationRequests(): Promise<number> {
    const result = await this.database
      .withSchema(SCHEMA)
      .deleteFrom("oauth_authorization_requests")
      .where((builder) =>
        builder.or([
          builder("expires_at", "<=", this.now()),
          builder("consumed_at", "is not", null),
        ]),
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  public async bindAuthorizationRequest(
    handle: string,
    userId: string,
  ): Promise<readonly McpScope[]> {
    if (handle.length < 40 || handle.length > 512 || !UUID_PATTERN.test(userId)) {
      throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
    }
    return this.database.transaction().execute(async (tx) => {
      const row = (await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_authorization_requests")
        .selectAll()
        .where("approval_handle_hash", "=", await this.hashToken(handle))
        .where("consumed_at", "is", null)
        .where("denied_at", "is", null)
        .forUpdate()
        .executeTakeFirst()) as AuthorizationRequestRow | undefined;
      const now = this.now();
      if (
        row === undefined ||
        row.approved_at !== null ||
        row.expires_at.getTime() <= now.getTime() ||
        (row.user_id !== null && row.user_id !== userId)
      ) {
        throw new OAuthTokenError(
          "invalid_request",
          "The authorization request is invalid or expired.",
        );
      }
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_authorization_requests")
        .set({ user_id: userId })
        .where("id", "=", row.id)
        .execute();
      return readScopes(row.requested_scopes);
    });
  }

  public async approveAuthorizationRequest(
    handle: string,
    userId?: string,
  ): Promise<AuthorizationApproval> {
    if (
      handle.length < 40 ||
      handle.length > 512 ||
      (userId !== undefined && !UUID_PATTERN.test(userId))
    ) {
      throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
    }
    const code = opaqueToken(AUTHORIZATION_CODE_BYTES);
    const now = this.now();
    return this.database.transaction().execute(async (tx) => {
      const row = (await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_authorization_requests")
        .selectAll()
        .where("approval_handle_hash", "=", await this.hashToken(handle))
        .where("consumed_at", "is", null)
        .where("denied_at", "is", null)
        .forUpdate()
        .executeTakeFirst()) as AuthorizationRequestRow | undefined;

      if (
        row === undefined ||
        row.approved_at !== null ||
        row.expires_at.getTime() <= now.getTime()
      ) {
        throw new OAuthTokenError(
          "invalid_request",
          "The authorization request is invalid or expired.",
        );
      }

      if (row.user_id !== null && userId !== undefined && row.user_id !== userId) {
        throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
      }
      const boundUserId = row.user_id ?? userId;
      if (boundUserId === undefined) {
        throw new OAuthTokenError("invalid_request", "Sign in before approving the connection.");
      }

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_authorization_requests")
        .set({
          authorization_code_hash: await this.hashToken(code),
          approved_at: now,
          authorization_code_expires_at: new Date(now.getTime() + 120_000),
          user_id: boundUserId,
          approval_handle_hash: null,
        })
        .where("id", "=", row.id)
        .execute();

      return { redirectUri: row.redirect_uri, state: row.state, code };
    });
  }

  public async denyAuthorizationRequest(
    handle: string,
    userId?: string,
  ): Promise<AuthorizationApproval> {
    if (
      handle.length < 40 ||
      handle.length > 512 ||
      (userId !== undefined && !UUID_PATTERN.test(userId))
    ) {
      throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
    }
    return this.database.transaction().execute(async (tx) => {
      const row = (await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_authorization_requests")
        .selectAll()
        .where("approval_handle_hash", "=", await this.hashToken(handle))
        .where("consumed_at", "is", null)
        .where("denied_at", "is", null)
        .forUpdate()
        .executeTakeFirst()) as AuthorizationRequestRow | undefined;
      const now = this.now();
      if (
        row === undefined ||
        row.approved_at !== null ||
        row.expires_at.getTime() <= now.getTime() ||
        (row.user_id !== null && userId !== undefined && row.user_id !== userId)
      ) {
        throw new OAuthTokenError(
          "invalid_request",
          "The authorization request is invalid or expired.",
        );
      }
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_authorization_requests")
        .set({ denied_at: now, consumed_at: now, approval_handle_hash: null })
        .where("id", "=", row.id)
        .execute();
      return { redirectUri: row.redirect_uri, state: row.state, code: "" };
    });
  }

  public async exchangeAuthorizationCode(
    code: string,
    clientId: string,
    redirectUri: string,
    verifier: string,
    resourceUri: string,
  ): Promise<TokenResponse> {
    return this.database.transaction().execute(async (tx) => {
      const row = (await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_authorization_requests")
        .selectAll()
        .where("authorization_code_hash", "=", await this.hashToken(code))
        .where("client_id", "=", clientId)
        .where("redirect_uri", "=", redirectUri)
        .where("resource_uri", "=", resourceUri)
        .where("approved_at", "is not", null)
        .where("consumed_at", "is", null)
        .forUpdate()
        .executeTakeFirst()) as AuthorizationRequestRow | undefined;

      if (
        row === undefined ||
        (row.authorization_code_expires_at ?? row.expires_at).getTime() <= this.now().getTime() ||
        row.authorization_code_hash === null
      ) {
        throw new OAuthTokenError("invalid_grant", "The authorization code is invalid or expired.");
      }
      if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
        throw new OAuthTokenError("invalid_grant", "The PKCE verifier was not accepted.");
      }
      const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
      if (!sameSecret(actualChallenge, row.code_challenge)) {
        throw new OAuthTokenError("invalid_grant", "The PKCE verifier was not accepted.");
      }
      if (row.user_id === null) {
        throw new OAuthTokenError(
          "invalid_grant",
          "The authorization code is not bound to a user.",
        );
      }

      const scopes = readScopes(row.requested_scopes);
      const lockKey = JSON.stringify([row.user_id, row.client_id, row.redirect_uri, resourceUri]);
      await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`.execute(tx);
      const previous = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .select(["id", "user_id", "granted_scopes"])
        .where("user_id", "=", row.user_id)
        .where("client_id", "=", row.client_id)
        .where("redirect_uri", "=", row.redirect_uri)
        .where((builder) =>
          builder.or([
            builder("resource_uri", "=", resourceUri),
            builder("resource_uri", "is", null),
          ]),
        )
        .where("revoked_at", "is", null)
        .orderBy("id", "asc")
        .forUpdate()
        .execute();
      const issuedAt = this.now();
      for (const grant of previous) {
        await tx
          .withSchema(SCHEMA)
          .updateTable("oauth_grants")
          .set({ revoked_at: issuedAt, updated_at: issuedAt })
          .where("id", "=", grant.id)
          .execute();
        await tx
          .withSchema(SCHEMA)
          .updateTable("oauth_refresh_tokens")
          .set({ revoked_at: issuedAt })
          .where("grant_id", "=", grant.id)
          .execute();
        await insertEvent(
          tx,
          grant.id,
          grant.user_id,
          "Revoked",
          readScopes(grant.granted_scopes),
          issuedAt,
        );
      }

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_authorization_requests")
        .set({ consumed_at: issuedAt })
        .where("id", "=", row.id)
        .execute();

      return this.issueTokens(
        tx,
        {
          id: randomUUID(),
          user_id: row.user_id,
          client_id: row.client_id,
          redirect_uri: row.redirect_uri,
          resource_uri: resourceUri,
          granted_scopes: row.requested_scopes,
          authorization_code_used_at: issuedAt,
          refresh_token_expires_at: null,
        },
        scopes,
        true,
        previous.length > 0,
        previous.some((grant) => scopeSet(readScopes(grant.granted_scopes)) !== scopeSet(scopes)),
        issuedAt,
      );
    });
  }

  public async refresh(
    refreshToken: string,
    clientId: string,
    resourceUri: string,
  ): Promise<TokenResponse> {
    return this.database.transaction().execute(async (tx) => {
      const tokenHash = await this.hashToken(refreshToken);
      const refreshRow = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_refresh_tokens")
        .selectAll()
        .where("token_hash", "=", tokenHash)
        .where("client_id", "=", clientId)
        .forUpdate()
        .executeTakeFirst();
      const row =
        refreshRow === undefined
          ? undefined
          : await tx
              .withSchema(SCHEMA)
              .selectFrom("oauth_grants")
              .selectAll()
              .where("id", "=", refreshRow.grant_id)
              .where("client_id", "=", clientId)
              .forUpdate()
              .executeTakeFirst();
      const now = this.now();

      if (refreshRow?.used_at !== null && refreshRow !== undefined && row !== undefined) {
        if (row.revoked_at === null) {
          await tx
            .withSchema(SCHEMA)
            .updateTable("oauth_grants")
            .set({ revoked_at: now, updated_at: now })
            .where("id", "=", row.id)
            .execute();
          await tx
            .withSchema(SCHEMA)
            .updateTable("oauth_refresh_tokens")
            .set({ revoked_at: now })
            .where("grant_id", "=", row.id)
            .execute();
          await insertEvent(
            tx,
            row.id,
            row.user_id,
            "RefreshReplayDetected",
            readScopes(row.granted_scopes),
            now,
          );
        }
        throw new OAuthTokenError("invalid_grant", "The refresh token is invalid or expired.");
      }

      if (
        refreshRow === undefined ||
        row === undefined ||
        row.revoked_at !== null ||
        refreshRow.resource_uri !== resourceUri ||
        refreshRow.expires_at.getTime() <= now.getTime() ||
        row.refresh_token_expires_at === null ||
        row.refresh_token_expires_at.getTime() <= now.getTime()
      ) {
        throw new OAuthTokenError("invalid_grant", "The refresh token is invalid or expired.");
      }

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_refresh_tokens")
        .set({ used_at: now })
        .where("id", "=", refreshRow.id)
        .execute();

      return this.issueTokens(tx, row, readScopes(row.granted_scopes), false, false, false, now);
    });
  }

  public async revoke(token: string): Promise<void> {
    const now = this.now();
    const tokenHash = await this.hashToken(token);
    await this.database.transaction().execute(async (tx) => {
      const refreshToken = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_refresh_tokens")
        .select("grant_id")
        .where("token_hash", "=", tokenHash)
        .executeTakeFirst();
      const row = refreshToken
        ? await tx
            .withSchema(SCHEMA)
            .selectFrom("oauth_grants")
            .select(["id", "user_id", "granted_scopes", "revoked_at"])
            .where("id", "=", refreshToken.grant_id)
            .forUpdate()
            .executeTakeFirst()
        : await tx
            .withSchema(SCHEMA)
            .selectFrom("oauth_grants")
            .select(["id", "user_id", "granted_scopes", "revoked_at"])
            .where((builder) =>
              builder.or([
                builder("access_token_hash", "=", tokenHash),
                builder("refresh_token_hash", "=", tokenHash),
              ]),
            )
            .forUpdate()
            .executeTakeFirst();

      if (row === undefined || row.revoked_at !== null) return;
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_grants")
        .set({ revoked_at: now, updated_at: now })
        .where("id", "=", row.id)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_refresh_tokens")
        .set({ revoked_at: now })
        .where("grant_id", "=", row.id)
        .execute();
      await insertEvent(tx, row.id, row.user_id, "Revoked", readScopes(row.granted_scopes), now);
    });
  }

  public async resolveAccessToken(token: string): Promise<McpPrincipal | null> {
    const tokenHash = await this.hashToken(token);
    const row = await this.database
      .withSchema(SCHEMA)
      .selectFrom("oauth_grants")
      .innerJoin("users", "users.id", "oauth_grants.user_id")
      .select([
        "oauth_grants.id as grant_id",
        "oauth_grants.client_id as client_id",
        "oauth_grants.granted_scopes as granted_scopes",
        "oauth_grants.access_token_expires_at as access_token_expires_at",
        "users.id as user_id",
        "users.username as username",
        "users.email as email",
        "users.display_name as display_name",
        "users.role as role",
        "users.is_active as is_active",
      ])
      .where("oauth_grants.access_token_hash", "=", tokenHash)
      .where("oauth_grants.resource_uri", "=", this.configuration.resourceUri)
      .where("oauth_grants.revoked_at", "is", null)
      .executeTakeFirst();

    if (
      row === undefined ||
      !row.is_active ||
      row.access_token_expires_at === null ||
      row.access_token_expires_at.getTime() <= this.now().getTime()
    ) {
      return null;
    }

    return {
      grantId: row.grant_id,
      clientId: row.client_id,
      scopes: readScopes(row.granted_scopes),
      user: {
        id: row.user_id,
        username: row.username,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
      },
    };
  }

  public async connectionsForUser(userId: string): Promise<readonly McpConnectionView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("oauth_grants")
      .select(["id", "client_id", "granted_scopes", "created_at", "revoked_at"])
      .where("user_id", "=", userId)
      .where("resource_uri", "=", this.configuration.resourceUri)
      .where("access_token_hash", "is not", null)
      .orderBy("created_at", "desc")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      scopes: readScopes(row.granted_scopes),
      createdAt: row.created_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }));
  }

  public async allConnections(): Promise<readonly McpConnectionView[]> {
    const rows = await this.database
      .withSchema(SCHEMA)
      .selectFrom("oauth_grants")
      .select(["id", "client_id", "granted_scopes", "created_at", "revoked_at"])
      .where("resource_uri", "=", this.configuration.resourceUri)
      .where("access_token_hash", "is not", null)
      .orderBy("created_at", "desc")
      .execute();

    return rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      scopes: readScopes(row.granted_scopes),
      createdAt: row.created_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
    }));
  }

  public async revokeGrant(
    grantId: string,
    actorUserId: string,
    isAdmin: boolean,
  ): Promise<GrantRevokeOutcome> {
    if (!UUID_PATTERN.test(grantId)) return "not-found";
    const now = this.now();
    return this.database.transaction().execute(async (tx) => {
      const row = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .select(["id", "user_id", "granted_scopes", "revoked_at"])
        .where("id", "=", grantId)
        .forUpdate()
        .executeTakeFirst();

      if (row === undefined || (!isAdmin && row.user_id !== actorUserId)) return "not-found";
      if (row.revoked_at !== null) return "already-revoked";

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_grants")
        .set({ revoked_at: now, updated_at: now })
        .where("id", "=", grantId)
        .execute();
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_refresh_tokens")
        .set({ revoked_at: now })
        .where("grant_id", "=", grantId)
        .execute();
      await insertEvent(tx, grantId, row.user_id, "Revoked", readScopes(row.granted_scopes), now);
      return "revoked";
    });
  }

  private validateRequest(input: AuthorizationRequestInput): void {
    if (
      (input.userId !== null && !UUID_PATTERN.test(input.userId)) ||
      input.clientId !== this.configuration.clientId ||
      input.redirectUri !== this.configuration.redirectUri ||
      input.resourceUri !== this.configuration.resourceUri ||
      input.codeChallengeMethod !== "S256" ||
      !PKCE_CHALLENGE_PATTERN.test(input.codeChallenge)
    ) {
      throw new OAuthTokenError("invalid_request", "PKCE S256 is required.");
    }
    if (
      input.scopes.length === 0 ||
      new Set(input.scopes).size !== input.scopes.length ||
      input.scopes.some((scope) => !(MCP_SCOPES as readonly string[]).includes(scope))
    ) {
      throw new OAuthTokenError("invalid_scope", "The requested scope is not supported.");
    }
    if (input.state !== null && (input.state.length === 0 || input.state.length > 512)) {
      throw new OAuthTokenError("invalid_request", "The state parameter is too long.");
    }
  }

  private async issueTokens(
    tx: Transaction<StockControlDatabase>,
    row: GrantTokenRow,
    scopes: readonly McpScope[],
    consumeCode: boolean,
    reauthorised: boolean,
    scopeChanged: boolean,
    issuedAt: Date,
  ): Promise<TokenResponse> {
    if (row.resource_uri === null) {
      throw new OAuthTokenError("invalid_grant", "The OAuth resource is not registered.");
    }
    const accessToken = opaqueToken(TOKEN_BYTES);
    const refreshToken = opaqueToken(TOKEN_BYTES);
    const accessExpiresAt = new Date(
      issuedAt.getTime() + this.configuration.accessTokenMinutes * 60_000,
    );
    const refreshExpiresAt = consumeCode
      ? new Date(issuedAt.getTime() + this.configuration.refreshTokenDays * 86_400_000)
      : row.refresh_token_expires_at;
    if (refreshExpiresAt === null || refreshExpiresAt.getTime() <= issuedAt.getTime()) {
      throw new OAuthTokenError("invalid_grant", "The refresh token is invalid or expired.");
    }
    const [accessTokenHash, refreshTokenHash] = await Promise.all([
      this.hashToken(accessToken),
      this.hashToken(refreshToken),
    ]);

    if (consumeCode) {
      await tx
        .withSchema(SCHEMA)
        .insertInto("oauth_grants")
        .values({
          id: row.id,
          user_id: row.user_id,
          client_id: row.client_id,
          redirect_uri: row.redirect_uri,
          resource_uri: row.resource_uri,
          granted_scopes: scopeJson(scopes),
          authorization_code_hash: null,
          authorization_code_challenge: null,
          authorization_code_method: null,
          authorization_code_expires_at: null,
          authorization_code_used_at: issuedAt,
          access_token_hash: accessTokenHash,
          access_token_expires_at: accessExpiresAt,
          refresh_token_hash: refreshTokenHash,
          refresh_token_expires_at: refreshExpiresAt,
          revoked_at: null,
          created_at: issuedAt,
          updated_at: issuedAt,
        })
        .execute();
    } else {
      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_grants")
        .set({
          access_token_hash: accessTokenHash,
          access_token_expires_at: accessExpiresAt,
          refresh_token_hash: refreshTokenHash,
          refresh_token_expires_at: refreshExpiresAt,
          updated_at: issuedAt,
        })
        .where("id", "=", row.id)
        .execute();
    }

    await tx
      .withSchema(SCHEMA)
      .insertInto("oauth_refresh_tokens")
      .values({
        id: randomUUID(),
        grant_id: row.id,
        client_id: row.client_id,
        resource_uri: row.resource_uri,
        token_hash: refreshTokenHash,
        expires_at: refreshExpiresAt,
        used_at: null,
        revoked_at: null,
        created_at: issuedAt,
      })
      .execute();

    if (consumeCode) {
      await insertEvent(
        tx,
        row.id,
        row.user_id,
        reauthorised ? "Reauthorised" : "Connected",
        scopes,
        issuedAt,
      );
      if (scopeChanged)
        await insertEvent(tx, row.id, row.user_id, "ScopeChanged", scopes, issuedAt);
    } else {
      await insertEvent(tx, row.id, row.user_id, "Refreshed", scopes, issuedAt);
    }

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configuration.accessTokenMinutes * 60,
      scopes,
    };
  }
}
