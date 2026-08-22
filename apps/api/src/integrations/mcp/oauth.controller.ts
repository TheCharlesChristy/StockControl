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

/*
 * The consent document is intentionally allowed to be shown inside ChatGPT's
 * OAuth frame. It has no script or external resource dependencies: the only
 * executable action is a same-origin form POST. The normal API policy contains
 * `sandbox`, which blocks the host's OAuth-frame completion, so this is an
 * explicit and tightly-scoped exception rather than a relaxation for the API.
 */
export const oauthConsentContentSecurityPolicy = (publicBaseUrl: string): string =>
  `default-src 'none'; base-uri 'none'; form-action ${new URL(publicBaseUrl).origin}; style-src 'unsafe-inline'; frame-ancestors https://chatgpt.com`;

const oauthText = (body: Readonly<Record<string, unknown>>, field: string): string => {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 2048) {
    throw new OAuthTokenError("invalid_request", `The ${field} parameter is required.`);
  }
  return value;
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

const scopeLabel = (scope: McpScope): string => {
  switch (scope) {
    case "stock:read":
      return "View stock items and locations";
    case "activity:read":
      return "View jobs, transactions, stock requests and operational activity";
    case "stock:request":
      return "Create stock requests";
    case "stock:write":
      return "Update stock records";
    case "requests:review":
      return "Review stock requests";
  }
};

const signInLocation = (request: FastifyRequest, configuration: McpConfiguration): string => {
  const signInUrl = new URL("/sign-in", configuration.publicBaseUrl);
  const query = request.query as Record<string, unknown>;
  const requestId = query["request_id"];
  if (typeof requestId !== "string" || requestId.length < 40 || requestId.length > 512) {
    throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
  }
  const resumeUrl = new URL("/oauth/authorize", configuration.publicBaseUrl);
  resumeUrl.searchParams.set("request_id", requestId);
  // The SPA deliberately accepts only same-origin relative deep links. Keep
  // the resume target relative so the signed-in handoff can navigate back to
  // the API endpoint instead of falling back to the dashboard.
  signInUrl.searchParams.set("next", `${resumeUrl.pathname}${resumeUrl.search}`);
  return signInUrl.toString();
};

