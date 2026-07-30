import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession, AuthenticatedUser, SignInResult } from "./auth-types";
import {
  createDefaultAuthClient,
  createHttpAuthClient,
  createPreviewAuthClient,
  isAuthenticatedUser,
} from "./AuthClient";

const officeUser: AuthenticatedUser = {
  id: "user-office",
  email: "office@example.com",
  displayName: "Office User",
  role: "Office",
  status: "Active",
  effectiveCapabilities: ["inventory.view"],
  permissionCatalogueVersion: 1,
  mfaEnabled: false,
};

const officeSession: AuthenticatedSession = {
  user: officeUser,
  assurance: "password",
  issuedAt: "2026-07-29T09:00:00.000Z",
  idleExpiresAt: "2026-07-29T11:00:00.000Z",
  absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
  recentlyAuthenticatedAt: "2026-07-29T09:00:00.000Z",
};

type FetchCall = readonly [RequestInfo | URL, RequestInit | undefined];

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function createFetch(...responses: readonly Response[]): {
  readonly calls: FetchCall[];
  readonly fetchImplementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  let responseIndex = 0;

  return {
    calls,
    fetchImplementation(input, init): Promise<Response> {
      calls.push([input, init]);
      const response = responses[responseIndex];
      responseIndex += 1;

      if (response === undefined) {
        return Promise.reject(new Error("Unexpected fetch call."));
      }

      return Promise.resolve(response);
    },
  };
}

function csrfResponse(): Response {
  return jsonResponse({ token: "csrf-token" });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isAuthenticatedUser", () => {
  it("accepts a complete active user", () => {
    expect(isAuthenticatedUser(officeUser)).toBe(true);
  });

  it.each([
    null,
    "user",
    {},
    { ...officeUser, id: 42 },
    { ...officeUser, email: null },
    { ...officeUser, displayName: undefined },
    { ...officeUser, role: "Owner" },
    { ...officeUser, status: "Disabled" },
    { ...officeUser, effectiveCapabilities: ["inventory.view", "inventory.view"] },
  ])("rejects an invalid user payload", (value) => {
    expect(isAuthenticatedUser(value)).toBe(false);
  });
});

