import {
  assertNoDeterministicTestAdapters,
  createIdentityInstallation,
  DefaultIdentityPolicyProvider,
  isDeterministicTestAdapter,
  type IdentityClock,
  type IdentityDeliverySecretEnvelopeService,
  type IdentityDummyPasswordHash,
  type IdentityInstallation,
  type IdentityPasswordHasher,
  type IdentityPolicyProvider,
  type IdentityRecoveryCodeService,
  type IdentityTokenServices,
  type IdentityTotpSecretCipher,
  type IdentityTotpService,
  type IdentityUuidGenerator,
} from "@stockcontrol/module-identity";

import { HmacIdentityAuditIntegrity, type AuditIntegrityKeyInput } from "./audit-integrity.js";
import {
  DeliverySecretEnvelopeService,
  DELIVERY_SECRET_ENVELOPE_KEY_BYTES,
} from "./delivery-secret-envelope.js";
import { decodeBase64Url } from "./encoding.js";
import {
  ConfiguredDummyPasswordHash,
  IdentityDeliverySecretEnvelopeAdapter,
  IdentityRecoveryCodeServiceAdapter,
  IdentityTokenServiceRegistry,
  IdentityTotpSecretCipherAdapter,
  InstallationTotpService,
  NodeUuidGenerator,
} from "./identity-ports.js";
import { NodeCryptoArgon2idDeriver, NodeRandomSource, SystemClock } from "./node-adapters.js";
import { PasswordHashingService } from "./password.js";
import { RecoveryCodeService } from "./recovery-codes.js";
import { TotpService } from "./totp.js";
import {
  TotpSecretEncryptionService,
  TOTP_SECRET_ENCRYPTION_KEY_BYTES,
} from "./totp-secret-encryption.js";
import type { Argon2idDeriver, Clock, RandomSource } from "./ports.js";

/**
 * Production composition inputs for the Identity security adapters.
 *
 * Every value is read from the deployment environment and validated before the
 * application starts. No error raised here contains key material, a hash, a
 * token, or any other secret value: a mis-provisioned deployment must fail
 * loudly without writing a secret to a log or a crash report.
 */

export type IdentitySecurityEnvironment = Readonly<Record<string, string | undefined>>;

export type IdentitySecurityConfigurationErrorCode =
  "ValueMissing" | "ValueInvalid" | "KeyringInvalid" | "KeyMaterialInvalid" | "TestAdapterRejected";

export class IdentitySecurityConfigurationError extends Error {
  public constructor(
    public readonly code: IdentitySecurityConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentitySecurityConfigurationError";
  }
}

export interface IdentityKeyMaterial {
  readonly id: string;
  readonly key: Uint8Array;
}

export interface IdentityKeyring {
  readonly activeKeyId: string;
  readonly keys: readonly IdentityKeyMaterial[];
}

export interface IdentitySecurityConfiguration {
  readonly environmentName: "production" | "development" | "test";
  readonly installation: IdentityInstallation;
  readonly dummyPasswordHash: string;
  readonly totpEncryption: IdentityKeyring;
  readonly deliveryEnvelope: IdentityKeyring;
  readonly auditIntegrity: IdentityKeyring;
  readonly deliveryEnvelopeTtlSeconds: number;
}

export const MINIMUM_AUDIT_INTEGRITY_KEY_BYTES = 32;
export const MAXIMUM_AUDIT_INTEGRITY_KEY_BYTES = 128;
export const DEFAULT_DELIVERY_ENVELOPE_TTL_SECONDS = 60 * 60;
const MINIMUM_DELIVERY_ENVELOPE_TTL_SECONDS = 60;
const MAXIMUM_DELIVERY_ENVELOPE_TTL_SECONDS = 24 * 60 * 60;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAXIMUM_KEYRING_ENTRIES = 16;

const readRequired = (environment: IdentitySecurityEnvironment, name: string): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new IdentitySecurityConfigurationError("ValueMissing", `${name} is required.`);
  }

  return value;
};

const readTtlSeconds = (environment: IdentitySecurityEnvironment, name: string): number => {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    return DEFAULT_DELIVERY_ENVELOPE_TTL_SECONDS;
  }

  const parsed = Number(value);

  if (
    !/^[1-9]\d*$/u.test(value) ||
    !Number.isSafeInteger(parsed) ||
    parsed < MINIMUM_DELIVERY_ENVELOPE_TTL_SECONDS ||
    parsed > MAXIMUM_DELIVERY_ENVELOPE_TTL_SECONDS
  ) {
    throw new IdentitySecurityConfigurationError(
      "ValueInvalid",
      `${name} must be an integer between ${String(MINIMUM_DELIVERY_ENVELOPE_TTL_SECONDS)} and ${String(MAXIMUM_DELIVERY_ENVELOPE_TTL_SECONDS)} seconds.`,
    );
  }

  return parsed;
};

