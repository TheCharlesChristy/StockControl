import type { Capability } from "../capabilities";
import type { PermissionSetting, UserPermissionSettings } from "../permission-resolution";
import type { UserRole } from "../role-templates";
import type { User, UserStatus } from "../user";
import type { NormalisedEmailAddress, UserDisplayName, UserId } from "../value-objects";
import type { AdministrativeUserProjection } from "../policies/final-capable-admin-policy";
import type { AuthenticationRateLimitScope } from "../policies/rate-limit-policy";

declare const sha256DigestBrand: unique symbol;

export const SHA256_DIGEST_BYTES = 32;

/**
 * Exactly 32 raw SHA-256 bytes. Persistence never parses or stores a bearer
 * token or a textual digest representation.
 */
export type Sha256Digest = Uint8Array & {
  readonly [sha256DigestBrand]: "Sha256Digest";
};

/**
 * The explicit bridge from cryptographic adapters and database drivers into
 * identity persistence ports. It rejects encoded strings and returns a
 * defensive copy so callers cannot mutate retained digest material.
 */
export const createSha256Digest = (value: Uint8Array): Sha256Digest => {
  if (!(value instanceof Uint8Array) || value.length !== SHA256_DIGEST_BYTES) {
    throw new RangeError(`SHA-256 digest must contain exactly ${SHA256_DIGEST_BYTES} raw bytes.`);
  }

  return Uint8Array.from(value) as Sha256Digest;
};

/**
 * Returns a fresh unbranded copy for a persistence or cryptographic adapter.
 */
export const sha256DigestBytes = (value: Sha256Digest): Uint8Array => createSha256Digest(value);

