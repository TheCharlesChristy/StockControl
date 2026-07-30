import { describe, expect, it } from "vitest";

import {
  builtinUnits,
  canonicalInstant,
  catalogueItemId,
  catalogueItemName,
  commitmentId,
  createCatalogueItem,
  demandIdentity,
  inboundLineId,
  locationId,
  projectAvailability,
  serializedAssetId,
  stockHoldingId,
  type AvailabilityProjectionInput,
  type CommitmentKind,
  type HoldingLocation,
  type QuantityCommitment,
  type QuantityHolding,
  type SerializedCommitment,
  type SerializedHolding,
  type StockCommitment,
  type StockHolding,
} from "../src";
import { decimal, quantityItem, serializedItem } from "./fixtures";

const location = (id: string, kind: HoldingLocation["kind"] = "Fulfilment"): HoldingLocation => ({
  id: locationId(id),
  kind,
});

const quantityHolding = (
  id: string,
  locationValue: HoldingLocation,
  quantity: string,
  overrides: Partial<QuantityHolding> = {},
): QuantityHolding => ({
  holdingId: stockHoldingId(id),
  itemId: quantityItem().id,
  location: locationValue,
  kind: "Quantity",
  unitId: builtinUnits.millimetre.id,
  quantity: decimal(quantity),
  condition: "Usable",
  lifecycle: "OnHand",
  ...overrides,
});

const quantityCommitment = (
  id: string,
  sourceHoldingId: string,
  quantity: string,
  kind: CommitmentKind = "JobReservation",
  overrides: Partial<QuantityCommitment> = {},
): QuantityCommitment => ({
  id: commitmentId(id),
  kind,
  itemId: quantityItem().id,
  sourceHoldingId: stockHoldingId(sourceHoldingId),
  stockKind: "Quantity",
  unitId: builtinUnits.millimetre.id,
  quantity: decimal(quantity),
  ...overrides,
});

const serializedHolding = (
  id: string,
  asset: string,
  locationValue: HoldingLocation,
  overrides: Partial<SerializedHolding> = {},
): SerializedHolding => ({
  holdingId: stockHoldingId(id),
  itemId: serializedItem().id,
  location: locationValue,
  kind: "Serialized",
  assetId: serializedAssetId(asset),
  condition: "Good",
  lifecycle: "InStock",
  ...overrides,
});

const serializedCommitment = (
  id: string,
  source: string,
  asset: string,
  overrides: Partial<SerializedCommitment> = {},
): SerializedCommitment => ({
  id: commitmentId(id),
  kind: "UserAllocation",
  itemId: serializedItem().id,
  sourceHoldingId: stockHoldingId(source),
  stockKind: "Serialized",
  assetId: serializedAssetId(asset),
  ...overrides,
});

const projectedAt = canonicalInstant("2026-08-01T00:00:00.000Z");

const baseInput = (
  overrides: Partial<AvailabilityProjectionInput> = {},
): AvailabilityProjectionInput => ({
  item: quantityItem(),
  holdings: [],
  commitments: [],
  projectedAt,
  ...overrides,
});