interface KeyringLimits {
  readonly minimumKeyBytes: number;
  readonly maximumKeyBytes: number;
}

/**
 * Parses `keyId:base64url-key` entries. Only the variable name and key
 * identifiers ever appear in an error; key material never does.
 */
const readKeyring = (
  environment: IdentitySecurityEnvironment,
  activeKeyIdName: string,
  keysName: string,
  limits: KeyringLimits,
): IdentityKeyring => {
  const activeKeyId = readRequired(environment, activeKeyIdName);

  if (!KEY_ID_PATTERN.test(activeKeyId)) {
    throw new IdentitySecurityConfigurationError(
      "ValueInvalid",
      `${activeKeyIdName} must be 1-64 URL-safe characters.`,
    );
  }

  const entries = readRequired(environment, keysName)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length < 1 || entries.length > MAXIMUM_KEYRING_ENTRIES) {
    throw new IdentitySecurityConfigurationError(
      "KeyringInvalid",
      `${keysName} must contain 1-${String(MAXIMUM_KEYRING_ENTRIES)} "keyId:key" entries.`,
    );
  }

  const keys: IdentityKeyMaterial[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");
    const id = separatorIndex === -1 ? "" : entry.slice(0, separatorIndex);
    const encodedKey = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);

    if (!KEY_ID_PATTERN.test(id)) {
      throw new IdentitySecurityConfigurationError(
        "KeyringInvalid",
        `${keysName} entries must be "keyId:key" with a 1-64 URL-safe key ID.`,
      );
    }

    if (seen.has(id)) {
      throw new IdentitySecurityConfigurationError(
        "KeyringInvalid",
        `${keysName} contains duplicate key ID "${id}".`,
      );
    }

    let key: Uint8Array;

    try {
      key = decodeBase64Url(encodedKey);
    } catch {
      throw new IdentitySecurityConfigurationError(
        "KeyMaterialInvalid",
        `${keysName} key "${id}" must be canonical base64url.`,
      );
    }

    if (key.length < limits.minimumKeyBytes || key.length > limits.maximumKeyBytes) {
      key.fill(0);
      throw new IdentitySecurityConfigurationError(
        "KeyMaterialInvalid",
        `${keysName} key "${id}" must contain ${String(limits.minimumKeyBytes)}-${String(limits.maximumKeyBytes)} bytes.`,
      );
    }

    seen.add(id);
    keys.push({ id, key });
  }

  if (!seen.has(activeKeyId)) {
    throw new IdentitySecurityConfigurationError(
      "KeyringInvalid",
      `${activeKeyIdName} "${activeKeyId}" is not present in ${keysName}.`,
    );
  }

  return { activeKeyId, keys };
};

const readEnvironmentName = (
  environment: IdentitySecurityEnvironment,
): IdentitySecurityConfiguration["environmentName"] => {
  const value = environment["NODE_ENV"]?.trim();

  if (value === undefined || value.length === 0 || value === "development") {
    return "development";
  }

  if (value === "production" || value === "test") {
    return value;
  }

  throw new IdentitySecurityConfigurationError(
    "ValueInvalid",
    "NODE_ENV must be production, development, or test.",
  );
};

export const loadIdentitySecurityConfiguration = (
  environment: IdentitySecurityEnvironment = process.env,
): IdentitySecurityConfiguration => ({
  environmentName: readEnvironmentName(environment),
  installation: createIdentityInstallation({
    installationId: readRequired(environment, "IDENTITY_INSTALLATION_ID"),
    displayName: readRequired(environment, "IDENTITY_INSTALLATION_NAME"),
    baseUrl: readRequired(environment, "IDENTITY_PUBLIC_BASE_URL"),
  }),
  dummyPasswordHash: readRequired(environment, "IDENTITY_DUMMY_PASSWORD_HASH"),
  totpEncryption: readKeyring(
    environment,
    "IDENTITY_TOTP_ENCRYPTION_ACTIVE_KEY_ID",
    "IDENTITY_TOTP_ENCRYPTION_KEYS",
    {
      minimumKeyBytes: TOTP_SECRET_ENCRYPTION_KEY_BYTES,
      maximumKeyBytes: TOTP_SECRET_ENCRYPTION_KEY_BYTES,
    },
  ),
  deliveryEnvelope: readKeyring(
    environment,
    "IDENTITY_DELIVERY_ENVELOPE_ACTIVE_KEY_ID",
    "IDENTITY_DELIVERY_ENVELOPE_KEYS",
    {
      minimumKeyBytes: DELIVERY_SECRET_ENVELOPE_KEY_BYTES,
      maximumKeyBytes: DELIVERY_SECRET_ENVELOPE_KEY_BYTES,
    },
  ),
  auditIntegrity: readKeyring(
    environment,
    "IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID",
    "IDENTITY_AUDIT_INTEGRITY_KEYS",
    {
      minimumKeyBytes: MINIMUM_AUDIT_INTEGRITY_KEY_BYTES,
      maximumKeyBytes: MAXIMUM_AUDIT_INTEGRITY_KEY_BYTES,
    },
  ),
  deliveryEnvelopeTtlSeconds: readTtlSeconds(environment, "IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS"),
});

