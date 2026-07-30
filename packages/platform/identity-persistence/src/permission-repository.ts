import {
  capabilityKeys,
  PERMISSION_CATALOGUE_VERSION,
  type IdentityPermissionOverrideRepository,
  type PersistedPermissionOverride,
  type ReplacePermissionOverrides,
  type UserPermissionSettings,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { permissionOverrideFromRow, settingsFromPermissionRows } from "./mappers";
import { assertUuid } from "./validation";

export const permissionSettingsForUsers = async (
  database: IdentityDatabaseExecutor,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, UserPermissionSettings>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await database
    .withSchema(IDENTITY_DATABASE_SCHEMA)
    .selectFrom("identity_permission_overrides")
    .selectAll()
    .where("user_id", "in", userIds)
    .orderBy("user_id", "asc")
    .orderBy("capability", "asc")
    .execute();
  const rowsByUser = new Map<string, typeof rows>();

  for (const row of rows) {
    const existing = rowsByUser.get(row.user_id) ?? [];
    rowsByUser.set(row.user_id, [...existing, row]);
  }

  return new Map(userIds.map((id) => [id, settingsFromPermissionRows(rowsByUser.get(id) ?? [])]));
};

export class KyselyIdentityPermissionOverrideRepository implements IdentityPermissionOverrideRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async listForUser(
    userId: Parameters<IdentityPermissionOverrideRepository["listForUser"]>[0],
  ): Promise<readonly PersistedPermissionOverride[]> {
    const rows = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_permission_overrides")
      .selectAll()
      .where("user_id", "=", assertUuid(userId, "User ID"))
      .orderBy("capability", "asc")
      .execute();

    return Object.freeze(rows.map(permissionOverrideFromRow));
  }

  public async settingsForUser(
    userId: Parameters<IdentityPermissionOverrideRepository["settingsForUser"]>[0],
  ): Promise<UserPermissionSettings> {
    const rows = await this.listForUser(userId);

    return Object.freeze(
      Object.fromEntries(rows.map(({ capability, setting }) => [capability, setting])),
    );
  }

  public async replaceForUser(command: ReplacePermissionOverrides): Promise<void> {
    const persistedUserId = assertUuid(command.userId, "User ID");
    const persistedActorId = assertUuid(command.updatedByUserId, "Actor user ID");
    const persistedSettings = capabilityKeys.flatMap((capability) => {
      const setting = command.settings[capability];

      return setting === "Allow" || setting === "Deny"
        ? [
            {
              user_id: persistedUserId,
              capability,
              setting,
              catalogue_version: PERMISSION_CATALOGUE_VERSION,
              updated_by_user_id: persistedActorId,
              created_at: command.occurredAt,
              updated_at: command.occurredAt,
            },
          ]
        : [];
    });

    await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .deleteFrom("identity_permission_overrides")
      .where("user_id", "=", persistedUserId)
      .execute();

    if (persistedSettings.length > 0) {
      await this.database
        .withSchema(IDENTITY_DATABASE_SCHEMA)
        .insertInto("identity_permission_overrides")
        .values(persistedSettings)
        .execute();
    }
  }
}
