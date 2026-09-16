export interface McpConfiguration {
  readonly enabled: boolean;
  readonly readToolsEnabled: boolean;
  readonly writeToolsEnabled: boolean;
  readonly publicBaseUrl: string;
  readonly resourceUri: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly tokenHashKey: string;
  readonly accessTokenMinutes: number;
  readonly refreshTokenDays: number;
  readonly maxToolSeconds: number;
  readonly abandonedCallSeconds: number;
}

export interface McpEnvironment {
  readonly NODE_ENV?: string;
  readonly MCP_ENABLED?: string;
  readonly MCP_READ_TOOLS_ENABLED?: string;
  readonly MCP_WRITE_TOOLS_ENABLED?: string;
  readonly MCP_PUBLIC_BASE_URL?: string;
  readonly MCP_CLIENT_ID?: string;
  readonly MCP_REDIRECT_URI?: string;
  readonly MCP_TOKEN_HASH_KEY?: string;
  readonly MCP_ACCESS_TOKEN_MINUTES?: string;
  readonly MCP_REFRESH_TOKEN_DAYS?: string;
  readonly MCP_MAX_TOOL_SECONDS?: string;
  readonly MCP_ABANDONED_CALL_SECONDS?: string;
  readonly PUBLIC_APP_ORIGIN?: string;
}

const enabled = (value: string | undefined): boolean => value?.trim().toLowerCase() === "true";

const boundedInteger = (
  environment: McpEnvironment,
  name: keyof McpEnvironment,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const candidate = environment[name];
  if (candidate === undefined || candidate.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(candidate);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${String(name)} value: ${candidate}`);
  }

  return parsed;
};

const absoluteUrl = (
  value: string,
  name: string,
  production: boolean,
  originOnly = false,
): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid ${name}: use an absolute URL.`);
  }

  if (parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
    throw new Error(`Invalid ${name}: credentials and fragments are not allowed.`);
  }

  if (originOnly && (parsed.pathname !== "/" || parsed.search.length > 0)) {
    throw new Error(`Invalid ${name}: provide an origin only, without a path or query.`);
  }

  if (production && parsed.protocol !== "https:") {
    throw new Error(`Invalid ${name}: production must use https://.`);
  }

  return parsed.toString().replace(/\/$/u, "");
};

export const isMcpEnabled = (environment: McpEnvironment = process.env): boolean =>
  enabled(environment.MCP_ENABLED);

export const loadMcpConfiguration = (
  environment: McpEnvironment = process.env,
): McpConfiguration => {
  const production = environment.NODE_ENV === "production";
  const publicBaseUrl = absoluteUrl(
    environment.MCP_PUBLIC_BASE_URL?.trim() ||
      environment.PUBLIC_APP_ORIGIN?.trim() ||
      "http://localhost:3000",
    "MCP_PUBLIC_BASE_URL",
    production,
    true,
  );
  const clientId = environment.MCP_CLIENT_ID?.trim() || "stockcontrol-chatgpt";
  const redirectUriValue = environment.MCP_REDIRECT_URI?.trim();
  if (
    enabled(environment.MCP_ENABLED) &&
    (redirectUriValue === undefined || redirectUriValue.length === 0)
  ) {
    throw new Error("MCP_REDIRECT_URI must be set when MCP is enabled.");
  }
  const redirectUri = absoluteUrl(
    redirectUriValue || `${publicBaseUrl}/oauth/callback`,
    "MCP_REDIRECT_URI",
    production,
  );

  const tokenHashKey = environment.MCP_TOKEN_HASH_KEY?.trim() || undefined;
  if (
    enabled(environment.MCP_ENABLED) &&
    (tokenHashKey === undefined || tokenHashKey.length < 32)
  ) {
    throw new Error("MCP_TOKEN_HASH_KEY must contain at least 32 characters when MCP is enabled.");
  }

  if (clientId.length > 160) {
    throw new Error("MCP_CLIENT_ID must be 160 characters or fewer.");
  }

  const configuredAbandonedCallGrace = environment.MCP_ABANDONED_CALL_SECONDS?.trim();
  const hasExplicitAbandonedCallGrace =
    configuredAbandonedCallGrace !== undefined && configuredAbandonedCallGrace.length > 0;
  const maxToolSeconds = hasExplicitAbandonedCallGrace
    ? 30
    : boundedInteger(environment, "MCP_MAX_TOOL_SECONDS", 30, 5, 120);
  let abandonedCallSeconds = 300;
  if (hasExplicitAbandonedCallGrace) {
    abandonedCallSeconds = boundedInteger(environment, "MCP_ABANDONED_CALL_SECONDS", 300, 60, 900);
  } else if (environment.MCP_MAX_TOOL_SECONDS?.trim().length) {
    abandonedCallSeconds = maxToolSeconds * 4;
  }

  return {
    enabled: enabled(environment.MCP_ENABLED),
    readToolsEnabled: enabled(environment.MCP_READ_TOOLS_ENABLED),
    writeToolsEnabled: enabled(environment.MCP_WRITE_TOOLS_ENABLED),
    publicBaseUrl,
    resourceUri: `${publicBaseUrl}/mcp`,
    clientId,
    redirectUri,
    tokenHashKey: tokenHashKey ?? "",
    accessTokenMinutes: boundedInteger(environment, "MCP_ACCESS_TOKEN_MINUTES", 15, 5, 60),
    refreshTokenDays: boundedInteger(environment, "MCP_REFRESH_TOKEN_DAYS", 30, 1, 90),
    maxToolSeconds,
    abandonedCallSeconds,
  };
};
