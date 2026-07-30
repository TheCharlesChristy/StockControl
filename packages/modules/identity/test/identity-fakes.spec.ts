import { describe, expect, it } from "vitest";

import {
  anonymousIdentityActor,
  assertNoDeterministicTestAdapters,
  createIdentityRequestContext,
  identityApplicationPortNames,
  isDeterministicTestAdapter,
  normaliseEmailAddress,
  userId,
  type IdentityApplicationPorts,
  type IdentityDeliveryBinding,
  type IdentityUnitOfWork,
} from "../src/index";
import { digestToText } from "./support/deterministic-digest";
import {
  FakeAuditIntegrity,
  FakeDeliverySecretEnvelopeService,
  FakeDummyPasswordHash,
  FakeIdentityClock,
  FakeIdentityPasswordHasher,
  FakeIdentityTokenServices,
  FakeIdentityTotpService,
  FakeRecoveryCodeService,
  FakeTotpSecretCipher,
  RecordingDeliveryScheduler,
  SequentialUuidGenerator,
  StaticRequestContextProvider,
  testIdentityPolicyProvider,
} from "./support/identity-fakes";

const unusedUnitOfWork: IdentityUnitOfWork = {
  execute: () => Promise.reject(new Error("The unit of work is not exercised by this test.")),
};

const buildPorts = (): IdentityApplicationPorts => ({
  clock: new FakeIdentityClock(),
  uuids: new SequentialUuidGenerator(),
  passwords: new FakeIdentityPasswordHasher(),
  dummyPasswordHash: new FakeDummyPasswordHash(),
  tokens: new FakeIdentityTokenServices(),
  totp: new FakeIdentityTotpService(),
  totpSecrets: new FakeTotpSecretCipher(),
  recoveryCodes: new FakeRecoveryCodeService(),
  auditIntegrity: new FakeAuditIntegrity(),
  deliveryEnvelopes: new FakeDeliverySecretEnvelopeService(),
  deliveries: new RecordingDeliveryScheduler(),
  policy: testIdentityPolicyProvider(),
  requestContext: new StaticRequestContextProvider(
    createIdentityRequestContext({
      actor: anonymousIdentityActor,
      correlationId: "correlation-1",
    }),
  ),
  unitOfWork: unusedUnitOfWork,
});

const binding: IdentityDeliveryBinding = {
  purpose: "InvitationLink",
  jobId: "job-1",
  recipientUserId: userId("11111111-1111-4111-8111-111111111111"),
  recipientEmail: normaliseEmailAddress("sam@acme.test"),
  tokenRecordId: "invitation-1",
  installationId: "test-installation",
};

const expiresAt = new Date("2026-07-30T10:00:00.000Z");
const beforeExpiry = new Date("2026-07-30T09:30:00.000Z");

