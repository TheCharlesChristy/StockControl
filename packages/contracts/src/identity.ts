export const apiUserRoles = ["Engineer", "Office", "Admin"] as const;
export const apiUserStatuses = ["Invited", "Active", "Disabled"] as const;
export const apiPermissionSettings = ["UseRoleDefault", "Allow", "Deny"] as const;
export const authenticationAssuranceLevels = ["password", "mfa"] as const;
export const mfaVerificationMethods = ["totp", "recovery_code"] as const;
export const AUTH_CSRF_HEADER = "x-csrf-token";

export type ApiUserRole = (typeof apiUserRoles)[number];
export type ApiUserStatus = (typeof apiUserStatuses)[number];
export type ApiPermissionSetting = (typeof apiPermissionSettings)[number];
export type AuthenticationAssuranceLevel = (typeof authenticationAssuranceLevels)[number];
export type MfaVerificationMethod = (typeof mfaVerificationMethods)[number];

export interface AuthenticatedUserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: ApiUserRole;
  readonly status: "Active";
  readonly effectiveCapabilities: readonly string[];
  readonly permissionCatalogueVersion: number;
  readonly mfaEnabled: boolean;
}

export interface AuthenticatedSessionView {
  readonly user: AuthenticatedUserView;
  readonly assurance: AuthenticationAssuranceLevel;
  readonly issuedAt: string;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
  readonly recentlyAuthenticatedAt: string;
}

export interface SessionResponse {
  readonly session: AuthenticatedSessionView;
}

export interface CsrfTokenResponse {
  readonly token: string;
}

export interface SignInRequest {
  readonly email: string;
  readonly password: string;
}

export interface AuthenticationCompleteResponse {
  readonly outcome: "authenticated";
  readonly session: AuthenticatedSessionView;
}

export interface MfaChallengeView {
  readonly id: string;
  readonly expiresAt: string;
  readonly methods: readonly MfaVerificationMethod[];
}

export interface MfaRequiredResponse {
  readonly outcome: "mfa_required";
  readonly challenge: MfaChallengeView;
}

export type SignInResponse = AuthenticationCompleteResponse | MfaRequiredResponse;

export interface VerifyMfaRequest {
  readonly challengeId: string;
  readonly code: string;
}

export type VerifyMfaResponse = AuthenticationCompleteResponse;

export interface ReauthenticateRequest {
  readonly password: string;
}

export type ReauthenticateResponse =
  | {
      readonly outcome: "reauthenticated";
      readonly recentlyAuthenticatedAt: string;
    }
  | MfaRequiredResponse;

export const bootstrapStatuses = ["required", "in_progress", "complete"] as const;
export type BootstrapStatus = (typeof bootstrapStatuses)[number];

export interface BootstrapStatusResponse {
  readonly status: BootstrapStatus;
}

export interface BeginBootstrapRequest {
  readonly bootstrapToken: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
}

export interface TotpEnrollmentView {
  readonly challengeId: string;
  readonly manualEntrySecret: string;
  readonly provisioningUri: string;
  readonly expiresAt: string;
}

export interface BeginBootstrapResponse {
  readonly enrollment: TotpEnrollmentView;
}

export interface VerifyBootstrapMfaRequest {
  readonly challengeId: string;
  readonly code: string;
}

export interface VerifyBootstrapMfaResponse {
  readonly challengeId: string;
  readonly acknowledgementToken: string;
  readonly recoveryCodes: readonly string[];
  readonly expiresAt: string;
}

export interface CompleteBootstrapRequest {
  readonly challengeId: string;
  readonly acknowledgementToken: string;
  readonly recoveryCodesAcknowledged: true;
}

export type CompleteBootstrapResponse = AuthenticationCompleteResponse;

export interface InspectInvitationRequest {
  readonly token: string;
}

export interface InvitationView {
  readonly email: string;
  readonly displayName: string;
  readonly role: ApiUserRole;
  readonly expiresAt: string;
  readonly requiresMfa: boolean;
}

