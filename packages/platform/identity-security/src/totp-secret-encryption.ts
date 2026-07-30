import { createCipheriv, createDecipheriv } from "node:crypto";

import { requireRandomBytes, utf8 } from "./encoding.js";
import type { RandomSource } from "./ports.js";
import { TOTP_POLICY, type TotpSecret } from "./totp.js";

export const TOTP_SECRET_ENCRYPTION_VERSION = 1 as const;
export const TOTP_SECRET_ENCRYPTION_KEY_BYTES = 32;
export const TOTP_SECRET_ENCRYPTION_NONCE_BYTES = 12;
export const TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES = 16;

const TOTP_SECRET_ENCRYPTION_PURPOSE = "stockcontrol:identity:totp-secret:v1";
const TOTP_SECRET_BASE32_BYTES = 32;
const MAX_KEYRING_KEYS = 16;
const MAX_CONTEXT_BYTES = 256;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const CANONICAL_TOTP_SECRET_PATTERN = /^[A-Z2-7]{32}$/u;

export interface TotpSecretEncryptionKeyInput {
  readonly id: string;
  /**
   * Exactly 32 independently generated random bytes. Never persist this key
   * beside encrypted credentials.
   */
  readonly key: Uint8Array;
}

export interface TotpSecretEncryptionKeyringInput {
  readonly activeKeyId: string;
  /**
   * Include the active key and only the retained keys needed to decrypt data
   * while a rotation is in progress.
   */
  readonly keys: readonly TotpSecretEncryptionKeyInput[];
}

export interface TotpSecretEncryptionContext {
  readonly userId: string;
  readonly credentialId: string;
}

/**
 * Maps one-to-one to the identity TOTP credential database columns.
 */
export interface EncryptedTotpSecret {
  readonly encryptionVersion: 1;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authTag: Uint8Array;
}

export interface DecryptedTotpSecret {
  readonly secret: TotpSecret;
  /**
   * Re-encrypt in the same transaction when true; the retained key may be
   * removed only after every credential has migrated.
   */
  readonly needsReencrypt: boolean;
}

interface TotpSecretEncryptionKey {
  readonly id: string;
  readonly key: Uint8Array;
}

/**
 * Deliberately generic: authentication failures, corrupt rows, wrong context,
 * and unsupported envelopes must not reveal which cryptographic check failed.
 */
export class InvalidEncryptedTotpSecretError extends Error {
  public constructor() {
    super("Encrypted TOTP secret is invalid or cannot be authenticated.");
    this.name = "InvalidEncryptedTotpSecretError";
  }
}

const validateKeyId = (id: string): void => {
  if (!KEY_ID_PATTERN.test(id)) {
    throw new RangeError("TOTP encryption key id must be 1-64 URL-safe characters.");
  }
};

const copyExactBytes = (value: Uint8Array, length: number, description: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new RangeError(`${description} must contain exactly ${length} bytes.`);
  }
  return new Uint8Array(value);
};

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const contextPart = (value: string, description: string): Uint8Array => {
  if (value.length > MAX_CONTEXT_BYTES) {
    throw new RangeError(`${description} must contain 1-${MAX_CONTEXT_BYTES} UTF-8 bytes.`);
  }
  const encoded = utf8(value);
  if (
    encoded.length < 1 ||
    encoded.length > MAX_CONTEXT_BYTES ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    encoded.fill(0);
    throw new RangeError(`${description} must contain 1-${MAX_CONTEXT_BYTES} UTF-8 bytes.`);
  }
  return encoded;
};

const appendLengthDelimited = (parts: readonly Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((total, part) => total + 4 + part.length, 0);
  const result = new Uint8Array(totalLength);
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length);
    offset += 4;
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const additionalAuthenticatedData = (
  keyId: string,
  context: TotpSecretEncryptionContext,
): Uint8Array => {
  const purpose = utf8(TOTP_SECRET_ENCRYPTION_PURPOSE);
  const version = Uint8Array.of(TOTP_SECRET_ENCRYPTION_VERSION);
  const encodedKeyId = utf8(keyId);
  let userId: Uint8Array | undefined;
  let credentialId: Uint8Array | undefined;
  try {
    userId = contextPart(context.userId, "TOTP encryption user id");
    credentialId = contextPart(context.credentialId, "TOTP encryption credential id");
    return appendLengthDelimited([purpose, version, encodedKeyId, userId, credentialId]);
  } finally {
    purpose.fill(0);
    version.fill(0);
    encodedKeyId.fill(0);
    userId?.fill(0);
    credentialId?.fill(0);
  }
};

const canonicalSecretBytes = (secret: TotpSecret | string): Uint8Array => {
  if (!CANONICAL_TOTP_SECRET_PATTERN.test(secret)) {
    throw new RangeError(
      `TOTP secret must be the canonical ${TOTP_POLICY.secretBytes * 8}-bit base32 value.`,
    );
  }
  return utf8(secret);
};

const invalidEnvelope = (): InvalidEncryptedTotpSecretError =>
  new InvalidEncryptedTotpSecretError();

const isSupportedEncryptionVersion = (value: number): value is 1 =>
  value === TOTP_SECRET_ENCRYPTION_VERSION;

