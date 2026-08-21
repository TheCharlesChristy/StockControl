import { createHash } from "node:crypto";

export type SafeJson =
  string | number | boolean | null | SafeJson[] | { readonly [key: string]: SafeJson };

const SECRET_KEY = /authorization|cookie|password|secret|token|credential|prompt|stack/iu;

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

const safeValue = (value: unknown, depth: number): SafeJson => {
  if (depth > 4) {
    return "[TRUNCATED]";
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return typeof value === "string" ? value.slice(0, 500) : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "[INVALID_NUMBER]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => safeValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const output: Record<string, SafeJson> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? "[REDACTED]" : safeValue(entry, depth + 1);
    }
    return output;
  }
  return "[UNSUPPORTED]";
};

export const safeJsonObject = (value: unknown): Readonly<Record<string, SafeJson>> => {
  const result = safeValue(value, 0);
  return typeof result === "object" && !Array.isArray(result) && result !== null ? result : {};
};

export const safeString = (value: unknown, maximum = 300): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maximum);
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
