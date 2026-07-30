import {
  normaliseEmailAddress,
  userDisplayName,
  userId,
  type IdentityAuditIntegrity,
  type IdentityTransactionRepositories,
  type Sha256Digest,
} from "@stockcontrol/module-identity";
import { describe, expect, it } from "vitest";

import { KyselyIdentityUnitOfWork } from "../src/kysely-identity-unit-of-work";
import { createRecordingDatabase, testAuditIntegrity } from "./recording-database";

const now = new Date("2026-07-29T12:00:00.000Z");
const later = new Date("2026-07-29T13:00:00.000Z");
const latest = new Date("2026-07-29T14:00:00.000Z");
const userUuid = "11111111-1111-4111-8111-111111111111";
const actorUuid = "22222222-2222-4222-8222-222222222222";
const recordUuid = "33333333-3333-4333-8333-333333333333";
const correlationUuid = "44444444-4444-4444-8444-444444444444";
const brandedUserId = userId(userUuid);
const brandedActorId = userId(actorUuid);
const digest = (fill = 1): Sha256Digest => new Uint8Array(32).fill(fill) as Sha256Digest;

const userRow = {
  id: userUuid,
  normalised_email: "admin@example.test",
  display_name: "Admin User",
  role: "Admin" as const,
  status: "Active" as const,
  created_at: now,
  updated_at: later,
  version: 2,
};

const permissionRow = {
  user_id: userUuid,
  capability: "users.manage",
  setting: "Deny" as const,
  catalogue_version: 1,
  updated_by_user_id: actorUuid,
  created_at: now,
  updated_at: later,
};

const sessionRow = {
  id: recordUuid,
  user_id: userUuid,
  token_hash: digest(2),
  authentication_method: "PasswordAndTotp" as const,
  assurance_level: "MultiFactor" as const,
  issued_at: now,
  last_seen_at: now,
  idle_expires_at: later,
  absolute_expires_at: latest,
  reauthenticated_at: null,
  revoked_at: null,
  revoke_reason: null,
  created_ip_hash: null,
  user_agent: null,
  version: 1,
};

const invitationRow = {
  id: recordUuid,
  user_id: userUuid,
  invited_by_user_id: actorUuid,
  token_hash: digest(4),
  created_at: now,
  expires_at: later,
  accepted_at: null,
  revoked_at: null,
  version: 1,
};

const totpPendingRow = {
  id: recordUuid,
  user_id: userUuid,
  status: "Pending" as const,
  secret_encryption_version: 1,
  secret_key_id: "identity-key-1",
  secret_nonce: new Uint8Array(12).fill(1),
  secret_ciphertext: new Uint8Array(32).fill(2),
  secret_auth_tag: new Uint8Array(16).fill(3),
  last_accepted_counter: null,
  verified_at: null,
  recovery_codes_acknowledged_at: null,
  revoked_at: null,
  created_at: now,
  updated_at: now,
  version: 1,
};

const execute = <Result>(
  database: ReturnType<typeof createRecordingDatabase>["database"],
  operation: (repositories: IdentityTransactionRepositories) => Promise<Result>,
): Promise<Result> => new KyselyIdentityUnitOfWork(database, testAuditIntegrity).execute(operation);

describe("Kysely identity unit of work", () => {
  it("commits successful work at serializable isolation and exposes frozen repositories", async () => {
    const { database, driver } = createRecordingDatabase();

    await expect(
      execute(database, (repositories) => {
        expect(Object.isFrozen(repositories)).toBe(true);
        return Promise.resolve("committed");
      }),
    ).resolves.toBe("committed");
    expect(driver.transactions).toEqual([
      { kind: "begin", settings: { isolationLevel: "serializable" } },
      { kind: "commit" },
    ]);
  });

  it("rolls back thrown application decisions", async () => {
    const { database, driver } = createRecordingDatabase();
    const decision = new Error("policy denied");

    await expect(execute(database, () => Promise.reject(decision))).rejects.toBe(decision);
    expect(driver.transactions).toEqual([
      { kind: "begin", settings: { isolationLevel: "serializable" } },
      { kind: "rollback" },
    ]);
  });
});

