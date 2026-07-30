import { createHmac } from "node:crypto";

import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  requireRandomBytes,
  utf8,
} from "./encoding.js";
import type { RandomSource } from "./ports.js";
import type { SecureCookieDefinition } from "./tokens.js";

export const CSRF_HEADER_NAME = "x-csrf-token";
/**
 * Stable, non-secret binding for browser mutations that necessarily happen
 * before an authenticated session exists (sign-in, bootstrap, invitation
 * acceptance, and password reset). The random signed double-submit token still
 * supplies per-issuance unpredictability.
 *
 * Discard this token and issue a session-bound token immediately after
 * authentication or any session rotation.
 */
export const PRE_AUTH_CSRF_BINDING = "identity.pre-auth:v1";
export const CSRF_COOKIE: SecureCookieDefinition = Object.freeze({
  name: "__Host-stockcontrol_csrf",
  options: Object.freeze({
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  }),
});

export interface CsrfSigningKeyInput {
  readonly id: string;
  readonly secret: Uint8Array;
}

export interface CsrfKeyringInput {
  readonly activeKeyId: string;
  /**
   * Include the active key and any previous keys still needed during rotation.
   */
  readonly keys: readonly CsrfSigningKeyInput[];
}

export interface CsrfTokenIssue {
  /**
   * Set this as the HttpOnly cookie and return it once to the client for the request header.
   */
  readonly token: string;
}

interface CsrfSigningKey {
  readonly id: string;
  readonly secret: Uint8Array;
}

const CSRF_PREFIX = "$sc-csrf$v=1$";
const CSRF_PATTERN = /^\$sc-csrf\$v=1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;
const CSRF_RANDOM_BYTES = 32;
const MIN_SIGNING_KEY_BYTES = 32;
const MAX_SIGNING_KEY_BYTES = 128;

const validateKeyId = (id: string): void => {
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(id)) {
    throw new RangeError("CSRF signing key id must be 1-32 URL-safe characters.");
  }
};

const validateSessionBinding = (binding: string): Uint8Array => {
  if (binding.length > 512) {
    throw new RangeError("CSRF session binding must contain 1-512 bytes.");
  }
  const encoded = utf8(binding);
  if (encoded.length < 1 || encoded.length > 512) {
    throw new RangeError("CSRF session binding must contain 1-512 bytes.");
  }
  return encoded;
};

const signatureFor = (
  key: CsrfSigningKey,
  nonce: Uint8Array,
  sessionBinding: Uint8Array,
): Uint8Array => {
  const hmac = createHmac("sha256", key.secret);
  for (const part of [utf8("stockcontrol:csrf:v1"), utf8(key.id), nonce, sessionBinding]) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(part.length);
    hmac.update(length);
    hmac.update(part);
  }
  return new Uint8Array(hmac.digest());
};

export class CsrfTokenService {
  readonly #activeKey: CsrfSigningKey;
  readonly #keys: ReadonlyMap<string, CsrfSigningKey>;

  public constructor(
    private readonly randomSource: RandomSource,
    keyring: CsrfKeyringInput,
  ) {
    validateKeyId(keyring.activeKeyId);
    if (keyring.keys.length < 1) {
      throw new RangeError("CSRF keyring must contain at least one key.");
    }

    const keys = new Map<string, CsrfSigningKey>();
    for (const input of keyring.keys) {
      validateKeyId(input.id);
      if (
        input.secret.length < MIN_SIGNING_KEY_BYTES ||
        input.secret.length > MAX_SIGNING_KEY_BYTES
      ) {
        throw new RangeError(
          `CSRF signing keys must contain ${MIN_SIGNING_KEY_BYTES}-${MAX_SIGNING_KEY_BYTES} bytes.`,
        );
      }
      if (keys.has(input.id)) {
        throw new Error(`Duplicate CSRF signing key id: ${input.id}.`);
      }
      keys.set(input.id, {
        id: input.id,
        secret: new Uint8Array(input.secret),
      });
    }

    const activeKey = keys.get(keyring.activeKeyId);
    if (activeKey === undefined) {
      throw new Error("Active CSRF signing key is not present in the keyring.");
    }
    this.#activeKey = activeKey;
    this.#keys = keys;
  }

  public issue(sessionBinding: string): CsrfTokenIssue {
    const binding = validateSessionBinding(sessionBinding);
    const nonce = requireRandomBytes(this.randomSource, CSRF_RANDOM_BYTES);
    const signature = signatureFor(this.#activeKey, nonce, binding);
    return {
      token: `${CSRF_PREFIX}${this.#activeKey.id}$${encodeBase64Url(nonce)}$${encodeBase64Url(signature)}`,
    };
  }

  /**
   * Issues a signed double-submit token for a browser with no authenticated
   * session. Apply the same exact-origin policy as authenticated mutations.
   */
  public issuePreAuthentication(): CsrfTokenIssue {
    return this.issue(PRE_AUTH_CSRF_BINDING);
  }

  public verify(cookieToken: string, headerToken: string, sessionBinding: string): boolean {
    const binding = validateSessionBinding(sessionBinding);
    if (cookieToken.length > 512 || headerToken.length > 512) {
      return false;
    }
    const tokensMatch = constantTimeEqual(cookieToken, headerToken);
    const match = CSRF_PATTERN.exec(cookieToken);
    const keyId = match?.[1];
    const nonceText = match?.[2];
    const signatureText = match?.[3];
    if (
      !tokensMatch ||
      keyId === undefined ||
      nonceText === undefined ||
      signatureText === undefined
    ) {
      return false;
    }

    const key = this.#keys.get(keyId);
    if (key === undefined) {
      return false;
    }

    try {
      const nonce = decodeBase64Url(nonceText, CSRF_RANDOM_BYTES);
      const suppliedSignature = decodeBase64Url(signatureText, 32);
      const expectedSignature = signatureFor(key, nonce, binding);
      return constantTimeEqual(suppliedSignature, expectedSignature);
    } catch {
      return false;
    }
  }

  /**
   * Verifies only the pre-authentication binding. It must never authorize an
   * authenticated mutation; rotate to a session-bound token after sign-in.
   */
  public verifyPreAuthentication(cookieToken: string, headerToken: string): boolean {
    return this.verify(cookieToken, headerToken, PRE_AUTH_CSRF_BINDING);
  }
}
