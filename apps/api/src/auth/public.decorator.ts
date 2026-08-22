import { SetMetadata } from "@nestjs/common";

import { PUBLIC_ROUTE } from "./auth.guard";

export const ORIGIN_EXEMPT_ROUTE = "stockcontrol:origin-exempt-route";

/**
 * Opts a route out of the global authentication guard. Every use is a
 * deliberate decision to expose something unauthenticated, so it should be
 * obvious in review: today that is sign-in, sign-out, the session probe and the
 * health endpoints an operator or load balancer needs before signing in.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);

/**
 * Marks a machine-to-machine OAuth/MCP route whose POST requests do not carry
 * the browser's StockControl origin. This is intentionally separate from
 * `Public`: a public browser route still remains behind the origin guard.
 */
export const OriginExempt = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ORIGIN_EXEMPT_ROUTE, true);
