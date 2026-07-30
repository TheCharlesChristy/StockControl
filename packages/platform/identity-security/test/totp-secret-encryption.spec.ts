import { createCipheriv } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { TotpSecret } from "../src/totp.js";
import {
  InvalidEncryptedTotpSecretError,
  TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES,
  TOTP_SECRET_ENCRYPTION_KEY_BYTES,
  TOTP_SECRET_ENCRYPTION_NONCE_BYTES,
  TOTP_SECRET_ENCRYPTION_VERSION,
  TotpSecretEncryptionService,
  type EncryptedTotpSecret,
  type TotpSecretEncryptionContext,
  type TotpSecretEncryptionKeyInput,
  type TotpSecretEncryptionKeyringInput,
} from "../src/totp-secret-encryption.js";
import { FixedRandomSource, IncrementingRandomSource } from "./helpers.js";

const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" as TotpSecret;
const CONTEXT: TotpSecretEncryptionContext = {
  userId: "user-3adf0458",
  credentialId: "credential-f834b64f",
};

const key = (id: string, fill: number, length = 32): TotpSecretEncryptionKeyInput => ({
  id,
  key: new Uint8Array(length).fill(fill),
});

const keyring = (
  activeKeyId = "current",
  keys: readonly TotpSecretEncryptionKeyInput[] = [key("current", 7), key("previous", 6)],
): TotpSecretEncryptionKeyringInput => ({
  activeKeyId,
  keys,
});

const invalidError = "Encrypted TOTP secret is invalid or cannot be authenticated.";

const lengthDelimited = (parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + 4 + part.length, 0));
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length);
    offset += 4;
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const aadForTest = (keyId: string, context: TotpSecretEncryptionContext): Uint8Array =>
  lengthDelimited(
    [
      "stockcontrol:identity:totp-secret:v1",
      "\u0001",
      keyId,
      context.userId,
      context.credentialId,
    ].map((part) => Buffer.from(part, "utf8")),
  );

const encryptArbitraryPlaintext = (
  plaintext: Uint8Array,
  encryptionKey: Uint8Array,
  keyId = "current",
): EncryptedTotpSecret => {
  const nonce = new Uint8Array(TOTP_SECRET_ENCRYPTION_NONCE_BYTES).fill(5);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce, {
    authTagLength: TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES,
  });
  cipher.setAAD(aadForTest(keyId, CONTEXT), { plaintextLength: plaintext.length });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encryptionVersion: 1,
    keyId,
    nonce,
    ciphertext: new Uint8Array(ciphertext),
    authTag: new Uint8Array(cipher.getAuthTag()),
  };
};

