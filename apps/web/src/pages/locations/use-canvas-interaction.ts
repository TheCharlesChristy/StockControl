import type { MapGeometry, MapRegionView } from "@stockcontrol/contracts";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { EditorMode } from "./editor-state";
import {
  SNAP_STEP,
  clamp,
  moveGeometry,
  polygonProblem,
  rectangleFromPoints,
  resizeRectangle,
  snapGeometry,
  snapPoint,
  type Point,
  type RectangleGeometry,
  type ResizeHandle,
} from "./geometry";
import type { LiveGeometryStore } from "./live-geometry-store";
import { useLatestRef } from "./use-latest-ref";
import type { MapViewportController } from "./use-map-viewport";
import {
  distanceBetween,
  midpointOf,
  panBy,
  pinchViewport,
  screenToNormalized,
  type PinchStart,
  type Viewport,
} from "./viewport";

/** How close, in normalized units, a click must be to close a polygon. */
const POLYGON_CLOSE_DISTANCE = 0.02;
/** Arrow-key nudge, and the larger step Shift selects. */
const NUDGE_STEP = 0.005;
const NUDGE_STEP_LARGE = 0.02;

type Gesture =
  | { readonly kind: "idle" }
  | {
      readonly kind: "move";
      readonly pointerId: number;
      readonly regionId: string;
      readonly start: Point;
      readonly origin: MapGeometry;
    }
  | {
      readonly kind: "resize";
      readonly pointerId: number;
      readonly regionId: string;
      readonly handle: ResizeHandle;
      readonly origin: RectangleGeometry;
    }
  | { readonly kind: "draw"; readonly pointerId: number; readonly start: Point }
  | {
      readonly kind: "pan";
      readonly pointerId: number;
      readonly startClient: Point;
      readonly startViewport: Viewport;
    }
  | { readonly kind: "pinch"; readonly start: PinchStart };

interface PendingPointer {
  readonly clientX: number;
  readonly clientY: number;
  readonly altKey: boolean;
}

export interface CanvasInteractionOptions {
  readonly canEdit: boolean;
  readonly mode: EditorMode;
  readonly snapEnabled: boolean;
  readonly regions: readonly MapRegionView[];
  readonly selectedRegionId: string | null;
  readonly store: LiveGeometryStore;
  readonly viewport: MapViewportController;
  readonly onSelect: (id: string | null) => void;
  readonly onCommitGeometry: (id: string, geometry: MapGeometry) => void;
  readonly onCreateRegion: (geometry: MapGeometry) => void;
  readonly onRemoveRegion: (id: string) => void;
  readonly onProblem: (message: string) => void;
}

export interface CanvasInteraction {
  readonly cursor: string;
  readonly onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onLostPointerCapture: (event: ReactPointerEvent<SVGSVGElement>) => void;
  readonly onKeyDown: (event: React.KeyboardEvent<SVGSVGElement>) => void;
  readonly onKeyUp: (event: React.KeyboardEvent<SVGSVGElement>) => void;
}

const isResizeHandle = (value: string | null): value is ResizeHandle =>
  value === "nw" || value === "ne" || value === "sw" || value === "se";

/** Preview rectangle for an in-progress drag — no minimum size, so it tracks exactly. */
const previewRectangle = (start: Point, end: Point): RectangleGeometry => ({
  kind: "Rectangle",
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.max(Math.abs(end.x - start.x), 1e-4),
  height: Math.max(Math.abs(end.y - start.y), 1e-4),
});

/**
 * The pointer and keyboard state machine for the map canvas.
 *
 * The important property: nothing here touches React state while a gesture is
 * running. Pointer moves are gated through one `requestAnimationFrame` and
 * published to the live-geometry store, which only the shape being dragged
 * subscribes to. The reducer hears about the change exactly once, on release.
 * Hit testing is delegated from the `<svg>` root via data attributes, so region
 * shapes carry no handlers and can be memoised on their data alone.
 */
