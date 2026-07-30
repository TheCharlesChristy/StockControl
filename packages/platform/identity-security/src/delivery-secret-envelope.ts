import { createCipheriv, createDecipheriv } from "node:crypto";

import { requireRandomBytes, utf8 } from "./encoding.js";
import type { RandomSource } from "./ports.js";

/**
 * Versioned AEAD envelope for invitation and password-reset delivery secrets.
 *
 * A raw invitation or reset link is a bearer credential, so it can never sit
 * in a durable job payload in plaintext. The scheduling transaction seals the
 * secret here and the delivery handler opens it immediately before composing
 * the message.
 */

export const DELIVERY_SECRET_ENVELOPE_VERSION = 1 as const;
export const DELIVERY_SECRET_ENVELOPE_KEY_BYTES = 32;
export const DELIVERY_SECRET_ENVELOPE_NONCE_BYTES = 12;
export const DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES = 16;
export const MAX_DELIVERY_SECRET_BYTES = 512;

const DELIVERY_SECRET_ENVELOPE_PURPOSE = "stockcontrol:identity:delivery-secret:v1";
const MAX_KEYRING_KEYS = 16;
const MAX_BINDING_PART_BYTES = 256;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export interface DeliverySecretKeyInput {
  readonly id: string;
  /** Exactly 32 independently generated random bytes held outside the database. */
  readonly key: Uint8Array;
}

export interface DeliverySecretKeyringInput {
  readonly activeKeyId: string;
  /** The active key plus only the retained keys still needed during rotation. */
  readonly keys: readonly DeliverySecretKeyInput[];
}

/**
 * Every field is authenticated, so a sealed secret cannot be replayed under
 * another purpose, job, recipient, token record, or installation.
 */
export interface DeliverySecretBinding {
  readonly purpose: string;
  readonly jobId: string;
  readonly recipientUserId: string;
  readonly recipientEmail: string;
  readonly tokenRecordId: string;
  readonly installationId: string;
}

export interface DeliverySecretEnvelope {
  readonly envelopeVersion: 1;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authTag: Uint8Array;
  /** External, non-secret, and authenticated: cleanup can act without opening. */
  readonly expiresAt: Date;
}

export interface OpenedDeliverySecret {
  readonly secret: string;
  /** Re-encrypt under the active key before the retained key is retired. */
  readonly needsReencrypt: boolean;
}

/**
 * Deliberately generic: an expired, tampered, wrongly bound, corrupt, or
 * unknown-key envelope must not reveal which check failed.
 */
export class InvalidDeliverySecretEnvelopeError extends Error {
  public constructor() {
    super("The delivery secret envelope is invalid or cannot be authenticated.");
    this.name = "InvalidDeliverySecretEnvelopeError";
  }
}

interface DeliverySecretKey {
  readonly id: string;
  readonly key: Uint8Array;
}

const invalidEnvelope = (): InvalidDeliverySecretEnvelopeError =>
  new InvalidDeliverySecretEnvelopeError();

const validateKeyId = (id: string): void => {
  if (!KEY_ID_PATTERN.test(id)) {
    throw new RangeError("Delivery envelope key id must be 1-64 URL-safe characters.");
  }
};

const copyExactBytes = (value: Uint8Array, length: number, description: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new RangeError(`${description} must contain exactly ${String(length)} bytes.`);
  }

  return new Uint8Array(value);
};

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

const bindingPart = (value: string, description: string): Uint8Array => {
  if (value.length > MAX_BINDING_PART_BYTES) {
    throw new RangeError(
      `${description} must contain 1-${String(MAX_BINDING_PART_BYTES)} UTF-8 bytes.`,
    );
  }

  const encoded = utf8(value);

  if (
    encoded.length < 1 ||
    encoded.length > MAX_BINDING_PART_BYTES ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    encoded.fill(0);
    throw new RangeError(
      `${description} must contain 1-${String(MAX_BINDING_PART_BYTES)} UTF-8 bytes.`,
    );
  }

  return encoded;
};

