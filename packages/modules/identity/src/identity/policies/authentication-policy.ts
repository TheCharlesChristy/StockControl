import type { UserRole } from "../role-templates";

export const IDENTITY_SECURITY_LIMITS = Object.freeze({
  minimumLifetimeSeconds: 60,
  minimumInvitationSeconds: 5 * 60,
  minimumPasswordResetSeconds: 5 * 60,
  maximumStandardSessionIdleSeconds: 2 * 60 * 60,
  maximumAdminSessionIdleSeconds: 30 * 60,
  maximumSessionAbsoluteSeconds: 12 * 60 * 60,
  maximumRecentAuthenticationSeconds: 60 * 60,
  maximumAuthenticationChallengeSeconds: 60 * 60,
  maximumInvitationSeconds: 72 * 60 * 60,
  maximumPasswordResetSeconds: 60 * 60,
});

export interface IdentitySecurityPolicy {
  readonly standardSessionIdleSeconds: number;
  readonly adminSessionIdleSeconds: number;
  readonly sessionAbsoluteSeconds: number;
  readonly recentAuthenticationSeconds: number;
  readonly authenticationChallengeSeconds: number;
  readonly invitationSeconds: number;
  readonly passwordResetSeconds: number;
}

export const DEFAULT_IDENTITY_SECURITY_POLICY: IdentitySecurityPolicy = Object.freeze({
  standardSessionIdleSeconds: IDENTITY_SECURITY_LIMITS.maximumStandardSessionIdleSeconds,
  adminSessionIdleSeconds: IDENTITY_SECURITY_LIMITS.maximumAdminSessionIdleSeconds,
  sessionAbsoluteSeconds: IDENTITY_SECURITY_LIMITS.maximumSessionAbsoluteSeconds,
  recentAuthenticationSeconds: 15 * 60,
  authenticationChallengeSeconds: 10 * 60,
  invitationSeconds: IDENTITY_SECURITY_LIMITS.maximumInvitationSeconds,
  passwordResetSeconds: IDENTITY_SECURITY_LIMITS.maximumPasswordResetSeconds,
});

export type AuthenticationPolicyErrorCode =
  | "PolicyValueInvalid"
  | "PolicyRelationshipInvalid"
  | "InstantInvalid"
  | "ActivityBeforePreviousActivity"
  | "SessionAlreadyExpired"
  | "AdminMfaRequired"
  | "MfaAssuranceUnavailable";

export class AuthenticationPolicyError extends Error {
  public constructor(
    public readonly code: AuthenticationPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthenticationPolicyError";
  }
}

