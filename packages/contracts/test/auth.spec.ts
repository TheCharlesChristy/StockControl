import { describe, expect, it } from "vitest";

import { passwordPolicy, passwordPolicyErrors } from "../src/auth";

describe("password policy", () => {
  it("accepts long passphrases without composition rules", () => {
    expect(passwordPolicyErrors("fifteen letters! ")).toEqual([]);
    expect(passwordPolicyErrors("a secure phrase with spaces")).toEqual([]);
    expect(passwordPolicyErrors("correcthorsebattery")).toEqual([]);
  });

  it("requires at least fifteen Unicode characters", () => {
    expect(passwordPolicyErrors("a".repeat(passwordPolicy.minimumCharacters - 1))).toEqual([
      "Use at least 15 characters.",
    ]);
    expect(passwordPolicyErrors("🔐".repeat(passwordPolicy.minimumCharacters))).toEqual([]);
  });

  it("limits normalised passwords to 128 Unicode characters", () => {
    expect(passwordPolicyErrors("a".repeat(passwordPolicy.maximumCharacters))).toEqual([]);
    expect(passwordPolicyErrors("a".repeat(passwordPolicy.maximumCharacters + 1))).toEqual([
      "Use no more than 128 characters.",
    ]);
  });

  it("measures the same normalised form that is hashed", () => {
    expect(passwordPolicyErrors("e\u0301".repeat(passwordPolicy.minimumCharacters))).toEqual([]);
  });
});
