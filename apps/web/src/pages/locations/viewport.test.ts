import { describe, expect, it } from "vitest";

import { MAP_UNITS } from "./geometry";
import {
  FIT_PADDING,
  MAX_SCALE_FACTOR,
  MIN_SCALE_FACTOR,
  clampScale,
  clampViewport,
  clientToOffset,
  distanceBetween,
  fitScaleFor,
  fitViewport,
  mapToScreen,
  midpointOf,
  panBy,
  pinchViewport,
  screenToMap,
  screenToNormalized,
  transformAttribute,
  zoomAt,
  zoomPercent,
  type Viewport,
} from "./viewport";

const wide = { width: 800, height: 600 };
const square = { width: 600, height: 600 };

describe("fitViewport", () => {
  it("reproduces the letterboxed fit the old canvas rendered", () => {
    /*
     * The previous canvas used viewBox="0 0 100 100" with the default
     * preserveAspectRatio, which centres a square of side min(w, h). Matching it
     * means nothing moves visually at 100%.
     */
    const viewport = fitViewport(wide);
    const side = MAP_UNITS * viewport.scale;

    expect(side).toBeCloseTo(Math.min(wide.width, wide.height) - FIT_PADDING * 2, 9);
    expect(viewport.offsetX).toBeCloseTo((wide.width - side) / 2, 9);
    expect(viewport.offsetY).toBeCloseTo((wide.height - side) / 2, 9);
  });

  it("centres on a square canvas too", () => {
    const viewport = fitViewport(square);
    expect(viewport.offsetX).toBeCloseTo(viewport.offsetY, 9);
  });

  it("survives a canvas that has not been measured yet", () => {
    expect(fitScaleFor({ width: 0, height: 0 })).toBeGreaterThan(0);
  });
});

describe("screen and map coordinates", () => {
  const viewport = fitViewport(wide);

  it("round-trips through map units", () => {
    for (const point of [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 12.5 },
    ]) {
      const back = screenToMap(viewport, mapToScreen(viewport, point));
      expect(back.x).toBeCloseTo(point.x, 9);
      expect(back.y).toBeCloseTo(point.y, 9);
    }
  });

  it("puts the centre of a non-square canvas at the centre of the map", () => {
    /*
     * The bug this replaces: the old code divided by the element's width and
     * height, so on an 800x600 canvas the centre mapped to (0.5, 0.5) only by
     * accident and every other point was skewed.
     */
    const centre = screenToNormalized(viewport, { x: wide.width / 2, y: wide.height / 2 });
    expect(centre.x).toBeCloseTo(0.5, 9);
    expect(centre.y).toBeCloseTo(0.5, 9);
  });

  it("maps the map's own corners to its rendered box, not the element box", () => {
    const topLeft = mapToScreen(viewport, { x: 0, y: 0 });
    expect(topLeft.x).toBeCloseTo(FIT_PADDING + 100, 9);
    expect(topLeft.y).toBeCloseTo(FIT_PADDING, 9);
  });

  it("subtracts the canvas position from client coordinates", () => {
    const rect = { left: 40, top: 20 } as DOMRectReadOnly;
    expect(clientToOffset(rect, 140, 120)).toEqual({ x: 100, y: 100 });
  });
});

describe("zoomAt", () => {
  const viewport = fitViewport(wide);

  it("holds the point under the cursor still", () => {
    const anchor = { x: 220, y: 380 };
    const before = screenToMap(viewport, anchor);
    const after = screenToMap(zoomAt(viewport, anchor, viewport.scale * 2.5), anchor);

    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("returns to where it started after zooming in and back out", () => {
    const anchor = { x: 610, y: 90 };
    const zoomed = zoomAt(viewport, anchor, viewport.scale * 3);
    const restored = zoomAt(zoomed, anchor, viewport.scale);

    expect(restored.scale).toBeCloseTo(viewport.scale, 9);
    expect(restored.offsetX).toBeCloseTo(viewport.offsetX, 9);
    expect(restored.offsetY).toBeCloseTo(viewport.offsetY, 9);
  });
});

describe("clampScale", () => {
  it("bounds zoom to a multiple of the fitted scale", () => {
    const fit = fitScaleFor(wide);
    expect(clampScale(fit * 100, fit)).toBeCloseTo(fit * MAX_SCALE_FACTOR, 9);
    expect(clampScale(fit / 100, fit)).toBeCloseTo(fit * MIN_SCALE_FACTOR, 9);
    expect(clampScale(fit * 2, fit)).toBeCloseTo(fit * 2, 9);
  });
});

describe("panBy and clampViewport", () => {
  const viewport = fitViewport(wide);

  it("translates without touching the scale", () => {
    const panned = panBy(viewport, 30, -20);
    expect(panned.scale).toBe(viewport.scale);
    expect(panned.offsetX).toBeCloseTo(viewport.offsetX + 30, 9);
    expect(panned.offsetY).toBeCloseTo(viewport.offsetY - 20, 9);
  });

  it("never lets the map be pushed entirely off the canvas", () => {
    const lost = clampViewport(panBy(viewport, 100_000, 100_000), wide);
    const span = MAP_UNITS * viewport.scale;

    expect(lost.offsetX).toBeLessThan(wide.width);
    expect(lost.offsetX + span).toBeGreaterThan(0);
    expect(lost.offsetY + span).toBeGreaterThan(0);
  });

  it("leaves a viewport that is already on screen alone", () => {
    expect(clampViewport(viewport, wide)).toEqual(viewport);
  });
});

describe("pinchViewport", () => {
  const viewport = fitViewport(wide);

  it("scales by the change in finger distance and follows the midpoint", () => {
    const start = {
      viewport,
      midpoint: midpointOf({ x: 300, y: 300 }, { x: 400, y: 300 }),
      distance: distanceBetween({ x: 300, y: 300 }, { x: 400, y: 300 }),
    };
    const pinched = pinchViewport(
      start,
      {
        midpoint: midpointOf({ x: 300, y: 300 }, { x: 500, y: 300 }),
        distance: distanceBetween({ x: 300, y: 300 }, { x: 500, y: 300 }),
      },
      fitScaleFor(wide),
    );

    expect(pinched.scale).toBeCloseTo(viewport.scale * 2, 9);
  });

  it("does nothing useful but stays finite when the fingers start together", () => {
    const degenerate = pinchViewport(
      { viewport, midpoint: { x: 10, y: 10 }, distance: 0 },
      { midpoint: { x: 10, y: 10 }, distance: 50 },
      fitScaleFor(wide),
    );
    expect(Number.isFinite(degenerate.scale)).toBe(true);
  });
});

describe("presentation", () => {
  it("writes an SVG transform", () => {
    const viewport: Viewport = { scale: 2, offsetX: 10, offsetY: -5 };
    expect(transformAttribute(viewport)).toBe("translate(10 -5) scale(2)");
  });

  it("reports 100% when the map fits the canvas", () => {
    const viewport = fitViewport(wide);
    expect(zoomPercent(viewport, fitScaleFor(wide))).toBe(100);
    expect(zoomPercent({ ...viewport, scale: viewport.scale * 2 }, fitScaleFor(wide))).toBe(200);
  });
});
