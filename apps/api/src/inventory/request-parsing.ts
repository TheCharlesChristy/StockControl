import { validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface Paging {
  readonly limit: number;
  readonly offset: number;
}

/** Clamps rather than rejects, so a stray query string never breaks a screen. */
export function parsePaging(limit?: string, offset?: string): Paging {
  const parsedLimit = Number(limit ?? DEFAULT_PAGE_SIZE);
  const parsedOffset = Number(offset ?? 0);

  return {
    limit:
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
    offset: Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0,
  };
}

export function parseTimestamp(value: string | undefined, field: string): Date | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApplicationFailureException(
      validationFailed({ [field]: ["Enter a valid ISO 8601 date."] }),
    );
  }

  return parsed;
}

/**
 * A request body is untrusted input, whatever its declared contract type says,
 * so it is read as `unknown` and narrowed here rather than being believed.
 */
export type Body = Readonly<Record<string, unknown>>;

export function bodyOf(value: unknown): Body {
  return typeof value === "object" && value !== null ? (value as Body) : {};
}

export function readText(body: Body, field: string): string {
  const value = body[field];

  return typeof value === "string" ? value.trim() : "";
}

export function requireText(body: Body, field: string, label: string): string {
  const text = readText(body, field);

  if (text.length === 0) {
    throw new ApplicationFailureException(validationFailed({ [field]: [`Enter ${label}.`] }));
  }

  return text;
}

export function optionalText(body: Body, field: string): string | null {
  const text = readText(body, field);

  return text.length === 0 ? null : text;
}

export function readBoolean(body: Body, field: string): boolean | undefined {
  const value = body[field];

  return typeof value === "boolean" ? value : undefined;
}

/**
 * Three states, because a PATCH that can remove a value needs all three:
 * absent leaves it alone, present-but-blank clears it, anything else sets it.
 * `readText` collapses the first two into `""` and cannot express the
 * difference.
 */
export function readClearableText(body: Body, field: string): string | null | undefined {
  const value = body[field];

  if (value === undefined) return undefined;

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Present-but-blank is a different thing from absent, and callers care. */
export function readOptionalId(body: Body, field: string): string | null {
  const value = body[field];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * For identifiers the client generates. A client that picks its own id can
 * pick anything at all, so the shape is checked before it reaches a query —
 * and rejecting the malformed ones early keeps a route from turning a typo
 * into a database error whose message nobody wants in a response.
 */
export function requireUuid(body: Body, field: string, label: string): string {
  const value = readText(body, field);

  if (!isUuid(value)) {
    throw new ApplicationFailureException(validationFailed({ [field]: [`Enter ${label}.`] }));
  }

  return value.toLowerCase();
}

export function optionalUuid(body: Body, field: string, label: string): string | null {
  const value = readOptionalId(body, field);

  if (value === null) return null;

  if (!isUuid(value)) {
    throw new ApplicationFailureException(validationFailed({ [field]: [`Enter ${label}.`] }));
  }

  return value.toLowerCase();
}

/** Route parameters get the same treatment; a path segment is not a promise. */
export function requireUuidParameter(value: string, label: string): string {
  if (!isUuid(value)) {
    throw new ApplicationFailureException(
      validationFailed({ id: [`Enter a valid ${label} reference.`] }),
    );
  }

  return value.toLowerCase();
}

/**
 * Reads a bounded array. Every capture route takes lists whose length the
 * client decides, and an unbounded one is a way to make the server allocate
 * as much memory as somebody feels like sending.
 */
export function readBoundedArray(body: Body, field: string, maximum: number): readonly unknown[] {
  const value = body[field];

  if (!Array.isArray(value)) return [];

  if (value.length > maximum) {
    throw new ApplicationFailureException(
      validationFailed({ [field]: [`Send at most ${String(maximum)} of these at a time.`] }),
    );
  }

  return value;
}

export function requireBoundedText(
  body: Body,
  field: string,
  label: string,
  maximum: number,
): string {
  const text = requireText(body, field, label);

  if (text.length > maximum) {
    throw new ApplicationFailureException(
      validationFailed({ [field]: [`Keep this to ${String(maximum)} characters or fewer.`] }),
    );
  }

  return text;
}

export function readPositiveInteger(body: Body, field: string, label: string): number {
  const value = body[field];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ApplicationFailureException(validationFailed({ [field]: [`Enter ${label}.`] }));
  }

  return value;
}