describe("HTTP authentication client", () => {
  it("returns null for an unauthenticated session", async () => {
    const fetch = createFetch(new Response(null, { status: 401 }));
    const client = createHttpAuthClient(fetch.fetchImplementation);
    const signal = new AbortController().signal;

    await expect(client.getSession(signal)).resolves.toBeNull();
    expect(fetch.calls).toEqual([
      [
        "/api/v1/auth/session",
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal,
        },
      ],
    ]);
  });

  it("reads a valid session envelope", async () => {
    const fetch = createFetch(jsonResponse({ session: officeSession }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).getSession(new AbortController().signal),
    ).resolves.toEqual(officeSession);
  });

  it("rejects failed, non-JSON, and malformed session responses", async () => {
    const failedFetch = createFetch(new Response(null, { status: 503 }));
    const textFetch = createFetch(
      new Response("temporarily unavailable", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const malformedFetch = createFetch(jsonResponse({ session: { user: officeUser } }));

    await expect(
      createHttpAuthClient(failedFetch.fetchImplementation).getSession(
        new AbortController().signal,
      ),
    ).rejects.toThrow("Session lookup failed with status 503.");
    await expect(
      createHttpAuthClient(textFetch.fetchImplementation).getSession(new AbortController().signal),
    ).rejects.toThrow("unexpected response");
    await expect(
      createHttpAuthClient(malformedFetch.fetchImplementation).getSession(
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid session");
  });

  it("obtains CSRF protection, posts credentials, and parses an authenticated result", async () => {
    const fetch = createFetch(
      csrfResponse(),
      jsonResponse({ outcome: "authenticated", session: officeSession }),
    );
    const client = createHttpAuthClient(fetch.fetchImplementation);
    const credentials = {
      email: "office@example.com",
      password: "long-enough-password",
    };

    await expect(client.signIn(credentials)).resolves.toEqual({
      outcome: "authenticated",
      session: officeSession,
    });
    expect(fetch.calls).toEqual([
      [
        "/api/v1/auth/csrf",
        {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        },
      ],
      [
        "/api/v1/auth/sign-in",
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-csrf-token": "csrf-token",
          },
          body: JSON.stringify(credentials),
        },
      ],
    ]);
  });

  it("accepts an MFA challenge returned after password verification", async () => {
    const challenge: SignInResult = {
      outcome: "mfa_required",
      challenge: {
        id: "challenge-1",
        expiresAt: "2026-07-29T09:05:00.000Z",
        methods: ["totp", "recovery_code"],
      },
    };
    const fetch = createFetch(csrfResponse(), jsonResponse(challenge));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).signIn({
        email: "admin@example.com",
        password: "password",
      }),
    ).resolves.toEqual(challenge);
  });

  it("fails closed when CSRF lookup fails or returns malformed data", async () => {
    const failedFetch = createFetch(new Response(null, { status: 503 }));
    const malformedFetch = createFetch(jsonResponse({ token: "" }));
    const credentials = { email: "office@example.com", password: "password" };

    await expect(
      createHttpAuthClient(failedFetch.fetchImplementation).signIn(credentials),
    ).rejects.toThrow("CSRF token lookup failed with status 503.");
    await expect(
      createHttpAuthClient(malformedFetch.fetchImplementation).signIn(credentials),
    ).rejects.toThrow("invalid CSRF token");
  });

  it("rejects unsuccessful, non-JSON, or malformed sign-in responses", async () => {
    const failedFetch = createFetch(csrfResponse(), new Response(null, { status: 403 }));
    const textFetch = createFetch(
      csrfResponse(),
      new Response("no", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const malformedFetch = createFetch(csrfResponse(), jsonResponse({ user: null }));
    const credentials = { email: "office@example.com", password: "incorrect" };

    await expect(
      createHttpAuthClient(failedFetch.fetchImplementation).signIn(credentials),
    ).rejects.toThrow("Sign in failed with status 403.");
    await expect(
      createHttpAuthClient(textFetch.fetchImplementation).signIn(credentials),
    ).rejects.toThrow("unexpected response");
    await expect(
      createHttpAuthClient(malformedFetch.fetchImplementation).signIn(credentials),
    ).rejects.toThrow("invalid authentication response");
  });

  it("verifies MFA through a separately CSRF-protected request", async () => {
    const fetch = createFetch(
      csrfResponse(),
      jsonResponse({ outcome: "authenticated", session: officeSession }),
    );
    const credentials = { challengeId: "challenge-1", code: "123456" };

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).verifyMfa(credentials),
    ).resolves.toEqual({
      outcome: "authenticated",
      session: officeSession,
    });
    expect(fetch.calls[1]).toEqual([
      "/api/v1/auth/mfa/verify",
      expect.objectContaining({
        body: JSON.stringify(credentials),
        headers: expect.objectContaining({ "x-csrf-token": "csrf-token" }),
      }),
    ]);
  });

  it("rejects MFA verification that does not complete authentication", async () => {
    const fetch = createFetch(
      csrfResponse(),
      jsonResponse({
        outcome: "mfa_required",
        challenge: {
          id: "challenge-2",
          expiresAt: "2026-07-29T09:05:00Z",
          methods: ["totp"],
        },
      }),
    );

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).verifyMfa({
        challengeId: "challenge-1",
        code: "123456",
      }),
    ).rejects.toThrow("did not complete authentication");
  });

  it.each([204, 401])("accepts sign-out status %s", async (status) => {
    const fetch = createFetch(csrfResponse(), new Response(null, { status }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).signOut(),
    ).resolves.toBeUndefined();
    expect(fetch.calls[1]).toEqual([
      "/api/v1/auth/sign-out",
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "x-csrf-token": "csrf-token",
        },
      },
    ]);
  });

  it("rejects a failed sign-out", async () => {
    const fetch = createFetch(csrfResponse(), new Response(null, { status: 500 }));

    await expect(createHttpAuthClient(fetch.fetchImplementation).signOut()).rejects.toThrow(
      "Sign out failed with status 500.",
    );
  });
});

