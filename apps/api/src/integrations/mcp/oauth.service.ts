import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { McpConnectionView } from "@stockcontrol/contracts";
import type {
  JsonValue,
  OAuthGrantEventType,
  StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely, Transaction } from "kysely";

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

export interface McpPrincipal {
  readonly grantId: string;
  readonly clientId: string;
  readonly scopes: readonly McpScope[];
  readonly user: CurrentUser;
}

export interface AuthorizationCodeInput {
  readonly userId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: readonly McpScope[];
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
}

export interface TokenResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scopes: readonly McpScope[];
}

interface GrantTokenRow {
  readonly id: string;
  readonly user_id: string;
  readonly authorization_code_used_at: Date | null;
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const opaqueToken = (bytes: number): string => randomBytes(bytes).toString("base64url");

const sameSecret = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};

const readScopes = (value: JsonValue | null | undefined): readonly McpScope[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (scope): scope is McpScope =>
      typeof scope === "string" && (MCP_SCOPES as readonly string[]).includes(scope),
  );
};

const scopeJson = (scopes: readonly string[]): string => JSON.stringify(scopes);

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
      "invalid_request" | "invalid_grant" | "invalid_client" | "unsupported_grant_type",
    message: string,
  ) {
    super(message);
    this.name = "OAuthTokenError";
  }
}

