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

/** Present-but-blank is a different thing from absent, and callers care. */
export function readOptionalId(body: Body, field: string): string | null {
  const value = body[field];

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