describe("quantity availability", () => {
  it("deducts exact source commitments and excludes unusable locations and states", () => {
    const holdings = [
      quantityHolding("h-usable", location("store-a"), "100"),
      quantityHolding("h-expired", location("store-b"), "30", {
        condition: "Expired",
      }),
      quantityHolding("h-van", location("van-a", "Van"), "40"),
      quantityHolding("h-transit", location("store-c"), "10", {
        lifecycle: "InTransit",
      }),
    ];
    const commitments = [
      quantityCommitment("c-job", "h-usable", "20"),
      quantityCommitment("c-user", "h-usable", "10", "UserAllocation"),
      quantityCommitment("c-expired", "h-expired", "5"),
      quantityCommitment("c-van", "h-van", "4", "UserAllocation"),
      quantityCommitment("c-transit", "h-transit", "2"),
    ];

    const result = projectAvailability(
      baseInput({
        holdings,
        commitments,
        confirmedInbound: [
          {
            id: inboundLineId("in-1"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("50"),
            dueAt: projectedAt,
          },
          {
            id: inboundLineId("in-later"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("99"),
            dueAt: canonicalInstant("2026-08-02T00:00:00.000Z"),
          },
        ],
        uncommittedDemand: [
          {
            demandIdentity: demandIdentity("d-linked"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("20"),
            dueAt: projectedAt,
          },
          {
            demandIdentity: demandIdentity("d-linked"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("20"),
            dueAt: projectedAt,
          },
          {
            demandIdentity: demandIdentity("d-later"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("8"),
            dueAt: canonicalInstant("2026-08-03T00:00:00.000Z"),
          },
        ],
      }),
    );

    expect(result.physicalStock.toString()).toBe("180");
    expect(result.eligibleUsableStock.toString()).toBe("100");
    expect(result.jobReserved.toString()).toBe("27");
    expect(result.userAllocated.toString()).toBe("14");
    expect(result.availableNow.toString()).toBe("70");
    expect(result.committedShortfall.toString()).toBe("11");
    expect(result.confirmedInboundDue.toString()).toBe("50");
    expect(result.uncommittedDemandDue.toString()).toBe("20");
    expect(result.projectedAvailable.toString()).toBe("100");
    expect(result.projectedShortfall.toString()).toBe("0");
    expect(result.committedShortfalls).toEqual([
      expect.objectContaining({
        commitmentId: commitmentId("c-expired"),
        reason: "ConditionUnavailable",
      }),
      expect.objectContaining({
        commitmentId: commitmentId("c-van"),
        reason: "LocationExcluded",
      }),
      expect.objectContaining({
        commitmentId: commitmentId("c-transit"),
        reason: "LifecycleUnavailable",
      }),
    ]);
    expect(result.byLocation.map((entry) => entry.location.id)).toEqual([
      locationId("store-a"),
      locationId("store-b"),
      locationId("store-c"),
      locationId("van-a"),
    ]);
    expect(result.byLocation[0]?.availableNow.toString()).toBe("70");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.byLocation)).toBe(true);
    expect(Object.isFrozen(result.byLocation[0]?.location)).toBe(true);
    expect(Object.isFrozen(result.committedShortfalls[0])).toBe(true);
  });

  it("keeps projected shortages signed and visible", () => {
    const result = projectAvailability(
      baseInput({
        uncommittedDemand: [
          {
            demandIdentity: demandIdentity("d-1"),
            itemId: quantityItem().id,
            unitId: builtinUnits.millimetre.id,
            quantity: decimal("12.5"),
            dueAt: projectedAt,
          },
        ],
      }),
    );

    expect(result.availableNow.toString()).toBe("0");
    expect(result.projectedAvailable.toString()).toBe("-12.5");
    expect(result.projectedShortfall.toString()).toBe("12.5");
    expect(result.byLocation).toEqual([]);
  });

  it.each([
    "DisabledStorage",
    "Container",
    "Van",
    "JobSite",
    "UserCustody",
    "Quarantine",
    "Repair",
    "Transit",
    "Inactive",
  ] as const)("excludes the %s location category from general availability", (kind) => {
    const result = projectAvailability(
      baseInput({
        holdings: [quantityHolding("excluded", location("excluded", kind), "2")],
      }),
    );

    expect(result.physicalStock.toString()).toBe("2");
    expect(result.eligibleUsableStock.toString()).toBe("0");
    expect(result.availableNow.toString()).toBe("0");
  });
});

describe("serialized availability", () => {
  it("treats assets as indivisible and keeps condition separate from lifecycle", () => {
    const item = serializedItem();
    const result = projectAvailability({
      item,
      projectedAt,
      holdings: [
        serializedHolding("h-good", "asset-good", location("store")),
        serializedHolding("h-unsafe", "asset-unsafe", location("store"), {
          condition: "Unsafe",
        }),
        serializedHolding("h-van", "asset-van", location("van", "Van"), {
          condition: "DamagedUsable",
        }),
      ],
      commitments: [
        serializedCommitment("c-good", "h-good", "asset-good"),
        serializedCommitment("c-unsafe", "h-unsafe", "asset-unsafe", {
          kind: "JobReservation",
        }),
      ],
    });

    expect(result.physicalStock.toString()).toBe("3");
    expect(result.eligibleUsableStock.toString()).toBe("1");
    expect(result.userAllocated.toString()).toBe("1");
    expect(result.jobReserved.toString()).toBe("1");
    expect(result.availableNow.toString()).toBe("0");
    expect(result.committedShortfall.toString()).toBe("1");
    expect(result.committedShortfalls[0]).toEqual(
      expect.objectContaining({
        assetId: serializedAssetId("asset-unsafe"),
        reason: "ConditionUnavailable",
      }),
    );
  });
});

describe("projection input invariants", () => {
  it("rejects duplicate holding and serialized asset identities", () => {
    const duplicate = quantityHolding("same", location("store"), "1");
    expect(() =>
      projectAvailability(baseInput({ holdings: [duplicate, { ...duplicate }] })),
    ).toThrowError(expect.objectContaining({ code: "ProjectionDuplicateIdentity" }));

    const item = serializedItem();
    expect(() =>
      projectAvailability({
        item,
        projectedAt,
        holdings: [
          serializedHolding("h-1", "asset", location("store")),
          serializedHolding("h-2", "asset", location("store")),
        ],
        commitments: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "ProjectionDuplicateIdentity" }));
  });

  it("rejects item, unit, tracking, and canonical enum mismatches", () => {
    const valid = quantityHolding("h", location("store"), "1");
    const cases: readonly StockHolding[][] = [
      [{ ...valid, itemId: catalogueItemId("other") }],
      [{ ...valid, unitId: builtinUnits.gram.id }],
      [
        serializedHolding("asset-h", "asset", location("store"), {
          itemId: quantityItem().id,
        }),
      ],
      [{ ...valid, location: location("store", "Unknown" as never) }],
      [{ ...valid, condition: "Fresh" as never }],
      [{ ...valid, lifecycle: "Stored" as never }],
    ];

    for (const holdings of cases) {
      expect(() => projectAvailability(baseInput({ holdings }))).toThrowError();
    }

    const invalidSerialized = serializedHolding("asset-h", "asset", location("store"), {
      condition: "Fresh" as never,
    });
    expect(() =>
      projectAvailability({
        item: serializedItem(),
        projectedAt,
        holdings: [invalidSerialized],
        commitments: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "ProjectionInputInvalid" }));
  });

  it("rejects zero and negative physical quantities", () => {
    for (const quantity of ["0", "-1"]) {
      expect(() =>
        projectAvailability(
          baseInput({
            holdings: [quantityHolding("h", location("store"), quantity)],
          }),
        ),
      ).toThrowError();
    }
  });

  it("enforces indivisible counted base units across stock and dated demand", () => {
    const countedItem = createCatalogueItem({
      id: catalogueItemId("item-screws"),
      name: catalogueItemName("Screws"),
      trackingMode: "QuantityBased",
      handlingPolicy: "Consumable",
      baseUnit: builtinUnits.each,
      accessClass: "FreeUse",
    });
    const fractional = decimal("0.5");

    expect(() =>
      projectAvailability({
        item: countedItem,
        projectedAt,
        holdings: [
          {
            holdingId: stockHoldingId("counted"),
            itemId: countedItem.id,
            location: location("store"),
            kind: "Quantity",
            unitId: builtinUnits.each.id,
            quantity: fractional,
            condition: "Usable",
            lifecycle: "OnHand",
          },
        ],
        commitments: [],
      }),
    ).toThrowError(expect.objectContaining({ code: "QuantityFractionalNotAllowed" }));

    expect(() =>
      projectAvailability({
        item: serializedItem(),
        projectedAt,
        holdings: [],
        commitments: [],
        confirmedInbound: [
          {
            id: inboundLineId("fractional-inbound"),
            itemId: serializedItem().id,
            unitId: builtinUnits.each.id,
            quantity: fractional,
            dueAt: projectedAt,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "QuantityFractionalNotAllowed" }));
  });

  it("rejects non-canonical identities even when TypeScript brands are bypassed", () => {
    const holding = quantityHolding("valid", location("store"), "1");

    expect(() =>
      projectAvailability(
        baseInput({
          holdings: [
            {
              ...holding,
              holdingId: " noncanonical " as typeof holding.holdingId,
            },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ProjectionInputInvalid" }));
  });

  it("requires one stable kind for a location identity", () => {
    expect(() =>
      projectAvailability(
        baseInput({
          holdings: [
            quantityHolding("h-1", location("same", "Fulfilment"), "1"),
            quantityHolding("h-2", location("same", "Van"), "1"),
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ProjectionInputInvalid" }));
  });

  it("rejects missing, duplicate, incompatible, and overcommitted sources", () => {
    const holding = quantityHolding("h", location("store"), "5");
    const valid = quantityCommitment("c", "h", "2");
    const cases: Array<{
      holdings: readonly StockHolding[];
      commitments: readonly StockCommitment[];
      code: string;
    }> = [
      {
        holdings: [holding],
        commitments: [valid, { ...valid }],
        code: "ProjectionDuplicateIdentity",
      },
      {
        holdings: [holding],
        commitments: [quantityCommitment("missing", "not-there", "1")],
        code: "ProjectionSourceMissing",
      },
      {
        holdings: [holding],
        commitments: [
          serializedCommitment("asset", "h", "asset", {
            itemId: quantityItem().id,
          }),
        ],
        code: "ProjectionInputInvalid",
      },
      {
        holdings: [holding],
        commitments: [quantityCommitment("other", "h", "6")],
        code: "ProjectionOvercommitted",
      },
      {
        holdings: [holding],
        commitments: [
          quantityCommitment("unit", "h", "1", "JobReservation", {
            unitId: builtinUnits.gram.id,
          }),
        ],
        code: "ProjectionUnitMismatch",
      },
      {
        holdings: [holding],
        commitments: [
          quantityCommitment("item", "h", "1", "JobReservation", {
            itemId: catalogueItemId("other"),
          }),
        ],
        code: "ProjectionItemMismatch",
      },
      {
        holdings: [holding],
        commitments: [quantityCommitment("kind", "h", "1", "Unknown" as never)],
        code: "ProjectionInputInvalid",
      },
    ];

    for (const testCase of cases) {
      expect(() =>
        projectAvailability(
          baseInput({
            holdings: testCase.holdings,
            commitments: testCase.commitments,
          }),
        ),
      ).toThrowError(expect.objectContaining({ code: testCase.code }));
    }
  });

  it("rejects commitment quantities that are not positive", () => {
    const holding = quantityHolding("h", location("store"), "5");

    for (const quantity of ["0", "-1"]) {
      expect(() =>
        projectAvailability(
          baseInput({
            holdings: [holding],
            commitments: [quantityCommitment("c", "h", quantity)],
          }),
        ),
      ).toThrowError();
    }
  });

  it("requires a serialized commitment to reference its exact asset", () => {
    expect(() =>
      projectAvailability({
        item: serializedItem(),
        projectedAt,
        holdings: [serializedHolding("h", "asset-1", location("store"))],
        commitments: [serializedCommitment("c", "h", "asset-2")],
      }),
    ).toThrowError(expect.objectContaining({ code: "ProjectionInputInvalid" }));
  });

  it("rejects duplicate inbound identities and invalid dated lines", () => {
    const inbound = {
      id: inboundLineId("in"),
      itemId: quantityItem().id,
      unitId: builtinUnits.millimetre.id,
      quantity: decimal("1"),
      dueAt: projectedAt,
    };
    expect(() =>
      projectAvailability(baseInput({ confirmedInbound: [inbound, { ...inbound }] })),
    ).toThrowError(expect.objectContaining({ code: "ProjectionDuplicateIdentity" }));

    expect(() =>
      projectAvailability(
        baseInput({
          confirmedInbound: [{ ...inbound, itemId: catalogueItemId("other") }],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ProjectionItemMismatch" }));
    expect(() =>
      projectAvailability(
        baseInput({
          confirmedInbound: [{ ...inbound, unitId: builtinUnits.gram.id }],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ProjectionUnitMismatch" }));
    expect(() =>
      projectAvailability(
        baseInput({
          confirmedInbound: [{ ...inbound, quantity: decimal("0") }],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "QuantityZero" }));
    expect(() =>
      projectAvailability(
        baseInput({
          confirmedInbound: [
            {
              ...inbound,
              dueAt: "2026-08-01" as typeof projectedAt,
            },
          ],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ValueInvalid" }));
  });

  it("deduplicates identical demand but rejects conflicting representations", () => {
    const demand = {
      demandIdentity: demandIdentity("linked"),
      itemId: quantityItem().id,
      unitId: builtinUnits.millimetre.id,
      quantity: decimal("1"),
      dueAt: projectedAt,
    };
    expect(() =>
      projectAvailability(
        baseInput({
          uncommittedDemand: [demand, { ...demand, quantity: decimal("2") }],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "ProjectionDuplicateIdentity" }));
    expect(() =>
      projectAvailability(
        baseInput({
          uncommittedDemand: [{ ...demand, quantity: decimal("-1") }],
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "QuantityNegative" }));
  });
});
