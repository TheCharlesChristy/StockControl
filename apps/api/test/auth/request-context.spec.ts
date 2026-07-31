import type { AuthenticatedSession } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { readSessionCookie } from "../../src/auth/auth.guard";
import {
  attachSession,
  currentUser,
  requireCapability,
  requireSession,
  sessionOf,
} from "../../src/auth/request-context";

const sessionFor = (role: AuthenticatedSession["user"]["role"]): AuthenticatedSession => ({
  user: { id: `user-${role}`, email: `${role}@example.com`, displayName: role, role },
  issuedAt: "2026-07-30T09:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
});

const emptyRequest = (): FastifyRequest => ({}) as FastifyRequest;

describe("session on the request", () => {
  it("is absent until the guard attaches it", () => {
    expect(sessionOf(emptyRequest())).toBeUndefined();
  });

  it("round-trips once attached", () => {
    const request = emptyRequest();
    const session = sessionFor("Office");

    attachSession(request, session);

    expect(sessionOf(request)).toEqual(session);
    expect(currentUser(request).email).toBe("Office@example.com");
  });

  it("refuses an unauthenticated request with a 401 failure", () => {
    try {
      requireSession(emptyRequest());
      throw new Error("requireSession should have thrown.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationFailureException);
      expect((error as ApplicationFailureException).failure.kind).toBe("AuthenticationRequired");
      expect((error as ApplicationFailureException).getStatus()).toBe(401);
    }
  });
});

describe("requireCapability", () => {
  it("returns the user when the role allows it", () => {
    const request = emptyRequest();
    attachSession(request, sessionFor("Engineer"));

    expect(requireCapability(request, "issue").id).toBe("user-Engineer");
  });

  it.each([
    ["Engineer", "manageStock"],
    ["Engineer", "manageUsers"],
    ["Office", "manageUsers"],
  ] as const)("refuses %s attempting %s with a 403", (role, capability) => {
    const request = emptyRequest();
    attachSession(request, sessionFor(role));

    try {
      requireCapability(request, capability);
      throw new Error("requireCapability should have thrown.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationFailureException);
      expect((error as ApplicationFailureException).failure.kind).toBe("PermissionDenied");
      expect((error as ApplicationFailureException).getStatus()).toBe(403);
    }
  });

  it("explains what the role cannot do rather than saying only 'forbidden'", () => {
    const request = emptyRequest();
    attachSession(request, sessionFor("Engineer"));

    try {
      requireCapability(request, "manageUsers");
      throw new Error("requireCapability should have thrown.");
    } catch (error: unknown) {
      expect((error as ApplicationFailureException).failure.detail).toBe(
        "Your role cannot manage users.",
      );
    }
  });

  it("requires authentication before it considers the capability", () => {
    expect(() => requireCapability(emptyRequest(), "view")).toThrow(ApplicationFailureException);
  });
});

describe("readSessionCookie", () => {
  it("returns undefined when the cookie plugin has not populated the request", () => {
    expect(readSessionCookie(emptyRequest())).toBeUndefined();
  });

  it("returns undefined when the session cookie is absent", () => {
    expect(
      readSessionCookie({ cookies: { other: "value" } } as unknown as FastifyRequest),
    ).toBeUndefined();
  });

  it("reads the session cookie when present", () => {
    const request = {
      cookies: { "stockcontrol.session": "session-id" },
    } as unknown as FastifyRequest;

    expect(readSessionCookie(request)).toBe("session-id");
  });
});
