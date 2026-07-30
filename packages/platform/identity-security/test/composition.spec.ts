import { describe, expect, it } from "vitest";

import {
  deterministicTestAdapter,
  normaliseEmailAddress,
  userId,
  type IdentityApplicationPorts,
  type IdentityDeliveryBinding,
} from "@stockcontrol/module-identity";

import {
  createIdentitySecurityAdapters,
  DEFAULT_DELIVERY_ENVELOPE_TTL_SECONDS,
  IdentitySecurityConfigurationError,
  loadIdentitySecurityConfiguration,
  type IdentitySecurityConfiguration,
  type IdentitySecurityEnvironment,
} from "../src/index.js";
import { DeterministicArgon2idDeriver, FixedClock, IncrementingRandomSource } from "./helpers.js";

const base64Key = (byte: number, length = 32): string =>
  Buffer.from(Uint8Array.from({ length }, () => byte)).toString("base64url");

const TOTP_KEY = base64Key(1);
const DELIVERY_KEY = base64Key(2);
const AUDIT_KEY = base64Key(3);
const DUMMY_HASH = `$sc-argon2id$v=1$a=19,m=65536,t=3,p=1,l=32$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(32).toString("base64url")}`;

const validEnvironment: IdentitySecurityEnvironment = Object.freeze({
  NODE_ENV: "production",
  IDENTITY_INSTALLATION_ID: "acme-yard",
  IDENTITY_INSTALLATION_NAME: "Acme Electrical",
  IDENTITY_PUBLIC_BASE_URL: "https://stock.acme.test",
  IDENTITY_DUMMY_PASSWORD_HASH: DUMMY_HASH,
  IDENTITY_TOTP_ENCRYPTION_ACTIVE_KEY_ID: "totp-1",
  IDENTITY_TOTP_ENCRYPTION_KEYS: `totp-1:${TOTP_KEY}`,
  IDENTITY_DELIVERY_ENVELOPE_ACTIVE_KEY_ID: "delivery-1",
  IDENTITY_DELIVERY_ENVELOPE_KEYS: `delivery-1:${DELIVERY_KEY}`,
  IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID: "audit-1",
  IDENTITY_AUDIT_INTEGRITY_KEYS: `audit-1:${AUDIT_KEY}`,
});

const environmentWith = (
  overrides: Readonly<Record<string, string | undefined>>,
): IdentitySecurityEnvironment => ({ ...validEnvironment, ...overrides });

const configuration = (
  overrides: Readonly<Record<string, string | undefined>> = {},
): IdentitySecurityConfiguration => loadIdentitySecurityConfiguration(environmentWith(overrides));

const configurationError = (
  overrides: Readonly<Record<string, string | undefined>>,
): IdentitySecurityConfigurationError => {
  try {
    loadIdentitySecurityConfiguration(environmentWith(overrides));
  } catch (error: unknown) {
    return error as IdentitySecurityConfigurationError;
  }

  throw new Error("Expected the configuration to be rejected.");
};

describe("loading identity security configuration", () => {
  it("accepts a fully provisioned production environment", () => {
    const loaded = configuration();

    expect(loaded.environmentName).toBe("production");
    expect(loaded.installation).toEqual({
      installationId: "acme-yard",
      displayName: "Acme Electrical",
      baseUrl: "https://stock.acme.test",
    });
    expect(loaded.dummyPasswordHash).toBe(DUMMY_HASH);
    expect(loaded.totpEncryption.activeKeyId).toBe("totp-1");
    expect(loaded.deliveryEnvelope.keys).toHaveLength(1);
    expect(loaded.auditIntegrity.keys[0]?.key).toHaveLength(32);
    expect(loaded.deliveryEnvelopeTtlSeconds).toBe(DEFAULT_DELIVERY_ENVELOPE_TTL_SECONDS);
  });

  it("reads the environment by default", () => {
    expect(() => loadIdentitySecurityConfiguration()).toThrowError(
      IdentitySecurityConfigurationError,
    );
  });

  it.each([
    ["IDENTITY_INSTALLATION_ID"],
    ["IDENTITY_INSTALLATION_NAME"],
    ["IDENTITY_PUBLIC_BASE_URL"],
    ["IDENTITY_DUMMY_PASSWORD_HASH"],
    ["IDENTITY_TOTP_ENCRYPTION_ACTIVE_KEY_ID"],
    ["IDENTITY_TOTP_ENCRYPTION_KEYS"],
    ["IDENTITY_DELIVERY_ENVELOPE_ACTIVE_KEY_ID"],
    ["IDENTITY_DELIVERY_ENVELOPE_KEYS"],
    ["IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID"],
    ["IDENTITY_AUDIT_INTEGRITY_KEYS"],
  ])("rejects a deployment missing %s", (name) => {
    const missing = configurationError({ [name]: undefined });
    const blank = configurationError({ [name]: "   " });

    expect(missing.code).toBe("ValueMissing");
    expect(missing.message).toBe(`${name} is required.`);
    expect(blank.code).toBe("ValueMissing");
  });

  it("rejects an installation the identity module considers invalid", () => {
    expect(() =>
      loadIdentitySecurityConfiguration(
        environmentWith({ IDENTITY_PUBLIC_BASE_URL: "http://stock.acme.test" }),
      ),
    ).toThrowError(expect.objectContaining({ code: "InstallationInvalid" }));
  });

  it.each([
    ["production", "production"],
    ["test", "test"],
  ] as const)("recognises the %s environment", (_label, value) => {
    expect(configuration({ NODE_ENV: value }).environmentName).toBe(value);
  });

  it.each([
    ["absent", undefined],
    ["blank", "  "],
    ["development", "development"],
  ])("treats a %s NODE_ENV as development", (_label, value) => {
    expect(configuration({ NODE_ENV: value }).environmentName).toBe("development");
  });

  it("rejects an unrecognised NODE_ENV", () => {
    const error = configurationError({ NODE_ENV: "staging" });

    expect(error.code).toBe("ValueInvalid");
    expect(error.message).toBe("NODE_ENV must be production, development, or test.");
  });
});