const loginHandoffDocument = (signInUrl: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Sign in to connect StockControl</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { min-width: 320px; min-height: 100vh; margin: 0; color: #172033; background: #f5f7fb; }
      main { display: grid; min-height: 100vh; place-items: center; padding: 24px; }
      .card { width: min(100%, 480px); padding: 40px; border: 1px solid #dce2ea; border-radius: 24px; background: #fff; box-shadow: 0 24px 60px rgba(7, 27, 58, .12); }
      .brand { color: #00309d; font-weight: 800; letter-spacing: .01em; }
      h1 { margin: 32px 0 12px; font-family: Georgia, "Times New Roman", serif; font-size: 2.35rem; font-weight: 400; line-height: 1.08; }
      p { color: #3f4858; line-height: 1.6; }
      a { display: inline-grid; width: 100%; min-height: 50px; margin-top: 20px; place-items: center; border-radius: 10px; color: #fff; background: #00309d; font-weight: 800; text-decoration: none; }
      a:focus-visible { outline: 3px solid rgba(0, 48, 157, .35); outline-offset: 3px; }
      .note { margin-top: 18px; color: #667085; font-size: .84rem; }
    </style>
  </head>
  <body>
    <main>
      <section class="card" aria-labelledby="sign-in-title">
        <div class="brand">StockControl</div>
        <h1 id="sign-in-title">Sign in to continue</h1>
        <p>Sign in to StockControl to approve the secure ChatGPT connection. Your requested permissions will be shown after sign-in.</p>
        <a href="${signInUrl}" target="_top">Continue to StockControl sign in</a>
        <p class="note">The connection request is kept pending for a short time and can only be used once.</p>
      </section>
    </main>
  </body>
</html>`;

const consentDocument = (
  requestId: string,
  scopes: readonly McpScope[],
  action: string,
): string => {
  const encodedRequestId = encodeURIComponent(requestId);
  const permissions = scopes.map((scope) => `<li>${scopeLabel(scope)}</li>`).join("");

  /*
   * `requestId` is generated by the server and URI-encoded before interpolation.
   * Scope labels are fixed literals from the exhaustive switch above. OAuth
   * request parameters remain in the pending-request database record.
   */
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>Connect StockControl to ChatGPT</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { min-width: 320px; min-height: 100vh; margin: 0; color: #172033; background: radial-gradient(circle at top, #ffffff 0%, #f7f8fa 54%, #eaf0fc 100%); }
      main { display: grid; min-height: 100vh; place-items: center; padding: 24px; }
      .card { width: min(100%, 540px); padding: clamp(28px, 7vw, 48px); border: 1px solid #dce2ea; border-radius: 24px; background: #ffffff; box-shadow: 0 24px 60px rgba(7, 27, 58, 0.14), 0 3px 10px rgba(7, 27, 58, 0.05); }
      .brand { display: flex; align-items: center; gap: 10px; color: #00309d; font-weight: 800; letter-spacing: 0.01em; }
      .mark { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 9px; color: #ffffff; background: #00309d; font-size: 16px; }
      .eyebrow { margin: 32px 0 8px; color: #00309d; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.11em; text-transform: uppercase; }
      h1 { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: clamp(2rem, 7vw, 2.8rem); font-weight: 400; letter-spacing: -0.025em; line-height: 1.06; }
      p { color: #3f4858; font-size: 1rem; line-height: 1.6; }
      .permissions { margin: 28px 0; padding: 20px; border: 1px solid #dce2ea; border-radius: 14px; background: #f7f8fa; }
      h2 { margin: 0 0 12px; font-size: 0.95rem; }
      ul { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      li { display: flex; gap: 10px; align-items: flex-start; color: #263247; font-size: 0.95rem; line-height: 1.45; }
      li::before { content: "✓"; display: grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; border-radius: 50%; color: #ffffff; background: #18794e; font-size: 0.75rem; font-weight: 800; }
      button { width: 100%; min-height: 50px; border: 0; border-radius: 10px; color: #ffffff; background: #00309d; box-shadow: 0 3px 7px rgba(0, 48, 157, 0.23); cursor: pointer; font: inherit; font-weight: 800; }
      button:hover { background: #002477; }
      button:focus-visible { outline: 3px solid rgba(0, 48, 157, 0.35); outline-offset: 3px; }
      .note { margin: 18px 0 0; color: #667085; font-size: 0.82rem; text-align: center; }
    </style>
  </head>
  <body>
    <main>
      <section class="card" aria-labelledby="connection-title">
        <div class="brand"><span class="mark" aria-hidden="true">S</span><span>StockControl</span></div>
        <p class="eyebrow">Secure connection</p>
        <h1 id="connection-title">Connect to ChatGPT</h1>
        <p>Allow ChatGPT to use StockControl tools with the permissions below. Your current StockControl role still controls what it can access.</p>
        <section class="permissions" aria-labelledby="permissions-title">
          <h2 id="permissions-title">ChatGPT will be able to:</h2>
          <ul>${permissions}</ul>
        </section>
        <form method="post" action="${action}">
          <input type="hidden" name="request_id" value="${encodedRequestId}">
          <div style="display:grid;gap:10px">
            <button type="submit" name="decision" value="approve">Approve connection</button>
            <button type="submit" name="decision" value="deny" style="color:#00309d;background:#eef2ff;box-shadow:none">Cancel</button>
          </div>
        </form>
        <p class="note">You can disconnect this connection at any time.</p>
      </section>
    </main>
  </body>
</html>`;
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
  resourceUri: string,
): ((oauth: OAuthService) => Promise<TokenResponse>) => {
  if (oauthText(body, "resource") !== resourceUri) {
    throw new OAuthTokenError("invalid_request", "The OAuth resource is not registered.");
  }
  switch (oauthText(body, "grant_type")) {
    case "authorization_code":
      return (oauth) =>
        oauth.exchangeAuthorizationCode(
          oauthText(body, "code"),
          clientId,
          oauthText(body, "redirect_uri"),
          oauthText(body, "code_verifier"),
          resourceUri,
        );
    case "refresh_token":
      return (oauth) => oauth.refresh(oauthText(body, "refresh_token"), clientId, resourceUri);
    default:
      throw new OAuthTokenError("unsupported_grant_type", "That grant type is not supported.");
  }
};

const oauthError = (reply: FastifyReply, error: unknown): FastifyReply => {
  if (error instanceof OAuthTokenError) {
    return reply
      .code(400)
      .header("cache-control", "no-store")
      .header("pragma", "no-cache")
      .send({ error: error.code, error_description: error.message });
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
      resource: this.configuration.resourceUri,
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
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
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
    reply.header(
      "content-security-policy",
      oauthConsentContentSecurityPolicy(this.configuration.publicBaseUrl),
    );

    try {
      const query = request.query as Record<string, unknown>;
      const requestIdValue = query["request_id"];
      if (requestIdValue !== undefined) {
        if (Object.keys(query).some((key) => key !== "request_id")) {
          throw new OAuthTokenError("invalid_request", "The authorization request is invalid.");
        }
        if (user === undefined) {
          return reply.code(302).redirect(signInLocation(request, this.configuration));
        }
        const scopes = await this.oauth.bindAuthorizationRequest(
          oauthText(query, "request_id"),
          user.id,
        );
        return reply
          .type("text/html")
          .send(
            consentDocument(
              oauthText(query, "request_id"),
              scopes,
              new URL("/oauth/authorize", this.configuration.publicBaseUrl).toString(),
            ),
          );
      }
      const clientId = oauthText(query, "client_id");
      const redirectUri = oauthText(query, "redirect_uri");
      const responseType = oauthText(query, "response_type");
      const scope = oauthText(query, "scope");
      const resource = oauthText(query, "resource");
      const codeChallenge = oauthText(query, "code_challenge");
      const codeChallengeMethod = oauthText(query, "code_challenge_method");
      const state = oauthState(query);

      const registeredClient = registeredOAuthClient(
        this.configuration,
        clientId,
        redirectUri,
        responseType,
      );
      if (resource !== this.configuration.resourceUri) {
        throw new OAuthTokenError("invalid_request", "The OAuth resource is not registered.");
      }
      const scopes = scopeList(scope);

      const requestId = await this.oauth.createAuthorizationRequest({
        userId: user?.id ?? null,
        clientId: registeredClient.clientId,
        redirectUri: registeredClient.redirectUri,
        state,
        scopes,
        codeChallenge,
        codeChallengeMethod,
        resourceUri: this.configuration.resourceUri,
      });
      if (user === undefined) {
        const handoffRequest = {
          ...request,
          query: { request_id: requestId },
        } as FastifyRequest;
        return reply
          .type("text/html")
          .send(loginHandoffDocument(signInLocation(handoffRequest, this.configuration)));
      }
      // Only a random, server-generated handle is reflected. OAuth request
      // parameters are held in the database and never interpolated into HTML.
      return reply
        .type("text/html")
        .send(
          consentDocument(
            requestId,
            scopes,
            new URL("/oauth/authorize", this.configuration.publicBaseUrl).toString(),
          ),
        );
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }

  @Post("oauth/authorize")
  @Public()
  /*
   * ChatGPT submits this same-origin form from an embedded OAuth document.
   * Browser framing can omit the app Origin header or classify the submission
   * as cross-site. The single-use opaque request handle is the CSRF binding;
   * the request is bound to the signed-in user before the consent document is
   * rendered, so this final form post does not depend on third-party cookies.
   */
  @OriginExempt()
  public async authorize(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const user = sessionOf(request)?.user;

    try {
      const body = bodyOf(rawBody);
      const requestId = oauthText(body, "request_id");
      const decisionValue = body["decision"];
      if (decisionValue !== "approve" && decisionValue !== "deny") {
        throw new OAuthTokenError("invalid_request", "The authorization decision is invalid.");
      }
      const decision = decisionValue;
      const approval =
        decision === "deny"
          ? await this.oauth.denyAuthorizationRequest(requestId, user?.id)
          : await this.oauth.approveAuthorizationRequest(requestId, user?.id);
      const location = new URL(approval.redirectUri);
      if (decision === "deny") {
        location.searchParams.set("error", "access_denied");
        location.searchParams.set(
          "error_description",
          "The StockControl connection was cancelled.",
        );
      } else {
        location.searchParams.set("code", approval.code);
      }
      if (approval.state !== null) location.searchParams.set("state", approval.state);
      return reply.code(302).redirect(location.toString());
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
      const outcome = await oauthTokenExchange(
        body,
        clientId,
        this.configuration.resourceUri,
      )(this.oauth);

      return reply
        .code(200)
        .header("cache-control", "no-store")
        .header("pragma", "no-cache")
        .send({
          token_type: "Bearer",
          access_token: outcome.accessToken,
          refresh_token: outcome.refreshToken,
          resource: this.configuration.resourceUri,
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
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .header("pragma", "no-cache")
        .send({});
    } catch (error: unknown) {
      return oauthError(reply, error);
    }
  }
}
