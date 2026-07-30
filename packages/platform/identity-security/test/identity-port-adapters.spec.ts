import { describe, expect, it } from "vitest";

import {
  createSha256Digest,
  identityTokenPurposes,
  IdentityPortError,
  type IdentityApplicationPorts,
  type IdentityAuditIntegrity,
  type IdentityClock,
  type IdentityDeliveryBinding,
  type IdentityDeliverySecretEnvelopeService,
  type IdentityDummyPasswordHash,
  type IdentityPasswordHasher,
  type IdentityRecoveryCodeService,
  type IdentityTokenPurpose,
  type IdentityTokenServices,
  type IdentityTotpSecretCipher,
  type IdentityTotpService,
  type IdentityUuidGenerator,
  type NormalisedEmailAddress,
  type UserId,
} from "@stockcontrol/module-identity";

import {
  ConfiguredDummyPasswordHash,
  DeliverySecretEnvelopeService,
  HmacIdentityAuditIntegrity,
  IdentityDeliverySecretEnvelopeAdapter,
  IdentityRecoveryCodeServiceAdapter,
  IdentityTokenServiceRegistry,
  IdentityTotpSecretCipherAdapter,
  InstallationTotpService,
  NodeCryptoArgon2idDeriver,
  NodeRandomSource,
  NodeUuidGenerator,
  PasswordHashingService,
  RecoveryCodeService,
  SystemClock,
  TotpSecretEncryptionService,
  TotpService,
} from "../src/index.js";
import { DeterministicArgon2idDeriver, FixedClock, IncrementingRandomSource } from "./helpers.js";

/**
 * Compile-time adapter conformance.
 *
 * Every production adapter must satisfy the Identity module's application
 * port. A signature drift on either side fails `pnpm typecheck` and this file,
 * before any use case is written against the port.
 */
const conformance = {
  clock: SystemClock satisfies new () => IdentityClock,
  uuids: NodeUuidGenerator satisfies new () => IdentityUuidGenerator,
  passwords: PasswordHashingService satisfies new (
    ...parameters: never[]
  ) => IdentityPasswordHasher,
  dummyPasswordHash: ConfiguredDummyPasswordHash satisfies new (
    ...parameters: never[]
  ) => IdentityDummyPasswordHash,
  tokens: IdentityTokenServiceRegistry satisfies new (
    ...parameters: never[]
  ) => IdentityTokenServices,
  totp: InstallationTotpService satisfies new (...parameters: never[]) => IdentityTotpService,
  totpSecrets: IdentityTotpSecretCipherAdapter satisfies new (
    ...parameters: never[]
  ) => IdentityTotpSecretCipher,
  recoveryCodes: IdentityRecoveryCodeServiceAdapter satisfies new (
    ...parameters: never[]
  ) => IdentityRecoveryCodeService,
  auditIntegrity: HmacIdentityAuditIntegrity satisfies new (
    ...parameters: never[]
  ) => IdentityAuditIntegrity,
  deliveryEnvelopes: IdentityDeliverySecretEnvelopeAdapter satisfies new (
    ...parameters: never[]
  ) => IdentityDeliverySecretEnvelopeService,
} satisfies Partial<Record<keyof IdentityApplicationPorts, unknown>>;

const validDummyHash = `$sc-argon2id$v=1$a=19,m=65536,t=3,p=1,l=32$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(32).toString("base64url")}`;

const key = (seed: number, length = 32): Uint8Array =>
  Uint8Array.from({ length }, (_, index) => (seed + index) & 255);

const binding: IdentityDeliveryBinding = {
  purpose: "InvitationLink",
  jobId: "job-1",
  recipientUserId: "11111111-1111-4111-8111-111111111111" as UserId,
  recipientEmail: "sam@acme.test" as NormalisedEmailAddress,
  tokenRecordId: "invitation-1",
  installationId: "acme-yard",
};

describe("adapter conformance", () => {
  it("binds every production adapter to its identity port", () => {
    expect(Object.keys(conformance).sort()).toEqual([
      "auditIntegrity",
      "clock",
      "deliveryEnvelopes",
      "dummyPasswordHash",
      "passwords",
      "recoveryCodes",
      "tokens",
      "totp",
      "totpSecrets",
      "uuids",
    ]);
  });
});