describe("keyring configuration", () => {
  it("accepts an active key with retained rotation keys", () => {
    const loaded = configuration({
      IDENTITY_DELIVERY_ENVELOPE_ACTIVE_KEY_ID: "delivery-2",
      IDENTITY_DELIVERY_ENVELOPE_KEYS: ` delivery-2:${DELIVERY_KEY} , delivery-1:${base64Key(4)} `,
    });

    expect(loaded.deliveryEnvelope.keys.map(({ id }) => id)).toEqual(["delivery-2", "delivery-1"]);
  });

  it("rejects an unsafe active key ID", () => {
    const error = configurationError({ IDENTITY_TOTP_ENCRYPTION_ACTIVE_KEY_ID: "totp key" });

    expect(error.code).toBe("ValueInvalid");
    expect(error.message).toBe(
      "IDENTITY_TOTP_ENCRYPTION_ACTIVE_KEY_ID must be 1-64 URL-safe characters.",
    );
  });

  it("rejects an active key that is unknown to the keyring", () => {
    const error = configurationError({
      IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID: "audit-9",
    });

    expect(error.code).toBe("KeyringInvalid");
    expect(error.message).toContain('"audit-9" is not present in IDENTITY_AUDIT_INTEGRITY_KEYS');
  });

  it("rejects a keyring with no usable entries", () => {
    const error = configurationError({ IDENTITY_DELIVERY_ENVELOPE_KEYS: " , , " });

    expect(error.code).toBe("KeyringInvalid");
  });

  it("rejects a keyring beyond the supported maximum", () => {
    const entries = Array.from(
      { length: 17 },
      (_, index) => `delivery-${String(index)}:${base64Key(index + 1)}`,
    ).join(",");
    const error = configurationError({ IDENTITY_DELIVERY_ENVELOPE_KEYS: entries });

    expect(error.code).toBe("KeyringInvalid");
    expect(error.message).toContain("1-16");
  });

  it.each([
    ["without a separator", DELIVERY_KEY],
    ["with an empty key ID", `:${DELIVERY_KEY}`],
    ["with an unsafe key ID", `delivery key:${DELIVERY_KEY}`],
  ])("rejects an entry %s", (_label, entry) => {
    const error = configurationError({ IDENTITY_DELIVERY_ENVELOPE_KEYS: entry });

    expect(error.code).toBe("KeyringInvalid");
    expect(error.message).toContain('must be "keyId:key"');
  });

  it("rejects a duplicate key ID", () => {
    const error = configurationError({
      IDENTITY_DELIVERY_ENVELOPE_KEYS: `delivery-1:${DELIVERY_KEY},delivery-1:${base64Key(5)}`,
    });

    expect(error.code).toBe("KeyringInvalid");
    expect(error.message).toContain('duplicate key ID "delivery-1"');
  });

  it("rejects key material that is not canonical base64url", () => {
    const error = configurationError({
      IDENTITY_DELIVERY_ENVELOPE_KEYS: "delivery-1:not+valid/base64url==",
    });

    expect(error.code).toBe("KeyMaterialInvalid");
    expect(error.message).toBe(
      'IDENTITY_DELIVERY_ENVELOPE_KEYS key "delivery-1" must be canonical base64url.',
    );
  });

  it.each([
    ["a short TOTP key", "IDENTITY_TOTP_ENCRYPTION_KEYS", `totp-1:${base64Key(1, 31)}`, "32-32"],
    ["a long TOTP key", "IDENTITY_TOTP_ENCRYPTION_KEYS", `totp-1:${base64Key(1, 33)}`, "32-32"],
    [
      "a short delivery key",
      "IDENTITY_DELIVERY_ENVELOPE_KEYS",
      `delivery-1:${base64Key(2, 16)}`,
      "32-32",
    ],
    ["a short audit key", "IDENTITY_AUDIT_INTEGRITY_KEYS", `audit-1:${base64Key(3, 31)}`, "32-128"],
    ["a long audit key", "IDENTITY_AUDIT_INTEGRITY_KEYS", `audit-1:${base64Key(3, 129)}`, "32-128"],
  ])("rejects %s", (_label, name, value, expectedRange) => {
    const error = configurationError({ [name]: value });

    expect(error.code).toBe("KeyMaterialInvalid");
    expect(error.message).toContain(`must contain ${expectedRange} bytes`);
  });

  it("accepts an audit key at the maximum supported length", () => {
    expect(
      configuration({ IDENTITY_AUDIT_INTEGRITY_KEYS: `audit-1:${base64Key(3, 128)}` })
        .auditIntegrity.keys[0]?.key,
    ).toHaveLength(128);
  });

  it("never includes key material in a configuration failure", () => {
    for (const error of [
      configurationError({ IDENTITY_TOTP_ENCRYPTION_KEYS: `totp-1:${base64Key(1, 31)}` }),
      configurationError({
        IDENTITY_DELIVERY_ENVELOPE_KEYS: `delivery-1:${DELIVERY_KEY},delivery-1:${DELIVERY_KEY}`,
      }),
      configurationError({ IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID: "audit-9" }),
    ]) {
      expect(error.message).not.toContain(TOTP_KEY);
      expect(error.message).not.toContain(DELIVERY_KEY);
      expect(error.message).not.toContain(AUDIT_KEY);
      expect(error.message).not.toContain(DUMMY_HASH);
      expect(JSON.stringify(error)).not.toContain(DELIVERY_KEY);
    }
  });
});

