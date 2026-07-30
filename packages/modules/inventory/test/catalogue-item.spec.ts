import { describe, expect, it } from "vitest";

import {
  archiveCatalogueItem,
  builtinUnits,
  catalogueItemId,
  catalogueItemName,
  convertPackCountToBaseQuantity,
  createCatalogueItem,
  createPackDefinition,
  createUnitDefinition,
  exactIdentifierAlias,
  exactIdentifierKey,
  exactIdentifierMatches,
  exactIdentifierValue,
  identifierNamespace,
  identifierNamespaces,
  packId,
  packName,
  resolveExactIdentifier,
  unitDimension,
  unitId,
  unitName,
  unitSymbol,
  type CatalogueItemInput,
  type ExactIdentifierAlias,
} from "../src";
import { decimal } from "./fixtures";

const barcode = (value: string): ExactIdentifierAlias =>
  exactIdentifierAlias(identifierNamespaces.barcode, exactIdentifierValue(value));

const baseItemInput = (): CatalogueItemInput => ({
  id: catalogueItemId("item-1"),
  name: catalogueItemName("Cable"),
  trackingMode: "QuantityBased" as const,
  handlingPolicy: "PartiallyConsumable" as const,
  baseUnit: builtinUnits.millimetre,
  accessClass: "Standard" as const,
});

describe("catalogue value objects and exact identifiers", () => {
  it("normalises display names but preserves exact identifier values", () => {
    expect(catalogueItemName("  Cable  ")).toBe("Cable");
    expect(packName("  Reel  ")).toBe("Reel");
    expect(exactIdentifierValue("ABC 123")).toBe("ABC 123");
    expect(packId("reel-1")).toBe("reel-1");
  });

  it.each([
    ["catalogue name", () => catalogueItemName(" ")],
    ["catalogue name control", () => catalogueItemName("bad\u0000")],
    ["catalogue name length", () => catalogueItemName("a".repeat(201))],
    ["identifier blank", () => exactIdentifierValue("")],
    ["identifier surrounding whitespace", () => exactIdentifierValue(" abc")],
    ["identifier length", () => exactIdentifierValue("a".repeat(257))],
    ["pack id whitespace", () => packId(" pack")],
    ["pack name control", () => packName("bad\u007f")],
  ])("rejects invalid %s", (_label, operation) => {
    expect(operation).toThrowError();
  });

  it.each(["", "UPPER", "1start", "space value", "a".repeat(65)])(
    "rejects invalid identifier namespace %s",
    (value) => {
      expect(() => identifierNamespace(value)).toThrowError(
        expect.objectContaining({ code: "ValueInvalid" }),
      );
    },
  );

  it("matches only exact namespace and value pairs", () => {
    const left = barcode("ABC");
    const same = barcode("ABC");
    const differentCase = barcode("abc");
    const differentNamespace = exactIdentifierAlias(
      identifierNamespaces.supplierItemCode,
      exactIdentifierValue("ABC"),
    );

    expect(exactIdentifierMatches(left, same)).toBe(true);
    expect(exactIdentifierMatches(left, differentCase)).toBe(false);
    expect(exactIdentifierMatches(left, differentNamespace)).toBe(false);
    expect(exactIdentifierKey(left)).not.toBe(
      exactIdentifierKey(
        exactIdentifierAlias(identifierNamespace("bar"), exactIdentifierValue("codeABC")),
      ),
    );
    expect(Object.isFrozen(left)).toBe(true);
  });
});

describe("pack definitions", () => {
  it("converts pack counts exactly to the catalogue base unit", () => {
    const pack = createPackDefinition(
      {
        id: packId("reel"),
        name: packName("Reel"),
        containedBaseQuantity: decimal("2500"),
        identifiers: [barcode("REEL-2500")],
      },
      builtinUnits.millimetre,
    );

    expect(
      convertPackCountToBaseQuantity(decimal("3"), pack, builtinUnits.millimetre).toString(),
    ).toBe("7500");
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.identifiers)).toBe(true);
  });

  it("supports explicitly fractional packs where the base unit permits them", () => {
    const pack = createPackDefinition(
      {
        id: packId("drum"),
        name: packName("Drum"),
        containedBaseQuantity: decimal("25.5"),
        fractionalPackCountAllowed: true,
      },
      builtinUnits.millilitre,
    );

    expect(
      convertPackCountToBaseQuantity(decimal("0.5"), pack, builtinUnits.millilitre).toString(),
    ).toBe("12.75");
  });

  it("rejects non-positive, fractional-forbidden, and indivisible results", () => {
    const wholePack = createPackDefinition(
      {
        id: packId("box"),
        name: packName("Box"),
        containedBaseQuantity: decimal("10"),
      },
      builtinUnits.each,
    );

    expect(() =>
      convertPackCountToBaseQuantity(decimal("0.5"), wholePack, builtinUnits.each),
    ).toThrowError(expect.objectContaining({ code: "QuantityFractionalNotAllowed" }));
    expect(() =>
      createPackDefinition(
        {
          id: packId("zero"),
          name: packName("Zero"),
          containedBaseQuantity: decimal("0"),
        },
        builtinUnits.gram,
      ),
    ).toThrowError(expect.objectContaining({ code: "QuantityZero" }));
    expect(() =>
      createPackDefinition(
        {
          id: packId("half"),
          name: packName("Half"),
          containedBaseQuantity: decimal("0.5"),
        },
        builtinUnits.each,
      ),
    ).toThrowError(expect.objectContaining({ code: "QuantityFractionalNotAllowed" }));
  });

  it("requires an actual base unit and canonical boolean configuration", () => {
    expect(() =>
      createPackDefinition(
        {
          id: packId("bag"),
          name: packName("Bag"),
          containedBaseQuantity: decimal("1"),
        },
        builtinUnits.kilogram,
      ),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));

    expect(() =>
      createPackDefinition(
        {
          id: packId("bag"),
          name: packName("Bag"),
          containedBaseQuantity: decimal("1"),
          fractionalPackCountAllowed: "yes" as unknown as boolean,
        },
        builtinUnits.gram,
      ),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
  });

  it("rejects duplicate identifiers within a pack", () => {
    expect(() =>
      createPackDefinition(
        {
          id: packId("bag"),
          name: packName("Bag"),
          containedBaseQuantity: decimal("100"),
          identifiers: [barcode("BAG"), barcode("BAG")],
        },
        builtinUnits.gram,
      ),
    ).toThrowError(expect.objectContaining({ code: "DuplicateIdentifier" }));
  });
});

