import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { ORIGIN_EXEMPT_ROUTE } from "../../src/auth/public.decorator";
import { attachSession } from "../../src/auth/request-context";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import {
  oauthConsentContentSecurityPolicy,
  OAuthController,
} from "../../src/integrations/mcp/oauth.controller";

const configuration = {
  publicBaseUrl: "https://stockcontrol.example",
  clientId: "stockcontrol-chatgpt",
  redirectUri: "https://chatgpt.example/callback",
  resourceUri: "https://stockcontrol.example/mcp",
} as McpConfiguration;

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "engineer",
  email: null,
  displayName: "Engineer",
  role: "Engineer",
  profilePhotoUrl: null,
  mustChangePassword: false,
} as const;

const replyFor = (): {
  readonly reply: FastifyReply;
  readonly code: ReturnType<typeof vi.fn>;
  readonly header: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
  readonly redirect: ReturnType<typeof vi.fn>;
} => {
  const code = vi.fn();
  const header = vi.fn();
  const type = vi.fn();
  const send = vi.fn();
  const redirect = vi.fn();
  const reply = { code, header, type, send, redirect } as unknown as FastifyReply;
  code.mockReturnValue(reply);
  header.mockReturnValue(reply);
  type.mockReturnValue(reply);
  send.mockReturnValue(reply);
  redirect.mockReturnValue(reply);
  return { reply, code, header, send, redirect };
};

const requestFor = (query: Record<string, unknown>): FastifyRequest => {
  const request = { query, url: "/oauth/authorize" } as FastifyRequest;
  attachSession(request, {
    user,
    issuedAt: "2026-08-21T00:00:00.000Z",
    expiresAt: "2026-08-22T00:00:00.000Z",
  });
  return request;
};

const validQuery = {
  client_id: configuration.clientId,
  redirect_uri: configuration.redirectUri,
  response_type: "code",
  scope: "stock:read activity:read",
  state: 'state-"<script>alert(1)</script>',
  code_challenge: "a".repeat(43),
  code_challenge_method: "S256",
  resource: configuration.resourceUri,
};