describe("delivery envelope lifetime configuration", () => {
  it("accepts a configured lifetime", () => {
    expect(
      configuration({ IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS: "1800" }).deliveryEnvelopeTtlSeconds,
    ).toBe(1_800);
  });

  it.each([
    ["blank", "   "],
    ["absent", undefined],
  ])("falls back to the default lifetime when %s", (_label, value) => {
    expect(
      configuration({ IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS: value }).deliveryEnvelopeTtlSeconds,
    ).toBe(DEFAULT_DELIVERY_ENVELOPE_TTL_SECONDS);
  });

  it.each([
    ["not an integer", "sixty"],
    ["zero", "0"],
    ["negative", "-60"],
    ["fractional", "60.5"],
    ["below the minimum", "59"],
    ["above the maximum", "86401"],
  ])("rejects a %s lifetime", (_label, value) => {
    const error = configurationError({ IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS: value });

    expect(error.code).toBe("ValueInvalid");
    expect(error.message).toContain("IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS");
  });

  it.each([
    ["the minimum", "60"],
    ["the maximum", "86400"],
  ])("accepts %s supported lifetime", (_label, value) => {
    expect(
      configuration({ IDENTITY_DELIVERY_ENVELOPE_TTL_SECONDS: value }).deliveryEnvelopeTtlSeconds,
    ).toBe(Number(value));
  });
});

