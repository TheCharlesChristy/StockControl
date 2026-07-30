import { describe, expect, it } from "vitest";

import {
  createSha256Digest,
  userId,
  type IdentityTransactionRepositories,
  type Sha256Digest,
} from "@stockcontrol/module-identity";

import { KyselyIdentityUnitOfWork } from "../src";
import {
  authChallengeFromRow,
  passwordResetFromRow,
  rateLimitBucketFromRow,
  recoveryCodeFromRow,
  securityPolicyFromRow,
} from "../src/mappers";
import {
  assertBoundedText,
  assertIntegerInRange,
  assertValidDate,
  identityContextJson,
} from "../src/validation";
import { createRecordingDatabase, testAuditIntegrity } from "./recording-database";

const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T12:10:00.000Z");
const hourLater = new Date("2026-07-29T13:00:00.000Z");
const userUuid = "11111111-1111-4111-8111-111111111111";
const actorUuid = "22222222-2222-4222-8222-222222222222";
const recordUuid = "33333333-3333-4333-8333-333333333333";
const secondRecordUuid = "44444444-4444-4444-8444-444444444444";
const brandedUserId = userId(userUuid);
const brandedActorId = userId(actorUuid);
const digest = (fill = 1): Sha256Digest => createSha256Digest(new Uint8Array(32).fill(fill));
const passwordHash =
  "$sc-argon2id$v=1$a=19,m=65536,t=3,p=1,l=32$abcdefghijklmnop$abcdefghijklmnopqrstuvwxyz123456";

const execute = <Result>(
  database: ReturnType<typeof createRecordingDatabase>["database"],
  operation: (repositories: IdentityTransactionRepositories) => Promise<Result>,
): Promise<Result> => new KyselyIdentityUnitOfWork(database, testAuditIntegrity).execute(operation);

const passwordRow = {
  user_id: userUuid,
  password_hash: passwordHash,
  password_changed_at: now,
  created_at: now,
  updated_at: now,
  version: 1,
};

const recoveryRow = {
  id: recordUuid,
  user_id: userUuid,
  totp_credential_id: secondRecordUuid,
  code_hash: digest(2),
  created_at: now,
  used_at: null,
  revoked_at: null,
};

const challengeRow = {
  id: recordUuid,
  user_id: userUuid,
  purpose: "SignInMfa" as const,
  token_hash: digest(3),
  context: { returnTo: "/inventory", nested: { safe: true } },
  created_at: now,
  expires_at: later,
  consumed_at: null,
  attempt_count: 0,
  maximum_attempts: 5,
  version: 1,
};

const resetRow = {
  id: recordUuid,
  user_id: userUuid,
  token_hash: digest(4),
  requested_at: now,
  expires_at: hourLater,
  completed_at: null,
  revoked_at: null,
  version: 1,
};

const rateLimitRow = {
  bucket_key_hash: digest(5),
  scope: "SignInAccount",
  window_started_at: now,
  expires_at: later,
  attempt_count: 2,
  blocked_until: null,
  updated_at: now,
  version: 1,
};

const securityPolicyRow = {
  singleton_key: 1,
  password_minimum_length: 12,
  password_maximum_length: 128,
  admin_mfa_required: true,
  standard_session_idle_seconds: 7_200,
  admin_session_idle_seconds: 1_800,
  session_absolute_seconds: 43_200,
  recent_authentication_seconds: 900,
  auth_challenge_seconds: 600,
  invitation_seconds: 259_200,
  password_reset_seconds: 3_600,
  permission_catalogue_version: 1,
  updated_at: now,
  version: 1,
};

const recoveryRequestRow = {
  id: recordUuid,
  subject_user_id: userUuid,
  requested_by_user_id: userUuid,
  approval_method: null,
  approved_by_user_id: null,
  vendor_case_reference: null,
  status: "Pending" as const,
  reason: "Lost authenticator",
  requested_at: now,
  expires_at: hourLater,
  resolved_at: null,
  completed_at: null,
  version: 1,
};

