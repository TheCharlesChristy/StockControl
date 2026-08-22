import { Body, Controller, Get, Header, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { bodyOf } from "../../inventory/request-parsing";
import { API_TOKENS } from "../../api.tokens";
import { OriginExempt, Public } from "../../auth/public.decorator";
import { sessionOf } from "../../auth/request-context";
import type { McpConfiguration } from "./mcp-configuration";
import {
  MCP_SCOPES,
  OAuthService,
  OAuthTokenError,
  type McpScope,
  type TokenResponse,
} from "./oauth.service";

const oauthText = (body: Readonly<Record<string, unknown>>, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048) {
    throw new OAuthTokenError("invalid_request", `The ${field} parameter is required.`);
  }
  return value.trim();
};

const oauthState = (query: Readonly<Record<string, unknown>>): string | null => {
  const value = query["state"];
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    throw new OAuthTokenError("invalid_request", "The state parameter is invalid.");
  }
  return value;
};

const scopeList = (value: string): readonly McpScope[] => {
  const requested = value.split(/\s+/u).filter((scope) => scope.length > 0);
  if (
    requested.length === 0 ||
    requested.some((scope) => !(MCP_SCOPES as readonly string[]).includes(scope))
  ) {
    throw new OAuthTokenError("invalid_scope", "The requested scope is not supported.");
  }
  return requested as McpScope[];
};

interface RegisteredOAuthClient {
  readonly clientId: string;
  readonly redirectUri: string;
}

const registeredOAuthClient = (
  configuration: McpConfiguration,
  clientId: string,
  redirectUri: string,
  responseType: string,
): RegisteredOAuthClient => {
  if (clientId !== configuration.clientId || redirectUri !== configuration.redirectUri) {
    throw new OAuthTokenError("invalid_request", "The OAuth request is not registered.");
  }
  if (responseType !== "code") {
    throw new OAuthTokenError("invalid_request", "The OAuth response type is not supported.");
  }
  return {
    clientId: configuration.clientId,
    redirectUri: configuration.redirectUri,
  };
};

const oauthTokenExchange = (
  body: Readonly<Record<string, unknown>>,
  clientId: string,
): ((oauth: OAuthService) => Promise<TokenResponse>) => {
  switch (oauthText(body, "grant_type")) {
    case "authorization_code":
      return (oauth) =>
        oauth.exchangeAuthorizationCode(
          oauthText(body, "code"),
          clientId,
          oauthText(body, "redirect_uri"),
          oauthText(body, "code_verifier"),
        );
    case "refresh_token":
      return (oauth) => oauth.refresh(oauthText(body, "refresh_token"), clientId);
    default:
      throw new OAuthTokenError("unsupported_grant_type", "That grant type is not supported.");
  }
};

const oauthError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof OAuthTokenError) {
    return reply.code(400).send({ error: error.code, error_description: error.message });
  }
  throw error;
};

@Controller()
export class OAuthController {
  public constructor(
    @Inject(API_TOKENS.mcpOAuthService) private readonly oauth: OAuthService,
    @Inject(API_TOKENS.mcpConfiguration) private readonly configuration: McpConfiguration,
  ) {}

  @Get(".well-known/oauth-protected-resource")
  @Public()
  @Header("cache-control", "public, max-age=300")
  public protectedResource(): Record<string, unknown> {
    return {
      resource: `${this.configuration.publicBaseUrl}/mcp`,
      authorization_servers: [this.configuration.publicBaseUrl],
      scopes_supported: MCP_SCOPES,
      bearer_methods_supported: ["header"],
    };
  }

  @Get(".well-known/oauth-authorization-server")
  @Public()
  @Header("cache-control", "public, max-age=300")
  public authorizationServer(): Record<string, unknown> {
    return {
      issuer: this.configuration.publicBaseUrl,
      authorization_endpoint: `${this.configuration.publicBaseUrl}/oauth/authorize`,
      token_endpoint: `${this.configuration.publicBaseUrl}/oauth/token`,
      revocation_endpoint: `${this.configuration.publicBaseUrl}/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: MCP_SCOPES,
    };
  }

  @Get("oauth/authorize")
  @Public()
  @Header("cache-control", "no-store")
  public async authorizeScreen(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const user = sessionOf(request)?.user;
    if (user === undefined) {
      return reply
        .code(401)
        .type("text/plain")
        .send("Sign in to StockControl before connecting ChatGPT.");
    }

    try {
      const query = request.query as Record<string, unknown>;
      const clientId = oauthText(query, "client_id");
      const redirectUri = oauthText(query, "redirect_uri");
      const responseType = oauthText(query, "response_type");
      const scope = oauthText(query, "scope");
      const codeChallenge = oauthText(query, "code_challenge");
      const codeChallengeMethod = oauthText(query, "code_challenge_method");
      const state = oauthState(query);

      const registeredClient = registeredOAuthClient(
        this.configuration,
        clientId,
        redirectUri,
        responseType,
      );
      const scopes = scopeList(scope);

      const requestId = await this.oauth.createAuthorizationRequest({
        userId: user.id,
        clientId: registeredClient.clientId,
        redirectUri: registeredClient.redirectUri,
        state,
        scopes,
        codeChallenge,
        codeChallengeMethod,
      });
      const encodedRequestId = encodeURIComponent(requestId);

      // Only a random, server-generated handle is reflected. OAuth request
      // parameters are held in the database and never interpolated into HTML.
      return reply
        .type("text/html")
        .send(
          `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Connect StockControl</title><main><h1>Connect StockControl to ChatGPT</h1><p>Approve this connection to let ChatGPT use StockControl tools according to your current role.</p><p>Requested permissions: ${scopes.join(", ")}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${encodedRequestId}"><button type="submit">Approve connection</button></form></main>`,
        );
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }

  @Post("oauth/authorize")
  @Public()
  public async authorize(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const user = sessionOf(request)?.user;
    if (user === undefined) {
      return reply
        .code(401)
        .type("text/plain")
        .send("Sign in to StockControl before connecting ChatGPT.");
    }

    try {
      const approval = await this.oauth.approveAuthorizationRequest(
        oauthText(bodyOf(rawBody), "request_id"),
        user.id,
      );
      const location = new URL(approval.redirectUri);
      location.searchParams.set("code", approval.code);
      if (approval.state !== null) location.searchParams.set("state", approval.state);
      return reply.redirect(location.toString());
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }

  @Post("oauth/token")
  @Public()
  @OriginExempt()
  public async token(@Body() rawBody: unknown, @Res() reply: FastifyReply): Promise<FastifyReply> {
    try {
      const body = bodyOf(rawBody);
      const clientIdValue = oauthText(body, "client_id");
      if (clientIdValue !== this.configuration.clientId) {
        throw new OAuthTokenError("invalid_client", "The OAuth client is not registered.");
      }
      const clientId = this.configuration.clientId;
      const outcome = await oauthTokenExchange(body, clientId)(this.oauth);

      return reply.code(200).send({
        token_type: "Bearer",
        access_token: outcome.accessToken,
        refresh_token: outcome.refreshToken,
        expires_in: outcome.expiresIn,
        scope: outcome.scopes.join(" "),
      });
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }

  @Post("oauth/revoke")
  @Public()
  @OriginExempt()
  public async revoke(@Body() rawBody: unknown, @Res() reply: FastifyReply): Promise<FastifyReply> {
    try {
      await this.oauth.revoke(oauthText(bodyOf(rawBody), "token"));
      return reply.code(200).send({});
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }
}
