import { describe, expect, it } from "vitest";

import {
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_RANDOM_BYTES,
  RecoveryCodeService,
  normalizeRecoveryCode,
} from "../src/recovery-codes.js";
import {
  PERSISTED_TOKEN_HASH_BYTES,
  OpaqueTokenService,
  SESSION_COOKIE,
  SESSION_TOKEN_DOMAIN,
  SessionTokenService,
  createPersistedTokenHash,
  persistedTokenHashBytes,
} from "../src/tokens.js";
import { FixedRandomSource, IncrementingRandomSource } from "./helpers.js";

describe("opaque and session tokens", () => {
  it("issues one-time entropy while exposing only a domain-separated SHA-256 hash for storage", () => {
    const random = new FixedRandomSource(new Uint8Array(32).fill(9));
    const service = new OpaqueTokenService(random, "identity.invitation");
    const issued = service.issue();

    expect(issued.token).toBe("CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk");
    expect(issued.hash).toBeInstanceOf(Uint8Array);
    expect(issued.hash).toHaveLength(PERSISTED_TOKEN_HASH_BYTES);
    expect(Buffer.from(issued.hash).toString("base64url")).not.toContain(issued.token);
    expect(service.hash(issued.token)).toEqual(issued.hash);
    expect(service.verify(issued.token, issued.hash)).toBe(true);
  });

  it("rejects wrong, malformed, and cross-domain token material", () => {
    const random = new IncrementingRandomSource();
    const invitations = new OpaqueTokenService(random, "identity.invitation");
    const resets = new OpaqueTokenService(random, "identity.password-reset");
    const issued = invitations.issue();
    const other = invitations.issue();

    expect(invitations.verify(other.token, issued.hash)).toBe(false);
    expect(invitations.verify("not-base64!", issued.hash)).toBe(false);
    expect(invitations.verify("YQ", issued.hash)).toBe(false);
    expect(
      invitations.verify(
        issued.token,
        createPersistedTokenHash(new Uint8Array(PERSISTED_TOKEN_HASH_BYTES)),
      ),
    ).toBe(false);
    expect(resets.verify(issued.token, issued.hash)).toBe(false);
    expect(() => invitations.hash("bad")).toThrow("token length");
    expect(() => invitations.hash("!".repeat(43))).toThrow("base64url");
  });

  it("provides an exact raw-byte persistence codec with canonical defensive copies", () => {
    const source = new Uint8Array(PERSISTED_TOKEN_HASH_BYTES).fill(7);
    const digest = createPersistedTokenHash(source);
    source.fill(0);

    expect(digest).toEqual(new Uint8Array(PERSISTED_TOKEN_HASH_BYTES).fill(7));
    expect(digest).not.toBe(source);
    expect(createPersistedTokenHash(Buffer.alloc(PERSISTED_TOKEN_HASH_BYTES, 7))).toEqual(digest);

    const databaseBytes = persistedTokenHashBytes(digest);
    databaseBytes.fill(9);
    expect(digest).toEqual(new Uint8Array(PERSISTED_TOKEN_HASH_BYTES).fill(7));
    expect(databaseBytes).not.toBe(digest);
    expect(() => createPersistedTokenHash(new Uint8Array(31))).toThrow("exactly 32");
    expect(() => createPersistedTokenHash(new Uint8Array(33))).toThrow("exactly 32");
    expect(() => createPersistedTokenHash("x".repeat(32) as unknown as Uint8Array)).toThrow(
      "exactly 32",
    );
  });

  it("fails closed for a corrupt branded value while retaining a bounded digest comparison", () => {
    const service = new OpaqueTokenService(new IncrementingRandomSource(), "identity.invitation");
    const issued = service.issue();
    const corrupt = issued.hash.subarray(0, 31) as typeof issued.hash;

    expect(service.verify(issued.token, corrupt)).toBe(false);
  });

  it("validates entropy, domains, and token size at its boundary", () => {
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "")).toThrow(
      "stable lowercase",
    );
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "A")).toThrow(
      "stable lowercase",
    );
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "a".repeat(129))).toThrow(
      "stable lowercase",
    );
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "valid", 31)).toThrow(
      "32-64",
    );
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "valid", 65)).toThrow(
      "32-64",
    );
    expect(() => new OpaqueTokenService(new IncrementingRandomSource(), "valid", 32.5)).toThrow(
      "32-64",
    );
    expect(() =>
      new OpaqueTokenService(new FixedRandomSource(new Uint8Array(31)), "valid").issue(),
    ).toThrow("expected 32");
  });

  it("provides a narrowly configured session token facade and cookie", () => {
    const sessions = new SessionTokenService(new FixedRandomSource(new Uint8Array(32).fill(5)));
    const issued = sessions.issue();
    expect(SESSION_TOKEN_DOMAIN).toBe("identity.session");
    expect(sessions.hash(issued.token)).toEqual(issued.hash);
    expect(sessions.verify(issued.token, issued.hash)).toBe(true);
    expect(
      sessions.verify(
        new OpaqueTokenService(
          new FixedRandomSource(new Uint8Array(32).fill(6)),
          "identity.session",
        ).issue().token,
        issued.hash,
      ),
    ).toBe(false);
    expect(SESSION_COOKIE).toEqual({
      name: "__Host-stockcontrol_session",
      options: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    });
    expect(Object.isFrozen(SESSION_COOKIE)).toBe(true);
    expect(Object.isFrozen(SESSION_COOKIE.options)).toBe(true);
  });
});

