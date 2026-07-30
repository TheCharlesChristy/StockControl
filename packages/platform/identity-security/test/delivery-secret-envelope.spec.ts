import { describe, expect, it } from "vitest";

import {
  DeliverySecretEnvelopeService,
  DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES,
  DELIVERY_SECRET_ENVELOPE_KEY_BYTES,
  DELIVERY_SECRET_ENVELOPE_NONCE_BYTES,
  InvalidDeliverySecretEnvelopeError,
  MAX_DELIVERY_SECRET_BYTES,
  type DeliverySecretBinding,
  type DeliverySecretEnvelope,
} from "../src/index.js";
import { IncrementingRandomSource } from "./helpers.js";

const key = (seed: number): Uint8Array =>
  Uint8Array.from(
    { length: DELIVERY_SECRET_ENVELOPE_KEY_BYTES },
    (_, index) => (seed + index) & 255,
  );

const binding: DeliverySecretBinding = {
  purpose: "InvitationLink",
  jobId: "job-1",
  recipientUserId: "11111111-1111-4111-8111-111111111111",
  recipientEmail: "sam@acme.test",
  tokenRecordId: "invitation-1",
  installationId: "acme-yard",
};

const secret = "https://stock.acme.test/invitations/accept?token=raw-token-value";
const expiresAt = new Date("2026-07-30T10:00:00.000Z");
const beforeExpiry = new Date("2026-07-30T09:30:00.000Z");

const service = (
  activeKeyId = "delivery-1",
  keys: readonly { id: string; key: Uint8Array }[] = [{ id: "delivery-1", key: key(1) }],
): DeliverySecretEnvelopeService =>
  new DeliverySecretEnvelopeService(new IncrementingRandomSource(), { activeKeyId, keys });

describe("delivery secret envelope keyring", () => {
  it("publishes the active key and sorted retained keys", () => {
    const envelopes = service("delivery-2", [
      { id: "delivery-2", key: key(2) },
      { id: "delivery-9", key: key(9) },
      { id: "delivery-1", key: key(1) },
    ]);

    expect(envelopes.activeKeyId).toBe("delivery-2");
    expect(envelopes.retainedKeyIds).toEqual(["delivery-1", "delivery-9"]);
    expect(Object.isFrozen(envelopes.retainedKeyIds)).toBe(true);
  });

  it.each([
    ["an unsafe active key ID", "delivery key", [{ id: "delivery-1", key: key(1) }]],
    ["an unsafe entry key ID", "delivery-1", [{ id: "delivery key", key: key(1) }]],
  ])("rejects %s", (_label, activeKeyId, keys) => {
    expect(() => service(activeKeyId, keys)).toThrowError(RangeError);
  });

  it("rejects an empty keyring", () => {
    expect(() => service("delivery-1", [])).toThrowError(/1-16 keys/u);
  });

  it("rejects a keyring larger than the supported maximum", () => {
    const keys = Array.from({ length: 17 }, (_, index) => ({
      id: `delivery-${String(index)}`,
      key: key(index),
    }));

    expect(() => service("delivery-1", keys)).toThrowError(/1-16 keys/u);
  });

  it("rejects a duplicate key ID", () => {
    expect(() =>
      service("delivery-1", [
        { id: "delivery-1", key: key(1) },
        { id: "delivery-1", key: key(2) },
      ]),
    ).toThrowError(/Duplicate delivery envelope key id/u);
  });

  it.each([
    ["short", new Uint8Array(31)],
    ["long", new Uint8Array(33)],
    ["not a byte array", [1, 2, 3] as unknown as Uint8Array],
  ])("rejects a %s key", (_label, invalidKey) => {
    expect(() => service("delivery-1", [{ id: "delivery-1", key: invalidKey }])).toThrowError(
      RangeError,
    );
  });

  it("rejects an active key that is absent from the keyring", () => {
    expect(() => service("delivery-2", [{ id: "delivery-1", key: key(1) }])).toThrowError(
      /Active delivery envelope key is not present/u,
    );
  });
});

