import { describe, expect, it } from "vitest";

import { canonicalJson, canonicalRequest } from "../src/request-hash";

describe("canonical request form", () => {
  /*
   * `JSON.stringify` follows insertion order, so the same command built by the
   * controller and by a retry helper would otherwise hash differently and a
   * legitimate replay would be reported as a conflict.
   */
  it("orders object keys so key insertion order cannot change the hash", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("keeps array order, because order is meaningful", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it("drops absent fields rather than writing them as null", () => {
    expect(canonicalJson({ a: 1, b: undefined as unknown as null })).toBe('{"a":1}');
    expect(canonicalJson({ a: 1, b: null })).toBe('{"a":1,"b":null}');
  });

  it("normalises negative zero so equal quantities hash equally", () => {
    expect(canonicalJson(-0)).toBe(canonicalJson(0));
  });

  it("refuses a non-finite number instead of writing null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/u);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(/non-finite/u);
  });

  it("escapes strings so a crafted value cannot forge structure", () => {
    expect(canonicalJson({ a: '","b":"' })).toBe('{"a":"\\",\\"b\\":\\""}');
  });

  it("distinguishes two different commands with the same fields", () => {
    const fields = { quantity: "1.000" };
    expect(canonicalRequest("commit", fields)).not.toBe(canonicalRequest("cancel", fields));
  });

  /* Without the version marker an old replay could match a new command's hash. */
  it("carries a version marker", () => {
    expect(canonicalRequest("commit", {})).toContain("stock-capture.v1");
  });

  it("changes when any business field changes", () => {
    const base = canonicalRequest("commit", { quantity: "1.000", locationId: "loc-1" });
    expect(canonicalRequest("commit", { quantity: "2.000", locationId: "loc-1" })).not.toBe(base);
    expect(canonicalRequest("commit", { quantity: "1.000", locationId: "loc-2" })).not.toBe(base);
  });

  it("serialises booleans and nested structures deterministically", () => {
    expect(canonicalJson({ z: true, a: [{ y: false, x: null }] })).toBe(
      '{"a":[{"x":null,"y":false}],"z":true}',
    );
  });
});