/**
 * Test-only substitutions. Supplying any of them in a production environment
 * is a startup failure.
 */
export interface IdentitySecurityAdapterOverrides {
  readonly clock?: Clock;
  readonly randomSource?: RandomSource;
  readonly argon2?: Argon2idDeriver;
}

export interface IdentitySecurityAdapters {
  readonly clock: IdentityClock;
  readonly uuids: IdentityUuidGenerator;
  readonly passwords: IdentityPasswordHasher;
  readonly dummyPasswordHash: IdentityDummyPasswordHash;
  readonly tokens: IdentityTokenServices;
  readonly totp: IdentityTotpService;
  readonly totpSecrets: IdentityTotpSecretCipher;
  readonly recoveryCodes: IdentityRecoveryCodeService;
  readonly auditIntegrity: HmacIdentityAuditIntegrity;
  readonly deliveryEnvelopes: IdentityDeliverySecretEnvelopeService;
  readonly policy: IdentityPolicyProvider;
  readonly deliveryEnvelopeTtlSeconds: number;
}

const auditKeyring = (
  keyring: IdentityKeyring,
): { active: AuditIntegrityKeyInput; retained: readonly AuditIntegrityKeyInput[] } => {
  const active = keyring.keys.find(({ id }) => id === keyring.activeKeyId) as IdentityKeyMaterial;

  return {
    active,
    retained: keyring.keys.filter(({ id }) => id !== keyring.activeKeyId),
  };
};

const assertProductionOverrides = (
  configuration: IdentitySecurityConfiguration,
  overrides: IdentitySecurityAdapterOverrides,
): void => {
  const supplied = (["argon2", "clock", "randomSource"] as const).filter(
    (name) => overrides[name] !== undefined,
  );

  if (supplied.length === 0) {
    return;
  }

  if (configuration.environmentName === "production") {
    throw new IdentitySecurityConfigurationError(
      "TestAdapterRejected",
      `Substituted identity security adapters cannot run in production: ${supplied.join(", ")}.`,
    );
  }

  const marked = supplied.filter((name) => isDeterministicTestAdapter(overrides[name]));

  if (marked.length > 0 && configuration.environmentName !== "test") {
    throw new IdentitySecurityConfigurationError(
      "TestAdapterRejected",
      `Deterministic test adapters are only permitted in a test environment: ${marked.join(", ")}.`,
    );
  }
};

/**
 * Builds the production identity security adapters. The composed bundle is
 * checked for deterministic test doubles before it is returned.
 */
export const createIdentitySecurityAdapters = (
  configuration: IdentitySecurityConfiguration,
  overrides: IdentitySecurityAdapterOverrides = {},
): IdentitySecurityAdapters => {
  assertProductionOverrides(configuration, overrides);

  const clock = overrides.clock ?? new SystemClock();
  const randomSource = overrides.randomSource ?? new NodeRandomSource();
  const argon2 = overrides.argon2 ?? new NodeCryptoArgon2idDeriver();
  const passwords = new PasswordHashingService(randomSource, argon2);

  const adapters: IdentitySecurityAdapters = {
    clock,
    uuids: new NodeUuidGenerator(),
    passwords,
    dummyPasswordHash: new ConfiguredDummyPasswordHash(configuration.dummyPasswordHash),
    tokens: new IdentityTokenServiceRegistry(randomSource),
    totp: new InstallationTotpService(
      new TotpService(clock, randomSource),
      configuration.installation.displayName,
    ),
    totpSecrets: new IdentityTotpSecretCipherAdapter(
      new TotpSecretEncryptionService(randomSource, {
        activeKeyId: configuration.totpEncryption.activeKeyId,
        keys: configuration.totpEncryption.keys,
      }),
      configuration.totpEncryption.activeKeyId,
    ),
    recoveryCodes: new IdentityRecoveryCodeServiceAdapter(new RecoveryCodeService(randomSource)),
    auditIntegrity: new HmacIdentityAuditIntegrity(auditKeyring(configuration.auditIntegrity)),
    deliveryEnvelopes: new IdentityDeliverySecretEnvelopeAdapter(
      new DeliverySecretEnvelopeService(randomSource, {
        activeKeyId: configuration.deliveryEnvelope.activeKeyId,
        keys: configuration.deliveryEnvelope.keys,
      }),
    ),
    policy: new DefaultIdentityPolicyProvider(configuration.installation),
    deliveryEnvelopeTtlSeconds: configuration.deliveryEnvelopeTtlSeconds,
  };

  if (configuration.environmentName === "production") {
    assertNoDeterministicTestAdapters({ ...adapters });
  }

  return adapters;
};
