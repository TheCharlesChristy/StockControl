import {
  Body,
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from "@nestjs/common";
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
import {
  SECURE_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_HOURS,
  type SessionService,
} from "./session-service";
import type { SignInRateLimiter } from "./sign-in-rate-limiter";

interface SessionWithCapabilities extends SessionResponse {
  readonly capabilities: readonly string[];
}

@Controller("auth")
export class AuthController {
  public constructor(
    @Inject(API_TOKENS.sessionService)
    private readonly sessions: SessionService,
    @Inject(API_TOKENS.signInRateLimiter)
    private readonly signInRateLimiter: SignInRateLimiter,
    /*
     * The validated public origin, not NODE_ENV. The scheme the browser will
     * actually use is the thing that decides whether a Secure cookie can be
     * sent at all, and it is already checked at startup — production is
     * required to be https there, so this cannot silently be false in a
     * deployment that needs it true.
     */
    @Inject(API_TOKENS.publicAppOrigin)
    private readonly publicAppOrigin: string | null,
  ) {}

  private get cookieIsSecure(): boolean {
    return this.publicAppOrigin?.startsWith("https://") ?? false;
  }

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
    @Req() request: FastifyRequest,
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

    const rateLimit = this.signInRateLimiter.check(email, request.ip);
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds ?? 1));
      throw new HttpException(
        "Too many sign-in attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const outcome = await this.sessions.signIn(email, password);

    if (outcome === null) {
      this.signInRateLimiter.recordFailure(email, request.ip);
      /*
       * One message for a wrong password, an unknown account and a disabled
       * account: the client is not told which.
       */
      throw new ApplicationFailureException(
        authenticationRequired({ detail: "Those sign-in details were not recognised." }),
      );
    }

    this.signInRateLimiter.recordSuccess(email);

    const secure = this.cookieIsSecure;

    reply.setCookie(secure ? SECURE_SESSION_COOKIE : SESSION_COOKIE, outcome.sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
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

    /* Both names, so signing out also clears a cookie issued before the rename. */
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    reply.clearCookie(SECURE_SESSION_COOKIE, { path: "/", secure: this.cookieIsSecure });
    return { signedOut: true };
  }
}
