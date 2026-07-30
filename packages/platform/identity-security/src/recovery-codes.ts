import { encodeBase32, requireRandomBytes } from "./encoding.js";
import type { RandomSource } from "./ports.js";
import { OpaqueTokenService, type PersistedTokenHash } from "./tokens.js";

declare const recoveryCodeBrand: unique symbol;
export type RecoveryCode = string & { readonly [recoveryCodeBrand]: true };

export interface RecoveryCodeIssue {
  /**
   * Display exactly once. These values must not be logged or persisted.
   */
  readonly codes: readonly RecoveryCode[];
  /**
   * Persist these hashes. They reveal neither the codes nor their ordering semantics.
   */
  readonly hashes: readonly PersistedTokenHash[];
}

export interface RecoveryCodeConsumption {
  readonly consumed: boolean;
  /**
   * Atomically replace the persisted hash set with this value when consumed is true.
   */
  readonly remainingHashes: readonly PersistedTokenHash[];
}

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_RANDOM_BYTES = 10;
const MAX_RECOVERY_CODES = 20;
const RECOVERY_CODE_DOMAIN = "identity.recovery-code";

export const normalizeRecoveryCode = (candidate: string): string | undefined => {
  if (candidate.length > 128) {
    return undefined;
  }
  const normalized = candidate.toUpperCase().replaceAll(/[\s-]/gu, "");
  if (!/^[A-Z2-7]{16}$/u.test(normalized)) {
    return undefined;
  }
  return normalized;
};

const formatRecoveryCode = (normalized: string): RecoveryCode =>
  normalized.match(/.{1,4}/gu)!.join("-") as RecoveryCode;

const expandRecoveryCode = (normalized: string): string =>
  Buffer.from(normalized.repeat(2), "ascii").toString("base64url");

export class RecoveryCodeService {
  readonly #tokenHashes: OpaqueTokenService;

  public constructor(
    private readonly randomSource: RandomSource,
    private readonly count: number = RECOVERY_CODE_COUNT,
  ) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RECOVERY_CODES) {
      throw new RangeError(`Recovery code count must be 1-${MAX_RECOVERY_CODES}.`);
    }
    this.#tokenHashes = new OpaqueTokenService(randomSource, RECOVERY_CODE_DOMAIN, 32);
  }

  public issue(): RecoveryCodeIssue {
    const normalizedCodes = new Set<string>();
    const maximumAttempts = this.count * 4;

    for (
      let attempt = 0;
      attempt < maximumAttempts && normalizedCodes.size < this.count;
      attempt += 1
    ) {
      const bytes = requireRandomBytes(this.randomSource, RECOVERY_CODE_RANDOM_BYTES);
      try {
        normalizedCodes.add(encodeBase32(bytes));
      } finally {
        bytes.fill(0);
      }
    }

    if (normalizedCodes.size !== this.count) {
      throw new Error("Random source failed to produce unique recovery codes.");
    }

    const codes = [...normalizedCodes].map(formatRecoveryCode);
    return {
      codes,
      hashes: codes.map((code) => this.hash(code)),
    };
  }

  public hash(candidate: RecoveryCode | string): PersistedTokenHash {
    const normalized = normalizeRecoveryCode(candidate);
    if (normalized === undefined) {
      throw new Error("Recovery code is malformed.");
    }

    /*
     * The generic token service requires at least 32 random bytes. Repeating the
     * canonical 80-bit recovery code constructs a fixed, canonical 32-byte token
     * input while retaining the original code's full entropy.
     */
    return this.#tokenHashes.hash(expandRecoveryCode(normalized));
  }

  public verify(candidate: RecoveryCode | string, persistedHash: PersistedTokenHash): boolean {
    const normalized = normalizeRecoveryCode(candidate);
    if (normalized === undefined) {
      return false;
    }
    return this.#tokenHashes.verify(expandRecoveryCode(normalized), persistedHash);
  }

  public consume(
    candidate: RecoveryCode | string,
    persistedHashes: readonly PersistedTokenHash[],
  ): RecoveryCodeConsumption {
    const matches = persistedHashes.map((hash) => this.verify(candidate, hash));
    const consumed = matches.includes(true);
    return {
      consumed,
      remainingHashes: consumed
        ? persistedHashes.filter((_, index) => !matches[index])
        : [...persistedHashes],
    };
  }
}
