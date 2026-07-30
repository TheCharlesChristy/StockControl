import { describe, expect, it } from "vitest";

import {
  createIdentityInstallation,
  DEFAULT_AUTHENTICATION_RATE_LIMITS,
  DEFAULT_IDENTITY_SECURITY_POLICY,
  DefaultIdentityPolicyProvider,
  authenticationRateLimitScopes,
} from "../src/index";

const validInstallation = {
  installationId: "acme-yard",
  displayName: "  Acme Electrical  ",
  baseUrl: "https://stock.acme.test",
};

describe("installation policy", () => {
  it("normalises a valid installation", () => {
    const installation = createIdentityInstallation(validInstallation);

    expect(installation).toEqual({
      installationId: "acme-yard",
      displayName: "Acme Electrical",
      baseUrl: "https://stock.acme.test",
    });
    expect(Object.isFrozen(installation)).toBe(true);
  });

  it("reduces a base URL to its origin", () => {
    expect(
      createIdentityInstallation({ ...validInstallation, baseUrl: "https://stock.acme.test/" })
        .baseUrl,
    ).toBe("https://stock.acme.test");
  });

  it.each([
    ["empty", ""],
    ["uppercase", "Acme-Yard"],
    ["leading punctuation", "-acme"],
    ["too long", `a${"b".repeat(64)}`],
    ["unsafe characters", "acme/yard"],
  ])("rejects a %s installation ID", (_label, installationId) => {
    expect(() => createIdentityInstallation({ ...validInstallation, installationId })).toThrowError(
      expect.objectContaining({ code: "InstallationInvalid" }),
    );
  });

  it.each([
    ["blank", "   "],
    ["too long", "a".repeat(201)],
  ])("rejects a %s display name", (_label, displayName) => {
    expect(() => createIdentityInstallation({ ...validInstallation, displayName })).toThrowError(
      expect.objectContaining({ code: "InstallationInvalid" }),
    );
  });

  it.each([
    ["not a URL", "stock.acme.test"],
    ["plaintext HTTP", "http://stock.acme.test"],
    ["credential bearing", "https://user:secret@stock.acme.test"],
    ["path bearing", "https://stock.acme.test/app"],
    ["query bearing", "https://stock.acme.test/?token=abc"],
    ["fragment bearing", "https://stock.acme.test/#token"],
  ])("rejects a %s base URL", (_label, baseUrl) => {
    expect(() => createIdentityInstallation({ ...validInstallation, baseUrl })).toThrowError(
      expect.objectContaining({ code: "InstallationInvalid" }),
    );
  });

  it("accepts a display name at the maximum supported length", () => {
    const displayName = "a".repeat(200);

    expect(createIdentityInstallation({ ...validInstallation, displayName }).displayName).toBe(
      displayName,
    );
  });
});

describe("default identity policy provider", () => {
  it("publishes the validated installation and the approved policy defaults", () => {
    const provider = new DefaultIdentityPolicyProvider(validInstallation);

    expect(provider.installation().displayName).toBe("Acme Electrical");
    expect(provider.securityPolicyDefaults()).toEqual(DEFAULT_IDENTITY_SECURITY_POLICY);
  });

  it("publishes a validated rule for every rate-limit scope", () => {
    const provider = new DefaultIdentityPolicyProvider(validInstallation);

    for (const scope of authenticationRateLimitScopes) {
      expect(provider.rateLimitRule(scope)).toEqual(DEFAULT_AUTHENTICATION_RATE_LIMITS[scope]);
    }
  });

  it("accepts an administrator-shortened policy", () => {
    const provider = new DefaultIdentityPolicyProvider(validInstallation, {
      ...DEFAULT_IDENTITY_SECURITY_POLICY,
      standardSessionIdleSeconds: 30 * 60,
      adminSessionIdleSeconds: 10 * 60,
    });

    expect(provider.securityPolicyDefaults().adminSessionIdleSeconds).toBe(600);
  });

  it("rejects a policy that exceeds the approved maximum session lifetimes", () => {
    expect(
      () =>
        new DefaultIdentityPolicyProvider(validInstallation, {
          ...DEFAULT_IDENTITY_SECURITY_POLICY,
          standardSessionIdleSeconds: 3 * 60 * 60,
        }),
    ).toThrowError(expect.objectContaining({ code: "PolicyValueInvalid" }));
  });

  it("rejects an invalid installation at construction time", () => {
    expect(
      () => new DefaultIdentityPolicyProvider({ ...validInstallation, baseUrl: "http://insecure" }),
    ).toThrowError(expect.objectContaining({ code: "InstallationInvalid" }));
  });
});
