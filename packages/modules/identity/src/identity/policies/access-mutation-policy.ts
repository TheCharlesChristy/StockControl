import type { UserId } from "../value-objects";

export const accessMutationKinds = ["Role", "Status", "Permissions"] as const;

export type AccessMutationKind = (typeof accessMutationKinds)[number];

export interface AccessMutationPolicyInput {
  readonly actorUserId: UserId;
  readonly targetUserId: UserId;
  readonly mutationKinds: readonly AccessMutationKind[];
}

export interface AccessMutationAllowed {
  readonly allowed: true;
}

export interface SelfAccessMutationForbidden {
  readonly allowed: false;
  readonly code: "SelfAccessMutationForbidden";
  readonly forbiddenKinds: readonly AccessMutationKind[];
  readonly nonOverrideable: true;
}

export type AccessMutationDecision = AccessMutationAllowed | SelfAccessMutationForbidden;

const allowedDecision: AccessMutationAllowed = Object.freeze({ allowed: true });

export function evaluateAccessMutationPolicy(
  input: AccessMutationPolicyInput,
): AccessMutationDecision {
  const forbiddenKinds = accessMutationKinds.filter((kind) => input.mutationKinds.includes(kind));

  if (input.actorUserId !== input.targetUserId || forbiddenKinds.length === 0) {
    return allowedDecision;
  }

  return Object.freeze({
    allowed: false,
    code: "SelfAccessMutationForbidden",
    forbiddenKinds: Object.freeze(forbiddenKinds),
    nonOverrideable: true,
  });
}
