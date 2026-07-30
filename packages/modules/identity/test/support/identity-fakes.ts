import {
  createIdentityDeliveryBinding,
  createIdentityInstallation,
  createSha256Digest,
  DEFAULT_IDENTITY_SECURITY_POLICY,
  DefaultIdentityPolicyProvider,
  deterministicTestAdapter,
  identityTokenDomain,
  IdentityPortError,
  type IdentityAuditIntegrity,
  type IdentityAuditIntegrityInput,
  type IdentityAuditIntegritySeal,
  type IdentityClock,
  type IdentityDeliveryBinding,
  type IdentityDeliveryRequest,
  type IdentityDeliveryScheduler,
  type IdentityDeliverySecretEnvelope,
  type IdentityDeliverySecretEnvelopeService,
  type IdentityDummyPasswordHash,
  type IdentityEncryptedTotpSecret,
  type IdentityOpenedDeliverySecret,
  type IdentityPasswordHasher,
  type IdentityPasswordVerification,
  type IdentityRecoveryCodeIssue,
  type IdentityRecoveryCodeService,
  type IdentityRequestContext,
  type IdentityRequestContextProvider,
  type IdentityTokenIssue,
  type IdentityTokenPurpose,
  type IdentityTokenService,
  type IdentityTokenServices,
  type IdentityTotpEnrolment,
  type IdentityTotpSecretCipher,
  type IdentityTotpSecretContext,
  type IdentityTotpService,
  type IdentityTotpVerification,
  type IdentityTotpVerificationInput,
  type IdentityUuidGenerator,
  type Sha256Digest,
} from "../../src/index";
import { deterministicDigest, digestToText } from "./deterministic-digest";

/**
 * Deterministic in-memory adapters for Identity application tests.
 *
 * Every fake carries the deterministic-test-adapter marker so production
 * composition refuses to start if one is ever wired into a real application.
 */

export class FakeIdentityClock implements IdentityClock {
  public readonly [deterministicTestAdapter] = true;

  public constructor(private current: Date = new Date("2026-07-30T09:00:00.000Z")) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }

  public set(instant: Date): void {
    this.current = new Date(instant);
  }
}

export class SequentialUuidGenerator implements IdentityUuidGenerator {
  public readonly [deterministicTestAdapter] = true;

  private issued = 0;

  public constructor(private readonly prefix = "00000000-0000-4000-8000") {}

  public next(): string {
    this.issued += 1;
    return `${this.prefix}-${this.issued.toString(16).padStart(12, "0")}`;
  }
}

export class FakeIdentityPasswordHasher implements IdentityPasswordHasher {
  public readonly [deterministicTestAdapter] = true;

  public readonly derivations: string[] = [];

  public constructor(private readonly legacyHashes: ReadonlySet<string> = new Set()) {}

  public hash(password: string): Promise<string> {
    this.derivations.push(password);
    return Promise.resolve(`fake-argon2id$v=1$${digestToText(deterministicDigest(password))}`);
  }

  public verify(password: string, encodedHash: string): Promise<IdentityPasswordVerification> {
    this.derivations.push(password);

    if (!encodedHash.startsWith("fake-argon2id$v=1$")) {
      return Promise.reject(new Error("The persisted password hash is malformed or unsupported."));
    }

    const expected = `fake-argon2id$v=1$${digestToText(deterministicDigest(password))}`;
    const verified = encodedHash === expected || this.legacyHashes.has(encodedHash);

    return Promise.resolve({
      verified,
      needsRehash: verified && this.legacyHashes.has(encodedHash),
    });
  }
}

export class FakeDummyPasswordHash implements IdentityDummyPasswordHash {
  public readonly [deterministicTestAdapter] = true;

  public constructor(
    private readonly value = `fake-argon2id$v=1$${digestToText(deterministicDigest("dummy"))}`,
  ) {}

  public get(): string {
    return this.value;
  }
}

class FakeTokenService implements IdentityTokenService {
  public readonly [deterministicTestAdapter] = true;

  private issued = 0;

  public constructor(public readonly purpose: IdentityTokenPurpose) {}

  public issue(): IdentityTokenIssue {
    this.issued += 1;
    const token = `${this.purpose.toLowerCase()}-token-${String(this.issued)}`;

    return { token, hash: this.hash(token) };
  }

  public hash(token: string): Sha256Digest {
    if (token.length < 1) {
      throw new Error("Invalid token.");
    }

    return createSha256Digest(deterministicDigest(identityTokenDomain(this.purpose), token));
  }

  public verify(token: string, persistedHash: Sha256Digest): boolean {
    let candidate: Sha256Digest;

    try {
      candidate = this.hash(token);
    } catch {
      return false;
    }

    return digestToText(candidate) === digestToText(persistedHash);
  }
}

