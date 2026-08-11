import type { AuthenticatedSession, SessionFeatures, SignInRequest } from "@stockcontrol/contracts";

export {
  userRoles,
  isAuthenticatedSession,
  isAuthenticatedUser,
  type AuthenticatedSession,
  type AuthenticatedUser,
  type SessionFeatures,
  type SignInRequest as SignInCredentials,
  type UserRole,
} from "@stockcontrol/contracts";

/** The session plus the server-decided feature flags that came with it. */
export interface SessionOutcome {
  readonly session: AuthenticatedSession;
  readonly features: SessionFeatures;
}

export interface AuthClient {
  getSession(signal: AbortSignal): Promise<SessionOutcome | null>;
  signIn(credentials: SignInRequest): Promise<SessionOutcome>;
  signOut(): Promise<void>;
}
