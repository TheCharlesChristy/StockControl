import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { permissionDenied } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";
import type { FastifyRequest } from "fastify";

import { ORIGIN_EXEMPT_ROUTE } from "./public.decorator";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface RequestOriginEnvironment {
  readonly NODE_ENV?: string;
  readonly PUBLIC_APP_ORIGIN?: string;
}

const invalidOrigin = (message: string): Error =>
  new Error(`Invalid PUBLIC_APP_ORIGIN: ${message}`);

/**
 * Returns the single browser origin allowed to make state-changing requests.
 * Production deliberately has no inferred fallback: an explicit value avoids
 * trusting a spoofable Host header at the application's security boundary.
 */
export function loadPublicAppOrigin(
  environment: RequestOriginEnvironment = process.env,
): string | null {
  const configured = environment.PUBLIC_APP_ORIGIN?.trim();

  if (!configured) {
    if (environment.NODE_ENV === "production") {
      throw invalidOrigin("set it to the public HTTPS origin before starting production.");
    }

    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw invalidOrigin("use an absolute http:// or https:// URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidOrigin("only http:// and https:// origins are supported.");
  }

  if (
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw invalidOrigin("provide an origin only, without credentials, a path, query, or fragment.");
  }

  if (environment.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw invalidOrigin("production must use https://.");
  }

  return parsed.origin;
}

export function isRequestOriginAllowed(
  method: string,
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  allowedOrigin: string | null,
): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) {
    return true;
  }

  const fetchSite = headers["sec-fetch-site"];
  if (fetchSite === "cross-site") {
    return false;
  }

  /* Local tests and non-production tools can operate without an Origin. */
  if (allowedOrigin === null) {
    return true;
  }

  const origin = headers["origin"];
  return typeof origin === "string" && origin === allowedOrigin;
}

/** Protects the cookie-authenticated API from cross-site state changes. */
export class RequestOriginGuard implements CanActivate {
  public constructor(
    private readonly allowedOrigin: string | null,
    private readonly reflector?: Reflector,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (
      this.reflector?.getAllAndOverride<boolean>(ORIGIN_EXEMPT_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    if (isRequestOriginAllowed(request.method, request.headers, this.allowedOrigin)) {
      return true;
    }

    throw new ApplicationFailureException(
      permissionDenied({
        code: "auth.request_origin_denied",
        detail: "This request did not come from the StockControl application.",
      }),
    );
  }
}
