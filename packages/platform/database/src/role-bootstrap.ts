import { sql, type Kysely } from "kysely";

import type { DatabaseConnectionConfiguration, DatabaseEnvironment } from "./configuration";
import { createAdminDatabase } from "./connection";
import type { StockControlDatabase } from "./schema";

const DEFAULT_POSTGRES_PORT = "5432";
const ROLE_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/u;

export type DatabaseRoleBootstrapConfigurationErrorCode =
  | "AdminRoleConflict"
  | "DatabaseMismatch"
  | "EndpointMismatch"
  | "InvalidConnectionUrl"
  | "InvalidDatabaseName"
  | "InvalidPassword"
  | "InvalidRole"
  | "MissingEnvironmentVariable"
  | "PasswordConflict"
  | "RoleConflict";

export class DatabaseRoleBootstrapConfigurationError extends Error {
  public constructor(public readonly code: DatabaseRoleBootstrapConfigurationErrorCode) {
    super(code);
    this.name = "DatabaseRoleBootstrapConfigurationError";
  }
}

export type DatabaseRoleBootstrapErrorCode =
  | "ConnectedAdminRoleMismatch"
  | "ConnectedDatabaseMismatch"
  | "ConnectedMigratorRoleMismatch"
  | "ConnectedRuntimeRoleMismatch";

export class DatabaseRoleBootstrapError extends Error {
  public constructor(public readonly code: DatabaseRoleBootstrapErrorCode) {
    super(code);
    this.name = "DatabaseRoleBootstrapError";
  }
}

interface ParsedBootstrapUrl {
  readonly connectionString: string;
  readonly databaseName: string;
  readonly endpoint: string;
  readonly password: string;
  readonly role: string;
}

export interface DatabaseRoleBootstrapConfiguration {
  readonly adminConnection: DatabaseConnectionConfiguration;
  readonly adminRole: string;
  readonly databaseName: string;
  readonly migratorConnection: DatabaseConnectionConfiguration;
  readonly migratorPassword: string;
  readonly migratorRole: string;
  readonly runtimeConnection: DatabaseConnectionConfiguration;
  readonly runtimePassword: string;
  readonly runtimeRole: string;
}

export interface DatabaseRoleBootstrapResult {
  readonly databaseName: string;
  readonly migratorRole: string;
  readonly runtimeRole: string;
}

const readRequiredEnvironmentValue = (
  environment: DatabaseEnvironment,
  name: "DATABASE_ADMIN_URL" | "DATABASE_MIGRATOR_URL" | "DATABASE_URL",
): string => {
  const value = environment[name]?.trim();

  if (value === undefined || value.length === 0) {
    throw new DatabaseRoleBootstrapConfigurationError("MissingEnvironmentVariable");
  }

  return value;
};

const decodeUrlComponent = (
  value: string,
  errorCode: "InvalidDatabaseName" | "InvalidRole",
): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new DatabaseRoleBootstrapConfigurationError(errorCode);
  }
};

const parseBootstrapUrl = (connectionString: string): ParsedBootstrapUrl => {
  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidConnectionUrl");
  }

  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname.length === 0
  ) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidConnectionUrl");
  }

  if (parsed.pathname.length <= 1 || parsed.pathname.slice(1).includes("/")) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidDatabaseName");
  }

  const databaseName = decodeUrlComponent(parsed.pathname.slice(1), "InvalidDatabaseName");
  if (databaseName.length === 0 || databaseName.includes("\0")) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidDatabaseName");
  }

  const role = decodeUrlComponent(parsed.username, "InvalidRole");
  if (!ROLE_PATTERN.test(role)) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidRole");
  }

  let password: string;
  try {
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidPassword");
  }

  if (password.includes("\0") || password.length === 0) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidPassword");
  }

  return {
    connectionString,
    databaseName,
    endpoint: `${parsed.hostname.toLowerCase()}:${parsed.port || DEFAULT_POSTGRES_PORT}`,
    password,
    role,
  };
};

