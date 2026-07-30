import { Body, Controller, Get, Header, Inject, Post, Req, Res } from "@nestjs/common";
import {
  authenticationRequired,
  capabilitiesForRole,
  validationFailed,
  type SessionResponse,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyReply, FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { bodyOf } from "../inventory/request-parsing";
import { readSessionCookie } from "./auth.guard";
import { Public } from "./public.decorator";
import { sessionOf } from "./request-context";
import { SESSION_COOKIE, SESSION_HOURS, type SessionService } from "./session-service";

interface SessionWithCapabilities extends SessionResponse {
  readonly capabilities: readonly string[];
}

@Controller("auth")
export class AuthController {
  public constructor(
    @Inject(API_TOKENS.sessionService)
    private readonly sessions: SessionService,
  ) {}

  @Get("session")
  @Public()
  @Header("cache-control", "no-store")
  public session(@Req() request: FastifyRequest): SessionWithCapabilities {
    const session = sessionOf(request);

    if (session === undefined) {
      throw new ApplicationFailureException(
        authenticationRequired({ detail: "No active session." }),
      );
    }

    return { session, capabilities: capabilitiesForRole(session.user.role) };
  }

  @Post("sign-in")
  @Public()
  @Header("cache-control", "no-store")
  public async signIn(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionWithCapabilities> {
    const body = bodyOf(rawBody);
    const email = typeof body["email"] === "string" ? body["email"] : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";

    if (email.trim().length === 0 || password.length === 0) {
      throw new ApplicationFailureException(
        validationFailed({
          ...(email.trim().length === 0 ? { email: ["Enter your email address."] } : {}),
          ...(password.length === 0 ? { password: ["Enter your password."] } : {}),
        }),
      );
    }

    const outcome = await this.sessions.signIn(email, password);

    if (outcome === null) {
      /*
       * One message for a wrong password, an unknown account and a disabled
       * account: the client is not told which.
       */
      throw new ApplicationFailureException(
        authenticationRequired({ detail: "Those sign-in details were not recognised." }),
      );
    }

    reply.setCookie(SESSION_COOKIE, outcome.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env["NODE_ENV"] === "production",
      maxAge: SESSION_HOURS * 3_600,
    });

    return {
      session: outcome.session,
      capabilities: capabilitiesForRole(outcome.session.user.role),
    };
  }

  @Post("sign-out")
  @Public()
  @Header("cache-control", "no-store")
  public async signOut(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly signedOut: true }> {
    const sessionId = readSessionCookie(request);

    if (sessionId !== undefined) {
      await this.sessions.signOut(sessionId);
    }

    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { signedOut: true };
  }
}
