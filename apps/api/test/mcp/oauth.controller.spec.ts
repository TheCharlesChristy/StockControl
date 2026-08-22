import type { FastifyReply, FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { attachSession } from "../../src/auth/request-context";
import type { McpConfiguration } from "../../src/integrations/mcp/mcp-configuration";
import { OAuthController } from "../../src/integrations/mcp/oauth.controller";

const configuration = {
  publicBaseUrl: "https://stockcontrol.example",
  clientId: "stockcontrol-chatgpt",
  redirectUri: "https://chatgpt.example/callback",
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
  readonly send: ReturnType<typeof vi.fn>;
} => {
  const code = vi.fn();
  const type = vi.fn();
  const send = vi.fn();
  const redirect = vi.fn();
  const reply = { code, type, send, redirect } as unknown as FastifyReply;
  code.mockReturnValue(reply);
  type.mockReturnValue(reply);
  send.mockReturnValue(reply);
  redirect.mockReturnValue(reply);
  return { reply, code, send };
};

const requestFor = (query: Record<string, unknown>): FastifyRequest => {
  const request = { query } as FastifyRequest;
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
};

describe("OAuth controller input handling", () => {
  it("renders only the opaque authorization-request handle", async () => {
    const oauth = { createAuthorizationRequest: vi.fn().mockResolvedValue("request-handle") };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, send } = replyFor();

    await controller.authorizeScreen(requestFor(validQuery), reply);

    expect(oauth.createAuthorizationRequest).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.stringContaining('name="request_id"'));
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining("Requested permissions: stock:read, activity:read"),
    );
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining("<script>"));
    expect(send).toHaveBeenCalledWith(expect.not.stringContaining('state-"'));
  });

  it("returns OAuth-shaped 400 errors for unsupported grants", async () => {
    const oauth = { refresh: vi.fn(), exchangeAuthorizationCode: vi.fn() };
    const controller = new OAuthController(oauth as never, configuration);
    const { reply, code, send } = replyFor();

    await controller.token(
      { grant_type: "client_credentials", client_id: configuration.clientId },
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
      },
      reply,
    );

    expect(oauth.refresh).toHaveBeenCalledWith("refresh-token", configuration.clientId);
    expect(code).toHaveBeenCalledWith(200);
    expect(send).toHaveBeenCalledWith({
      token_type: "Bearer",
      access_token: "access-token",
      refresh_token: "refresh-token",
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
      },
      reply,
    );

    expect(oauth.exchangeAuthorizationCode).toHaveBeenCalledWith(
      "authorization-code",
      configuration.clientId,
      configuration.redirectUri,
      "a".repeat(43),
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
