import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

function createMediaQueryList(query: string, isDesktop: boolean): MediaQueryList {
  return {
    matches: isDesktop && query.includes("min-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn((): boolean => false),
  };
}

export function setDesktopViewport(isDesktop: boolean): void {
  window.matchMedia = vi.fn((query: string) => createMediaQueryList(query, isDesktop));
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => createMediaQueryList(query, true)),
});

/*
 * jsdom has neither a layout engine nor the pointer-capture API, both of which
 * the map canvas relies on. Stub them so components can mount; tests that care
 * about geometry install their own sizes with `mockCanvasLayout`.
 */
class TestResizeObserver implements ResizeObserver {
  public constructor(callback: ResizeObserverCallback) {
    void callback;
  }

  public observe(): void {
    /*
     * Deliberately inert: jsdom never resizes anything, and firing the callback
     * synchronously from observe() re-enters React during commit. Code that
     * needs a first measurement takes it itself.
     */
  }

  public unobserve(): void {
    /* Nothing is scheduled, so there is nothing to cancel. */
  }

  public disconnect(): void {
    /* Nothing is scheduled, so there is nothing to cancel. */
  }
}

globalThis.ResizeObserver = TestResizeObserver;

Element.prototype.setPointerCapture = function setPointerCapture(): void {
  /* Capture is a no-op here; events already dispatch to the target under test. */
};
Element.prototype.releasePointerCapture = function releasePointerCapture(): void {
  /* See setPointerCapture. */
};
Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean {
  return false;
};

afterEach((): void => {
  cleanup();
  window.sessionStorage.clear();
  document.title = "";
  setDesktopViewport(true);
});
