import { describe, expect, it } from "vitest";

import {
  HmacIdentityAuditIntegrity,
  type AuditIntegrityEvent,
  type AuditIntegrityValue,
} from "../src/audit-integrity.js";

const event = (overrides: Partial<AuditIntegrityEvent> = {}): AuditIntegrityEvent => ({
  id: "3c139454-7f57-4752-8898-1fb449611918",
  sequence: 1n,
  occurredAt: new Date("2026-07-29T12:00:00.000Z"),
  eventType: "identity.sign_in.succeeded",
  outcome: "Succeeded",
  actorUserId: "9357e22c-5773-4f0b-9425-0f063aa16138",
  subjectUserId: "9357e22c-5773-4f0b-9425-0f063aa16138",
  sessionId: "575c9b3d-83cd-484d-a447-d6a6ec459e8e",
  correlationId: "request:test-1",
  remoteAddressHash: new Uint8Array(32).fill(7),
  details: { b: 2, a: [true, null, "safe"], negativeZero: -0 },
  ...overrides,
});

const service = (
  activeId = "audit-key-2",
  retained: readonly { readonly id: string; readonly key: Uint8Array }[] = [
    { id: "audit-key-1", key: new Uint8Array(32).fill(1) },
  ],
): HmacIdentityAuditIntegrity =>
  new HmacIdentityAuditIntegrity({
    active: { id: activeId, key: new Uint8Array(32).fill(2) },
    retained,
  });

describe("HmacIdentityAuditIntegrity", () => {
  it("seals canonical event content and verifies active and retained keys", () => {
    const current = service();
    const input = event();
    const seal = current.seal(input);

    expect(seal).toMatchObject({ version: 1, keyId: "audit-key-2" });
    expect(seal.eventHash).toHaveLength(32);
    expect(current.verify(input, seal)).toBe(true);
    const minimal = event({
      actorUserId: undefined,
      subjectUserId: undefined,
      sessionId: undefined,
      remoteAddressHash: undefined,
    } as never);
    expect(current.verify(minimal, current.seal(minimal))).toBe(true);
    expect(
      current.seal(
        event({
          details: { negativeZero: 0, a: [true, null, "safe"], b: 2 },
        }),
      ).eventHash,
    ).toEqual(seal.eventHash);

    const old = new HmacIdentityAuditIntegrity({
      active: { id: "audit-key-1", key: new Uint8Array(32).fill(1) },
    });
    const oldSeal = old.seal(input);
    expect(current.verify(input, oldSeal)).toBe(true);
  });

  it("detects content, linkage, key, version, and digest tampering", () => {
    const integrity = service();
    const input = event();
    const seal = integrity.seal(input);

    expect(integrity.verify(event({ eventType: "identity.sign_in.failed" }), seal)).toBe(false);
    expect(integrity.verify(event({ previousEventHash: new Uint8Array(32).fill(9) }), seal)).toBe(
      false,
    );
    expect(integrity.verify(input, { ...seal, keyId: "missing-key" })).toBe(false);
    expect(integrity.verify(input, { ...seal, version: 2 as never })).toBe(false);
    expect(integrity.verify(input, { ...seal, eventHash: new Uint8Array(31) })).toBe(false);
  });

  it("validates keyring identifiers, sizes, and uniqueness", () => {
    expect(
      () =>
        new HmacIdentityAuditIntegrity({
          active: { id: "bad key", key: new Uint8Array(32) },
        }),
    ).toThrow("key ID");
    expect(
      () =>
        new HmacIdentityAuditIntegrity({
          active: { id: "good", key: new Uint8Array(31) },
        }),
    ).toThrow("32 to 128");
    expect(
      () =>
        new HmacIdentityAuditIntegrity({
          active: { id: "good", key: "not-bytes" as never },
        }),
    ).toThrow("32 to 128");
    expect(
      () =>
        new HmacIdentityAuditIntegrity({
          active: { id: "same", key: new Uint8Array(32) },
          retained: [{ id: "same", key: new Uint8Array(128) }],
        }),
    ).toThrow("unique");
  });

  it("rejects malformed event metadata and hashes", () => {
    const integrity = service();
    const invalidEvents: readonly [Partial<AuditIntegrityEvent>, string][] = [
      [{ sequence: 0n }, "positive PostgreSQL bigint"],
      [{ sequence: 9_223_372_036_854_775_808n }, "positive PostgreSQL bigint"],
      [{ occurredAt: new Date(Number.NaN) }, "valid instant"],
      [{ outcome: "Unknown" as never }, "outcome"],
      [{ correlationId: "has spaces" }, "correlation"],
      [{ id: "" }, "event ID"],
      [{ eventType: "\u0000" }, "event type"],
      [{ eventType: "\u0085" }, "event type"],
      [{ remoteAddressHash: new Uint8Array(31) }, "exactly 32 bytes"],
      [{ previousEventHash: new Uint8Array(33) }, "exactly 32 bytes"],
    ];

    for (const [override, expected] of invalidEvents) {
      expect(() => integrity.seal(event(override))).toThrow(expected);
    }
  });

  it("canonicalises JSON values while enforcing resource and value bounds", () => {
    const integrity = service();
    expect(() => integrity.seal(event({ details: { value: Number.NaN } }))).toThrow(
      "finite numbers",
    );
    expect(() => integrity.seal(event({ details: { "\u0000": true } }))).toThrow("detail key");

    let nested: AuditIntegrityValue = null;
    for (let depth = 0; depth < 34; depth += 1) {
      nested = [nested];
    }
    expect(() => integrity.seal(event({ details: { nested } }))).toThrow("nesting depth");

    expect(() =>
      integrity.seal(
        event({
          details: { many: Array.from({ length: 10_001 }, () => null) },
        }),
      ),
    ).toThrow("too many values");
    expect(() => integrity.seal(event({ details: { oversized: "x".repeat(65_536) } }))).toThrow(
      "65,536 bytes",
    );
  });
});