describe("single-use recovery codes", () => {
  it("publishes a high-entropy default and normalizes only canonical codes", () => {
    expect(RECOVERY_CODE_COUNT).toBe(10);
    expect(RECOVERY_CODE_RANDOM_BYTES).toBe(10);
    expect(normalizeRecoveryCode("abcd-efgh-jklm-npqr")).toBe("ABCDEFGHJKLMNPQR");
    expect(normalizeRecoveryCode("ABCD EFGH JKLM NPQR")).toBe("ABCDEFGHJKLMNPQR");
    expect(normalizeRecoveryCode("too-short")).toBeUndefined();
    expect(normalizeRecoveryCode("ABCD-EFGH-0JKL-MNOP")).toBeUndefined();
    expect(normalizeRecoveryCode("A".repeat(129))).toBeUndefined();
  });

  it("issues display-once codes and persistable hashes", () => {
    const service = new RecoveryCodeService(new IncrementingRandomSource(), 2);
    const issued = service.issue();

    expect(issued.codes).toEqual(["AAAQ-EAYE-AUDA-OCAJ", "AEBA-GBAF-AYDQ-QCIK"]);
    expect(issued.hashes).toHaveLength(2);
    expect(issued.hashes.every((hash) => hash.length === PERSISTED_TOKEN_HASH_BYTES)).toBe(true);
    expect(
      Buffer.concat(issued.hashes.map((hash) => Buffer.from(hash))).toString("ascii"),
    ).not.toContain("AAASE");
    expect(service.hash(issued.codes[0]!)).toEqual(issued.hashes[0]);
    expect(service.verify(issued.codes[0]!, issued.hashes[0]!)).toBe(true);
    expect(service.verify(issued.codes[1]!, issued.hashes[0]!)).toBe(false);
    expect(service.verify("malformed", issued.hashes[0]!)).toBe(false);
    expect(() => service.hash("malformed")).toThrow("malformed");
  });

  it("consumes exactly one matching hash and cannot consume it twice", () => {
    const service = new RecoveryCodeService(new IncrementingRandomSource(), 3);
    const issued = service.issue();
    const first = service.consume(issued.codes[1]!, issued.hashes);

    expect(first).toEqual({
      consumed: true,
      remainingHashes: [issued.hashes[0], issued.hashes[2]],
    });
    const replay = service.consume(issued.codes[1]!, first.remainingHashes);
    expect(replay).toEqual({
      consumed: false,
      remainingHashes: first.remainingHashes,
    });
    expect(replay.remainingHashes).not.toBe(first.remainingHashes);
    expect(service.consume(issued.codes[0]!, [issued.hashes[0]!, issued.hashes[0]!])).toEqual({
      consumed: true,
      remainingHashes: [],
    });
  });

  it("rejects unsafe counts and broken or duplicate entropy", () => {
    expect(() => new RecoveryCodeService(new IncrementingRandomSource(), 0)).toThrow("1-20");
    expect(() => new RecoveryCodeService(new IncrementingRandomSource(), 21)).toThrow("1-20");
    expect(() => new RecoveryCodeService(new IncrementingRandomSource(), 1.5)).toThrow("1-20");
    expect(() =>
      new RecoveryCodeService(new FixedRandomSource(new Uint8Array(9)), 1).issue(),
    ).toThrow("expected 10");
    expect(() =>
      new RecoveryCodeService(new FixedRandomSource(new Uint8Array(10)), 2).issue(),
    ).toThrow("unique");
  });
});
