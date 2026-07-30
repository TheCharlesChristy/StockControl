import {
  constantTimeEqual,
  decodeBase64Url,
  encodeBase64Url,
  requireRandomBytes,
  utf8,
} from "./encoding.js";
import type { Argon2idDeriver, RandomSource } from "./ports.js";

declare const passwordHashBrand: unique symbol;
export type PasswordHash = string & { readonly [passwordHashBrand]: true };

export interface PasswordHashPolicy {
  readonly encodingVersion: 1;
  readonly argonVersion: 19;
  readonly memoryKiB: 65_536;
  readonly passes: 3;
  readonly parallelism: 1;
  readonly saltLength: 16;
  readonly tagLength: 32;
}

export const PASSWORD_HASH_POLICY: PasswordHashPolicy = Object.freeze({
  encodingVersion: 1,
  argonVersion: 19,
  memoryKiB: 65_536,
  passes: 3,
  parallelism: 1,
  saltLength: 16,
  tagLength: 32,
});

export const MAX_PASSWORD_BYTES = 1_024;

interface ParsedPasswordHash {
  readonly policyVersion: number;
  readonly argonVersion: number;
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly tagLength: number;
  readonly salt: Uint8Array;
  readonly tag: Uint8Array;
}

export interface PasswordVerification {
  readonly verified: boolean;
  readonly needsRehash: boolean;
}

export class InvalidPasswordHashError extends Error {
  public constructor(message = "The persisted password hash is malformed or unsupported.") {
    super(message);
    this.name = "InvalidPasswordHashError";
  }
}

const ENCODING_PATTERN =
  /^\$sc-argon2id\$v=(\d+)\$a=(\d+),m=(\d+),t=(\d+),p=(\d+),l=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u;
const MAX_ENCODED_PASSWORD_HASH_LENGTH = 512;

const parseInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== value) {
    throw new InvalidPasswordHashError();
  }
  return parsed;
};

const parsePasswordHash = (encoded: string): ParsedPasswordHash => {
  if (encoded.length > MAX_ENCODED_PASSWORD_HASH_LENGTH) {
    throw new InvalidPasswordHashError();
  }
  const match = ENCODING_PATTERN.exec(encoded);
  if (match === null) {
    throw new InvalidPasswordHashError();
  }

  const policyVersionText = match[1]!;
  const argonVersionText = match[2]!;
  const memoryText = match[3]!;
  const passesText = match[4]!;
  const parallelismText = match[5]!;
  const tagLengthText = match[6]!;
  const saltText = match[7]!;
  const tagText = match[8]!;

  const parsed: ParsedPasswordHash = {
    policyVersion: parseInteger(policyVersionText),
    argonVersion: parseInteger(argonVersionText),
    memoryKiB: parseInteger(memoryText),
    passes: parseInteger(passesText),
    parallelism: parseInteger(parallelismText),
    tagLength: parseInteger(tagLengthText),
    salt: decodePasswordPart(saltText),
    tag: decodePasswordPart(tagText),
  };

  if (
    parsed.policyVersion !== PASSWORD_HASH_POLICY.encodingVersion ||
    parsed.argonVersion !== PASSWORD_HASH_POLICY.argonVersion ||
    parsed.memoryKiB < 19_456 ||
    parsed.memoryKiB > PASSWORD_HASH_POLICY.memoryKiB ||
    parsed.passes < 2 ||
    parsed.passes > 5 ||
    parsed.parallelism < 1 ||
    parsed.parallelism > 4 ||
    parsed.salt.length < PASSWORD_HASH_POLICY.saltLength ||
    parsed.salt.length > 64 ||
    parsed.tagLength < PASSWORD_HASH_POLICY.tagLength ||
    parsed.tagLength > 64 ||
    parsed.tag.length !== parsed.tagLength
  ) {
    throw new InvalidPasswordHashError();
  }

  return parsed;
};

const decodePasswordPart = (value: string): Uint8Array => {
  try {
    return decodeBase64Url(value);
  } catch {
    throw new InvalidPasswordHashError();
  }
};

const encodePasswordHash = (
  policy: PasswordHashPolicy,
  salt: Uint8Array,
  tag: Uint8Array,
): PasswordHash =>
  `$sc-argon2id$v=${policy.encodingVersion}$a=${policy.argonVersion},m=${policy.memoryKiB},t=${policy.passes},p=${policy.parallelism},l=${policy.tagLength}$${encodeBase64Url(salt)}$${encodeBase64Url(tag)}` as PasswordHash;

const passwordBytes = (password: string): Uint8Array => {
  const bytes = utf8(password);
  if (bytes.length < 1 || bytes.length > MAX_PASSWORD_BYTES) {
    throw new RangeError(`Password must encode to between 1 and ${MAX_PASSWORD_BYTES} bytes.`);
  }
  return bytes;
};

const usesCurrentPolicy = (parsed: ParsedPasswordHash): boolean =>
  parsed.policyVersion === PASSWORD_HASH_POLICY.encodingVersion &&
  parsed.argonVersion === PASSWORD_HASH_POLICY.argonVersion &&
  parsed.memoryKiB === PASSWORD_HASH_POLICY.memoryKiB &&
  parsed.passes === PASSWORD_HASH_POLICY.passes &&
  parsed.parallelism === PASSWORD_HASH_POLICY.parallelism &&
  parsed.salt.length === PASSWORD_HASH_POLICY.saltLength &&
  parsed.tagLength === PASSWORD_HASH_POLICY.tagLength;

export class PasswordHashingService {
  public constructor(
    private readonly randomSource: RandomSource,
    private readonly deriver: Argon2idDeriver,
  ) {}

  public async hash(password: string): Promise<PasswordHash> {
    const message = passwordBytes(password);
    try {
      const salt = requireRandomBytes(this.randomSource, PASSWORD_HASH_POLICY.saltLength);
      const tag = await this.deriver.derive({
        message,
        nonce: salt,
        memoryKiB: PASSWORD_HASH_POLICY.memoryKiB,
        passes: PASSWORD_HASH_POLICY.passes,
        parallelism: PASSWORD_HASH_POLICY.parallelism,
        tagLength: PASSWORD_HASH_POLICY.tagLength,
      });
      try {
        if (tag.length !== PASSWORD_HASH_POLICY.tagLength) {
          throw new Error(
            `Argon2id deriver returned ${tag.length} bytes; expected ${PASSWORD_HASH_POLICY.tagLength}.`,
          );
        }
        return encodePasswordHash(PASSWORD_HASH_POLICY, salt, tag);
      } finally {
        tag.fill(0);
      }
    } finally {
      message.fill(0);
    }
  }

  public async verify(
    password: string,
    encoded: PasswordHash | string,
  ): Promise<PasswordVerification> {
    const parsed = parsePasswordHash(encoded);
    const message = passwordBytes(password);
    try {
      const actualTag = await this.deriver.derive({
        message,
        nonce: parsed.salt,
        memoryKiB: parsed.memoryKiB,
        passes: parsed.passes,
        parallelism: parsed.parallelism,
        tagLength: parsed.tagLength,
      });
      try {
        const verified = constantTimeEqual(actualTag, parsed.tag);

        return {
          verified,
          needsRehash: verified && !usesCurrentPolicy(parsed),
        };
      } finally {
        actualTag.fill(0);
      }
    } finally {
      message.fill(0);
    }
  }
}
