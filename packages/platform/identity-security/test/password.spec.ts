import { describe, expect, it } from "vitest";

import { encodeBase64Url, utf8 } from "../src/encoding.js";
import { NodeCryptoArgon2idDeriver } from "../src/node-adapters.js";
import {
  InvalidPasswordHashError,
  MAX_PASSWORD_BYTES,
  PASSWORD_HASH_POLICY,
  PasswordHashingService,
} from "../src/password.js";
import type { Argon2idDeriver } from "../src/ports.js";
import {
  DeterministicArgon2idDeriver,
  FixedRandomSource,
  IncrementingRandomSource,
} from "./helpers.js";

const encodeHash = (input?: {
  policyVersion?: string;
  argonVersion?: string;
  memory?: string;
  passes?: string;
  parallelism?: string;
  tagLength?: string;
  salt?: Uint8Array | string;
  tag?: Uint8Array | string;
}): string => {
  const salt =
    typeof input?.salt === "string"
      ? input.salt
      : encodeBase64Url(input?.salt ?? new Uint8Array(16));
  const tag =
    typeof input?.tag === "string" ? input.tag : encodeBase64Url(input?.tag ?? new Uint8Array(32));
  return `$sc-argon2id$v=${input?.policyVersion ?? "1"}$a=${input?.argonVersion ?? "19"},m=${input?.memory ?? "65536"},t=${input?.passes ?? "3"},p=${input?.parallelism ?? "1"},l=${input?.tagLength ?? "32"}$${salt}$${tag}`;
};