export const loadDatabaseRoleBootstrapConfiguration = (
  environment: DatabaseEnvironment = process.env,
): DatabaseRoleBootstrapConfiguration => {
  const admin = parseBootstrapUrl(readRequiredEnvironmentValue(environment, "DATABASE_ADMIN_URL"));
  const migrator = parseBootstrapUrl(
    readRequiredEnvironmentValue(environment, "DATABASE_MIGRATOR_URL"),
  );
  const runtime = parseBootstrapUrl(readRequiredEnvironmentValue(environment, "DATABASE_URL"));

  if (migrator.role === runtime.role) {
    throw new DatabaseRoleBootstrapConfigurationError("RoleConflict");
  }

  if (admin.role === migrator.role || admin.role === runtime.role) {
    throw new DatabaseRoleBootstrapConfigurationError("AdminRoleConflict");
  }

  if (admin.databaseName !== migrator.databaseName || admin.databaseName !== runtime.databaseName) {
    throw new DatabaseRoleBootstrapConfigurationError("DatabaseMismatch");
  }

  if (admin.endpoint !== migrator.endpoint || admin.endpoint !== runtime.endpoint) {
    throw new DatabaseRoleBootstrapConfigurationError("EndpointMismatch");
  }

  if (migrator.password === runtime.password) {
    throw new DatabaseRoleBootstrapConfigurationError("PasswordConflict");
  }

  if ([...migrator.password].length < 32 || [...runtime.password].length < 32) {
    throw new DatabaseRoleBootstrapConfigurationError("InvalidPassword");
  }

  return {
    adminConnection: {
      applicationName: "stockcontrol-role-bootstrap",
      connectionString: admin.connectionString,
      connectionTimeoutMilliseconds: 5_000,
      lockTimeoutMilliseconds: 10_000,
      maximumPoolSize: 1,
      statementTimeoutMilliseconds: 30_000,
    },
    adminRole: admin.role,
    databaseName: admin.databaseName,
    migratorConnection: {
      applicationName: "stockcontrol-role-bootstrap-migrator-check",
      connectionString: migrator.connectionString,
      connectionTimeoutMilliseconds: 5_000,
      lockTimeoutMilliseconds: 10_000,
      maximumPoolSize: 1,
      statementTimeoutMilliseconds: 30_000,
    },
    migratorPassword: migrator.password,
    migratorRole: migrator.role,
    runtimeConnection: {
      applicationName: "stockcontrol-role-bootstrap-runtime-check",
      connectionString: runtime.connectionString,
      connectionTimeoutMilliseconds: 5_000,
      lockTimeoutMilliseconds: 10_000,
      maximumPoolSize: 1,
      statementTimeoutMilliseconds: 30_000,
    },
    runtimePassword: runtime.password,
    runtimeRole: runtime.role,
  };
};

const ROLE_BOOTSTRAP_SQL = sql`
  do $stockcontrol_role_bootstrap$
  declare
    role_name text;
    role_password text;
    role_state record;
    database_name text := current_database();
  begin
    for role_name, role_password in
      select candidate.role_name, candidate.role_password
      from (values
        (
          current_setting('stockcontrol.bootstrap_migrator_role'),
          current_setting('stockcontrol.bootstrap_migrator_password')
        ),
        (
          current_setting('stockcontrol.bootstrap_runtime_role'),
          current_setting('stockcontrol.bootstrap_runtime_password')
        )
      ) as candidate(role_name, role_password)
    loop
      select
        candidate_role.oid,
        candidate_role.rolcanlogin,
        candidate_role.rolsuper,
        candidate_role.rolinherit,
        candidate_role.rolcreaterole,
        candidate_role.rolcreatedb,
        candidate_role.rolreplication,
        candidate_role.rolconnlimit,
        candidate_role.rolvaliduntil,
        candidate_role.rolbypassrls
      into role_state
      from pg_catalog.pg_roles as candidate_role
      where candidate_role.rolname = role_name;

      if found then
        if
          role_state.rolcanlogin is distinct from true or
          role_state.rolsuper is distinct from false or
          role_state.rolinherit is distinct from false or
          role_state.rolcreaterole is distinct from false or
          role_state.rolcreatedb is distinct from false or
          role_state.rolreplication is distinct from false or
          role_state.rolconnlimit is distinct from -1 or
          role_state.rolvaliduntil is not null or
          role_state.rolbypassrls is distinct from false or
          exists (
            select 1
            from pg_catalog.pg_auth_members as membership
            where membership.member = role_state.oid or membership.roleid = role_state.oid
          )
        then
          raise exception using
            errcode = '55000',
            message = 'Existing StockControl database role has incompatible attributes.';
        end if;

      else
        execute format(
          'create role %I with login password %L nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit -1',
          role_name,
          role_password
        );
      end if;
    end loop;

    if exists (
      select 1
      from pg_catalog.pg_database as database
      join pg_catalog.pg_roles as owner on owner.oid = database.datdba
      where database.datname = database_name
        and owner.rolname in (
          current_setting('stockcontrol.bootstrap_migrator_role'),
          current_setting('stockcontrol.bootstrap_runtime_role')
        )
    ) or exists (
      select 1
      from pg_catalog.pg_namespace as namespace
      join pg_catalog.pg_roles as owner on owner.oid = namespace.nspowner
      where namespace.nspname = 'public'
        and owner.rolname in (
          current_setting('stockcontrol.bootstrap_migrator_role'),
          current_setting('stockcontrol.bootstrap_runtime_role')
        )
    ) then
      raise exception using
        errcode = '55000',
        message = 'Existing StockControl role ownership is incompatible with least privilege.';
    end if;

    execute format('revoke all privileges on database %I from public', database_name);
    execute format(
      'revoke all privileges on database %I from %I',
      database_name,
      current_setting('stockcontrol.bootstrap_migrator_role')
    );
    execute format(
      'revoke all privileges on database %I from %I',
      database_name,
      current_setting('stockcontrol.bootstrap_runtime_role')
    );
    execute format(
      'grant connect, create on database %I to %I',
      database_name,
      current_setting('stockcontrol.bootstrap_migrator_role')
    );
    execute format(
      'grant connect on database %I to %I',
      database_name,
      current_setting('stockcontrol.bootstrap_runtime_role')
    );

    revoke all privileges on schema public from public;
    execute format(
      'revoke all privileges on schema public from %I',
      current_setting('stockcontrol.bootstrap_migrator_role')
    );
    execute format(
      'revoke all privileges on schema public from %I',
      current_setting('stockcontrol.bootstrap_runtime_role')
    );
    execute format(
      'grant usage, create on schema public to %I',
      current_setting('stockcontrol.bootstrap_migrator_role')
    );
  end
  $stockcontrol_role_bootstrap$
`;

