import { InventoryDomainError } from "./errors";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });

type Brand<Value, Name extends string> = Value & {
  readonly __brand: Name;
};

export type CatalogueItemId = Brand<string, "CatalogueItemId">;
export type StockHoldingId = Brand<string, "StockHoldingId">;
export type SerializedAssetId = Brand<string, "SerializedAssetId">;
export type LocationId = Brand<string, "LocationId">;
export type CommitmentId = Brand<string, "CommitmentId">;
export type InboundLineId = Brand<string, "InboundLineId">;
export type DemandIdentity = Brand<string, "DemandIdentity">;
export type LedgerEntryId = Brand<string, "LedgerEntryId">;
export type LedgerTransactionId = Brand<string, "LedgerTransactionId">;
export type ActorId = Brand<string, "ActorId">;
export type EffectivePermission = Brand<string, "EffectivePermission">;
export type IdempotencyScope = Brand<string, "IdempotencyScope">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type RequestFingerprint = Brand<string, "RequestFingerprint">;
export type OutcomeReference = Brand<string, "OutcomeReference">;
export type Reason = Brand<string, "Reason">;
export type CanonicalInstant = Brand<string, "CanonicalInstant">;
export type LedgerSequence = Brand<string, "LedgerSequence">;

const opaqueId = <Name extends string>(value: string, label: string): Brand<string, Name> => {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new InventoryDomainError("ValueRequired", `${label} is required.`);
  }

  if (trimmed.length > 128) {
    throw new InventoryDomainError("ValueTooLong", `${label} cannot exceed 128 characters.`);
  }

  if (hasControlCharacter(trimmed)) {
    throw new InventoryDomainError("ValueInvalid", `${label} cannot contain control characters.`);
  }

  return trimmed as Brand<string, Name>;
};

export const catalogueItemId = (value: string): CatalogueItemId =>
  opaqueId<"CatalogueItemId">(value, "Catalogue item ID");

export const stockHoldingId = (value: string): StockHoldingId =>
  opaqueId<"StockHoldingId">(value, "Stock holding ID");

export const serializedAssetId = (value: string): SerializedAssetId =>
  opaqueId<"SerializedAssetId">(value, "Serialized asset ID");

export const locationId = (value: string): LocationId =>
  opaqueId<"LocationId">(value, "Location ID");

export const commitmentId = (value: string): CommitmentId =>
  opaqueId<"CommitmentId">(value, "Commitment ID");

export const inboundLineId = (value: string): InboundLineId =>
  opaqueId<"InboundLineId">(value, "Inbound line ID");

export const demandIdentity = (value: string): DemandIdentity =>
  opaqueId<"DemandIdentity">(value, "Demand identity");

export const ledgerEntryId = (value: string): LedgerEntryId =>
  opaqueId<"LedgerEntryId">(value, "Ledger entry ID");

export const ledgerTransactionId = (value: string): LedgerTransactionId =>
  opaqueId<"LedgerTransactionId">(value, "Ledger transaction ID");

export const actorId = (value: string): ActorId => opaqueId<"ActorId">(value, "Actor ID");

export const effectivePermission = (value: string): EffectivePermission =>
  opaqueId<"EffectivePermission">(value, "Effective permission");

export const idempotencyScope = (value: string): IdempotencyScope =>
  opaqueId<"IdempotencyScope">(value, "Idempotency scope");

export const idempotencyKey = (value: string): IdempotencyKey =>
  opaqueId<"IdempotencyKey">(value, "Idempotency key");

export const outcomeReference = (value: string): OutcomeReference =>
  opaqueId<"OutcomeReference">(value, "Outcome reference");

export function requestFingerprint(value: string): RequestFingerprint {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new InventoryDomainError(
      "ValueInvalid",
      "Request fingerprint must be a lowercase SHA-256 digest prefixed with sha256:.",
    );
  }

  return value as RequestFingerprint;
}

export function reason(value: string): Reason {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new InventoryDomainError("ValueRequired", "A reason is required.");
  }

  if (trimmed.length > 1_000) {
    throw new InventoryDomainError("ValueTooLong", "A reason cannot exceed 1000 characters.");
  }

  if (hasControlCharacter(trimmed)) {
    throw new InventoryDomainError("ValueInvalid", "A reason cannot contain control characters.");
  }

  return trimmed as Reason;
}

export function canonicalInstant(value: string): CanonicalInstant {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new InventoryDomainError(
      "ValueInvalid",
      "Instant must use canonical UTC ISO-8601 notation with milliseconds.",
    );
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new InventoryDomainError("ValueInvalid", "Instant is not a valid UTC date and time.");
  }

  return value as CanonicalInstant;
}

export function ledgerSequence(value: string): LedgerSequence {
  if (!/^[1-9]\d{0,19}$/u.test(value)) {
    throw new InventoryDomainError(
      "LedgerSequenceInvalid",
      "Ledger sequence must be a canonical positive integer of at most 20 digits.",
    );
  }

  return value as LedgerSequence;
}

export function compareLedgerSequences(left: LedgerSequence, right: LedgerSequence): -1 | 0 | 1 {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
