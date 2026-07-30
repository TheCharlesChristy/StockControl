import {
  createAuthenticationRateLimitRule,
  DEFAULT_AUTHENTICATION_RATE_LIMITS,
  type AuthenticationRateLimitRule,
  type AuthenticationRateLimitScope,
} from "../policies/rate-limit-policy";
import {
  createIdentitySecurityPolicy,
  DEFAULT_IDENTITY_SECURITY_POLICY,
  type IdentitySecurityPolicy,
} from "../policies/authentication-policy";
import { IdentityPortError } from "./security";

/**
 * Non-secret installation facts. One StockControl deployment serves exactly
 * one customer installation, so this identity binds encrypted delivery
 * material to the installation that produced it.
 */
export interface IdentityInstallation {
  /** Stable, non-secret, URL-safe identifier for this installation. */
  readonly installationId: string;
  /** Customer-facing name used as the TOTP issuer label. */
  readonly displayName: string;
  /** Absolute HTTPS origin used to build invitation and reset links. */
  readonly baseUrl: string;
}

const INSTALLATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MAXIMUM_DISPLAY_NAME_CHARACTERS = 200;

const requireHttpsOrigin = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new IdentityPortError(
      "InstallationInvalid",
      "The installation base URL must be an absolute URL.",
    );
  }

  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    url.pathname !== "/"
  ) {
    throw new IdentityPortError(
      "InstallationInvalid",
      "The installation base URL must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }

  return url.origin;
};

export const createIdentityInstallation = (input: IdentityInstallation): IdentityInstallation => {
  if (!INSTALLATION_ID_PATTERN.test(input.installationId)) {
    throw new IdentityPortError(
      "InstallationInvalid",
      "The installation ID must be 1-64 lowercase URL-safe characters.",
    );
  }

  const displayName = input.displayName.trim();

  if (displayName.length < 1 || displayName.length > MAXIMUM_DISPLAY_NAME_CHARACTERS) {
    throw new IdentityPortError(
      "InstallationInvalid",
      `The installation display name must contain 1-${String(MAXIMUM_DISPLAY_NAME_CHARACTERS)} characters.`,
    );
  }

  return Object.freeze({
    installationId: input.installationId,
    displayName,
    baseUrl: requireHttpsOrigin(input.baseUrl),
  });
};

/**
 * Supplies the configuration an Identity use case may read without touching a
 * transaction. Administrator-configured session limits still come from the
 * security-policy repository; these are the deployment defaults and the
 * non-configurable rate-limit rules.
 */
export interface IdentityPolicyProvider {
  installation(): IdentityInstallation;
  securityPolicyDefaults(): IdentitySecurityPolicy;
  rateLimitRule(scope: AuthenticationRateLimitScope): AuthenticationRateLimitRule;
}

export class DefaultIdentityPolicyProvider implements IdentityPolicyProvider {
  readonly #installation: IdentityInstallation;
  readonly #securityPolicy: IdentitySecurityPolicy;

  public constructor(
    installation: IdentityInstallation,
    securityPolicy: IdentitySecurityPolicy = DEFAULT_IDENTITY_SECURITY_POLICY,
  ) {
    this.#installation = createIdentityInstallation(installation);
    this.#securityPolicy = createIdentitySecurityPolicy(securityPolicy);
  }

  public installation(): IdentityInstallation {
    return this.#installation;
  }

  public securityPolicyDefaults(): IdentitySecurityPolicy {
    return this.#securityPolicy;
  }

  public rateLimitRule(scope: AuthenticationRateLimitScope): AuthenticationRateLimitRule {
    return createAuthenticationRateLimitRule(DEFAULT_AUTHENTICATION_RATE_LIMITS[scope]);
  }
}
