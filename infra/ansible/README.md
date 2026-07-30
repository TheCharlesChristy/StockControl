# Ansible

This playbook configures one pre-provisioned Lightsail instance. It deploys
three explicit application image targets from the repository `Dockerfile`:

- `api` runs `node apps/api/dist/main.js`;
- `worker` runs `node apps/worker/dist/main.js`;
- `web` serves `apps/web/dist` through unprivileged nginx.

Caddy terminates TLS, sends `/api` and `/api/*` to the API, and sends all other
paths to the web service. API readiness is `/api/v1/health/ready`.

## Preparation

1. Install the collection in `requirements.yml`.
2. Copy `inventory/hosts.example.yml` to the ignored
   `inventory/hosts.yml` operator inventory.
3. Copy the non-secret group-variable example to the ignored
   `group_vars/stockcontrol.yml`.
4. Create a separate encrypted Ansible Vault file using only the variable names
   in `vault.example.yml`, normally at the ignored `group_vars/vault.yml`.
   Never put a decrypted vault or real values in this repository.
5. Verify the instance SSH host key out of band and add it to `known_hosts`.
6. Run syntax and check mode, review changes, then apply during the approved
   maintenance window.

## Build and image contract

Build and publish each target from the same approved commit:

```text
docker build --target api --tag REGISTRY/stockcontrol-api:VERSION .
docker build --target worker --tag REGISTRY/stockcontrol-worker:VERSION .
docker build --target web --tag REGISTRY/stockcontrol-web:VERSION .
```

Resolve the registry digest after publication and configure
`stockcontrol_api_image`, `stockcontrol_worker_image`, and
`stockcontrol_web_image` using `name@sha256:<64 lowercase hex characters>`.
Do the same for the reviewed Caddy and PostgreSQL base images. The playbook
rejects tags and placeholder digests.

## Database and secret contract

The first start of a new PostgreSQL volume creates four separate identities:

- `stockcontrol_admin` is the container bootstrap administrator;
- `stockcontrol_migrator` owns the database schema;
- `stockcontrol_app` is the least-privilege API/worker runtime;
- `stockcontrol_backup` has read-only backup access.

The bootstrap SQL runs only for a new empty volume. It is not a credential
rotation mechanism for an existing installation. Migrations must grant the
minimum schema/table/sequence privileges required by `stockcontrol_app`; the
runtime never receives admin or migrator credentials.

Before replacing any environment file, the playbook detects the named
PostgreSQL volume and compares its installed bootstrap environment with the
encrypted variables. It stops on a mismatch. Follow
`docs/operations/database-credentials.md` to rotate and verify the live roles;
the one-run acknowledgement is only for reconciling files after that rotation.

Secrets are rendered only into root-owned mode-`0600` environment files and
secret-rendering tasks use `no_log`. The generated Compose file is
world-readable but contains no secret values. Document access and backup upload
use different AWS identities. The document identity must be scoped only to the
customer document bucket; the backup identity must be scoped only to append and
verify objects in the customer backup bucket.

Generate each database password independently with at least 32 characters from
the RFC 3986 unreserved set (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `-`). This
keeps the distinct credentials safe in PostgreSQL connection URLs without
ambiguous URI parsing. The playbook rejects reused or incompatible database
passwords.

Generate `vault_session_secret` and `vault_field_encryption_key` independently
as 32 random bytes encoded with canonical unpadded base64url (43 characters).
The playbook decodes both and requires exactly 32 bytes before deployment.

`requirements.yml` selects one reviewed `community.docker` collection release.
Upgrade it as an explicit dependency change rather than using a version range.

## Migration activation block

The example configures the reviewed, idempotent production migration command as
`["node", "packages/platform/database/dist/migrate.js"]`. Keep it as a
non-secret argument list: Ansible starts PostgreSQL, runs it once through the
dedicated migrator service without shell parsing, starts the application
services, and only then enables daily backups. Ansible still refuses to
activate a deployment when this argument list is missing or empty.

The migrator environment contains `DATABASE_MIGRATOR_URL` and the non-secret
`DATABASE_RUNTIME_ROLE=stockcontrol_app` name only. It never receives
`DATABASE_URL` or the runtime password; the migrator grants privileges to the
named role without authenticating as it.

The first production run must prove the application image commands, migration
procedure, readiness endpoint, bucket policy, least-privilege credentials,
independent document backup, alerts, and full restore before customer launch.
