import { SetMetadata } from "@nestjs/common";

import { PUBLIC_ROUTE } from "./auth.guard";

/**
 * Opts a route out of the global authentication guard. Every use is a
 * deliberate decision to expose something unauthenticated, so it should be
 * obvious in review: today that is sign-in, sign-out, the session probe and the
 * health endpoints an operator or load balancer needs before signing in.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_ROUTE, true);
