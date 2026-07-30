export type InventoryDomainErrorCode =
  | "ValueRequired"
  | "ValueTooLong"
  | "ValueInvalid"
  | "DecimalPolicyInvalid"
  | "DecimalNotCanonical"
  | "DecimalScaleExceeded"
  | "DecimalMagnitudeExceeded"
  | "DecimalDivisionByZero"
  | "DecimalRoundingRequired"
  | "DecimalRoundingPolicyInvalid"
  | "QuantityNegative"
  | "QuantityZero"
  | "QuantityFractionalNotAllowed"
  | "UnitConversionInvalid"
  | "UnitDimensionMismatch"
  | "CatalogueInvariantViolation"
  | "DuplicateIdentifier"
  | "DuplicatePack"
  | "ProjectionInputInvalid"
  | "ProjectionItemMismatch"
  | "ProjectionUnitMismatch"
  | "ProjectionDuplicateIdentity"
  | "ProjectionSourceMissing"
  | "ProjectionOvercommitted"
  | "LedgerInvariantViolation"
  | "LedgerSequenceInvalid"
  | "LedgerSequenceOutOfOrder"
  | "IdempotencyInputInvalid"
  | "IdempotencyConflict";

export class InventoryDomainError extends Error {
  public constructor(
    public readonly code: InventoryDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "InventoryDomainError";
  }
}
