import {
  isAuthenticatedSession,
  isSessionResponse,
  type AuthenticatedSession,
  type SignInRequest,
} from "@stockcontrol/contracts";

import { type AuthClient, type UserRole } from "./auth-types";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PreviewClock = () => Date;

const PREVIEW_STORAGE_KEY = "stockcontrol.preview-session.v3";
const SESSION_HOURS = 12;
const MILLISECONDS_PER_HOUR = 3_600_000;

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

function resolvePreviewRole(email: string): UserRole {
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";

  if (localPart.startsWith("admin")) {
    return "Admin";
  }

  if (localPart.startsWith("engineer")) {
    return "Engineer";
  }

  return "Office";
}

function resolveDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  const words = localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);

  return words.join(" ") || "StockControl preview user";
}

function previewSessionForEmail(email: string, now: Date): AuthenticatedSession {
  const issuedAt = now.getTime();

  return {
    user: {
      id: `preview-${email}`,
      email,
      displayName: resolveDisplayName(email),
      role: resolvePreviewRole(email),
    },
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(issuedAt + SESSION_HOURS * MILLISECONDS_PER_HOUR).toISOString(),
  };
}

/**
 * Development-only stand-in so the application shell runs before the real
 * authentication API exists. It performs no verification whatsoever and is
 * enabled only when VITE_ENABLE_AUTH_PREVIEW is set in a dev build.
 */
export function createPreviewAuthClient(
  storage: Storage,
  clock: PreviewClock = () => new Date(),
): AuthClient {
  return {
    getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
      signal.throwIfAborted();

      try {
        const storedValue = storage.getItem(PREVIEW_STORAGE_KEY);

        if (storedValue === null) {
          return Promise.resolve(null);
        }

        const parsedValue: unknown = JSON.parse(storedValue);

        if (
          !isAuthenticatedSession(parsedValue) ||
          Date.parse(parsedValue.expiresAt) <= clock().getTime()
        ) {
          storage.removeItem(PREVIEW_STORAGE_KEY);
          return Promise.resolve(null);
        }

        return Promise.resolve(parsedValue);
      } catch {
        storage.removeItem(PREVIEW_STORAGE_KEY);
        return Promise.resolve(null);
      }
    },

    signIn(credentials: SignInRequest): Promise<AuthenticatedSession> {
      const session = previewSessionForEmail(credentials.email.trim().toLowerCase(), clock());
      storage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(session));

      return Promise.resolve(session);
    },

    signOut(): Promise<void> {
      storage.removeItem(PREVIEW_STORAGE_KEY);
      return Promise.resolve();
    },
  };
}

export function createDefaultAuthClient(): AuthClient {
  const previewEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_AUTH_PREVIEW === "true";

  return previewEnabled ? createPreviewAuthClient(window.sessionStorage) : createHttpAuthClient();
}
