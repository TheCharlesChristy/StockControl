import { afterEach, describe, expect, it } from "vitest";

import {
  dismissConsoleError,
  getConsoleErrorEntries,
  installConsoleErrorCapture,
} from "./use-console-error-notifications";

installConsoleErrorCapture();

afterEach((): void => {
  for (const entry of getConsoleErrorEntries()) {
    dismissConsoleError(entry.id);
  }
});

describe("installConsoleErrorCapture", () => {
  it("records a console.error call as an entry and still logs it normally", () => {
    console.error("Widget list failed to load");

    const entries = getConsoleErrorEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.summary).toBe("Widget list failed to load");
    expect(entries[0]?.count).toBe(1);
  });

  it("collapses a repeated identical message into one entry with a growing count", () => {
    console.error("Failed to fetch inventory");
    console.error("Failed to fetch inventory");
    console.error("Failed to fetch inventory");

    const entries = getConsoleErrorEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.count).toBe(3);
  });

  it("keeps an Error object's stack in the detail while using its message as the summary", () => {
    const error = new Error("Could not reach the server");
    console.error(error);

    const entries = getConsoleErrorEntries();
    expect(entries[0]?.summary).toContain("Could not reach the server");
    expect(entries[0]?.detail).toContain("Could not reach the server");
  });

  it("removes an entry when dismissed", () => {
    console.error("Temporary failure");
    const [entry] = getConsoleErrorEntries();
    expect(entry).toBeDefined();

    dismissConsoleError(entry!.id);

    expect(getConsoleErrorEntries()).toHaveLength(0);
  });
});
