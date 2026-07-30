import { afterEach, describe, expect, it } from "vitest";

import type { AuthenticatedSession, AuthenticatedUser } from "./auth-types";
import {
  createDefaultAuthClient,
  createHttpAuthClient,
  createPreviewAuthClient,
} from "./AuthClient";

const officeUser: AuthenticatedUser = {
  id: "user-office",
  email: "office@example.com",
  displayName: "Office User",
  role: "Office",
};

const officeSession: AuthenticatedSession = {
  user: officeUser,
  issuedAt: "2026-07-29T09:00:00.000Z",
  expiresAt: "2026-07-29T21:00:00.000Z",
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

describe("HTTP authentication client", () => {
  it("returns the current session", async () => {
    const fetch = createFetch(jsonResponse({ session: officeSession }));
    const client = createHttpAuthClient(fetch.fetchImplementation);

    await expect(client.getSession(new AbortController().signal)).resolves.toEqual(officeSession);
    expect(fetch.calls[0]?.[0]).toBe("/api/v1/auth/session");
  });

  it("treats an unauthenticated session lookup as anonymous rather than an error", async () => {
    const fetch = createFetch(jsonResponse({}, { status: 401 }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).getSession(new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("reports an unexpected session-lookup status as an error", async () => {
    const fetch = createFetch(jsonResponse({}, { status: 503 }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).getSession(new AbortController().signal),
    ).rejects.toThrow("Session lookup failed with status 503.");
  });

  it("rejects a session payload that does not match the contract", async () => {
    const fetch = createFetch(jsonResponse({ session: { user: { id: "u" } } }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).getSession(new AbortController().signal),
    ).rejects.toThrow("The authentication service returned an invalid session.");
  });

  it("posts credentials directly and returns the established session", async () => {
    const fetch = createFetch(jsonResponse({ session: officeSession }));
    const credentials = {
      email: "office@example.com",
      password: "long-enough-password",
    };

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).signIn(credentials),
    ).resolves.toEqual(officeSession);
    expect(fetch.calls).toEqual([
      [
        "/api/v1/auth/sign-in",
        {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(credentials),
        },
      ],
    ]);
  });

  it("reports a rejected sign-in", async () => {
    const fetch = createFetch(jsonResponse({}, { status: 401 }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).signIn({
        email: "office@example.com",
        password: "wrong",
      }),
    ).rejects.toThrow("Sign in failed with status 401.");
  });

  it("treats signing out of an already-expired session as success", async () => {
    const fetch = createFetch(jsonResponse({}, { status: 401 }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).signOut(),
    ).resolves.toBeUndefined();
    expect(fetch.calls[0]?.[0]).toBe("/api/v1/auth/sign-out");
  });

  it("reports a failed sign-out", async () => {
    const fetch = createFetch(jsonResponse({}, { status: 500 }));

    await expect(createHttpAuthClient(fetch.fetchImplementation).signOut()).rejects.toThrow(
      "Sign out failed with status 500.",
    );
  });

  it("rejects a non-JSON response", async () => {
    const fetch = createFetch(new Response("<html></html>", { status: 200 }));

    await expect(
      createHttpAuthClient(fetch.fetchImplementation).getSession(new AbortController().signal),
    ).rejects.toThrow("The authentication service returned an unexpected response.");
  });
});

describe("development preview authentication client", () => {
  const previewNow = new Date("2026-07-29T09:00:00.000Z");
  const clock = (): Date => new Date(previewNow);

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it.each([
    ["admin.owner@example.com", "Admin"],
    ["engineer.one@example.com", "Engineer"],
    ["office.desk@example.com", "Office"],
  ])("derives the %s preview role and restores the session", async (email, role) => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);

    const session = await client.signIn({ email, password: "anything" });

    expect(session.user.role).toBe(role);
    expect(session.expiresAt).toBe("2026-07-29T21:00:00.000Z");
    await expect(client.getSession(new AbortController().signal)).resolves.toEqual(session);
  });

  it("returns null when no preview session is stored", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);

    await expect(client.getSession(new AbortController().signal)).resolves.toBeNull();
  });

  it("clears an expired preview session", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    await client.signIn({ email: "office.desk@example.com", password: "anything" });

    const laterClient = createPreviewAuthClient(
      window.sessionStorage,
      () => new Date("2026-07-30T09:00:00.000Z"),
    );

    await expect(laterClient.getSession(new AbortController().signal)).resolves.toBeNull();
    expect(window.sessionStorage.getItem("stockcontrol.preview-session.v3")).toBeNull();
  });

  it.each(["not-json", JSON.stringify({ user: { id: "u" } })])(
    "clears an invalid stored preview session",
    async (storedValue) => {
      window.sessionStorage.setItem("stockcontrol.preview-session.v3", storedValue);
      const client = createPreviewAuthClient(window.sessionStorage, clock);

      await expect(client.getSession(new AbortController().signal)).resolves.toBeNull();
      expect(window.sessionStorage.getItem("stockcontrol.preview-session.v3")).toBeNull();
    },
  );

  it("removes the stored session on sign out", async () => {
    const client = createPreviewAuthClient(window.sessionStorage, clock);
    await client.signIn({ email: "office.desk@example.com", password: "anything" });

    await client.signOut();

    expect(window.sessionStorage.getItem("stockcontrol.preview-session.v3")).toBeNull();
  });

  it("honours an aborted session lookup", () => {
    const controller = new AbortController();
    controller.abort();

    expect(() =>
      createPreviewAuthClient(window.sessionStorage, clock).getSession(controller.signal),
    ).toThrow();
  });
});

describe("default authentication client", () => {
  it("uses the HTTP client when the preview flag is not enabled", () => {
    expect(createDefaultAuthClient()).toHaveProperty("signIn");
  });
});
