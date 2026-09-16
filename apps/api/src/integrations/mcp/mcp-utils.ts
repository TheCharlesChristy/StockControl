import { createHash } from "node:crypto";

export type SafeJson =
  string | number | boolean | null | SafeJson[] | { readonly [key: string]: SafeJson };

const SECRET_KEY =
  /(?:access[-_]?token|api[-_]?key|authorization|bearer|client[-_]?secret|code(?:[-_](?:challenge|verifier))?|cookie|credential|jwt|oauth[-_]?code|password|private[-_]?key|prompt|refresh[-_]?token|secret|session(?:[-_]?id)?|stack|state|token)/iu;

/*
 * Key-based redaction is the primary defence because opaque OAuth tokens do
 * not have a reliable prefix. These value patterns are a second line for
 * common credentials accidentally placed in a free-text field such as an
 * action summary.
 */
const SECRET_VALUE =
  /(?:\bbearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|\b(?:gh[pousr]_\w+|sk-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,})|-----BEGIN [A-Z ]+ PRIVATE KEY-----)/iu;

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
};

export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const safeValue = (value: unknown, depth: number, seen: WeakSet<object>): SafeJson => {
  if (depth > 4) {
    return "[TRUNCATED]";
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value !== "string") return value;
    return SECRET_VALUE.test(value) ? "[REDACTED]" : value.slice(0, 500);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const output = value.slice(0, 50).map((entry) => safeValue(entry, depth + 1, seen));
    seen.delete(value);
    return output;
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const output = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : safeValue(entry, depth + 1, seen),
      ]),
    );
    seen.delete(value);
    return output;
  }
  return "[UNSUPPORTED]";
};

export const safeJsonObject = (value: unknown): Readonly<Record<string, SafeJson>> => {
  try {
    const result = safeValue(value, 0, new WeakSet<object>());
    return typeof result === "object" && !Array.isArray(result) && result !== null ? result : {};
  } catch {
    // Getters and proxies are untrusted input too. A projection must never
    // prevent the durable Received audit row from being written.
    return {};
  }
};

export const safeString = (value: unknown, maximum = 300): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const bounded = trimmed.slice(0, maximum);
  return SECRET_VALUE.test(bounded) ? "[REDACTED]" : bounded;
};

export const recordReferences = (value: unknown): readonly string[] => {
  const references: string[] = [];
  const visit = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object") {
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      if (/^(?:id|.*Id)$/u.test(key) && typeof nested === "string" && nested.length <= 80) {
        references.push(`${key}:${nested}`);
      } else {
        visit(nested);
      }
    }
  };
  visit(value);
  return [...new Set(references)].slice(0, 50);
};