describe("TOTP secret encryption at rest", () => {
  it("publishes the locked AES-256-GCM envelope contract", () => {
    expect(TOTP_SECRET_ENCRYPTION_VERSION).toBe(1);
    expect(TOTP_SECRET_ENCRYPTION_KEY_BYTES).toBe(32);
    expect(TOTP_SECRET_ENCRYPTION_NONCE_BYTES).toBe(12);
    expect(TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES).toBe(16);
    expect(new InvalidEncryptedTotpSecretError()).toMatchObject({
      name: "InvalidEncryptedTotpSecretError",
      message: invalidError,
    });
  });

  it("round-trips a canonical secret with fresh database-ready fields", () => {
    const service = new TotpSecretEncryptionService(new IncrementingRandomSource(), keyring());
    const first = service.encrypt(SECRET, CONTEXT);
    const second = service.encrypt(SECRET, CONTEXT);

    expect(first).toMatchObject({
      encryptionVersion: 1,
      keyId: "current",
    });
    expect(first.nonce).toHaveLength(12);
    expect(first.ciphertext).toHaveLength(32);
    expect(first.authTag).toHaveLength(16);
    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(Buffer.from(SECRET));
    expect(service.decrypt(first, CONTEXT)).toEqual({
      secret: SECRET,
      needsReencrypt: false,
    });
    expect(service.decrypt(first, CONTEXT)).toEqual({
      secret: SECRET,
      needsReencrypt: false,
    });
  });

  it("defensively copies key input and does not mutate envelope input", () => {
    const mutableKey = new Uint8Array(32).fill(9);
    const service = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12).fill(4)),
      keyring("current", [{ id: "current", key: mutableKey }]),
    );
    mutableKey.fill(0);
    const encrypted = service.encrypt(SECRET, CONTEXT);
    const snapshot = {
      nonce: new Uint8Array(encrypted.nonce),
      ciphertext: new Uint8Array(encrypted.ciphertext),
      authTag: new Uint8Array(encrypted.authTag),
    };

    expect(service.decrypt(encrypted, CONTEXT).secret).toBe(SECRET);
    expect(encrypted.nonce).toEqual(snapshot.nonce);
    expect(encrypted.ciphertext).toEqual(snapshot.ciphertext);
    expect(encrypted.authTag).toEqual(snapshot.authTag);
  });

  it("decrypts retained keys and reports deterministic rotation work", () => {
    const oldService = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12).fill(2)),
      keyring("previous", [key("previous", 6)]),
    );
    const oldEnvelope = oldService.encrypt(SECRET, CONTEXT);
    const rotated = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12).fill(3)),
      keyring(),
    );

    expect(rotated.decrypt(oldEnvelope, CONTEXT)).toEqual({
      secret: SECRET,
      needsReencrypt: true,
    });
    const replacement = rotated.encrypt(SECRET, CONTEXT);
    expect(replacement.keyId).toBe("current");
    expect(rotated.decrypt(replacement, CONTEXT).needsReencrypt).toBe(false);
  });

  it("binds authentication to purpose, key metadata, user, and credential", () => {
    const service = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12).fill(8)),
      keyring(),
    );
    const encrypted = service.encrypt(SECRET, CONTEXT);

    expect(() => service.decrypt(encrypted, { ...CONTEXT, userId: "another-user" })).toThrow(
      invalidError,
    );
    expect(() =>
      service.decrypt(encrypted, { ...CONTEXT, credentialId: "another-credential" }),
    ).toThrow(invalidError);
    expect(() => service.decrypt({ ...encrypted, keyId: "previous" }, CONTEXT)).toThrow(
      invalidError,
    );
    expect(() =>
      new TotpSecretEncryptionService(
        new FixedRandomSource(new Uint8Array(12)),
        keyring("current", [key("current", 8)]),
      ).decrypt(encrypted, CONTEXT),
    ).toThrow(invalidError);
  });

  it("returns one generic error for tampering, unsupported versions, and corrupt fields", () => {
    const service = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12).fill(8)),
      keyring(),
    );
    const encrypted = service.encrypt(SECRET, CONTEXT);
    const tamperedTag = new Uint8Array(encrypted.authTag);
    tamperedTag[0] = tamperedTag[0]! ^ 1;
    const corruptEnvelopes: readonly EncryptedTotpSecret[] = [
      { ...encrypted, encryptionVersion: 2 } as unknown as EncryptedTotpSecret,
      { ...encrypted, keyId: "not valid" },
      { ...encrypted, keyId: "retired" },
      { ...encrypted, nonce: encrypted.nonce.subarray(1) },
      { ...encrypted, nonce: new Uint8Array(13) },
      { ...encrypted, ciphertext: encrypted.ciphertext.subarray(1) },
      { ...encrypted, ciphertext: new Uint8Array(33) },
      { ...encrypted, authTag: encrypted.authTag.subarray(1) },
      { ...encrypted, authTag: new Uint8Array(17) },
      { ...encrypted, authTag: tamperedTag },
      { ...encrypted, nonce: "not-bytes" as unknown as Uint8Array },
    ];

    for (const envelope of corruptEnvelopes) {
      let error: unknown;
      try {
        service.decrypt(envelope, CONTEXT);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(InvalidEncryptedTotpSecretError);
      expect(error).toMatchObject({ message: invalidError });
    }
  });

  it("rejects authenticated plaintext that is not one canonical TOTP secret", () => {
    const encryptionKey = new Uint8Array(32).fill(7);
    const service = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12)),
      keyring("current", [{ id: "current", key: encryptionKey }]),
    );
    const lowercase = encryptArbitraryPlaintext(Buffer.from(SECRET.toLowerCase()), encryptionKey);
    const invalidUtf8 = encryptArbitraryPlaintext(new Uint8Array(32).fill(0xff), encryptionKey);

    expect(() => service.decrypt(lowercase, CONTEXT)).toThrow(invalidError);
    expect(() => service.decrypt(invalidUtf8, CONTEXT)).toThrow(invalidError);
  });

  it("validates encryption inputs, context bounds, and entropy", () => {
    const service = new TotpSecretEncryptionService(
      new FixedRandomSource(new Uint8Array(12)),
      keyring(),
    );
    expect(() => service.encrypt(SECRET.toLowerCase(), CONTEXT)).toThrow("canonical 160-bit");
    expect(() => service.encrypt("A".repeat(31), CONTEXT)).toThrow("canonical 160-bit");
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: "" })).toThrow("user id");
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: " x " })).toThrow("user id");
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: "x\u0000y" })).toThrow("user id");
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: "x\u007fy" })).toThrow("user id");
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: "x".repeat(257) })).toThrow(
      "user id",
    );
    expect(() => service.encrypt(SECRET, { ...CONTEXT, userId: "\u00e9".repeat(200) })).toThrow(
      "user id",
    );
    expect(() => service.encrypt(SECRET, { ...CONTEXT, credentialId: "" })).toThrow(
      "credential id",
    );
    expect(() =>
      new TotpSecretEncryptionService(new FixedRandomSource(new Uint8Array(11)), keyring()).encrypt(
        SECRET,
        CONTEXT,
      ),
    ).toThrow("expected 12");

    expect(
      service.decrypt(
        service.encrypt(SECRET, {
          userId: "u".repeat(256),
          credentialId: "cr\u00e9dential",
        }),
        { userId: "u".repeat(256), credentialId: "cr\u00e9dential" },
      ),
    ).toMatchObject({ secret: SECRET });
  });

  it("validates a bounded, exact-length keyring before retaining key material", () => {
    const random = new FixedRandomSource(new Uint8Array(12));
    expect(
      () =>
        new TotpSecretEncryptionService(random, {
          activeKeyId: "not valid",
          keys: [key("current", 1)],
        }),
    ).toThrow("key id");
    expect(
      () => new TotpSecretEncryptionService(random, { activeKeyId: "current", keys: [] }),
    ).toThrow("1-16");
    expect(
      () =>
        new TotpSecretEncryptionService(
          random,
          keyring(
            "key-0",
            Array.from({ length: 17 }, (_, index) => key(`key-${index}`, index)),
          ),
        ),
    ).toThrow("1-16");
    expect(
      () => new TotpSecretEncryptionService(random, keyring("current", [key("not valid", 1)])),
    ).toThrow("key id");
    expect(
      () => new TotpSecretEncryptionService(random, keyring("current", [key("current", 1, 31)])),
    ).toThrow("exactly 32");
    expect(
      () => new TotpSecretEncryptionService(random, keyring("current", [key("current", 1, 33)])),
    ).toThrow("exactly 32");
    expect(
      () =>
        new TotpSecretEncryptionService(
          random,
          keyring("current", [{ id: "current", key: "x".repeat(32) as unknown as Uint8Array }]),
        ),
    ).toThrow("exactly 32");
    expect(
      () =>
        new TotpSecretEncryptionService(
          random,
          keyring("current", [key("current", 1), key("current", 2)]),
        ),
    ).toThrow("Duplicate");
    expect(
      () => new TotpSecretEncryptionService(random, keyring("missing", [key("current", 1)])),
    ).toThrow("not present");
  });
});