const requireBoundedSeconds = (
  value: number,
  maximum: number,
  name: string,
  minimum: number = IDENTITY_SECURITY_LIMITS.minimumLifetimeSeconds,
): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AuthenticationPolicyError(
      "PolicyValueInvalid",
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)} seconds.`,
    );
  }

  return value;
};

export const createIdentitySecurityPolicy = (
  input: IdentitySecurityPolicy,
): IdentitySecurityPolicy => {
  const policy = {
    standardSessionIdleSeconds: requireBoundedSeconds(
      input.standardSessionIdleSeconds,
      IDENTITY_SECURITY_LIMITS.maximumStandardSessionIdleSeconds,
      "Standard session idle lifetime",
    ),
    adminSessionIdleSeconds: requireBoundedSeconds(
      input.adminSessionIdleSeconds,
      IDENTITY_SECURITY_LIMITS.maximumAdminSessionIdleSeconds,
      "Admin session idle lifetime",
    ),
    sessionAbsoluteSeconds: requireBoundedSeconds(
      input.sessionAbsoluteSeconds,
      IDENTITY_SECURITY_LIMITS.maximumSessionAbsoluteSeconds,
      "Absolute session lifetime",
    ),
    recentAuthenticationSeconds: requireBoundedSeconds(
      input.recentAuthenticationSeconds,
      IDENTITY_SECURITY_LIMITS.maximumRecentAuthenticationSeconds,
      "Recent-authentication lifetime",
    ),
    authenticationChallengeSeconds: requireBoundedSeconds(
      input.authenticationChallengeSeconds,
      IDENTITY_SECURITY_LIMITS.maximumAuthenticationChallengeSeconds,
      "Authentication challenge lifetime",
    ),
    invitationSeconds: requireBoundedSeconds(
      input.invitationSeconds,
      IDENTITY_SECURITY_LIMITS.maximumInvitationSeconds,
      "Invitation lifetime",
      IDENTITY_SECURITY_LIMITS.minimumInvitationSeconds,
    ),
    passwordResetSeconds: requireBoundedSeconds(
      input.passwordResetSeconds,
      IDENTITY_SECURITY_LIMITS.maximumPasswordResetSeconds,
      "Password-reset lifetime",
      IDENTITY_SECURITY_LIMITS.minimumPasswordResetSeconds,
    ),
  };

  if (
    policy.adminSessionIdleSeconds > policy.standardSessionIdleSeconds ||
    policy.standardSessionIdleSeconds > policy.sessionAbsoluteSeconds
  ) {
    throw new AuthenticationPolicyError(
      "PolicyRelationshipInvalid",
      "Admin idle lifetime must not exceed standard idle lifetime, and standard idle lifetime must not exceed the absolute lifetime.",
    );
  }

  return Object.freeze(policy);
};

const instantMilliseconds = (value: Date, name: string): number => {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new AuthenticationPolicyError("InstantInvalid", `${name} must be a valid instant.`);
  }
  return milliseconds;
};

const plusSeconds = (instant: Date, seconds: number): Date => {
  const result = new Date(instantMilliseconds(instant, "Base instant") + seconds * 1_000);
  instantMilliseconds(result, "Calculated instant");
  return result;
};

const earlierInstant = (left: Date, right: Date): Date =>
  left.getTime() <= right.getTime() ? new Date(left.getTime()) : new Date(right.getTime());

export type AuthenticationAssurance = "Password" | "MultiFactor";

export const assertAuthenticationAssurance = (
  role: UserRole,
  mfaEnabled: boolean,
  assurance: AuthenticationAssurance,
): void => {
  if (role === "Admin" && (!mfaEnabled || assurance !== "MultiFactor")) {
    throw new AuthenticationPolicyError(
      "AdminMfaRequired",
      "An Admin session requires an enrolled MFA credential and multi-factor assurance.",
    );
  }

  if (assurance === "MultiFactor" && !mfaEnabled) {
    throw new AuthenticationPolicyError(
      "MfaAssuranceUnavailable",
      "Multi-factor assurance requires an enrolled MFA credential.",
    );
  }
};

export interface SessionWindow {
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

const roleIdleSeconds = (role: UserRole, policy: IdentitySecurityPolicy): number =>
  role === "Admin" ? policy.adminSessionIdleSeconds : policy.standardSessionIdleSeconds;

export const createSessionWindow = (
  role: UserRole,
  issuedAt: Date,
  policy: IdentitySecurityPolicy,
): SessionWindow => {
  const validatedPolicy = createIdentitySecurityPolicy(policy);
  const issuedMilliseconds = instantMilliseconds(issuedAt, "Issued instant");
  const issued = new Date(issuedMilliseconds);
  const absoluteExpiresAt = plusSeconds(issued, validatedPolicy.sessionAbsoluteSeconds);

  return Object.freeze({
    issuedAt: issued,
    lastSeenAt: new Date(issuedMilliseconds),
    idleExpiresAt: earlierInstant(
      plusSeconds(issued, roleIdleSeconds(role, validatedPolicy)),
      absoluteExpiresAt,
    ),
    absoluteExpiresAt,
  });
};

export interface RefreshSessionWindowInput {
  readonly role: UserRole;
  readonly previous: SessionWindow;
  readonly activityAt: Date;
  readonly policy: IdentitySecurityPolicy;
}

export const refreshSessionWindow = (input: RefreshSessionWindowInput): SessionWindow => {
  const policy = createIdentitySecurityPolicy(input.policy);
  const issuedAt = instantMilliseconds(input.previous.issuedAt, "Issued instant");
  const previousActivity = instantMilliseconds(
    input.previous.lastSeenAt,
    "Previous activity instant",
  );
  const absoluteExpiry = instantMilliseconds(input.previous.absoluteExpiresAt, "Absolute expiry");
  const activity = instantMilliseconds(input.activityAt, "Activity instant");

  if (activity < previousActivity || activity < issuedAt) {
    throw new AuthenticationPolicyError(
      "ActivityBeforePreviousActivity",
      "Session activity cannot move backwards.",
    );
  }

  if (activity >= absoluteExpiry) {
    throw new AuthenticationPolicyError(
      "SessionAlreadyExpired",
      "An expired session cannot be refreshed.",
    );
  }

  const activityAt = new Date(activity);
  const absoluteExpiresAt = new Date(absoluteExpiry);
  return Object.freeze({
    issuedAt: new Date(issuedAt),
    lastSeenAt: activityAt,
    idleExpiresAt: earlierInstant(
      plusSeconds(activityAt, roleIdleSeconds(input.role, policy)),
      absoluteExpiresAt,
    ),
    absoluteExpiresAt,
  });
};

export const isSessionExpired = (
  session: Pick<SessionWindow, "idleExpiresAt" | "absoluteExpiresAt">,
  now: Date,
): boolean => {
  const current = instantMilliseconds(now, "Current instant");
  return (
    current >= instantMilliseconds(session.idleExpiresAt, "Idle expiry") ||
    current >= instantMilliseconds(session.absoluteExpiresAt, "Absolute expiry")
  );
};

export const hasRecentAuthentication = (
  authenticatedAt: Date,
  now: Date,
  policy: IdentitySecurityPolicy,
): boolean => {
  const validatedPolicy = createIdentitySecurityPolicy(policy);
  const authentication = instantMilliseconds(authenticatedAt, "Authentication instant");
  const current = instantMilliseconds(now, "Current instant");

  return (
    authentication <= current &&
    current - authentication <= validatedPolicy.recentAuthenticationSeconds * 1_000
  );
};

export type ExpiringAuthenticationArtifact =
  "AuthenticationChallenge" | "Invitation" | "PasswordReset";

export const authenticationArtifactExpiry = (
  kind: ExpiringAuthenticationArtifact,
  createdAt: Date,
  policy: IdentitySecurityPolicy,
): Date => {
  const validatedPolicy = createIdentitySecurityPolicy(policy);
  const seconds =
    kind === "AuthenticationChallenge"
      ? validatedPolicy.authenticationChallengeSeconds
      : kind === "Invitation"
        ? validatedPolicy.invitationSeconds
        : validatedPolicy.passwordResetSeconds;

  return plusSeconds(createdAt, seconds);
};