export interface PersistedUser extends User {
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface CreateUserRecord {
  readonly id: UserId;
  readonly email: NormalisedEmailAddress;
  readonly displayName: UserDisplayName;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly occurredAt: Date;
}

export interface ReplaceUserRecord {
  readonly id: UserId;
  readonly email: NormalisedEmailAddress;
  readonly displayName: UserDisplayName;
  readonly role: UserRole;
  readonly status: UserStatus;
  readonly expectedVersion: number;
  readonly occurredAt: Date;
}

export interface IdentityUserRepository {
  findById(id: UserId): Promise<PersistedUser | undefined>;
  findByEmail(email: NormalisedEmailAddress): Promise<PersistedUser | undefined>;
  insert(command: CreateUserRecord): Promise<PersistedUser>;
  replace(command: ReplaceUserRecord): Promise<PersistedUser | undefined>;
  lockAdministrativeRoster(): Promise<readonly AdministrativeUserProjection[]>;
}

export interface PersistedPasswordCredential {
  readonly userId: UserId;
  readonly passwordHash: string;
  readonly passwordChangedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type CreatePasswordCredential = Omit<PersistedPasswordCredential, "version">;

export interface ReplacePasswordCredential {
  readonly userId: UserId;
  readonly passwordHash: string;
  readonly passwordChangedAt: Date;
  readonly expectedVersion: number;
}

export interface IdentityPasswordCredentialRepository {
  findByUserIdForUpdate(userId: UserId): Promise<PersistedPasswordCredential | undefined>;
  insert(command: CreatePasswordCredential): Promise<PersistedPasswordCredential>;
  replace(command: ReplacePasswordCredential): Promise<PersistedPasswordCredential | undefined>;
}

export interface PersistedPermissionOverride {
  readonly userId: UserId;
  readonly capability: Capability;
  readonly setting: Exclude<PermissionSetting, "UseRoleDefault">;
  readonly catalogueVersion: number;
  readonly updatedByUserId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ReplacePermissionOverrides {
  readonly userId: UserId;
  readonly settings: UserPermissionSettings;
  readonly updatedByUserId: UserId;
  readonly occurredAt: Date;
}

export interface IdentityPermissionOverrideRepository {
  listForUser(userId: UserId): Promise<readonly PersistedPermissionOverride[]>;
  settingsForUser(userId: UserId): Promise<UserPermissionSettings>;
  replaceForUser(command: ReplacePermissionOverrides): Promise<void>;
}

export interface PersistedSession {
  readonly id: string;
  readonly userId: UserId;
  readonly tokenHash: Sha256Digest;
  readonly authenticationMethod: IdentityAuthenticationMethod;
  readonly assuranceLevel: IdentityAssuranceLevel;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly reauthenticatedAt?: Date;
  readonly revokedAt?: Date;
  readonly revokeReason?: string;
  readonly createdIpHash?: Sha256Digest;
  readonly userAgent?: string;
  readonly version: number;
}

export type CreateSessionRecord = Omit<PersistedSession, "version" | "revokedAt" | "revokeReason">;

export interface TouchSessionRecord {
  readonly id: string;
  readonly expectedVersion: number;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
}

export interface RevokeSessionRecord {
  readonly id: string;
  readonly expectedVersion: number;
  readonly revokedAt: Date;
  readonly reason: string;
}

export interface IdentitySessionRepository {
  insert(command: CreateSessionRecord): Promise<PersistedSession>;
  findActiveByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedSession | undefined>;
  touch(command: TouchSessionRecord): Promise<PersistedSession | undefined>;
  revoke(command: RevokeSessionRecord): Promise<PersistedSession | undefined>;
  revokeAllForUser(userId: UserId, revokedAt: Date, reason: string): Promise<number>;
}

export const identityAuthenticationMethods = [
  "Password",
  "PasswordAndTotp",
  "PasswordAndRecoveryCode",
] as const;
export type IdentityAuthenticationMethod = (typeof identityAuthenticationMethods)[number];

export const identityAssuranceLevels = ["SingleFactor", "MultiFactor"] as const;
export type IdentityAssuranceLevel = (typeof identityAssuranceLevels)[number];

export const identityAuthChallengePurposes = [
  "BootstrapMfa",
  "SignInMfa",
  "Reauthenticate",
] as const;
export type IdentityAuthChallengePurpose = (typeof identityAuthChallengePurposes)[number];

export interface PersistedAuthChallenge {
  readonly id: string;
  readonly userId: UserId;
  readonly purpose: IdentityAuthChallengePurpose;
  readonly tokenHash: Sha256Digest;
  readonly context: Readonly<Record<string, IdentityAuditValue>>;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly consumedAt?: Date;
  readonly attemptCount: number;
  readonly maximumAttempts: number;
  readonly version: number;
}

export type CreateAuthChallenge = Omit<
  PersistedAuthChallenge,
  "consumedAt" | "attemptCount" | "version"
>;

export interface RecordAuthChallengeFailure {
  readonly id: string;
  readonly expectedVersion: number;
  readonly occurredAt: Date;
}

export interface ConsumeAuthChallenge {
  readonly id: string;
  readonly expectedVersion: number;
  readonly consumedAt: Date;
}

export interface IdentityAuthChallengeRepository {
  insert(command: CreateAuthChallenge): Promise<PersistedAuthChallenge>;
  findOpenByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedAuthChallenge | undefined>;
  recordFailure(command: RecordAuthChallengeFailure): Promise<PersistedAuthChallenge | undefined>;
  consume(command: ConsumeAuthChallenge): Promise<PersistedAuthChallenge | undefined>;
}

export const identityTotpCredentialStatuses = ["Pending", "Active", "Revoked"] as const;
export type IdentityTotpCredentialStatus = (typeof identityTotpCredentialStatuses)[number];

export interface PersistedTotpCredential {
  readonly id: string;
  readonly userId: UserId;
  readonly status: IdentityTotpCredentialStatus;
  readonly secretEncryptionVersion: 1;
  readonly secretKeyId: string;
  readonly secretNonce: Uint8Array;
  readonly secretCiphertext: Uint8Array;
  readonly secretAuthTag: Uint8Array;
  readonly lastAcceptedCounter?: bigint;
  readonly verifiedAt?: Date;
  readonly recoveryCodesAcknowledgedAt?: Date;
  readonly revokedAt?: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type CreateTotpCredential = Omit<
  PersistedTotpCredential,
  "lastAcceptedCounter" | "verifiedAt" | "recoveryCodesAcknowledgedAt" | "revokedAt" | "version"
> & {
  readonly status: "Pending";
};

export interface ActivateTotpCredential {
  readonly id: string;
  readonly expectedVersion: number;
  readonly acceptedCounter: bigint;
  readonly verifiedAt: Date;
  readonly recoveryCodesAcknowledgedAt: Date;
}

export interface ReencryptTotpCredential {
  readonly id: string;
  readonly expectedVersion: number;
  readonly secretEncryptionVersion: 1;
  readonly secretKeyId: string;
  readonly secretNonce: Uint8Array;
  readonly secretCiphertext: Uint8Array;
  readonly secretAuthTag: Uint8Array;
  readonly occurredAt: Date;
}

export interface RecordAcceptedTotpCounter {
  readonly id: string;
  readonly expectedVersion: number;
  readonly acceptedCounter: bigint;
  readonly occurredAt: Date;
}

export interface RevokeTotpCredential {
  readonly id: string;
  readonly expectedVersion: number;
  readonly revokedAt: Date;
}

export interface IdentityTotpCredentialRepository {
  insert(command: CreateTotpCredential): Promise<PersistedTotpCredential>;
  findByIdForUpdate(id: string): Promise<PersistedTotpCredential | undefined>;
  findActiveForUserForUpdate(userId: UserId): Promise<PersistedTotpCredential | undefined>;
  activate(command: ActivateTotpCredential): Promise<PersistedTotpCredential | undefined>;
  reencrypt(command: ReencryptTotpCredential): Promise<PersistedTotpCredential | undefined>;
  recordAcceptedCounter(
    command: RecordAcceptedTotpCounter,
  ): Promise<PersistedTotpCredential | undefined>;
  revoke(command: RevokeTotpCredential): Promise<PersistedTotpCredential | undefined>;
  revokePendingForUser(userId: UserId, revokedAt: Date): Promise<number>;
}

export interface PersistedRecoveryCode {
  readonly id: string;
  readonly userId: UserId;
  readonly totpCredentialId: string;
  readonly codeHash: Sha256Digest;
  readonly createdAt: Date;
  readonly usedAt?: Date;
  readonly revokedAt?: Date;
}

export type CreateRecoveryCode = Omit<PersistedRecoveryCode, "usedAt" | "revokedAt">;

export interface ConsumeRecoveryCode {
  readonly id: string;
  readonly userId: UserId;
  readonly totpCredentialId: string;
  readonly codeHash: Sha256Digest;
  readonly usedAt: Date;
}

export interface IdentityRecoveryCodeRepository {
  insertMany(commands: readonly CreateRecoveryCode[]): Promise<readonly PersistedRecoveryCode[]>;
  hasAvailableForCredential(userId: UserId, totpCredentialId: string): Promise<boolean>;
  findAvailableByHashForUpdate(
    userId: UserId,
    totpCredentialId: string,
    codeHash: Sha256Digest,
  ): Promise<PersistedRecoveryCode | undefined>;
  consume(command: ConsumeRecoveryCode): Promise<PersistedRecoveryCode | undefined>;
  revokeAvailableForCredential(
    userId: UserId,
    totpCredentialId: string,
    revokedAt: Date,
  ): Promise<number>;
}

export interface PersistedInvitation {
  readonly id: string;
  readonly userId: UserId;
  readonly invitedByUserId: UserId;
  readonly tokenHash: Sha256Digest;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt?: Date;
  readonly revokedAt?: Date;
  readonly version: number;
}

export type CreateInvitationRecord = Omit<
  PersistedInvitation,
  "version" | "acceptedAt" | "revokedAt"
>;

export interface AcceptInvitationRecord {
  readonly id: string;
  readonly expectedVersion: number;
  readonly acceptedAt: Date;
}

export interface IdentityInvitationRepository {
  insert(command: CreateInvitationRecord): Promise<PersistedInvitation>;
  findOpenByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedInvitation | undefined>;
  accept(command: AcceptInvitationRecord): Promise<PersistedInvitation | undefined>;
  revokeOpenForUser(userId: UserId, revokedAt: Date): Promise<number>;
}

export interface PersistedPasswordReset {
  readonly id: string;
  readonly userId: UserId;
  readonly tokenHash: Sha256Digest;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly completedAt?: Date;
  readonly revokedAt?: Date;
  readonly version: number;
}

export type CreatePasswordReset = Omit<
  PersistedPasswordReset,
  "completedAt" | "revokedAt" | "version"
>;

export interface CompletePasswordReset {
  readonly id: string;
  readonly expectedVersion: number;
  readonly completedAt: Date;
}

export interface IdentityPasswordResetRepository {
  insert(command: CreatePasswordReset): Promise<PersistedPasswordReset>;
  findOpenByTokenHashForUpdate(
    tokenHash: Sha256Digest,
    occurredAt: Date,
  ): Promise<PersistedPasswordReset | undefined>;
  complete(command: CompletePasswordReset): Promise<PersistedPasswordReset | undefined>;
  revokeOpenForUser(userId: UserId, revokedAt: Date): Promise<number>;
}

export interface PersistedRateLimitBucket {
  readonly bucketKeyHash: Sha256Digest;
  readonly scope: AuthenticationRateLimitScope;
  readonly windowStartedAt: Date;
  readonly expiresAt: Date;
  readonly failureCount: number;
  readonly blockedUntil?: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type CreateRateLimitBucket = Omit<PersistedRateLimitBucket, "version">;

export interface ReplaceRateLimitBucket extends CreateRateLimitBucket {
  readonly expectedVersion: number;
}

export interface IdentityRateLimitBucketRepository {
  findForUpdate(
    bucketKeyHash: Sha256Digest,
    scope: AuthenticationRateLimitScope,
  ): Promise<PersistedRateLimitBucket | undefined>;
  insert(command: CreateRateLimitBucket): Promise<PersistedRateLimitBucket>;
  replace(command: ReplaceRateLimitBucket): Promise<PersistedRateLimitBucket | undefined>;
  clear(bucketKeyHash: Sha256Digest, scope: AuthenticationRateLimitScope): Promise<boolean>;
}

export interface PersistedIdentitySecurityPolicy {
  readonly passwordMinimumLength: number;
  readonly passwordMaximumLength: number;
  readonly adminMfaRequired: true;
  readonly standardSessionIdleSeconds: number;
  readonly adminSessionIdleSeconds: number;
  readonly sessionAbsoluteSeconds: number;
  readonly recentAuthenticationSeconds: number;
  readonly authChallengeSeconds: number;
  readonly invitationSeconds: number;
  readonly passwordResetSeconds: number;
  readonly permissionCatalogueVersion: 1;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface ReplaceIdentitySecurityPolicy extends Omit<
  PersistedIdentitySecurityPolicy,
  "version"
> {
  readonly expectedVersion: number;
}

export interface IdentitySecurityPolicyRepository {
  get(): Promise<PersistedIdentitySecurityPolicy>;
  getForUpdate(): Promise<PersistedIdentitySecurityPolicy>;
  replace(
    command: ReplaceIdentitySecurityPolicy,
  ): Promise<PersistedIdentitySecurityPolicy | undefined>;
}

export const identityMfaRecoveryStatuses = [
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled",
  "Completed",
  "Expired",
] as const;
export type IdentityMfaRecoveryStatus = (typeof identityMfaRecoveryStatuses)[number];
export const identityMfaRecoveryApprovalMethods = ["ActiveAdmin", "VendorVerification"] as const;
export type IdentityMfaRecoveryApprovalMethod = (typeof identityMfaRecoveryApprovalMethods)[number];

export interface PersistedMfaRecoveryRequest {
  readonly id: string;
  readonly subjectUserId: UserId;
  readonly requestedByUserId: UserId;
  readonly approvalMethod?: IdentityMfaRecoveryApprovalMethod;
  readonly approvedByUserId?: UserId;
  readonly vendorCaseReference?: string;
  readonly status: IdentityMfaRecoveryStatus;
  readonly reason: string;
  readonly requestedAt: Date;
  readonly expiresAt: Date;
  readonly resolvedAt?: Date;
  readonly completedAt?: Date;
  readonly version: number;
}

export type CreateMfaRecoveryRequest = Omit<
  PersistedMfaRecoveryRequest,
  | "approvalMethod"
  | "approvedByUserId"
  | "vendorCaseReference"
  | "status"
  | "resolvedAt"
  | "completedAt"
  | "version"
>;

interface ApproveMfaRecoveryRequestBase {
  readonly id: string;
  readonly expectedVersion: number;
  readonly resolvedAt: Date;
}

export interface ApproveMfaRecoveryByAdmin extends ApproveMfaRecoveryRequestBase {
  readonly approvalMethod: "ActiveAdmin";
  readonly approvedByUserId: UserId;
}

export interface ApproveMfaRecoveryByVendor extends ApproveMfaRecoveryRequestBase {
  readonly approvalMethod: "VendorVerification";
  readonly vendorCaseReference: string;
}

export type ApproveMfaRecoveryRequest = ApproveMfaRecoveryByAdmin | ApproveMfaRecoveryByVendor;

export interface CloseMfaRecoveryRequest {
  readonly id: string;
  readonly expectedVersion: number;
  readonly status: "Rejected" | "Cancelled" | "Expired";
  readonly resolvedAt: Date;
}

export interface CompleteMfaRecoveryRequest {
  readonly id: string;
  readonly expectedVersion: number;
  readonly completedAt: Date;
}

export interface IdentityMfaRecoveryRequestRepository {
  insert(command: CreateMfaRecoveryRequest): Promise<PersistedMfaRecoveryRequest>;
  findByIdForUpdate(id: string): Promise<PersistedMfaRecoveryRequest | undefined>;
  approve(command: ApproveMfaRecoveryRequest): Promise<PersistedMfaRecoveryRequest | undefined>;
  close(command: CloseMfaRecoveryRequest): Promise<PersistedMfaRecoveryRequest | undefined>;
  complete(command: CompleteMfaRecoveryRequest): Promise<PersistedMfaRecoveryRequest | undefined>;
}

export interface PendingBootstrapState {
  readonly status: "Pending";
  readonly secretHash: Sha256Digest;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface CompletedBootstrapState {
  readonly status: "Completed";
  readonly completedAt: Date;
  readonly completedByUserId: UserId;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export type PersistedBootstrapState = PendingBootstrapState | CompletedBootstrapState;

export interface InitialiseBootstrapState {
  readonly secretHash: Sha256Digest;
  readonly expiresAt: Date;
  readonly occurredAt: Date;
}

export interface CompleteBootstrapState {
  readonly completedAt: Date;
  readonly completedByUserId: UserId;
  readonly expectedVersion: number;
}

export interface RotatePendingBootstrapState {
  readonly secretHash: Sha256Digest;
  readonly expiresAt: Date;
  readonly occurredAt: Date;
  readonly expectedVersion: number;
}

export interface IdentityBootstrapStateRepository {
  get(): Promise<PersistedBootstrapState | undefined>;
  getForUpdate(): Promise<PersistedBootstrapState | undefined>;
  initialise(command: InitialiseBootstrapState): Promise<PersistedBootstrapState>;
  rotatePending(command: RotatePendingBootstrapState): Promise<PendingBootstrapState | undefined>;
  complete(command: CompleteBootstrapState): Promise<CompletedBootstrapState | undefined>;
}

export type IdentityAuditPrimitive = boolean | number | string | null;
export type IdentityAuditValue =
  | IdentityAuditPrimitive
  | readonly IdentityAuditValue[]
  | { readonly [key: string]: IdentityAuditValue };

export interface AppendIdentityAuditEvent {
  readonly id: string;
  readonly occurredAt: Date;
  readonly eventType: string;
  readonly outcome: "Succeeded" | "Denied" | "Failed";
  readonly actorUserId?: UserId;
  readonly subjectUserId?: UserId;
  readonly sessionId?: string;
  readonly correlationId: string;
  readonly remoteAddressHash?: Sha256Digest;
  readonly details: Readonly<Record<string, IdentityAuditValue>>;
}

export interface IdentityAuditIntegrityInput extends AppendIdentityAuditEvent {
  readonly sequence: bigint;
  readonly previousEventHash?: Sha256Digest;
}

export interface IdentityAuditIntegritySeal {
  readonly version: 1;
  readonly keyId: string;
  readonly eventHash: Uint8Array;
}

export interface IdentityAuditIntegrity {
  seal(event: IdentityAuditIntegrityInput): IdentityAuditIntegritySeal;
}

export interface IdentityAuditAppendResult extends IdentityAuditChainTail {
  readonly eventId: string;
  readonly integrityVersion: 1;
  readonly integrityKeyId: string;
  readonly eventHash: Sha256Digest;
}

export interface IdentityAuditEventRepository {
  append(event: AppendIdentityAuditEvent): Promise<IdentityAuditAppendResult | undefined>;
}

export interface IdentityAuditChainTail {
  readonly sequence: bigint;
  readonly eventId?: string;
  readonly eventHash?: Sha256Digest;
}

export interface IdentityTransactionRepositories {
  readonly auditEvents: IdentityAuditEventRepository;
  readonly authChallenges: IdentityAuthChallengeRepository;
  readonly bootstrapState: IdentityBootstrapStateRepository;
  readonly invitations: IdentityInvitationRepository;
  readonly mfaRecoveryRequests: IdentityMfaRecoveryRequestRepository;
  readonly passwordCredentials: IdentityPasswordCredentialRepository;
  readonly passwordResets: IdentityPasswordResetRepository;
  readonly permissionOverrides: IdentityPermissionOverrideRepository;
  readonly rateLimitBuckets: IdentityRateLimitBucketRepository;
  readonly recoveryCodes: IdentityRecoveryCodeRepository;
  readonly securityPolicy: IdentitySecurityPolicyRepository;
  readonly sessions: IdentitySessionRepository;
  readonly totpCredentials: IdentityTotpCredentialRepository;
  readonly users: IdentityUserRepository;
}

export interface IdentityUnitOfWork {
  execute<Result>(
    operation: (repositories: IdentityTransactionRepositories) => Promise<Result>,
  ): Promise<Result>;
}