describe("user and permission repositories", () => {
  it("finds users by ID and email with effective override inputs", async () => {
    const first = createRecordingDatabase();
    first.driver.enqueueRows([userRow], [permissionRow]);

    await expect(
      execute(first.database, ({ users }) => users.findById(brandedUserId)),
    ).resolves.toMatchObject({
      id: userUuid,
      email: "admin@example.test",
      permissionSettings: { "users.manage": "Deny" },
    });
    expect(first.driver.queries.map(({ sql }) => sql)).toEqual([
      expect.stringContaining('"stockcontrol"."identity_users"'),
      expect.stringContaining('"stockcontrol"."identity_permission_overrides"'),
    ]);

    const second = createRecordingDatabase();
    second.driver.enqueueRows([userRow], []);
    await expect(
      execute(second.database, ({ users }) =>
        users.findByEmail(normaliseEmailAddress("ADMIN@EXAMPLE.TEST")),
      ),
    ).resolves.toMatchObject({ id: userUuid, permissionSettings: {} });
    expect(second.driver.queries[0]?.parameters).toContain("admin@example.test");
  });

  it("returns undefined without querying overrides when no user exists", async () => {
    const byId = createRecordingDatabase();
    byId.driver.enqueueRows([]);

    await expect(
      execute(byId.database, ({ users }) => users.findById(brandedUserId)),
    ).resolves.toBeUndefined();
    expect(byId.driver.queries).toHaveLength(1);

    const byEmail = createRecordingDatabase();
    byEmail.driver.enqueueRows([]);
    await expect(
      execute(byEmail.database, ({ users }) =>
        users.findByEmail(normaliseEmailAddress("missing@example.test")),
      ),
    ).resolves.toBeUndefined();
  });

  it("inserts and optimistically replaces complete user records", async () => {
    const insert = createRecordingDatabase();
    insert.driver.enqueueRows([userRow]);

    await expect(
      execute(insert.database, ({ users }) =>
        users.insert({
          id: brandedUserId,
          email: normaliseEmailAddress("ADMIN@EXAMPLE.TEST"),
          displayName: userDisplayName("Admin User"),
          role: "Admin",
          status: "Active",
          occurredAt: now,
        }),
      ),
    ).resolves.toMatchObject({ id: userUuid, version: 2 });
    expect(insert.driver.queries[0]?.sql).toContain("insert into");

    const replace = createRecordingDatabase();
    replace.driver.enqueueRows([userRow], [permissionRow]);
    await expect(
      execute(replace.database, ({ users }) =>
        users.replace({
          id: brandedUserId,
          email: normaliseEmailAddress("admin@example.test"),
          displayName: userDisplayName("Admin User"),
          role: "Admin",
          status: "Active",
          expectedVersion: 1,
          occurredAt: later,
        }),
      ),
    ).resolves.toMatchObject({
      version: 2,
      permissionSettings: { "users.manage": "Deny" },
    });
    expect(replace.driver.queries[0]?.sql).toContain('"version" = "version" + $');

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ users }) =>
        users.replace({
          id: brandedUserId,
          email: normaliseEmailAddress("admin@example.test"),
          displayName: userDisplayName("Admin User"),
          role: "Admin",
          status: "Disabled",
          expectedVersion: 99,
          occurredAt: latest,
        }),
      ),
    ).resolves.toBeUndefined();
    expect(conflict.driver.queries).toHaveLength(1);
  });

  it("locks the complete roster before resolving overrides", async () => {
    const populated = createRecordingDatabase();
    populated.driver.enqueueRows(
      [
        {
          id: userUuid,
          role: "Admin",
          status: "Active",
        },
        {
          id: actorUuid,
          role: "Office",
          status: "Active",
        },
      ],
      [permissionRow],
    );

    await expect(
      execute(populated.database, ({ users }) => users.lockAdministrativeRoster()),
    ).resolves.toEqual([
      {
        id: userUuid,
        role: "Admin",
        status: "Active",
        permissionSettings: { "users.manage": "Deny" },
      },
      {
        id: actorUuid,
        role: "Office",
        status: "Active",
        permissionSettings: {},
      },
    ]);
    expect(populated.driver.queries[0]?.sql).toContain("for update");
    expect(populated.driver.queries[1]?.sql).toContain('"user_id" in');

    const empty = createRecordingDatabase();
    empty.driver.enqueueRows([]);
    await expect(
      execute(empty.database, ({ users }) => users.lockAdministrativeRoster()),
    ).resolves.toEqual([]);
    expect(empty.driver.queries).toHaveLength(1);
  });

  it("lists, resolves, clears and replaces permission overrides", async () => {
    const list = createRecordingDatabase();
    list.driver.enqueueRows([permissionRow], [permissionRow]);

    await expect(
      execute(list.database, ({ permissionOverrides }) =>
        permissionOverrides.listForUser(brandedUserId),
      ),
    ).resolves.toEqual([
      {
        userId: brandedUserId,
        capability: "users.manage",
        setting: "Deny",
        catalogueVersion: 1,
        updatedByUserId: brandedActorId,
        createdAt: now,
        updatedAt: later,
      },
    ]);
    await expect(
      execute(list.database, ({ permissionOverrides }) =>
        permissionOverrides.settingsForUser(brandedUserId),
      ),
    ).resolves.toEqual({ "users.manage": "Deny" });

    const clear = createRecordingDatabase();
    await execute(clear.database, ({ permissionOverrides }) =>
      permissionOverrides.replaceForUser({
        userId: brandedUserId,
        settings: { "users.manage": "UseRoleDefault" },
        updatedByUserId: brandedActorId,
        occurredAt: now,
      }),
    );
    expect(clear.driver.queries).toHaveLength(1);
    expect(clear.driver.queries[0]?.sql).toContain("delete from");

    const replace = createRecordingDatabase();
    await execute(replace.database, ({ permissionOverrides }) =>
      permissionOverrides.replaceForUser({
        userId: brandedUserId,
        settings: {
          "users.manage": "Allow",
          "users.permissions.manage": "Deny",
        },
        updatedByUserId: brandedActorId,
        occurredAt: now,
      }),
    );
    expect(replace.driver.queries).toHaveLength(2);
    expect(replace.driver.queries[1]?.sql).toContain("insert into");
    expect(replace.driver.queries[1]?.parameters).toEqual(
      expect.arrayContaining(["users.manage", "Allow", "users.permissions.manage", "Deny", 1]),
    );
  });
});

