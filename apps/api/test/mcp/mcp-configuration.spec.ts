import { describe, expect, it } from "vitest";

import { loadMcpConfiguration } from "../../src/integrations/mcp/mcp-configuration";

describe("MCP feature configuration", () => {
  it("keeps the integration and both tool classes disabled by default", () => {
    const configuration = loadMcpConfiguration({ NODE_ENV: "test" });

    expect(configuration.enabled).toBe(false);
    expect(configuration.readToolsEnabled).toBe(false);
    expect(configuration.writeToolsEnabled).toBe(false);
  });

  it("requires HTTPS public metadata URLs in production", () => {
    expect(() =>
      loadMcpConfiguration({
        NODE_ENV: "production",
        MCP_ENABLED: "true",
        MCP_PUBLIC_BASE_URL: "http://stockcontrol.example",
      }),
    ).toThrow(/https/u);
  });

  it("requires an explicit OAuth redirect URI when MCP is enabled", () => {
    expect(() =>
      loadMcpConfiguration({
        NODE_ENV: "test",
        MCP_ENABLED: "true",
        MCP_PUBLIC_BASE_URL: "https://stockcontrol.example",
      }),
    ).toThrow(/MCP_REDIRECT_URI/u);
  });

  it("requires a separate token hash key when MCP is enabled", () => {
    expect(() =>
      loadMcpConfiguration({
        NODE_ENV: "test",
        MCP_ENABLED: "true",
        MCP_PUBLIC_BASE_URL: "https://stockcontrol.example",
        MCP_REDIRECT_URI: "https://stockcontrol.example/oauth/callback",
      }),
    ).toThrow(/MCP_TOKEN_HASH_KEY/u);
  });

  it("uses the explicit abandoned-call grace over the legacy timeout", () => {
    const configuration = loadMcpConfiguration({
      NODE_ENV: "test",
      MCP_ABANDONED_CALL_SECONDS: "300",
      MCP_MAX_TOOL_SECONDS: "not-used",
    });

    expect(configuration.abandonedCallSeconds).toBe(300);
  });
});
