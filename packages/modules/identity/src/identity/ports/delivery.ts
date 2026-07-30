import type { NormalisedEmailAddress, UserId } from "../value-objects";
import { IdentityPortError } from "./security";

/**
 * Invitation and password-reset delivery.
 *
 * A raw invitation or reset link is a bearer credential. It must never enter a
 * log, an audit record, or a plaintext durable job payload, so the scheduling
 * side seals it inside a versioned AEAD envelope and the delivery handler
 * opens that envelope immediately before composing the message.
 */

export const DELIVERY_SECRET_ENVELOPE_VERSION = 1 as const;

export const identityDeliveryPurposes = ["InvitationLink", "PasswordResetLink"] as const;

export type IdentityDeliveryPurpose = (typeof identityDeliveryPurposes)[number];

const identityDeliveryPurposeSet = new Set<string>(identityDeliveryPurposes);

const BOUNDED_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

/**
 * Every field is authenticated as additional data. A sealed secret therefore
 * cannot be replayed under another purpose, job, recipient, token record, or
 * installation, and cannot be moved to a different envelope version.
 */
export interface IdentityDeliveryBinding {
  readonly purpose: IdentityDeliveryPurpose;
  /** The durable job that will deliver the message. */
  readonly jobId: string;
  readonly recipientUserId: UserId;
  readonly recipientEmail: NormalisedEmailAddress;
  /** The invitation or password-reset row this secret belongs to. */
  readonly tokenRecordId: string;
  readonly installationId: string;
}

export const createIdentityDeliveryBinding = (
  input: IdentityDeliveryBinding,
): IdentityDeliveryBinding => {
  if (!identityDeliveryPurposeSet.has(input.purpose)) {
    throw new IdentityPortError(
      "DeliveryBindingInvalid",
      "A delivery binding must name a supported delivery purpose.",
    );
  }

  for (const [name, value] of [
    ["job ID", input.jobId],
    ["recipient user ID", input.recipientUserId],
    ["token record ID", input.tokenRecordId],
    ["installation ID", input.installationId],
  ] as const) {
    if (!BOUNDED_IDENTIFIER_PATTERN.test(value)) {
      throw new IdentityPortError(
        "DeliveryBindingInvalid",
        `A delivery binding ${name} must contain 1-128 safe identifier characters.`,
      );
    }
  }

  if (input.recipientEmail.length < 3 || input.recipientEmail.length > 254) {
    throw new IdentityPortError(
      "DeliveryBindingInvalid",
      "A delivery binding recipient email must contain 3-254 characters.",
    );
  }

  return Object.freeze({ ...input });
};

/**
 * The persisted form of a sealed delivery secret. `keyId` and `expiresAt` are
 * external, non-secret fields so a maintenance job can select rows for
 * re-encryption or cleanup without opening them, and both are authenticated.
 */
export interface IdentityDeliverySecretEnvelope {
  readonly envelopeVersion: typeof DELIVERY_SECRET_ENVELOPE_VERSION;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authTag: Uint8Array;
  readonly expiresAt: Date;
}

export interface IdentityOpenedDeliverySecret {
  readonly secret: string;
  /** True when a retained rotation key opened the envelope. */
  readonly needsReencrypt: boolean;
}

/**
 * Implementations expose exactly one failure for an expired, tampered,
 * wrongly bound, corrupt, or unknown-key envelope so a handler cannot learn
 * which check failed.
 */
export interface IdentityDeliverySecretEnvelopeService {
  readonly activeKeyId: string;
  readonly retainedKeyIds: readonly string[];
  seal(
    secret: string,
    binding: IdentityDeliveryBinding,
    expiresAt: Date,
  ): IdentityDeliverySecretEnvelope;
  open(
    envelope: IdentityDeliverySecretEnvelope,
    binding: IdentityDeliveryBinding,
    openedAt: Date,
  ): IdentityOpenedDeliverySecret;
  isExpired(envelope: IdentityDeliverySecretEnvelope, at: Date): boolean;
}

export interface ExpiringDeliveryEnvelopeRecord {
  readonly expiresAt: Date;
}

export interface PartitionedDeliveryEnvelopes<Record extends ExpiringDeliveryEnvelopeRecord> {
  /** Safe to delete: the secret can no longer be opened. */
  readonly expired: readonly Record[];
  readonly retained: readonly Record[];
}

/**
 * Splits queued delivery records into the expired secrets a cleanup job may
 * delete and the records that must be retained. Retaining an expired envelope
 * keeps unopenable ciphertext alive and blocks retirement of its key.
 */
export const partitionExpiredDeliveryEnvelopes = <Record extends ExpiringDeliveryEnvelopeRecord>(
  records: readonly Record[],
  at: Date,
): PartitionedDeliveryEnvelopes<Record> => {
  const now = at.getTime();

  if (!Number.isFinite(now)) {
    throw new IdentityPortError(
      "DeliveryEnvelopeInvalid",
      "Delivery envelope cleanup requires a valid instant.",
    );
  }

  const expired: Record[] = [];
  const retained: Record[] = [];

  for (const record of records) {
    const expiresAt = record.expiresAt.getTime();

    if (!Number.isFinite(expiresAt)) {
      throw new IdentityPortError(
        "DeliveryEnvelopeInvalid",
        "A delivery envelope must carry a valid expiry instant.",
      );
    }

    if (expiresAt <= now) {
      expired.push(record);
    } else {
      retained.push(record);
    }
  }

  return Object.freeze({ expired: Object.freeze(expired), retained: Object.freeze(retained) });
};

/**
 * Keys still required to open unexpired envelopes. A rotation key may only be
 * retired once this returns without it.
 */
export const deliveryKeyIdsInUse = (
  envelopes: readonly Pick<IdentityDeliverySecretEnvelope, "keyId" | "expiresAt">[],
  at: Date,
): readonly string[] => {
  const now = at.getTime();

  if (!Number.isFinite(now)) {
    throw new IdentityPortError(
      "DeliveryEnvelopeInvalid",
      "Delivery key retirement requires a valid instant.",
    );
  }

  return Object.freeze(
    [
      ...new Set(
        envelopes
          .filter((envelope) => envelope.expiresAt.getTime() > now)
          .map(({ keyId }) => keyId),
      ),
    ].sort(),
  );
};

export interface IdentityDeliveryRequest {
  readonly jobId: string;
  readonly purpose: IdentityDeliveryPurpose;
  readonly recipientUserId: UserId;
  readonly recipientEmail: NormalisedEmailAddress;
  readonly tokenRecordId: string;
  readonly envelope: IdentityDeliverySecretEnvelope;
  readonly scheduledAt: Date;
}

/**
 * Schedules a delivery inside the caller's transaction. A failure to schedule
 * a required delivery must roll the whole command back, so implementations
 * never deliver eagerly and never swallow an error.
 */
export interface IdentityDeliveryScheduler {
  schedule(request: IdentityDeliveryRequest): Promise<void>;
}
