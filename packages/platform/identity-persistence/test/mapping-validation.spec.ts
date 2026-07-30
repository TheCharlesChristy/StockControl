import { describe, expect, it } from "vitest";
import type { Sha256Digest } from "@stockcontrol/module-identity";

import {
  bootstrapStateFromRow,
  invitationFromRow,
  permissionOverrideFromRow,
  sessionFromRow,
  settingsFromPermissionRows,
  totpCredentialFromRow,
  userFromRow,
} from "../src/mappers";
import {
  IdentityPersistenceInputError,
  assertReason,
  assertUuid,
  digestBytes,
  encryptionKeyId,
  exactBytes,
  minimumBytes,
  nonnegativeCounter,
  nullableDate,
  nullableString,
  optionalDate,
  optionalDigestBytes,
  optionalString,
  assertSessionAssurance,
} from "../src/validation";

const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T13:00:00.000Z");
const userId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const recordId = "33333333-3333-4333-8333-333333333333";
const digest = (fill = 1): Sha256Digest => new Uint8Array(32).fill(fill) as Sha256Digest;

describe("persistence input validation", () => {
  it("accepts opaque UUIDs and clones exact SHA-256 digests", () => {
    const source = digest();
    const copy = digestBytes(source, "Token hash");

    expect(assertUuid(userId, "User ID")).toBe(userId);
    expect(copy).toEqual(source);
    expect(copy).not.toBe(source);
    expect(optionalDigestBytes(undefined, "Optional hash")).toBeNull();
    expect(optionalDigestBytes(source, "Optional hash")).toEqual(source);
  });

  it.each(["not-a-uuid", "", "11111111-1111-1111-1111"])("rejects malformed UUID %j", (value) => {
    expect(() => assertUuid(value, "User ID")).toThrow(
      new IdentityPersistenceInputError("IdentifierInvalid", "User ID must be a UUID."),
    );
  });

  it.each([new Uint8Array(0), new Uint8Array(31), new Uint8Array(33)])(
    "rejects a non-SHA-256 digest of $byteLength bytes",
    (value) => {
      expect(() => digestBytes(value, "Token hash")).toThrow(
        new IdentityPersistenceInputError(
          "DigestLengthInvalid",
          "Token hash must be a 32-byte SHA-256 digest.",
        ),
      );
    },
  );

  it("normalises optional storage values without inventing values", () => {
    expect(nullableDate(undefined)).toBeNull();
    expect(nullableDate(now)).toBe(now);
    expect(optionalDate(null)).toBeUndefined();
    expect(optionalDate(now)).toBe(now);
    expect(nullableString(undefined)).toBeNull();
    expect(nullableString("value")).toBe("value");
    expect(optionalString(null)).toBeUndefined();
    expect(optionalString("value")).toBe("value");
  });

  it("trims valid reasons and rejects empty or overlong reasons", () => {
    expect(assertReason("  signed out by office  ")).toBe("signed out by office");
    expect(() => assertReason("   ")).toThrowError(
      expect.objectContaining({ code: "ReasonInvalid" }),
    );
    expect(() => assertReason("x".repeat(201))).toThrowError(
      expect.objectContaining({ code: "ReasonInvalid" }),
    );
  });

  it("validates encrypted-envelope lengths, key IDs and monotonic counters", () => {
    expect(exactBytes(new Uint8Array(12), 12, "Nonce")).toHaveLength(12);
    expect(minimumBytes(new Uint8Array([1]), 1, "Ciphertext")).toEqual(new Uint8Array([1]));
    expect(encryptionKeyId("  identity-key-1 ")).toBe("identity-key-1");
    expect(nonnegativeCounter(42n, "TOTP counter")).toBe("42");

    expect(() => exactBytes(new Uint8Array(11), 12, "Nonce")).toThrow(
      "Nonce must contain exactly 12 bytes.",
    );
    expect(() => minimumBytes(new Uint8Array(), 1, "Ciphertext")).toThrow(
      "Ciphertext must contain at least 1 bytes.",
    );
    expect(() => encryptionKeyId(" ")).toThrow(
      "The encryption key ID must contain 1 to 100 characters.",
    );
    expect(() => encryptionKeyId("x".repeat(101))).toThrowError(
      expect.objectContaining({ code: "EncryptionKeyInvalid" }),
    );
    expect(() => nonnegativeCounter(-1n, "TOTP counter")).toThrow(
      "TOTP counter cannot be negative.",
    );
    expect(() => nonnegativeCounter(9_223_372_036_854_775_808n, "TOTP counter")).toThrow(
      "TOTP counter must fit a PostgreSQL bigint.",
    );
  });

  it("requires session assurance to match its authentication method", () => {
    expect(() => assertSessionAssurance("Password", "SingleFactor")).not.toThrow();
    expect(() => assertSessionAssurance("PasswordAndTotp", "MultiFactor")).not.toThrow();
    expect(() => assertSessionAssurance("PasswordAndRecoveryCode", "MultiFactor")).not.toThrow();
    expect(() => assertSessionAssurance("Password", "MultiFactor")).toThrowError(
      expect.objectContaining({ code: "SessionAssuranceInvalid" }),
    );
  });
});

