export type LocationDomainErrorCode =
  | "ArchivedEntity"
  | "CodeAlreadyUsed"
  | "CrossBranchParent"
  | "CrossBuildingParent"
  | "Cycle"
  | "DuplicateEntity"
  | "IllegalBuildingOwnership"
  | "IllegalNodeKind"
  | "InvalidAssignment"
  | "InvalidBackground"
  | "InvalidGeometry"
  | "InvalidHierarchy"
  | "InvalidMapLink"
  | "InvalidOperation"
  | "InvalidParent"
  | "LocationNotEmpty"
  | "MissingEntity"
  | "NoChange"
  | "Orphan"
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
