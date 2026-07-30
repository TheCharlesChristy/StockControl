import { randomBytes, randomUUID } from "node:crypto";

import {
  normaliseEmailAddress,
  userDisplayName,
  userId,
  type PersistedUser,
  type Sha256Digest,
} from "@stockcontrol/module-identity";
import {
  databaseRoleFromConnectionString,
  loadMigratorDatabaseConfiguration,
  loadRuntimeDatabaseConfiguration,
  createMigratorDatabase,
  createRuntimeDatabase,
  runMigrations,
  STOCKCONTROL_SCHEMA,
  type StockControlDatabase,
} from "@stockcontrol/platform-database";
import type { Kysely } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KyselyIdentityUnitOfWork } from "../src";
import { testAuditIntegrity } from "./recording-database";

const randomDigest = (): Sha256Digest => randomBytes(32) as unknown as Sha256Digest;
const integrationPasswordHash =
  "$sc-argon2id$v=1$a=19,m=65536,t=3,p=1,l=32$abcdefghijklmnop$abcdefghijklmnopqrstuvwxyz123456";

describe.sequential("PostgreSQL identity persistence", () => {
  let migrator: Kysely<StockControlDatabase>;
  let runtime: Kysely<StockControlDatabase>;
  let unitOfWork: KyselyIdentityUnitOfWork;

  beforeAll(async () => {
    const migratorConfiguration = loadMigratorDatabaseConfiguration();
    const runtimeConfiguration = loadRuntimeDatabaseConfiguration();
    migrator = createMigratorDatabase(migratorConfiguration);
    await runMigrations(migrator, {
      runtimeRole: databaseRoleFromConnectionString(runtimeConfiguration.connectionString),
    });
    runtime = createRuntimeDatabase(runtimeConfiguration);
    unitOfWork = new KyselyIdentityUnitOfWork(runtime, testAuditIntegrity);
  });

  afterAll(async () => {
    await runtime.destroy();
    await migrator.destroy();
  });

  it("rolls every repository write back with its application transaction", async () => {
    const id = userId(randomUUID());
    const rollback = new Error("intentional rollback");

    await expect(
      unitOfWork.execute(async ({ users }) => {
        await users.insert({
          id,
          email: normaliseEmailAddress(`${id}@rollback.example.test`),
          displayName: userDisplayName("Rollback Probe"),
          role: "Engineer",
          status: "Invited",
          occurredAt: new Date(),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(unitOfWork.execute(({ users }) => users.findById(id))).resolves.toBeUndefined();
  });

  it("persists bootstrap, users, overrides, invitations, sessions and audit atomically", async () => {
    const adminId = userId(randomUUID());
    const engineerId = userId(randomUUID());
    const bootstrapHash = randomDigest();
    const invitationHash = randomDigest();
    const sessionHash = randomDigest();
    const now = new Date();
    const oneHourLater = new Date(now.getTime() + 3_600_000);
    const twelveHoursLater = new Date(now.getTime() + 43_200_000);

    const admin = await unitOfWork.execute(
      async ({ bootstrapState, passwordCredentials, recoveryCodes, totpCredentials, users }) => {
        await bootstrapState.initialise({
          secretHash: bootstrapHash,
          expiresAt: oneHourLater,
          occurredAt: now,
        });
        const adminUser = await users.insert({
          id: adminId,
          email: normaliseEmailAddress(`${adminId}@example.test`),
          displayName: userDisplayName("Initial Admin"),
          role: "Admin",
          status: "Active",
          occurredAt: now,
        });
        await passwordCredentials.insert({
          userId: adminId,
          passwordHash: integrationPasswordHash,
          passwordChangedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const totp = await totpCredentials.insert({
          id: randomUUID(),
          userId: adminId,
          status: "Pending",
          secretEncryptionVersion: 1,
          secretKeyId: "identity-integration-key",
          secretNonce: randomBytes(12),
          secretCiphertext: randomBytes(32),
          secretAuthTag: randomBytes(16),
          createdAt: now,
          updatedAt: now,
        });
        await recoveryCodes.insertMany([
          {
            id: randomUUID(),
            userId: adminId,
            totpCredentialId: totp.id,
            codeHash: randomDigest(),
            createdAt: now,
          },
        ]);
        await totpCredentials.activate({
          id: totp.id,
          expectedVersion: totp.version,
          acceptedCounter: 1234n,
          verifiedAt: now,
          recoveryCodesAcknowledgedAt: now,
        });
        return adminUser;
      },
    );

    await unitOfWork.execute(async ({ auditEvents, bootstrapState, users }) => {
      const state = await bootstrapState.getForUpdate();
      expect(state).toMatchObject({ status: "Pending", version: 1 });
      const roster = await users.lockAdministrativeRoster();
      expect(roster).toContainEqual(
        expect.objectContaining({ id: adminId, role: "Admin", status: "Active" }),
      );
      await bootstrapState.complete({
        completedAt: now,
        completedByUserId: adminId,
        expectedVersion: 1,
      });
      await expect(
        auditEvents.append({
          id: randomUUID(),
          occurredAt: now,
          eventType: "identity.bootstrap.completed",
          outcome: "Succeeded",
          actorUserId: adminId,
          subjectUserId: adminId,
          correlationId: randomUUID(),
          details: { permissionCatalogueVersion: 1 },
        }),
      ).resolves.toMatchObject({ sequence: 1n });
    });

    let engineer: PersistedUser | undefined;
    await unitOfWork.execute(async ({ invitations, permissionOverrides, users }) => {
      engineer = await users.insert({
        id: engineerId,
        email: normaliseEmailAddress(`${engineerId}@example.test`),
        displayName: userDisplayName("Integration Engineer"),
        role: "Engineer",
        status: "Invited",
        occurredAt: now,
      });
      await permissionOverrides.replaceForUser({
        userId: engineerId,
        settings: { "inventory.receive": "Allow" },
        updatedByUserId: adminId,
        occurredAt: now,
      });
      await invitations.insert({
        id: randomUUID(),
        userId: engineerId,
        invitedByUserId: adminId,
        tokenHash: invitationHash,
        createdAt: now,
        expiresAt: oneHourLater,
      });
    });

    expect(engineer).toBeDefined();
    await unitOfWork.execute(async ({ invitations, sessions, users }) => {
      const invitation = await invitations.findOpenByTokenHashForUpdate(invitationHash, now);
      expect(invitation).toBeDefined();
      await invitations.accept({
        id: invitation!.id,
        expectedVersion: invitation!.version,
        acceptedAt: now,
      });
      await users.replace({
        id: engineerId,
        email: normaliseEmailAddress(`${engineerId}@example.test`),
        displayName: userDisplayName("Integration Engineer"),
        role: "Engineer",
        status: "Active",
        expectedVersion: engineer!.version,
        occurredAt: now,
      });
      await sessions.insert({
        id: randomUUID(),
        userId: engineerId,
        tokenHash: sessionHash,
        authenticationMethod: "Password",
        assuranceLevel: "SingleFactor",
        issuedAt: now,
        lastSeenAt: now,
        idleExpiresAt: oneHourLater,
        absoluteExpiresAt: twelveHoursLater,
      });
    });

    await expect(
      unitOfWork.execute(({ users }) => users.findById(engineerId)),
    ).resolves.toMatchObject({
      status: "Active",
      permissionSettings: { "inventory.receive": "Allow" },
    });

    const storedSession = await runtime
      .withSchema(STOCKCONTROL_SCHEMA)
      .selectFrom("identity_sessions")
      .select(["token_hash", "authentication_method", "assurance_level"])
      .where("user_id", "=", engineerId)
      .executeTakeFirstOrThrow();
    expect(storedSession.token_hash).toEqual(sessionHash);
    expect(storedSession).toMatchObject({
      authentication_method: "Password",
      assurance_level: "SingleFactor",
    });

    await expect(
      unitOfWork.execute(({ users }) =>
        users.replace({
          id: adminId,
          email: admin.email,
          displayName: admin.displayName,
          role: admin.role,
          status: admin.status,
          expectedVersion: 999,
          occurredAt: new Date(),
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