describe("OAuth controller input handling", () => {
  it("exempts the embedded consent approval from the application origin guard", () => {
    const reflector = new Reflector();
    const handler = Object.getOwnPropertyDescriptor(OAuthController.prototype, "authorize")?.value;

    expect(handler).toBeDefined();
    expect(reflector.get<boolean>(ORIGIN_EXEMPT_ROUTE, handler)).toBe(true);
  });

  it("renders only the opaque authorization-request handle", async () => {
    const oauth = { createAuthorizationRequest: vi.fn().mockResolvedValue("request-handle") };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, send } = replyFor();

    await controller.authorizeScreen(requestFor(validQuery), reply);

    expect(oauth.createAuthorizationRequest).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.stringContaining('name="request_id"'));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("View stock items and locations"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("Secure connection"));
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining("<script>"));
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining('state-"'));
    const policy = oauthConsentContentSecurityPolicy(configuration.publicBaseUrl);
    expect(policy).not.toContain("sandbox");
    expect(policy).toContain("form-action https://stockcontrol.example");
    expect(policy).toContain("frame-ancestors https://chatgpt.com");
  });

  it("sends an anonymous user to sign in and preserves the authorization request", async () => {
    const oauth = {
      createAuthorizationRequest: vi
        .fn()
        .mockResolvedValue("opaque-request-handle-123456789012345678901234567890"),
    };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, send } = replyFor();

    await controller.authorizeScreen(
      { query: validQuery, url: "/oauth/authorize" } as FastifyRequest,
      reply,
    );

    expect(send).toHaveBeenCalledWith(expect.stringContaining("Sign in to continue"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("opaque-request-handle"));
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining('state-"'));
    expect(oauth.createAuthorizationRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, resourceUri: configuration.resourceUri }),
    );
  });

  it("redirects an approved request to the registered callback with OAuth parameters", async () => {
    const oauth = {
      approveAuthorizationRequest: vi.fn().mockResolvedValue({
        redirectUri: configuration.redirectUri,
        state: "oauth-state",
        code: "authorization-code",
      }),
    };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, redirect } = replyFor();

    await controller.authorize(
      requestFor(validQuery),
      { request_id: "request-id", decision: "approve" },
      reply,
    );

    expect(oauth.approveAuthorizationRequest).toHaveBeenCalledWith("request-id", user.id);
    expect(code).toHaveBeenCalledWith(302);
    expect(redirect).toHaveBeenCalledWith(
      `${configuration.redirectUri}?code=authorization-code&state=oauth-state`,
    );
  });

  it("returns OAuth-shaped 400 errors for unsupported grants", async () => {
    const oauth = { refresh: vi.fn(), exchangeAuthorizationCode: vi.fn() };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, send } = replyFor();

    await controller.token(
      {
        grant_type: "client_credentials",
        client_id: configuration.clientId,
        resource: configuration.resourceUri,
      },
      reply,
    );

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "unsupported_grant_type",
      error_description: "That grant type is not supported.",
    });
    expect(oauth.refresh).not.toHaveBeenCalled();
    expect(oauth.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it("dispatches a valid refresh-token request and returns the OAuth response", async () => {
    const oauth = {
      refresh: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 900,
        scopes: ["stock:read"],
      }),
    };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, send } = replyFor();

    await controller.token(
      {
        grant_type: "refresh_token",
        client_id: configuration.clientId,
        refresh_token: "refresh-token",
        resource: configuration.resourceUri,
      },
      reply,
    );

    expect(oauth.refresh).toHaveBeenCalledWith(
      "refresh-token",
      configuration.clientId,
      configuration.resourceUri,
    );
    expect(code).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith({
      token_type: "Bearer",
      access_token: "access-token",
      refresh_token: "refresh-token",
      resource: configuration.resourceUri,
      expires_in: 900,
      scope: "stock:read",
    });
  });

  it("dispatches a valid authorization-code request with its PKCE values", async () => {
    const oauth = {
      exchangeAuthorizationCode: vi.fn().mockResolvedValue({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 900,
        scopes: ["stock:read"],
      }),
    };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply } = replyFor();

    await controller.token(
      {
        grant_type: "authorization_code",
        client_id: configuration.clientId,
        code: "authorization-code",
        redirect_uri: configuration.redirectUri,
        code_verifier: "a".repeat(43),
        resource: configuration.resourceUri,
      },
      reply,
    );

    expect(oauth.exchangeAuthorizationCode).toHaveBeenCalledWith(
      "authorization-code",
      configuration.clientId,
      configuration.redirectUri,
      "a".repeat(43),
      configuration.resourceUri,
    );
  });

  it("rejects unknown clients before token exchange", async () => {
    const oauth = { refresh: vi.fn(), exchangeAuthorizationCode: vi.fn() };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, send } = replyFor();

    await controller.token({ grant_type: "refresh_token", client_id: "other-client" }, reply);

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "invalid_client",
      error_description: "The OAuth client is not registered.",
    });
    expect(oauth.refresh).not.toHaveBeenCalled();
  });

  it("rejects unknown scopes during authorization", async () => {
    const oauth = { createAuthorizationRequest: vi.fn() };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, send } = replyFor();

    await controller.authorizeScreen(
      requestFor({ ...validQuery, scope: "stock:read admin:all" }),
      reply,
    );

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "invalid_scope",
      error_description: "The requested scope is not supported.",
    });
    expect(oauth.createAuthorizationRequest).not.toHaveBeenCalled();
  });

  it("rejects an unregistered authorization client and response type", async () => {
    const oauth = { createAuthorizationRequest: vi.fn() };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply: clientReply, code: clientCode, send: clientSend } = replyFor();

    await controller.authorizeScreen(
      requestFor({ ...validQuery, client_id: "other-client" }),
      clientReply,
    );

    expect(clientCode).toHaveBeenCalledWith(400);
    expect(clientSend).toHaveBeenCalledWith({
      error: "invalid_request",
      error_description: "The OAuth request is not registered.",
    });

    const { reply, code, send } = replyFor();
    await controller.authorizeScreen(requestFor({ ...validQuery, response_type: "token" }), reply);

    expect(code).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: "invalid_request",
      error_description: "The OAuth response type is not supported.",
    });
  });
});
