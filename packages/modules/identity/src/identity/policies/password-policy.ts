export const PASSWORD_POLICY_LIMITS = Object.freeze({
  hardMinimumCharacters: 12,
  hardMaximumCharacters: 1_024,
  hardMaximumUtf8Bytes: 1_024,
});

export interface PasswordPolicy {
  readonly minimumCharacters: number;
  readonly maximumCharacters: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minimumCharacters: PASSWORD_POLICY_LIMITS.hardMinimumCharacters,
  maximumCharacters: 128,
});

export type PasswordPolicyConfigurationErrorCode =
  "PasswordMinimumInvalid" | "PasswordMaximumInvalid";

export class PasswordPolicyConfigurationError extends Error {
  public constructor(
    public readonly code: PasswordPolicyConfigurationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PasswordPolicyConfigurationError";
  }
}

export const createPasswordPolicy = (input: PasswordPolicy): PasswordPolicy => {
  if (
    !Number.isSafeInteger(input.minimumCharacters) ||
    input.minimumCharacters < PASSWORD_POLICY_LIMITS.hardMinimumCharacters
  ) {
    throw new PasswordPolicyConfigurationError(
      "PasswordMinimumInvalid",
      `Password minimum must be at least ${String(
        PASSWORD_POLICY_LIMITS.hardMinimumCharacters,
      )} characters.`,
    );
  }

  if (
    !Number.isSafeInteger(input.maximumCharacters) ||
    input.maximumCharacters < input.minimumCharacters ||
    input.maximumCharacters > PASSWORD_POLICY_LIMITS.hardMaximumCharacters
  ) {
    throw new PasswordPolicyConfigurationError(
      "PasswordMaximumInvalid",
      `Password maximum must be between its minimum and ${String(
        PASSWORD_POLICY_LIMITS.hardMaximumCharacters,
      )} characters.`,
    );
  }

  return Object.freeze({ ...input });
};

export type PasswordRejectionCode =
  | "PasswordTooShort"
  | "PasswordTooLong"
  | "PasswordUtf8TooLong"
  | "PasswordContainsControlCharacter";

export type PasswordPolicyDecision =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reasons: readonly PasswordRejectionCode[];
    };

const acceptedPassword: PasswordPolicyDecision = Object.freeze({
  accepted: true,
});

export const evaluateNewPassword = (
  password: string,
  inputPolicy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordPolicyDecision => {
  const policy = createPasswordPolicy(inputPolicy);
  const characters = [...password].length;
  const utf8Bytes = new TextEncoder().encode(password).length;
  const reasons: PasswordRejectionCode[] = [];

  if (characters < policy.minimumCharacters) {
    reasons.push("PasswordTooShort");
  }
  if (characters > policy.maximumCharacters) {
    reasons.push("PasswordTooLong");
  }
  if (utf8Bytes > PASSWORD_POLICY_LIMITS.hardMaximumUtf8Bytes) {
    reasons.push("PasswordUtf8TooLong");
  }
  if (
    [...password].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    reasons.push("PasswordContainsControlCharacter");
  }

  return reasons.length === 0
    ? acceptedPassword
    : Object.freeze({
        accepted: false,
        reasons: Object.freeze(reasons),
      });
};
