import {
  AUTH_CSRF_HEADER,
  isAuthenticatedSessionView,
  isAuthenticatedUserView,
  isSessionResponse,
  isSignInResponse,
  type AuthenticatedSessionView,
  type AuthenticatedUserView,
  type AuthenticationCompleteResponse,
  type SignInRequest,
  type SignInResponse,
  type VerifyMfaRequest,
} from "@stockcontrol/contracts";

import { type AuthClient, type UserRole } from "./auth-types";

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type PreviewClock = () => Date;

const PREVIEW_STORAGE_KEY = "stockcontrol.preview-session.v2";
const PREVIEW_MFA_CODE = "123456";
const PREVIEW_RECOVERY_CODE = "PREVIEW-RECOVERY";
const MILLISECONDS_PER_MINUTE = 60_000;

const previewCapabilities = {
  Engineer: [
    "inventory.view",
    "inventory.take",
    "jobs.view",
    "jobs.reservations.request",
    "jobs.reservations.collect",
    "purchasing.request",
    "locations.view",
    "audit.view.own",
  ],
  Office: [
    "inventory.view",
    "inventory.take",
    "inventory.catalogue.manage",
    "inventory.receive",
    "inventory.transfer",
    "jobs.view",
    "jobs.create",
    "jobs.reservations.manage",
    "purchasing.view",
    "purchasing.process",
    "locations.view",
    "locations.use",
    "stocktakes.start",
    "stocktakes.enter",
    "reports.inventory",
    "reports.operational",
    "audit.view.operational",
  ],
  Admin: [
    "inventory.view",
    "inventory.take",
    "inventory.catalogue.manage",
    "inventory.receive",
    "inventory.transfer",
    "inventory.adjust",
    "jobs.view",
    "jobs.create",
    "jobs.reservations.manage",
    "purchasing.view",
    "purchasing.process",
    "locations.view",
    "locations.use",
    "locations.manage",
    "stocktakes.start",
    "stocktakes.enter",
    "reports.inventory",
    "reports.operational",
    "reports.financial",
    "reports.export",
    "audit.view.all",
    "users.view",
    "users.invite",
    "users.manage",
    "users.permissions.manage",
    "administration.organisation.manage",
  ],
} as const satisfies Readonly<Record<UserRole, readonly string[]>>;

