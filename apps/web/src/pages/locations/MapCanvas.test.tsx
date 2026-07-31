import type { AuthenticatedSession, MapRegionInput, SaveMapRequest } from "@stockcontrol/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StockControlProviders } from "../../app/App";
import type { AuthClient, SignInCredentials } from "../../auth/auth-types";
import {
  createFakeApiClient,
  testMapId,
  testPolygonRegionId,
  testRectangleRegionId,
  type RecordedRequest,
} from "../../test/fake-api";
import { mockCanvasLayout, runFramesSynchronously } from "../../test/layout";
import { LocationsPage } from "../LocationsPage";

/*
 * The canvas is 800x600 with an 8px fit padding, so the map occupies a 584px
 * square starting at (108, 8). Everything below is expressed against that.
 */
const CANVAS = { width: 800, height: 600 };
const MAP_SIDE = 584;
const MAP_LEFT = (CANVAS.width - MAP_SIDE) / 2;
const MAP_TOP = (CANVAS.height - MAP_SIDE) / 2;

/** Client coordinates for a normalized point on the map. */
const at = (x: number, y: number): { clientX: number; clientY: number } => ({
  clientX: MAP_LEFT + x * MAP_SIDE,
  clientY: MAP_TOP + y * MAP_SIDE,
});

const session: AuthenticatedSession = {
  user: {
    id: "user-admin",
    email: "admin@example.com",
    displayName: "Sam Field",
    role: "Admin",
  },
  issuedAt: "2026-07-30T09:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
};

class StubAuthClient implements AuthClient {
  public getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
    signal.throwIfAborted();
    return Promise.resolve(session);
  }

  public signIn(credentials: SignInCredentials): Promise<AuthenticatedSession> {
    void credentials;
    return Promise.resolve(session);
  }

  public signOut(): Promise<void> {
    return Promise.resolve();
  }
}

interface Harness {
  readonly requests: readonly RecordedRequest[];
  readonly canvas: SVGSVGElement;
}

async function renderMap(): Promise<Harness> {
  const requests: RecordedRequest[] = [];
  const api = createFakeApiClient({}, (request) => {
    requests.push(request);
  });

  render(
    <StockControlProviders authClient={new StubAuthClient()} apiClient={api}>
      <MemoryRouter initialEntries={["/locations"]}>
        <Routes>
          <Route path="/locations" element={<LocationsPage />} />
        </Routes>
      </MemoryRouter>
    </StockControlProviders>,
  );

  const canvas = await screen.findByRole("application", { name: /Main warehouse map/u });
  return { requests, canvas: canvas as unknown as SVGSVGElement };
}

const saved = (requests: readonly RecordedRequest[]): readonly MapRegionInput[] => {
  const put = requests.filter(
    (request) => request.method === "PUT" && request.path === `/maps/${testMapId}`,
  );
  return (put.at(-1)?.body as SaveMapRequest | undefined)?.regions ?? [];
};

const shapeFor = (id: string): SVGGraphicsElement => {
  const element = document.querySelector(`[data-region-id="${id}"]`);
  if (element === null) throw new Error(`No shape rendered for ${id}`);
  return element as SVGGraphicsElement;
};

const worldTransform = (): string =>
  document.querySelector("svg > g")?.getAttribute("transform") ?? "";

const scaleFromTransform = (transform: string): number =>
  Number(/scale\(([-\d.]+)\)/u.exec(transform)?.[1] ?? "0");

const drag = (
  canvas: SVGSVGElement,
  from: { clientX: number; clientY: number },
  through: readonly { clientX: number; clientY: number }[],
  options: Record<string, unknown> = {},
  /* Where the press lands. A real browser targets the shape; only moves bubble. */
  target: Element = canvas,
): void => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, buttons: 1, ...from, ...options });
  for (const point of through)
    fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 1, ...point, ...options });
  const last = through.at(-1) ?? from;
  fireEvent.pointerUp(canvas, { pointerId: 1, button: 0, buttons: 0, ...last, ...options });
};

