import { describe, expect, it } from "vitest";

import {
  DEFAULT_PASSWORD_POLICY,
  PASSWORD_POLICY_LIMITS,
  createPasswordPolicy,
  evaluateNewPassword,
} from "../src/identity/policies/password-policy";

describe("password creation policy", () => {
  it("accepts long passphrases without imposing arbitrary composition rules", () => {
    expect(evaluateNewPassword("correct horse battery staple")).toEqual({
      accepted: true,
    });
    expect(evaluateNewPassword("Twelve chars!")).toEqual({ accepted: true });
  });

  it("counts Unicode code points while independently bounding UTF-8 resources", () => {
    const unicode = "\u{1F512}".repeat(12);
    expect(evaluateNewPassword(unicode)).toEqual({ accepted: true });

    const oversizedUtf8 = "\u{1F512}".repeat(300);
    expect(
      evaluateNewPassword(oversizedUtf8, {
        minimumCharacters: 12,
        maximumCharacters: 1_024,
      }),
    ).toEqual({
      accepted: false,
      reasons: ["PasswordUtf8TooLong"],
    });
  });

  it("returns every applicable creation error without changing the password", () => {
    expect(evaluateNewPassword("short\n")).toEqual({
      accepted: false,
      reasons: ["PasswordTooShort", "PasswordContainsControlCharacter"],
    });
    expect(evaluateNewPassword("x".repeat(129))).toEqual({
      accepted: false,
      reasons: ["PasswordTooLong"],
    });
  });

  it("validates configuration against the locked resource limits", () => {
    expect(createPasswordPolicy(DEFAULT_PASSWORD_POLICY)).toEqual({
      minimumCharacters: 12,
      maximumCharacters: 128,
    });
    expect(Object.isFrozen(DEFAULT_PASSWORD_POLICY)).toBe(true);
    expect(PASSWORD_POLICY_LIMITS.hardMaximumUtf8Bytes).toBe(1_024);

    expect(() => createPasswordPolicy({ minimumCharacters: 11, maximumCharacters: 128 })).toThrow(
      "at least 12",
    );
    expect(() =>
      createPasswordPolicy({
        minimumCharacters: 12.5,
        maximumCharacters: 128,
      }),
    ).toThrow("at least 12");
    expect(() => createPasswordPolicy({ minimumCharacters: 20, maximumCharacters: 19 })).toThrow(
      "between its minimum",
    );
    expect(() =>
      createPasswordPolicy({
        minimumCharacters: 12,
        maximumCharacters: 1_025,
      }),
    ).toThrow("between its minimum");
    expect(() => createPasswordPolicy({ minimumCharacters: 12, maximumCharacters: 12.5 })).toThrow(
      "between its minimum",
    );
  });
});
