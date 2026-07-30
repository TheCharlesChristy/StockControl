import {
  authenticationRequired,
  permissionDenied,
  recentAuthenticationRequired,
  validationFailed,
  failed,
  succeeded,
  type ApplicationResult,
} from "./application-failures";
import type { ApiPermissionSetting, ApiUserRole, AuthenticationAssuranceLevel } from "./identity";

/**
 * The shared current-actor, effective-capability, contextual-authorisation,
 * recent-authentication, reason, represented-user, and override context every
 * application command builds before it evaluates a business rule.
 *
 * This lives in `@stockcontrol/contracts` rather than inside one module: every
 * module's application layer needs it, and modules cannot import each other's
 * internals. Each module still owns its own capability catalogue and
 * contextual rules (item, job, van, approval-limit) and resolves them to the
 * plain booleans and provenance this file operates on; this file owns only the
 * host-independent combination and precondition logic that is identical for
 * every command.
 */

export type CapabilityProvenance = "ExplicitDeny" | "ExplicitAllow" | "RoleDefault";

export interface CapabilityDecision {
  readonly allowed: boolean;
  readonly provenance: CapabilityProvenance;
}

export interface CapabilityGrant {
  readonly roleDefaultAllowed: boolean;
  readonly setting: ApiPermissionSetting;
}

/**
 * Resolves one capability the way every role/permission model in this product
 * must: an explicit Deny always wins, then an explicit Allow, then the role
 * default. This is the same order documented for Identity's per-user
 * permission settings, generalised so any module's capability model can reuse
 * it without depending on Identity's capability catalogue.
 */
export const resolveCapabilityDecision = (grant: CapabilityGrant): CapabilityDecision => {
  if (grant.setting === "Deny") {
    return Object.freeze({ allowed: false, provenance: "ExplicitDeny" });
  }

  if (grant.setting === "Allow") {
    return Object.freeze({ allowed: true, provenance: "ExplicitAllow" });
  }

  return Object.freeze({ allowed: grant.roleDefaultAllowed, provenance: "RoleDefault" });
};

export interface ContextualRule {
  /** A stable, human-readable name for the rule, used only for diagnostics. */
  readonly name: string;
  readonly allowed: boolean;
  /** True when this specific denial can never be satisfied by an override. */
  readonly nonOverrideable?: boolean;
}

export interface AuthorisationDecision {
  readonly allowed: boolean;
  readonly nonOverrideable: boolean;
  /** "capability" or the name of the contextual rule that denied the action. */
  readonly deniedBy?: string;
}

/**
 * Combines the resolved capability with a module's contextual rules in the
 * product's documented order: explicit Deny/effective capability first, then
 * contextual item/job/van rules. A capability denial is checked first and is
 * always overrideable at this layer; a contextual rule may mark its own
 * denial non-overrideable (final-Admin protection, self-approval, and similar
 * rules already enforce this in their owning domain policy and surface it
 * here only so the override step can see it).
 */
export const evaluateContextualAuthorisation = (
  capability: CapabilityDecision,
  contextualRules: readonly ContextualRule[] = [],
): AuthorisationDecision => {
  if (!capability.allowed) {
    return Object.freeze({ allowed: false, nonOverrideable: false, deniedBy: "capability" });
  }

  const denied = contextualRules.find((rule) => !rule.allowed);

  if (denied === undefined) {
    return Object.freeze({ allowed: true, nonOverrideable: false });
  }

  return Object.freeze({
    allowed: false,
    nonOverrideable: denied.nonOverrideable === true,
    deniedBy: denied.name,
  });
};

export const MAXIMUM_COMMAND_REASON_CHARACTERS = 500;

export type CommandContextErrorCode = "ReasonInvalid" | "InstantInvalid";

export class CommandContextError extends Error {
  public constructor(
    public readonly code: CommandContextErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommandContextError";
  }
}

const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) as number;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });

const isValidReasonText = (reason: string): boolean => {
  const trimmed = reason.trim();
  return (
    trimmed.length >= 1 &&
    trimmed.length <= MAXIMUM_COMMAND_REASON_CHARACTERS &&
    !containsControlCharacter(trimmed)
  );
};

/**
 * Validates a mandatory-reason safeguard. Omitting the reason is only
 * accepted when the command does not require one; a reason that is present
 * but blank, over-long, or control-character bearing is always rejected,
 * required or not, since a caller that supplies one is expected to supply a
 * usable one.
 */
export const validateCommandReason = (
  reason: string | undefined,
  required: boolean,
): string | undefined => {
  if (reason === undefined) {
    if (required) {
      throw new CommandContextError("ReasonInvalid", "A reason is required for this action.");
    }

    return undefined;
  }

  if (!isValidReasonText(reason)) {
    throw new CommandContextError(
      "ReasonInvalid",
      `A reason must contain 1-${String(MAXIMUM_COMMAND_REASON_CHARACTERS)} printable characters.`,
    );
  }

  return reason.trim();
};

export interface OverrideRequest {
  readonly requested: boolean;
  readonly reason?: string | undefined;
}

export interface OverrideEvaluation {
  readonly applied: boolean;
  readonly reason?: string;
}

const NOT_APPLIED: OverrideEvaluation = Object.freeze({ applied: false });

/**
 * Applies a reasoned Admin override to a denied decision. An override can
 * never satisfy a decision already marked non-overrideable, an actor without
 * override capability, an unrequested override, or one missing a usable
 * reason. A decision that is already allowed has nothing to override.
 */
