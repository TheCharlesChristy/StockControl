export const userRoles = ["Engineer", "Office", "Admin"] as const;

export type UserRole = (typeof userRoles)[number];

/**
 * A length-first password policy keeps the rule understandable while allowing
 * passphrases, spaces, Unicode and password-manager output without arbitrary
 * composition requirements.
 */
export const passwordPolicy = Object.freeze({
  minimumCharacters: 15,
  maximumCharacters: 128,
});

export const passwordPolicyErrors = (password: string): readonly string[] => {
  const characterCount = [...password.normalize("NFKC")].length;

  if (characterCount < passwordPolicy.minimumCharacters) {
    return [`Use at least ${String(passwordPolicy.minimumCharacters)} characters.`];
  }

  if (characterCount > passwordPolicy.maximumCharacters) {
    return [`Use no more than ${String(passwordPolicy.maximumCharacters)} characters.`];
  }

  return [];
};

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  readonly profilePhotoUrl: string | null;
  /**
   * Set while the current password was chosen by somebody else — at account
   * creation, or by an Admin reset. The browser sends the user to change it
   * before anything else; the server does not rely on the browser doing so.
   */
  readonly mustChangePassword: boolean;
}

export interface AuthenticatedSession {
  readonly user: AuthenticatedUser;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

/** Server-decided feature availability, so an unflagged deployment never
 * renders an entry point for something the API will refuse anyway. */
export interface SessionFeatures {
  readonly stockCapture: boolean;
}

export interface SessionResponse {
  readonly session: AuthenticatedSession;
  readonly features: SessionFeatures;
}

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
}

export type SignInResponse = SessionResponse;

/** Changing your own password. The current one is required; a reset is not this. */
export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/** An Admin setting a password for somebody else, who must then replace it. */
export interface ResetPasswordRequest {
  readonly newPassword: string;
}

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
    (typeof value["profilePhotoUrl"] === "string" || value["profilePhotoUrl"] === null) &&
    typeof value["mustChangePassword"] === "boolean"
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

function isSessionFeatures(value: unknown): value is SessionFeatures {
  return isRecord(value) && typeof value["stockCapture"] === "boolean";
}

export function isSessionResponse(value: unknown): value is SessionResponse {
  return (
    isRecord(value) &&
    isAuthenticatedSession(value["session"]) &&
    isSessionFeatures(value["features"])
  );
}
