/*
 * Canonicalisation for idempotent capture commands.
 *
 * The client picks the id (`clientEntryId`); the server decides what that id
 * means by hashing the canonical form of the business fields it actually acted
 * on. Replaying the same command returns the original result; reusing the id
 * with different fields is a conflict rather than a silent overwrite.
 *
 * Hashing itself is not here on purpose. This module is imported by the browser
 * as well as the API, so it stays free of `node:crypto`; the caller digests the
 * string this returns.
 */

export type CanonicalValue =
  | boolean
  | number
  | string
  | null
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

/**
 * Deterministic JSON: object keys sorted, `undefined` treated as absent, and
 * non-finite numbers refused. `JSON.stringify` alone is not enough because its
 * key order follows insertion order, so two equivalent requests built by
 * different code paths would hash differently.
 */
export const canonicalJson = (value: CanonicalValue): string => {
  if (value === null) return "null";

  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("A canonical request cannot contain a non-finite number.");
    }
    /* Normalises -0 to 0, so two arithmetically equal requests hash equally. */
    return JSON.stringify(value === 0 ? 0 : value);
  }

  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry as CanonicalValue)).join(",")}]`;
  }

  /*
   * The cast admits `undefined`, which the type does not: callers build these
   * objects from optional fields, so a key really can arrive holding nothing.
   * `JSON.stringify` omits such a key and so must this, or a request built by
   * two different code paths would hash differently.
   */
  const entries = (
    Object.entries(value) as readonly (readonly [string, CanonicalValue | undefined])[]
  )
    .filter((entry): entry is readonly [string, CanonicalValue] => entry[1] !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
};

/**
 * A version marker leads every canonical form. Changing what a command means
 * without changing this would let an old replay match a new command's hash.
 */
const CANONICAL_VERSION = "stock-capture.v1";

export const canonicalRequest = (
  kind: string,
  fields: {
    readonly [key: string]: CanonicalValue;
  },
): string => canonicalJson({ version: CANONICAL_VERSION, kind, fields });
