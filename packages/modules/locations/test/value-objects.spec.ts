import { describe, expect, it } from "vitest";

import {
  createDocumentId,
  createEngineerId,
  createJobId,
  createLocationCode,
  createLocationId,
  createLocationName,
  createMapId,
  createMapRegionId,
  createReason,
} from "../src/index.js";

describe("location value objects", () => {
  it("accepts canonical internal UUID identities and normalizes case", () => {
    const upper = "ABCDEFAB-1234-4567-8ABC-ABCDEFABCDEF";
    const normalized = "abcdefab-1234-4567-8abc-abcdefabcdef";
    expect(createLocationId(upper)).toBe(normalized);
    expect(createMapId(upper)).toBe(normalized);
    expect(createMapRegionId(upper)).toBe(normalized);
    expect(() => createLocationId("not-a-uuid")).toThrow("canonical UUID");
    expect(() => createMapId("00000000-0000-0000-0000-000000000000")).toThrow("canonical UUID");
    expect(() => createMapRegionId(" 00000000-0000-4000-8000-000000000001 ")).not.toThrow();
  });

  it("accepts bounded opaque external references without assigning foreign semantics", () => {
    expect(createEngineerId("engineer:one")).toBe("engineer:one");
    expect(createJobId("JOB-42")).toBe("JOB-42");
    expect(createDocumentId("document_1")).toBe("document_1");
    for (const factory of [createEngineerId, createJobId, createDocumentId]) {
      expect(() => factory("")).toThrow("stable 1-128");
      expect(() => factory(" leading")).toThrow("stable 1-128");
      expect(() => factory("bad/slash")).toThrow("stable 1-128");
      expect(() => factory("a".repeat(129))).toThrow("stable 1-128");
    }
  });

  it("canonicalizes human-readable codes and rejects ambiguous forms", () => {
    expect(createLocationCode(" bld-1/a.2 ")).toBe("BLD-1/A.2");
    expect(createLocationCode("CACHE_1")).toBe("CACHE_1");
    expect(() => createLocationCode("")).toThrow("1-32");
    expect(() => createLocationCode("-BAD")).toThrow("1-32");
    expect(() => createLocationCode("HAS SPACE")).toThrow("1-32");
    expect(() => createLocationCode("A".repeat(33))).toThrow("1-32");
  });

  it("normalizes mutable names and validates reasoned overrides", () => {
    expect(createLocationName("  Main   Store  ")).toBe("Main Store");
    expect(() => createLocationName("Main\nStore")).toThrow("1-120");
    expect(() => createLocationName(" ")).toThrow("1-120");
    expect(() => createLocationName("a".repeat(121))).toThrow("1-120");
    expect(() => createLocationName("a".repeat(257))).toThrow("1-120");
    expect(createReason("  Physical handover confirmed by phone. ")).toBe(
      "Physical handover confirmed by phone.",
    );
    expect(() => createReason("")).toThrow("1-500");
    expect(() => createReason("a".repeat(501))).toThrow("1-500");
    expect(() => createReason("a".repeat(1_001))).toThrow("1-500");
    expect(() => createReason("Unsafe\nreason")).toThrow("1-500");
  });
});
