import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { authenticationRequired } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import { attachSession } from "./request-context";
import { SESSION_COOKIE, type SessionService } from "./session-service";

export const PUBLIC_ROUTE = "stockcontrol:public-route";

/**
 * The cookie plugin populates `cookies`, but a unit test may build a request
 * without it, so this reads defensively rather than trusting the augmented type.
 */
interface MaybeCookies {
  readonly cookies?: Readonly<Record<string, string | undefined>> | undefined;
}

export function readSessionCookie(request: FastifyRequest): string | undefined {
  const { cookies } = request as unknown as MaybeCookies;

  return cookies?.[SESSION_COOKIE];
}

/**
 * Authenticates every request unless the handler is explicitly marked public.
 * Defaulting to closed means a new route is protected before anyone remembers
 * to protect it.
 */
export class AuthenticationGuard implements CanActivate {
  public constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const sessionId = readSessionCookie(request);

    if (sessionId !== undefined) {
      const session = await this.sessions.resolve(sessionId);

      if (session !== null) {
        attachSession(request, session);
        return true;
      }
    }

    if (isPublic === true) {
      return true;
    }

    throw new ApplicationFailureException(
      authenticationRequired({ detail: "Sign in to continue." }),
    );
  }
}