describe("strict database row mapping", () => {
  it("maps users and permission overrides to identity-domain values", () => {
    const permissionRows = [
      {
        user_id: userId,
        capability: "users.manage",
        setting: "Deny" as const,
        catalogue_version: 1,
        updated_by_user_id: actorId,
        created_at: now,
        updated_at: later,
      },
    ];
    const settings = settingsFromPermissionRows(permissionRows);

    expect(settings).toEqual({ "users.manage": "Deny" });
    expect(
      userFromRow(
        {
          id: userId,
          normalised_email: "admin@example.test",
          display_name: "Admin User",
          role: "Admin",
          status: "Active",
          created_at: now,
          updated_at: later,
          version: 4,
        },
        settings,
      ),
    ).toMatchObject({
      id: userId,
      email: "admin@example.test",
      displayName: "Admin User",
      role: "Admin",
      status: "Active",
      permissionSettings: { "users.manage": "Deny" },
      version: 4,
    });
    expect(permissionOverrideFromRow(permissionRows[0]!)).toEqual({
      userId,
      capability: "users.manage",
      setting: "Deny",
      catalogueVersion: 1,
      updatedByUserId: actorId,
      createdAt: now,
      updatedAt: later,
    });
  });

  it("fails closed when a database row contains an unknown capability", () => {
    expect(() =>
      settingsFromPermissionRows([
        {
          user_id: userId,
          capability: "users.superpowers",
          setting: "Allow",
          catalogue_version: 1,
          updated_by_user_id: actorId,
          created_at: now,
          updated_at: now,
        },
      ]),
    ).toThrow("Database contains unknown permission capability users.superpowers.");
  });

  it("maps active and revoked sessions while cloning every digest", () => {
    const base = {
      id: recordId,
      user_id: userId,
      token_hash: digest(2),
      authentication_method: "PasswordAndTotp" as const,
      assurance_level: "MultiFactor" as const,
      issued_at: now,
      last_seen_at: now,
      idle_expires_at: later,
      absolute_expires_at: later,
      version: 2,
    };

    expect(
      sessionFromRow({
        ...base,
        reauthenticated_at: null,
        revoked_at: null,
        revoke_reason: null,
        created_ip_hash: null,
        user_agent: null,
      }),
    ).toEqual({
      id: recordId,
      userId,
      tokenHash: digest(2),
      authenticationMethod: "PasswordAndTotp",
      assuranceLevel: "MultiFactor",
      issuedAt: now,
      lastSeenAt: now,
      idleExpiresAt: later,
      absoluteExpiresAt: later,
      version: 2,
    });

    expect(
      sessionFromRow({
        ...base,
        reauthenticated_at: later,
        revoked_at: later,
        revoke_reason: "revoked",
        created_ip_hash: digest(4),
        user_agent: "StockControl test",
      }),
    ).toMatchObject({
      reauthenticatedAt: later,
      revokedAt: later,
      revokeReason: "revoked",
      createdIpHash: digest(4),
      userAgent: "StockControl test",
    });
  });

  it("maps versioned TOTP envelopes and fails closed on an unknown version", () => {
    const row = {
      id: recordId,
      user_id: userId,
      status: "Active" as const,
      secret_encryption_version: 1,
      secret_key_id: "identity-key-1",
      secret_nonce: new Uint8Array(12),
      secret_ciphertext: new Uint8Array(32),
      secret_auth_tag: new Uint8Array(16),
      last_accepted_counter: "9876543210",
      verified_at: later,
      recovery_codes_acknowledged_at: later,
      revoked_at: null,
      created_at: now,
      updated_at: later,
      version: 2,
    };

    expect(totpCredentialFromRow(row)).toMatchObject({
      id: recordId,
      secretEncryptionVersion: 1,
      lastAcceptedCounter: 9_876_543_210n,
      verifiedAt: later,
      version: 2,
    });
    expect(
      totpCredentialFromRow({
        ...row,
        status: "Revoked",
        revoked_at: later,
      }),
    ).toMatchObject({ status: "Revoked", revokedAt: later });
    expect(() => totpCredentialFromRow({ ...row, secret_encryption_version: 2 })).toThrow(
      "Database contains unsupported TOTP encryption version 2.",
    );
  });

  it("maps pending, accepted and revoked invitation states", () => {
    const base = {
      id: recordId,
      user_id: userId,
      invited_by_user_id: actorId,
      token_hash: digest(5),
      created_at: now,
      expires_at: later,
      version: 1,
    };

    expect(invitationFromRow({ ...base, accepted_at: null, revoked_at: null })).not.toHaveProperty(
      "acceptedAt",
    );
    expect(invitationFromRow({ ...base, accepted_at: later, revoked_at: null })).toMatchObject({
      acceptedAt: later,
    });
    expect(invitationFromRow({ ...base, accepted_at: null, revoked_at: later })).toMatchObject({
      revokedAt: later,
    });
  });

  it("maps both valid bootstrap states and rejects an inconsistent row", () => {
    const base = {
      singleton_key: 1,
      created_at: now,
      updated_at: later,
      version: 2,
    };

    expect(
      bootstrapStateFromRow({
        ...base,
        secret_hash: digest(6),
        expires_at: later,
        completed_at: null,
        completed_by_user_id: null,
      }),
    ).toMatchObject({
      status: "Pending",
      secretHash: digest(6),
      expiresAt: later,
    });
    expect(
      bootstrapStateFromRow({
        ...base,
        secret_hash: null,
        expires_at: null,
        completed_at: later,
        completed_by_user_id: userId,
      }),
    ).toMatchObject({
      status: "Completed",
      completedAt: later,
      completedByUserId: userId,
    });
    expect(() =>
      bootstrapStateFromRow({
        ...base,
        secret_hash: null,
        expires_at: later,
        completed_at: null,
        completed_by_user_id: null,
      }),
    ).toThrow("Database contains an inconsistent bootstrap state.");
  });
});
