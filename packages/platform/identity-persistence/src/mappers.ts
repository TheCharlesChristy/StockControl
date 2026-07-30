import {
  authenticationRateLimitScopes,
  capabilityKeys,
  normaliseEmailAddress,
  userDisplayName,
  userId,
  type Capability,
  type CompletedBootstrapState,
  type IdentityAuditValue,
  type PersistedAuthChallenge,
  type PersistedBootstrapState,
  type PersistedIdentitySecurityPolicy,
  type PersistedInvitation,
  type PersistedMfaRecoveryRequest,
  type PersistedPasswordCredential,
  type PersistedPasswordReset,
  type PersistedPermissionOverride,
  type PersistedRateLimitBucket,
  type PersistedRecoveryCode,
  type PersistedSession,
  type PersistedTotpCredential,
  type PersistedUser,
  type UserPermissionSettings,
} from "@stockcontrol/module-identity";
import type { Selectable } from "kysely";

import type {
  IdentityBootstrapStateTable,
  IdentityAuthChallengesTable,
  IdentityInvitationsTable,
  IdentityMfaRecoveryRequestsTable,
  IdentityPasswordCredentialsTable,
  IdentityPasswordResetsTable,
  IdentityPermissionOverridesTable,
  IdentityRateLimitBucketsTable,
  IdentityRecoveryCodesTable,
  IdentitySecurityPolicyTable,
  IdentitySessionsTable,
  IdentityTotpCredentialsTable,
  IdentityUsersTable,
} from "@stockcontrol/platform-database";

import {
  digestBytes,
  encryptionKeyId,
  exactBytes,
  optionalDate,
  optionalString,
} from "./validation";

const knownCapabilities = new Set<string>(capabilityKeys);
const knownRateLimitScopes = new Set<string>(authenticationRateLimitScopes);

const capabilityFromDatabase = (value: string): Capability => {
  if (!knownCapabilities.has(value)) {
    throw new Error(`Database contains unknown permission capability ${value}.`);
  }

  return value as Capability;
};

export const settingsFromPermissionRows = (
  rows: readonly Selectable<IdentityPermissionOverridesTable>[],
): UserPermissionSettings =>
  Object.freeze(
    Object.fromEntries(
      rows.map((row) => [capabilityFromDatabase(row.capability), row.setting]),
    ) as UserPermissionSettings,
  );

export const userFromRow = (
  row: Selectable<IdentityUsersTable>,
  permissionSettings: UserPermissionSettings,
): PersistedUser =>
  Object.freeze({
    id: userId(row.id),
    email: normaliseEmailAddress(row.normalised_email),
    displayName: userDisplayName(row.display_name),
    role: row.role,
    status: row.status,
    permissionSettings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  });