export const bootstrapDatabaseRoles = async (
  database: Kysely<StockControlDatabase>,
  configuration: DatabaseRoleBootstrapConfiguration,
): Promise<DatabaseRoleBootstrapResult> =>
  database.transaction().execute(async (transaction) => {
    await sql`select pg_advisory_xact_lock(1398034255, 1380929363)`.execute(transaction);
    const currentIdentity = await sql<{
      readonly database_name: string;
      readonly role_name: string;
    }>`
      select current_database() as database_name, current_user as role_name
    `.execute(transaction);

    if (currentIdentity.rows[0]?.database_name !== configuration.databaseName) {
      throw new DatabaseRoleBootstrapError("ConnectedDatabaseMismatch");
    }

    if (currentIdentity.rows[0].role_name !== configuration.adminRole) {
      throw new DatabaseRoleBootstrapError("ConnectedAdminRoleMismatch");
    }

    await sql`
      select
        set_config('stockcontrol.bootstrap_migrator_role', ${configuration.migratorRole}, true),
        set_config(
          'stockcontrol.bootstrap_migrator_password',
          ${configuration.migratorPassword},
          true
        ),
        set_config('stockcontrol.bootstrap_runtime_role', ${configuration.runtimeRole}, true),
        set_config(
          'stockcontrol.bootstrap_runtime_password',
          ${configuration.runtimePassword},
          true
        )
    `.execute(transaction);
    await ROLE_BOOTSTRAP_SQL.execute(transaction);

    return {
      databaseName: configuration.databaseName,
      migratorRole: configuration.migratorRole,
      runtimeRole: configuration.runtimeRole,
    };
  });

export const bootstrapConfiguredDatabaseRoles = async (
  environment: DatabaseEnvironment = process.env,
): Promise<DatabaseRoleBootstrapResult> => {
  const configuration = loadDatabaseRoleBootstrapConfiguration(environment);
  const database = createAdminDatabase(configuration.adminConnection);

  try {
    const result = await bootstrapDatabaseRoles(database, configuration);
    const migrator = createAdminDatabase(configuration.migratorConnection);
    const runtime = createAdminDatabase(configuration.runtimeConnection);

    try {
      const [migratorIdentity, runtimeIdentity] = await Promise.all([
        sql<{ readonly database_name: string; readonly role_name: string }>`
          select current_database() as database_name, current_user as role_name
        `.execute(migrator),
        sql<{ readonly database_name: string; readonly role_name: string }>`
          select current_database() as database_name, current_user as role_name
        `.execute(runtime),
      ]);

      if (
        migratorIdentity.rows[0]?.database_name !== configuration.databaseName ||
        migratorIdentity.rows[0].role_name !== configuration.migratorRole
      ) {
        throw new DatabaseRoleBootstrapError("ConnectedMigratorRoleMismatch");
      }

      if (
        runtimeIdentity.rows[0]?.database_name !== configuration.databaseName ||
        runtimeIdentity.rows[0].role_name !== configuration.runtimeRole
      ) {
        throw new DatabaseRoleBootstrapError("ConnectedRuntimeRoleMismatch");
      }

      return result;
    } finally {
      await Promise.all([migrator.destroy(), runtime.destroy()]);
    }
  } finally {
    await database.destroy();
  }
};