describe("sealing a delivery secret", () => {
  it("produces an openable envelope bound to the delivery facts", () => {
    const envelopes = service();
    const envelope = envelopes.seal(secret, binding, expiresAt);

    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.keyId).toBe("delivery-1");
    expect(envelope.nonce).toHaveLength(DELIVERY_SECRET_ENVELOPE_NONCE_BYTES);
    expect(envelope.authTag).toHaveLength(DELIVERY_SECRET_ENVELOPE_AUTH_TAG_BYTES);
    expect(envelope.expiresAt.toISOString()).toBe(expiresAt.toISOString());
    expect(new TextDecoder().decode(envelope.ciphertext)).not.toContain("raw-token-value");
    expect(envelopes.open(envelope, binding, beforeExpiry)).toEqual({
      secret,
      needsReencrypt: false,
    });
  });

  it("uses a fresh nonce so the same secret never produces the same ciphertext", () => {
    const envelopes = service();
    const first = envelopes.seal(secret, binding, expiresAt);
    const second = envelopes.seal(secret, binding, expiresAt);

    expect([...first.nonce]).not.toEqual([...second.nonce]);
    expect([...first.ciphertext]).not.toEqual([...second.ciphertext]);
    expect([...first.authTag]).not.toEqual([...second.authTag]);
  });

  it("copies the expiry so a later mutation cannot extend the sealed lifetime", () => {
    const envelopes = service();
    const mutable = new Date(expiresAt);
    const envelope = envelopes.seal(secret, binding, mutable);
    mutable.setUTCFullYear(2030);

    expect(envelope.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  it("seals a secret at the maximum supported length", () => {
    const envelopes = service();
    const longest = "a".repeat(MAX_DELIVERY_SECRET_BYTES);

    expect(
      envelopes.open(envelopes.seal(longest, binding, expiresAt), binding, beforeExpiry),
    ).toEqual({ secret: longest, needsReencrypt: false });
  });

  it.each([
    ["empty", ""],
    ["over-long", "a".repeat(MAX_DELIVERY_SECRET_BYTES + 1)],
  ])("rejects a %s secret", (_label, invalidSecret) => {
    expect(() => service().seal(invalidSecret, binding, expiresAt)).toThrowError(RangeError);
  });

  it.each([
    ["empty", { jobId: "" }],
    ["untrimmed", { jobId: " job-1 " }],
    ["control character bearing", { tokenRecordId: "invitation\n1" }],
    ["over-long", { installationId: "a".repeat(257) }],
    ["multi-byte over-long", { recipientEmail: `${"é".repeat(200)}@acme.test` }],
  ])("rejects a %s binding value", (_label, override) => {
    expect(() => service().seal(secret, { ...binding, ...override }, expiresAt)).toThrowError(
      RangeError,
    );
  });

  it("rejects an invalid expiry instant", () => {
    expect(() => service().seal(secret, binding, new Date("not-a-date"))).toThrowError(RangeError);
  });
});

describe("opening a delivery secret", () => {
  const sealed = (): {
    envelopes: DeliverySecretEnvelopeService;
    envelope: DeliverySecretEnvelope;
  } => {
    const envelopes = service();
    return { envelopes, envelope: envelopes.seal(secret, binding, expiresAt) };
  };

  it.each([
    ["purpose", { purpose: "PasswordResetLink" }],
    ["job", { jobId: "job-2" }],
    ["recipient user", { recipientUserId: "22222222-2222-4222-8222-222222222222" }],
    ["recipient email", { recipientEmail: "mallory@acme.test" }],
    ["token record", { tokenRecordId: "invitation-2" }],
    ["installation", { installationId: "other-yard" }],
  ])("refuses a substituted %s", (_label, override) => {
    const { envelopes, envelope } = sealed();

    expect(() => envelopes.open(envelope, { ...binding, ...override }, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });

  it("refuses a substituted expiry", () => {
    const { envelopes, envelope } = sealed();

    expect(() =>
      envelopes.open(
        { ...envelope, expiresAt: new Date("2026-08-30T10:00:00.000Z") },
        binding,
        beforeExpiry,
      ),
    ).toThrowError(InvalidDeliverySecretEnvelopeError);
  });

  it("refuses a tampered ciphertext or authentication tag", () => {
    const { envelopes, envelope } = sealed();
    const ciphertext = Uint8Array.from(envelope.ciphertext);
    ciphertext[0] = (ciphertext[0] as number) ^ 0xff;
    const authTag = Uint8Array.from(envelope.authTag);
    authTag[0] = (authTag[0] as number) ^ 0xff;

    expect(() => envelopes.open({ ...envelope, ciphertext }, binding, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
    expect(() => envelopes.open({ ...envelope, authTag }, binding, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });

  it.each([
    ["an unsupported version", { envelopeVersion: 2 as unknown as 1 }],
    ["an unsafe key ID", { keyId: "delivery key" }],
    ["a short nonce", { nonce: new Uint8Array(11) }],
    ["a short authentication tag", { authTag: new Uint8Array(15) }],
    ["an empty ciphertext", { ciphertext: new Uint8Array(0) }],
    ["an over-long ciphertext", { ciphertext: new Uint8Array(MAX_DELIVERY_SECRET_BYTES + 1) }],
    ["a non-array ciphertext", { ciphertext: "ciphertext" as unknown as Uint8Array }],
  ])("refuses %s", (_label, override) => {
    const { envelopes, envelope } = sealed();

    expect(() => envelopes.open({ ...envelope, ...override }, binding, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });

  it("refuses an envelope sealed under a key that is no longer held", () => {
    const { envelope } = sealed();
    const rotated = service("delivery-2", [{ id: "delivery-2", key: key(2) }]);

    expect(() => rotated.open(envelope, binding, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });

  it("refuses an invalid binding without revealing which check failed", () => {
    const { envelopes, envelope } = sealed();
    let thrown: unknown;

    try {
      envelopes.open(envelope, { ...binding, jobId: "" }, beforeExpiry);
    } catch (error: unknown) {
      thrown = error;
    }

    expect((thrown as Error).message).toBe(
      "The delivery secret envelope is invalid or cannot be authenticated.",
    );
  });

  it("never reveals the secret in the failure message", () => {
    const { envelopes, envelope } = sealed();
    let thrown: unknown;

    try {
      envelopes.open(envelope, { ...binding, jobId: "job-2" }, beforeExpiry);
    } catch (error: unknown) {
      thrown = error;
    }

    expect((thrown as Error).message).not.toContain("raw-token-value");
    expect(JSON.stringify(thrown)).not.toContain("raw-token-value");
  });
});

describe("delivery secret expiry", () => {
  it("treats the envelope as expired at and after its expiry instant", () => {
    const envelopes = service();
    const envelope = envelopes.seal(secret, binding, expiresAt);

    expect(envelopes.isExpired(envelope, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(envelopes.isExpired(envelope, expiresAt)).toBe(true);
    expect(envelopes.isExpired(envelope, new Date(expiresAt.getTime() + 1))).toBe(true);
  });

  it("refuses to open an expired envelope", () => {
    const envelopes = service();
    const envelope = envelopes.seal(secret, binding, expiresAt);

    expect(() => envelopes.open(envelope, binding, expiresAt)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });

  it.each([
    ["an invalid current instant", new Date("2026-07-30T10:00:00.000Z"), new Date("not-a-date")],
    ["an invalid expiry", new Date("not-a-date"), beforeExpiry],
  ])("treats %s as expired", (_label, envelopeExpiry, at) => {
    expect(service().isExpired({ expiresAt: envelopeExpiry }, at)).toBe(true);
  });
});

describe("rotating delivery envelope keys", () => {
  it("opens a retained-key envelope and reports that it needs re-encryption", () => {
    const previous = service("delivery-1", [{ id: "delivery-1", key: key(1) }]);
    const envelope = previous.seal(secret, binding, expiresAt);
    const rotated = service("delivery-2", [
      { id: "delivery-2", key: key(2) },
      { id: "delivery-1", key: key(1) },
    ]);

    const opened = rotated.open(envelope, binding, beforeExpiry);

    expect(opened).toEqual({ secret, needsReencrypt: true });

    const resealed = rotated.seal(opened.secret, binding, expiresAt);

    expect(resealed.keyId).toBe("delivery-2");
    expect(rotated.open(resealed, binding, beforeExpiry).needsReencrypt).toBe(false);
  });

  it("cannot open a retained-key envelope once that key is retired", () => {
    const previous = service("delivery-1", [{ id: "delivery-1", key: key(1) }]);
    const envelope = previous.seal(secret, binding, expiresAt);
    const retired = service("delivery-2", [{ id: "delivery-2", key: key(2) }]);

    expect(() => retired.open(envelope, binding, beforeExpiry)).toThrowError(
      InvalidDeliverySecretEnvelopeError,
    );
  });
});