export const permissionOverrideFromRow = (
  row: Selectable<IdentityPermissionOverridesTable>,
): PersistedPermissionOverride =>
  Object.freeze({
    userId: userId(row.user_id),
    capability: capabilityFromDatabase(row.capability),
    setting: row.setting,
    catalogueVersion: row.catalogue_version,
    updatedByUserId: userId(row.updated_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

export const passwordCredentialFromRow = (
  row: Selectable<IdentityPasswordCredentialsTable>,
): PersistedPasswordCredential =>
  Object.freeze({
    userId: userId(row.user_id),
    passwordHash: row.password_hash,
    passwordChangedAt: row.password_changed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  });

export const sessionFromRow = (row: Selectable<IdentitySessionsTable>): PersistedSession => {
  const reauthenticatedAt = optionalDate(row.reauthenticated_at);
  const revokedAt = optionalDate(row.revoked_at);
  const revokeReason = optionalString(row.revoke_reason);
  const userAgent = optionalString(row.user_agent);

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    tokenHash: digestBytes(row.token_hash, "Stored session token hash"),
    authenticationMethod: row.authentication_method,
    assuranceLevel: row.assurance_level,
    issuedAt: row.issued_at,
    lastSeenAt: row.last_seen_at,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    ...(reauthenticatedAt === undefined ? {} : { reauthenticatedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(revokeReason === undefined ? {} : { revokeReason }),
    ...(row.created_ip_hash === null
      ? {}
      : { createdIpHash: digestBytes(row.created_ip_hash, "Stored network address hash") }),
    ...(userAgent === undefined ? {} : { userAgent }),
    version: row.version,
  });
};

export const totpCredentialFromRow = (
  row: Selectable<IdentityTotpCredentialsTable>,
): PersistedTotpCredential => {
  if (row.secret_encryption_version !== 1) {
    throw new Error(
      `Database contains unsupported TOTP encryption version ${String(
        row.secret_encryption_version,
      )}.`,
    );
  }

  const verifiedAt = optionalDate(row.verified_at);
  const recoveryCodesAcknowledgedAt = optionalDate(row.recovery_codes_acknowledged_at);
  const revokedAt = optionalDate(row.revoked_at);

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    status: row.status,
    secretEncryptionVersion: 1,
    secretKeyId: encryptionKeyId(row.secret_key_id),
    secretNonce: exactBytes(row.secret_nonce, 12, "Stored TOTP secret nonce"),
    secretCiphertext: exactBytes(row.secret_ciphertext, 32, "Stored TOTP secret ciphertext"),
    secretAuthTag: exactBytes(row.secret_auth_tag, 16, "Stored TOTP authentication tag"),
    ...(row.last_accepted_counter === null
      ? {}
      : { lastAcceptedCounter: BigInt(row.last_accepted_counter) }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
    ...(recoveryCodesAcknowledgedAt === undefined ? {} : { recoveryCodesAcknowledgedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  });
};

export const recoveryCodeFromRow = (
  row: Selectable<IdentityRecoveryCodesTable>,
): PersistedRecoveryCode => {
  const usedAt = optionalDate(row.used_at);
  const revokedAt = optionalDate(row.revoked_at);

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    totpCredentialId: row.totp_credential_id,
    codeHash: digestBytes(row.code_hash, "Stored recovery-code hash"),
    createdAt: row.created_at,
    ...(usedAt === undefined ? {} : { usedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
  });
};

const freezeAuditValue = (value: unknown, depth = 0): IdentityAuditValue => {
  if (depth > 32) {
    throw new Error("Database JSON exceeds the supported identity context depth.");
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => freezeAuditValue(entry, depth + 1)));
  }
  if (typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, freezeAuditValue(entry, depth + 1)]),
      ),
    );
  }
  throw new Error("Database contains a non-JSON identity context value.");
};

export const authChallengeFromRow = (
  row: Selectable<IdentityAuthChallengesTable>,
): PersistedAuthChallenge => {
  const consumedAt = optionalDate(row.consumed_at);
  const context = freezeAuditValue(row.context);
  if (context === null || Array.isArray(context) || typeof context !== "object") {
    throw new Error("Database contains a non-object authentication challenge context.");
  }
  const objectContext = context as Readonly<Record<string, IdentityAuditValue>>;

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    purpose: row.purpose,
    tokenHash: digestBytes(row.token_hash, "Stored authentication challenge token hash"),
    context: objectContext,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(consumedAt === undefined ? {} : { consumedAt }),
    attemptCount: row.attempt_count,
    maximumAttempts: row.maximum_attempts,
    version: row.version,
  });
};

export const invitationFromRow = (
  row: Selectable<IdentityInvitationsTable>,
): PersistedInvitation => {
  const acceptedAt = optionalDate(row.accepted_at);
  const revokedAt = optionalDate(row.revoked_at);

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    invitedByUserId: userId(row.invited_by_user_id),
    tokenHash: digestBytes(row.token_hash, "Stored invitation token hash"),
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(acceptedAt === undefined ? {} : { acceptedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    version: row.version,
  });
};

export const passwordResetFromRow = (
  row: Selectable<IdentityPasswordResetsTable>,
): PersistedPasswordReset => {
  const completedAt = optionalDate(row.completed_at);
  const revokedAt = optionalDate(row.revoked_at);

  return Object.freeze({
    id: row.id,
    userId: userId(row.user_id),
    tokenHash: digestBytes(row.token_hash, "Stored password-reset token hash"),
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
    version: row.version,
  });
};