describe("session repository", () => {
  it("inserts sessions containing only token digests and maps optional metadata", async () => {
    const minimal = createRecordingDatabase();
    minimal.driver.enqueueRows([sessionRow]);

    await expect(
      execute(minimal.database, ({ sessions }) =>
        sessions.insert({
          id: recordUuid,
          userId: brandedUserId,
          tokenHash: digest(2),
          authenticationMethod: "PasswordAndTotp",
          assuranceLevel: "MultiFactor",
          issuedAt: now,
          lastSeenAt: now,
          idleExpiresAt: later,
          absoluteExpiresAt: latest,
        }),
      ),
    ).resolves.toMatchObject({ id: recordUuid, version: 1 });
    expect(minimal.driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([digest(2), "PasswordAndTotp", "MultiFactor"]),
    );

    const richRow = {
      ...sessionRow,
      reauthenticated_at: now,
      created_ip_hash: digest(5),
      user_agent: "Browser",
    };
    const rich = createRecordingDatabase();
    rich.driver.enqueueRows([richRow]);
    await expect(
      execute(rich.database, ({ sessions }) =>
        sessions.insert({
          id: recordUuid,
          userId: brandedUserId,
          tokenHash: digest(2),
          authenticationMethod: "PasswordAndTotp",
          assuranceLevel: "MultiFactor",
          issuedAt: now,
          lastSeenAt: now,
          idleExpiresAt: later,
          absoluteExpiresAt: latest,
          reauthenticatedAt: now,
          createdIpHash: digest(5),
          userAgent: "Browser",
        }),
      ),
    ).resolves.toMatchObject({
      reauthenticatedAt: now,
      createdIpHash: digest(5),
      userAgent: "Browser",
    });
  });

  it("locks session lookup and represents a missing hash without ambiguity", async () => {
    const found = createRecordingDatabase();
    found.driver.enqueueRows([sessionRow]);
    await expect(
      execute(found.database, ({ sessions }) =>
        sessions.findActiveByTokenHashForUpdate(digest(2), now),
      ),
    ).resolves.toMatchObject({ id: recordUuid });
    expect(found.driver.queries[0]?.sql).toContain("for update");

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([]);
    await expect(
      execute(missing.database, ({ sessions }) =>
        sessions.findActiveByTokenHashForUpdate(digest(9), now),
      ),
    ).resolves.toBeUndefined();
  });

  it("touches and revokes by optimistic version and revokes all active user sessions", async () => {
    const touch = createRecordingDatabase();
    touch.driver.enqueueRows([{ ...sessionRow, version: 2, last_seen_at: later }]);
    await expect(
      execute(touch.database, ({ sessions }) =>
        sessions.touch({
          id: recordUuid,
          expectedVersion: 1,
          lastSeenAt: later,
          idleExpiresAt: latest,
        }),
      ),
    ).resolves.toMatchObject({ version: 2, lastSeenAt: later });

    const touchConflict = createRecordingDatabase();
    touchConflict.driver.enqueueRows([]);
    await expect(
      execute(touchConflict.database, ({ sessions }) =>
        sessions.touch({
          id: recordUuid,
          expectedVersion: 99,
          lastSeenAt: later,
          idleExpiresAt: latest,
        }),
      ),
    ).resolves.toBeUndefined();

    const revoke = createRecordingDatabase();
    revoke.driver.enqueueRows([
      {
        ...sessionRow,
        revoked_at: later,
        revoke_reason: "approved by office",
        version: 2,
      },
    ]);
    await expect(
      execute(revoke.database, ({ sessions }) =>
        sessions.revoke({
          id: recordUuid,
          expectedVersion: 1,
          revokedAt: later,
          reason: " approved by office ",
        }),
      ),
    ).resolves.toMatchObject({
      revokedAt: later,
      revokeReason: "approved by office",
    });

    const revokeConflict = createRecordingDatabase();
    revokeConflict.driver.enqueueRows([]);
    await expect(
      execute(revokeConflict.database, ({ sessions }) =>
        sessions.revoke({
          id: recordUuid,
          expectedVersion: 99,
          revokedAt: later,
          reason: "conflict",
        }),
      ),
    ).resolves.toBeUndefined();

    const all = createRecordingDatabase();
    all.driver.enqueueAffectedRows(3n);
    await expect(
      execute(all.database, ({ sessions }) =>
        sessions.revokeAllForUser(brandedUserId, later, "role changed"),
      ),
    ).resolves.toBe(3);
  });
});

