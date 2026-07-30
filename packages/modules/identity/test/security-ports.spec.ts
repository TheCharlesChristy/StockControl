import { describe, expect, it } from "vitest";

import {
  assertNoDeterministicTestAdapters,
  deterministicTestAdapter,
  identityTokenDomain,
  identityTokenPurposes,
  IdentityPortError,
  IDENTITY_TOKEN_DOMAINS,
  isDeterministicTestAdapter,
  type IdentityTokenPurpose,
} from "../src/index";
import { FakeIdentityClock, FakeIdentityTokenServices } from "./support/identity-fakes";
import { digestToText } from "./support/deterministic-digest";

describe("identity token purposes", () => {
  it("gives every supported purpose a distinct stable hash domain", () => {
    const domains = identityTokenPurposes.map((purpose) => identityTokenDomain(purpose));

    expect(domains).toEqual([
      "identity.bootstrap",
      "identity.auth-challenge",
      "identity.session",
      "identity.invitation",
      "identity.password-reset",
    ]);
    expect(new Set(domains).size).toBe(identityTokenPurposes.length);
  });

  it("rejects a purpose outside the supported catalogue", () => {
    expect(() => identityTokenDomain("Impersonation" as IdentityTokenPurpose)).toThrowError(
      expect.objectContaining({ code: "TokenPurposeUnsupported" }),
    );
  });

  it("hashes the same token differently for each purpose so a token cannot be replayed", () => {
    const tokens = new FakeIdentityTokenServices();
    const invitation = tokens.for("Invitation");
    const reset = tokens.for("PasswordReset");
    const issued = invitation.issue();

    expect(invitation.verify(issued.token, issued.hash)).toBe(true);
    expect(reset.verify(issued.token, issued.hash)).toBe(false);
    expect(digestToText(reset.hash(issued.token))).not.toBe(digestToText(issued.hash));
  });

  it("returns the same service instance for a repeated purpose", () => {
    const tokens = new FakeIdentityTokenServices();

    expect(tokens.for("Session")).toBe(tokens.for("Session"));
    expect(tokens.for("Session").purpose).toBe("Session");
  });

  it("freezes the published domain catalogue", () => {
    expect(Object.isFrozen(IDENTITY_TOKEN_DOMAINS)).toBe(true);
  });
});

describe("deterministic test adapter rejection", () => {
  it("detects a marked adapter and ignores unmarked values", () => {
    expect(isDeterministicTestAdapter(new FakeIdentityClock())).toBe(true);
    expect(isDeterministicTestAdapter({ [deterministicTestAdapter]: false })).toBe(false);
    expect(isDeterministicTestAdapter({ now: () => new Date() })).toBe(false);
    expect(isDeterministicTestAdapter(null)).toBe(false);
    expect(isDeterministicTestAdapter(undefined)).toBe(false);
    expect(isDeterministicTestAdapter("clock")).toBe(false);
  });

  it("detects a marked function adapter", () => {
    const marked = Object.assign(() => undefined, { [deterministicTestAdapter]: true as const });

    expect(isDeterministicTestAdapter(marked)).toBe(true);
  });

  it("accepts a bundle that contains only production adapters", () => {
    expect(() =>
      assertNoDeterministicTestAdapters({ clock: { now: () => new Date() }, uuids: {} }),
    ).not.toThrow();
  });

  it("names every marked adapter it rejects without exposing their values", () => {
    let thrown: unknown;

    try {
      assertNoDeterministicTestAdapters({
        uuids: new FakeIdentityTokenServices(),
        clock: new FakeIdentityClock(),
        passwords: { hash: () => Promise.resolve("") },
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IdentityPortError);
    expect((thrown as IdentityPortError).code).toBe("DeterministicTestAdapterRejected");
    expect((thrown as Error).message).toContain("clock, uuids");
    expect((thrown as Error).message).not.toContain("passwords");
  });
});