describe("development preview authentication client", () => {
  const previewNow = new Date("2026-07-29T09:00:00.000Z");
  const clock = (): Date => new Date(previewNow);

  it.each([
    ["engineer-one@example.com", "Engineer", "Engineer One"],
    ["stores.office@example.com", "Office", "Stores Office"],
  ] as const)(
    "creates and restores a normalized %s preview session",
    async (email, role, displayName) => {
      const client = createPreviewAuthClient(window.sessionStorage, clock);
      const result = await client.signIn({
        email: `  ${email.toUpperCase()}  `,
        password: "preview-password",
      });

      expect(result).toMatchObject({
        outcome: "authenticated",
        session: {
          user: {
            id: `preview-${email}`,
            email,
            displayName,
            role,
            status: "Active",
          },
        },
      });
      await expect(client.getSession(new AbortController().signal)).resolves.toEqual(
        result.outcome === "authenticated" ? result.session : null,
      );
    },
  );

  it("requires and verifies MFA before creating an Admin session", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    const result = await client.signIn({
      email: "admin.owner@example.com",
      password: "preview-password",
    });

    expect(result).toEqual({
      outcome: "mfa_required",
      challenge: {
        id: "preview-mfa-admin.owner@example.com",
        expiresAt: "2026-07-29T09:05:00.000Z",
        methods: ["totp", "recovery_code"],
      },
    });
    expect(window.sessionStorage.getItem("stockcontrol.preview-session.v2")).toBeNull();

    if (result.outcome !== "mfa_required") {
      throw new Error("Expected an MFA challenge.");
    }

    const verified = await client.verifyMfa({
      challengeId: result.challenge.id,
      code: "123456",
    });

    expect(verified).toMatchObject({
      outcome: "authenticated",
      session: {
        assurance: "mfa",
        user: {
          role: "Admin",
          mfaEnabled: true,
        },
      },
    });
    await expect(client.getSession(new AbortController().signal)).resolves.toEqual(
      verified.session,
    );
  });

  it("accepts the deterministic preview recovery code case-insensitively", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    const result = await client.signIn({
      email: "admin@example.com",
      password: "preview-password",
    });

    if (result.outcome !== "mfa_required") {
      throw new Error("Expected an MFA challenge.");
    }

    await expect(
      client.verifyMfa({
        challengeId: result.challenge.id,
        code: "preview-recovery",
      }),
    ).resolves.toMatchObject({ outcome: "authenticated" });
  });

  it("rejects a missing, mismatched, or invalid preview MFA challenge", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);

    await expect(client.verifyMfa({ challengeId: "missing", code: "123456" })).rejects.toThrow(
      "verification failed",
    );

    const result = await client.signIn({
      email: "admin@example.com",
      password: "preview-password",
    });

    if (result.outcome !== "mfa_required") {
      throw new Error("Expected an MFA challenge.");
    }

    await expect(
      client.verifyMfa({ challengeId: "wrong-challenge", code: "123456" }),
    ).rejects.toThrow("verification failed");
    await expect(
      client.verifyMfa({ challengeId: result.challenge.id, code: "000000" }),
    ).rejects.toThrow("verification failed");
  });

  it("rejects an expired preview MFA challenge", async () => {
    let currentTime = new Date("2026-07-29T09:00:00.000Z");
    const client = createPreviewAuthClient(window.sessionStorage, () => currentTime);
    const result = await client.signIn({
      email: "admin@example.com",
      password: "preview-password",
    });

    if (result.outcome !== "mfa_required") {
      throw new Error("Expected an MFA challenge.");
    }

    currentTime = new Date("2026-07-29T09:05:00.000Z");
    await expect(
      client.verifyMfa({ challengeId: result.challenge.id, code: "123456" }),
    ).rejects.toThrow("verification failed");
  });

  it("returns null when no preview session is stored", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);

    await expect(client.getSession(new AbortController().signal)).resolves.toBeNull();
  });

  it.each(["not-json", JSON.stringify({ ...officeSession, assurance: "unknown" })])(
    "clears an invalid stored preview session",
    async (storedValue) => {
      window.sessionStorage.setItem("stockcontrol.preview-session.v2", storedValue);
      const client = createPreviewAuthClient(window.sessionStorage, clock);

      await expect(client.getSession(new AbortController().signal)).resolves.toBeNull();
      expect(window.sessionStorage.getItem("stockcontrol.preview-session.v2")).toBeNull();
    },
  );

  it("expires preview sessions using both idle and absolute bounds", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    await client.signIn({
      email: "office@example.com",
      password: "preview-password",
    });

    const afterIdleExpiry = createPreviewAuthClient(
      window.sessionStorage,
      () => new Date("2026-07-29T11:00:00.000Z"),
    );
    await expect(afterIdleExpiry.getSession(new AbortController().signal)).resolves.toBeNull();

    window.sessionStorage.setItem(
      "stockcontrol.preview-session.v2",
      JSON.stringify({
        ...officeSession,
        idleExpiresAt: "2026-07-30T10:00:00.000Z",
        absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
      }),
    );
    const afterAbsoluteExpiry = createPreviewAuthClient(
      window.sessionStorage,
      () => new Date("2026-07-29T21:00:00.000Z"),
    );
    await expect(afterAbsoluteExpiry.getSession(new AbortController().signal)).resolves.toBeNull();
  });

  it("rejects an aborted session lookup", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      createPreviewAuthClient(window.sessionStorage, clock).getSession(controller.signal),
    ).toThrow(/abort/i);
  });

  it("removes pending and stored authentication state on sign out", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    await client.signIn({
      email: "office@example.com",
      password: "preview-password",
    });

    await expect(client.signOut()).resolves.toBeUndefined();
    await expect(client.getSession(new AbortController().signal)).resolves.toBeNull();
  });

  it("uses a non-human fallback display name for an empty local part", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);

    await expect(
      client.signIn({ email: "@example.com", password: "preview-password" }),
    ).resolves.toMatchObject({
      outcome: "authenticated",
      session: {
        user: {
          displayName: "StockControl preview user",
          role: "Office",
        },
      },
    });
  });

  it("selects the preview adapter only when the development flag is enabled", async () => {
    vi.stubEnv("VITE_ENABLE_AUTH_PREVIEW", "true");

    const client = createDefaultAuthClient();
    await client.signIn({
      email: "office@example.com",
      password: "preview-password",
    });

    expect(window.sessionStorage.getItem("stockcontrol.preview-session.v2")).not.toBeNull();
  });
});
