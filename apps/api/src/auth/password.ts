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
  options: { readonly N: number; readonly r: number; readonly p: number },
) => Promise<Buffer>;

const ALGORITHM = "scrypt";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_BYTES, {
    N: COST,
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

  if (expectedKey.length === 0) {
    return false;
  }

  const derived = await scryptAsync(
    password.normalize("NFKC"),
    Buffer.from(salt, "base64url"),
    expectedKey.length,
    { N: Number(cost), r: Number(blockSize), p: Number(parallelism) },
  );

  return timingSafeEqual(derived, expectedKey);
}
