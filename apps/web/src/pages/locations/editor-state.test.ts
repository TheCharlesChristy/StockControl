import type { MapLocationView } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import {
  editorReducer,
  initialEditor,
  sortedByZOrder,
  toInputs,
  withDerivedNesting,
  type EditorState,
} from "./editor-state";
import { testAisleId, testAreaId, testMap } from "../../test/fake-api";

const loaded: EditorState = editorReducer(initialEditor, { type: "load", map: testMap });

const locationsOf = (state: EditorState): readonly MapLocationView[] =>
  state.draft?.locations ?? [];
const locationIn = (state: EditorState, id: string): MapLocationView | undefined =>
  locationsOf(state).find((location) => location.id === id);

/* A rectangle that swallows the seeded Aisle A shape whole. */
const surrounding = { kind: "Rectangle", x: 0, y: 0, width: 0.9, height: 0.5 } as const;

describe("load and revert", () => {
  it("starts clean with both copies pointing at the loaded map", () => {
    expect(loaded.draft).toBe(testMap);
    expect(loaded.persisted).toBe(testMap);
    expect(loaded.dirty).toBe(false);
    expect(loaded.selectedLocationId).toBeNull();
  });

  it("throws away edits and the selection on revert", () => {
    const edited = editorReducer(loaded, {
      type: "patch-location",
      id: testAreaId,
      changes: { name: "Renamed" },
    });
    const reverted = editorReducer(edited, { type: "revert" });

    expect(edited.dirty).toBe(true);
    expect(reverted.draft).toBe(testMap);
    expect(reverted.dirty).toBe(false);
  });

  it("keeps identity when a no-op action arrives, so memoised children can bail", () => {
    expect(editorReducer(loaded, { type: "select", id: null })).toBe(loaded);
    expect(editorReducer(loaded, { type: "mode", mode: "select" })).toBe(loaded);
  });
});

