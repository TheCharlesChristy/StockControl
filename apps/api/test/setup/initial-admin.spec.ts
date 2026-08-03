import { describe, expect, it, vi } from "vitest";

import {
  createInitialAdmin,
  InitialAdminSetupError,
  type InitialAdminRepository,
} from "../../src/setup/initial-admin";

const validInput = {
  email: " First.Admin@Example.com ",
  displayName: " First Admin ",
  password: "a unique secure passphrase",
};

describe("initial Admin setup", () => {
  it("creates exactly one Admin record with a password hash", async () => {
    const insertWhenUsersEmpty = vi.fn<InitialAdminRepository["insertWhenUsersEmpty"]>(() =>
      Promise.resolve(true),
    );
    const hasher = vi.fn(() => Promise.resolve("secure-password-hash"));

    const result = await createInitialAdmin({ insertWhenUsersEmpty }, validInput, hasher);

    expect(hasher).toHaveBeenCalledWith(validInput.password);
    expect(insertWhenUsersEmpty).toHaveBeenCalledWith({
      id: expect.any(String),
      email: "first.admin@example.com",
      displayName: "First Admin",
      passwordHash: "secure-password-hash",
    });
    expect(result).toEqual({
      id: expect.any(String),
      email: "first.admin@example.com",
      displayName: "First Admin",
    });
  });

  it("refuses to create an Admin once any user exists", async () => {
    const repository: InitialAdminRepository = {
      insertWhenUsersEmpty: () => Promise.resolve(false),
    };

    await expect(
      createInitialAdmin(repository, validInput, () => Promise.resolve("hash")),
    ).rejects.toEqual(new InitialAdminSetupError("UsersAlreadyExist"));
  });

  it.each([
    [{ ...validInput, email: "not-an-email" }, "InvalidEmail"],
    [{ ...validInput, displayName: "   " }, "InvalidDisplayName"],
    [{ ...validInput, password: "too short" }, "PasswordPolicyUnmet"],
    [{ ...validInput, password: "x".repeat(129) }, "PasswordPolicyUnmet"],
  ] as const)("rejects invalid setup input", async (input, code) => {
    const insertWhenUsersEmpty = vi.fn(() => Promise.resolve(true));
    const hasher = vi.fn(() => Promise.resolve("hash"));

    await expect(createInitialAdmin({ insertWhenUsersEmpty }, input, hasher)).rejects.toEqual(
      new InitialAdminSetupError(code),
    );
    expect(hasher).not.toHaveBeenCalled();
    expect(insertWhenUsersEmpty).not.toHaveBeenCalled();
  });
});