beforeEach(() => {
  mockCanvasLayout(CANVAS);
  runFramesSynchronously();
});

describe("pointer coordinates", () => {
  /*
   * The regression test for the original bug: the canvas is not square, and the
   * old editor measured pointer positions across the element box while the SVG
   * letterboxed its coordinate system, so shapes landed away from the cursor.
   */
  it("draws a rectangle where the pointer went on a non-square canvas", async () => {
    const { requests, canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: "Draw rectangle" }));
    drag(canvas, at(0.2, 0.2), [at(0.4, 0.3), at(0.5, 0.4)], { altKey: true });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saved(requests)).toHaveLength(3);
    });
    const drawn = saved(requests)[2]?.geometry;
    expect(drawn?.kind).toBe("Rectangle");
    if (drawn?.kind !== "Rectangle") throw new Error("expected a rectangle");
    expect(drawn.x).toBeCloseTo(0.2, 2);
    expect(drawn.y).toBeCloseTo(0.2, 2);
    expect(drawn.width).toBeCloseTo(0.3, 2);
    expect(drawn.height).toBeCloseTo(0.2, 2);
  });

  it("snaps to the grid unless Alt is held", async () => {
    const { requests, canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: "Draw rectangle" }));
    drag(canvas, at(0.213, 0.207), [at(0.487, 0.464)]);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saved(requests)).toHaveLength(3);
    });
    const drawn = saved(requests)[2]?.geometry;
    if (drawn?.kind !== "Rectangle") throw new Error("expected a rectangle");
    expect(drawn.x * 100).toBeCloseTo(Math.round(drawn.x * 100), 6);
    expect(drawn.y * 100).toBeCloseTo(Math.round(drawn.y * 100), 6);
  });
});

describe("dragging a region", () => {
  it("moves the shape live and commits once when the pointer is released", async () => {
    const { requests, canvas } = await renderMap();

    const before = shapeFor(testRectangleRegionId).getAttribute("x");
    drag(
      canvas,
      at(0.2, 0.15),
      [at(0.3, 0.25), at(0.4, 0.35)],
      { altKey: true },
      shapeFor(testRectangleRegionId),
    );
    const after = shapeFor(testRectangleRegionId).getAttribute("x");

    expect(Number(after)).toBeGreaterThan(Number(before));

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saved(requests)).toHaveLength(2);
    });
    const moved = saved(requests).find((region) => region.id === testRectangleRegionId)?.geometry;
    if (moved?.kind !== "Rectangle") throw new Error("expected a rectangle");
    expect(moved.x).toBeCloseTo(0.3, 2);
    expect(moved.y).toBeCloseTo(0.3, 2);
  });

  it("stops following the pointer after the gesture is cancelled", async () => {
    /*
     * The old editor kept its drag record in a ref that nothing cleared when the
     * pointer went away, so the region resumed moving on the next stray event.
     */
    const { canvas } = await renderMap();

    fireEvent.pointerDown(shapeFor(testRectangleRegionId), {
      pointerId: 1,
      button: 0,
      buttons: 1,
      ...at(0.2, 0.15),
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 1, ...at(0.3, 0.25) });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    const settled = shapeFor(testRectangleRegionId).getAttribute("x");
    fireEvent.pointerMove(canvas, { pointerId: 1, buttons: 0, ...at(0.8, 0.8) });

    expect(shapeFor(testRectangleRegionId).getAttribute("x")).toBe(settled);
  });
});