describe("add-location", () => {
  const geometry = { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.05, height: 0.05 } as const;

  it("selects the new location and returns to the select tool", () => {
    const added = editorReducer(loaded, { type: "add-location", geometry });

    expect(locationsOf(added)).toHaveLength(3);
    expect(added.mode).toBe("select");
    expect(added.selectedLocationId).toBe(locationsOf(added)[2]?.id);
    expect(added.dirty).toBe(true);
  });

  it("puts each new location on top with a safe integer z-order", () => {
    const added = editorReducer(loaded, { type: "add-location", geometry });
    const zOrder = locationsOf(added)[2]?.zOrder ?? 0;

    expect(zOrder).toBe(3);
    expect(Number.isSafeInteger(zOrder)).toBe(true);
  });

  it("gives locations created in the same millisecond distinct identities", () => {
    /*
     * The old editor keyed drafts on Date.now(), so two shapes drawn quickly
     * collided and silently merged on save.
     */
    const first = editorReducer(loaded, { type: "add-location", geometry });
    const second = editorReducer(first, { type: "add-location", geometry });
    const ids = locationsOf(second).map((location) => location.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("nests a shape drawn inside another one, with no parent supplied", () => {
    const inside = { kind: "Rectangle", x: 0.15, y: 0.15, width: 0.05, height: 0.05 } as const;
    const added = editorReducer(loaded, { type: "add-location", geometry: inside });
    const drawn = locationsOf(added)[2]!;

    expect(drawn.derivedParentId).toBe(testAreaId);
    expect(drawn.depth).toBe(1);
    expect(drawn.path).toBe("Aisle A › New location");
  });
});

describe("commit-geometry", () => {
  it("replaces only the geometry of the location that moved", () => {
    const geometry = { kind: "Rectangle", x: 0.4, y: 0.4, width: 0.1, height: 0.1 } as const;
    const moved = editorReducer(loaded, {
      type: "commit-geometry",
      id: testAreaId,
      geometry,
    });

    expect(locationIn(moved, testAreaId)?.geometry).toBe(geometry);
    expect(locationIn(moved, testAisleId)?.geometry).toBe(
      locationIn(loaded, testAisleId)?.geometry,
    );
    expect(moved.dirty).toBe(true);
  });

  it("re-derives nesting the moment a shape is dragged inside another", () => {
    /* Grow Aisle A until it contains Aisle B, without touching any parent field. */
    const grown = editorReducer(loaded, {
      type: "commit-geometry",
      id: testAreaId,
      geometry: { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.49, height: 0.49 },
    });

    expect(locationIn(grown, testAisleId)?.derivedParentId).toBe(testAreaId);
    expect(locationIn(grown, testAisleId)?.path).toBe("Aisle A › Aisle B");
  });

  it("un-nests again when the shape is dragged back out", () => {
    const grown = editorReducer(loaded, {
      type: "commit-geometry",
      id: testAreaId,
      geometry: { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.49, height: 0.49 },
    });
    const shrunk = editorReducer(grown, {
      type: "commit-geometry",
      id: testAreaId,
      geometry: { kind: "Rectangle", x: 0.1, y: 0.1, width: 0.3, height: 0.2 },
    });

    expect(locationIn(shrunk, testAisleId)?.derivedParentId).toBeNull();
    expect(locationIn(shrunk, testAisleId)?.path).toBe("Aisle B");
  });
});

describe("archiving", () => {
  it("takes an archived shape out of containment without orphaning its contents", () => {
    const nested = editorReducer(loaded, { type: "add-location", geometry: surrounding });
    const containerId = locationsOf(nested)[2]!.id;
    expect(locationIn(nested, testAreaId)?.derivedParentId).toBe(containerId);

    const archived = editorReducer(nested, {
      type: "patch-location",
      id: containerId,
      changes: { status: "Archived" },
    });

    expect(locationIn(archived, testAreaId)?.status).toBe("Active");
    expect(locationIn(archived, testAreaId)?.derivedParentId).toBeNull();
  });
});

describe("remove-location", () => {
  it("re-parents what was inside a shape that is erased", () => {
    const nested = editorReducer(loaded, { type: "add-location", geometry: surrounding });
    const containerId = locationsOf(nested)[2]!.id;
    const removed = editorReducer(nested, { type: "remove-location", id: containerId });

    expect(locationsOf(removed)).toHaveLength(2);
    expect(locationIn(removed, testAreaId)?.derivedParentId).toBeNull();
    expect(locationIn(removed, testAreaId)?.path).toBe("Aisle A");
  });

  it("drops the selection when the selected location goes", () => {
    const selected = editorReducer(loaded, { type: "select", id: testAreaId });
    const removed = editorReducer(selected, { type: "remove-location", id: testAreaId });

    expect(removed.selectedLocationId).toBeNull();
  });
});

describe("reorder-location", () => {
  it("raises above every other shape and lowers below them", () => {
    const raised = editorReducer(loaded, {
      type: "reorder-location",
      id: testAreaId,
      direction: "raise",
    });
    const lowered = editorReducer(loaded, {
      type: "reorder-location",
      id: testAisleId,
      direction: "lower",
    });

    expect(sortedByZOrder(locationsOf(raised)).at(-1)?.id).toBe(testAreaId);
    expect(sortedByZOrder(locationsOf(lowered))[0]?.id).toBe(testAisleId);
  });

  it("keeps z-order a safe integer, which the domain requires", () => {
    const raised = editorReducer(loaded, {
      type: "reorder-location",
      id: testAreaId,
      direction: "raise",
    });

    for (const location of locationsOf(raised))
      expect(Number.isSafeInteger(location.zOrder)).toBe(true);
  });
});

describe("withDerivedNesting", () => {
  it("is what the map is read through, so nesting is never stored in the draft", () => {
    const nested = withDerivedNesting([
      { ...testMap.locations[0]!, geometry: surrounding },
      testMap.locations[1]!,
    ]);

    expect(nested.map((location) => location.path)).toEqual(["Aisle A", "Aisle B"]);
  });
});

describe("toInputs", () => {
  it("sends every location with its identity so it survives the save", () => {
    const geometry = { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.05, height: 0.05 } as const;
    const added = editorReducer(loaded, { type: "add-location", geometry });
    const drawnId = locationsOf(added)[2]?.id ?? "";

    expect(toInputs(added.draft!).map((input) => input.id)).toEqual([
      testAreaId,
      testAisleId,
      drawnId,
    ]);
  });

  it("carries every field the save contract needs, and no derived one", () => {
    expect(toInputs(testMap)[0]).toEqual({
      id: testAreaId,
      code: "MAIN-A",
      name: "Aisle A",
      geometry: testMap.locations[0]!.geometry,
      zOrder: 1,
      searchAliases: ["bay row"],
      status: "Active",
    });
  });
});