describe("dummy password hash adapter", () => {
  it("publishes a supported deployment-generated hash", () => {
    expect(new ConfiguredDummyPasswordHash(validDummyHash).get()).toBe(validDummyHash);
  });

  it("rejects an unsupported hash at startup without echoing its value", () => {
    let thrown: unknown;

    try {
      new ConfiguredDummyPasswordHash("$sc-argon2id$v=1$broken$AAAA$BBBB");
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(IdentityPortError);
    expect((thrown as IdentityPortError).code).toBe("DummyPasswordHashInvalid");
    expect((thrown as Error).message).not.toContain("broken");
  });

  it("verifies against the configured hash so an unknown account still derives a password", async () => {
    const passwords = new PasswordHashingService(
      new IncrementingRandomSource(),
      new DeterministicArgon2idDeriver(),
    );
    const dummy = new ConfiguredDummyPasswordHash(await passwords.hash("deployment-dummy"));

    await expect(passwords.verify("guessed password", dummy.get())).resolves.toEqual({
      verified: false,
      needsRehash: false,
    });
  });
});

describe("purpose-separated token registry", () => {
  const tokens = new IdentityTokenServiceRegistry(new IncrementingRandomSource());

  it("issues a token that verifies only against its own purpose", () => {
    const invitation = tokens.for("Invitation");
    const issued = invitation.issue();

    expect(invitation.purpose).toBe("Invitation");
    expect(issued.hash).toHaveLength(32);
    expect(invitation.verify(issued.token, issued.hash)).toBe(true);
    expect(tokens.for("PasswordReset").verify(issued.token, issued.hash)).toBe(false);
    expect(tokens.for("Session").verify(issued.token, issued.hash)).toBe(false);
  });

  it("hashes a supplied token to the persisted digest", () => {
    const session = tokens.for("Session");
    const issued = session.issue();

    expect([...session.hash(issued.token)]).toEqual([...issued.hash]);
  });

  it("rejects a token that does not match the persisted digest", () => {
    const reset = tokens.for("PasswordReset");
    const issued = reset.issue();
    const other = reset.issue();

    expect(reset.verify(other.token, issued.hash)).toBe(false);
    expect(reset.verify("not-a-token", issued.hash)).toBe(false);
  });

  it("serves every supported purpose and rejects an unsupported one", () => {
    for (const purpose of identityTokenPurposes) {
      expect(tokens.for(purpose).purpose).toBe(purpose);
    }

    expect(() => tokens.for("Impersonation" as IdentityTokenPurpose)).toThrowError(
      expect.objectContaining({ code: "TokenPurposeUnsupported" }),
    );
  });
});

describe("uuid generator adapter", () => {
  it("issues distinct RFC 4122 identifiers", () => {
    const uuids = new NodeUuidGenerator();
    const first = uuids.next();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(uuids.next()).not.toBe(first);
  });
});

describe("installation TOTP adapter", () => {
  const clock = new FixedClock(new Date("2026-07-30T09:00:00.000Z"));
  const totp = new InstallationTotpService(
    new TotpService(clock, new IncrementingRandomSource()),
    "Acme Electrical",
  );

  it("binds the installation issuer rather than accepting one from a caller", () => {
    const enrolment = totp.issueEnrolment("sam@acme.test");

    expect(enrolment.provisioningUri).toContain("issuer=Acme+Electrical");
    expect(enrolment.provisioningUri).toContain(enrolment.secret);
  });

  it("verifies a current code and reports a replay", () => {
    const enrolment = totp.issueEnrolment("sam@acme.test");
    const verification = totp.verify({ secret: enrolment.secret, code: "000000" });

    expect(verification.valid).toBe(false);
  });
});

describe("TOTP secret cipher adapter", () => {
  const encryption = new TotpSecretEncryptionService(new IncrementingRandomSource(), {
    activeKeyId: "totp-1",
    keys: [{ id: "totp-1", key: key(1) }],
  });
  const cipher = new IdentityTotpSecretCipherAdapter(encryption, "totp-1");
  const context = { userId: "user-1", credentialId: "credential-1" };
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  it("encrypts and decrypts a secret bound to its credential", () => {
    const envelope = cipher.encrypt(secret, context);

    expect(cipher.activeKeyId).toBe("totp-1");
    expect(cipher.decrypt(envelope, context)).toEqual({ secret, needsReencrypt: false });
  });

  it("refuses a credential envelope moved to another user", () => {
    const envelope = cipher.encrypt(secret, context);

    expect(() => cipher.decrypt(envelope, { ...context, userId: "user-2" })).toThrow();
  });
});

describe("recovery code adapter", () => {
  const codes = new IdentityRecoveryCodeServiceAdapter(
    new RecoveryCodeService(new IncrementingRandomSource(), 3),
  );

  it("issues codes with persistable digests", () => {
    const issue = codes.issue();

    expect(issue.codes).toHaveLength(3);
    expect(issue.hashes).toHaveLength(3);
    expect(codes.verify(issue.codes[0] as string, issue.hashes[0] as never)).toBe(true);
    expect(codes.verify(issue.codes[1] as string, issue.hashes[0] as never)).toBe(false);
    expect([...codes.hash(issue.codes[0] as string)]).toEqual([...(issue.hashes[0] as never)]);
  });

  it("rejects a malformed code", () => {
    expect(() => codes.hash("not-a-code")).toThrow("Recovery code is malformed.");
    expect(codes.verify("not-a-code", createSha256Digest(new Uint8Array(32)))).toBe(false);
  });
});

describe("delivery envelope adapter", () => {
  const envelopes = new IdentityDeliverySecretEnvelopeAdapter(
    new DeliverySecretEnvelopeService(new IncrementingRandomSource(), {
      activeKeyId: "delivery-1",
      keys: [
        { id: "delivery-1", key: key(1) },
        { id: "delivery-0", key: key(9) },
      ],
    }),
  );
  const expiresAt = new Date("2026-07-30T10:00:00.000Z");
  const beforeExpiry = new Date("2026-07-30T09:30:00.000Z");
  const secret = "https://stock.acme.test/invitations/accept?token=raw";

  it("publishes its active and retained key IDs", () => {
    expect(envelopes.activeKeyId).toBe("delivery-1");
    expect(envelopes.retainedKeyIds).toEqual(["delivery-0"]);
  });

  it("seals and opens a secret bound to the module's validated binding", () => {
    const envelope = envelopes.seal(secret, binding, expiresAt);

    expect(envelopes.isExpired(envelope, beforeExpiry)).toBe(false);
    expect(envelopes.isExpired(envelope, expiresAt)).toBe(true);
    expect(envelopes.open(envelope, binding, beforeExpiry)).toEqual({
      secret,
      needsReencrypt: false,
    });
  });

  it("rejects a binding the module considers invalid when sealing", () => {
    expect(() => envelopes.seal(secret, { ...binding, jobId: "" }, expiresAt)).toThrowError(
      expect.objectContaining({ code: "DeliveryBindingInvalid" }),
    );
  });

  it("reports one generic failure for an invalid binding or a tampered envelope", () => {
    const envelope = envelopes.seal(secret, binding, expiresAt);
    const tampered = Uint8Array.from(envelope.ciphertext);
    tampered[0] = (tampered[0] as number) ^ 0xff;

    for (const attempt of [
      () => envelopes.open(envelope, { ...binding, jobId: "" }, beforeExpiry),
      () => envelopes.open(envelope, { ...binding, jobId: "job-2" }, beforeExpiry),
      () => envelopes.open({ ...envelope, ciphertext: tampered }, binding, beforeExpiry),
      () => envelopes.open(envelope, binding, expiresAt),
    ]) {
      expect(attempt).toThrowError(
        expect.objectContaining({
          code: "DeliveryEnvelopeInvalid",
          message: "The delivery secret envelope is invalid or cannot be authenticated.",
        }),
      );
    }
  });
});

describe("production Node adapters", () => {
  it("uses real Node cryptography for the composed password hasher", async () => {
    const passwords = new PasswordHashingService(
      new NodeRandomSource(),
      new NodeCryptoArgon2idDeriver(),
    );
    const hash = await passwords.hash("a real deployment password");

    await expect(passwords.verify("a real deployment password", hash)).resolves.toEqual({
      verified: true,
      needsRehash: false,
    });
  });
});