describe("composing production adapters", () => {
  it("builds every adapter from real Node implementations", () => {
    const adapters = createIdentitySecurityAdapters(configuration());
    const bundle: Partial<IdentityApplicationPorts> = adapters;

    expect(Object.keys(bundle).sort()).toEqual([
      "auditIntegrity",
      "clock",
      "deliveryEnvelopeTtlSeconds",
      "deliveryEnvelopes",
      "dummyPasswordHash",
      "passwords",
      "policy",
      "recoveryCodes",
      "tokens",
      "totp",
      "totpSecrets",
      "uuids",
    ]);
    expect(adapters.clock.now()).toBeInstanceOf(Date);
    expect(adapters.dummyPasswordHash.get()).toBe(DUMMY_HASH);
    expect(adapters.totpSecrets.activeKeyId).toBe("totp-1");
    expect(adapters.deliveryEnvelopes.activeKeyId).toBe("delivery-1");
    expect(adapters.deliveryEnvelopes.retainedKeyIds).toEqual([]);
    expect(adapters.policy.installation().displayName).toBe("Acme Electrical");
    expect(adapters.tokens.for("Invitation").purpose).toBe("Invitation");
    expect(adapters.totp.issueEnrolment("sam@acme.test").provisioningUri).toContain(
      "issuer=Acme+Electrical",
    );
    expect(adapters.recoveryCodes.issue().codes).toHaveLength(10);
    expect(adapters.uuids.next()).not.toBe(adapters.uuids.next());
  });

  it("seals a delivery secret that only the composed adapter can open", () => {
    const adapters = createIdentitySecurityAdapters(configuration());
    const binding: IdentityDeliveryBinding = {
      purpose: "PasswordResetLink",
      jobId: "job-1",
      recipientUserId: userId("11111111-1111-4111-8111-111111111111"),
      recipientEmail: normaliseEmailAddress("sam@acme.test"),
      tokenRecordId: "reset-1",
      installationId: "acme-yard",
    };
    const expiresAt = new Date(Date.now() + 60_000);
    const envelope = adapters.deliveryEnvelopes.seal(
      "https://stock.acme.test/reset",
      binding,
      expiresAt,
    );

    expect(adapters.deliveryEnvelopes.open(envelope, binding, new Date()).secret).toBe(
      "https://stock.acme.test/reset",
    );
  });

  it("seals an audit event with the configured active key", () => {
    const adapters = createIdentitySecurityAdapters(configuration());
    const seal = adapters.auditIntegrity.seal({
      id: "audit-1",
      sequence: 1n,
      occurredAt: new Date("2026-07-30T09:00:00.000Z"),
      eventType: "identity.sign_in",
      outcome: "Succeeded",
      correlationId: "correlation-1",
      details: {},
    });

    expect(seal).toEqual({ version: 1, keyId: "audit-1", eventHash: expect.anything() });
    expect(seal.eventHash).toHaveLength(32);
  });

  it("uses the audit rotation keys for verification only", () => {
    const adapters = createIdentitySecurityAdapters(
      configuration({
        IDENTITY_AUDIT_INTEGRITY_ACTIVE_KEY_ID: "audit-2",
        IDENTITY_AUDIT_INTEGRITY_KEYS: `audit-1:${AUDIT_KEY},audit-2:${base64Key(6)}`,
      }),
    );

    expect(
      adapters.auditIntegrity.seal({
        id: "audit-1",
        sequence: 1n,
        occurredAt: new Date("2026-07-30T09:00:00.000Z"),
        eventType: "identity.sign_in",
        outcome: "Succeeded",
        correlationId: "correlation-1",
        details: {},
      }).keyId,
    ).toBe("audit-2");
  });

  it("rejects a substituted adapter in production", () => {
    let thrown: unknown;

    try {
      createIdentitySecurityAdapters(configuration(), {
        clock: new FixedClock(new Date("2026-07-30T09:00:00.000Z")),
        argon2: new DeterministicArgon2idDeriver(),
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IdentitySecurityConfigurationError);
    expect((thrown as IdentitySecurityConfigurationError).code).toBe("TestAdapterRejected");
    expect((thrown as Error).message).toContain("argon2, clock");
  });

  it("rejects a marked deterministic adapter outside a test environment", () => {
    const markedClock = Object.assign(new FixedClock(new Date("2026-07-30T09:00:00.000Z")), {
      [deterministicTestAdapter]: true as const,
    });
    let thrown: unknown;

    try {
      createIdentitySecurityAdapters(configuration({ NODE_ENV: "development" }), {
        clock: markedClock,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    expect((thrown as IdentitySecurityConfigurationError).code).toBe("TestAdapterRejected");
    expect((thrown as Error).message).toContain("clock");
  });

  it("permits an unmarked substitution during development", () => {
    const clock = new FixedClock(new Date("2026-07-30T09:00:00.000Z"));
    const adapters = createIdentitySecurityAdapters(configuration({ NODE_ENV: "development" }), {
      clock,
      randomSource: new IncrementingRandomSource(),
      argon2: new DeterministicArgon2idDeriver(),
    });

    expect(adapters.clock.now().toISOString()).toBe("2026-07-30T09:00:00.000Z");
  });

  it("permits marked deterministic adapters in a test environment", () => {
    const markedClock = Object.assign(new FixedClock(new Date("2026-07-30T09:00:00.000Z")), {
      [deterministicTestAdapter]: true as const,
    });
    const adapters = createIdentitySecurityAdapters(configuration({ NODE_ENV: "test" }), {
      clock: markedClock,
    });

    expect(adapters.clock.now().toISOString()).toBe("2026-07-30T09:00:00.000Z");
  });
});
