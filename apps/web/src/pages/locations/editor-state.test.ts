import type { MapRegionView, MapSnapshot } from "@stockcontrol/contracts";
import { describe, expect, it } from "vitest";

import {
  editorReducer,
  flattenHierarchy,
  initialEditor,
  sortedByZOrder,
  toInputs,
  type EditorState,
} from "./editor-state";
import {
  testBranch,
  testMapSnapshot,
  testPolygonRegionId,
  testRectangleRegionId,
} from "../../test/fake-api";

const loaded: EditorState = editorReducer(initialEditor, {
  type: "load",
  map: testMapSnapshot,
});

const regionsOf = (state: EditorState): readonly MapRegionView[] => state.draft?.regions ?? [];
const regionIn = (state: EditorState, id: string): MapRegionView | undefined =>
  regionsOf(state).find((region) => region.id === id);

describe("load and revert", () => {
  it("starts clean with both copies pointing at the loaded map", () => {
    expect(loaded.draft).toBe(testMapSnapshot);
    expect(loaded.persisted).toBe(testMapSnapshot);
    expect(loaded.dirty).toBe(false);
    expect(loaded.selectedRegionId).toBeNull();
  });

  it("throws away edits and the selection on revert", () => {
    const edited = editorReducer(loaded, {
      type: "patch-region",
      id: testRectangleRegionId,
      changes: { displayName: "Renamed" },
    });
    const reverted = editorReducer(edited, { type: "revert" });

    expect(edited.dirty).toBe(true);
    expect(reverted.draft).toBe(testMapSnapshot);
    expect(reverted.dirty).toBe(false);
  });

  it("keeps identity when a no-op action arrives, so memoised children can bail", () => {
    expect(editorReducer(loaded, { type: "select", id: null })).toBe(loaded);
    expect(editorReducer(loaded, { type: "mode", mode: "select" })).toBe(loaded);
  });
});

