import { describe, expect, it } from "vitest";

import {
  emailFormatErrors,
  emailRules,
  isAuthenticatedUser,
  normaliseUsername,
  passwordPolicy,
  passwordPolicyErrors,
  usernameFormatErrors,
  usernameRules,
} from "../src/auth";

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

describe("username rules", () => {
  it("accepts the shapes a stockroom actually types", () => {
    expect(usernameFormatErrors("sam")).toEqual([]);
    expect(usernameFormatErrors("sam.field")).toEqual([]);
    expect(usernameFormatErrors("priya-kaur")).toEqual([]);
    expect(usernameFormatErrors("engineer_two")).toEqual([]);
    expect(usernameFormatErrors("van42")).toEqual([]);
  });

  it("requires at least three characters", () => {
    expect(usernameFormatErrors("a".repeat(usernameRules.minimumCharacters - 1))).toEqual([
      "Use at least 3 characters.",
    ]);
    expect(usernameFormatErrors("")).toEqual(["Use at least 3 characters."]);
  });

  it("limits a username to 32 characters", () => {
    expect(usernameFormatErrors("a".repeat(usernameRules.maximumCharacters))).toEqual([]);
    expect(usernameFormatErrors("a".repeat(usernameRules.maximumCharacters + 1))).toEqual([
      "Use no more than 32 characters.",
    ]);
  });

  /*
   * Sign-in takes a username and nothing else, so an email-shaped username
   * would be refused at the field and read as a broken login rather than a
   * badly chosen name.
   */
  it("refuses a username that could be mistaken for an email address", () => {
    expect(usernameFormatErrors("sam@example.com")).toEqual([
      "Use letters, numbers, dots, hyphens and underscores only, starting and ending with a letter or number.",
    ]);
  });

  it("refuses characters that make two names hard to tell apart", () => {
    expect(usernameFormatErrors("Sam.Field")).not.toEqual([]);
    expect(usernameFormatErrors("sam field")).not.toEqual([]);
    expect(usernameFormatErrors(".sam")).not.toEqual([]);
    expect(usernameFormatErrors("sam.")).not.toEqual([]);
    expect(usernameFormatErrors("___")).not.toEqual([]);
  });

  it("lowercases and trims what somebody typed", () => {
    expect(normaliseUsername("  Sam.Field  ")).toBe("sam.field");
  });
});

describe("email format", () => {
  it("accepts an ordinary address", () => {
    expect(emailFormatErrors("sam.field@example.com")).toEqual([]);
  });

  it("refuses something that is plainly not an address", () => {
    expect(emailFormatErrors("not-an-email")).toEqual(["Enter a valid email address."]);
    expect(emailFormatErrors("sam@example")).toEqual(["Enter a valid email address."]);
  });

  it("refuses an address longer than a mailbox can be", () => {
    const tooLong = `${"a".repeat(emailRules.maximumCharacters)}@example.com`;

    expect(emailFormatErrors(tooLong)).toEqual(["Enter a valid email address."]);
  });
});

describe("authenticated user guard", () => {
  const user = {
    id: "id",
    username: "sam.field",
    email: "sam.field@example.com",
    displayName: "Sam Field",
    role: "Engineer",
    profilePhotoUrl: null,
    mustChangePassword: false,
  };

  it("accepts an account with no email address", () => {
    expect(isAuthenticatedUser({ ...user, email: null })).toBe(true);
  });

  /*
   * The browser runs this guard on every session response, so a widened type
   * with an unwidened guard would break sign-in silently rather than loudly.
   */
  it("refuses an email address that is neither a string nor absent", () => {
    expect(isAuthenticatedUser({ ...user, email: 42 })).toBe(false);
    expect(isAuthenticatedUser({ ...user, email: undefined })).toBe(false);
  });

  it("refuses an account with no username", () => {
    expect(isAuthenticatedUser({ ...user, username: undefined })).toBe(false);
  });
});