export class FakeIdentityTokenServices implements IdentityTokenServices {
  public readonly [deterministicTestAdapter] = true;

  readonly #services = new Map<IdentityTokenPurpose, FakeTokenService>();

  public for(purpose: IdentityTokenPurpose): IdentityTokenService {
    identityTokenDomain(purpose);
    const existing = this.#services.get(purpose);

    if (existing !== undefined) {
      return existing;
    }

    const created = new FakeTokenService(purpose);
    this.#services.set(purpose, created);
    return created;
  }
}

export class FakeIdentityTotpService implements IdentityTotpService {
  public readonly [deterministicTestAdapter] = true;

  private issued = 0;

  public constructor(private readonly issuer = "StockControl Test") {}

  public issueEnrolment(accountName: string): IdentityTotpEnrolment {
    this.issued += 1;
    const secret = `SECRET${String(this.issued).padStart(26, "A")}`;

    return {
      secret,
      provisioningUri: `otpauth://totp/${encodeURIComponent(this.issuer)}:${encodeURIComponent(accountName)}?secret=${secret}`,
    };
  }

  /** The valid code for a secret is the first six digits of its digest. */
  public codeFor(secret: string, counter = 1n): string {
    return digestToText(deterministicDigest(secret, counter.toString()))
      .replaceAll(/\D/gu, "")
      .padEnd(6, "0")
      .slice(0, 6);
  }

  public verify(input: IdentityTotpVerificationInput): IdentityTotpVerification {
    const counter = 1n;

    if (input.code !== this.codeFor(input.secret, counter)) {
      return { valid: false, reason: "invalid" };
    }

    if (input.lastAcceptedCounter !== undefined && counter <= input.lastAcceptedCounter) {
      return { valid: false, reason: "replayed" };
    }

    return { valid: true, counter };
  }
}

export class FakeTotpSecretCipher implements IdentityTotpSecretCipher {
  public readonly [deterministicTestAdapter] = true;

  private sealed = 0;

  public constructor(
    public readonly activeKeyId = "test-totp-key-1",
    private readonly retainedKeyIds: readonly string[] = [],
  ) {}

  public encrypt(secret: string, context: IdentityTotpSecretContext): IdentityEncryptedTotpSecret {
    this.sealed += 1;
    const nonce = deterministicDigest("totp-nonce", String(this.sealed)).slice(0, 12);

    return {
      encryptionVersion: 1,
      keyId: this.activeKeyId,
      nonce,
      ciphertext: new TextEncoder().encode(secret),
      authTag: deterministicDigest(
        this.activeKeyId,
        context.userId,
        context.credentialId,
        secret,
        digestToText(nonce),
      ).slice(0, 16),
    };
  }

  public decrypt(
    envelope: IdentityEncryptedTotpSecret,
    context: IdentityTotpSecretContext,
  ): { readonly secret: string; readonly needsReencrypt: boolean } {
    const known =
      envelope.keyId === this.activeKeyId || this.retainedKeyIds.includes(envelope.keyId);
    const secret = new TextDecoder().decode(envelope.ciphertext);
    const expected = deterministicDigest(
      envelope.keyId,
      context.userId,
      context.credentialId,
      secret,
      digestToText(envelope.nonce),
    ).slice(0, 16);

    if (!known || digestToText(envelope.authTag) !== digestToText(expected)) {
      throw new Error("Encrypted TOTP secret is invalid or cannot be authenticated.");
    }

    return { secret, needsReencrypt: envelope.keyId !== this.activeKeyId };
  }
}

export class FakeRecoveryCodeService implements IdentityRecoveryCodeService {
  public readonly [deterministicTestAdapter] = true;

  private issuedSets = 0;

  public constructor(private readonly count = 10) {}

  public issue(): IdentityRecoveryCodeIssue {
    this.issuedSets += 1;
    const codes = Array.from(
      { length: this.count },
      (_, index) => `SET${String(this.issuedSets)}-CODE-${String(index + 1).padStart(2, "0")}`,
    );

    return { codes, hashes: codes.map((code) => this.hash(code)) };
  }

  public hash(code: string): Sha256Digest {
    if (!/^SET\d+-CODE-\d{2}$/u.test(code)) {
      throw new Error("Recovery code is malformed.");
    }

    return createSha256Digest(deterministicDigest("identity.recovery-code", code));
  }

  public verify(code: string, persistedHash: Sha256Digest): boolean {
    try {
      return digestToText(this.hash(code)) === digestToText(persistedHash);
    } catch {
      return false;
    }
  }
}

export class FakeAuditIntegrity implements IdentityAuditIntegrity {
  public readonly [deterministicTestAdapter] = true;

  public constructor(public readonly keyId = "test-audit-key-1") {}

