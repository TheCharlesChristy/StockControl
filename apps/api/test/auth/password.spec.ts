import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../src/auth/password";

describe("password hashing", () => {
  it("accepts the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("Correct horse battery staple", hash)).resolves.toBe(false);
    await expect(verifyPassword("", hash)).resolves.toBe(false);
  });

  it("salts, so the same password never produces the same hash twice", async () => {
    const first = await hashPassword("repeated-password");
    const second = await hashPassword("repeated-password");

    expect(first).not.toBe(second);
    await expect(verifyPassword("repeated-password", first)).resolves.toBe(true);
    await expect(verifyPassword("repeated-password", second)).resolves.toBe(true);
  });

  it("records its parameters alongside the hash so they can be raised later", async () => {
    const hash = await hashPassword("parameterised");

    expect(hash.split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
  });

  it("normalises equivalent Unicode forms", async () => {
    const hash = await hashPassword("passwordé");

    await expect(verifyPassword("passwordé", hash)).resolves.toBe(true);
  });

  it.each([
    ["", "empty"],
    ["not-a-hash", "unstructured"],
    ["argon2$16384$8$1$c2FsdA$aGFzaA", "a different algorithm"],
    ["scrypt$16384$8$1$c2FsdA", "too few fields"],
    ["scrypt$16384$8$1$c2FsdA$", "an empty key"],
  ])("rejects %s stored hash (%s)", async (stored) => {
    await expect(verifyPassword("anything", stored)).resolves.toBe(false);
  });
});
