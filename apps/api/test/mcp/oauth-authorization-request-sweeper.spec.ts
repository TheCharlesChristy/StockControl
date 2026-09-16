import { describe, expect, it, vi } from "vitest";

import { OAuthAuthorizationRequestSweeper } from "../../src/integrations/mcp/oauth-authorization-request-sweeper";

describe("OAuth authorization-request sweeper", () => {
  it("logs the number of expired requests removed", async () => {
    const oauth = { deleteExpiredAuthorizationRequests: vi.fn().mockResolvedValue(3) };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const sweeper = new OAuthAuthorizationRequestSweeper(oauth as never, logger as never);

    await sweeper.sweep();

    expect(oauth.deleteExpiredAuthorizationRequests).toHaveBeenCalledOnce();
    expect(logger.log).toHaveBeenCalledWith({
      event: "mcp.oauth_authorization_requests.pruned",
      deleted: 3,
    });
  });

  it("does not turn a temporary database failure into an application failure", async () => {
    const oauth = {
      deleteExpiredAuthorizationRequests: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const sweeper = new OAuthAuthorizationRequestSweeper(oauth as never, logger as never);

    await expect(sweeper.sweep()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith({
      event: "mcp.oauth_authorization_requests.prune_failed",
      error: "Error",
    });
  });
});
