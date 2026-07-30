import { randomUUID } from "node:crypto";

import {
  createIdentityDeliveryBinding,
  createSha256Digest,
  identityTokenDomain,
  identityTokenPurposes,
  IdentityPortError,
  type IdentityDeliveryBinding,
  type IdentityDeliverySecretEnvelope,
  type IdentityDecryptedTotpSecret,
  type IdentityDeliverySecretEnvelopeService,
  type IdentityDummyPasswordHash,
  type IdentityEncryptedTotpSecret,
  type IdentityOpenedDeliverySecret,
  type IdentityRecoveryCodeIssue,
  type IdentityRecoveryCodeService,
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
} from "@stockcontrol/module-identity";

import type { DeliverySecretEnvelopeService } from "./delivery-secret-envelope.js";
import { isSupportedPasswordHash } from "./password.js";
import type { RecoveryCodeService } from "./recovery-codes.js";
import { createPersistedTokenHash, OpaqueTokenService } from "./tokens.js";
import type { TotpSecretEncryptionService } from "./totp-secret-encryption.js";
import type { TotpService } from "./totp.js";
import type { RandomSource } from "./ports.js";

/**
 * Production adapters binding this package's cryptographic primitives to the
 * Identity module's application ports. Each class is a thin translation; no
 * authentication rule lives here.
 */

const asSha256Digest = (hash: Uint8Array): Sha256Digest => createSha256Digest(hash);

export class NodeUuidGenerator implements IdentityUuidGenerator {
  public next(): string {
    return randomUUID();
  }
}

/**
 * The deployment-generated hash verified for an unknown account so that
 * account existence cannot be inferred from sign-in timing.
 */
export class ConfiguredDummyPasswordHash implements IdentityDummyPasswordHash {
  readonly #value: string;

  public constructor(encodedHash: string) {
    /*
     * Validating the encoding now turns a mis-provisioned deployment into a
     * startup failure rather than an exception on the first unknown-account
     * sign-in, which would leak account existence through an error response.
     */
    if (!isSupportedPasswordHash(encodedHash)) {
      throw new IdentityPortError(
        "DummyPasswordHashInvalid",
        "The configured dummy password hash is not a supported Argon2id encoding.",
      );
    }

    this.#value = encodedHash;
  }

  public get(): string {
    return this.#value;
  }
}

class PurposeTokenService implements IdentityTokenService {
  readonly #tokens: OpaqueTokenService;

  public constructor(
    public readonly purpose: IdentityTokenPurpose,
    randomSource: RandomSource,
  ) {
    this.#tokens = new OpaqueTokenService(randomSource, identityTokenDomain(purpose));
  }

  public issue(): IdentityTokenIssue {
    const issued = this.#tokens.issue();

    return { token: issued.token, hash: asSha256Digest(issued.hash) };
  }

  public hash(token: string): Sha256Digest {
    return asSha256Digest(this.#tokens.hash(token));
  }

  public verify(token: string, persistedHash: Sha256Digest): boolean {
    return this.#tokens.verify(token, createPersistedTokenHash(persistedHash));
  }
}

export class IdentityTokenServiceRegistry implements IdentityTokenServices {
  readonly #services: ReadonlyMap<IdentityTokenPurpose, IdentityTokenService>;

  public constructor(randomSource: RandomSource) {
    this.#services = new Map(
      identityTokenPurposes.map((purpose) => [
        purpose,
        new PurposeTokenService(purpose, randomSource),
      ]),
    );
  }

  public for(purpose: IdentityTokenPurpose): IdentityTokenService {
    const service = this.#services.get(purpose);

    if (service === undefined) {
      throw new IdentityPortError(
        "TokenPurposeUnsupported",
        "An identity token purpose must be one of the supported purposes.",
      );
    }

    return service;
  }
}

/** Binds the installation's issuer label so a command body cannot supply one. */
export class InstallationTotpService implements IdentityTotpService {
  public constructor(
    private readonly totp: TotpService,
    private readonly issuer: string,
  ) {}

  public issueEnrolment(accountName: string): IdentityTotpEnrolment {
    return this.totp.issueEnrollment(this.issuer, accountName);
  }

  public verify(input: IdentityTotpVerificationInput): IdentityTotpVerification {
    return this.totp.verify(input);
  }
}

export class IdentityTotpSecretCipherAdapter implements IdentityTotpSecretCipher {
  public constructor(
    private readonly encryption: TotpSecretEncryptionService,
    public readonly activeKeyId: string,
  ) {}

  public encrypt(secret: string, context: IdentityTotpSecretContext): IdentityEncryptedTotpSecret {
    return this.encryption.encrypt(secret, context);
  }

  public decrypt(
    envelope: IdentityEncryptedTotpSecret,
    context: IdentityTotpSecretContext,
  ): IdentityDecryptedTotpSecret {
    return this.encryption.decrypt(envelope, context);
  }
}

export class IdentityRecoveryCodeServiceAdapter implements IdentityRecoveryCodeService {
  public constructor(private readonly codes: RecoveryCodeService) {}

  public issue(): IdentityRecoveryCodeIssue {
    const issued = this.codes.issue();

    return {
      codes: [...issued.codes],
      hashes: issued.hashes.map((hash) => asSha256Digest(hash)),
    };
  }

  public hash(code: string): Sha256Digest {
    return asSha256Digest(this.codes.hash(code));
  }

  public verify(code: string, persistedHash: Sha256Digest): boolean {
    return this.codes.verify(code, createPersistedTokenHash(persistedHash));
  }
}

const deliveryEnvelopeFailure = (): IdentityPortError =>
  new IdentityPortError(
    "DeliveryEnvelopeInvalid",
    "The delivery secret envelope is invalid or cannot be authenticated.",
  );

export class IdentityDeliverySecretEnvelopeAdapter implements IdentityDeliverySecretEnvelopeService {
  public constructor(private readonly envelopes: DeliverySecretEnvelopeService) {}

  public get activeKeyId(): string {
    return this.envelopes.activeKeyId;
  }

  public get retainedKeyIds(): readonly string[] {
    return this.envelopes.retainedKeyIds;
  }

  public seal(
    secret: string,
    binding: IdentityDeliveryBinding,
    expiresAt: Date,
  ): IdentityDeliverySecretEnvelope {
    return this.envelopes.seal(secret, createIdentityDeliveryBinding(binding), expiresAt);
  }

  public open(
    envelope: IdentityDeliverySecretEnvelope,
    binding: IdentityDeliveryBinding,
    openedAt: Date,
  ): IdentityOpenedDeliverySecret {
    let validated: IdentityDeliveryBinding;

    try {
      validated = createIdentityDeliveryBinding(binding);
    } catch {
      throw deliveryEnvelopeFailure();
    }

    try {
      return this.envelopes.open(envelope, validated, openedAt);
    } catch {
      throw deliveryEnvelopeFailure();
    }
  }

  public isExpired(envelope: IdentityDeliverySecretEnvelope, at: Date): boolean {
    return this.envelopes.isExpired(envelope, at);
  }
}
