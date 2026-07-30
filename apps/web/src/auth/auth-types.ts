import type {
  AuthenticatedSessionView,
  AuthenticationCompleteResponse,
  SignInRequest,
  SignInResponse,
  VerifyMfaRequest,
} from "@stockcontrol/contracts";

export {
  apiUserRoles as userRoles,
  type ApiUserRole as UserRole,
  type AuthenticatedSessionView as AuthenticatedSession,
  type AuthenticatedUserView as AuthenticatedUser,
  type MfaChallengeView as MfaChallenge,
  type SignInRequest as SignInCredentials,
  type SignInResponse as SignInResult,
  type VerifyMfaRequest as VerifyMfaCredentials,
} from "@stockcontrol/contracts";

export interface AuthClient {
  getSession(signal: AbortSignal): Promise<AuthenticatedSessionView | null>;
  signIn(credentials: SignInRequest): Promise<SignInResponse>;
  verifyMfa(credentials: VerifyMfaRequest): Promise<AuthenticationCompleteResponse>;
  signOut(): Promise<void>;
}