describe("viewport", () => {
  it("zooms towards the cursor and leaves the point under it in place", async () => {
    const { canvas } = await renderMap();
    const container = canvas.parentElement;
    if (container === null) throw new Error("canvas has no container");

    const before = worldTransform();
    fireEvent.wheel(container, { deltaY: -200, ctrlKey: true, clientX: 300, clientY: 200 });
    const after = worldTransform();

    expect(scaleFromTransform(after)).toBeGreaterThan(scaleFromTransform(before));
    /* The map point under (300, 200) must not have moved. */
    const mapPointBefore = (300 - readTranslate(before)[0]) / scaleFromTransform(before);
    const mapPointAfter = (300 - readTranslate(after)[0]) / scaleFromTransform(after);
    expect(mapPointAfter).toBeCloseTo(mapPointBefore, 6);
  });

  it("pans on a plain wheel without changing the zoom", async () => {
    const { canvas } = await renderMap();
    const container = canvas.parentElement;
    if (container === null) throw new Error("canvas has no container");

    const before = worldTransform();
    fireEvent.wheel(container, { deltaY: 120, clientX: 300, clientY: 200 });
    const after = worldTransform();

    expect(scaleFromTransform(after)).toBeCloseTo(scaleFromTransform(before), 9);
    expect(readTranslate(after)[1]).toBeLessThan(readTranslate(before)[1]);
  });

  it("pans with the Pan tool, which previously did nothing at all", async () => {
    const { canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: "Pan map" }));
    const before = worldTransform();
    drag(canvas, { clientX: 400, clientY: 300 }, [{ clientX: 460, clientY: 340 }]);
    const after = worldTransform();

    expect(readTranslate(after)[0]).toBeCloseTo(readTranslate(before)[0] + 60, 6);
    expect(readTranslate(after)[1]).toBeCloseTo(readTranslate(before)[1] + 40, 6);
    expect(scaleFromTransform(after)).toBeCloseTo(scaleFromTransform(before), 9);
  });
});

function readTranslate(transform: string): readonly [number, number] {
  const match = /translate\(([-\d.]+) ([-\d.]+)\)/u.exec(transform);
  return [Number(match?.[1] ?? "0"), Number(match?.[2] ?? "0")];
}

describe("region ordering and removal", () => {
  it("paints regions in z-order so Raise and Lower are visible", async () => {
    await renderMap();

    const order = (): readonly (string | null)[] =>
      [...document.querySelectorAll("[data-region-id]")].map((node) =>
        node.getAttribute("data-region-id"),
      );
    expect(order()).toEqual([testRectangleRegionId, testPolygonRegionId]);

    await userEvent.click(screen.getByRole("button", { name: /Aisle A bays/u }));
    await userEvent.click(await screen.findByRole("button", { name: "Raise" }));

    expect(order()).toEqual([testPolygonRegionId, testRectangleRegionId]);
  });

  it("removes the selected region with the Delete key", async () => {
    const { requests, canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: /Aisle A bays/u }));
    fireEvent.keyDown(canvas, { key: "Delete" });

    expect(document.querySelector(`[data-region-id="${testRectangleRegionId}"]`)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(saved(requests)).toHaveLength(1);
    });
    expect(saved(requests)[0]?.id).toBe(testPolygonRegionId);
  });
});

describe("polygon drawing", () => {
  it("previews while drawing and commits on Enter", async () => {
    const { requests, canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: "Draw polygon" }));
    for (const point of [at(0.2, 0.7), at(0.4, 0.7), at(0.3, 0.9)])
      fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, ...point });

    expect(screen.getByTestId("draw-preview")).toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: "Enter" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saved(requests)).toHaveLength(3);
    });
    expect(saved(requests)[2]?.geometry.kind).toBe("Polygon");
  });

  it("abandons the outline on Escape", async () => {
    const { canvas } = await renderMap();

    await userEvent.click(screen.getByRole("button", { name: "Draw polygon" }));
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, ...at(0.2, 0.7) });
    expect(screen.getByTestId("draw-preview")).toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(screen.queryByTestId("draw-preview")).not.toBeInTheDocument();
  });
});

describe("search", () => {
  it("waits for typing to settle before asking the server", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { requests } = await renderMap();
      const field = screen.getByRole("textbox", { name: "Search locations" });

      await userEvent.type(field, "aisle");
      await vi.advanceTimersByTimeAsync(400);

      await waitFor(() => {
        expect(requests.filter((request) => request.path === "/locations/search")).toHaveLength(1);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