const expiryPart = (expiresAt: Date): Uint8Array => {
  const milliseconds = expiresAt.getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new RangeError("Delivery envelope expiry must be a valid instant.");
  }

  return utf8(new Date(milliseconds).toISOString());
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
  binding: DeliverySecretBinding,
  expiresAt: Date,
): Uint8Array => {
  const parts: Uint8Array[] = [];

  try {
    parts.push(
      utf8(DELIVERY_SECRET_ENVELOPE_PURPOSE),
      Uint8Array.of(DELIVERY_SECRET_ENVELOPE_VERSION),
      utf8(keyId),
      bindingPart(binding.purpose, "Delivery purpose"),
      bindingPart(binding.jobId, "Delivery job id"),
      bindingPart(binding.recipientUserId, "Delivery recipient user id"),
      bindingPart(binding.recipientEmail, "Delivery recipient email"),
      bindingPart(binding.tokenRecordId, "Delivery token record id"),
      bindingPart(binding.installationId, "Delivery installation id"),
      expiryPart(expiresAt),
    );

    return appendLengthDelimited(parts);
  } finally {
    for (const part of parts) {
      part.fill(0);
    }
  }
};

const secretBytes = (secret: string): Uint8Array => {
  const encoded = utf8(secret);

  if (encoded.length < 1 || encoded.length > MAX_DELIVERY_SECRET_BYTES) {
    encoded.fill(0);
    throw new RangeError(
      `A delivery secret must encode to 1-${String(MAX_DELIVERY_SECRET_BYTES)} UTF-8 bytes.`,
    );
  }

  return encoded;
};

const isSupportedEnvelopeVersion = (value: number): value is 1 =>
  value === DELIVERY_SECRET_ENVELOPE_VERSION;

const parseEnvelope = (envelope: DeliverySecretEnvelope): DeliverySecretEnvelope => {
  try {
    if (!isSupportedEnvelopeVersion(envelope.envelopeVersion)) {
      throw invalidEnvelope();
    }

    validateKeyId(envelope.keyId);

    if (
      !(envelope.ciphertext instanceof Uint8Array) ||
      envelope.ciphertext.length < 1 ||
      envelope.ciphertext.length > MAX_DELIVERY_SECRET_BYTES
    ) {
      throw invalidEnvelope();
    }

    return {
      envelopeVersion: DELIVERY_SECRET_ENVELOPE_VERSION,
      keyId: envelope.keyId,
      nonce: copyExactBytes(
        envelope.nonce,
        DELIVERY_SECRET_ENVELOPE_NONCE_BYTES,
        "Delivery envelope nonce",
      ),
      ciphertext: new Uint8Array(envelope.ciphertext),
      authTag: copyExactBytes(
        envelope.authTag,
        DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES,
        "Delivery envelope authentication tag",
      ),
      expiresAt: new Date(envelope.expiresAt.getTime()),
    };
  } catch {
    throw invalidEnvelope();
  }
};

export class DeliverySecretEnvelopeService {
  readonly #activeKey: DeliverySecretKey;
  readonly #keys: ReadonlyMap<string, DeliverySecretKey>;

