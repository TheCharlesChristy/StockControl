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
  passwordPolicyErrors,
  validationFailed,
  type SessionResponse,
} from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyReply, FastifyRequest } from "fastify";

import { API_TOKENS } from "../api.tokens";
import { bodyOf } from "../inventory/request-parsing";
import { isStockCaptureEnabled } from "../stock-capture/capture-configuration";
import { readSessionCookie } from "./auth.guard";
import { hashPassword } from "./password";
import { Public } from "./public.decorator";
import { currentUser, sessionOf } from "./request-context";
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

    return {
      session,
      capabilities: capabilitiesForRole(session.user.role),
      features: { stockCapture: isStockCaptureEnabled() },
    };
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
    const username = typeof body["username"] === "string" ? body["username"] : "";
    const password = typeof body["password"] === "string" ? body["password"] : "";

    if (username.trim().length === 0 || password.length === 0) {
      throw new ApplicationFailureException(
        validationFailed({
          ...(username.trim().length === 0 ? { username: ["Enter your username."] } : {}),
          ...(password.length === 0 ? { password: ["Enter your password."] } : {}),
        }),
      );
    }

    const rateLimit = this.signInRateLimiter.check(username, request.ip);
    if (!rateLimit.allowed) {
      reply.header("retry-after", String(rateLimit.retryAfterSeconds ?? 1));
      throw new HttpException(
        "Too many sign-in attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const outcome = await this.sessions.signIn(username, password);

    if (outcome === null) {
      this.signInRateLimiter.recordFailure(username, request.ip);
      /*
       * One message for a wrong password, an unknown account and a disabled
       * account: the client is not told which.
       */
      throw new ApplicationFailureException(
        authenticationRequired({ detail: "Those sign-in details were not recognised." }),
      );
    }

    this.signInRateLimiter.recordSuccess(username);

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
      features: { stockCapture: isStockCaptureEnabled() },
    };
  }

  /**
   * Changing your own password, which is the only way an ordinary user can.
   *
   * Requires the current password, so a borrowed session cannot be used to lock
   * the real owner out, and ends every other session, so a password changed
   * because somebody else may have had it actually takes the account back.
   */
  @Post("password")
  @Header("cache-control", "no-store")
  public async changePassword(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ): Promise<{ readonly changed: true }> {
    const user = currentUser(request);
    const body = bodyOf(rawBody);
    const currentPassword =
      typeof body["currentPassword"] === "string" ? body["currentPassword"] : "";
    const newPassword = typeof body["newPassword"] === "string" ? body["newPassword"] : "";

    if (currentPassword.length === 0) {
      throw new ApplicationFailureException(
        validationFailed({ currentPassword: ["Enter your current password."] }),
      );
    }

    const policyErrors = passwordPolicyErrors(newPassword);
    if (policyErrors.length > 0) {
      throw new ApplicationFailureException(validationFailed({ newPassword: policyErrors }));
    }

    if (newPassword === currentPassword) {
      throw new ApplicationFailureException(
        validationFailed({ newPassword: ["Choose a password you have not used here before."] }),
      );
    }

    /*
     * Guessing the current password is guessing a password, so it is metered by
     * the same limiter as sign-in and against the same account.
     */
    const rateLimit = this.signInRateLimiter.check(user.username, request.ip);
    if (!rateLimit.allowed) {
      throw new HttpException(
        "Too many password attempts. Try again later.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const changed = await this.sessions.changeOwnPassword(
      user.id,
      currentPassword,
      await hashPassword(newPassword),
    );

    if (!changed) {
      this.signInRateLimiter.recordFailure(user.username, request.ip);
      throw new ApplicationFailureException(
        validationFailed({ currentPassword: ["That password was not recognised."] }),
      );
    }

    this.signInRateLimiter.recordSuccess(user.username);

    const sessionId = readSessionCookie(request);
    if (sessionId !== undefined) {
      await this.sessions.revokeAllForUserExcept(user.id, sessionId);
    }

    return { changed: true };
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
