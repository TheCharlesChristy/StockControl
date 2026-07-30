import type { ColumnType, Generated, JSONColumnType } from "kysely";

export const STOCKCONTROL_SCHEMA = "stockcontrol";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonObject | JsonPrimitive | readonly JsonValue[];

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ImmutableColumn<Value> = ColumnType<Value, Value, never>;
export type GeneratedImmutableColumn<Value> = ColumnType<Value, Value | undefined, never>;

export interface SystemMetadataTable {
  readonly key: string;
  readonly value: JSONColumnType<JsonObject, JsonObject, JsonObject>;
  readonly created_at: Generated<Date>;
  readonly updated_at: Generated<Date>;
}

export interface MigrationIntegrityTable {
  readonly migration_name: string;
  readonly migration_version: number;
  readonly checksum: string;
  readonly recorded_at: Generated<Date>;
}

export type IdentityUserRole = "Engineer" | "Office" | "Admin";
export type IdentityUserStatus = "Invited" | "Active" | "Disabled";
export type IdentityPermissionSetting = "Allow" | "Deny";

export interface IdentityUsersTable {
  readonly id: ImmutableColumn<string>;
  readonly normalised_email: string;
  readonly display_name: string;
  readonly role: IdentityUserRole;
  readonly status: IdentityUserStatus;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export interface IdentityPasswordCredentialsTable {
  readonly user_id: ImmutableColumn<string>;
  readonly password_hash: string;
  readonly password_changed_at: Date;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export type IdentityTotpCredentialStatus = "Pending" | "Active" | "Revoked";

export interface IdentityTotpCredentialsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly status: IdentityTotpCredentialStatus;
  readonly secret_encryption_version: number;
  readonly secret_key_id: string;
  readonly secret_nonce: Uint8Array;
  readonly secret_ciphertext: Uint8Array;
  readonly secret_auth_tag: Uint8Array;
  readonly last_accepted_counter: ColumnType<
    string | null,
    bigint | string | null,
    bigint | string | null
  >;
  readonly verified_at: Date | null;
  readonly recovery_codes_acknowledged_at: Date | null;
  readonly revoked_at: Date | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export interface IdentityRecoveryCodesTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly totp_credential_id: ImmutableColumn<string>;
  readonly code_hash: ImmutableColumn<Uint8Array>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly used_at: Date | null;
  readonly revoked_at: Date | null;
}

export interface IdentityPermissionOverridesTable {
  readonly user_id: ImmutableColumn<string>;
  readonly capability: ImmutableColumn<string>;
  readonly setting: IdentityPermissionSetting;
  readonly catalogue_version: ImmutableColumn<number>;
  readonly updated_by_user_id: string;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
}

export interface IdentitySessionsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly token_hash: ImmutableColumn<Uint8Array>;
  readonly authentication_method: ImmutableColumn<IdentityAuthenticationMethod>;
  readonly assurance_level: ImmutableColumn<IdentityAssuranceLevel>;
  readonly issued_at: ImmutableColumn<Date>;
  readonly last_seen_at: Date;
  readonly idle_expires_at: Date;
  readonly absolute_expires_at: ImmutableColumn<Date>;
  readonly reauthenticated_at: Date | null;
  readonly revoked_at: Date | null;
  readonly revoke_reason: string | null;
  readonly created_ip_hash: ImmutableColumn<Uint8Array | null>;
  readonly user_agent: ImmutableColumn<string | null>;
  readonly version: Generated<number>;
}

export type IdentityAuthenticationMethod =
  "Password" | "PasswordAndTotp" | "PasswordAndRecoveryCode";
export type IdentityAssuranceLevel = "SingleFactor" | "MultiFactor";

export type IdentityAuthChallengePurpose = "BootstrapMfa" | "SignInMfa" | "Reauthenticate";

export interface IdentityAuthChallengesTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly purpose: ImmutableColumn<IdentityAuthChallengePurpose>;
  readonly token_hash: ImmutableColumn<Uint8Array>;
  readonly context: JSONColumnType<JsonObject, JsonObject | undefined, never>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly expires_at: ImmutableColumn<Date>;
  readonly consumed_at: Date | null;
  readonly attempt_count: Generated<number>;
  readonly maximum_attempts: ImmutableColumn<number>;
  readonly version: Generated<number>;
}

export interface IdentityInvitationsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly invited_by_user_id: ImmutableColumn<string>;
  readonly token_hash: ImmutableColumn<Uint8Array>;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly expires_at: ImmutableColumn<Date>;
  readonly accepted_at: Date | null;
  readonly revoked_at: Date | null;
  readonly version: Generated<number>;
}

export interface IdentityPasswordResetsTable {
  readonly id: ImmutableColumn<string>;
  readonly user_id: ImmutableColumn<string>;
  readonly token_hash: ImmutableColumn<Uint8Array>;
  readonly requested_at: ImmutableColumn<Date>;
  readonly expires_at: ImmutableColumn<Date>;
  readonly completed_at: Date | null;
  readonly revoked_at: Date | null;
  readonly version: Generated<number>;
}

