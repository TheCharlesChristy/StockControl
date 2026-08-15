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

/**
 * The sign-in identifier. Kept deliberately narrow: sign-in accepts a username
 * and nothing else, so a name shaped like an email address would be typed at
 * the field, refused, and read as a bug. Excluding `@` outright is cheaper than
 * explaining that. Names are stored lowercase, which makes uniqueness
 * case-insensitive without a functional index.
 */
export const usernameRules = Object.freeze({
  minimumCharacters: 3,
  maximumCharacters: 32,
});

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;

export const normaliseUsername = (value: string): string => value.trim().toLowerCase();

export const usernameFormatErrors = (username: string): readonly string[] => {
  const characterCount = [...username].length;

  if (characterCount < usernameRules.minimumCharacters) {
    return [`Use at least ${String(usernameRules.minimumCharacters)} characters.`];
  }

  if (characterCount > usernameRules.maximumCharacters) {
    return [`Use no more than ${String(usernameRules.maximumCharacters)} characters.`];
  }

  if (!USERNAME_PATTERN.test(username)) {
    return [
      "Use letters, numbers, dots, hyphens and underscores only, starting and ending with a letter or number.",
    ];
  }

  return [];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const emailRules = Object.freeze({ maximumCharacters: 320 });

/**
 * Deliberately forgiving. The address is contact information the product never
 * sends to, so the only thing worth refusing is something that plainly is not
 * an address at all — a stricter rule would reject real mailboxes to no end.
 */
export const emailFormatErrors = (email: string): readonly string[] => {
  /*
   * The length check runs first and short-circuits, because EMAIL_PATTERN's
   * two adjacent `[^\s@]+` groups can backtrack polynomially on a long,
   * dot-heavy string — bounding the input before the regex ever runs is what
   * keeps that cheap.
   */
  if ([...email].length > emailRules.maximumCharacters || !EMAIL_PATTERN.test(email)) {
    return ["Enter a valid email address."];
  }

  return [];
};

export interface AuthenticatedUser {
  readonly id: string;
  readonly username: string;
  /** Optional contact information. Nothing is ever sent to it; see ADR 0003. */
  readonly email: string | null;
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
  readonly username: string;
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
    typeof value["username"] === "string" &&
    (typeof value["email"] === "string" || value["email"] === null) &&
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
