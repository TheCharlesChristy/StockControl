import {
  authenticationRateLimitScopes,
  createSha256Digest,
  type AuthenticationRateLimitScope,
  type IdentityAuditValue,
  type Sha256Digest,
} from "@stockcontrol/module-identity";
import type { JsonObject, JsonValue } from "@stockcontrol/platform-database";

export type IdentityPersistenceInputErrorCode =
  | "AuditChainInvalid"
  | "ByteLengthInvalid"
  | "CounterInvalid"
  | "DigestLengthInvalid"
  | "DateInvalid"
  | "EncryptionKeyInvalid"
  | "EncryptionVersionInvalid"
  | "IdentifierInvalid"
  | "IntegerInvalid"
  | "JsonInvalid"
  | "PasswordHashInvalid"
  | "ReasonInvalid"
  | "ScopeInvalid"
  | "SessionAssuranceInvalid";

export class IdentityPersistenceInputError extends Error {
  public constructor(
    public readonly code: IdentityPersistenceInputErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityPersistenceInputError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const knownRateLimitScopes = new Set<string>(authenticationRateLimitScopes);
const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

export const assertUuid = (value: string, field: string): string => {
  if (!uuidPattern.test(value)) {
    throw new IdentityPersistenceInputError("IdentifierInvalid", `${field} must be a UUID.`);
  }

  return value.toLowerCase();
};

export const assertValidDate = (value: Date, field: string): Date => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new IdentityPersistenceInputError("DateInvalid", `${field} must be a valid instant.`);
  }
  return new Date(value.getTime());
};

