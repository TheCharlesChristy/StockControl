import { describe, expect, it } from "vitest";

import {
  constantTimeEqual,
  decodeBase32,
  decodeBase64Url,
  encodeBase32,
  encodeBase64Url,
  requireRandomBytes,
  sha256,
  utf8,
} from "../src/encoding.js";

describe("encoding helpers", () => {
  it("round-trips canonical base64url and enforces its alphabet and length", () => {
    const bytes = Uint8Array.from([0, 1, 2, 253, 254, 255]);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).toBe("AAEC_f7_");
    expect(decodeBase64Url(encoded)).toEqual(bytes);
    expect(decodeBase64Url(encoded, 6)).toEqual(bytes);
    expect(() => decodeBase64Url("")).toThrow("Invalid base64url");
    expect(() => decodeBase64Url("abc=")).toThrow("Invalid base64url");
    expect(() => decodeBase64Url("A")).toThrow("Invalid base64url");
    expect(() => decodeBase64Url(encoded, 5)).toThrow("Invalid base64url");
  });

  it("round-trips padded and unpadded base32 bit lengths", () => {
    expect(encodeBase32(Uint8Array.from([102]))).toBe("MY");
    expect(decodeBase32("MY")).toEqual(Uint8Array.from([102]));
    expect(encodeBase32(Buffer.from("hello"))).toBe("NBSWY3DP");
    expect(decodeBase32("NBSWY3DP")).toEqual(new Uint8Array(Buffer.from("hello")));
    expect(() => decodeBase32("")).toThrow("Invalid base32");
    expect(() => decodeBase32("M1")).toThrow("Invalid base32");
    expect(() => decodeBase32("MZ")).toThrow("padding bits");
  });

  it("creates length-delimited hashes", () => {
    expect(sha256(utf8("ab"), utf8("c"))).not.toEqual(sha256(utf8("a"), utf8("bc")));
    expect(sha256()).toHaveLength(32);
  });

  it("compares strings and byte arrays without accepting length mismatches", () => {
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("same", "nope")).toBe(false);
    expect(constantTimeEqual("a", "aa")).toBe(false);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1), Uint8Array.of(1))).toBe(true);
    expect(constantTimeEqual(Uint8Array.of(1), Uint8Array.of(2))).toBe(false);
  });

  it("defensively copies exact-length entropy", () => {
    const entropy = Uint8Array.of(1, 2);
    const source = {
      bytes: () => entropy,
    };
    const result = requireRandomBytes(source, 2);
    expect(result).toEqual(Uint8Array.of(1, 2));
    expect(result).not.toBe(entropy);
    expect(() => requireRandomBytes(source, 3)).toThrow("expected 3");
  });
});
