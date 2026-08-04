import type { AuthenticatedSession } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthController } from "../../src/auth/auth.controller";
import { verifyPassword } from "../../src/auth/password";
import { attachSession } from "../../src/auth/request-context";
import type { SessionService } from "../../src/auth/session-service";
import { SignInRateLimiter } from "../../src/auth/sign-in-rate-limiter";

const session: AuthenticatedSession = {
  user: {
    id: "user-1",
    email: "sam@example.com",
    displayName: "Sam Field",
    role: "Engineer",
    profilePhotoUrl: null,
    mustChangePassword: true,
  },
  issuedAt: "2026-07-30T09:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
};

const CURRENT = "the-current-password";
const REPLACEMENT = "a-much-better-passphrase";

interface Harness {
  readonly controller: AuthController;
  readonly request: FastifyRequest;
  readonly changeOwnPassword: ReturnType<typeof vi.fn>;
  readonly revokeAllForUserExcept: ReturnType<typeof vi.fn>;
}

const harness = (accepted = true): Harness => {
  const changeOwnPassword = vi.fn(() => Promise.resolve(accepted));
  const revokeAllForUserExcept = vi.fn(() => Promise.resolve());
  const sessions = { changeOwnPassword, revokeAllForUserExcept } as unknown as SessionService;
  const controller = new AuthController(sessions, new SignInRateLimiter(), "https://example.com");

  const request = {
    ip: "192.0.2.10",
    cookies: { "__Host-stockcontrol.session": "current-session-token" },
  } as unknown as FastifyRequest;
  attachSession(request, session);

  return { controller, request, changeOwnPassword, revokeAllForUserExcept };
};

const change = (
  { controller, request }: Harness,
  body: Readonly<Record<string, unknown>>,
): Promise<{ readonly changed: true }> => controller.changePassword(request, body);

describe("changing your own password", () => {
  let subject: Harness;

  beforeEach(() => {
    subject = harness();
  });

  it("hashes the replacement rather than storing what was sent", async () => {
    await change(subject, { currentPassword: CURRENT, newPassword: REPLACEMENT });

    const [userId, currentPassword, newPasswordHash] = subject.changeOwnPassword.mock.calls[0] as [
      string,
      string,
      string,
    ];

    expect(userId).toBe("user-1");
    expect(currentPassword).toBe(CURRENT);
    expect(newPasswordHash).not.toContain(REPLACEMENT);
    expect(newPasswordHash.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword(REPLACEMENT, newPasswordHash)).resolves.toBe(true);
  });

  /*
   * A password is changed precisely because somebody else may hold it. Leaving
   * their sessions alive would make the change cosmetic.
   */
  it("ends every other session but the one that made the change", async () => {
    await change(subject, { currentPassword: CURRENT, newPassword: REPLACEMENT });

    expect(subject.revokeAllForUserExcept).toHaveBeenCalledWith("user-1", "current-session-token");
  });

  it("requires the current password", async () => {
    await expect(change(subject, { newPassword: REPLACEMENT })).rejects.toMatchObject({
      failure: { errors: { currentPassword: ["Enter your current password."] } },
    });
    expect(subject.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("holds the replacement to the password policy", async () => {
    await expect(
      change(subject, { currentPassword: CURRENT, newPassword: "short" }),
    ).rejects.toBeInstanceOf(ApplicationFailureException);
    expect(subject.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("refuses a replacement identical to the current password", async () => {
    await expect(
      change(subject, { currentPassword: REPLACEMENT, newPassword: REPLACEMENT }),
    ).rejects.toMatchObject({
      failure: { errors: { newPassword: ["Choose a password you have not used here before."] } },
    });
    expect(subject.changeOwnPassword).not.toHaveBeenCalled();
  });

  it("reports a wrong current password without revoking anything", async () => {
    const rejecting = harness(false);

    await expect(
      change(rejecting, { currentPassword: "not-the-right-one", newPassword: REPLACEMENT }),
    ).rejects.toMatchObject({
      failure: { errors: { currentPassword: ["That password was not recognised."] } },
    });
    expect(rejecting.revokeAllForUserExcept).not.toHaveBeenCalled();
  });

  /*
   * Guessing the current password is guessing a password, so it has to cost the
   * same as guessing at the sign-in screen — otherwise this endpoint is simply
   * the unmetered way in.
   */
  it("throttles repeated wrong current passwords", async () => {
    const rejecting = harness(false);
    const attempt = (): Promise<unknown> =>
      change(rejecting, { currentPassword: "wrong-password-x", newPassword: REPLACEMENT });

    for (let index = 0; index < 5; index += 1) {
      await expect(attempt()).rejects.toBeInstanceOf(ApplicationFailureException);
    }

    await expect(attempt()).rejects.toMatchObject({ status: 429 });
  });
});