export function useCanvasInteraction(options: CanvasInteractionOptions): CanvasInteraction {
  const optionsRef = useLatestRef(options);
  const gestureRef = useRef<Gesture>({ kind: "idle" });
  const pendingRef = useRef<PendingPointer | null>(null);
  const frameRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const liveGeometryRef = useRef<MapGeometry | null>(null);
  const drawEndRef = useRef<Point | null>(null);
  const gestureStartClientRef = useRef<Point>({ x: 0, y: 0 });
  const polygonRef = useRef<readonly Point[]>([]);
  const pointersRef = useRef(new Map<number, Point>());

  const regionsById = useMemo(
    () => new Map(options.regions.map((region) => [region.id, region])),
    [options.regions],
  );
  const regionsRef = useLatestRef(regionsById);

  const normalizedFrom = useCallback(
    (clientX: number, clientY: number): Point => {
      const { rectRef, viewport } = optionsRef.current.viewport;
      const rect = rectRef.current;
      const point = screenToNormalized(viewport, {
        x: clientX - rect.left,
        y: clientY - rect.top,
      });
      return { x: clamp(point.x), y: clamp(point.y) };
    },
    [optionsRef],
  );

  const snapped = useCallback(
    (point: Point, altKey: boolean): Point => {
      /* Alt is the escape hatch from the grid, the way most editors do it. */
      return optionsRef.current.snapEnabled && !altKey ? snapPoint(point, SNAP_STEP) : point;
    },
    [optionsRef],
  );

  const publishPolygonPreview = useCallback(
    (cursor: Point | null): void => {
      const points = polygonRef.current;
      if (points.length === 0) {
        optionsRef.current.store.setPreview(null);
        return;
      }
      const first = points[0];
      optionsRef.current.store.setPreview({
        kind: "polygon",
        points,
        cursor,
        closeable:
          points.length >= 3 &&
          cursor !== null &&
          first !== undefined &&
          distanceBetween(first, cursor) <= POLYGON_CLOSE_DISTANCE,
      });
    },
    [optionsRef],
  );

  const flush = useCallback((): void => {
    frameRef.current = null;
    const pending = pendingRef.current;
    const gesture = gestureRef.current;
    if (pending === null) return;
    const { store, viewport } = optionsRef.current;

    if (gesture.kind === "pan") {
      viewport.applyViewport(
        panBy(
          gesture.startViewport,
          pending.clientX - gesture.startClient.x,
          pending.clientY - gesture.startClient.y,
        ),
      );
      return;
    }
    if (gesture.kind === "pinch") {
      const [first, second] = [...pointersRef.current.values()];
      if (first === undefined || second === undefined) return;
      viewport.applyViewport(
        pinchViewport(
          gesture.start,
          { midpoint: midpointOf(first, second), distance: distanceBetween(first, second) },
          viewport.fitScale,
        ),
      );
      return;
    }

    const point = normalizedFrom(pending.clientX, pending.clientY);
    /* A click that selects a region must not mark the map dirty. */
    const dragged =
      Math.hypot(
        pending.clientX - gestureStartClientRef.current.x,
        pending.clientY - gestureStartClientRef.current.y,
      ) > 2;

    if (gesture.kind === "move") {
      if (!dragged) return;
      const moved = moveGeometry(
        gesture.origin,
        point.x - gesture.start.x,
        point.y - gesture.start.y,
      );
      const geometry =
        optionsRef.current.snapEnabled && !pending.altKey ? snapGeometry(moved, SNAP_STEP) : moved;
      liveGeometryRef.current = geometry;
      movedRef.current = true;
      store.setRegionGeometry(gesture.regionId, geometry);
      return;
    }
    if (gesture.kind === "resize") {
      if (!dragged) return;
      const geometry = resizeRectangle(
        gesture.origin,
        gesture.handle,
        snapped(point, pending.altKey),
      );
      liveGeometryRef.current = geometry;
      movedRef.current = true;
      store.setRegionGeometry(gesture.regionId, geometry);
      return;
    }
    if (gesture.kind === "draw") {
      const end = snapped(point, pending.altKey);
      drawEndRef.current = end;
      store.setPreview({ kind: "rectangle", geometry: previewRectangle(gesture.start, end) });
      return;
    }
    if (optionsRef.current.mode === "polygon")
      publishPolygonPreview(snapped(point, pending.altKey));
  }, [normalizedFrom, optionsRef, publishPolygonPreview, snapped]);

  const schedule = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      pendingRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey,
      };
      /*
       * One frame per paint, however fast the pointer reports. This gate is what
       * turns ~120 state updates a second into at most 60 renders of a single
       * memoised shape.
       */
      frameRef.current ??= requestAnimationFrame(flush);
    },
    [flush],
  );

  const cancelFrame = useCallback((): void => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingRef.current = null;
  }, []);

  const endGesture = useCallback(
    (commit: boolean): void => {
      const gesture = gestureRef.current;
      const geometry = liveGeometryRef.current;
      const end = drawEndRef.current;
      const { store, onCommitGeometry, onCreateRegion } = optionsRef.current;
      cancelFrame();
      gestureRef.current = { kind: "idle" };
      liveGeometryRef.current = null;
      drawEndRef.current = null;

      if ((gesture.kind === "move" || gesture.kind === "resize") && geometry !== null) {
        /* One dispatch for the whole gesture, however many frames it took. */
        if (commit && movedRef.current) onCommitGeometry(gesture.regionId, geometry);
        store.clearRegion();
      }
      if (gesture.kind === "draw") {
        const rectangle = end === null ? null : rectangleFromPoints(gesture.start, end);
        store.setPreview(null);
        if (commit && rectangle !== null) onCreateRegion(rectangle);
      }
      movedRef.current = false;
    },
    [cancelFrame, optionsRef],
  );

  const finishPolygon = useCallback((): void => {
    const points = polygonRef.current;
    const { onCreateRegion, onProblem, store } = optionsRef.current;
    if (points.length < 3) return;
    const problem = polygonProblem(points);
    if (problem !== null) {
      onProblem(problem);
      return;
    }
    polygonRef.current = [];
    store.setPreview(null);
    onCreateRegion({ kind: "Polygon", points });
  }, [optionsRef]);

  const cancelPolygon = useCallback((): void => {
    polygonRef.current = [];
    optionsRef.current.store.setPreview(null);
  }, [optionsRef]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const { canEdit, mode, viewport, onSelect } = optionsRef.current;
      if (event.button !== 0 && event.button !== 1) return;
      const rect = viewport.refreshRect();
      const client = { x: event.clientX, y: event.clientY };
      gestureStartClientRef.current = client;
      pointersRef.current.set(event.pointerId, {
        x: client.x - rect.left,
        y: client.y - rect.top,
      });
      event.currentTarget.setPointerCapture(event.pointerId);

      /* A second touch turns whatever was happening into a pinch. */
      if (pointersRef.current.size === 2 && event.pointerType === "touch") {
        const [first, second] = [...pointersRef.current.values()];
        if (first !== undefined && second !== undefined) {
          endGesture(false);
          gestureRef.current = {
            kind: "pinch",
            start: {
              viewport: viewport.viewport,
              midpoint: midpointOf(first, second),
              distance: distanceBetween(first, second),
            },
          };
        }
        return;
      }

      const panning = event.button === 1 || viewport.spaceHeld || mode === "pan";
      if (panning) {
        gestureRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          startClient: client,
          startViewport: viewport.viewport,
        };
        return;
      }

      const point = normalizedFrom(event.clientX, event.clientY);

      if (canEdit && mode === "polygon") {
        const next = snapped(point, event.altKey);
        const first = polygonRef.current[0];
        if (
          polygonRef.current.length >= 3 &&
          first !== undefined &&
          distanceBetween(first, next) <= POLYGON_CLOSE_DISTANCE
        ) {
          finishPolygon();
          return;
        }
        polygonRef.current = [...polygonRef.current, next];
        publishPolygonPreview(next);
        return;
      }

      if (canEdit && mode === "rectangle") {
        gestureRef.current = {
          kind: "draw",
          pointerId: event.pointerId,
          start: snapped(point, event.altKey),
        };
        return;
      }

      const target = event.target as Element;
      const handleElement = target.closest("[data-handle]");
      const handle = handleElement?.getAttribute("data-handle") ?? null;
      const regionId =
        target.closest("[data-region-id]")?.getAttribute("data-region-id") ??
        handleElement?.getAttribute("data-handle-region") ??
        null;

      if (regionId === null) {
        onSelect(null);
        return;
      }
      const region = regionsRef.current.get(regionId);
      if (region === undefined) return;
      onSelect(regionId);
      if (!canEdit || region.status === "Archived") return;

      if (isResizeHandle(handle) && region.geometry.kind === "Rectangle") {
        gestureRef.current = {
          kind: "resize",
          pointerId: event.pointerId,
          regionId,
          handle,
          origin: region.geometry,
        };
        return;
      }
      gestureRef.current = {
        kind: "move",
        pointerId: event.pointerId,
        regionId,
        start: point,
        origin: region.geometry,
      };
    },
    [
      endGesture,
      finishPolygon,
      normalizedFrom,
      optionsRef,
      publishPolygonPreview,
      regionsRef,
      snapped,
    ],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      const rect = optionsRef.current.viewport.rectRef.current;
      if (pointersRef.current.has(event.pointerId))
        pointersRef.current.set(event.pointerId, {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
      /* Idle and not mid-polygon means there is nothing to recompute. */
      if (gestureRef.current.kind === "idle" && polygonRef.current.length === 0) return;
      schedule(event);
    },
    [optionsRef, schedule],
  );

  const releasePointer = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>, commit: boolean): void => {
      pointersRef.current.delete(event.pointerId);
      if (gestureRef.current.kind === "idle") return;
      if (gestureRef.current.kind === "pinch" && pointersRef.current.size > 0) return;
      cancelFrame();
      if (commit) {
        /* Settle on the release position rather than the last painted frame. */
        pendingRef.current = {
          clientX: event.clientX,
          clientY: event.clientY,
          altKey: event.altKey,
        };
        flush();
      }
      endGesture(commit);
    },
    [cancelFrame, endGesture, flush],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      releasePointer(event, true);
    },
    [releasePointer],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      releasePointer(event, false);
    },
    [releasePointer],
  );

  const onLostPointerCapture = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): void => {
      /*
       * Without this the old editor left its drag record set when the pointer
       * went away, and the region resumed moving on the next unrelated event.
       */
      releasePointer(event, true);
    },
    [releasePointer],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>): void => {
      const {
        canEdit,
        mode,
        regions,
        selectedRegionId,
        onSelect,
        onCommitGeometry,
        onRemoveRegion,
        viewport,
      } = optionsRef.current;
      if (viewport.handleKey(event)) {
        event.preventDefault();
        return;
      }

      if (mode === "polygon" && polygonRef.current.length > 0) {
        if (event.key === "Enter") {
          event.preventDefault();
          finishPolygon();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          cancelPolygon();
          return;
        }
        if (event.key === "Backspace") {
          event.preventDefault();
          polygonRef.current = polygonRef.current.slice(0, -1);
          publishPolygonPreview(null);
          return;
        }
      }

      if (event.key === "Escape") {
        onSelect(null);
        return;
      }
      if (event.key === "Enter" && selectedRegionId === null && regions.length > 0) {
        event.preventDefault();
        onSelect(regions[0]?.id ?? null);
        return;
      }

      const selected =
        selectedRegionId === null ? undefined : regionsRef.current.get(selectedRegionId);

      /* Tab walks the regions while one is selected, instead of every shape being a tab stop. */
      if (event.key === "Tab" && selected !== undefined && regions.length > 1) {
        event.preventDefault();
        const index = regions.findIndex((region) => region.id === selected.id);
        const next = (index + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
        onSelect(regions[next]?.id ?? null);
        return;
      }

      if (!canEdit || selected === undefined) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onRemoveRegion(selected.id);
        return;
      }

      const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
      const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      if (dx === 0 && dy === 0) return;
      event.preventDefault();
      onCommitGeometry(selected.id, moveGeometry(selected.geometry, dx, dy));
    },
    [cancelPolygon, finishPolygon, optionsRef, publishPolygonPreview, regionsRef],
  );

  const onKeyUp = useCallback(
    (event: React.KeyboardEvent<SVGSVGElement>): void => {
      optionsRef.current.viewport.handleKey(event);
    },
    [optionsRef],
  );

  /* Leaving the tool or the page mid-draw should not strand a preview on screen. */
  useEffect(() => {
    if (options.mode === "polygon") return;
    polygonRef.current = [];
    options.store.setPreview(null);
  }, [options.mode, options.store]);

  useEffect(() => {
    const store = options.store;
    return (): void => {
      store.clear();
    };
  }, [options.store]);

  const cursor = useMemo(() => {
    if (options.viewport.spaceHeld || options.mode === "pan") return "grab";
    if (options.mode === "rectangle" || options.mode === "polygon") return "crosshair";
    return "default";
  }, [options.mode, options.viewport.spaceHeld]);

  return {
    cursor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
    onKeyUp,
  };
}