export const assertIntegerInRange = (
  value: number,
  minimum: number,
  maximum: number,
  field: string,
): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new IdentityPersistenceInputError(
      "IntegerInvalid",
      `${field} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return value;
};

export const assertLifetime = (
  startsAt: Date,
  expiresAt: Date,
  maximumSeconds: number,
  field: string,
): void => {
  const start = assertValidDate(startsAt, `${field} start`).getTime();
  const expiry = assertValidDate(expiresAt, `${field} expiry`).getTime();
  if (expiry <= start || expiry - start > maximumSeconds * 1_000) {
    throw new IdentityPersistenceInputError(
      "DateInvalid",
      `${field} must expire after its start and within ${String(maximumSeconds)} seconds.`,
    );
  }
};

export const assertSessionWindow = (
  issuedAt: Date,
  lastSeenAt: Date,
  idleExpiresAt: Date,
  absoluteExpiresAt: Date,
  reauthenticatedAt?: Date,
): void => {
  const issued = assertValidDate(issuedAt, "Session issue time").getTime();
  const lastSeen = assertValidDate(lastSeenAt, "Session activity time").getTime();
  const idleExpiry = assertValidDate(idleExpiresAt, "Session idle expiry").getTime();
  const absoluteExpiry = assertValidDate(absoluteExpiresAt, "Session absolute expiry").getTime();
  const reauthenticated =
    reauthenticatedAt === undefined
      ? undefined
      : assertValidDate(reauthenticatedAt, "Session reauthentication time").getTime();

  if (
    lastSeen < issued ||
    idleExpiry <= lastSeen ||
    absoluteExpiry < idleExpiry ||
    absoluteExpiry - issued > 43_200_000 ||
    idleExpiry - lastSeen > 7_200_000 ||
    (reauthenticated !== undefined && (reauthenticated < issued || reauthenticated > lastSeen))
  ) {
    throw new IdentityPersistenceInputError(
      "DateInvalid",
      "Session timestamps exceed the hard lifetime ceiling or are out of order.",
    );
  }
};

export const assertPasswordHash = (value: string): string => {
  if (
    value.length < 20 ||
    value.length > 500 ||
    !value.startsWith("$sc-argon2id$") ||
    hasControlCharacter(value)
  ) {
    throw new IdentityPersistenceInputError(
      "PasswordHashInvalid",
      "Password hash must use the bounded StockControl Argon2id encoding.",
    );
  }
  return value;
};

export const assertBoundedText = (value: string, maximumLength: number, field: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > maximumLength || hasControlCharacter(trimmed)) {
    throw new IdentityPersistenceInputError(
      "ReasonInvalid",
      `${field} must contain 1 to ${String(maximumLength)} non-control characters.`,
    );
  }
  return trimmed;
};

export const assertCorrelationId = (value: string): string => {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
    throw new IdentityPersistenceInputError(
      "ReasonInvalid",
      "Correlation ID must contain 1 to 128 safe identifier characters.",
    );
  }
  return value;
};

export const assertRateLimitScope = (value: string): AuthenticationRateLimitScope => {
  if (!knownRateLimitScopes.has(value)) {
    throw new IdentityPersistenceInputError(
      "ScopeInvalid",
      "Authentication rate-limit scope is not supported.",
    );
  }
  return value as AuthenticationRateLimitScope;
};

export const digestBytes = (value: Uint8Array, field: string): Sha256Digest => {
  try {
    return createSha256Digest(value);
  } catch {
    throw new IdentityPersistenceInputError(
      "DigestLengthInvalid",
      `${field} must be a 32-byte SHA-256 digest.`,
    );
  }
};

export const minimumBytes = (
  value: Uint8Array,
  minimumLength: number,
  field: string,
): Uint8Array => {
  if (value.byteLength < minimumLength) {
    throw new IdentityPersistenceInputError(
      "ByteLengthInvalid",
      `${field} must contain at least ${String(minimumLength)} bytes.`,
    );
  }

  return Uint8Array.from(value);
};

export const exactBytes = (
  value: Uint8Array,
  expectedLength: number,
  field: string,
): Uint8Array => {
  if (value.byteLength !== expectedLength) {
    throw new IdentityPersistenceInputError(
      "ByteLengthInvalid",
      `${field} must contain exactly ${String(expectedLength)} bytes.`,
    );
  }

  return Uint8Array.from(value);
};

export const nonnegativeCounter = (value: bigint, field: string): string => {
  if (value < 0n) {
    throw new IdentityPersistenceInputError("CounterInvalid", `${field} cannot be negative.`);
  }

  if (value > 9_223_372_036_854_775_807n) {
    throw new IdentityPersistenceInputError(
      "CounterInvalid",
      `${field} must fit a PostgreSQL bigint.`,
    );
  }

  return value.toString();
};

export const encryptionKeyId = (value: string): string => {
  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > 100) {
    throw new IdentityPersistenceInputError(
      "EncryptionKeyInvalid",
      "The encryption key ID must contain 1 to 100 characters.",
    );
  }

  return trimmed;
};

export const optionalDigestBytes = (
  value: Sha256Digest | undefined,
  field: string,
): Sha256Digest | null => (value === undefined ? null : digestBytes(value, field));

export const nullableDate = (value: Date | undefined): Date | null => value ?? null;

export const optionalDate = (value: Date | null): Date | undefined => value ?? undefined;

export const nullableString = (value: string | undefined): string | null => value ?? null;

export const optionalString = (value: string | null): string | undefined => value ?? undefined;

export const assertReason = (reason: string): string => {
  return assertBoundedText(reason, 200, "A session revocation reason");
};

export const assertSessionAssurance = (
  authenticationMethod: string,
  assuranceLevel: string,
): void => {
  const valid =
    (authenticationMethod === "Password" && assuranceLevel === "SingleFactor") ||
    ((authenticationMethod === "PasswordAndTotp" ||
      authenticationMethod === "PasswordAndRecoveryCode") &&
      assuranceLevel === "MultiFactor");

  if (!valid) {
    throw new IdentityPersistenceInputError(
      "SessionAssuranceInvalid",
      "The session assurance level does not match its authentication method.",
    );
  }
};

const toJsonValue = (value: IdentityAuditValue, depth: number): JsonValue => {
  if (depth > 32) {
    throw new IdentityPersistenceInputError(
      "JsonInvalid",
      "Identity context exceeds the supported nesting depth.",
    );
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    const arrayValue = value as readonly IdentityAuditValue[];
    if (arrayValue.length > 1_000) {
      throw new IdentityPersistenceInputError(
        "JsonInvalid",
        "Identity context arrays cannot exceed 1000 entries.",
      );
    }
    return arrayValue.map((entry) => toJsonValue(entry, depth + 1));
  }
  const entries = Object.entries(value as Readonly<Record<string, IdentityAuditValue>>);
  if (entries.length > 1_000) {
    throw new IdentityPersistenceInputError(
      "JsonInvalid",
      "Identity context objects cannot exceed 1000 entries.",
    );
  }
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (key.length < 1 || key.length > 200 || hasControlCharacter(key)) {
        throw new IdentityPersistenceInputError(
          "JsonInvalid",
          "Identity context keys must contain 1-200 non-control characters.",
        );
      }
      return [key, toJsonValue(entry, depth + 1)];
    }),
  );
};

export const identityContextJson = (
  value: Readonly<Record<string, IdentityAuditValue>>,
): JsonObject => toJsonValue(value, 0) as JsonObject;
