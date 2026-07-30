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

afterEach((): void => {
  cleanup();
  window.sessionStorage.clear();
  document.title = "";
  setDesktopViewport(true);
});
