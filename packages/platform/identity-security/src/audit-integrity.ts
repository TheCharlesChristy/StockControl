import { createHmac } from "node:crypto";

import { constantTimeEqual, encodeBase64Url, utf8 } from "./encoding.js";

export type AuditIntegrityPrimitive = boolean | number | string | null;
export type AuditIntegrityValue =
  | AuditIntegrityPrimitive
  | readonly AuditIntegrityValue[]
  | { readonly [key: string]: AuditIntegrityValue };

export interface AuditIntegrityEvent {
  readonly id: string;
  readonly sequence: bigint;
  readonly occurredAt: Date;
  readonly eventType: string;
  readonly outcome: "Succeeded" | "Denied" | "Failed";
  readonly actorUserId?: string;
  readonly subjectUserId?: string;
  readonly sessionId?: string;
  readonly correlationId: string;
  readonly remoteAddressHash?: Uint8Array;
  readonly details: Readonly<Record<string, AuditIntegrityValue>>;
  readonly previousEventHash?: Uint8Array;
}

export interface AuditIntegrityKeyInput {
  readonly id: string;
  readonly key: Uint8Array;
}

export interface AuditIntegrityKeyringInput {
  readonly active: AuditIntegrityKeyInput;
  readonly retained?: readonly AuditIntegrityKeyInput[];
}

export interface AuditIntegritySeal {
  readonly version: 1;
  readonly keyId: string;
  readonly eventHash: Uint8Array;
}

const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/u;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const OUTCOMES = new Set<AuditIntegrityEvent["outcome"]>(["Succeeded", "Denied", "Failed"]);
const MAX_CANONICAL_BYTES = 65_536;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_ENTRIES = 10_000;

const requireKey = (input: AuditIntegrityKeyInput): AuditIntegrityKeyInput => {
  if (!KEY_ID_PATTERN.test(input.id)) {
    throw new Error("Audit integrity key ID must contain 1 to 100 safe identifier characters.");
  }
  if (!(input.key instanceof Uint8Array) || input.key.length < 32 || input.key.length > 128) {
    throw new Error("Audit integrity keys must contain 32 to 128 bytes.");
  }
  return Object.freeze({ id: input.id, key: Uint8Array.from(input.key) });
};

const requireBoundedString = (value: string, maximum: number, field: string): string => {
  let containsControlCharacter = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) as number;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      containsControlCharacter = true;
      break;
    }
  }
  if (value.length < 1 || value.length > maximum || containsControlCharacter) {
    throw new Error(`${field} must contain 1 to ${String(maximum)} non-control characters.`);
  }
  return value;
};

const requireDigest = (value: Uint8Array | undefined, field: string): string | null => {
  if (value === undefined) {
    return null;
  }
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${field} must contain exactly 32 bytes.`);
  }
  return encodeBase64Url(value);
};

interface CanonicalJsonBudget {
  entries: number;
}

const canonicalJson = (
  value: AuditIntegrityValue,
  budget: CanonicalJsonBudget,
  depth = 0,
): string => {
  if (depth > MAX_JSON_DEPTH) {
    throw new Error("Audit details exceed the supported nesting depth.");
  }
  budget.entries += 1;
  if (budget.entries > MAX_JSON_ENTRIES) {
    throw new Error("Audit details contain too many values.");
  }

  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Audit details may contain only finite numbers.");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries = value as readonly AuditIntegrityValue[];
    return `[${entries.map((entry) => canonicalJson(entry, budget, depth + 1)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1));
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(requireBoundedString(key, 200, "Audit detail key"))}:${canonicalJson(
          entry,
          budget,
          depth + 1,
        )}`,
    )
    .join(",")}}`;
};

const canonicalEvent = (event: AuditIntegrityEvent, keyId: string): Uint8Array => {
  if (event.sequence < 1n || event.sequence > 9_223_372_036_854_775_807n) {
    throw new Error("Audit sequence must fit a positive PostgreSQL bigint.");
  }
  const occurredAt = event.occurredAt.getTime();
  if (!Number.isFinite(occurredAt)) {
    throw new Error("Audit occurrence time must be a valid instant.");
  }
  if (!OUTCOMES.has(event.outcome)) {
    throw new Error("Audit outcome is not supported.");
  }
  if (!CORRELATION_ID_PATTERN.test(event.correlationId)) {
    throw new Error("Audit correlation ID is invalid.");
  }

  const details = canonicalJson(event.details, { entries: 0 });
  const canonical = JSON.stringify([
    "stockcontrol.identity.audit",
    "1",
    keyId,
    event.sequence.toString(),
    requireBoundedString(event.id, 100, "Audit event ID"),
    new Date(occurredAt).toISOString(),
    requireBoundedString(event.eventType, 100, "Audit event type"),
    event.outcome,
    event.actorUserId ?? "",
    event.subjectUserId ?? "",
    event.sessionId ?? "",
    event.correlationId,
    requireDigest(event.remoteAddressHash, "Audit remote-address hash") ?? "",
    requireDigest(event.previousEventHash, "Previous audit event hash") ?? "",
    details,
  ]);
  const encoded = utf8(canonical);
  if (encoded.length > MAX_CANONICAL_BYTES) {
    throw new Error("Canonical audit event exceeds 65,536 bytes.");
  }
  return encoded;
};

export class HmacIdentityAuditIntegrity {
  private readonly activeKeyId: string;
  private readonly keys: ReadonlyMap<string, Uint8Array>;

  public constructor(input: AuditIntegrityKeyringInput) {
    const keys = [requireKey(input.active), ...(input.retained ?? []).map(requireKey)];
    if (new Set(keys.map(({ id }) => id)).size !== keys.length) {
      throw new Error("Audit integrity key IDs must be unique.");
    }
    this.activeKeyId = input.active.id;
    this.keys = new Map(keys.map(({ id, key }) => [id, key]));
  }

  public seal(event: AuditIntegrityEvent): AuditIntegritySeal {
    const key = this.keys.get(this.activeKeyId) as Uint8Array;
    const eventHash = createHmac("sha256", key)
      .update(canonicalEvent(event, this.activeKeyId))
      .digest();
    return Object.freeze({
      version: 1,
      keyId: this.activeKeyId,
      eventHash: new Uint8Array(eventHash),
    });
  }

  public verify(event: AuditIntegrityEvent, seal: AuditIntegritySeal): boolean {
    const runtimeVersion: unknown = seal.version;
    if (runtimeVersion !== 1 || seal.eventHash.length !== 32) {
      return false;
    }
    const key = this.keys.get(seal.keyId);
    if (key === undefined) {
      return false;
    }
    const expected = createHmac("sha256", key).update(canonicalEvent(event, seal.keyId)).digest();
    return constantTimeEqual(new Uint8Array(expected), seal.eventHash);
  }
}