export interface IdentityRateLimitBucketsTable {
  readonly bucket_key_hash: ImmutableColumn<Uint8Array>;
  readonly scope: ImmutableColumn<string>;
  readonly window_started_at: Date;
  readonly expires_at: Date;
  readonly attempt_count: Generated<number>;
  readonly blocked_until: Date | null;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export interface IdentitySecurityPolicyTable {
  readonly singleton_key: GeneratedImmutableColumn<number>;
  readonly password_minimum_length: Generated<number>;
  readonly password_maximum_length: Generated<number>;
  readonly admin_mfa_required: Generated<boolean>;
  readonly standard_session_idle_seconds: Generated<number>;
  readonly admin_session_idle_seconds: Generated<number>;
  readonly session_absolute_seconds: Generated<number>;
  readonly recent_authentication_seconds: Generated<number>;
  readonly auth_challenge_seconds: Generated<number>;
  readonly invitation_seconds: Generated<number>;
  readonly password_reset_seconds: Generated<number>;
  readonly permission_catalogue_version: Generated<number>;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export type IdentityMfaRecoveryStatus =
  "Pending" | "Approved" | "Rejected" | "Cancelled" | "Completed" | "Expired";

export interface IdentityMfaRecoveryRequestsTable {
  readonly id: ImmutableColumn<string>;
  readonly subject_user_id: ImmutableColumn<string>;
  readonly requested_by_user_id: ImmutableColumn<string>;
  readonly approval_method: "ActiveAdmin" | "VendorVerification" | null;
  readonly approved_by_user_id: string | null;
  readonly vendor_case_reference: string | null;
  readonly status: IdentityMfaRecoveryStatus;
  readonly reason: ImmutableColumn<string>;
  readonly requested_at: GeneratedImmutableColumn<Date>;
  readonly expires_at: ImmutableColumn<Date>;
  readonly resolved_at: Date | null;
  readonly completed_at: Date | null;
  readonly version: Generated<number>;
}

export interface IdentityBootstrapStateTable {
  readonly singleton_key: GeneratedImmutableColumn<number>;
  readonly secret_hash: Uint8Array | null;
  readonly expires_at: Date | null;
  readonly completed_at: Date | null;
  readonly completed_by_user_id: string | null;
  readonly created_at: GeneratedImmutableColumn<Date>;
  readonly updated_at: Generated<Date>;
  readonly version: Generated<number>;
}

export type IdentityAuditOutcome = "Succeeded" | "Denied" | "Failed";

export interface IdentityAuditEventsTable {
  readonly id: ImmutableColumn<string>;
  readonly sequence: ColumnType<string, bigint | string, never>;
  readonly occurred_at: ImmutableColumn<Date>;
  readonly event_type: ImmutableColumn<string>;
  readonly outcome: ImmutableColumn<IdentityAuditOutcome>;
  readonly actor_user_id: ImmutableColumn<string | null>;
  readonly subject_user_id: ImmutableColumn<string | null>;
  readonly session_id: ImmutableColumn<string | null>;
  readonly correlation_id: ImmutableColumn<string>;
  readonly remote_address_hash: ImmutableColumn<Uint8Array | null>;
  readonly details: JSONColumnType<JsonObject, JsonObject | undefined, never>;
  readonly previous_event_hash: ImmutableColumn<Uint8Array | null>;
  readonly integrity_version: ImmutableColumn<1>;
  readonly integrity_key_id: ImmutableColumn<string>;
  readonly event_hash: ImmutableColumn<Uint8Array>;
}

export interface IdentityAuditChainHeadTable {
  readonly singleton_key: GeneratedImmutableColumn<number>;
  readonly last_sequence: ColumnType<string, bigint | string | undefined, bigint | string>;
  readonly last_event_id: string | null;
  readonly last_event_hash: Uint8Array | null;
  readonly updated_at: Generated<Date>;
}

export interface StockControlDatabase {
  readonly identity_audit_chain_head: IdentityAuditChainHeadTable;
  readonly identity_audit_events: IdentityAuditEventsTable;
  readonly identity_auth_challenges: IdentityAuthChallengesTable;
  readonly identity_bootstrap_state: IdentityBootstrapStateTable;
  readonly identity_invitations: IdentityInvitationsTable;
  readonly identity_mfa_recovery_requests: IdentityMfaRecoveryRequestsTable;
  readonly identity_password_credentials: IdentityPasswordCredentialsTable;
  readonly identity_password_resets: IdentityPasswordResetsTable;
  readonly identity_permission_overrides: IdentityPermissionOverridesTable;
  readonly identity_rate_limit_buckets: IdentityRateLimitBucketsTable;
  readonly identity_recovery_codes: IdentityRecoveryCodesTable;
  readonly identity_security_policy: IdentitySecurityPolicyTable;
  readonly identity_sessions: IdentitySessionsTable;
  readonly identity_totp_credentials: IdentityTotpCredentialsTable;
  readonly identity_users: IdentityUsersTable;
  readonly migration_integrity: MigrationIntegrityTable;
  readonly system_metadata: SystemMetadataTable;
}
