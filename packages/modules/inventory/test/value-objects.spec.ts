import { describe, expect, it } from "vitest";

import {
  actorId,
  canonicalInstant,
  catalogueItemId,
  commitmentId,
  compareLedgerSequences,
  demandIdentity,
  effectivePermission,
  idempotencyKey,
  idempotencyScope,
  inboundLineId,
  InventoryDomainError,
  isQuantityConditionUsable,
  isQuantityLifecycleAvailable,
  isSerializedConditionUsable,
  isSerializedLifecycleAvailable,
  ledgerEntryId,
  ledgerSequence,
  ledgerTransactionId,
  locationId,
  outcomeReference,
  reason,
  requestFingerprint,
  serializedAssetId,
  stockHoldingId,
} from "../src";

describe("opaque inventory identifiers", () => {
  const factories = [
    catalogueItemId,
    stockHoldingId,
    serializedAssetId,
    locationId,
    commitmentId,
    inboundLineId,
    demandIdentity,
    ledgerEntryId,
    ledgerTransactionId,
    actorId,
    effectivePermission,
    idempotencyScope,
    idempotencyKey,
    outcomeReference,
  ] as const;

  it("trims and accepts bounded non-control identifiers", () => {
    for (const factory of factories) {
      expect(factory("  stable-id  ")).toBe("stable-id");
    }
  });

  it("rejects blank, overlong, and control-character identifiers", () => {
    for (const factory of factories) {
      expect(() => factory(" \t ")).toThrowError(
        expect.objectContaining({ code: "ValueRequired" }),
      );
      expect(() => factory("a".repeat(129))).toThrowError(
        expect.objectContaining({ code: "ValueTooLong" }),
      );
      expect(() => factory("bad\u0000id")).toThrowError(
        expect.objectContaining({ code: "ValueInvalid" }),
      );
    }
  });
});

describe("audit value objects", () => {
  it("accepts only canonical lowercase SHA-256 fingerprints", () => {
    const valid = `sha256:${"a".repeat(64)}`;
    expect(requestFingerprint(valid)).toBe(valid);

    for (const invalid of [
      "a".repeat(64),
      `sha256:${"A".repeat(64)}`,
      `sha256:${"a".repeat(63)}`,
      `sha512:${"a".repeat(64)}`,
    ]) {
      expect(() => requestFingerprint(invalid)).toThrowError(
        expect.objectContaining({ code: "ValueInvalid" }),
      );
    }
  });

  it("normalises reasons and enforces meaningful bounded text", () => {
    expect(reason("  Count correction  ")).toBe("Count correction");
    expect(() => reason(" ")).toThrowError(expect.objectContaining({ code: "ValueRequired" }));
    expect(() => reason("a".repeat(1_001))).toThrowError(
      expect.objectContaining({ code: "ValueTooLong" }),
    );
    expect(() => reason("unsafe\nreason")).toThrowError(
      expect.objectContaining({ code: "ValueInvalid" }),
    );
  });

  it("accepts real canonical UTC millisecond instants only", () => {
    const valid = "2026-02-28T12:34:56.789Z";
    expect(canonicalInstant(valid)).toBe(valid);

    for (const invalid of [
      "2026-02-28T12:34:56Z",
      "2026-02-28T12:34:56.789+00:00",
      "2026-02-30T12:34:56.789Z",
      "not-a-date",
    ]) {
      expect(() => canonicalInstant(invalid)).toThrowError(
        expect.objectContaining({ code: "ValueInvalid" }),
      );
    }
  });

  it("uses canonical positive decimal strings for ledger sequence ordering", () => {
    const one = ledgerSequence("1");
    const two = ledgerSequence("2");
    const large = ledgerSequence("10000000000000000000");

    expect(compareLedgerSequences(one, two)).toBe(-1);
    expect(compareLedgerSequences(two, one)).toBe(1);
    expect(compareLedgerSequences(large, large)).toBe(0);

    for (const invalid of ["", "0", "-1", "01", "1.0", "100000000000000000000"]) {
      expect(() => ledgerSequence(invalid)).toThrowError(
        expect.objectContaining({ code: "LedgerSequenceInvalid" }),
      );
    }
  });
});

describe("condition and lifecycle classification", () => {
  it("keeps quantity condition independent from physical lifecycle", () => {
    expect(isQuantityConditionUsable("Usable")).toBe(true);
    expect(isQuantityConditionUsable("Quarantined")).toBe(false);
    expect(isQuantityConditionUsable("Damaged")).toBe(false);
    expect(isQuantityConditionUsable("Expired")).toBe(false);
    expect(isQuantityLifecycleAvailable("OnHand")).toBe(true);
    expect(isQuantityLifecycleAvailable("InTransit")).toBe(false);
    expect(isQuantityLifecycleAvailable("AtJobSite")).toBe(false);
    expect(isQuantityLifecycleAvailable("InCustody")).toBe(false);
    expect(isQuantityLifecycleAvailable("WrittenOff")).toBe(false);
  });

  it("allows damaged-usable tools while excluding unsafe or unavailable assets", () => {
    expect(isSerializedConditionUsable("Good")).toBe(true);
    expect(isSerializedConditionUsable("DamagedUsable")).toBe(true);
    expect(isSerializedConditionUsable("Unsafe")).toBe(false);
    expect(isSerializedLifecycleAvailable("InStock")).toBe(true);

    for (const lifecycle of [
      "InTransit",
      "InCustody",
      "AtJobSite",
      "Missing",
      "Retired",
      "WrittenOff",
    ] as const) {
      expect(isSerializedLifecycleAvailable(lifecycle)).toBe(false);
    }
  });
});

describe("InventoryDomainError", () => {
  it("retains a stable machine-readable code", () => {
    const error = new InventoryDomainError("ValueInvalid", "Invalid value");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InventoryDomainError");
    expect(error.code).toBe("ValueInvalid");
    expect(error.message).toBe("Invalid value");
  });
});