  public seal(event: IdentityAuditIntegrityInput): IdentityAuditIntegritySeal {
    return {
      version: 1,
      keyId: this.keyId,
      eventHash: deterministicDigest(
        this.keyId,
        event.sequence.toString(),
        event.id,
        event.eventType,
        event.outcome,
        event.correlationId,
        JSON.stringify(event.details),
        event.previousEventHash === undefined ? "" : digestToText(event.previousEventHash),
      ),
    };
  }
}

const bindingText = (binding: IdentityDeliveryBinding, expiresAt: Date): string =>
  [
    "stockcontrol:identity:delivery-secret:v1",
    binding.purpose,
    binding.jobId,
    binding.recipientUserId,
    binding.recipientEmail,
    binding.tokenRecordId,
    binding.installationId,
    expiresAt.toISOString(),
  ].join("|");

export class FakeDeliverySecretEnvelopeService implements IdentityDeliverySecretEnvelopeService {
  public readonly [deterministicTestAdapter] = true;

  private sealed = 0;

  public constructor(
    public readonly activeKeyId = "test-delivery-key-1",
    public readonly retainedKeyIds: readonly string[] = [],
  ) {}

  public seal(
    secret: string,
    bindingInput: IdentityDeliveryBinding,
    expiresAt: Date,
  ): IdentityDeliverySecretEnvelope {
    const binding = createIdentityDeliveryBinding(bindingInput);
    this.sealed += 1;
    const nonce = deterministicDigest("delivery-nonce", String(this.sealed)).slice(0, 12);
    const keystream = deterministicDigest(this.activeKeyId, digestToText(nonce));
    const plaintext = new TextEncoder().encode(secret);
    const ciphertext = plaintext.map((byte, index) => byte ^ (keystream[index % 32] as number));

    return {
      envelopeVersion: 1,
      keyId: this.activeKeyId,
      nonce,
      ciphertext,
      authTag: deterministicDigest(
        this.activeKeyId,
        bindingText(binding, expiresAt),
        digestToText(nonce),
        digestToText(ciphertext),
      ).slice(0, 16),
      expiresAt: new Date(expiresAt),
    };
  }

  public open(
    envelope: IdentityDeliverySecretEnvelope,
    bindingInput: IdentityDeliveryBinding,
    openedAt: Date,
  ): IdentityOpenedDeliverySecret {
    const binding = createIdentityDeliveryBinding(bindingInput);
    const known =
      envelope.keyId === this.activeKeyId || this.retainedKeyIds.includes(envelope.keyId);
    const expected = deterministicDigest(
      envelope.keyId,
      bindingText(binding, envelope.expiresAt),
      digestToText(envelope.nonce),
      digestToText(envelope.ciphertext),
    ).slice(0, 16);

    if (
      !known ||
      (envelope.envelopeVersion as number) !== 1 ||
      this.isExpired(envelope, openedAt) ||
      digestToText(envelope.authTag) !== digestToText(expected)
    ) {
      throw new IdentityPortError(
        "DeliveryEnvelopeInvalid",
        "The delivery secret envelope is invalid or cannot be authenticated.",
      );
    }

    const keystream = deterministicDigest(envelope.keyId, digestToText(envelope.nonce));

    return {
      secret: new TextDecoder().decode(
        envelope.ciphertext.map((byte, index) => byte ^ (keystream[index % 32] as number)),
      ),
      needsReencrypt: envelope.keyId !== this.activeKeyId,
    };
  }

  public isExpired(envelope: IdentityDeliverySecretEnvelope, at: Date): boolean {
    return at.getTime() >= envelope.expiresAt.getTime();
  }
}

export class RecordingDeliveryScheduler implements IdentityDeliveryScheduler {
  public readonly [deterministicTestAdapter] = true;

  public readonly scheduled: IdentityDeliveryRequest[] = [];

  public constructor(private readonly failure?: Error) {}

  public schedule(request: IdentityDeliveryRequest): Promise<void> {
    if (this.failure !== undefined) {
      return Promise.reject(this.failure);
    }

    this.scheduled.push(request);
    return Promise.resolve();
  }
}

export class StaticRequestContextProvider implements IdentityRequestContextProvider {
  public readonly [deterministicTestAdapter] = true;

  public constructor(private context: IdentityRequestContext) {}

  public current(): IdentityRequestContext {
    return this.context;
  }

  public set(context: IdentityRequestContext): void {
    this.context = context;
  }
}

export const testIdentityPolicyProvider = (): DefaultIdentityPolicyProvider =>
  new DefaultIdentityPolicyProvider(
    createIdentityInstallation({
      installationId: "test-installation",
      displayName: "StockControl Test",
      baseUrl: "https://stock.test",
    }),
    DEFAULT_IDENTITY_SECURITY_POLICY,
  );
