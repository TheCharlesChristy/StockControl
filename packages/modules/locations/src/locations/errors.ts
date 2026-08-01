export type LocationDomainErrorCode =
  | "ArchivedEntity"
  | "CodeAlreadyUsed"
  | "DuplicateEntity"
  | "InvalidBackground"
  | "InvalidGeometry"
  | "InvalidOperation"
  | "MissingEntity"
  | "NoChange"
  | "PermissionDenied";

export class LocationDomainError extends Error {
  public constructor(
    public readonly code: LocationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LocationDomainError";
  }
}

export function failLocation(code: LocationDomainErrorCode, message: string): never {
  throw new LocationDomainError(code, message);
}
