import {
  isSessionResponse,
  type AuthenticatedSession,
  type SignInRequest,
} from "@stockcontrol/contracts";

import { type AuthClient } from "./auth-types";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new Error("The authentication service returned an unexpected response.");
  }

  return response.json() as Promise<unknown>;
}

function requestFailed(response: Response, action: string): Error {
  return new Error(`${action} failed with status ${response.status}.`);
}

function parseSessionPayload(value: unknown): AuthenticatedSession {
  if (!isSessionResponse(value)) {
    throw new Error("The authentication service returned an invalid session.");
  }

  return value.session;
}

export function createHttpAuthClient(
  fetchImplementation: FetchImplementation = window.fetch.bind(window),
): AuthClient {
  return {
    async getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
      const response = await fetchImplementation("/api/v1/auth/session", {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal,
      });

      if (response.status === 401) {
        return null;
      }

      if (!response.ok) {
        throw requestFailed(response, "Session lookup");
      }

      return parseSessionPayload(await readJson(response));
    },

    async signIn(credentials: SignInRequest): Promise<AuthenticatedSession> {
      const response = await fetchImplementation("/api/v1/auth/sign-in", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        throw requestFailed(response, "Sign in");
      }

      return parseSessionPayload(await readJson(response));
    },

    async signOut(): Promise<void> {
      const response = await fetchImplementation("/api/v1/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
      });

      if (!response.ok && response.status !== 401) {
        throw requestFailed(response, "Sign out");
      }
    },
  };
}

export function createDefaultAuthClient(): AuthClient {
  return createHttpAuthClient();
}
