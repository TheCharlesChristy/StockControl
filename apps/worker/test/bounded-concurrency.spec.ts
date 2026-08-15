import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "../src/recognition/bounded-concurrency";

describe("mapWithConcurrency", () => {
  it("runs no more than the configured number and preserves input order", async () => {
    let active = 0;
    let maximumActive = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => {
        setTimeout(resolve, value % 2 === 0 ? 1 : 5);
      });
      active -= 1;
      return value * 10;
    });

    expect(maximumActive).toBe(2);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it.each([0, -1, 1.5])("rejects invalid concurrency %s", async (concurrency) => {
    await expect(
      mapWithConcurrency([1], concurrency, (value) => Promise.resolve(value)),
    ).rejects.toThrow("concurrency must be a positive integer");
  });
});
