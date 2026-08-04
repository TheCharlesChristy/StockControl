import type { AuthenticatedSession } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { readSessionCookie } from "../../src/auth/auth.guard";
import {
  attachSession,
  canViewAllActivity,
  currentUser,
  requireCapability,
  requireSession,
  sessionOf,
} from "../../src/auth/request-context";

const sessionFor = (role: AuthenticatedSession["user"]["role"]): AuthenticatedSession => ({
  user: {
    id: `user-${role}`,
    email: `${role}@example.com`,
    displayName: role,
    role,
    profilePhotoUrl: null,
  },
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

  it("reads the host-locked cookie an HTTPS deployment issues", () => {
    const request = {
      cookies: { "__Host-stockcontrol.session": "host-locked" },
    } as unknown as FastifyRequest;

    expect(readSessionCookie(request)).toBe("host-locked");
  });

  /*
   * Both names are present for as long as it takes the pre-rename sessions to
   * expire. The host-locked one is the one this deployment issued, so it wins;
   * the other cannot have been set by anything this API would trust more.
   */
  it("prefers the host-locked cookie while both are present", () => {
    const request = {
      cookies: {
        "__Host-stockcontrol.session": "host-locked",
        "stockcontrol.session": "legacy",
      },
    } as unknown as FastifyRequest;

    expect(readSessionCookie(request)).toBe("host-locked");
  });
});

/**
 * This is the gate every transaction list is narrowed by. An Engineer sees
 * their own record; Office and Admin see the operational one. Getting it wrong
 * either hides an Office user's log or shows an Engineer everyone else's.
 */
describe("who may see other people's activity", () => {
  const requestAs = (role: AuthenticatedSession["user"]["role"]): FastifyRequest => {
    const request = emptyRequest();

    attachSession(request, sessionFor(role));

    return request;
  };

  it("withholds it from an Engineer", () => {
    expect(canViewAllActivity(requestAs("Engineer"))).toBe(false);
  });

  it.each(["Office", "Admin"] as const)("grants it to %s", (role) => {
    expect(canViewAllActivity(requestAs(role))).toBe(true);
  });

  it("refuses an Engineer the capability outright, with a readable reason", () => {
    try {
      requireCapability(requestAs("Engineer"), "viewAllActivity");
      throw new Error("requireCapability should have thrown.");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ApplicationFailureException);
      expect((error as ApplicationFailureException).getStatus()).toBe(403);
      expect((error as ApplicationFailureException).failure.detail).toContain(
        "see other people's activity",
      );
    }
  });

  it("refuses an Engineer the review of stock requests but allows raising one", () => {
    expect(() => requireCapability(requestAs("Engineer"), "requestStock")).not.toThrow();
    expect(() => requireCapability(requestAs("Engineer"), "reviewStockRequests")).toThrow();
    expect(() => requireCapability(requestAs("Office"), "reviewStockRequests")).not.toThrow();
  });
});