interface PendingPreviewMfa {
  readonly challengeId: string;
  readonly expiresAtMilliseconds: number;
  readonly user: AuthenticatedUserView;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

export function isAuthenticatedUser(value: unknown): value is AuthenticatedUserView {
  return isAuthenticatedUserView(value);
}

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

function parseCsrfToken(value: unknown): string {
  if (!isRecord(value) || typeof value["token"] !== "string" || value["token"].length === 0) {
    throw new Error("The authentication service returned an invalid CSRF token.");
  }

  return value["token"];
}

function parseSessionPayload(value: unknown): AuthenticatedSessionView {
  if (!isSessionResponse(value)) {
    throw new Error("The authentication service returned an invalid session.");
  }

  return value.session;
}

function parseSignInPayload(value: unknown): SignInResponse {
  if (!isSignInResponse(value)) {
    throw new Error("The authentication service returned an invalid authentication response.");
  }

  return value;
}

async function getCsrfToken(fetchImplementation: FetchImplementation): Promise<string> {
  const response = await fetchImplementation("/api/v1/auth/csrf", {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw requestFailed(response, "CSRF token lookup");
  }

  return parseCsrfToken(await readJson(response));
}

async function postJsonWithCsrf(
  fetchImplementation: FetchImplementation,
  path: string,
  action: string,
  body?: unknown,
): Promise<Response> {
  const csrfToken = await getCsrfToken(fetchImplementation);
  const response = await fetchImplementation(path, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      [AUTH_CSRF_HEADER]: csrfToken,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw requestFailed(response, action);
  }

  return response;
}

export function createHttpAuthClient(
  fetchImplementation: FetchImplementation = window.fetch.bind(window),
): AuthClient {
  return {
    async getSession(signal: AbortSignal): Promise<AuthenticatedSessionView | null> {
      const response = await fetchImplementation("/api/v1/auth/session", {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
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

    async signIn(credentials: SignInRequest): Promise<SignInResponse> {
      const response = await postJsonWithCsrf(
        fetchImplementation,
        "/api/v1/auth/sign-in",
        "Sign in",
        credentials,
      );

      return parseSignInPayload(await readJson(response));
    },

    async verifyMfa(credentials: VerifyMfaRequest): Promise<AuthenticationCompleteResponse> {
      const response = await postJsonWithCsrf(
        fetchImplementation,
        "/api/v1/auth/mfa/verify",
        "MFA verification",
        credentials,
      );
      const result = parseSignInPayload(await readJson(response));

      if (result.outcome !== "authenticated") {
        throw new Error("The authentication service did not complete authentication.");
      }

      return result;
    },

    async signOut(): Promise<void> {
      const csrfToken = await getCsrfToken(fetchImplementation);
      const response = await fetchImplementation("/api/v1/auth/sign-out", {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          [AUTH_CSRF_HEADER]: csrfToken,
        },
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

function previewUserForEmail(email: string): AuthenticatedUserView {
  const role = resolvePreviewRole(email);

  return {
    id: `preview-${email}`,
    email,
    displayName: resolveDisplayName(email),
    role,
    status: "Active",
    effectiveCapabilities: previewCapabilities[role],
    permissionCatalogueVersion: 1,
    mfaEnabled: role === "Admin",
  };
}

function previewSessionForUser(user: AuthenticatedUserView, now: Date): AuthenticatedSessionView {
  const issuedAt = now.getTime();
  const idleMinutes = user.role === "Admin" ? 30 : 120;

  return {
    user,
    assurance: user.mfaEnabled ? "mfa" : "password",
    issuedAt: new Date(issuedAt).toISOString(),
    idleExpiresAt: new Date(issuedAt + idleMinutes * MILLISECONDS_PER_MINUTE).toISOString(),
    absoluteExpiresAt: new Date(issuedAt + 12 * 60 * MILLISECONDS_PER_MINUTE).toISOString(),
    recentlyAuthenticatedAt: new Date(issuedAt).toISOString(),
  };
}

function storePreviewSession(storage: Storage, session: AuthenticatedSessionView): void {
  storage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(session));
}

export function createPreviewAuthClient(
  storage: Storage,
  clock: PreviewClock = () => new Date(),
): AuthClient {
  let pendingMfa: PendingPreviewMfa | null = null;

  return {
    getSession(signal: AbortSignal): Promise<AuthenticatedSessionView | null> {
      signal.throwIfAborted();

      try {
        const storedValue = storage.getItem(PREVIEW_STORAGE_KEY);

        if (storedValue === null) {
          return Promise.resolve(null);
        }

        const parsedValue: unknown = JSON.parse(storedValue);
        const now = clock().getTime();

        if (
          !isAuthenticatedSessionView(parsedValue) ||
          Date.parse(parsedValue.idleExpiresAt) <= now ||
          Date.parse(parsedValue.absoluteExpiresAt) <= now
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

    signIn(credentials: SignInRequest): Promise<SignInResponse> {
      const normalizedEmail = credentials.email.trim().toLowerCase();
      const user = previewUserForEmail(normalizedEmail);

      if (user.mfaEnabled) {
        const now = clock().getTime();
        pendingMfa = {
          challengeId: `preview-mfa-${normalizedEmail}`,
          expiresAtMilliseconds: now + 5 * MILLISECONDS_PER_MINUTE,
          user,
        };

        return Promise.resolve({
          outcome: "mfa_required",
          challenge: {
            id: pendingMfa.challengeId,
            expiresAt: new Date(now + 5 * MILLISECONDS_PER_MINUTE).toISOString(),
            methods: ["totp", "recovery_code"],
          },
        });
      }

      const session = previewSessionForUser(user, clock());
      storePreviewSession(storage, session);

      return Promise.resolve({
        outcome: "authenticated",
        session,
      });
    },

    verifyMfa(credentials: VerifyMfaRequest): Promise<AuthenticationCompleteResponse> {
      if (
        pendingMfa === null ||
        credentials.challengeId !== pendingMfa.challengeId ||
        clock().getTime() >= pendingMfa.expiresAtMilliseconds ||
        (credentials.code !== PREVIEW_MFA_CODE &&
          credentials.code.toUpperCase() !== PREVIEW_RECOVERY_CODE)
      ) {
        return Promise.reject(new Error("Preview MFA verification failed."));
      }

      const session = previewSessionForUser(pendingMfa.user, clock());
      pendingMfa = null;
      storePreviewSession(storage, session);

      return Promise.resolve({
        outcome: "authenticated",
        session,
      });
    },

    signOut(): Promise<void> {
      pendingMfa = null;
      storage.removeItem(PREVIEW_STORAGE_KEY);
      return Promise.resolve();
    },
  };
}

export function createDefaultAuthClient(): AuthClient {
  const previewEnabled = import.meta.env.DEV && import.meta.env.VITE_ENABLE_AUTH_PREVIEW === "true";

  return previewEnabled ? createPreviewAuthClient(window.sessionStorage) : createHttpAuthClient();
}
