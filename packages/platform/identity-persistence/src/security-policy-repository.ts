import {
  createIdentitySecurityPolicy,
  createPasswordPolicy,
  type IdentitySecurityPolicyRepository,
  type PersistedIdentitySecurityPolicy,
  type ReplaceIdentitySecurityPolicy,
} from "@stockcontrol/module-identity";

import { IDENTITY_DATABASE_SCHEMA, type IdentityDatabaseExecutor } from "./database";
import { securityPolicyFromRow } from "./mappers";
import { IdentityPersistenceInputError, assertIntegerInRange, assertValidDate } from "./validation";

const validatePolicy = (command: ReplaceIdentitySecurityPolicy): ReplaceIdentitySecurityPolicy => {
  const runtimeAdminMfaRequired: unknown = command.adminMfaRequired;
  const runtimeCatalogueVersion: unknown = command.permissionCatalogueVersion;
  if (runtimeAdminMfaRequired !== true || runtimeCatalogueVersion !== 1) {
    throw new IdentityPersistenceInputError(
      "ScopeInvalid",
      "Admin MFA and the permission catalogue version cannot be weakened.",
    );
  }
  createPasswordPolicy({
    minimumCharacters: command.passwordMinimumLength,
    maximumCharacters: command.passwordMaximumLength,
  });
  createIdentitySecurityPolicy({
    standardSessionIdleSeconds: command.standardSessionIdleSeconds,
    adminSessionIdleSeconds: command.adminSessionIdleSeconds,
    sessionAbsoluteSeconds: command.sessionAbsoluteSeconds,
    recentAuthenticationSeconds: command.recentAuthenticationSeconds,
    authenticationChallengeSeconds: command.authChallengeSeconds,
    invitationSeconds: command.invitationSeconds,
    passwordResetSeconds: command.passwordResetSeconds,
  });
  assertValidDate(command.updatedAt, "Security-policy update time");
  assertIntegerInRange(command.expectedVersion, 1, 2_147_483_647, "Expected version");
  return command;
};

export class KyselyIdentitySecurityPolicyRepository implements IdentitySecurityPolicyRepository {
  public constructor(private readonly database: IdentityDatabaseExecutor) {}

  public async get(): Promise<PersistedIdentitySecurityPolicy> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_security_policy")
      .selectAll()
      .where("singleton_key", "=", 1)
      .executeTakeFirstOrThrow();

    return securityPolicyFromRow(row);
  }

  public async getForUpdate(): Promise<PersistedIdentitySecurityPolicy> {
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .selectFrom("identity_security_policy")
      .selectAll()
      .where("singleton_key", "=", 1)
      .forUpdate()
      .executeTakeFirstOrThrow();

    return securityPolicyFromRow(row);
  }

  public async replace(
    commandInput: ReplaceIdentitySecurityPolicy,
  ): Promise<PersistedIdentitySecurityPolicy | undefined> {
    const command = validatePolicy(commandInput);
    const row = await this.database
      .withSchema(IDENTITY_DATABASE_SCHEMA)
      .updateTable("identity_security_policy")
      .set((expression) => ({
        password_minimum_length: command.passwordMinimumLength,
        password_maximum_length: command.passwordMaximumLength,
        admin_mfa_required: true,
        standard_session_idle_seconds: command.standardSessionIdleSeconds,
        admin_session_idle_seconds: command.adminSessionIdleSeconds,
        session_absolute_seconds: command.sessionAbsoluteSeconds,
        recent_authentication_seconds: command.recentAuthenticationSeconds,
        auth_challenge_seconds: command.authChallengeSeconds,
        invitation_seconds: command.invitationSeconds,
        password_reset_seconds: command.passwordResetSeconds,
        permission_catalogue_version: 1,
        updated_at: command.updatedAt,
        version: expression("version", "+", 1),
      }))
      .where("singleton_key", "=", 1)
      .where("version", "=", command.expectedVersion)
      .returningAll()
      .executeTakeFirst();

    return row === undefined ? undefined : securityPolicyFromRow(row);
  }
}
