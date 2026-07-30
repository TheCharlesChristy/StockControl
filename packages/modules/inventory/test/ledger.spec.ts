import { describe, expect, it, vi } from "vitest";

import {
  actorId,
  builtinUnits,
  createIdempotencyRecord,
  createLedgerActor,
  createLedgerEntry,
  idempotencyKey,
  idempotencyScope,
  ledgerEntryId,
  ledgerRelationReference,
  ledgerSequence,
  locationId,
  outcomeReference,
  rebuildProjection,
  requestFingerprint,
  resolveIdempotency,
  serializedAssetId,
  type IdempotencyAttemptInput,
  type IdempotencyRecordInput,
  type LedgerEntry,
  type LedgerEntryInput,
  type QuantityLedgerEntryInput,
  type SerializedLedgerEntryInput,
} from "../src";
import {
  decimal,
  ledgerActor,
  quantityEntryInput,
  quantityState,
  serializedEntryInput,
  serializedState,
} from "./fixtures";

const fingerprint = (character: string): ReturnType<typeof requestFingerprint> =>
  requestFingerprint(`sha256:${character.repeat(64)}`);

const attempt = (overrides: Partial<IdempotencyAttemptInput> = {}): IdempotencyAttemptInput => ({
  scope: idempotencyScope("stock-command"),
  key: idempotencyKey("request-1"),
  fingerprint: fingerprint("a"),
  actorId: actorId("actor-1"),
  ...overrides,
});

const record = (overrides: Partial<IdempotencyRecordInput> = {}): IdempotencyRecordInput => ({
  ...attempt(),
  outcomeReference: outcomeReference("transaction-1"),
  ...overrides,
});

