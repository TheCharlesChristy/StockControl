import { describe, expect, it } from "vitest";

import {
  SHA256_DIGEST_BYTES,
  createSha256Digest,
  sha256DigestBytes,
} from "../src/identity/ports/persistence";

describe("identity persistence values", () => {
  it("bridges exactly 32 raw digest bytes using defensive copies", () => {
    const source = new Uint8Array(SHA256_DIGEST_BYTES).fill(7);
    const digest = createSha256Digest(source);
    source.fill(0);

    expect(digest).toEqual(new Uint8Array(SHA256_DIGEST_BYTES).fill(7));
    expect(digest).not.toBe(source);

    const adapterBytes = sha256DigestBytes(digest);
    adapterBytes.fill(9);
    expect(digest).toEqual(new Uint8Array(SHA256_DIGEST_BYTES).fill(7));
    expect(adapterBytes).not.toBe(digest);
  });

  it("rejects encoded strings and every non-SHA-256 byte length", () => {
    expect(() => createSha256Digest(new Uint8Array(31))).toThrow("exactly 32");
    expect(() => createSha256Digest(new Uint8Array(33))).toThrow("exactly 32");
    expect(() => createSha256Digest("a".repeat(32) as unknown as Uint8Array)).toThrow("exactly 32");
  });
});
