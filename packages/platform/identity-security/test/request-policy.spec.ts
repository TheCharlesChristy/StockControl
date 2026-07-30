import { describe, expect, it } from "vitest";

import { BrowserRequestPolicy } from "../src/request-policy.js";

describe("origin and Fetch Metadata request policy", () => {
  it("allows safe methods without requiring Origin or CSRF", () => {
    const policy = new BrowserRequestPolicy({ allowedOrigins: ["https://stock.example"] });
    expect(policy.evaluate({ method: "GET" })).toEqual({
      allowed: true,
      requiresCsrf: false,
    });
    expect(policy.evaluate({ method: " head " })).toEqual({
      allowed: true,
      requiresCsrf: false,
    });
    expect(policy.evaluate({ method: "OPTIONS", origin: "https://evil.example" })).toEqual({
      allowed: true,
      requiresCsrf: false,
    });
  });

  it("requires an exact allowlisted Origin for every state-changing method", () => {
    const policy = new BrowserRequestPolicy({
      allowedOrigins: ["https://stock.example", "http://localhost:5173"],
    });
    expect(policy.evaluate({ method: "POST" })).toEqual({
      allowed: false,
      reason: "missing-origin",
    });
    expect(policy.evaluate({ method: "DELETE", origin: "" })).toEqual({
      allowed: false,
      reason: "missing-origin",
    });
    expect(policy.evaluate({ method: "PUT", origin: "https://evil.example" })).toEqual({
      allowed: false,
      reason: "untrusted-origin",
    });
    expect(
      policy.evaluate({
        method: "patch",
        origin: "https://stock.example",
      }),
    ).toEqual({ allowed: true, requiresCsrf: true });
    expect(
      policy.evaluate({
        method: "CUSTOM",
        origin: "http://localhost:5173",
      }),
    ).toEqual({ allowed: true, requiresCsrf: true });
  });

  it("rejects cross-origin Fetch Metadata and unsafe modes when present", () => {
    const policy = new BrowserRequestPolicy({ allowedOrigins: ["https://stock.example"] });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchSite: "same-site",
        secFetchMode: "cors",
      }),
    ).toEqual({ allowed: false, reason: "cross-origin-fetch" });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchSite: "same-origin",
        secFetchMode: "navigate",
      }),
    ).toEqual({ allowed: false, reason: "disallowed-fetch-mode" });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchSite: "SAME-ORIGIN",
        secFetchMode: "CORS",
      }),
    ).toEqual({ allowed: true, requiresCsrf: true });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchMode: "same-origin",
      }),
    ).toEqual({ allowed: true, requiresCsrf: true });
  });

  it("can require both Fetch Metadata headers for supported browser-only deployments", () => {
    const policy = new BrowserRequestPolicy({
      allowedOrigins: ["https://stock.example"],
      requireFetchMetadata: true,
    });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
      }),
    ).toEqual({ allowed: false, reason: "missing-fetch-metadata" });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchSite: "same-origin",
      }),
    ).toEqual({ allowed: false, reason: "missing-fetch-metadata" });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchMode: "cors",
      }),
    ).toEqual({ allowed: false, reason: "missing-fetch-metadata" });
    expect(
      policy.evaluate({
        method: "POST",
        origin: "https://stock.example",
        secFetchSite: "same-origin",
        secFetchMode: "same-origin",
      }),
    ).toEqual({ allowed: true, requiresCsrf: true });
  });

  it("validates the configured origin set once at startup", () => {
    expect(() => new BrowserRequestPolicy({ allowedOrigins: [] })).toThrow("At least one");
    expect(() => new BrowserRequestPolicy({ allowedOrigins: ["not a URL"] })).toThrow(
      "Invalid allowed origin",
    );
    expect(() => new BrowserRequestPolicy({ allowedOrigins: ["ftp://stock.example"] })).toThrow(
      "exact HTTP",
    );
    expect(() => new BrowserRequestPolicy({ allowedOrigins: ["https://stock.example/"] })).toThrow(
      "exact HTTP",
    );
    expect(
      () => new BrowserRequestPolicy({ allowedOrigins: ["https://user@stock.example"] }),
    ).toThrow("exact HTTP");
    expect(
      () =>
        new BrowserRequestPolicy({
          allowedOrigins: ["https://stock.example", "https://stock.example"],
        }),
    ).toThrow("unique");
  });
});