export const evaluateOverride = (
  decision: AuthorisationDecision,
  actorCanOverride: boolean,
  request: OverrideRequest = { requested: false },
): OverrideEvaluation => {
  if (
    decision.allowed ||
    decision.nonOverrideable ||
    !request.requested ||
    !actorCanOverride ||
    request.reason === undefined ||
    !isValidReasonText(request.reason)
  ) {
    return NOT_APPLIED;
  }

  return Object.freeze({ applied: true, reason: request.reason.trim() });
};

/**
 * Compares two trusted, host-supplied instants (a session's last-authenticated
 * time and the current request time). Both are already validated at their
 * origin, so an invalid value here indicates a defect in the caller rather
 * than untrusted input.
 */
export const isRecentlyAuthenticated = (
  authenticatedAt: string,
  nowIso: string,
  requiredSeconds: number,
): boolean => {
  const authenticated = Date.parse(authenticatedAt);
  const now = Date.parse(nowIso);

  if (!Number.isFinite(authenticated) || !Number.isFinite(now)) {
    throw new CommandContextError(
      "InstantInvalid",
      "Recent-authentication comparison requires valid instants.",
    );
  }

  if (!Number.isSafeInteger(requiredSeconds) || requiredSeconds < 0) {
    throw new CommandContextError(
      "InstantInvalid",
      "Recent-authentication window must be a non-negative integer of seconds.",
    );
  }

  return authenticated <= now && now - authenticated <= requiredSeconds * 1_000;
};

export interface CommandActor {
  readonly userId: string;
  readonly role: ApiUserRole;
  readonly assurance: AuthenticationAssuranceLevel;
  /** The instant this actor's session last completed a full authentication. */
  readonly authenticatedAt: string;
}

export interface CommandAuthorizationRequest {
  /** Undefined for an unauthenticated caller. */
  readonly actor?: CommandActor | undefined;
  /**
   * The user this command acts on behalf of. Defaults to the actor. When it
   * differs, `representedUserAuthorized` must be true — resolved by the host
   * from the owning module's specific "act on behalf" capability.
   */
  readonly representedUserId?: string;
  readonly representedUserAuthorized?: boolean;
  readonly capability: CapabilityGrant;
  readonly contextualRules?: readonly ContextualRule[];
  readonly actorCanOverride?: boolean;
  readonly override?: OverrideRequest;
  readonly reasonRequired?: boolean;
  readonly reason?: string | undefined;
  /** Omit when the command has no recent-authentication safeguard. */
  readonly recentAuthenticationRequiredSeconds?: number;
  readonly nowIso: string;
}

export interface CommandAuthorizationContext {
  readonly actorUserId: string;
  readonly representedUserId: string;
  readonly role: ApiUserRole;
  readonly capability: CapabilityDecision;
  readonly authorisation: AuthorisationDecision;
  readonly override: OverrideEvaluation;
  readonly reason?: string;
  readonly recentlyAuthenticated: boolean;
}

/**
 * Builds the complete context an application command needs, or the first
 * applicable failure. Nothing here mutates state; a command must not begin
 * its transaction until this returns a succeeded result.
 *
 * Checks run in this order: actor presence, represented-user authorisation,
 * capability/contextual/override authorisation, recent authentication, then
 * the mandatory-reason safeguard. Each guard fails independently of the
 * others, so a missing actor, unmet recent-authentication requirement, or
 * missing reason each stop the command before any business rule runs.
 */
export const buildCommandAuthorizationContext = (
  request: CommandAuthorizationRequest,
): ApplicationResult<CommandAuthorizationContext> => {
  const { actor } = request;

  if (actor === undefined) {
    return failed(authenticationRequired());
  }

  const representedUserId = request.representedUserId ?? actor.userId;

  if (representedUserId !== actor.userId && request.representedUserAuthorized !== true) {
    return failed(
      permissionDenied({
        code: "command.represented_user_not_authorized",
        detail: "You are not permitted to act on behalf of another user for this action.",
      }),
    );
  }

  const capability = resolveCapabilityDecision(request.capability);
  const authorisation = evaluateContextualAuthorisation(capability, request.contextualRules ?? []);
  const override = evaluateOverride(
    authorisation,
    request.actorCanOverride ?? false,
    request.override ?? { requested: false },
  );

  if (!authorisation.allowed && !override.applied) {
    return failed(permissionDenied());
  }

  const { recentAuthenticationRequiredSeconds } = request;
  const recentAuthenticationNeeded = recentAuthenticationRequiredSeconds !== undefined;
  const recentlyAuthenticated = recentAuthenticationNeeded
    ? isRecentlyAuthenticated(
        actor.authenticatedAt,
        request.nowIso,
        recentAuthenticationRequiredSeconds,
      )
    : true;

  if (recentAuthenticationNeeded && !recentlyAuthenticated) {
    return failed(recentAuthenticationRequired());
  }

  let reason: string | undefined;

  try {
    reason = validateCommandReason(request.reason, request.reasonRequired ?? false);
  } catch (error) {
    // `validateCommandReason` only ever throws `CommandContextError`.
    return failed(validationFailed({ reason: [(error as CommandContextError).message] }));
  }

  return succeeded(
    Object.freeze({
      actorUserId: actor.userId,
      representedUserId,
      role: actor.role,
      capability,
      authorisation,
      override,
      ...(reason === undefined ? {} : { reason }),
      recentlyAuthenticated,
    }),
  );
};
