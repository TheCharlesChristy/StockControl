import { describe, expect, it } from "vitest";

import { isRequestOriginAllowed, loadPublicAppOrigin } from "../../src/auth/request-origin.guard";

describe("public application origin", () => {
  it("requires an explicit HTTPS origin in production", () => {
    expect(() => loadPublicAppOrigin({ NODE_ENV: "production" })).toThrow(
      "set it to the public HTTPS origin",
    );
    expect(() =>
      loadPublicAppOrigin({
        NODE_ENV: "production",
        PUBLIC_APP_ORIGIN: "http://stock.example.com",
      }),
    ).toThrow("production must use https://");
  });

  it("normalises an origin and rejects URLs with extra components", () => {
    expect(
      loadPublicAppOrigin({
        NODE_ENV: "production",
        PUBLIC_APP_ORIGIN: " https://stock.example.com/ ",
      }),
    ).toBe("https://stock.example.com");
    expect(() =>
      loadPublicAppOrigin({ PUBLIC_APP_ORIGIN: "https://stock.example.com/app" }),
    ).toThrow("provide an origin only");
  });
});

describe("request origin policy", () => {
  const allowed = "https://stock.example.com";

  it("does not constrain safe reads", () => {
    expect(isRequestOriginAllowed("GET", {}, allowed)).toBe(true);
  });

  it("allows only the configured origin for unsafe requests", () => {
    expect(isRequestOriginAllowed("POST", { origin: allowed }, allowed)).toBe(true);
    expect(isRequestOriginAllowed("POST", { origin: "https://attacker.example" }, allowed)).toBe(
      false,
    );
    expect(isRequestOriginAllowed("POST", {}, allowed)).toBe(false);
  });

  it("rejects a browser-declared cross-site request even outside production", () => {
    expect(isRequestOriginAllowed("DELETE", { "sec-fetch-site": "cross-site" }, null)).toBe(false);
  });
});
