import type { UserRole } from "../role-templates";
import type { UserId } from "../value-objects";
import { createSha256Digest, type IdentityAssuranceLevel, type Sha256Digest } from "./persistence";
import { IdentityPortError } from "./security";

/**
 * Trusted request facts.
 *
 * Every actor and network fact is derived by the host from the authenticated
 * session and the transport connection. A command body can never contribute
 * one, so a caller cannot impersonate another user, forge an audit actor, or
 * poison a rate-limit bucket by adding fields to a JSON payload.
 */

export const MAXIMUM_USER_AGENT_CHARACTERS = 256;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

export interface IdentityNetworkFacts {
  /**
   * A salted digest of the remote address. The raw address is never accepted,
   * so no persistent device or address fingerprint can be stored.
   */
  readonly remoteAddressHash?: Sha256Digest;
  /** Bounded, control-character-free user agent retained for session display. */
  readonly userAgent?: string;
}

export interface IdentityNetworkFactsInput {
  readonly remoteAddressHash?: Uint8Array;
  readonly userAgent?: string;
}

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

export const createIdentityNetworkFacts = (
  input: IdentityNetworkFactsInput = {},
): IdentityNetworkFacts => {
  let remoteAddressHash: Sha256Digest | undefined;

  if (input.remoteAddressHash !== undefined) {
    try {
      remoteAddressHash = createSha256Digest(input.remoteAddressHash);
    } catch {
      throw new IdentityPortError(
        "NetworkFactInvalid",
        "A remote address must be supplied as a 32-byte digest, never as a raw address.",
      );
    }
  }

  let userAgent: string | undefined;

  if (input.userAgent !== undefined) {
    const trimmed = input.userAgent.trim();

    if (
      trimmed.length < 1 ||
      trimmed.length > MAXIMUM_USER_AGENT_CHARACTERS ||
      containsControlCharacter(trimmed)
    ) {
      throw new IdentityPortError(
        "NetworkFactInvalid",
        `A user agent must contain 1-${String(MAXIMUM_USER_AGENT_CHARACTERS)} printable characters.`,
      );
    }

    userAgent = trimmed;
  }

  return Object.freeze({
    ...(remoteAddressHash === undefined ? {} : { remoteAddressHash }),
    ...(userAgent === undefined ? {} : { userAgent }),
  });
};

export interface AnonymousIdentityActor {
  readonly kind: "Anonymous";
}

export interface SessionIdentityActor {
  readonly kind: "Session";
  readonly userId: UserId;
  readonly sessionId: string;
  readonly role: UserRole;
  readonly assuranceLevel: IdentityAssuranceLevel;
  /** The instant the session last completed a full authentication. */
  readonly authenticatedAt: Date;
}

export type IdentityActor = AnonymousIdentityActor | SessionIdentityActor;

export const anonymousIdentityActor: AnonymousIdentityActor = Object.freeze({ kind: "Anonymous" });

export interface IdentityRequestContext {
  readonly actor: IdentityActor;
  readonly correlationId: string;
  readonly network: IdentityNetworkFacts;
}

export interface IdentityRequestContextInput {
  readonly actor: IdentityActor;
  readonly correlationId: string;
  readonly network?: IdentityNetworkFactsInput;
}

export const createIdentityRequestContext = (
  input: IdentityRequestContextInput,
): IdentityRequestContext => {
  if (!CORRELATION_ID_PATTERN.test(input.correlationId)) {
    throw new IdentityPortError(
      "RequestContextInvalid",
      "A correlation ID must contain 1-128 safe identifier characters.",
    );
  }

  if (input.actor.kind === "Session" && !SESSION_ID_PATTERN.test(input.actor.sessionId)) {
    throw new IdentityPortError(
      "RequestContextInvalid",
      "A session ID must contain 1-128 safe identifier characters.",
    );
  }

  if (input.actor.kind === "Session" && !Number.isFinite(input.actor.authenticatedAt.getTime())) {
    throw new IdentityPortError(
      "RequestContextInvalid",
      "A session actor must carry a valid authentication instant.",
    );
  }

  return Object.freeze({
    actor: Object.freeze({ ...input.actor }),
    correlationId: input.correlationId,
    network: createIdentityNetworkFacts(input.network),
  });
};

/** Resolves the trusted context for the request currently being handled. */
export interface IdentityRequestContextProvider {
  current(): IdentityRequestContext;
}

/**
 * Field names that identify the actor, the session, the transport, or the
 * installation. A command body containing any of them is rejected rather than
 * silently ignored, so an attempt to supply one is visible during development
 * and cannot become a trusted fact by accident.
 */
export const untrustedActorFactNames: readonly string[] = Object.freeze([
  "actor",
  "actoruserid",
  "authenticatedat",
  "correlationid",
  "installationid",
  "ip",
  "ipaddress",
  "remoteaddress",
  "remoteaddresshash",
  "role",
  "sessionid",
  "useragent",
  "userid",
]);

const untrustedActorFactSet = new Set(untrustedActorFactNames);

/**
 * Rejects a command body that tries to supply an actor, session, network, or
 * installation fact. Call this at the transport boundary before mapping a
 * request body onto a command.
 */
export const assertNoUntrustedActorFacts = (commandBody: unknown): void => {
  if (typeof commandBody !== "object" || commandBody === null || Array.isArray(commandBody)) {
    return;
  }

  const offending = Object.keys(commandBody)
    .filter((key) => untrustedActorFactSet.has(key.toLowerCase()))
    .sort();

  if (offending.length > 0) {
    throw new IdentityPortError(
      "UntrustedActorFact",
      `Actor, session, network, and installation facts cannot come from a command body: ${offending.join(", ")}.`,
    );
  }
};
