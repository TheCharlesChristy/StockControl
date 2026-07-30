\set ON_ERROR_STOP on

CREATE ROLE stockcontrol_migrator
  LOGIN
  PASSWORD 'stockcontrol_migrator'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

CREATE ROLE stockcontrol_app
  LOGIN
  PASSWORD 'stockcontrol_app'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;

ALTER DATABASE stockcontrol OWNER TO stockcontrol_migrator;

REVOKE ALL ON DATABASE stockcontrol FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE stockcontrol TO stockcontrol_app;

COMMENT ON ROLE stockcontrol_migrator IS
  'Local-only migration role. Production credentials are provisioned separately.';
COMMENT ON ROLE stockcontrol_app IS
  'Local-only least-privilege runtime role. Migrations grant schema permissions explicitly.';
