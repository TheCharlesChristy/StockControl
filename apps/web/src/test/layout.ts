import { afterEach, vi } from "vitest";

/**
 * jsdom reports every element as a zero-sized box at the origin, so anything
 * that converts a pointer position into map coordinates needs a size handed to
 * it. These helpers supply one, and run animation frames synchronously so a
 * simulated drag settles inside the test rather than a frame later.
 */

const originalRectDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "getBoundingClientRect",
);
const restorers: (() => void)[] = [];

export interface CanvasLayout {
  readonly width: number;
  readonly height: number;
  readonly left?: number;
  readonly top?: number;
}

/**
 * Gives every element the supplied box. `Element` rather than `HTMLElement`,
 * because the canvas is SVG and would otherwise keep reporting zeroes.
 */
export function mockCanvasLayout(layout: CanvasLayout): void {
  const left = layout.left ?? 0;
  const top = layout.top ?? 0;
  const rect: DOMRect = {
    x: left,
    y: top,
    left,
    top,
    width: layout.width,
    height: layout.height,
    right: left + layout.width,
    bottom: top + layout.height,
    toJSON: () => ({}),
  };

  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    value: (): DOMRect => rect,
  });
  restorers.push(() => {
    if (originalRectDescriptor !== undefined)
      Object.defineProperty(Element.prototype, "getBoundingClientRect", originalRectDescriptor);
  });
}

/** Makes requestAnimationFrame fire immediately, so rAF-batched work lands now. */
export function runFramesSynchronously(): void {
  const frame = vi
    .spyOn(globalThis, "requestAnimationFrame")
    .mockImplementation((callback: FrameRequestCallback): number => {
      callback(performance.now());
      return 0;
    });
  const cancel = vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((): void => {
    /* Frames already ran, so there is nothing to cancel. */
  });
  restorers.push(() => {
    frame.mockRestore();
    cancel.mockRestore();
  });
}

afterEach(() => {
  for (const restore of restorers.splice(0)) restore();
});
