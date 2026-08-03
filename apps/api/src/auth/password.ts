import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for the demo, using scrypt from Node's standard library so
 * there is no native dependency to build. Parameters are stored alongside the
 * hash, so they can be raised later without invalidating existing passwords.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: {
    readonly N: number;
    readonly maxmem: number;
    readonly p: number;
    readonly r: number;
  },
) => Promise<Buffer>;

const ALGORITHM = "scrypt";
const COST = 32_768;
const LEGACY_COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

/** Valid-format work used when an email address does not identify an account. */
export const DUMMY_PASSWORD_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, {
    N: COST,
    maxmem: MAX_MEMORY_BYTES,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });

  return [
    ALGORITHM,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELISM),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");

  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    return false;
  }

  const [, cost, blockSize, parallelism, salt, expected] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expectedKey = Buffer.from(expected, "base64url");
  const saltBytes = Buffer.from(salt, "base64url");
  const parsedCost = Number(cost);
  const parsedBlockSize = Number(blockSize);
  const parsedParallelism = Number(parallelism);

  if (
    expectedKey.length !== KEY_BYTES ||
    saltBytes.length !== SALT_BYTES ||
    (parsedCost !== LEGACY_COST && parsedCost !== COST) ||
    parsedBlockSize !== BLOCK_SIZE ||
    parsedParallelism !== PARALLELISM
  ) {
    return false;
  }

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize("NFKC"), saltBytes, expectedKey.length, {
      N: parsedCost,
      maxmem: MAX_MEMORY_BYTES,
      r: parsedBlockSize,
      p: parsedParallelism,
    });
  } catch {
    return false;
  }

  return timingSafeEqual(derived, expectedKey);
}