describe("TOTP credential repository", () => {
  it("persists only versioned AES-GCM envelope material in a pending state", async () => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows([totpPendingRow]);

    await expect(
      execute(database, ({ totpCredentials }) =>
        totpCredentials.insert({
          id: recordUuid,
          userId: brandedUserId,
          status: "Pending",
          secretEncryptionVersion: 1,
          secretKeyId: " identity-key-1 ",
          secretNonce: new Uint8Array(12).fill(1),
          secretCiphertext: new Uint8Array(32).fill(2),
          secretAuthTag: new Uint8Array(16).fill(3),
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ).resolves.toMatchObject({
      status: "Pending",
      secretEncryptionVersion: 1,
      secretKeyId: "identity-key-1",
      version: 1,
    });
    expect(driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([
        1,
        "identity-key-1",
        new Uint8Array(12).fill(1),
        new Uint8Array(16).fill(3),
      ]),
    );
  });

  it("locks credentials by ID or active user and represents misses", async () => {
    const byId = createRecordingDatabase();
    byId.driver.enqueueRows([totpPendingRow]);
    await expect(
      execute(byId.database, ({ totpCredentials }) =>
        totpCredentials.findByIdForUpdate(recordUuid),
      ),
    ).resolves.toMatchObject({ id: recordUuid, status: "Pending" });
    expect(byId.driver.queries[0]?.sql).toContain("for update");

    const activeRow = {
      ...totpPendingRow,
      status: "Active" as const,
      last_accepted_counter: "1234",
      verified_at: later,
      recovery_codes_acknowledged_at: later,
      updated_at: later,
      version: 2,
    };
    const byUser = createRecordingDatabase();
    byUser.driver.enqueueRows([activeRow]);
    await expect(
      execute(byUser.database, ({ totpCredentials }) =>
        totpCredentials.findActiveForUserForUpdate(brandedUserId),
      ),
    ).resolves.toMatchObject({
      status: "Active",
      lastAcceptedCounter: 1234n,
      verifiedAt: later,
    });

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], []);
    await expect(
      execute(missing.database, ({ totpCredentials }) =>
        totpCredentials.findByIdForUpdate(recordUuid),
      ),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ totpCredentials }) =>
        totpCredentials.findActiveForUserForUpdate(brandedUserId),
      ),
    ).resolves.toBeUndefined();
  });

  it("activates with an initial counter and accepts only a greater counter by CAS", async () => {
    const activeRow = {
      ...totpPendingRow,
      status: "Active" as const,
      last_accepted_counter: "100",
      verified_at: later,
      recovery_codes_acknowledged_at: later,
      updated_at: later,
      version: 2,
    };
    const activate = createRecordingDatabase();
    activate.driver.enqueueRows([activeRow]);
    await expect(
      execute(activate.database, ({ totpCredentials }) =>
        totpCredentials.activate({
          id: recordUuid,
          expectedVersion: 1,
          acceptedCounter: 100n,
          verifiedAt: later,
          recoveryCodesAcknowledgedAt: later,
        }),
      ),
    ).resolves.toMatchObject({
      status: "Active",
      lastAcceptedCounter: 100n,
      version: 2,
    });

    const accepted = createRecordingDatabase();
    accepted.driver.enqueueRows([{ ...activeRow, last_accepted_counter: "101", version: 3 }]);
    await expect(
      execute(accepted.database, ({ totpCredentials }) =>
        totpCredentials.recordAcceptedCounter({
          id: recordUuid,
          expectedVersion: 2,
          acceptedCounter: 101n,
          occurredAt: latest,
        }),
      ),
    ).resolves.toMatchObject({ lastAcceptedCounter: 101n, version: 3 });
    expect(accepted.driver.queries[0]?.sql).toContain('"last_accepted_counter" <');

    const replay = createRecordingDatabase();
    replay.driver.enqueueRows([]);
    await expect(
      execute(replay.database, ({ totpCredentials }) =>
        totpCredentials.recordAcceptedCounter({
          id: recordUuid,
          expectedVersion: 2,
          acceptedCounter: 100n,
          occurredAt: latest,
        }),
      ),
    ).resolves.toBeUndefined();

    const activationConflict = createRecordingDatabase();
    activationConflict.driver.enqueueRows([]);
    await expect(
      execute(activationConflict.database, ({ totpCredentials }) =>
        totpCredentials.activate({
          id: recordUuid,
          expectedVersion: 99,
          acceptedCounter: 100n,
          verifiedAt: later,
          recoveryCodesAcknowledgedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("revokes optimistically and rejects negative counters before SQL", async () => {
    const revokedRow = {
      ...totpPendingRow,
      status: "Revoked" as const,
      revoked_at: latest,
      updated_at: latest,
      version: 3,
    };
    const revoke = createRecordingDatabase();
    revoke.driver.enqueueRows([revokedRow]);
    await expect(
      execute(revoke.database, ({ totpCredentials }) =>
        totpCredentials.revoke({
          id: recordUuid,
          expectedVersion: 2,
          revokedAt: latest,
        }),
      ),
    ).resolves.toMatchObject({ status: "Revoked", revokedAt: latest });

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ totpCredentials }) =>
        totpCredentials.revoke({
          id: recordUuid,
          expectedVersion: 99,
          revokedAt: latest,
        }),
      ),
    ).resolves.toBeUndefined();

    const invalid = createRecordingDatabase();
    await expect(
      execute(invalid.database, ({ totpCredentials }) =>
        totpCredentials.activate({
          id: recordUuid,
          expectedVersion: 1,
          acceptedCounter: -1n,
          verifiedAt: later,
          recoveryCodesAcknowledgedAt: later,
        }),
      ),
    ).rejects.toMatchObject({ code: "CounterInvalid" });
    expect(invalid.driver.queries).toHaveLength(0);
  });

  it("revokes every pending credential for a user at a validated instant", async () => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueAffectedRows(2n);

    await expect(
      execute(database, ({ totpCredentials }) =>
        totpCredentials.revokePendingForUser(brandedUserId, latest),
      ),
    ).resolves.toBe(2);

    expect(driver.queries[0]?.sql).toContain('"status" = $');
    expect(driver.queries[0]?.sql).toContain('"created_at" <=');
    expect(driver.queries[0]?.parameters).toEqual(
      expect.arrayContaining([userUuid, "Pending", "Revoked", latest]),
    );
  });
});