export interface InspectInvitationResponse {
  readonly invitation: InvitationView;
}

export interface AcceptInvitationRequest {
  readonly token: string;
  readonly password: string;
}

export type AcceptInvitationResponse =
  | AuthenticationCompleteResponse
  | {
      readonly outcome: "mfa_enrollment_required";
      readonly enrollment: TotpEnrollmentView;
    };

export interface RequestPasswordResetRequest {
  readonly email: string;
}

export interface CompletePasswordResetRequest {
  readonly token: string;
  readonly password: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUtcInstant(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  ) {
    return false;
  }

  const parsedMilliseconds = Date.parse(value);
  return (
    Number.isFinite(parsedMilliseconds) &&
    new Date(parsedMilliseconds).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}

function isOneOf<TValue extends string>(
  value: unknown,
  allowedValues: readonly TValue[],
): value is TValue {
  return typeof value === "string" && allowedValues.includes(value as TValue);
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length
  );
}

export function isAuthenticatedUserView(value: unknown): value is AuthenticatedUserView {
  return (
    isRecord(value) &&
    isNonEmptyString(value["id"]) &&
    isNonEmptyString(value["email"]) &&
    isNonEmptyString(value["displayName"]) &&
    isOneOf(value["role"], apiUserRoles) &&
    value["status"] === "Active" &&
    isUniqueStringArray(value["effectiveCapabilities"]) &&
    Number.isSafeInteger(value["permissionCatalogueVersion"]) &&
    (value["permissionCatalogueVersion"] as number) > 0 &&
    typeof value["mfaEnabled"] === "boolean" &&
    (value["role"] !== "Admin" || value["mfaEnabled"])
  );
}

export function isAuthenticatedSessionView(value: unknown): value is AuthenticatedSessionView {
  if (
    !isRecord(value) ||
    !isAuthenticatedUserView(value["user"]) ||
    !isOneOf(value["assurance"], authenticationAssuranceLevels) ||
    !isUtcInstant(value["issuedAt"]) ||
    !isUtcInstant(value["idleExpiresAt"]) ||
    !isUtcInstant(value["absoluteExpiresAt"]) ||
    !isUtcInstant(value["recentlyAuthenticatedAt"])
  ) {
    return false;
  }

  const issuedAt = Date.parse(value["issuedAt"]);
  const idleExpiresAt = Date.parse(value["idleExpiresAt"]);
  const absoluteExpiresAt = Date.parse(value["absoluteExpiresAt"]);
  const recentlyAuthenticatedAt = Date.parse(value["recentlyAuthenticatedAt"]);

  return (
    issuedAt <= recentlyAuthenticatedAt &&
    recentlyAuthenticatedAt <= absoluteExpiresAt &&
    issuedAt < idleExpiresAt &&
    idleExpiresAt <= absoluteExpiresAt &&
    (value["assurance"] !== "mfa" || value["user"].mfaEnabled) &&
    (value["user"].role !== "Admin" || value["assurance"] === "mfa")
  );
}

export function isSessionResponse(value: unknown): value is SessionResponse {
  return isRecord(value) && isAuthenticatedSessionView(value["session"]);
}

export function isSignInResponse(value: unknown): value is SignInResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (value["outcome"] === "authenticated") {
    return isAuthenticatedSessionView(value["session"]);
  }

  if (value["outcome"] !== "mfa_required" || !isRecord(value["challenge"])) {
    return false;
  }

  const challenge = value["challenge"];
  return (
    isNonEmptyString(challenge["id"]) &&
    isUtcInstant(challenge["expiresAt"]) &&
    Array.isArray(challenge["methods"]) &&
    challenge["methods"].length > 0 &&
    challenge["methods"].every((method) => isOneOf(method, mfaVerificationMethods)) &&
    new Set(challenge["methods"]).size === challenge["methods"].length
  );
}
