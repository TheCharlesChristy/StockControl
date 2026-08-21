import { Body, Controller, Get, Header, Inject, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { bodyOf, optionalText, requireText } from "../../inventory/request-parsing";
import { API_TOKENS } from "../../api.tokens";
import { OriginExempt, Public } from "../../auth/public.decorator";
import { sessionOf } from "../../auth/request-context";
import type { McpConfiguration } from "./mcp-configuration";
import { MCP_SCOPES, OAuthService, OAuthTokenError, type McpScope } from "./oauth.service";

const htmlEscape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

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
  public authorizeScreen(@Req() request: FastifyRequest, @Res() reply: FastifyReply): FastifyReply {
    const user = sessionOf(request)?.user;
    if (user === undefined) {
      return reply
        .code(401)
        .type("text/plain")
        .send("Sign in to StockControl before connecting ChatGPT.");
    }

    const query = request.query as Record<string, unknown>;
    const clientId = typeof query["client_id"] === "string" ? query["client_id"] : "";
    const redirectUri = typeof query["redirect_uri"] === "string" ? query["redirect_uri"] : "";
    const state = typeof query["state"] === "string" ? query["state"] : "";
    const challenge = typeof query["code_challenge"] === "string" ? query["code_challenge"] : "";
    const method =
      typeof query["code_challenge_method"] === "string" ? query["code_challenge_method"] : "";
    const scopes =
      typeof query["scope"] === "string" ? query["scope"] : MCP_SCOPES.slice(0, 2).join(" ");

    return reply
      .type("text/html")
      .send(
        `<!doctype html><meta charset="utf-8"><title>Connect StockControl</title><main><h1>Connect StockControl to ChatGPT</h1><p>Signed in as ${htmlEscape(user.displayName)}. ChatGPT will be able to use the selected StockControl tools as your current role.</p><p>Scopes: ${htmlEscape(scopes)}</p><form method="post" action="/oauth/authorize"><input type="hidden" name="client_id" value="${htmlEscape(clientId)}"><input type="hidden" name="redirect_uri" value="${htmlEscape(redirectUri)}"><input type="hidden" name="state" value="${htmlEscape(state)}"><input type="hidden" name="code_challenge" value="${htmlEscape(challenge)}"><input type="hidden" name="code_challenge_method" value="${htmlEscape(method)}"><input type="hidden" name="scope" value="${htmlEscape(scopes)}"><button type="submit">Approve connection</button></form></main>`,
      );
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

    const body = bodyOf(rawBody);
    const clientId = requireText(body, "client_id", "a client");
    const redirectUri = requireText(body, "redirect_uri", "a redirect URI");
    if (
      clientId !== this.configuration.clientId ||
      redirectUri !== this.configuration.redirectUri
    ) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const scopes = requireText(body, "scope", "a scope")
      .split(/\s+/u)
      .filter((scope): scope is McpScope => (MCP_SCOPES as readonly string[]).includes(scope));
    const code = await this.oauth.createAuthorizationCode({
      userId: user.id,
      clientId,
      redirectUri,
      scopes,
      codeChallenge: requireText(body, "code_challenge", "a PKCE challenge"),
      codeChallengeMethod: requireText(body, "code_challenge_method", "a PKCE method"),
    });
    const location = new URL(redirectUri);
    location.searchParams.set("code", code);
    const state = optionalText(body, "state");
    if (state !== null) {
      location.searchParams.set("state", state);
    }
    return reply.redirect(location.toString());
  }

  @Post("oauth/token")
  @Public()
  @OriginExempt()
  public async token(@Body() rawBody: unknown, @Res() reply: FastifyReply): Promise<FastifyReply> {
    const body = bodyOf(rawBody);
    const grantType = requireText(body, "grant_type", "a grant type");
    const clientId = requireText(body, "client_id", "a client");
    try {
      const outcome =
        grantType === "authorization_code"
          ? await this.oauth.exchangeAuthorizationCode(
              requireText(body, "code", "an authorization code"),
              clientId,
              requireText(body, "redirect_uri", "a redirect URI"),
              requireText(body, "code_verifier", "a PKCE verifier"),
            )
          : grantType === "refresh_token"
            ? await this.oauth.refresh(
                requireText(body, "refresh_token", "a refresh token"),
                clientId,
              )
            : (() => {
                throw new OAuthTokenError(
                  "unsupported_grant_type",
                  "That grant type is not supported.",
                );
              })();
      return reply.code(200).send({
        token_type: "Bearer",
        access_token: outcome.accessToken,
        refresh_token: outcome.refreshToken,
        expires_in: outcome.expiresIn,
        scope: outcome.scopes.join(" "),
      });
    } catch (error: unknown) {
      if (error instanceof OAuthTokenError) {
        return reply.code(400).send({ error: error.code, error_description: error.message });
      }
      throw error;
    }
  }

  @Post("oauth/revoke")
  @Public()
  @OriginExempt()
  public async revoke(@Body() rawBody: unknown, @Res() reply: FastifyReply): Promise<FastifyReply> {
    const body = bodyOf(rawBody);
    await this.oauth.revoke(requireText(body, "token", "a token"));
    return reply.code(200).send({});
  }
}
