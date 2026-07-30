import { describe, expect, it } from "vitest";

import {
  CSRF_COOKIE,
  CSRF_HEADER_NAME,
  PRE_AUTH_CSRF_BINDING,
  CsrfTokenService,
  type CsrfKeyringInput,
  type CsrfSigningKeyInput,
} from "../src/csrf.js";
import { encodeBase64Url } from "../src/encoding.js";
import { FixedRandomSource } from "./helpers.js";

const key = (id: string, fill: number, length = 32): CsrfSigningKeyInput => ({
  id,
  secret: new Uint8Array(length).fill(fill),
});

const keyring = (activeKeyId = "current"): CsrfKeyringInput => ({
  activeKeyId,
  keys: [key("current", 7), key("previous", 6)],
});

describe("signed double-submit CSRF", () => {
  it("publishes the exact secure cookie and header contract", () => {
    expect(CSRF_HEADER_NAME).toBe("x-csrf-token");
    expect(PRE_AUTH_CSRF_BINDING).toBe("identity.pre-auth:v1");
    expect(CSRF_COOKIE).toEqual({
      name: "__Host-stockcontrol_csrf",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    });
    expect(Object.isFrozen(CSRF_COOKIE)).toBe(true);
    expect(Object.isFrozen(CSRF_COOKIE.options)).toBe(true);
  });

  it("supports signed pre-authentication mutations and requires session rotation afterward", () => {
    const service = new CsrfTokenService(
      new FixedRandomSource(new Uint8Array(32).fill(10)),
      keyring(),
    );
    const preAuthentication = service.issuePreAuthentication();

    expect(service.verifyPreAuthentication(preAuthentication.token, preAuthentication.token)).toBe(
      true,
    );
    expect(
      service.verify(preAuthentication.token, preAuthentication.token, "new-authenticated-session"),
    ).toBe(false);

    const sessionBound = service.issue("new-authenticated-session");
    expect(service.verifyPreAuthentication(sessionBound.token, sessionBound.token)).toBe(false);
    expect(
      service.verify(sessionBound.token, sessionBound.token, "new-authenticated-session"),
    ).toBe(true);
  });

  it("issues a session-bound signed token and verifies cookie/header equality", () => {
    const service = new CsrfTokenService(
      new FixedRandomSource(new Uint8Array(32).fill(3)),
      keyring(),
    );
    const issued = service.issue("persisted-session-id");

    expect(issued.token).toMatch(
      /^\$sc-csrf\$v=1\$current\$[A-Za-z0-9_-]{43}\$[A-Za-z0-9_-]{43}$/u,
    );
    expect(service.verify(issued.token, issued.token, "persisted-session-id")).toBe(true);
    expect(service.verify(issued.token, issued.token, "another-session")).toBe(false);
    expect(service.verify(issued.token, `${issued.token}x`, "persisted-session-id")).toBe(false);
  });

  it("defensively copies keys and accepts a prior signing key during rotation", () => {
    const mutableSecret = new Uint8Array(32).fill(9);
    const oldIssuer = new CsrfTokenService(new FixedRandomSource(new Uint8Array(32).fill(4)), {
      activeKeyId: "old",
      keys: [{ id: "old", secret: mutableSecret }],
    });
    mutableSecret.fill(0);
    const oldToken = oldIssuer.issue("session").token;
    const rotated = new CsrfTokenService(new FixedRandomSource(new Uint8Array(32).fill(5)), {
      activeKeyId: "new",
      keys: [key("new", 8), key("old", 9)],
    });
    expect(rotated.verify(oldToken, oldToken, "session")).toBe(true);
    expect(rotated.issue("session").token).toContain("$new$");
  });

  it("rejects oversized, malformed, unknown-key, and tampered tokens", () => {
    const service = new CsrfTokenService(
      new FixedRandomSource(new Uint8Array(32).fill(3)),
      keyring(),
    );
    const token = service.issue("session").token;
    const [, , , keyId, nonce] = token.split("$");
    const prefix = `$sc-csrf$v=1$${keyId!}$`;

    expect(service.verify("x".repeat(513), "x".repeat(513), "session")).toBe(false);
    expect(service.verify(token, "x".repeat(513), "session")).toBe(false);
    expect(service.verify("malformed", "malformed", "session")).toBe(false);
    const unknownKey = token.replace("$current$", "$unknown$");
    expect(service.verify(unknownKey, unknownKey, "session")).toBe(false);

    const invalidNonce = `${prefix}A$${encodeBase64Url(new Uint8Array(32))}`;
    expect(service.verify(invalidNonce, invalidNonce, "session")).toBe(false);
    const invalidSignature = `${prefix}${nonce!}$A`;
    expect(service.verify(invalidSignature, invalidSignature, "session")).toBe(false);
    const wrongSignature = `${prefix}${nonce!}$${encodeBase64Url(new Uint8Array(32))}`;
    expect(service.verify(wrongSignature, wrongSignature, "session")).toBe(false);
  });

  it("validates session bindings and entropy", () => {
    const service = new CsrfTokenService(
      new FixedRandomSource(new Uint8Array(32).fill(3)),
      keyring(),
    );
    expect(() => service.issue("")).toThrow("1-512");
    expect(() => service.issue("a".repeat(513))).toThrow("1-512");
    expect(() => service.issue("é".repeat(257))).toThrow("1-512");
    expect(() => service.verify("x", "x", "")).toThrow("1-512");
    expect(() =>
      new CsrfTokenService(new FixedRandomSource(new Uint8Array(31)), keyring()).issue("session"),
    ).toThrow("expected 32");
  });

  it("rejects invalid keyrings before retaining any key material", () => {
    const random = new FixedRandomSource(new Uint8Array(32));
    expect(
      () => new CsrfTokenService(random, { activeKeyId: "not valid", keys: [key("current", 1)] }),
    ).toThrow("key id");
    expect(() => new CsrfTokenService(random, { activeKeyId: "current", keys: [] })).toThrow(
      "at least one",
    );
    expect(
      () =>
        new CsrfTokenService(random, {
          activeKeyId: "current",
          keys: [key("not valid", 1)],
        }),
    ).toThrow("key id");
    expect(
      () =>
        new CsrfTokenService(random, {
          activeKeyId: "current",
          keys: [key("current", 1, 31)],
        }),
    ).toThrow("32-128");
    expect(
      () =>
        new CsrfTokenService(random, {
          activeKeyId: "current",
          keys: [key("current", 1, 129)],
        }),
    ).toThrow("32-128");
    expect(
      () =>
        new CsrfTokenService(random, {
          activeKeyId: "current",
          keys: [key("current", 1), key("current", 2)],
        }),
    ).toThrow("Duplicate");
    expect(
      () =>
        new CsrfTokenService(random, {
          activeKeyId: "missing",
          keys: [key("current", 1)],
        }),
    ).toThrow("not present");
  });
});
