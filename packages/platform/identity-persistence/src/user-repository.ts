import {
  type CreateUserRecord,
  type IdentityUserRepository,
  type PersistedUser,
  type ReplaceUserRecord,
  type UserPermissionSettings,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { settingsFromPermissionRows, userFromRow } from "./mappers";
import { permissionSettingsForUsers } from "./permission-repository";
import { assertUuid } from "./validation";

export class KyselyIdentityUserRepository implements IdentityUserRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async findById(
    id: Parameters<IdentityUserRepository["findById"]>[0],
  ): Promise<PersistedUser | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_users")
      .selectAll()
      .where("id", "=", assertUuid(id, "User ID"))
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const permissionRows = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_permission_overrides")
      .selectAll()
      .where("user_id", "=", row.id)
      .orderBy("capability", "asc")
      .execute();

    return userFromRow(row, settingsFromPermissionRows(permissionRows));
  }

  public async findByEmail(
    email: Parameters<IdentityUserRepository["findByEmail"]>[0],
  ): Promise<PersistedUser | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_users")
      .selectAll()
      .where("normalised_email", "=", email)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const permissionRows = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_permission_overrides")
      .selectAll()
      .where("user_id", "=", row.id)
      .orderBy("capability", "asc")
      .execute();

    return userFromRow(row, settingsFromPermissionRows(permissionRows));
  }

  public async insert(command: CreateUserRecord): Promise<PersistedUser> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .insertInto("identity_users")
      .values({
        id: assertUuid(command.id, "User ID"),
        normalised_email: command.email,
        display_name: command.displayName,
        role: command.role,
        status: command.status,
        created_at: command.occurredAt,
        updated_at: command.occurredAt,
        version: 1,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return userFromRow(row, Object.freeze({}));
  }

  public async replace(command: ReplaceUserRecord): Promise<PersistedUser | undefined> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_users")
      .set((expression) => ({
        normalised_email: command.email,
        display_name: command.displayName,
        role: command.role,
        status: command.status,
        updated_at: command.occurredAt,
        version: expression("version", "+", 1),
      }))
      .where("id", "=", assertUuid(command.id, "User ID"))
      .where("version", "=", command.expectedVersion)
      .returningAll()
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    const permissionRows = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_permission_overrides")
      .selectAll()
      .where("user_id", "=", row.id)
      .orderBy("capability", "asc")
      .execute();

    return userFromRow(row, settingsFromPermissionRows(permissionRows));
  }

  public async lockAdministrativeRoster(): Promise<
    Awaited<ReturnType<IdentityUserRepository["lockAdministrativeRoster"]>>
  > {
    const users = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_users")
      .select(["id", "role", "status"])
      .orderBy("id", "asc")
      .forUpdate()
      .execute();
    const settingsByUser = await permissionSettingsForUsers(
      this.database,
      users.map(({ id }) => id),
    );

    return Object.freeze(
      users.map((user) =>
        Object.freeze({
          id: user.id as Parameters<IdentityUserRepository["findById"]>[0],
          role: user.role,
          status: user.status,
          permissionSettings:
            settingsByUser.get(user.id) ?? (Object.freeze({}) as UserPermissionSettings),
        }),
      ),
    );
  }
}
