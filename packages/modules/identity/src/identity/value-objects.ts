type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type UserId = Brand<string, "UserId">;
export type NormalisedEmailAddress = Brand<string, "NormalisedEmailAddress">;
export type UserDisplayName = Brand<string, "UserDisplayName">;

export type IdentityValueErrorCode =
  "UserIdRequired" | "EmailAddressInvalid" | "DisplayNameRequired" | "DisplayNameTooLong";

export class IdentityValueError extends Error {
  public constructor(
    public readonly code: IdentityValueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IdentityValueError";
  }
}

export function userId(value: string): UserId {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new IdentityValueError("UserIdRequired", "A user ID is required.");
  }

  return trimmed as UserId;
}

export function normaliseEmailAddress(value: string): NormalisedEmailAddress {
  const normalised = value.trim().toLowerCase();
  const atIndex = normalised.lastIndexOf("@");
  const hasExactlyOneAt = atIndex === normalised.indexOf("@");
  const hasValidLocalPart = atIndex > 0 && atIndex <= 64;
  const hasValidDomain = atIndex < normalised.length - 1;
  const isWithinMaximumLength = normalised.length <= 254;
  const hasWhitespace = /\s/u.test(normalised);

  if (
    !hasExactlyOneAt ||
    !hasValidLocalPart ||
    !hasValidDomain ||
    !isWithinMaximumLength ||
    hasWhitespace
  ) {
    throw new IdentityValueError(
      "EmailAddressInvalid",
      "The email address must contain one local part and one domain.",
    );
  }

  return normalised as NormalisedEmailAddress;
}

export function userDisplayName(value: string): UserDisplayName {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new IdentityValueError("DisplayNameRequired", "A display name is required.");
  }

  if (trimmed.length > 200) {
    throw new IdentityValueError(
      "DisplayNameTooLong",
      "A display name cannot exceed 200 characters.",
    );
  }

  return trimmed as UserDisplayName;
}
