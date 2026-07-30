import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  requireRandomBytes,
  sha256,
  utf8,
} from "./encoding.js";
import type { RandomSource } from "./ports.js";

declare const persistedTokenHashBrand: unique symbol;
/**
 * Exactly 32 raw SHA-256 bytes.
 *
 * Construct values only with {@link createPersistedTokenHash}; persist a fresh
 * copy returned by {@link persistedTokenHashBytes} directly to a PostgreSQL
 * `BYTEA` column.
 */
export type PersistedTokenHash = Uint8Array & {
  readonly [persistedTokenHashBrand]: "PersistedTokenHash";
};

declare const opaqueTokenBrand: unique symbol;
export type OpaqueToken = string & { readonly [opaqueTokenBrand]: true };

export interface OpaqueTokenIssue {
  /**
   * Returned exactly once. Callers must never persist or log this value.
   */
  readonly token: OpaqueToken;
  /**
   * The only token representation that may be persisted.
   */
  readonly hash: PersistedTokenHash;
}

export const PERSISTED_TOKEN_HASH_BYTES = 32;
const MIN_TOKEN_BYTES = 32;
const MAX_TOKEN_BYTES = 64;
const MAX_DOMAIN_BYTES = 128;

/**
 * Validates and defensively copies raw digest bytes at the persistence
 * boundary. Text, hexadecimal, base64, and version-prefixed encodings are
 * deliberately not accepted because the database contract is unambiguously
 * 32 raw bytes.
 */
export const createPersistedTokenHash = (value: Uint8Array): PersistedTokenHash => {
  if (!(value instanceof Uint8Array) || value.length !== PERSISTED_TOKEN_HASH_BYTES) {
    throw new RangeError(
      `Persisted token hash must contain exactly ${PERSISTED_TOKEN_HASH_BYTES} bytes.`,
    );
  }
  return new Uint8Array(value) as PersistedTokenHash;
};

/**
 * Returns a fresh unbranded copy suitable for a database driver's `BYTEA`
 * parameter. Mutating the returned value cannot mutate the branded digest.
 */
export const persistedTokenHashBytes = (value: PersistedTokenHash): Uint8Array =>
  createPersistedTokenHash(value);

const domainBytes = (domain: string): Uint8Array => {
  const encoded = utf8(domain);
  if (
    encoded.length < 1 ||
    encoded.length > MAX_DOMAIN_BYTES ||
    !/^[a-z0-9][a-z0-9._:-]*$/u.test(domain)
  ) {
    throw new RangeError("Token domain must be a stable lowercase identifier.");
  }
  return encoded;
};

export class OpaqueTokenService {
  readonly #domain: Uint8Array;

  public constructor(
    private readonly randomSource: RandomSource,
    domain: string,
    private readonly byteLength = MIN_TOKEN_BYTES,
  ) {
    this.#domain = domainBytes(domain);
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength < MIN_TOKEN_BYTES ||
      byteLength > MAX_TOKEN_BYTES
    ) {
      throw new RangeError(
        `Opaque token length must be ${MIN_TOKEN_BYTES}-${MAX_TOKEN_BYTES} bytes.`,
      );
    }
  }

  public issue(): OpaqueTokenIssue {
    const bytes = requireRandomBytes(this.randomSource, this.byteLength);
    try {
      const token = encodeBase64Url(bytes) as OpaqueToken;
      return {
        token,
        hash: this.hash(token),
      };
    } finally {
      bytes.fill(0);
    }
  }

  public hash(token: OpaqueToken | string): PersistedTokenHash {
    const tokenBytes = this.decodeToken(token);
    let digest: Uint8Array | undefined;
    try {
      digest = sha256(utf8("stockcontrol:opaque-token:v1"), this.#domain, tokenBytes);
      return createPersistedTokenHash(digest);
    } finally {
      tokenBytes.fill(0);
      digest?.fill(0);
    }
  }

  public verify(token: OpaqueToken | string, persistedHash: PersistedTokenHash): boolean {
    let expected: Uint8Array | undefined;
    let tokenHash: Uint8Array = new Uint8Array(PERSISTED_TOKEN_HASH_BYTES);
    let tokenBytes: Uint8Array | undefined;

    try {
      expected = persistedTokenHashBytes(persistedHash);
    } catch {
      // Retain a bounded dummy comparison below for a corrupt in-memory value.
    }

    try {
      tokenBytes = this.decodeToken(token);
      tokenHash = sha256(utf8("stockcontrol:opaque-token:v1"), this.#domain, tokenBytes);
    } catch {
      // Retain the fixed-size zero digest.
    } finally {
      tokenBytes?.fill(0);
    }

    const matches = constantTimeEqual(
      tokenHash,
      expected ?? new Uint8Array(PERSISTED_TOKEN_HASH_BYTES),
    );
    tokenHash.fill(0);
    expected?.fill(0);
    return expected !== undefined && matches;
  }

  private decodeToken(token: OpaqueToken | string): Uint8Array {
    if (token.length !== Math.ceil((this.byteLength * 4) / 3)) {
      throw new Error("Invalid opaque token length.");
    }
    return decodeBase64Url(token, this.byteLength);
  }
}

export const SESSION_TOKEN_DOMAIN = "identity.session";

export class SessionTokenService {
  readonly #tokens: OpaqueTokenService;

  public constructor(randomSource: RandomSource) {
    this.#tokens = new OpaqueTokenService(randomSource, SESSION_TOKEN_DOMAIN);
  }

  public issue(): OpaqueTokenIssue {
    return this.#tokens.issue();
  }

  public hash(token: OpaqueToken | string): PersistedTokenHash {
    return this.#tokens.hash(token);
  }

  public verify(token: OpaqueToken | string, persistedHash: PersistedTokenHash): boolean {
    return this.#tokens.verify(token, persistedHash);
  }
}

export interface SecureCookieOptions {
  readonly httpOnly: true;
  readonly secure: true;
  readonly sameSite: "lax";
  readonly path: "/";
}

export interface SecureCookieDefinition {
  readonly name: `__Host-${string}`;
  readonly options: SecureCookieOptions;
}

export const SESSION_COOKIE: SecureCookieDefinition = Object.freeze({
  name: "__Host-stockcontrol_session",
  options: Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  }),
});