export class OAuthService {
  public constructor(
    private readonly database: Kysely<StockControlDatabase>,
    private readonly configuration: McpConfiguration,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async createAuthorizationCode(input: AuthorizationCodeInput): Promise<string> {
    if (input.codeChallengeMethod !== "S256" || input.codeChallenge.length < 43) {
      throw new OAuthTokenError("invalid_request", "PKCE S256 is required.");
    }

    const unsupported = input.scopes.filter(
      (scope) => !(MCP_SCOPES as readonly string[]).includes(scope),
    );
    if (unsupported.length > 0 || input.scopes.length === 0) {
      throw new OAuthTokenError("invalid_request", "The requested scope is not supported.");
    }

    const issuedAt = this.now();
    const code = opaqueToken(AUTHORIZATION_CODE_BYTES);
    const grantId = randomUUID();

    await this.database.transaction().execute(async (tx) => {
      const existing = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .select(["id", "user_id", "granted_scopes"])
        .where("user_id", "=", input.userId)
        .where("client_id", "=", input.clientId)
        .where("redirect_uri", "=", input.redirectUri)
        .where("revoked_at", "is", null)
        .forUpdate()
        .execute();

      for (const previous of existing) {
        await tx
          .withSchema(SCHEMA)
          .updateTable("oauth_grants")
          .set({ revoked_at: issuedAt, updated_at: issuedAt })
          .where("id", "=", previous.id)
          .execute();
        await insertEvent(
          tx,
          previous.id,
          previous.user_id,
          "Revoked",
          readScopes(previous.granted_scopes),
          issuedAt,
        );
      }

      await tx
        .withSchema(SCHEMA)
        .insertInto("oauth_grants")
        .values({
          id: grantId,
          user_id: input.userId,
          client_id: input.clientId,
          redirect_uri: input.redirectUri,
          granted_scopes: scopeJson(input.scopes),
          authorization_code_hash: hashToken(code),
          authorization_code_challenge: input.codeChallenge,
          authorization_code_method: input.codeChallengeMethod,
          authorization_code_expires_at: new Date(issuedAt.getTime() + 5 * 60_000),
          authorization_code_used_at: null,
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          revoked_at: null,
          created_at: issuedAt,
          updated_at: issuedAt,
        })
        .execute();

      await insertEvent(
        tx,
        grantId,
        input.userId,
        existing.length === 0 ? "Connected" : "Reauthorised",
        input.scopes,
        issuedAt,
      );
      if (existing.length > 0) {
        await insertEvent(tx, grantId, input.userId, "ScopeChanged", input.scopes, issuedAt);
      }
    });

    return code;
  }

  public async exchangeAuthorizationCode(
    code: string,
    clientId: string,
    redirectUri: string,
    verifier: string,
  ): Promise<TokenResponse> {
    return this.database.transaction().execute(async (tx) => {
      const row = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .selectAll()
        .where("authorization_code_hash", "=", hashToken(code))
        .where("client_id", "=", clientId)
        .where("redirect_uri", "=", redirectUri)
        .where("authorization_code_used_at", "is", null)
        .where("revoked_at", "is", null)
        .forUpdate()
        .executeTakeFirst();

      if (
        row === undefined ||
        row.authorization_code_expires_at === null ||
        row.authorization_code_expires_at.getTime() <= this.now().getTime() ||
        row.authorization_code_challenge === null ||
        row.authorization_code_method !== "S256"
      ) {
        throw new OAuthTokenError("invalid_grant", "The authorization code is invalid or expired.");
      }

      const actualChallenge = createHash("sha256").update(verifier).digest("base64url");
      if (!sameSecret(actualChallenge, row.authorization_code_challenge)) {
        throw new OAuthTokenError("invalid_grant", "The PKCE verifier was not accepted.");
      }

      return this.issueTokens(tx, row, readScopes(row.granted_scopes), true);
    });
  }

  public async refresh(refreshToken: string, clientId: string): Promise<TokenResponse> {
    return this.database.transaction().execute(async (tx) => {
      const row = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .selectAll()
        .where("refresh_token_hash", "=", hashToken(refreshToken))
        .where("client_id", "=", clientId)
        .where("revoked_at", "is", null)
        .forUpdate()
        .executeTakeFirst();

      if (
        row === undefined ||
        row.refresh_token_expires_at === null ||
        row.refresh_token_expires_at.getTime() <= this.now().getTime()
      ) {
        throw new OAuthTokenError("invalid_grant", "The refresh token is invalid or expired.");
      }

      return this.issueTokens(tx, row, readScopes(row.granted_scopes), false);
    });
  }

  public async revoke(token: string): Promise<void> {
    const now = this.now();
    await this.database.transaction().execute(async (tx) => {
      const row = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .select(["id", "user_id", "granted_scopes"])
        .where((builder) =>
          builder.or([
            builder("access_token_hash", "=", hashToken(token)),
            builder("refresh_token_hash", "=", hashToken(token)),
          ]),
        )
        .where("revoked_at", "is", null)
        .forUpdate()
        .executeTakeFirst();

      if (row === undefined) {
        return;
      }

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_grants")
        .set({ revoked_at: now, updated_at: now })
        .where("id", "=", row.id)
        .execute();
      await insertEvent(tx, row.id, row.user_id, "Revoked", readScopes(row.granted_scopes), now);
    });
  }

  public async resolveAccessToken(token: string): Promise<McpPrincipal | null> {
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
      .where("oauth_grants.access_token_hash", "=", hashToken(token))
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

  public async revokeGrant(grantId: string, actorUserId: string, isAdmin: boolean): Promise<void> {
    const now = this.now();
    await this.database.transaction().execute(async (tx) => {
      const row = await tx
        .withSchema(SCHEMA)
        .selectFrom("oauth_grants")
        .select(["id", "user_id", "granted_scopes", "revoked_at"])
        .where("id", "=", grantId)
        .forUpdate()
        .executeTakeFirst();

      if (
        row === undefined ||
        row.revoked_at !== null ||
        (!isAdmin && row.user_id !== actorUserId)
      ) {
        return;
      }

      await tx
        .withSchema(SCHEMA)
        .updateTable("oauth_grants")
        .set({ revoked_at: now, updated_at: now })
        .where("id", "=", grantId)
        .execute();
      await insertEvent(tx, grantId, row.user_id, "Revoked", readScopes(row.granted_scopes), now);
    });
  }

  private async issueTokens(
    tx: Transaction<StockControlDatabase>,
    row: GrantTokenRow,
    scopes: readonly McpScope[],
    consumeCode: boolean,
  ): Promise<TokenResponse> {
    const issuedAt = this.now();
    const accessToken = opaqueToken(TOKEN_BYTES);
    const refreshToken = opaqueToken(TOKEN_BYTES);
    const accessExpiresAt = new Date(
      issuedAt.getTime() + this.configuration.accessTokenMinutes * 60_000,
    );
    const refreshExpiresAt = new Date(
      issuedAt.getTime() + this.configuration.refreshTokenDays * 86_400_000,
    );

    await tx
      .withSchema(SCHEMA)
      .updateTable("oauth_grants")
      .set({
        authorization_code_used_at: consumeCode ? issuedAt : row.authorization_code_used_at,
        access_token_hash: hashToken(accessToken),
        access_token_expires_at: accessExpiresAt,
        refresh_token_hash: hashToken(refreshToken),
        refresh_token_expires_at: refreshExpiresAt,
        updated_at: issuedAt,
      })
      .where("id", "=", row.id)
      .execute();
    await insertEvent(tx, row.id, row.user_id, "Refreshed", scopes, issuedAt);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configuration.accessTokenMinutes * 60,
      scopes,
    };
  }
}
