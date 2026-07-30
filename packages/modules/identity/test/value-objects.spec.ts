import { describe, expect, it } from "vitest";

import { isActiveUser, userStatuses } from "../src/identity/user";
import {
  IdentityValueError,
  normaliseEmailAddress,
  userDisplayName,
  userId,
} from "../src/identity/value-objects";

describe("identity value objects", () => {
  it("trims a required user ID without imposing an infrastructure format", () => {
    expect(userId(" 01JABCDEF0123456789 ")).toBe("01JABCDEF0123456789");
  });

  it("rejects an empty user ID with a stable error", () => {
    expect(() => userId(" \t ")).toThrowError(
      new IdentityValueError("UserIdRequired", "A user ID is required."),
    );
  });

  it("normalises an email address for identity comparison", () => {
    expect(normaliseEmailAddress("  Engineer.One+stores@Example.COM ")).toBe(
      "engineer.one+stores@example.com",
    );
  });

  it.each([
    "",
    "plain-address",
    "@example.com",
    "person@",
    "person@@example.com",
    "person @example.com",
    `${"l".repeat(65)}@example.com`,
    `${"l".repeat(64)}@${"d".repeat(190)}`,
  ])("rejects the invalid email address %j", (value) => {
    expect(() => normaliseEmailAddress(value)).toThrowError(
      expect.objectContaining({
        name: "IdentityValueError",
        code: "EmailAddressInvalid",
      }),
    );
  });

  it("trims a display name and preserves its internal presentation", () => {
    expect(userDisplayName("  Engineer   One  ")).toBe("Engineer   One");
  });

  it("rejects missing and excessively long display names", () => {
    expect(() => userDisplayName(" ")).toThrowError(
      expect.objectContaining({ code: "DisplayNameRequired" }),
    );
    expect(() => userDisplayName("a".repeat(201))).toThrowError(
      expect.objectContaining({ code: "DisplayNameTooLong" }),
    );
  });
});

describe("user status", () => {
  it("uses the minimal invite-only MVP lifecycle", () => {
    expect(userStatuses).toEqual(["Invited", "Active", "Disabled"]);
    expect(isActiveUser({ status: "Active" })).toBe(true);
    expect(isActiveUser({ status: "Invited" })).toBe(false);
    expect(isActiveUser({ status: "Disabled" })).toBe(false);
  });
});