describe("immutable ledger entries", () => {
  it("creates a deeply immutable exact quantity entry", () => {
    const entry = createLedgerEntry({
      ...quantityEntryInput(),
      action: "AdjustmentDecrease",
      correctionOfEntryId: ledgerEntryId("entry-original"),
      relations: [
        {
          kind: "Job",
          reference: ledgerRelationReference("job-1"),
        },
        {
          kind: "User",
          reference: ledgerRelationReference("user-1"),
        },
      ],
    });

    expect(entry.stockKind).toBe("Quantity");
    if (entry.stockKind !== "Quantity") {
      throw new Error("Expected a quantity ledger entry.");
    }
    expect(entry.quantity.toString()).toBe("5");
    expect(entry.correctionOfEntryId).toBe(ledgerEntryId("entry-original"));
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.actor)).toBe(true);
    expect(Object.isFrozen(entry.relations)).toBe(true);
    expect(Object.isFrozen(entry.relations[0])).toBe(true);
    expect(Object.isFrozen(entry.stateChanges)).toBe(true);
    expect(Object.isFrozen(entry.stateChanges[0])).toBe(true);
    expect(Object.isFrozen(entry.stateChanges[0]?.prior)).toBe(true);
  });

  it("creates a serialized entry without introducing a quantity payload", () => {
    const stateAtMissingLocation = serializedState({
      lifecycle: "Missing",
    });
    const missingState = {
      kind: stateAtMissingLocation.kind,
      holdingId: stateAtMissingLocation.holdingId,
      assetId: stateAtMissingLocation.assetId,
      condition: stateAtMissingLocation.condition,
      lifecycle: stateAtMissingLocation.lifecycle,
    };
    const input = serializedEntryInput({
      stateChanges: [
        {
          prior: serializedState(),
          resulting: missingState,
        },
      ],
    });
    const entry = createLedgerEntry(input);

    expect(entry).toEqual(
      expect.objectContaining({
        stockKind: "Serialized",
        assetId: serializedAssetId("asset-1"),
      }),
    );
    expect("quantity" in entry).toBe(false);
    expect(entry.stateChanges[0]?.resulting).not.toHaveProperty("locationId");
  });

  it("requires canonical action, stock kind, and a meaningful location edge", () => {
    const cases: LedgerEntryInput[] = [
      {
        ...quantityEntryInput(),
        action: "Invent" as never,
      },
      {
        ...quantityEntryInput(),
        stockKind: "Lot" as never,
      },
      {
        ...quantityEntryInput(),
        sourceLocationId: undefined,
        destinationLocationId: undefined,
      } as unknown as QuantityLedgerEntryInput,
      {
        ...quantityEntryInput(),
        sourceLocationId: locationId("same"),
        destinationLocationId: locationId("same"),
      },
    ];

    for (const input of cases) {
      expect(() => createLedgerEntry(input)).toThrowError(
        expect.objectContaining({ code: "LedgerInvariantViolation" }),
      );
    }
  });

  it("allows backdating but rejects a future effective time", () => {
    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        effectiveAt: "2026-07-29T12:00:00.001Z" as QuantityLedgerEntryInput["effectiveAt"],
      }),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        recordedAt: "2026-07-29T12:00:00Z" as QuantityLedgerEntryInput["recordedAt"],
      }),
    ).toThrowError(expect.objectContaining({ code: "ValueInvalid" }));
  });

  it("enforces explicit non-self reversal and correction links", () => {
    expect(
      createLedgerEntry({
        ...quantityEntryInput(),
        action: "Reversal",
        reversalOfEntryId: ledgerEntryId("entry-original"),
      }).reversalOfEntryId,
    ).toBe(ledgerEntryId("entry-original"));

    const invalid: LedgerEntryInput[] = [
      {
        ...quantityEntryInput(),
        action: "Reversal",
      },
      {
        ...quantityEntryInput(),
        action: "Transfer",
        reversalOfEntryId: ledgerEntryId("entry-original"),
      },
      {
        ...quantityEntryInput(),
        action: "Reversal",
        reversalOfEntryId: ledgerEntryId("entry-original"),
        correctionOfEntryId: ledgerEntryId("entry-correction"),
      },
      {
        ...quantityEntryInput(),
        action: "Reversal",
        reversalOfEntryId: quantityEntryInput().entryId,
      },
      {
        ...quantityEntryInput(),
        correctionOfEntryId: quantityEntryInput().entryId,
      },
    ];

    for (const input of invalid) {
      expect(() => createLedgerEntry(input)).toThrowError(
        expect.objectContaining({ code: "LedgerInvariantViolation" }),
      );
    }
  });

  it("requires nonempty, kind-compatible, exact state changes", () => {
    expect(
      createLedgerEntry({
        ...quantityEntryInput(),
        stateChanges: [{ resulting: quantityState("5") }],
      }).stateChanges[0],
    ).toEqual({ resulting: quantityState("5") });

    const sourceOnly = createLedgerEntry({
      ...quantityEntryInput(),
      relations: undefined,
      destinationLocationId: undefined,
      stateChanges: [{ prior: quantityState("5") }],
    } as unknown as QuantityLedgerEntryInput);
    expect(sourceOnly).not.toHaveProperty("destinationLocationId");
    expect(sourceOnly.relations).toEqual([]);
    expect(sourceOnly.stateChanges[0]).toEqual({
      prior: quantityState("5"),
    });

    const destinationOnly = createLedgerEntry({
      ...quantityEntryInput(),
      sourceLocationId: undefined,
    } as unknown as QuantityLedgerEntryInput);
    expect(destinationOnly).not.toHaveProperty("sourceLocationId");

    const invalid: LedgerEntryInput[] = [
      {
        ...quantityEntryInput(),
        stateChanges: [],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [{}],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [{ prior: serializedState() }],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [
          {
            prior: quantityState("1", {
              unitId: builtinUnits.gram.id,
            }),
          },
        ],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [
          {
            prior: quantityState("-1"),
          },
        ],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [
          {
            prior: quantityState("1", {
              condition: "Fresh" as never,
            }),
          },
        ],
      },
      {
        ...quantityEntryInput(),
        stateChanges: [
          {
            prior: quantityState("1", {
              lifecycle: "Stored" as never,
            }),
          },
        ],
      },
    ];

    for (const input of invalid) {
      expect(() => createLedgerEntry(input)).toThrowError();
    }
  });

  it("requires serialized state snapshots to reference the entry asset and canonical state", () => {
    const invalid: SerializedLedgerEntryInput[] = [
      serializedEntryInput({
        stateChanges: [
          {
            prior: serializedState({
              assetId: serializedAssetId("different"),
            }),
          },
        ],
      }),
      serializedEntryInput({
        stateChanges: [
          {
            prior: serializedState({
              condition: "Fresh" as never,
            }),
          },
        ],
      }),
      serializedEntryInput({
        stateChanges: [
          {
            prior: serializedState({
              lifecycle: "Stored" as never,
            }),
          },
        ],
      }),
    ];

    for (const input of invalid) {
      expect(() => createLedgerEntry(input)).toThrowError(
        expect.objectContaining({ code: "LedgerInvariantViolation" }),
      );
    }
  });

  it("rejects duplicate or invalid relations", () => {
    const relation = {
      kind: "Job" as const,
      reference: ledgerRelationReference("job-1"),
    };
    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        relations: [relation, relation],
      }),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        relations: [{ ...relation, kind: "Invoice" as never }],
      }),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
    expect(() => ledgerRelationReference("bad\u0000reference")).toThrowError(
      expect.objectContaining({ code: "ValueInvalid" }),
    );
    expect(() => ledgerRelationReference(" ")).toThrowError(
      expect.objectContaining({ code: "ValueInvalid" }),
    );
    expect(() => ledgerRelationReference("a".repeat(129))).toThrowError(
      expect.objectContaining({ code: "ValueInvalid" }),
    );
  });

  it("requires an exclusive positive quantity-or-asset payload", () => {
    for (const quantity of ["0", "-1"]) {
      expect(() =>
        createLedgerEntry(quantityEntryInput({ quantity: decimal(quantity) })),
      ).toThrowError();
    }

    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        assetId: serializedAssetId("asset"),
      } as unknown as QuantityLedgerEntryInput),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
    expect(() =>
      createLedgerEntry({
        ...serializedEntryInput(),
        quantity: decimal("1"),
      } as unknown as SerializedLedgerEntryInput),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
    expect(() =>
      createLedgerEntry({
        ...serializedEntryInput(),
        unitId: builtinUnits.each.id,
      } as unknown as SerializedLedgerEntryInput),
    ).toThrowError(expect.objectContaining({ code: "LedgerInvariantViolation" }));
  });

  it("revalidates actor and other branded inputs at the immutable boundary", () => {
    expect(
      createLedgerActor({
        ...ledgerActor(),
        id: "  actor-2  " as ReturnType<typeof actorId>,
      }),
    ).toEqual({
      id: actorId("actor-2"),
      effectivePermission: ledgerActor().effectivePermission,
    });

    expect(() =>
      createLedgerEntry({
        ...quantityEntryInput(),
        reason: " " as QuantityLedgerEntryInput["reason"],
      }),
    ).toThrowError(expect.objectContaining({ code: "ValueRequired" }));
  });
});