const pendingTotpRow = {
  id: recordUuid,
  user_id: userUuid,
  status: "Pending" as const,
  secret_encryption_version: 1,
  secret_key_id: "identity-key-1",
  secret_nonce: new Uint8Array(12),
  secret_ciphertext: new Uint8Array(32),
  secret_auth_tag: new Uint8Array(16),
  last_accepted_counter: null,
  verified_at: null,
  recovery_codes_acknowledged_at: null,
  revoked_at: null,
  created_at: now,
  updated_at: now,
  version: 1,
};

describe("password credential repository", () => {
  it("inserts, locks, and replaces password credentials with optimistic concurrency", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([passwordRow]);
    await expect(
      execute(insert.database, ({ passwordCredentials }) =>
        passwordCredentials.insert({
          userId: brandedUserId,
          passwordHash,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ).resolves.toMatchObject({ userId: brandedUserId, version: 1 });

    const find = createRecordingDatabase();
    find.driver.enqueueRows([passwordRow]);
    await expect(
      execute(find.database, ({ passwordCredentials }) =>
        passwordCredentials.findByUserIdForUpdate(brandedUserId),
      ),
    ).resolves.toMatchObject({ passwordHash });
    expect(find.driver.queries[0]?.sql).toContain("for update");

    const replace = createRecordingDatabase();
    replace.driver.enqueueRows([{ ...passwordRow, password_changed_at: later, version: 2 }]);
    await expect(
      execute(replace.database, ({ passwordCredentials }) =>
        passwordCredentials.replace({
          userId: brandedUserId,
          passwordHash,
          passwordChangedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({ version: 2, passwordChangedAt: later });

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ passwordCredentials }) =>
        passwordCredentials.replace({
          userId: brandedUserId,
          passwordHash,
          passwordChangedAt: later,
          expectedVersion: 99,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("rejects non-StockControl password encodings", async () => {
    const { database } = createRecordingDatabase();
    await expect(
      execute(database, ({ passwordCredentials }) =>
        passwordCredentials.insert({
          userId: brandedUserId,
          passwordHash: "$argon2id$unsafe",
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ).rejects.toMatchObject({ code: "PasswordHashInvalid" });

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], []);
    await expect(
      execute(missing.database, ({ passwordCredentials }) =>
        passwordCredentials.findByUserIdForUpdate(brandedUserId),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ passwordCredentials }) =>
        passwordCredentials.replace({
          userId: brandedUserId,
          passwordHash,
          passwordChangedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("recovery-code repository", () => {
  it("stores a bounded set, locks exact available hashes, consumes once, and revokes leftovers", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([
      recoveryRow,
      { ...recoveryRow, id: secondRecordUuid, code_hash: digest(6) },
    ]);
    await expect(
      execute(insert.database, ({ recoveryCodes }) =>
        recoveryCodes.insertMany([
          {
            id: recordUuid,
            userId: brandedUserId,
            totpCredentialId: secondRecordUuid,
            codeHash: digest(2),
            createdAt: now,
          },
          {
            id: secondRecordUuid,
            userId: brandedUserId,
            totpCredentialId: recordUuid,
            codeHash: digest(6),
            createdAt: now,
          },
        ]),
      ),
    ).resolves.toHaveLength(2);

    const available = createRecordingDatabase();
    available.driver.enqueueRows([{ id: recordUuid }]);
    await expect(
      execute(available.database, ({ recoveryCodes }) =>
        recoveryCodes.hasAvailableForCredential(brandedUserId, secondRecordUuid),
      ),
    ).resolves.toBe(true);
    expect(available.driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([userUuid, secondRecordUuid]),
    );

    const unavailable = createRecordingDatabase();
    unavailable.driver.enqueueRows([]);
    await expect(
      execute(unavailable.database, ({ recoveryCodes }) =>
        recoveryCodes.hasAvailableForCredential(brandedUserId, secondRecordUuid),
      ),
    ).resolves.toBe(false);

    const find = createRecordingDatabase();
    find.driver.enqueueRows([recoveryRow]);
    await expect(
      execute(find.database, ({ recoveryCodes }) =>
        recoveryCodes.findAvailableByHashForUpdate(brandedUserId, secondRecordUuid, digest(2)),
      ),
    ).resolves.toMatchObject({ id: recordUuid });
    expect(find.driver.queries[0]?.sql).toContain("for update");
    expect(find.driver.queries[0]?.sql).toContain('"identity_totp_credentials"."status" =');
    expect(find.driver.queries[0]?.sql).toContain('"identity_users"."status" =');
    expect(find.driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([userUuid, secondRecordUuid, "Active"]),
    );

    const consume = createRecordingDatabase();
    consume.driver.enqueueRows([{ ...recoveryRow, used_at: later }]);
    await expect(
      execute(consume.database, ({ recoveryCodes }) =>
        recoveryCodes.consume({
          id: recordUuid,
          userId: brandedUserId,
          totpCredentialId: secondRecordUuid,
          codeHash: digest(2),
          usedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ usedAt: later });
    expect(consume.driver.queries[0]?.sql).toContain(
      'exists (select "stockcontrol"."identity_totp_credentials"."id"',
    );
    expect(consume.driver.queries[0]?.sql).toContain(
      '"stockcontrol"."identity_totp_credentials"."id" = "stockcontrol"."identity_recovery_codes"."totp_credential_id"',
    );
    expect(consume.driver.queries[0]?.sql).toContain(
      '"stockcontrol"."identity_totp_credentials"."user_id" = "stockcontrol"."identity_recovery_codes"."user_id"',
    );
    expect(consume.driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([recordUuid, userUuid, secondRecordUuid, digest(2), "Active"]),
    );

    const revoke = createRecordingDatabase();
    revoke.driver.enqueueAffectedRows(3n);
    await expect(
      execute(revoke.database, ({ recoveryCodes }) =>
        recoveryCodes.revokeAvailableForCredential(brandedUserId, secondRecordUuid, later),
      ),
    ).resolves.toBe(3);
  });

  it("rejects empty and oversized recovery-code sets", async () => {
    for (const commands of [
      [],
      Array.from({ length: 51 }, (_, index) => ({
        id: recordUuid,
        userId: brandedUserId,
        totpCredentialId: secondRecordUuid,
        codeHash: digest(index),
        createdAt: now,
      })),
    ]) {
      const { database } = createRecordingDatabase();
      await expect(
        execute(database, ({ recoveryCodes }) => recoveryCodes.insertMany(commands)),
      ).rejects.toMatchObject({ code: "IntegerInvalid" });
    }

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], []);
    await expect(
      execute(missing.database, ({ recoveryCodes }) =>
        recoveryCodes.findAvailableByHashForUpdate(brandedUserId, secondRecordUuid, digest(2)),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ recoveryCodes }) =>
        recoveryCodes.consume({
          id: recordUuid,
          userId: brandedUserId,
          totpCredentialId: secondRecordUuid,
          codeHash: digest(2),
          usedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("authentication challenge repository", () => {
  it("persists bounded context and applies open, attempt, expiry, and CAS predicates", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([challengeRow]);
    await expect(
      execute(insert.database, ({ authChallenges }) =>
        authChallenges.insert({
          id: recordUuid,
          userId: brandedUserId,
          purpose: "SignInMfa",
          tokenHash: digest(3),
          context: { returnTo: "/inventory", nested: { safe: true } },
          createdAt: now,
          expiresAt: later,
          maximumAttempts: 5,
        }),
      ),
    ).resolves.toMatchObject({ attemptCount: 0, maximumAttempts: 5 });

    const find = createRecordingDatabase();
    find.driver.enqueueRows([challengeRow]);
    await expect(
      execute(find.database, ({ authChallenges }) =>
        authChallenges.findOpenByTokenHashForUpdate(digest(3), now),
      ),
    ).resolves.toMatchObject({ id: recordUuid });
    expect(find.driver.queries[0]?.sql).toContain("for update");

    const fail = createRecordingDatabase();
    fail.driver.enqueueRows([{ ...challengeRow, attempt_count: 1, version: 2 }]);
    await expect(
      execute(fail.database, ({ authChallenges }) =>
        authChallenges.recordFailure({
          id: recordUuid,
          expectedVersion: 1,
          occurredAt: later,
        }),
      ),
    ).resolves.toMatchObject({ attemptCount: 1, version: 2 });

    const consume = createRecordingDatabase();
    consume.driver.enqueueRows([{ ...challengeRow, consumed_at: later, version: 2 }]);
    await expect(
      execute(consume.database, ({ authChallenges }) =>
        authChallenges.consume({
          id: recordUuid,
          expectedVersion: 1,
          consumedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ consumedAt: later });
  });

  it("rejects unsupported purposes, excessive lifetimes, attempts, and unsafe JSON", async () => {
    const base = {
      id: recordUuid,
      userId: brandedUserId,
      purpose: "SignInMfa" as const,
      tokenHash: digest(3),
      context: {},
      createdAt: now,
      expiresAt: later,
      maximumAttempts: 5,
    };
    const invalid = [
      { ...base, purpose: "Unknown" as never },
      { ...base, userId: undefined as never },
      { ...base, expiresAt: new Date("2026-07-29T14:00:00.000Z") },
      { ...base, maximumAttempts: 0 },
      { ...base, context: { value: Number.NaN } },
    ];

    for (const command of invalid) {
      const { database } = createRecordingDatabase();
      await expect(
        execute(database, ({ authChallenges }) => authChallenges.insert(command)),
      ).rejects.toBeInstanceOf(Error);
    }

    const conflicts = createRecordingDatabase();
    conflicts.driver.enqueueRows([], [], []);
    await expect(
      execute(conflicts.database, ({ authChallenges }) =>
        authChallenges.findOpenByTokenHashForUpdate(digest(3), now),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(conflicts.database, ({ authChallenges }) =>
        authChallenges.recordFailure({
          id: recordUuid,
          expectedVersion: 1,
          occurredAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(conflicts.database, ({ authChallenges }) =>
        authChallenges.consume({
          id: recordUuid,
          expectedVersion: 1,
          consumedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("password-reset and rate-limit repositories", () => {
  it("creates, finds, completes, and revokes open password resets", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([resetRow]);
    await expect(
      execute(insert.database, ({ passwordResets }) =>
        passwordResets.insert({
          id: recordUuid,
          userId: brandedUserId,
          tokenHash: digest(4),
          requestedAt: now,
          expiresAt: hourLater,
        }),
      ),
    ).resolves.toMatchObject({ id: recordUuid });

    const find = createRecordingDatabase();
    find.driver.enqueueRows([resetRow]);
    await expect(
      execute(find.database, ({ passwordResets }) =>
        passwordResets.findOpenByTokenHashForUpdate(digest(4), now),
      ),
    ).resolves.toMatchObject({ userId: brandedUserId });

    const complete = createRecordingDatabase();
    complete.driver.enqueueRows([{ ...resetRow, completed_at: later, version: 2 }]);
    await expect(
      execute(complete.database, ({ passwordResets }) =>
        passwordResets.complete({
          id: recordUuid,
          expectedVersion: 1,
          completedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ completedAt: later, version: 2 });

    const revoke = createRecordingDatabase();
    revoke.driver.enqueueAffectedRows(2n);
    await expect(
      execute(revoke.database, ({ passwordResets }) =>
        passwordResets.revokeOpenForUser(brandedUserId, later),
      ),
    ).resolves.toBe(2);

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], []);
    await expect(
      execute(missing.database, ({ passwordResets }) =>
        passwordResets.findOpenByTokenHashForUpdate(digest(4), now),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ passwordResets }) =>
        passwordResets.complete({
          id: recordUuid,
          expectedVersion: 1,
          completedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("locks, creates, replaces, and clears exact rate-limit buckets", async () => {
    const find = createRecordingDatabase();
    find.driver.enqueueRows([rateLimitRow]);
    await expect(
      execute(find.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.findForUpdate(digest(5), "SignInAccount"),
      ),
    ).resolves.toMatchObject({ failureCount: 2 });

    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([rateLimitRow]);
    await expect(
      execute(insert.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.insert({
          bucketKeyHash: digest(5),
          scope: "SignInAccount",
          windowStartedAt: now,
          expiresAt: later,
          failureCount: 2,
          updatedAt: now,
        }),
      ),
    ).resolves.toMatchObject({ version: 1 });

    const replace = createRecordingDatabase();
    replace.driver.enqueueRows([
      {
        ...rateLimitRow,
        attempt_count: 5,
        blocked_until: hourLater,
        updated_at: later,
        version: 2,
      },
    ]);
    await expect(
      execute(replace.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.replace({
          bucketKeyHash: digest(5),
          scope: "SignInAccount",
          windowStartedAt: now,
          expiresAt: later,
          failureCount: 5,
          blockedUntil: hourLater,
          updatedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({ blockedUntil: hourLater, version: 2 });

    const clear = createRecordingDatabase();
    clear.driver.enqueueAffectedRows(1n);
    await expect(
      execute(clear.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.clear(digest(5), "SignInAccount"),
      ),
    ).resolves.toBe(true);

    const absent = createRecordingDatabase();
    absent.driver.enqueueRows([]);
    absent.driver.enqueueAffectedRows(0n);
    await expect(
      execute(absent.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.findForUpdate(digest(5), "SignInAccount"),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(absent.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.clear(digest(5), "SignInAccount"),
      ),
    ).resolves.toBe(false);

    const invalid = createRecordingDatabase();
    await expect(
      execute(invalid.database, ({ rateLimitBuckets }) =>
        rateLimitBuckets.insert({
          bucketKeyHash: digest(5),
          scope: "SignInAccount",
          windowStartedAt: now,
          expiresAt: later,
          failureCount: 1,
          blockedUntil: new Date("2026-07-28T12:00:00.000Z"),
          updatedAt: now,
        }),
      ),
    ).rejects.toMatchObject({ code: "DateInvalid" });
  });
});

describe("security policy and MFA recovery repositories", () => {
  it("reads, locks, validates, and replaces the singleton security policy", async () => {
    const read = createRecordingDatabase();
    read.driver.enqueueRows([securityPolicyRow], [securityPolicyRow]);
    await expect(
      execute(read.database, ({ securityPolicy }) => securityPolicy.get()),
    ).resolves.toMatchObject({
      adminMfaRequired: true,
      adminSessionIdleSeconds: 1_800,
    });
    await expect(
      execute(read.database, ({ securityPolicy }) => securityPolicy.getForUpdate()),
    ).resolves.toMatchObject({ permissionCatalogueVersion: 1 });
    expect(read.driver.queries[1]?.sql).toContain("for update");

    const replace = createRecordingDatabase();
    replace.driver.enqueueRows([{ ...securityPolicyRow, version: 2, updated_at: later }]);
    await expect(
      execute(replace.database, ({ securityPolicy }) =>
        securityPolicy.replace({
          passwordMinimumLength: 12,
          passwordMaximumLength: 128,
          adminMfaRequired: true,
          standardSessionIdleSeconds: 7_200,
          adminSessionIdleSeconds: 1_800,
          sessionAbsoluteSeconds: 43_200,
          recentAuthenticationSeconds: 900,
          authChallengeSeconds: 600,
          invitationSeconds: 259_200,
          passwordResetSeconds: 3_600,
          permissionCatalogueVersion: 1,
          updatedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({ version: 2 });

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ securityPolicy }) =>
        securityPolicy.replace({
          passwordMinimumLength: 12,
          passwordMaximumLength: 128,
          adminMfaRequired: true,
          standardSessionIdleSeconds: 7_200,
          adminSessionIdleSeconds: 1_800,
          sessionAbsoluteSeconds: 43_200,
          recentAuthenticationSeconds: 900,
          authChallengeSeconds: 600,
          invitationSeconds: 259_200,
          passwordResetSeconds: 3_600,
          permissionCatalogueVersion: 1,
          updatedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      execute(conflict.database, ({ securityPolicy }) =>
        securityPolicy.replace({
          passwordMinimumLength: 12,
          passwordMaximumLength: 128,
          adminMfaRequired: false as true,
          standardSessionIdleSeconds: 7_200,
          adminSessionIdleSeconds: 1_800,
          sessionAbsoluteSeconds: 43_200,
          recentAuthenticationSeconds: 900,
          authChallengeSeconds: 600,
          invitationSeconds: 259_200,
          passwordResetSeconds: 3_600,
          permissionCatalogueVersion: 1,
          updatedAt: later,
          expectedVersion: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "ScopeInvalid" });
  });

  it("creates, approves with separation, closes, and completes MFA recovery", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([recoveryRequestRow]);
    await expect(
      execute(insert.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.insert({
          id: recordUuid,
          subjectUserId: brandedUserId,
          requestedByUserId: brandedUserId,
          reason: " Lost authenticator ",
          requestedAt: now,
          expiresAt: hourLater,
        }),
      ),
    ).resolves.toMatchObject({ status: "Pending", reason: "Lost authenticator" });

    const find = createRecordingDatabase();
    find.driver.enqueueRows([recoveryRequestRow]);
    await expect(
      execute(find.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.findByIdForUpdate(recordUuid),
      ),
    ).resolves.toMatchObject({ subjectUserId: brandedUserId });

    const approve = createRecordingDatabase();
    approve.driver.enqueueRows([
      {
        ...recoveryRequestRow,
        approval_method: "ActiveAdmin" as const,
        approved_by_user_id: actorUuid,
        status: "Approved",
        resolved_at: later,
        version: 2,
      },
    ]);
    await expect(
      execute(approve.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.approve({
          id: recordUuid,
          expectedVersion: 1,
          approvalMethod: "ActiveAdmin",
          approvedByUserId: brandedActorId,
          resolvedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ status: "Approved", approvedByUserId: brandedActorId });

    const vendorApprove = createRecordingDatabase();
    vendorApprove.driver.enqueueRows([
      {
        ...recoveryRequestRow,
        approval_method: "VendorVerification" as const,
        vendor_case_reference: "SUPPORT-2026-1042",
        status: "Approved",
        resolved_at: later,
        version: 2,
      },
    ]);
    await expect(
      execute(vendorApprove.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.approve({
          id: recordUuid,
          expectedVersion: 1,
          approvalMethod: "VendorVerification",
          vendorCaseReference: " SUPPORT-2026-1042 ",
          resolvedAt: later,
        }),
      ),
    ).resolves.toMatchObject({
      approvalMethod: "VendorVerification",
      vendorCaseReference: "SUPPORT-2026-1042",
    });

    const close = createRecordingDatabase();
    close.driver.enqueueRows([
      { ...recoveryRequestRow, status: "Cancelled", resolved_at: later, version: 2 },
    ]);
    await expect(
      execute(close.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.close({
          id: recordUuid,
          expectedVersion: 1,
          status: "Cancelled",
          resolvedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ status: "Cancelled" });

    const complete = createRecordingDatabase();
    complete.driver.enqueueRows([
      {
        ...recoveryRequestRow,
        approval_method: "ActiveAdmin" as const,
        approved_by_user_id: actorUuid,
        status: "Completed",
        resolved_at: later,
        completed_at: later,
        version: 3,
      },
    ]);
    await expect(
      execute(complete.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.complete({
          id: recordUuid,
          expectedVersion: 2,
          completedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ status: "Completed", completedAt: later });

    const expired = createRecordingDatabase();
    expired.driver.enqueueRows([
      { ...recoveryRequestRow, status: "Expired", resolved_at: hourLater, version: 2 },
    ]);
    await expect(
      execute(expired.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.close({
          id: recordUuid,
          expectedVersion: 1,
          status: "Expired",
          resolvedAt: hourLater,
        }),
      ),
    ).resolves.toMatchObject({ status: "Expired" });

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], [], [], []);
    await expect(
      execute(missing.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.findByIdForUpdate(recordUuid),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.approve({
          id: recordUuid,
          expectedVersion: 1,
          approvalMethod: "ActiveAdmin",
          approvedByUserId: brandedActorId,
          resolvedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.close({
          id: recordUuid,
          expectedVersion: 1,
          status: "Rejected",
          resolvedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.complete({
          id: recordUuid,
          expectedVersion: 1,
          completedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(
      execute(missing.database, ({ mfaRecoveryRequests }) =>
        mfaRecoveryRequests.close({
          id: recordUuid,
          expectedVersion: 1,
          status: "Unknown" as never,
          resolvedAt: later,
        }),
      ),
    ).rejects.toMatchObject({ code: "ScopeInvalid" });
  });
});

describe("TOTP re-encryption and strict mapper branches", () => {
  it("re-encrypts an unrevoked credential by version and reports conflicts", async () => {
    const reencrypt = createRecordingDatabase();
    reencrypt.driver.enqueueRows([
      {
        ...pendingTotpRow,
        secret_key_id: "identity-key-2",
        updated_at: later,
        version: 2,
      },
    ]);
    await expect(
      execute(reencrypt.database, ({ totpCredentials }) =>
        totpCredentials.reencrypt({
          id: recordUuid,
          expectedVersion: 1,
          secretEncryptionVersion: 1,
          secretKeyId: "identity-key-2",
          secretNonce: new Uint8Array(12),
          secretCiphertext: new Uint8Array(32),
          secretAuthTag: new Uint8Array(16),
          occurredAt: later,
        }),
      ),
    ).resolves.toMatchObject({ secretKeyId: "identity-key-2", version: 2 });

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ totpCredentials }) =>
        totpCredentials.reencrypt({
          id: recordUuid,
          expectedVersion: 99,
          secretEncryptionVersion: 1,
          secretKeyId: "identity-key-2",
          secretNonce: new Uint8Array(12),
          secretCiphertext: new Uint8Array(32),
          secretAuthTag: new Uint8Array(16),
          occurredAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("maps terminal optional values and fails closed on corrupt stored variants", () => {
    expect(recoveryCodeFromRow({ ...recoveryRow, revoked_at: later })).toMatchObject({
      revokedAt: later,
    });
    expect(passwordResetFromRow({ ...resetRow, revoked_at: later })).toMatchObject({
      revokedAt: later,
    });
    expect(
      authChallengeFromRow({
        ...challengeRow,
        consumed_at: later,
      }),
    ).toMatchObject({ consumedAt: later });
    expect(() =>
      authChallengeFromRow({
        ...challengeRow,
        context: [] as never,
      }),
    ).toThrow("non-object");
    expect(() =>
      rateLimitBucketFromRow({
        ...rateLimitRow,
        scope: "Unknown",
      }),
    ).toThrow("unknown authentication rate-limit scope");
    expect(() =>
      securityPolicyFromRow({
        ...securityPolicyRow,
        admin_mfa_required: false,
      }),
    ).toThrow("unsupported identity security policy");
  });

  it("exercises bounded primitive and JSON validation failure paths", () => {
    expect(() => assertValidDate(new Date(Number.NaN), "Time")).toThrow("valid instant");
    expect(() => assertIntegerInRange(1.5, 1, 5, "Count")).toThrow("integer");
    expect(() => assertBoundedText("bad\ntext", 20, "Text")).toThrow("non-control");
    expect(() => identityContextJson({ "": true })).toThrow("keys");
    expect(() =>
      identityContextJson({
        oversized: Array.from({ length: 1_001 }, () => true),
      }),
    ).toThrow("1000 entries");
    expect(() =>
      identityContextJson(
        Object.fromEntries(
          Array.from({ length: 1_001 }, (_, index) => [`key-${String(index)}`, true]),
        ),
      ),
    ).toThrow("1000 entries");

    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 34; depth += 1) {
      nested = { nested };
    }
    expect(() => identityContextJson(nested as never)).toThrow("nesting depth");
  });
});