describe("add-region", () => {
  const geometry = { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.2, height: 0.2 } as const;

  it("selects the new region and returns to the select tool", () => {
    const added = editorReducer(loaded, { type: "add-region", geometry });

    expect(regionsOf(added)).toHaveLength(3);
    expect(added.mode).toBe("select");
    expect(added.selectedRegionId).toBe(regionsOf(added)[2]?.id);
    expect(added.dirty).toBe(true);
  });

  it("puts each new region on top with a safe integer z-order", () => {
    const added = editorReducer(loaded, { type: "add-region", geometry });
    const zOrder = regionsOf(added)[2]?.zOrder ?? 0;

    expect(zOrder).toBe(3);
    expect(Number.isSafeInteger(zOrder)).toBe(true);
  });

  it("gives regions created in the same millisecond distinct identities", () => {
    /*
     * The old editor keyed drafts on Date.now(), so two shapes drawn quickly
     * collided and silently merged on save.
     */
    const first = editorReducer(loaded, { type: "add-region", geometry });
    const second = editorReducer(first, { type: "add-region", geometry });
    const ids = regionsOf(second).map((region) => region.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("commit-geometry", () => {
  it("replaces only the geometry of the region that moved", () => {
    const geometry = { kind: "Rectangle", x: 0.4, y: 0.4, width: 0.1, height: 0.1 } as const;
    const moved = editorReducer(loaded, {
      type: "commit-geometry",
      id: testRectangleRegionId,
      geometry,
    });

    expect(regionIn(moved, testRectangleRegionId)?.geometry).toBe(geometry);
    expect(regionIn(moved, testPolygonRegionId)).toBe(regionIn(loaded, testPolygonRegionId));
    expect(moved.dirty).toBe(true);
  });
});

describe("archiving", () => {
  const nested: MapSnapshot = {
    ...testMapSnapshot,
    regions: [
      testMapSnapshot.regions[0]!,
      { ...testMapSnapshot.regions[1]!, parentRegionId: testRectangleRegionId },
    ],
  };
  const withNesting = editorReducer(initialEditor, { type: "load", map: nested });

  it("archives descendants too, because the server refuses an active child", () => {
    const archived = editorReducer(withNesting, {
      type: "patch-region",
      id: testRectangleRegionId,
      changes: { status: "Archived" },
    });

    expect(regionIn(archived, testPolygonRegionId)?.status).toBe("Archived");
  });

  it("detaches a restored region from a parent that is still archived", () => {
    const archived = editorReducer(withNesting, {
      type: "patch-region",
      id: testRectangleRegionId,
      changes: { status: "Archived" },
    });
    const restored = editorReducer(archived, {
      type: "patch-region",
      id: testPolygonRegionId,
      changes: { status: "Active" },
    });

    expect(regionIn(restored, testPolygonRegionId)?.status).toBe("Active");
    expect(regionIn(restored, testPolygonRegionId)?.parentRegionId).toBeNull();
  });
});

describe("remove-region", () => {
  it("clears the link on children so the save is not rejected as an orphan", () => {
    const nested: MapSnapshot = {
      ...testMapSnapshot,
      regions: [
        testMapSnapshot.regions[0]!,
        { ...testMapSnapshot.regions[1]!, parentRegionId: testRectangleRegionId },
      ],
    };
    const removed = editorReducer(editorReducer(initialEditor, { type: "load", map: nested }), {
      type: "remove-region",
      id: testRectangleRegionId,
    });

    expect(regionsOf(removed)).toHaveLength(1);
    expect(regionIn(removed, testPolygonRegionId)?.parentRegionId).toBeNull();
  });

  it("drops the selection when the selected region goes", () => {
    const selected = editorReducer(loaded, { type: "select", id: testRectangleRegionId });
    const removed = editorReducer(selected, { type: "remove-region", id: testRectangleRegionId });

    expect(removed.selectedRegionId).toBeNull();
  });
});

describe("reorder-region", () => {
  it("raises above every other region and lowers below them", () => {
    const raised = editorReducer(loaded, {
      type: "reorder-region",
      id: testRectangleRegionId,
      direction: "raise",
    });
    const lowered = editorReducer(loaded, {
      type: "reorder-region",
      id: testPolygonRegionId,
      direction: "lower",
    });

    expect(sortedByZOrder(regionsOf(raised)).at(-1)?.id).toBe(testRectangleRegionId);
    expect(sortedByZOrder(regionsOf(lowered))[0]?.id).toBe(testPolygonRegionId);
  });

  it("keeps z-order a safe integer, which the domain requires", () => {
    const raised = editorReducer(loaded, {
      type: "reorder-region",
      id: testRectangleRegionId,
      direction: "raise",
    });

    for (const region of regionsOf(raised)) expect(Number.isSafeInteger(region.zOrder)).toBe(true);
  });
});

describe("toInputs", () => {
  it("sends every region with its identity so links survive the save", () => {
    const geometry = { kind: "Rectangle", x: 0.5, y: 0.5, width: 0.2, height: 0.2 } as const;
    const added = editorReducer(loaded, { type: "add-region", geometry });
    const drawnId = regionsOf(added)[2]?.id ?? "";
    const linked = editorReducer(added, {
      type: "patch-region",
      id: testPolygonRegionId,
      changes: { parentRegionId: drawnId },
    });
    const inputs = toInputs(linked.draft!);

    expect(inputs.map((input) => input.id)).toEqual([
      testRectangleRegionId,
      testPolygonRegionId,
      drawnId,
    ]);
    /* The new region can be a visual parent because it already has a real id. */
    expect(inputs[1]?.parentRegionId).toBe(drawnId);
  });

  it("carries every field the save contract needs", () => {
    expect(toInputs(testMapSnapshot)[0]).toEqual({
      id: testRectangleRegionId,
      displayName: "Aisle A bays",
      hierarchyNodeId: testMapSnapshot.regions[0]!.hierarchyNodeId,
      parentRegionId: null,
      geometry: testMapSnapshot.regions[0]!.geometry,
      zOrder: 1,
      searchAliases: ["bay row"],
      status: "Active",
    });
  });
});

describe("flattenHierarchy", () => {
  it("walks the whole tree depth first", () => {
    expect(flattenHierarchy([testBranch]).map((node) => node.code)).toEqual([
      "BR",
      "MAIN",
      "MAIN-A",
      "MAIN-B",
    ]);
  });
});