  public constructor(
    private readonly randomSource: RandomSource,
    keyring: DeliverySecretKeyringInput,
  ) {
    validateKeyId(keyring.activeKeyId);

    if (keyring.keys.length < 1 || keyring.keys.length > MAX_KEYRING_KEYS) {
      throw new RangeError(
        `Delivery envelope keyring must contain 1-${String(MAX_KEYRING_KEYS)} keys.`,
      );
    }

    const keys = new Map<string, DeliverySecretKey>();

    try {
      for (const input of keyring.keys) {
        validateKeyId(input.id);

        if (keys.has(input.id)) {
          throw new Error(`Duplicate delivery envelope key id: ${input.id}.`);
        }

        keys.set(input.id, {
          id: input.id,
          key: copyExactBytes(
            input.key,
            DELIVERY_SECRET_ENVELOPE_KEY_BYTES,
            "Delivery envelope key",
          ),
        });
      }

      const activeKey = keys.get(keyring.activeKeyId);

      if (activeKey === undefined) {
        throw new Error("Active delivery envelope key is not present in the keyring.");
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

  public get activeKeyId(): string {
    return this.#activeKey.id;
  }

  public get retainedKeyIds(): readonly string[] {
    return Object.freeze([...this.#keys.keys()].filter((id) => id !== this.#activeKey.id).sort());
  }

  public seal(
    secret: string,
    binding: DeliverySecretBinding,
    expiresAt: Date,
  ): DeliverySecretEnvelope {
    let plaintext: Uint8Array | undefined;
    let nonce: Uint8Array | undefined;
    let aad: Uint8Array | undefined;
    let encrypted: Buffer | undefined;
    let final: Buffer | undefined;

    try {
      plaintext = secretBytes(secret);
      nonce = requireRandomBytes(this.randomSource, DELIVERY_SECRET_ENVELOPE_NONCE_BYTES);
      aad = additionalAuthenticatedData(this.#activeKey.id, binding, expiresAt);

      const cipher = createCipheriv("aes-256-gcm", this.#activeKey.key, nonce, {
        authTagLength: DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES,
      });
      cipher.setAAD(aad, { plaintextLength: plaintext.length });
      encrypted = cipher.update(plaintext);
      final = cipher.final();

      const ciphertext = new Uint8Array(encrypted.length + final.length);
      ciphertext.set(encrypted);
      ciphertext.set(final, encrypted.length);

      return {
        envelopeVersion: DELIVERY_SECRET_ENVELOPE_VERSION,
        keyId: this.#activeKey.id,
        nonce: new Uint8Array(nonce),
        ciphertext,
        authTag: new Uint8Array(cipher.getAuthTag()),
        expiresAt: new Date(expiresAt.getTime()),
      };
    } finally {
      plaintext?.fill(0);
      nonce?.fill(0);
      aad?.fill(0);
      encrypted?.fill(0);
      final?.fill(0);
    }
  }

  public open(
    envelopeInput: DeliverySecretEnvelope,
    binding: DeliverySecretBinding,
    openedAt: Date,
  ): OpenedDeliverySecret {
    let envelope: DeliverySecretEnvelope | undefined;
    let aad: Uint8Array | undefined;
    let plaintext: Buffer | undefined;
    let final: Buffer | undefined;

    try {
      envelope = parseEnvelope(envelopeInput);

      if (this.isExpired(envelope, openedAt)) {
        throw invalidEnvelope();
      }

      const key = this.#keys.get(envelope.keyId);

      if (key === undefined) {
        throw invalidEnvelope();
      }

      aad = additionalAuthenticatedData(key.id, binding, envelope.expiresAt);

      const decipher = createDecipheriv("aes-256-gcm", key.key, envelope.nonce, {
        authTagLength: DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES,
      });
      decipher.setAAD(aad, { plaintextLength: envelope.ciphertext.length });
      decipher.setAuthTag(envelope.authTag);
      plaintext = decipher.update(envelope.ciphertext);
      final = decipher.final();

      const combined = Buffer.concat([plaintext, final]);

      try {
        /*
         * `parseEnvelope` already rejects an empty ciphertext, and AES-GCM
         * preserves plaintext length, so a decoded secret is always non-empty.
         */
        const secret = new TextDecoder("utf-8", { fatal: true }).decode(combined);

        return { secret, needsReencrypt: key.id !== this.#activeKey.id };
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

  public isExpired(envelope: Pick<DeliverySecretEnvelope, "expiresAt">, at: Date): boolean {
    const expiry = envelope.expiresAt.getTime();
    const now = at.getTime();

    if (!Number.isFinite(expiry) || !Number.isFinite(now)) {
      return true;
    }

    return now >= expiry;
  }
}
