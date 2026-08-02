export const userRoles = ["Engineer", "Office", "Admin"] as const;

export type UserRole = (typeof userRoles)[number];

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly profilePhotoUrl: string | null;
}

export interface AuthenticatedSession {
  readonly user: AuthenticatedUser;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface SessionResponse {
  readonly session: AuthenticatedSession;
}

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
}

export type SignInResponse = SessionResponse;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (userRoles as readonly string[]).includes(value);
}

export function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["email"] === "string" &&
    typeof value["displayName"] === "string" &&
    isUserRole(value["role"]) &&
    (typeof value["profilePhotoUrl"] === "string" || value["profilePhotoUrl"] === null)
  );
}

export function isAuthenticatedSession(value: unknown): value is AuthenticatedSession {
  return (
    isRecord(value) &&
    isAuthenticatedUser(value["user"]) &&
    typeof value["issuedAt"] === "string" &&
    typeof value["expiresAt"] === "string"
  );
}

export function isSessionResponse(value: unknown): value is SessionResponse {
  return isRecord(value) && isAuthenticatedSession(value["session"]);
}