describe("deterministic identity fakes", () => {
  it("supplies every port a use case may depend on", () => {
    const ports = buildPorts();

    expect(Object.keys(ports).sort()).toEqual([...identityApplicationPortNames].sort());
  });

  it("marks every fake adapter so production composition rejects it", () => {
    const ports = buildPorts();
    const unmarked = identityApplicationPortNames.filter(
      (name) =>
        name !== "policy" && name !== "unitOfWork" && !isDeterministicTestAdapter(ports[name]),
    );

    expect(unmarked).toEqual([]);
    expect(() => assertNoDeterministicTestAdapters({ ...ports })).toThrowError(
      expect.objectContaining({ code: "DeterministicTestAdapterRejected" }),
    );
  });

  it("advances the clock only when the test asks it to", () => {
    const clock = new FakeIdentityClock(new Date("2026-07-30T09:00:00.000Z"));
    const first = clock.now();
    clock.advanceSeconds(90);

    expect(first.toISOString()).toBe("2026-07-30T09:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-07-30T09:01:30.000Z");

    clock.set(new Date("2026-07-31T00:00:00.000Z"));
    expect(clock.now().toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });

  it("issues distinct sequential identifiers", () => {
    const uuids = new SequentialUuidGenerator();

    expect([uuids.next(), uuids.next()]).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ]);
  });

  it("verifies a matching password and rejects a wrong one", async () => {
    const passwords = new FakeIdentityPasswordHasher();
    const hash = await passwords.hash("correct horse battery staple");

    await expect(passwords.verify("correct horse battery staple", hash)).resolves.toEqual({
      verified: true,
      needsRehash: false,
    });
    await expect(passwords.verify("wrong password", hash)).resolves.toEqual({
      verified: false,
      needsRehash: false,
    });
    expect(passwords.derivations).toHaveLength(3);
  });

  it("reports a legacy hash as verified and needing rehash", async () => {
    const legacy = "fake-argon2id$v=1$legacy";
    const passwords = new FakeIdentityPasswordHasher(new Set([legacy]));

    await expect(passwords.verify("any password", legacy)).resolves.toEqual({
      verified: true,
      needsRehash: true,
    });
  });

  it("rejects a malformed persisted hash so the use case can return a generic failure", async () => {
    const passwords = new FakeIdentityPasswordHasher();

    await expect(passwords.verify("any password", "corrupt")).rejects.toThrow(
      "The persisted password hash is malformed or unsupported.",
    );
  });

  it("derives a password even for an unknown account through the dummy hash", async () => {
    const passwords = new FakeIdentityPasswordHasher();
    const dummy = new FakeDummyPasswordHash();

    await expect(passwords.verify("guessed password", dummy.get())).resolves.toEqual({
      verified: false,
      needsRehash: false,
    });
    expect(passwords.derivations).toEqual(["guessed password"]);
  });

  it("accepts a valid TOTP code once and reports a replay", () => {
    const totp = new FakeIdentityTotpService();
    const enrolment = totp.issueEnrolment("sam@acme.test");
    const code = totp.codeFor(enrolment.secret);

    expect(enrolment.provisioningUri).toContain(enrolment.secret);
    expect(totp.verify({ secret: enrolment.secret, code })).toEqual({ valid: true, counter: 1n });
    expect(totp.verify({ secret: enrolment.secret, code, lastAcceptedCounter: 1n })).toEqual({
      valid: false,
      reason: "replayed",
    });
    expect(totp.verify({ secret: enrolment.secret, code: "000000" })).toEqual({
      valid: false,
      reason: "invalid",
    });
  });

  it("binds an encrypted TOTP secret to its user and credential", () => {
    const cipher = new FakeTotpSecretCipher();
    const context = { userId: "user-1", credentialId: "credential-1" };
    const envelope = cipher.encrypt("SECRETAAAAAAAAAAAAAAAAAAAAAAAAAA", context);

    expect(cipher.decrypt(envelope, context)).toEqual({
      secret: "SECRETAAAAAAAAAAAAAAAAAAAAAAAAAA",
      needsReencrypt: false,
    });
    expect(() => cipher.decrypt(envelope, { ...context, userId: "user-2" })).toThrow();
  });

  it("reports a retained-key TOTP secret as needing re-encryption", () => {
    const context = { userId: "user-1", credentialId: "credential-1" };
    const previous = new FakeTotpSecretCipher("old-key");
    const rotated = new FakeTotpSecretCipher("new-key", ["old-key"]);
    const envelope = previous.encrypt("SECRETAAAAAAAAAAAAAAAAAAAAAAAAAA", context);

    expect(rotated.decrypt(envelope, context).needsReencrypt).toBe(true);
    expect(() => new FakeTotpSecretCipher("new-key").decrypt(envelope, context)).toThrow();
  });

  it("issues single-use recovery codes with persistable hashes", () => {
    const service = new FakeRecoveryCodeService(3);
    const issue = service.issue();

    expect(issue.codes).toHaveLength(3);
    expect(new Set(issue.hashes.map((hash) => digestToText(hash))).size).toBe(3);
    expect(service.verify(issue.codes[0] as string, issue.hashes[0] as never)).toBe(true);
    expect(service.verify(issue.codes[1] as string, issue.hashes[0] as never)).toBe(false);
    expect(service.verify("not-a-code", issue.hashes[0] as never)).toBe(false);
    expect(() => service.hash("not-a-code")).toThrow("Recovery code is malformed.");
  });

  it("seals an audit event so a changed chain position changes the seal", () => {
    const integrity = new FakeAuditIntegrity();
    const event = {
      id: "audit-1",
      sequence: 1n,
      occurredAt: new Date("2026-07-30T09:00:00.000Z"),
      eventType: "identity.sign_in",
      outcome: "Succeeded",
      correlationId: "correlation-1",
      details: { method: "Password" },
    } as const;

    const sealed = integrity.seal(event);

    expect(sealed.version).toBe(1);
    expect(digestToText(integrity.seal({ ...event, sequence: 2n }).eventHash)).not.toBe(
      digestToText(sealed.eventHash),
    );
  });

  it("round-trips a sealed delivery secret and rejects a substituted binding", () => {
    const envelopes = new FakeDeliverySecretEnvelopeService();
    const envelope = envelopes.seal("https://stock.test/invitations/raw-token", binding, expiresAt);

    expect(envelopes.open(envelope, binding, beforeExpiry)).toEqual({
      secret: "https://stock.test/invitations/raw-token",
      needsReencrypt: false,
    });
    expect(() =>
      envelopes.open(envelope, { ...binding, jobId: "job-2" }, beforeExpiry),
    ).toThrowError(expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }));
    expect(() => envelopes.open(envelope, binding, expiresAt)).toThrowError(
      expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }),
    );
  });

  it("opens a retained-key envelope and reports that it needs re-encryption", () => {
    const previous = new FakeDeliverySecretEnvelopeService("old-key");
    const rotated = new FakeDeliverySecretEnvelopeService("new-key", ["old-key"]);
    const envelope = previous.seal("https://stock.test/resets/raw-token", binding, expiresAt);

    expect(rotated.open(envelope, binding, beforeExpiry).needsReencrypt).toBe(true);
    expect(() =>
      new FakeDeliverySecretEnvelopeService("new-key").open(envelope, binding, beforeExpiry),
    ).toThrowError(expect.objectContaining({ code: "DeliveryEnvelopeInvalid" }));
  });

  it("rejects a tampered ciphertext, tag, or version", () => {
    const envelopes = new FakeDeliverySecretEnvelopeService();
    const envelope = envelopes.seal("https://stock.test/invitations/raw-token", binding, expiresAt);
    const tamperedCiphertext = Uint8Array.from(envelope.ciphertext);
    tamperedCiphertext[0] = (tamperedCiphertext[0] as number) ^ 0xff;
    const tamperedTag = Uint8Array.from(envelope.authTag);
    tamperedTag[0] = (tamperedTag[0] as number) ^ 0xff;

    expect(() =>
      envelopes.open({ ...envelope, ciphertext: tamperedCiphertext }, binding, beforeExpiry),
    ).toThrow();
    expect(() =>
      envelopes.open({ ...envelope, authTag: tamperedTag }, binding, beforeExpiry),
    ).toThrow();
    expect(() =>
      envelopes.open({ ...envelope, envelopeVersion: 2 as unknown as 1 }, binding, beforeExpiry),
    ).toThrow();
  });

  it("records scheduled deliveries and propagates a scheduling failure", async () => {
    const envelopes = new FakeDeliverySecretEnvelopeService();
    const scheduler = new RecordingDeliveryScheduler();
    const request = {
      jobId: binding.jobId,
      purpose: binding.purpose,
      recipientUserId: binding.recipientUserId,
      recipientEmail: binding.recipientEmail,
      tokenRecordId: binding.tokenRecordId,
      envelope: envelopes.seal("https://stock.test/invitations/raw", binding, expiresAt),
      scheduledAt: beforeExpiry,
    };

    await scheduler.schedule(request);

    expect(scheduler.scheduled).toEqual([request]);
    await expect(
      new RecordingDeliveryScheduler(new Error("outbox unavailable")).schedule(request),
    ).rejects.toThrow("outbox unavailable");
  });

  it("returns the request context the host resolved for the current request", () => {
    const provider = new StaticRequestContextProvider(
      createIdentityRequestContext({
        actor: anonymousIdentityActor,
        correlationId: "correlation-1",
      }),
    );

    expect(provider.current().correlationId).toBe("correlation-1");

    provider.set(
      createIdentityRequestContext({
        actor: anonymousIdentityActor,
        correlationId: "correlation-2",
      }),
    );

    expect(provider.current().correlationId).toBe("correlation-2");
  });
});
