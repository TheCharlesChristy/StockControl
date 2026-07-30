import { createHash, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

export const utf8 = (value: string): Uint8Array => Buffer.from(value, "utf8");

export const encodeBase64Url = (value: Uint8Array): string =>
  Buffer.from(value).toString("base64url");

export const decodeBase64Url = (value: string, expectedLength?: number): Uint8Array => {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    throw new Error("Invalid base64url encoding.");
  }

  const decoded = Buffer.from(value, "base64url");
  if (
    encodeBase64Url(decoded) !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new Error("Invalid base64url encoding.");
  }

  return new Uint8Array(decoded);
};

export const encodeBase32 = (value: Uint8Array): string => {
  let bits = 0;
  let accumulator = 0;
  let encoded = "";

  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
  }

  if (bits > 0) {
    encoded += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  }

  return encoded;
};

export const decodeBase32 = (value: string): Uint8Array => {
  if (value.length === 0 || !/^[A-Z2-7]+$/u.test(value)) {
    throw new Error("Invalid base32 encoding.");
  }

  const decoded: number[] = [];
  let bits = 0;
  let accumulator = 0;

  for (const character of value) {
    const index = BASE32_ALPHABET.indexOf(character);
    accumulator = (accumulator << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      decoded.push((accumulator >>> bits) & 255);
    }
  }

  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    throw new Error("Invalid base32 padding bits.");
  }

  return new Uint8Array(decoded);
};

export const sha256 = (...parts: readonly Uint8Array[]): Uint8Array => {
  const hash = createHash("sha256");
  for (const part of parts) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(part.length);
    hash.update(length);
    hash.update(part);
  }
  return new Uint8Array(hash.digest());
};

export const constantTimeEqual = (
  left: Uint8Array | string,
  right: Uint8Array | string,
): boolean => {
  const leftBytes = typeof left === "string" ? utf8(left) : left;
  const rightBytes = typeof right === "string" ? utf8(right) : right;
  const comparisonDomain = utf8("stockcontrol:constant-time-equality:v1");
  const leftDigest = sha256(comparisonDomain, leftBytes);
  const rightDigest = sha256(comparisonDomain, rightBytes);
  return timingSafeEqual(leftDigest, rightDigest);
};

export const requireRandomBytes = (randomSource: RandomSourceLike, length: number): Uint8Array => {
  const generated = randomSource.bytes(length);
  if (generated.length !== length) {
    throw new Error(`Random source returned ${generated.length} bytes; expected ${length}.`);
  }
  return new Uint8Array(generated);
};

interface RandomSourceLike {
  bytes(length: number): Uint8Array;
}
