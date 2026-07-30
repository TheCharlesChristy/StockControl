import type { Sha256Digest } from "./persistence";

/**
 * Application-layer security ports for the Identity module.
 *
 * These declarations are the only cryptographic vocabulary Identity use cases
 * may depend on. Node, PostgreSQL, HTTP, and deployment implementations live
 * behind them so a use case can be exercised with deterministic fakes.
 */

/**
 * Marks an adapter as a deterministic test double. Production composition
 * refuses to build an application that contains a marked adapter, so a fake
 * clock, random source, or key cannot reach a customer installation.
 */
export const deterministicTestAdapter = Symbol.for(
  "stockcontrol.identity.deterministic-test-adapter",
);

export interface DeterministicTestAdapter {
  readonly [deterministicTestAdapter]?: true;
}

export const isDeterministicTestAdapter = (candidate: unknown): boolean => {
  if (typeof candidate !== "object" && typeof candidate !== "function") {
    return false;
  }

  if (candidate === null) {
    return false;
  }

  return (candidate as DeterministicTestAdapter)[deterministicTestAdapter] === true;
};

export type IdentityPortErrorCode =
  | "DeterministicTestAdapterRejected"
  | "DummyPasswordHashInvalid"
  | "TokenPurposeUnsupported"
  | "InstallationInvalid"
  | "NetworkFactInvalid"
  | "UntrustedActorFact"
  | "RequestContextInvalid"
  | "DeliveryBindingInvalid"
  | "DeliveryEnvelopeInvalid";

/**
 * A configuration or composition failure. Messages never contain key material,
 * tokens, passwords, or any other secret value.
 */
export class IdentityPortError extends Error {
  public constructor(
    public readonly code: IdentityPortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityPortError";
  }
}

/**
 * Rejects any deterministic test adapter reachable from a composed port
 * bundle. Call this from production composition before the application starts.
 */
export const assertNoDeterministicTestAdapters = (
  adapters: Readonly<Record<string, unknown>>,
): void => {
  const marked = Object.keys(adapters)
    .filter((name) => isDeterministicTestAdapter(adapters[name]))
    .sort();

  if (marked.length > 0) {
    throw new IdentityPortError(
      "DeterministicTestAdapterRejected",
      `Deterministic test adapters cannot be composed into a production identity application: ${marked.join(", ")}.`,
    );
  }
};

/** Captured once per command; never read twice inside one transaction. */
export interface IdentityClock {
  now(): Date;
}

/** Supplies stable record identifiers for new identity rows. */
export interface IdentityUuidGenerator {
  next(): string;
}

export interface IdentityPasswordVerification {
  readonly verified: boolean;
  /** True when the stored hash used older, still-supported parameters. */
  readonly needsRehash: boolean;
}

/**
 * Argon2id password hashing. Implementations throw for a malformed or
 * unsupported persisted hash; use cases must convert that into the same
 * generic authentication failure returned for a wrong password.
 */
export interface IdentityPasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<IdentityPasswordVerification>;
}

/**
 * A real, deployment-generated password hash verified when an account does not
 * exist so that account existence cannot be inferred from response timing.
 */
export interface IdentityDummyPasswordHash {
  get(): string;
}

export const identityTokenPurposes = [
  "Bootstrap",
  "AuthChallenge",
  "Session",
  "Invitation",
  "PasswordReset",
] as const;

export type IdentityTokenPurpose = (typeof identityTokenPurposes)[number];

/**
 * Stable hash-domain separators. A token issued for one purpose can never
 * validate against a record stored for another purpose.
 */
export const IDENTITY_TOKEN_DOMAINS: Readonly<Record<IdentityTokenPurpose, string>> = Object.freeze(
  {
    Bootstrap: "identity.bootstrap",
    AuthChallenge: "identity.auth-challenge",
    Session: "identity.session",
    Invitation: "identity.invitation",
    PasswordReset: "identity.password-reset",
  },
);

/*
 * A widened view of the catalogue. An unsupported purpose can still arrive at
 * runtime from persisted or transport data, so the lookup must be able to miss.
 */
const tokenDomains: Readonly<Record<string, string | undefined>> = IDENTITY_TOKEN_DOMAINS;

export const identityTokenDomain = (purpose: IdentityTokenPurpose): string => {
  const domain = tokenDomains[purpose];

  if (domain === undefined) {
    throw new IdentityPortError(
      "TokenPurposeUnsupported",
      "An identity token purpose must be one of the supported purposes.",
    );
  }

  return domain;
};

export interface IdentityTokenIssue {
  /** Returned exactly once. Never persist, log, or place this in a job payload. */
  readonly token: string;
  /** The only representation that may be persisted. */
  readonly hash: Sha256Digest;
}

export interface IdentityTokenService {
  readonly purpose: IdentityTokenPurpose;
  issue(): IdentityTokenIssue;
  hash(token: string): Sha256Digest;
  verify(token: string, persistedHash: Sha256Digest): boolean;
}

export interface IdentityTokenServices {
  for(purpose: IdentityTokenPurpose): IdentityTokenService;
}

export interface IdentityTotpEnrolment {
  /** Display-once material. Encrypt before it crosses the persistence boundary. */
  readonly secret: string;
  /** Display-once material. Never log or audit this value. */
  readonly provisioningUri: string;
}

export interface IdentityTotpVerificationInput {
  readonly secret: string;
  readonly code: string;
  /** Read under a row lock; the caller must advance it in the same transaction. */
  readonly lastAcceptedCounter?: bigint;
}

export type IdentityTotpVerification =
  | { readonly valid: true; readonly counter: bigint }
  | { readonly valid: false; readonly reason: "invalid" | "replayed" };

export interface IdentityTotpService {
  /** The issuer label comes from installation policy, never from a command body. */
  issueEnrolment(accountName: string): IdentityTotpEnrolment;
  verify(input: IdentityTotpVerificationInput): IdentityTotpVerification;
}

/** Maps one-to-one to the persisted TOTP credential envelope columns. */
export interface IdentityEncryptedTotpSecret {
  readonly encryptionVersion: 1;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authTag: Uint8Array;
}

export interface IdentityTotpSecretContext {
  readonly userId: string;
  readonly credentialId: string;
}

export interface IdentityDecryptedTotpSecret {
  readonly secret: string;
  /** Re-encrypt under the active key before the retained key is retired. */
  readonly needsReencrypt: boolean;
}

export interface IdentityTotpSecretCipher {
  readonly activeKeyId: string;
  encrypt(secret: string, context: IdentityTotpSecretContext): IdentityEncryptedTotpSecret;
  decrypt(
    envelope: IdentityEncryptedTotpSecret,
    context: IdentityTotpSecretContext,
  ): IdentityDecryptedTotpSecret;
}

export interface IdentityRecoveryCodeIssue {
  /** Display exactly once. */
  readonly codes: readonly string[];
  /** Persist only these hashes. */
  readonly hashes: readonly Sha256Digest[];
}

export interface IdentityRecoveryCodeService {
  issue(): IdentityRecoveryCodeIssue;
  hash(code: string): Sha256Digest;
  verify(code: string, persistedHash: Sha256Digest): boolean;
}