describe("idempotent stock commands", () => {
  it("executes a new key and freezes the validated attempt", () => {
    const decision = resolveIdempotency(attempt());

    expect(decision.kind).toBe("Execute");
    if (decision.kind === "Execute") {
      expect(decision.attempt).toEqual(attempt());
      expect(Object.isFrozen(decision.attempt)).toBe(true);
    }
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("replays the prior outcome only for the same actor and fingerprint", () => {
    const decision = resolveIdempotency(attempt(), record());

    expect(decision).toEqual({
      kind: "Replay",
      outcomeReference: outcomeReference("transaction-1"),
    });
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("rejects an adapter record for a different lookup scope or key", () => {
    expect(() =>
      resolveIdempotency(attempt(), record({ scope: idempotencyScope("other") })),
    ).toThrowError(expect.objectContaining({ code: "IdempotencyInputInvalid" }));
    expect(() =>
      resolveIdempotency(attempt(), record({ key: idempotencyKey("other") })),
    ).toThrowError(expect.objectContaining({ code: "IdempotencyInputInvalid" }));
  });

  it("rejects scoped key reuse by a different request or actor", () => {
    expect(() =>
      resolveIdempotency(attempt(), record({ fingerprint: fingerprint("b") })),
    ).toThrowError(expect.objectContaining({ code: "IdempotencyConflict" }));
    expect(() =>
      resolveIdempotency(attempt(), record({ actorId: actorId("actor-2") })),
    ).toThrowError(expect.objectContaining({ code: "IdempotencyConflict" }));
  });

  it("creates immutable records and validates every opaque value", () => {
    const created = createIdempotencyRecord(record());
    expect(Object.isFrozen(created)).toBe(true);
    expect(() =>
      createIdempotencyRecord({
        ...record(),
        fingerprint: "invalid" as ReturnType<typeof requestFingerprint>,
      }),
    ).toThrowError(expect.objectContaining({ code: "ValueInvalid" }));
  });
});

describe("deterministic projection rebuild", () => {
  const entry = (sequence: string): LedgerEntry =>
    createLedgerEntry(
      quantityEntryInput({
        entryId: ledgerEntryId(`entry-${sequence}`),
        sequence: ledgerSequence(sequence),
      }),
    );

  it("applies strictly ordered entries and exposes frozen rebuild metadata", () => {
    const applyEntry = vi.fn((state: readonly string[], ledgerEntry: LedgerEntry) => [
      ...state,
      ledgerEntry.sequence,
    ]);
    const finalize = vi.fn(
      (
        state: readonly string[],
        context: {
          readonly entriesApplied: number;
          readonly firstSequence?: ReturnType<typeof ledgerSequence>;
          readonly lastSequence?: ReturnType<typeof ledgerSequence>;
        },
      ) => ({ state, context }),
    );

    const result = rebuildProjection([entry("1"), entry("3")], {
      createInitialState: () => [] as readonly string[],
      applyEntry,
      finalize,
    });

    expect(result.state).toEqual(["1", "3"]);
    expect(result.context).toEqual({
      entriesApplied: 2,
      firstSequence: ledgerSequence("1"),
      lastSequence: ledgerSequence("3"),
    });
    expect(Object.isFrozen(result.context)).toBe(true);
    expect(applyEntry).toHaveBeenCalledTimes(2);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("supports an empty deterministic rebuild", () => {
    const result = rebuildProjection([], {
      createInitialState: () => 10,
      applyEntry: (state) => state + 1,
      finalize: (state, context) => ({ state, context }),
    });

    expect(result).toEqual({
      state: 10,
      context: { entriesApplied: 0 },
    });
  });

  it("rejects duplicate, descending, and malformed sequences before applying them", () => {
    for (const entries of [
      [entry("1"), entry("1")],
      [entry("2"), entry("1")],
    ]) {
      expect(() =>
        rebuildProjection(entries, {
          createInitialState: () => 0,
          applyEntry: (state) => state + 1,
          finalize: (state) => state,
        }),
      ).toThrowError(expect.objectContaining({ code: "LedgerSequenceOutOfOrder" }));
    }

    expect(() =>
      rebuildProjection([{ ...entry("1"), sequence: "01" as never }], {
        createInitialState: () => 0,
        applyEntry: (state) => state + 1,
        finalize: (state) => state,
      }),
    ).toThrowError(expect.objectContaining({ code: "LedgerSequenceInvalid" }));
  });
});
