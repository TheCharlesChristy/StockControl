import type { AuthenticatedSession, SessionFeatures, UserRole } from "@stockcontrol/contracts";

import type { AuthClient, SessionOutcome, SignInCredentials } from "../auth/auth-types";

/**
 * A signed-in session for a role, so a test can render the screens a role
 * really sees. Role and feature flags both matter to what appears: the server
 * decides both, and the browser only mirrors them.
 */
export function sessionFor(role: UserRole): AuthenticatedSession {
  return {
    user: {
      id: `user-${role.toLowerCase()}`,
      username: role.toLowerCase(),
      email: `${role.toLowerCase()}@example.com`,
      displayName: "Sam Field",
      role,
      profilePhotoUrl: null,
      mustChangePassword: false,
    },
    issuedAt: "2026-07-30T09:00:00.000Z",
    expiresAt: "2026-07-30T21:00:00.000Z",
  };
}

export interface StubAuthOptions {
  readonly role?: UserRole;
  readonly features?: SessionFeatures;
}

export function createStubAuthClient({
  role = "Office",
  features = { stockCapture: true },
}: StubAuthOptions = {}): AuthClient {
  const outcome: SessionOutcome = { session: sessionFor(role), features };

  return {
    getSession: (signal: AbortSignal): Promise<SessionOutcome | null> => {
      signal.throwIfAborted();
      return Promise.resolve(outcome);
    },
    signIn: (credentials: SignInCredentials): Promise<SessionOutcome> => {
      void credentials;
      return Promise.resolve(outcome);
    },
    signOut: (): Promise<void> => Promise.resolve(),
  };
}