describe("catalogue invariants and resolution", () => {
  it("creates an immutable item with independent handling and tracking policy", () => {
    const item = createCatalogueItem({
      ...baseItemInput(),
      handlingPolicy: "Consumable",
      consumeOnIssue: true,
      identifiers: [barcode("ITEM")],
      reorderSettings: {
        lowStockThreshold: decimal("100"),
        targetStockLevel: decimal("500"),
      },
      packs: [
        {
          id: packId("reel"),
          name: packName("Reel"),
          containedBaseQuantity: decimal("1000"),
          identifiers: [barcode("PACK")],
        },
      ],
    });

    expect(item.consumeOnIssue).toBe(true);
    expect(item.status).toBe("Active");
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.baseUnit)).toBe(true);
    expect(Object.isFrozen(item.packs)).toBe(true);
    expect(Object.isFrozen(item.reorderSettings)).toBe(true);
    expect(resolveExactIdentifier(item, barcode("ITEM"))).toEqual({
      kind: "Item",
      itemId: item.id,
    });
    expect(resolveExactIdentifier(item, barcode("PACK"))).toEqual({
      kind: "Pack",
      itemId: item.id,
      packId: packId("reel"),
    });
    expect(resolveExactIdentifier(item, barcode("pack"))).toBeUndefined();
  });

  it("archives without changing stable identity and is idempotent", () => {
    const item = createCatalogueItem(baseItemInput());
    const archived = archiveCatalogueItem(item);

    expect(archived).not.toBe(item);
    expect(archived.id).toBe(item.id);
    expect(archived.name).toBe(item.name);
    expect(archived.status).toBe("Archived");
    expect(archiveCatalogueItem(archived)).toBe(archived);
    expect(Object.isFrozen(archived)).toBe(true);
  });

  it("requires returnable stock to be serialized and serialized stock to be indivisible", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        handlingPolicy: "Returnable",
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));

    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        trackingMode: "Serialized",
        handlingPolicy: "Returnable",
        baseUnit: builtinUnits.gram,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
  });

  it("requires catalogue storage units to be true base units", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        baseUnit: builtinUnits.metre,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));

    const invalidCountBase = createUnitDefinition({
      id: unitId("piece"),
      name: unitName("piece"),
      symbol: unitSymbol("pc"),
      dimension: unitDimension("Count"),
      baseUnitId: unitId("piece"),
      baseUnitsPerUnit: decimal("1"),
      wholeNumbersOnly: false,
    });
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        trackingMode: "Serialized",
        handlingPolicy: "Returnable",
        baseUnit: invalidCountBase,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
  });

  it("allows consume-on-issue only for consumables", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        consumeOnIssue: true,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
  });

  it("validates reorder settings in the base unit", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        reorderSettings: {
          lowStockThreshold: decimal("10"),
          targetStockLevel: decimal("9"),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        reorderSettings: {
          lowStockThreshold: decimal("-1"),
          targetStockLevel: decimal("10"),
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "QuantityNegative" }));
  });

  it("rejects duplicate item, pack, and cross-scope identifier identities", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        identifiers: [barcode("SAME"), barcode("SAME")],
      }),
    ).toThrowError(expect.objectContaining({ code: "DuplicateIdentifier" }));
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        packs: [
          {
            id: packId("box"),
            name: packName("Box"),
            containedBaseQuantity: decimal("10"),
          },
          {
            id: packId("box"),
            name: packName("Box again"),
            containedBaseQuantity: decimal("20"),
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "DuplicatePack" }));
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        identifiers: [barcode("SAME")],
        packs: [
          {
            id: packId("box"),
            name: packName("Box"),
            containedBaseQuantity: decimal("10"),
            identifiers: [barcode("SAME")],
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "DuplicateIdentifier" }));
  });

  it("rejects unsupported runtime enum and boolean values", () => {
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        trackingMode: "Lots" as never,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        status: "Deleted" as never,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
    expect(() =>
      createCatalogueItem({
        ...baseItemInput(),
        consumeOnIssue: "yes" as unknown as boolean,
      }),
    ).toThrowError(expect.objectContaining({ code: "CatalogueInvariantViolation" }));
  });
});