export const rateLimitBucketFromRow = (
  row: Selectable<IdentityRateLimitBucketsTable>,
): PersistedRateLimitBucket => {
  if (!knownRateLimitScopes.has(row.scope)) {
    throw new Error(`Database contains unknown authentication rate-limit scope ${row.scope}.`);
  }
  const blockedUntil = optionalDate(row.blocked_until);

  return Object.freeze({
    bucketKeyHash: digestBytes(row.bucket_key_hash, "Stored rate-limit bucket key hash"),
    scope: row.scope as PersistedRateLimitBucket["scope"],
    windowStartedAt: row.window_started_at,
    expiresAt: row.expires_at,
    failureCount: row.attempt_count,
    ...(blockedUntil === undefined ? {} : { blockedUntil }),
    updatedAt: row.updated_at,
    version: row.version,
  });
};

export const securityPolicyFromRow = (
  row: Selectable<IdentitySecurityPolicyTable>,
): PersistedIdentitySecurityPolicy => {
  if (
    row.singleton_key !== 1 ||
    row.admin_mfa_required !== true ||
    row.permission_catalogue_version !== 1
  ) {
    throw new Error("Database contains an unsupported identity security policy.");
  }

  return Object.freeze({
    passwordMinimumLength: row.password_minimum_length,
    passwordMaximumLength: row.password_maximum_length,
    adminMfaRequired: true,
    standardSessionIdleSeconds: row.standard_session_idle_seconds,
    adminSessionIdleSeconds: row.admin_session_idle_seconds,
    sessionAbsoluteSeconds: row.session_absolute_seconds,
    recentAuthenticationSeconds: row.recent_authentication_seconds,
    authChallengeSeconds: row.auth_challenge_seconds,
    invitationSeconds: row.invitation_seconds,
    passwordResetSeconds: row.password_reset_seconds,
    permissionCatalogueVersion: 1,
    updatedAt: row.updated_at,
    version: row.version,
  });
};

export const mfaRecoveryRequestFromRow = (
  row: Selectable<IdentityMfaRecoveryRequestsTable>,
): PersistedMfaRecoveryRequest => {
  const approvedByUserId =
    row.approved_by_user_id === null ? undefined : userId(row.approved_by_user_id);
  const vendorCaseReference =
    row.vendor_case_reference === null ? undefined : row.vendor_case_reference;
  if (
    (row.approval_method === null &&
      (approvedByUserId !== undefined || vendorCaseReference !== undefined)) ||
    (row.approval_method === "ActiveAdmin" &&
      (approvedByUserId === undefined || vendorCaseReference !== undefined)) ||
    (row.approval_method === "VendorVerification" &&
      (approvedByUserId !== undefined || vendorCaseReference === undefined))
  ) {
    throw new Error("Database contains an inconsistent MFA recovery approval.");
  }
  const resolvedAt = optionalDate(row.resolved_at);
  const completedAt = optionalDate(row.completed_at);

  return Object.freeze({
    id: row.id,
    subjectUserId: userId(row.subject_user_id),
    requestedByUserId: userId(row.requested_by_user_id),
    ...(row.approval_method === null ? {} : { approvalMethod: row.approval_method }),
    ...(approvedByUserId === undefined ? {} : { approvedByUserId }),
    ...(vendorCaseReference === undefined ? {} : { vendorCaseReference }),
    status: row.status,
    reason: row.reason,
    requestedAt: row.requested_at,
    expiresAt: row.expires_at,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    version: row.version,
  });
};

export const bootstrapStateFromRow = (
  row: Selectable<IdentityBootstrapStateTable>,
): PersistedBootstrapState => {
  if (
    row.completed_at !== null &&
    row.completed_by_user_id !== null &&
    row.secret_hash === null &&
    row.expires_at === null
  ) {
    return Object.freeze({
      status: "Completed",
      completedAt: row.completed_at,
      completedByUserId: userId(row.completed_by_user_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    } satisfies CompletedBootstrapState);
  }

  if (
    row.completed_at === null &&
    row.completed_by_user_id === null &&
    row.secret_hash !== null &&
    row.expires_at !== null
  ) {
    return Object.freeze({
      status: "Pending",
      secretHash: digestBytes(row.secret_hash, "Stored bootstrap token hash"),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }

  throw new Error("Database contains an inconsistent bootstrap state.");
};
