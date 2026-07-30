export const authenticationRateLimitScopes = [
  "SignInAccount",
  "SignInNetwork",
  "MfaChallenge",
  "PasswordResetAccount",
  "PasswordResetNetwork",
  "Bootstrap",
  "InvitationAcceptance",
  "InvitationAcceptanceNetwork",
  "MfaRecovery",
] as const;

export type AuthenticationRateLimitScope = (typeof authenticationRateLimitScopes)[number];

export interface AuthenticationRateLimitRule {
  readonly windowSeconds: number;
  readonly maximumFailures: number;
  readonly blockSeconds: number;
}

export const DEFAULT_AUTHENTICATION_RATE_LIMITS = Object.freeze({
  SignInAccount: Object.freeze({
    windowSeconds: 15 * 60,
    maximumFailures: 5,
    blockSeconds: 15 * 60,
  }),
  SignInNetwork: Object.freeze({
    windowSeconds: 15 * 60,
    maximumFailures: 50,
    blockSeconds: 15 * 60,
  }),
  MfaChallenge: Object.freeze({
    windowSeconds: 10 * 60,
    maximumFailures: 5,
    blockSeconds: 10 * 60,
  }),
  PasswordResetAccount: Object.freeze({
    windowSeconds: 60 * 60,
    maximumFailures: 5,
    blockSeconds: 60 * 60,
  }),
  PasswordResetNetwork: Object.freeze({
    windowSeconds: 60 * 60,
    maximumFailures: 30,
    blockSeconds: 60 * 60,
  }),
  Bootstrap: Object.freeze({
    windowSeconds: 10 * 60,
    maximumFailures: 5,
    blockSeconds: 30 * 60,
  }),
  InvitationAcceptance: Object.freeze({
    windowSeconds: 15 * 60,
    maximumFailures: 5,
    blockSeconds: 30 * 60,
  }),
  InvitationAcceptanceNetwork: Object.freeze({
    windowSeconds: 15 * 60,
    maximumFailures: 30,
    blockSeconds: 30 * 60,
  }),
  MfaRecovery: Object.freeze({
    windowSeconds: 60 * 60,
    maximumFailures: 5,
    blockSeconds: 60 * 60,
  }),
}) satisfies Readonly<Record<AuthenticationRateLimitScope, AuthenticationRateLimitRule>>;

export interface AuthenticationRateLimitBucket {
  readonly windowStartedAt: Date;
  readonly expiresAt: Date;
  readonly failureCount: number;
  readonly blockedUntil?: Date;
}

export type AuthenticationRateLimitDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly retryAt: Date;
      readonly reason: "Blocked" | "FailureLimitReached";
    };

export type RateLimitPolicyErrorCode =
  "RateLimitRuleInvalid" | "RateLimitBucketInvalid" | "InstantInvalid";

export class RateLimitPolicyError extends Error {
  public constructor(
    public readonly code: RateLimitPolicyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RateLimitPolicyError";
  }
}

const instantMilliseconds = (value: Date): number => {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    throw new RateLimitPolicyError("InstantInvalid", "Rate-limit time must be a valid instant.");
  }
  return milliseconds;
};

export const createAuthenticationRateLimitRule = (
  input: AuthenticationRateLimitRule,
): AuthenticationRateLimitRule => {
  if (
    !Number.isSafeInteger(input.windowSeconds) ||
    input.windowSeconds < 60 ||
    input.windowSeconds > 24 * 60 * 60 ||
    !Number.isSafeInteger(input.maximumFailures) ||
    input.maximumFailures < 1 ||
    input.maximumFailures > 1_000 ||
    !Number.isSafeInteger(input.blockSeconds) ||
    input.blockSeconds < 60 ||
    input.blockSeconds > 24 * 60 * 60
  ) {
    throw new RateLimitPolicyError(
      "RateLimitRuleInvalid",
      "Rate-limit rules require a 1-minute to 24-hour window and block, with 1-1000 failures.",
    );
  }

  return Object.freeze({ ...input });
};

const validateBucket = (input: AuthenticationRateLimitBucket): AuthenticationRateLimitBucket => {
  const started = instantMilliseconds(input.windowStartedAt);
  const expires = instantMilliseconds(input.expiresAt);
  const blocked =
    input.blockedUntil === undefined ? undefined : instantMilliseconds(input.blockedUntil);

  if (
    expires <= started ||
    !Number.isSafeInteger(input.failureCount) ||
    input.failureCount < 0 ||
    (blocked !== undefined && blocked < started)
  ) {
    throw new RateLimitPolicyError(
      "RateLimitBucketInvalid",
      "Rate-limit bucket state is internally inconsistent.",
    );
  }

  return Object.freeze({
    windowStartedAt: new Date(started),
    expiresAt: new Date(expires),
    failureCount: input.failureCount,
    ...(blocked === undefined ? {} : { blockedUntil: new Date(blocked) }),
  });
};

const frozenAllowedDecision: AuthenticationRateLimitDecision = Object.freeze({
  allowed: true,
});

export const evaluateAuthenticationRateLimit = (
  bucketInput: AuthenticationRateLimitBucket | undefined,
  attemptedAt: Date,
  ruleInput: AuthenticationRateLimitRule,
): AuthenticationRateLimitDecision => {
  const now = instantMilliseconds(attemptedAt);
  const rule = createAuthenticationRateLimitRule(ruleInput);
  if (bucketInput === undefined) {
    return frozenAllowedDecision;
  }

  const bucket = validateBucket(bucketInput);
  const blockedUntil = bucket.blockedUntil?.getTime();
  if (blockedUntil !== undefined && now < blockedUntil) {
    return Object.freeze({
      allowed: false,
      reason: "Blocked",
      retryAt: new Date(blockedUntil),
    });
  }

  if (now >= bucket.expiresAt.getTime()) {
    return frozenAllowedDecision;
  }

  if (bucket.failureCount >= rule.maximumFailures) {
    return Object.freeze({
      allowed: false,
      reason: "FailureLimitReached",
      retryAt: new Date(bucket.expiresAt.getTime()),
    });
  }

  return frozenAllowedDecision;
};

export const recordAuthenticationFailure = (
  bucketInput: AuthenticationRateLimitBucket | undefined,
  failedAt: Date,
  ruleInput: AuthenticationRateLimitRule,
): AuthenticationRateLimitBucket => {
  const now = instantMilliseconds(failedAt);
  const rule = createAuthenticationRateLimitRule(ruleInput);
  const existing = bucketInput === undefined ? undefined : validateBucket(bucketInput);
  const startsNewWindow = existing === undefined || now >= existing.expiresAt.getTime();
  const windowStartedAt = startsNewWindow ? new Date(now) : existing.windowStartedAt;
  const expiresAt = startsNewWindow
    ? new Date(now + rule.windowSeconds * 1_000)
    : existing.expiresAt;
  const failureCount = startsNewWindow ? 1 : existing.failureCount + 1;
  const existingBlock = startsNewWindow ? undefined : existing.blockedUntil?.getTime();
  const newBlock =
    failureCount >= rule.maximumFailures ? now + rule.blockSeconds * 1_000 : undefined;
  const blockedUntil =
    existingBlock === undefined
      ? newBlock
      : newBlock === undefined
        ? existingBlock
        : Math.max(existingBlock, newBlock);

  return Object.freeze({
    windowStartedAt: new Date(windowStartedAt.getTime()),
    expiresAt: new Date(expiresAt.getTime()),
    failureCount,
    ...(blockedUntil === undefined ? {} : { blockedUntil: new Date(blockedUntil) }),
  });
};

export const clearAuthenticationFailures = (): undefined => undefined;
