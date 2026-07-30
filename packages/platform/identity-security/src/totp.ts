import { createHmac } from "node:crypto";

import { constantTimeEqual, decodeBase32, encodeBase32, requireRandomBytes } from "./encoding.js";
import type { Clock, RandomSource } from "./ports.js";

declare const totpSecretBrand: unique symbol;
export type TotpSecret = string & { readonly [totpSecretBrand]: true };

export interface TotpPolicy {
  readonly algorithm: "SHA1";
  readonly digits: 6;
  readonly periodSeconds: 30;
  readonly secretBytes: 20;
  readonly maximumVerificationWindow: 1;
}

export const TOTP_POLICY: TotpPolicy = Object.freeze({
  algorithm: "SHA1",
  digits: 6,
  periodSeconds: 30,
  secretBytes: 20,
  maximumVerificationWindow: 1,
});

export interface TotpEnrollment {
  /**
   * Return this once to the enrolment flow. Persist only in an encrypted credential store.
   */
  readonly secret: TotpSecret;
  /**
   * Return this once for authenticator enrolment. Never log it.
   */
  readonly provisioningUri: string;
}

export interface TotpVerificationInput {
  readonly secret: TotpSecret | string;
  readonly code: string;
  /**
   * The counter from the last successful verification, read under a lock or CAS operation.
   */
  readonly lastAcceptedCounter?: bigint;
}

export type TotpVerification =
  | { readonly valid: true; readonly counter: bigint }
  | { readonly valid: false; readonly reason: "invalid" | "replayed" };

const normalizeSecret = (secret: string): string => {
  if (secret.length > 256) {
    throw new RangeError("TOTP secret is too long.");
  }
  const normalized = secret.toUpperCase().replaceAll(/[\s-]/gu, "");
  if (normalized.length < 26 || normalized.length > 103) {
    throw new RangeError("TOTP secret must contain 16-64 bytes.");
  }
  const decoded = decodeBase32(normalized);
  decoded.fill(0);
  return normalized;
};

const validateLabel = (value: string, name: string): string => {
  if (value.length > 400) {
    throw new RangeError(`${name} must contain 1-200 characters.`);
  }
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 200) {
    throw new RangeError(`${name} must contain 1-200 characters.`);
  }
  return normalized;
};

export const createTotpProvisioningUri = (
  issuer: string,
  accountName: string,
  secret: TotpSecret | string,
): string => {
  const normalizedIssuer = validateLabel(issuer, "Issuer");
  const normalizedAccount = validateLabel(accountName, "Account name");
  const normalizedSecret = normalizeSecret(secret);
  const label = `${encodeURIComponent(normalizedIssuer)}:${encodeURIComponent(normalizedAccount)}`;
  const query = new URLSearchParams({
    secret: normalizedSecret,
    issuer: normalizedIssuer,
    algorithm: TOTP_POLICY.algorithm,
    digits: String(TOTP_POLICY.digits),
    period: String(TOTP_POLICY.periodSeconds),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
};

const validateCounter = (counter: bigint): void => {
  if (counter < 0n || counter > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError("TOTP counter must fit an unsigned 64-bit integer.");
  }
};

export const generateHotp = (
  secret: TotpSecret | string,
  counter: bigint,
  digits: 6 | 8 = 6,
): string => {
  validateCounter(counter);
  const secretBytes = decodeBase32(normalizeSecret(secret));
  try {
    const counterBytes = Buffer.alloc(8);
    counterBytes.writeBigUInt64BE(counter);
    const digest = createHmac("sha1", secretBytes).update(counterBytes).digest();
    const offset = digest.at(-1)! & 0x0f;
    const binary =
      ((digest[offset]! & 0x7f) << 24) |
      (digest[offset + 1]! << 16) |
      (digest[offset + 2]! << 8) |
      digest[offset + 3]!;
    const modulus = digits === 6 ? 1_000_000 : 100_000_000;
    return String(binary % modulus).padStart(digits, "0");
  } finally {
    secretBytes.fill(0);
  }
};

const counterAt = (date: Date): bigint => {
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new RangeError("Clock returned an invalid date.");
  }
  return BigInt(Math.floor(timestamp / 1_000 / TOTP_POLICY.periodSeconds));
};

const verificationOffsets = (window: number): readonly number[] =>
  window === 0 ? [0] : [0, -1, 1];

export class TotpService {
  public constructor(
    private readonly clock: Clock,
    private readonly randomSource: RandomSource,
    private readonly verificationWindow: 0 | 1 = 1,
  ) {
    if (
      !Number.isInteger(verificationWindow) ||
      verificationWindow < 0 ||
      verificationWindow > TOTP_POLICY.maximumVerificationWindow
    ) {
      throw new RangeError(
        `TOTP verification window must be 0-${TOTP_POLICY.maximumVerificationWindow}.`,
      );
    }
  }

  public issueEnrollment(issuer: string, accountName: string): TotpEnrollment {
    const secretBytes = requireRandomBytes(this.randomSource, TOTP_POLICY.secretBytes);
    try {
      const secret = encodeBase32(secretBytes) as TotpSecret;
      return {
        secret,
        provisioningUri: createTotpProvisioningUri(issuer, accountName, secret),
      };
    } finally {
      secretBytes.fill(0);
    }
  }

  public verify(input: TotpVerificationInput): TotpVerification {
    if (!/^\d{6}$/u.test(input.code)) {
      return { valid: false, reason: "invalid" };
    }
    if (input.lastAcceptedCounter !== undefined) {
      validateCounter(input.lastAcceptedCounter);
    }

    const currentCounter = counterAt(this.clock.now());
    let matchedReplay = false;

    for (const offset of verificationOffsets(this.verificationWindow)) {
      const candidateCounter = currentCounter + BigInt(offset);
      if (candidateCounter < 0n) {
        continue;
      }
      const expected = generateHotp(input.secret, candidateCounter, TOTP_POLICY.digits);
      if (constantTimeEqual(input.code, expected)) {
        if (
          input.lastAcceptedCounter !== undefined &&
          candidateCounter <= input.lastAcceptedCounter
        ) {
          matchedReplay = true;
          continue;
        }
        return { valid: true, counter: candidateCounter };
      }
    }

    return { valid: false, reason: matchedReplay ? "replayed" : "invalid" };
  }
}
