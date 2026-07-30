\set ON_ERROR_STOP on

\getenv migrator_password STOCKCONTROL_MIGRATOR_PASSWORD
\getenv runtime_password STOCKCONTROL_RUNTIME_PASSWORD
\getenv backup_password STOCKCONTROL_BACKUP_PASSWORD

CREATE ROLE stockcontrol_migrator
  LOGIN
  PASSWORD :'migrator_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

CREATE ROLE stockcontrol_app
  LOGIN
  PASSWORD :'runtime_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

CREATE ROLE stockcontrol_backup
  LOGIN
  PASSWORD :'backup_password'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  INHERIT;

ALTER DATABASE stockcontrol OWNER TO stockcontrol_migrator;

REVOKE ALL ON DATABASE stockcontrol FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE stockcontrol TO stockcontrol_app;
GRANT CONNECT ON DATABASE stockcontrol TO stockcontrol_backup;
GRANT pg_read_all_data TO stockcontrol_backup;

COMMENT ON ROLE stockcontrol_migrator IS
  'Production schema owner used only by the reviewed migration command.';
COMMENT ON ROLE stockcontrol_app IS
  'Least-privilege StockControl API and worker runtime role.';
COMMENT ON ROLE stockcontrol_backup IS
  'Read-only role used by the database backup service.';