const parseEnvelope = (envelope: EncryptedTotpSecret): EncryptedTotpSecret => {
  try {
    if (!isSupportedEncryptionVersion(envelope.encryptionVersion)) {
      throw invalidEnvelope();
    }
    validateKeyId(envelope.keyId);
    return {
      encryptionVersion: TOTP_SECRET_ENCRYPTION_VERSION,
      keyId: envelope.keyId,
      nonce: copyExactBytes(
        envelope.nonce,
        TOTP_SECRET_ENCRYPTION_NONCE_BYTES,
        "TOTP encryption nonce",
      ),
      ciphertext: copyExactBytes(
        envelope.ciphertext,
        TOTP_SECRET_BASE32_BYTES,
        "TOTP encrypted ciphertext",
      ),
      authTag: copyExactBytes(
        envelope.authTag,
        TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES,
        "TOTP encryption authentication tag",
      ),
    };
  } catch {
    throw invalidEnvelope();
  }
};

export class TotpSecretEncryptionService {
  readonly #activeKey: TotpSecretEncryptionKey;
  readonly #keys: ReadonlyMap<string, TotpSecretEncryptionKey>;

  public constructor(
    private readonly randomSource: RandomSource,
    keyring: TotpSecretEncryptionKeyringInput,
  ) {
    validateKeyId(keyring.activeKeyId);
    if (keyring.keys.length < 1 || keyring.keys.length > MAX_KEYRING_KEYS) {
      throw new RangeError(`TOTP encryption keyring must contain 1-${MAX_KEYRING_KEYS} keys.`);
    }

    const keys = new Map<string, TotpSecretEncryptionKey>();
    try {
      for (const input of keyring.keys) {
        validateKeyId(input.id);
        if (keys.has(input.id)) {
          throw new Error(`Duplicate TOTP encryption key id: ${input.id}.`);
        }
        keys.set(input.id, {
          id: input.id,
          key: copyExactBytes(input.key, TOTP_SECRET_ENCRYPTION_KEY_BYTES, "TOTP encryption key"),
        });
      }

      const activeKey = keys.get(keyring.activeKeyId);
      if (activeKey === undefined) {
        throw new Error("Active TOTP encryption key is not present in the keyring.");
      }
      this.#activeKey = activeKey;
      this.#keys = keys;
    } catch (error) {
      for (const retainedKey of keys.values()) {
        retainedKey.key.fill(0);
      }
      throw error;
    }
  }

  public encrypt(
    secret: TotpSecret | string,
    context: TotpSecretEncryptionContext,
  ): EncryptedTotpSecret {
    let plaintext: Uint8Array | undefined;
    let nonce: Uint8Array | undefined;
    let aad: Uint8Array | undefined;
    let encrypted: Buffer | undefined;
    let final: Buffer | undefined;
    try {
      plaintext = canonicalSecretBytes(secret);
      nonce = requireRandomBytes(this.randomSource, TOTP_SECRET_ENCRYPTION_NONCE_BYTES);
      aad = additionalAuthenticatedData(this.#activeKey.id, context);
      const cipher = createCipheriv("aes-256-gcm", this.#activeKey.key, nonce, {
        authTagLength: TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES,
      });
      cipher.setAAD(aad, { plaintextLength: plaintext.length });
      encrypted = cipher.update(plaintext);
      final = cipher.final();
      const ciphertext = new Uint8Array(encrypted.length + final.length);
      ciphertext.set(encrypted);
      ciphertext.set(final, encrypted.length);
      return {
        encryptionVersion: TOTP_SECRET_ENCRYPTION_VERSION,
        keyId: this.#activeKey.id,
        nonce: new Uint8Array(nonce),
        ciphertext,
        authTag: new Uint8Array(cipher.getAuthTag()),
      };
    } finally {
      plaintext?.fill(0);
      nonce?.fill(0);
      aad?.fill(0);
      encrypted?.fill(0);
      final?.fill(0);
    }
  }

  public decrypt(
    envelopeInput: EncryptedTotpSecret,
    context: TotpSecretEncryptionContext,
  ): DecryptedTotpSecret {
    let envelope: EncryptedTotpSecret | undefined;
    let aad: Uint8Array | undefined;
    let plaintext: Buffer | undefined;
    let final: Buffer | undefined;
    try {
      envelope = parseEnvelope(envelopeInput);
      const key = this.#keys.get(envelope.keyId);
      if (key === undefined) {
        throw invalidEnvelope();
      }
      aad = additionalAuthenticatedData(key.id, context);
      const decipher = createDecipheriv("aes-256-gcm", key.key, envelope.nonce, {
        authTagLength: TOTP_SECRET_ENCRYPTION_AUTH_TAG_BYTES,
      });
      decipher.setAAD(aad, { plaintextLength: envelope.ciphertext.length });
      decipher.setAuthTag(envelope.authTag);
      plaintext = decipher.update(envelope.ciphertext);
      final = decipher.final();
      const combined = Buffer.concat([plaintext, final]);
      try {
        const secretText = new TextDecoder("utf-8", { fatal: true }).decode(combined);
        const canonical = canonicalSecretBytes(secretText);
        canonical.fill(0);
        return {
          secret: secretText as TotpSecret,
          needsReencrypt: key.id !== this.#activeKey.id,
        };
      } finally {
        combined.fill(0);
      }
    } catch {
      throw invalidEnvelope();
    } finally {
      envelope?.nonce.fill(0);
      envelope?.ciphertext.fill(0);
      envelope?.authTag.fill(0);
      aad?.fill(0);
      plaintext?.fill(0);
      final?.fill(0);
    }
  }
}