describe("password hashing", () => {
  it("publishes the locked Argon2id policy", () => {
    expect(PASSWORD_HASH_POLICY).toEqual({
      encodingVersion: 1,
      argonVersion: 19,
      memoryKiB: 65_536,
      passes: 3,
      parallelism: 1,
      saltLength: 16,
      tagLength: 32,
    });
    expect(Object.isFrozen(PASSWORD_HASH_POLICY)).toBe(true);
    expect(MAX_PASSWORD_BYTES).toBe(1_024);
  });

  it("hashes with fresh salt and verifies without retaining the password", async () => {
    const random = new IncrementingRandomSource();
    const deriver = new DeterministicArgon2idDeriver();
    const service = new PasswordHashingService(random, deriver);

    const first = await service.hash("correct horse battery staple");
    const second = await service.hash("correct horse battery staple");

    expect(first).toMatch(
      /^\$sc-argon2id\$v=1\$a=19,m=65536,t=3,p=1,l=32\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/u,
    );
    expect(first).not.toContain("correct");
    expect(second).not.toBe(first);
    expect(await service.verify("correct horse battery staple", first)).toEqual({
      verified: true,
      needsRehash: false,
    });
    expect(await service.verify("incorrect", first)).toEqual({
      verified: false,
      needsRehash: false,
    });
    expect(deriver.calls[0]).toMatchObject({
      memoryKiB: 65_536,
      passes: 3,
      parallelism: 1,
      tagLength: 32,
    });
    expect(deriver.calls[0]?.nonce).toHaveLength(16);
    expect(deriver.calls.every((call) => call.message.every((byte) => byte === 0))).toBe(true);
  });

  it("verifies a supported older parameter set and requests a rehash", async () => {
    const deriver = new DeterministicArgon2idDeriver();
    const salt = Uint8Array.from({ length: 20 }, (_, index) => index);
    const tag = await deriver.derive({
      message: utf8("legacy password"),
      nonce: salt,
      memoryKiB: 32_768,
      passes: 2,
      parallelism: 2,
      tagLength: 48,
    });
    const encoded = encodeHash({
      memory: "32768",
      passes: "2",
      parallelism: "2",
      tagLength: "48",
      salt,
      tag,
    });
    const service = new PasswordHashingService(new IncrementingRandomSource(), deriver);

    await expect(service.verify("legacy password", encoded)).resolves.toEqual({
      verified: true,
      needsRehash: true,
    });
  });

  it("round-trips the locked 64 MiB policy through Node's real Argon2id", async () => {
    const service = new PasswordHashingService(
      new FixedRandomSource(Uint8Array.from({ length: 16 }, (_, index) => index)),
      new NodeCryptoArgon2idDeriver(),
    );
    const hash = await service.hash("real Argon2id boundary");
    await expect(service.verify("real Argon2id boundary", hash)).resolves.toEqual({
      verified: true,
      needsRehash: false,
    });
  });

  it.each([
    ["not PHC", "not-a-hash"],
    ["oversized encoding", "x".repeat(513)],
    ["unsafe integer", encodeHash({ policyVersion: "999999999999999999999" })],
    ["noncanonical integer", encodeHash({ memory: "065536" })],
    ["policy version", encodeHash({ policyVersion: "2" })],
    ["Argon version", encodeHash({ argonVersion: "20" })],
    ["low memory", encodeHash({ memory: "19455" })],
    ["high memory", encodeHash({ memory: "65537" })],
    ["low passes", encodeHash({ passes: "1" })],
    ["high passes", encodeHash({ passes: "6" })],
    ["low parallelism", encodeHash({ parallelism: "0" })],
    ["high parallelism", encodeHash({ parallelism: "5" })],
    ["short salt", encodeHash({ salt: new Uint8Array(15) })],
    ["long salt", encodeHash({ salt: new Uint8Array(65) })],
    ["short tag policy", encodeHash({ tagLength: "31", tag: new Uint8Array(31) })],
    ["long tag policy", encodeHash({ tagLength: "65", tag: new Uint8Array(65) })],
    ["mismatched tag", encodeHash({ tagLength: "32", tag: new Uint8Array(31) })],
    ["invalid salt encoding", encodeHash({ salt: "A" })],
    ["invalid tag encoding", encodeHash({ tag: "A" })],
  ])("rejects malformed or dangerous persisted hashes: %s", async (_name, encoded) => {
    const service = new PasswordHashingService(
      new IncrementingRandomSource(),
      new DeterministicArgon2idDeriver(),
    );
    await expect(service.verify("password", encoded)).rejects.toBeInstanceOf(
      InvalidPasswordHashError,
    );
  });

  it("rejects passwords outside the primitive's resource bounds", async () => {
    const service = new PasswordHashingService(
      new IncrementingRandomSource(),
      new DeterministicArgon2idDeriver(),
    );
    await expect(service.hash("")).rejects.toThrow("between 1");
    await expect(service.hash("a".repeat(MAX_PASSWORD_BYTES + 1))).rejects.toThrow("between 1");
    await expect(service.verify("", encodeHash())).rejects.toThrow("between 1");
  });

  it("rejects a broken entropy source or deriver", async () => {
    const deriver = new DeterministicArgon2idDeriver();
    const shortRandom = new FixedRandomSource(new Uint8Array(15));
    await expect(new PasswordHashingService(shortRandom, deriver).hash("password")).rejects.toThrow(
      "expected 16",
    );

    const shortDeriver: Argon2idDeriver = {
      derive: () => Promise.resolve(new Uint8Array(31)),
    };
    await expect(
      new PasswordHashingService(new FixedRandomSource(new Uint8Array(16)), shortDeriver).hash(
        "password",
      ),
    ).rejects.toThrow("returned 31 bytes");

    const failure = new Error("KDF unavailable");
    const failingDeriver: Argon2idDeriver = {
      derive: () => Promise.reject(failure),
    };
    await expect(
      new PasswordHashingService(new FixedRandomSource(new Uint8Array(16)), failingDeriver).hash(
        "password",
      ),
    ).rejects.toBe(failure);
  });

  it("provides a deliberately nonspecific persisted-hash error", () => {
    expect(new InvalidPasswordHashError()).toMatchObject({
      name: "InvalidPasswordHashError",
      message: "The persisted password hash is malformed or unsupported.",
    });
    expect(new InvalidPasswordHashError("custom").message).toBe("custom");
  });
});
