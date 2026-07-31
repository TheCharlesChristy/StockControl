import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import type { Point } from "./geometry";
import { useLatestRef } from "./use-latest-ref";
import {
  ZOOM_STEP,
  clampScale,
  clampViewport,
  fitScaleFor,
  fitViewport,
  identityViewport,
  panBy,
  zoomAt,
  zoomPercent,
  type Size,
  type Viewport,
} from "./viewport";

export interface MapViewportController {
  readonly viewport: Viewport;
  readonly size: Size;
  readonly fitScale: number;
  readonly zoomPercentage: number;
  readonly spaceHeld: boolean;
  /**
   * Callback ref. The canvas only mounts once a map has loaded, so a plain ref
   * would still be null when the observer effect ran and the viewport would
   * never be measured.
   */
  readonly attachContainer: (element: HTMLDivElement | null) => void;
  /** Canvas box, measured once per gesture rather than once per pointer move. */
  readonly rectRef: RefObject<DOMRect>;
  readonly refreshRect: () => DOMRect;
  readonly applyViewport: (next: Viewport) => void;
  readonly zoomByStep: (steps: number) => void;
  readonly zoomToPoint: (anchor: Point, nextScale: number) => void;
  readonly fit: () => void;
  /** Returns true when the key was a viewport shortcut and has been handled. */
  readonly handleKey: (event: React.KeyboardEvent) => boolean;
}

const emptyRect = (): DOMRect => ({
  x: 0,
  y: 0,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
});

/**
 * Owns pan and zoom for the map canvas.
 *
 * The transform lives here rather than on the `<svg>` as a CSS `scale()`: the
 * old approach zoomed about the element centre inside an `overflow: hidden` box,
 * so magnified content was clipped and unreachable, and the Pan tool had nothing
 * to drive at all.
 */
export function useMapViewport(): MapViewportController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const rectRef = useRef<DOMRect>(emptyRect());
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<Viewport>(identityViewport);
  const [spaceHeld, setSpaceHeld] = useState(false);
  /* Until the user pans or zooms, a resize refits rather than stranding the map. */
  const adjustedRef = useRef(false);
  const sizeRef = useLatestRef(size);
  const viewportRef = useLatestRef(viewport);

  const fitScale = useMemo(() => fitScaleFor(size), [size]);

  const attachContainer = useCallback((element: HTMLDivElement | null): void => {
    containerRef.current = element;
    setContainer(element);
  }, []);

  const refreshRect = useCallback((): DOMRect => {
    const element = containerRef.current;
    if (element !== null) rectRef.current = element.getBoundingClientRect();
    return rectRef.current;
  }, []);

  /* Falls back to the measured box if a gesture beats the first size update. */
  const currentSize = useCallback((): Size => {
    const known = sizeRef.current;
    if (known.width > 0 && known.height > 0) return known;
    const rect = rectRef.current;
    return { width: rect.width, height: rect.height };
  }, [sizeRef]);

  const applyViewport = useCallback(
    (next: Viewport): void => {
      adjustedRef.current = true;
      setViewport(clampViewport(next, currentSize()));
    },
    [currentSize],
  );

  const fit = useCallback((): void => {
    adjustedRef.current = false;
    setViewport(fitViewport(currentSize()));
  }, [currentSize]);

  const zoomToPoint = useCallback(
    (anchor: Point, nextScale: number): void => {
      applyViewport(
        zoomAt(viewportRef.current, anchor, clampScale(nextScale, fitScaleFor(currentSize()))),
      );
    },
    [applyViewport, currentSize, viewportRef],
  );

  const zoomByStep = useCallback(
    (steps: number): void => {
      const size = currentSize();
      zoomToPoint(
        { x: size.width / 2, y: size.height / 2 },
        viewportRef.current.scale * ZOOM_STEP ** steps,
      );
    },
    [currentSize, viewportRef, zoomToPoint],
  );

  /* Measure the canvas, and keep the map framed while the user has not moved it. */
  useEffect(() => {
    const element = container;
    if (element === null) return;

    const measure = (): void => {
      const rect = element.getBoundingClientRect();
      rectRef.current = rect;
      const next = { width: rect.width, height: rect.height };
      setSize((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
      setViewport((current) =>
        adjustedRef.current ? clampViewport(current, next) : fitViewport(next),
      );
    };

    /* Take the first measurement rather than waiting on the observer's own. */
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return (): void => {
      observer.disconnect();
    };
  }, [container]);

  /*
   * React registers wheel listeners passively, so preventDefault() from an
   * onWheel prop is ignored and the page scrolls underneath the map. The
   * listener has to be attached by hand.
   */
  useEffect(() => {
    const element = container;
    if (element === null) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = rectRef.current.width === 0 ? refreshRect() : rectRef.current;
      if (event.ctrlKey || event.metaKey) {
        const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        zoomToPoint(anchor, viewportRef.current.scale * Math.exp(-event.deltaY / 100));
        return;
      }
      const horizontal = event.shiftKey ? event.deltaY : event.deltaX;
      const vertical = event.shiftKey ? event.deltaX : event.deltaY;
      applyViewport(panBy(viewportRef.current, -horizontal, -vertical));
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return (): void => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [applyViewport, container, refreshRect, viewportRef, zoomToPoint]);

  /* A blur while space is held would otherwise leave the canvas stuck in pan mode. */
  useEffect(() => {
    if (!spaceHeld) return;
    const release = (): void => {
      setSpaceHeld(false);
    };
    window.addEventListener("blur", release);
    return (): void => {
      window.removeEventListener("blur", release);
    };
  }, [spaceHeld]);

  const handleKey = useCallback(
    (event: React.KeyboardEvent): boolean => {
      if (event.key === " ") {
        setSpaceHeld(event.type === "keydown");
        return true;
      }
      if (event.type !== "keydown") return false;
      if (event.key === "+" || event.key === "=") {
        zoomByStep(1);
        return true;
      }
      if (event.key === "-" || event.key === "_") {
        zoomByStep(-1);
        return true;
      }
      if (event.key === "0") {
        fit();
        return true;
      }
      return false;
    },
    [fit, zoomByStep],
  );

  return {
    viewport,
    size,
    fitScale,
    zoomPercentage: zoomPercent(viewport, fitScale),
    spaceHeld,
    attachContainer,
    rectRef,
    refreshRect,
    applyViewport,
    zoomByStep,
    zoomToPoint,
    fit,
    handleKey,
  };
}
