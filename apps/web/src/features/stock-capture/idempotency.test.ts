import { describe, expect, it } from "vitest";

import { createIdempotencyKeeper } from "./idempotency";

const countingIds = (): (() => string) => {
  let issued = 0;
  return () => {
    issued += 1;
    return `key-${String(issued)}`;
  };
};

describe("createIdempotencyKeeper", () => {
  /*
   * This is the whole point of the type. A confirmation whose response was
   * lost must be retried under the key the server already saw, or the server
   * treats the retry as a second delivery and the stockroom ends up with two
   * receipts for one van.
   */
  it("hands back the same key while the payload is unchanged", () => {
    const keeper = createIdempotencyKeeper(countingIds());
    const payload = { itemId: "item-1", quantity: "5" };

    expect(keeper.keyFor(payload)).toBe("key-1");
    expect(keeper.keyFor({ itemId: "item-1", quantity: "5" })).toBe("key-1");
    expect(keeper.keyFor(payload)).toBe("key-1");
  });

  /*
   * And the other half: the server answers 409 when a key it has seen arrives
   * with a different payload, so an edited quantity must not reuse the key.
   */
  it("mints a new key as soon as the payload changes", () => {
    const keeper = createIdempotencyKeeper(countingIds());

    expect(keeper.keyFor({ quantity: "5" })).toBe("key-1");
    expect(keeper.keyFor({ quantity: "6" })).toBe("key-2");
    expect(keeper.keyFor({ quantity: "6" })).toBe("key-2");
  });

  it("treats a changed payload that changes back as a new intent", () => {
    const keeper = createIdempotencyKeeper(countingIds());

    keeper.keyFor({ quantity: "5" });
    keeper.keyFor({ quantity: "6" });

    expect(keeper.keyFor({ quantity: "5" })).toBe("key-3");
  });

  it("starts again after a reset, so the next command is not a retry", () => {
    const keeper = createIdempotencyKeeper(countingIds());
    const payload = { quantity: "5" };

    expect(keeper.keyFor(payload)).toBe("key-1");
    keeper.reset();
    expect(keeper.keyFor(payload)).toBe("key-2");
  });

  it("issues real UUIDs by default", () => {
    const keeper = createIdempotencyKeeper();

    expect(keeper.keyFor({ quantity: "5" })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
  });
});
