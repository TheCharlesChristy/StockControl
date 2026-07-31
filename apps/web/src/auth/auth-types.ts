import type { AuthenticatedSession, SignInRequest } from "@stockcontrol/contracts";

export {
  userRoles,
  isAuthenticatedSession,
  isAuthenticatedUser,
  type AuthenticatedSession,
  type AuthenticatedUser,
  type SignInRequest as SignInCredentials,
  type UserRole,
} from "@stockcontrol/contracts";

export interface AuthClient {
  getSession(signal: AbortSignal): Promise<AuthenticatedSession | null>;
  signIn(credentials: SignInRequest): Promise<AuthenticatedSession>;
  signOut(): Promise<void>;
}
