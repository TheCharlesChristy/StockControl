import {
  authenticationRequired,
  permissionDenied,
  roleHasCapability,
  type AuthenticatedSession,
  type Capability,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import type { CurrentUser } from "./session-service";

/**
 * The authenticated session is attached to the request by the auth guard.
 * Handlers read it through these helpers so authorisation is never inferred
 * from anything the client sent.
 */

const SESSION_PROPERTY = "stockcontrolSession";

interface RequestWithSession extends FastifyRequest {
  [SESSION_PROPERTY]?: AuthenticatedSession;
}

export function attachSession(request: FastifyRequest, session: AuthenticatedSession): void {
  (request as RequestWithSession)[SESSION_PROPERTY] = session;
}

export function sessionOf(request: FastifyRequest): AuthenticatedSession | undefined {
  return (request as RequestWithSession)[SESSION_PROPERTY];
}

export function requireSession(request: FastifyRequest): AuthenticatedSession {
  const session = sessionOf(request);

  if (session === undefined) {
    throw new ApplicationFailureException(
      authenticationRequired({ detail: "Sign in to continue." }),
    );
  }

  return session;
}

export function currentUser(request: FastifyRequest): CurrentUser {
  return requireSession(request).user;
}

/**
 * The single authorisation gate. Every state-changing handler calls this before
 * doing anything else.
 */
export function requireCapability(request: FastifyRequest, capability: Capability): CurrentUser {
  const user = currentUser(request);

  if (!roleHasCapability(user.role, capability)) {
    throw new ApplicationFailureException(
      permissionDenied({ detail: `Your role cannot ${describe(capability)}.` }),
    );
  }

  return user;
}

/** True when the role may see what other people did, not just its own record. */
export function canViewAllActivity(request: FastifyRequest): boolean {
  return roleHasCapability(currentUser(request).role, "viewAllActivity");
}

const descriptions: Readonly<Record<Capability, string>> = {
  view: "view this",
  issue: "issue stock",
  reserve: "reserve stock",
  collect: "collect reserved stock",
  requestStock: "request stock",
  manageStock: "receive, transfer or adjust stock",
  manageCatalogue: "create or edit items and locations",
  manageJobs: "create, edit or close jobs",
  releaseReservation: "release a reservation",
  reviewStockRequests: "approve or reject stock requests",
  viewAllActivity: "see other people's activity",
  manageUsers: "manage users",
};

function describe(capability: Capability): string {
  return descriptions[capability];
}