describe("invitation and bootstrap repositories", () => {
  it("creates, locks, accepts and revokes invitations with optimistic state checks", async () => {
    const create = createRecordingDatabase();
    create.driver.enqueueRows([invitationRow]);
    await expect(
      execute(create.database, ({ invitations }) =>
        invitations.insert({
          id: recordUuid,
          userId: brandedUserId,
          invitedByUserId: brandedActorId,
          tokenHash: digest(4),
          createdAt: now,
          expiresAt: later,
        }),
      ),
    ).resolves.toMatchObject({ id: recordUuid });

    const lookup = createRecordingDatabase();
    lookup.driver.enqueueRows([invitationRow]);
    await expect(
      execute(lookup.database, ({ invitations }) =>
        invitations.findOpenByTokenHashForUpdate(digest(4), now),
      ),
    ).resolves.toMatchObject({ userId: brandedUserId });
    expect(lookup.driver.queries[0]?.sql).toContain("for update");

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([]);
    await expect(
      execute(missing.database, ({ invitations }) =>
        invitations.findOpenByTokenHashForUpdate(digest(9), now),
      ),
    ).resolves.toBeUndefined();

    const accept = createRecordingDatabase();
    accept.driver.enqueueRows([{ ...invitationRow, accepted_at: later, version: 2 }]);
    await expect(
      execute(accept.database, ({ invitations }) =>
        invitations.accept({
          id: recordUuid,
          expectedVersion: 1,
          acceptedAt: later,
        }),
      ),
    ).resolves.toMatchObject({ acceptedAt: later, version: 2 });

    const acceptConflict = createRecordingDatabase();
    acceptConflict.driver.enqueueRows([]);
    await expect(
      execute(acceptConflict.database, ({ invitations }) =>
        invitations.accept({
          id: recordUuid,
          expectedVersion: 99,
          acceptedAt: later,
        }),
      ),
    ).resolves.toBeUndefined();

    const revoke = createRecordingDatabase();
    revoke.driver.enqueueAffectedRows(2n);
    await expect(
      execute(revoke.database, ({ invitations }) =>
        invitations.revokeOpenForUser(brandedUserId, later),
      ),
    ).resolves.toBe(2);
  });

  it("reads, locks, initializes and completes the singleton bootstrap state", async () => {
    const pendingRow = {
      singleton_key: 1,
      secret_hash: digest(6),
      expires_at: later,
      completed_at: null,
      completed_by_user_id: null,
      created_at: now,
      updated_at: now,
      version: 1,
    };

    const missing = createRecordingDatabase();
    missing.driver.enqueueRows([], []);
    await expect(
      execute(missing.database, ({ bootstrapState }) => bootstrapState.get()),
    ).resolves.toBeUndefined();
    await expect(
      execute(missing.database, ({ bootstrapState }) => bootstrapState.getForUpdate()),
    ).resolves.toBeUndefined();
    expect(missing.driver.queries[1]?.sql).toContain("for update");

    const read = createRecordingDatabase();
    read.driver.enqueueRows([pendingRow], [pendingRow]);
    await expect(
      execute(read.database, ({ bootstrapState }) => bootstrapState.get()),
    ).resolves.toMatchObject({ status: "Pending" });
    await expect(
      execute(read.database, ({ bootstrapState }) => bootstrapState.getForUpdate()),
    ).resolves.toMatchObject({ status: "Pending" });

    const initialise = createRecordingDatabase();
    initialise.driver.enqueueRows([pendingRow]);
    await expect(
      execute(initialise.database, ({ bootstrapState }) =>
        bootstrapState.initialise({
          secretHash: digest(6),
          expiresAt: later,
          occurredAt: now,
        }),
      ),
    ).resolves.toMatchObject({ status: "Pending", version: 1 });

    const rotate = createRecordingDatabase();
    rotate.driver.enqueueRows([
      {
        ...pendingRow,
        secret_hash: digest(7),
        expires_at: latest,
        updated_at: later,
        version: 2,
      },
    ]);
    await expect(
      execute(rotate.database, ({ bootstrapState }) =>
        bootstrapState.rotatePending({
          secretHash: digest(7),
          expiresAt: latest,
          occurredAt: later,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "Pending",
      secretHash: digest(7),
      expiresAt: latest,
      version: 2,
    });
    expect(rotate.driver.queries[0]?.sql).toContain('"completed_at" is null');
    expect(rotate.driver.queries[0]?.sql).toContain('"created_at" <=');

    const rotationConflict = createRecordingDatabase();
    rotationConflict.driver.enqueueRows([]);
    await expect(
      execute(rotationConflict.database, ({ bootstrapState }) =>
        bootstrapState.rotatePending({
          secretHash: digest(7),
          expiresAt: latest,
          occurredAt: later,
          expectedVersion: 99,
        }),
      ),
    ).resolves.toBeUndefined();

    const completedRow = {
      ...pendingRow,
      secret_hash: null,
      expires_at: null,
      completed_at: later,
      completed_by_user_id: userUuid,
      updated_at: later,
      version: 2,
    };
    const complete = createRecordingDatabase();
    complete.driver.enqueueRows([completedRow]);
    await expect(
      execute(complete.database, ({ bootstrapState }) =>
        bootstrapState.complete({
          completedAt: later,
          completedByUserId: brandedUserId,
          expectedVersion: 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "Completed",
      completedByUserId: brandedUserId,
      version: 2,
    });

    const conflict = createRecordingDatabase();
    conflict.driver.enqueueRows([]);
    await expect(
      execute(conflict.database, ({ bootstrapState }) =>
        bootstrapState.complete({
          completedAt: later,
          completedByUserId: brandedUserId,
          expectedVersion: 99,
        }),
      ),
    ).resolves.toBeUndefined();

    const corruptRotation = createRecordingDatabase();
    corruptRotation.driver.enqueueRows([completedRow]);
    await expect(
      execute(corruptRotation.database, ({ bootstrapState }) =>
        bootstrapState.rotatePending({
          secretHash: digest(7),
          expiresAt: latest,
          occurredAt: later,
          expectedVersion: 1,
        }),
      ),
    ).rejects.toThrow("Pending bootstrap rotation returned a completed state");

    const corruptCompletion = createRecordingDatabase();
    corruptCompletion.driver.enqueueRows([pendingRow]);
    await expect(
      execute(corruptCompletion.database, ({ bootstrapState }) =>
        bootstrapState.complete({
          completedAt: later,
          completedByUserId: brandedUserId,
          expectedVersion: 1,
        }),
      ),
    ).rejects.toThrow("Completed bootstrap update returned a pending state");
  });
});

describe("identity audit repository", () => {
  it("locks the chain head, seals canonical content, and atomically appends it", async () => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows(
      [
        {
          last_sequence: "7",
          last_event_id: actorUuid,
          last_event_hash: digest(8),
        },
      ],
      [{ id: recordUuid }],
    );

    await expect(
      execute(database, ({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.user.invited",
          outcome: "Succeeded",
          actorUserId: brandedActorId,
          subjectUserId: brandedUserId,
          sessionId: recordUuid,
          correlationId: correlationUuid,
          remoteAddressHash: digest(7),
          details: { role: "Engineer", acknowledged: true },
        }),
      ),
    ).resolves.toMatchObject({
      sequence: 8n,
      eventId: recordUuid,
      integrityVersion: 1,
      integrityKeyId: "test-audit-key",
      eventHash: expect.any(Uint8Array),
    });

    expect(driver.queries[0]?.sql).toContain("for update");
    expect(driver.queries[1]?.sql).toContain("with advanced_head as");
    expect(driver.queries[1]?.sql).toContain("insert into stockcontrol.identity_audit_events");
    expect(driver.queries[1]?.parameters).toEqual(
      expect.arrayContaining([digest(7), digest(8), "test-audit-key"]),
    );

    const initial = createRecordingDatabase();
    initial.driver.enqueueRows(
      [{ last_sequence: "0", last_event_id: null, last_event_hash: null }],
      [{ id: recordUuid }],
    );
    await expect(
      execute(initial.database, ({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.sign-in.denied",
          outcome: "Denied",
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).resolves.toMatchObject({ sequence: 1n });
    expect(initial.driver.queries[1]?.parameters).toEqual(expect.arrayContaining([null]));
  });

  it("reports an audit head CAS conflict without inserting an orphan event", async () => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows(
      [{ last_sequence: "1", last_event_id: actorUuid, last_event_hash: digest(8) }],
      [],
    );

    await expect(
      execute(database, ({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.conflict",
          outcome: "Failed",
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).resolves.toBeUndefined();
    expect(driver.queries).toHaveLength(2);
  });

  it.each([
    { last_sequence: "0", last_event_id: null, last_event_hash: digest(1) },
    { last_sequence: "2", last_event_id: recordUuid, last_event_hash: null },
  ])("rejects an inconsistent stored audit tail %#", async (tail) => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows([tail]);

    await expect(
      execute(database, ({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.invalid-chain",
          outcome: "Failed",
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "AuditChainInvalid" });
    expect(driver.queries).toHaveLength(1);
  });

  it("rejects malformed audit events before reading or signing the chain", async () => {
    const { database, driver } = createRecordingDatabase();

    await expect(
      execute(database, ({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.invalid",
          outcome: "Unknown" as never,
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "ScopeInvalid" });

    expect(driver.queries).toHaveLength(0);
  });

  it.each([
    {
      name: "unsupported integrity version",
      seal: {
        version: 2 as never,
        keyId: "test-audit-key",
        eventHash: digest(9),
      },
      code: "EncryptionVersionInvalid",
    },
    {
      name: "oversized integrity key ID",
      seal: {
        version: 1 as const,
        keyId: "k".repeat(101),
        eventHash: digest(9),
      },
      code: "EncryptionKeyInvalid",
    },
    {
      name: "malformed event hash",
      seal: {
        version: 1 as const,
        keyId: "test-audit-key",
        eventHash: new Uint8Array(31),
      },
      code: "DigestLengthInvalid",
    },
  ])("fails closed on a $name", async ({ seal, code }) => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows([
      {
        last_sequence: "0",
        last_event_id: null,
        last_event_hash: null,
      },
    ]);
    const integrity = Object.freeze({
      seal: () => Object.freeze(seal),
    }) as IdentityAuditIntegrity;

    await expect(
      new KyselyIdentityUnitOfWork(database, integrity).execute(({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.integrity-invalid",
          outcome: "Failed",
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).rejects.toMatchObject({ code });

    expect(driver.queries).toHaveLength(1);
  });

  it("propagates a signer failure without attempting an audit insert", async () => {
    const { database, driver } = createRecordingDatabase();
    driver.enqueueRows([
      {
        last_sequence: "0",
        last_event_id: null,
        last_event_hash: null,
      },
    ]);
    const failure = new Error("integrity key unavailable");
    const integrity: IdentityAuditIntegrity = Object.freeze({
      seal: () => {
        throw failure;
      },
    });

    await expect(
      new KyselyIdentityUnitOfWork(database, integrity).execute(({ auditEvents }) =>
        auditEvents.append({
          id: recordUuid,
          occurredAt: now,
          eventType: "identity.integrity-unavailable",
          outcome: "Failed",
          correlationId: correlationUuid,
          details: {},
        }),
      ),
    ).rejects.toBe(failure);

    expect(driver.queries).toHaveLength(1);
  });
});
