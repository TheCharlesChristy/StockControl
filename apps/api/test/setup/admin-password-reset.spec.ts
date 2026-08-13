import { describe, expect, it, vi } from "vitest";

import {
  AdminPasswordResetError,
  resetAdminPassword,
  type AdminPasswordResetRepository,
} from "../../src/setup/admin-password-reset";

const validInput = {
  username: " Admin.Owner ",
  password: "a different secure passphrase",
};

describe("operator Admin password recovery", () => {
  it("updates the exact active Admin through an atomic repository operation", async () => {
    const updateActiveAdminPassword = vi.fn<
      AdminPasswordResetRepository["updateActiveAdminPassword"]
    >(() => Promise.resolve(true));
    const hasher = vi.fn(() => Promise.resolve("replacement-password-hash"));

    await resetAdminPassword({ updateActiveAdminPassword }, validInput, hasher);

    expect(hasher).toHaveBeenCalledWith(validInput.password);
    expect(updateActiveAdminPassword).toHaveBeenCalledWith(
      "admin.owner",
      "replacement-password-hash",
    );
  });

  it("uses the same response when the account is missing, inactive, or not an Admin", async () => {
    const repository: AdminPasswordResetRepository = {
      updateActiveAdminPassword: () => Promise.resolve(false),
    };

    await expect(
      resetAdminPassword(repository, validInput, () => Promise.resolve("hash")),
    ).rejects.toEqual(new AdminPasswordResetError("ActiveAdminNotFound"));
  });

  it.each([
    [{ ...validInput, username: "not a username" }, "InvalidUsername"],
    [{ ...validInput, password: "too short" }, "PasswordPolicyUnmet"],
    [{ ...validInput, password: "x".repeat(129) }, "PasswordPolicyUnmet"],
  ] as const)("rejects invalid recovery input before hashing", async (input, code) => {
    const updateActiveAdminPassword = vi.fn(() => Promise.resolve(true));
    const hasher = vi.fn(() => Promise.resolve("hash"));

    await expect(resetAdminPassword({ updateActiveAdminPassword }, input, hasher)).rejects.toEqual(
      new AdminPasswordResetError(code),
    );
    expect(hasher).not.toHaveBeenCalled();
    expect(updateActiveAdminPassword).not.toHaveBeenCalled();
  });
});
