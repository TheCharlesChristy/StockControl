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
});
