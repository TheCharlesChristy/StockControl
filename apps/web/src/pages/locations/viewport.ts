import { MAP_UNITS, type Point } from "./geometry";

/**
 * The map's pan-and-zoom transform.
 *
 * The canvas deliberately has no `viewBox`: SVG user units are CSS pixels with
 * the origin at the element's top-left, and everything drawn sits inside one
 * group carrying `translate(offsetX offsetY) scale(scale)`. That keeps a single
 * affine under our control — the previous `viewBox` plus `preserveAspectRatio`
 * letterboxed the coordinate system, so pointer maths that measured the element
 * box put shapes somewhere other than the cursor.
 *
 * `scale` maps the 0–100 map-unit square to pixels; `offsetX`/`offsetY` are the
 * pixel position of the map's top-left corner within the canvas.
 */
export interface Viewport {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Zoom range, expressed as multiples of the scale that fits the canvas. */
export const MIN_SCALE_FACTOR = 0.5;
export const MAX_SCALE_FACTOR = 8;
/** Ratio applied by the toolbar's zoom buttons and the +/- keys. */
export const ZOOM_STEP = 1.25;
/** Breathing room left around the map when fitting. */
export const FIT_PADDING = 8;
/** Panning always leaves at least this much of the map on screen. */
const MIN_VISIBLE_PIXELS = 48;

export const identityViewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 };

/**
 * The scale at which the map exactly fits the canvas — the same result the old
 * `preserveAspectRatio="xMidYMid meet"` produced, so nothing moves visually at
 * 100%.
 */
export const fitScaleFor = (size: Size, padding: number = FIT_PADDING): number => {
  const usableWidth = Math.max(1, size.width - padding * 2);
  const usableHeight = Math.max(1, size.height - padding * 2);
  return Math.max(Number.EPSILON, Math.min(usableWidth, usableHeight) / MAP_UNITS);
};

export const fitViewport = (size: Size, padding: number = FIT_PADDING): Viewport => {
  const scale = fitScaleFor(size, padding);
  return {
    scale,
    offsetX: (size.width - MAP_UNITS * scale) / 2,
    offsetY: (size.height - MAP_UNITS * scale) / 2,
  };
};

export const clampScale = (scale: number, fitScale: number): number =>
  Math.min(Math.max(scale, fitScale * MIN_SCALE_FACTOR), fitScale * MAX_SCALE_FACTOR);

/** Canvas-relative pixels to map units (0–100). */
export const screenToMap = (viewport: Viewport, offset: Point): Point => ({
  x: (offset.x - viewport.offsetX) / viewport.scale,
  y: (offset.y - viewport.offsetY) / viewport.scale,
});

/** Map units back to canvas-relative pixels. */
export const mapToScreen = (viewport: Viewport, point: Point): Point => ({
  x: point.x * viewport.scale + viewport.offsetX,
  y: point.y * viewport.scale + viewport.offsetY,
});

/** Canvas-relative pixels to the normalized `[0, 1]` values the API stores. */
export const screenToNormalized = (viewport: Viewport, offset: Point): Point => {
  const point = screenToMap(viewport, offset);
  return { x: point.x / MAP_UNITS, y: point.y / MAP_UNITS };
};

/** Converts a client (viewport) coordinate into a canvas-relative one. */
export const clientToOffset = (rect: DOMRectReadOnly, clientX: number, clientY: number): Point => ({
  x: clientX - rect.left,
  y: clientY - rect.top,
});

export const panBy = (viewport: Viewport, dx: number, dy: number): Viewport => ({
  ...viewport,
  offsetX: viewport.offsetX + dx,
  offsetY: viewport.offsetY + dy,
});

/**
 * Rescales while holding the map point under `anchor` still: from
 * `anchor = map * scale + offset` it follows that
 * `offset' = anchor - (anchor - offset) * (scale' / scale)`.
 */
export const zoomAt = (viewport: Viewport, anchor: Point, nextScale: number): Viewport => {
  const ratio = nextScale / viewport.scale;
  return {
    scale: nextScale,
    offsetX: anchor.x - (anchor.x - viewport.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - viewport.offsetY) * ratio,
  };
};

/** Keeps the map reachable: it can never be dragged entirely off the canvas. */
export const clampViewport = (viewport: Viewport, size: Size): Viewport => {
  const span = MAP_UNITS * viewport.scale;
  const visible = Math.min(span, MIN_VISIBLE_PIXELS);
  return {
    scale: viewport.scale,
    offsetX: Math.min(Math.max(viewport.offsetX, visible - span), size.width - visible),
    offsetY: Math.min(Math.max(viewport.offsetY, visible - span), size.height - visible),
  };
};

export interface PinchStart {
  readonly viewport: Viewport;
  readonly midpoint: Point;
  readonly distance: number;
}

export const midpointOf = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export const distanceBetween = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Two-finger zoom: scale about the starting midpoint, then follow the drag. */
export const pinchViewport = (
  start: PinchStart,
  current: { readonly midpoint: Point; readonly distance: number },
  fitScale: number,
): Viewport => {
  const ratio = start.distance === 0 ? 1 : current.distance / start.distance;
  const nextScale = clampScale(start.viewport.scale * ratio, fitScale);
  const zoomed = zoomAt(start.viewport, start.midpoint, nextScale);
  return panBy(
    zoomed,
    current.midpoint.x - start.midpoint.x,
    current.midpoint.y - start.midpoint.y,
  );
};

export const transformAttribute = (viewport: Viewport): string =>
  `translate(${String(viewport.offsetX)} ${String(viewport.offsetY)}) scale(${String(viewport.scale)})`;

/**
 * Toolbar reading. 100% means "fits the canvas", which is what it meant before
 * this change, so the control keeps its old meaning.
 */
export const zoomPercent = (viewport: Viewport, fitScale: number): number =>
  Math.round((viewport.scale / fitScale) * 100);
