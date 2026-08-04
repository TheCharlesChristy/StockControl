# Railway production MVP

This directory is the deployment source of truth for one small StockControl
customer installation on Railway. The intended production shape is:

```text
Internet -> web (public Nginx/React) -> api (private NestJS)
                                         |-> PostgreSQL (private)
                                         `-> media Bucket (private)

migrate (private, runs to completion) -> PostgreSQL
```

Run one `web` and one `api` replica in Railway EU West (Amsterdam). Do not
deploy the heartbeat-only worker. Only `web` receives a public domain.

## What the repository controls

Railway Config as Code controls each service's build, health check, restart
policy, region and replica count:

| Service     | Lifecycle | Config path                             | `RUNTIME_TARGET` | Process                                                   |
| ----------- | --------- | --------------------------------------- | ---------------- | --------------------------------------------------------- |
| `web`       | Retained  | `/infra/railway/web.railway.json`       | `web`            | Image default                                             |
| `api`       | Retained  | `/infra/railway/api.railway.json`       | `api`            | Image default                                             |
| `migrate`   | Retained  | `/infra/railway/migrate.railway.json`   | `api`            | `node packages/platform/database/dist/migrate.js`         |
| `bootstrap` | Temporary | `/infra/railway/bootstrap.railway.json` | `api`            | `node packages/platform/database/dist/bootstrap-roles.js` |

The paths are absolute repository paths entered under each Railway service's
**Settings -> Config as Code**. Keep the repository root as the source root.
Railway combines these files with dashboard settings, with the files taking
precedence for settings they declare.

The root Dockerfile selects the final image using the `RUNTIME_TARGET` build
argument. Railway makes a service variable available during Docker builds
because the Dockerfile declares the matching `ARG`. The same mechanism maps
`RAILWAY_GIT_COMMIT_SHA` into the image labels and `/api/v1/version` response.

## First installation

### 1. Create the project and data services

1. Create an empty Railway project and select **EU West (Amsterdam)** for the
   production environment.
2. Add Railway PostgreSQL and name the service `Postgres`.
3. Disable/remove PostgreSQL's public TCP proxy. Application traffic must use
   its private hostname.
4. Enable Railway PostgreSQL point-in-time recovery or the strongest native
   backup option available on the chosen plan.
5. Add a private Railway Bucket and name it `media`.

Railway-only recovery is an explicit MVP tradeoff. PostgreSQL recovery covers
the database, but Railway Buckets do not currently provide object versioning,
lifecycle rules or native snapshots. Accidental media replacement/deletion may
therefore be unrecoverable. Export irreplaceable media before destructive
maintenance and add an independent versioned copy in a later upgrade.

### 2. Create services without deploying them

Create three retained services named exactly `migrate`, `api` and `web`. Step 4
creates a fourth, temporary `bootstrap` service and deletes it after successful
role verification. Connect each retained service to this GitHub repository and
its production branch only after setting its Config as Code path and variables.
Do not create a public domain for `api` or `migrate`. Generate a temporary
Railway HTTPS domain for `web` before the first API deployment so its exact
origin can be configured on `api`.

Disable GitHub autodeploys for all three services. Production releases are
ordered manually (`migrate`, then `api`, then `web`) so independent GitHub
deployments cannot start application code before its schema is ready. Keep the
GitHub Actions workflow as a required branch check.

### 3. Configure variables

Do not put real values in this repository. Use Railway's secret-aware variable
editor and reference variables where shown.

#### `web`

```text
RUNTIME_TARGET=web
PORT=8080
API_HOST=${{api.RAILWAY_PRIVATE_DOMAIN}}
API_PORT=3000
```

The browser uses relative `/api/*` URLs. Nginx resolves `API_HOST` using the
container's current DNS resolver, so the private API can move between Railway
hosts without rebuilding the web image.

#### `api`

```text
RUNTIME_TARGET=api
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
PUBLIC_APP_ORIGIN=https://<the exact web domain>
DATABASE_URL=<private URL for stockcontrol_app>
DATABASE_POOL_MAX=5
LOG_LEVEL=info
FLOOR_PLAN_S3_ENDPOINT=${{media.ENDPOINT}}
FLOOR_PLAN_S3_BUCKET=${{media.BUCKET}}
FLOOR_PLAN_S3_REGION=${{media.REGION}}
FLOOR_PLAN_S3_ACCESS_KEY=${{media.ACCESS_KEY_ID}}
FLOOR_PLAN_S3_SECRET_KEY=${{media.SECRET_ACCESS_KEY}}
FLOOR_PLAN_S3_URL_STYLE=virtual
```

`DATABASE_URL` must use the Postgres service's **private** hostname. With
`NODE_ENV=production` the API refuses to start on a public database host unless
the URL also carries `sslmode=require` (or `verify-full`), because that traffic
would otherwise cross the internet carrying the role's password in the clear.
The same rule applies to `DATABASE_MIGRATOR_URL` on the `migrate` service. If a
recovery step genuinely needs the public TCP proxy, append the `sslmode`
parameter rather than removing the check.

`PUBLIC_APP_ORIGIN` is one origin with scheme and no trailing slash. Update it
when replacing a temporary Railway domain with the customer domain. It also
decides the session cookie: an `https` origin makes the cookie `Secure` and
host-locked with the `__Host-` prefix. Production
unsafe requests with a missing or different `Origin` are rejected.

The five Bucket connection variables are an all-or-none set. `virtual` is
required for current Railway Buckets; local MinIO continues to use `path`.

Optional GitHub issue reporting requires `GITHUB_REPOSITORY` and a fine-grained
`GITHUB_TOKEN` with Issues read/write access. Leave both unset if that feature
is not required; the web control is hidden when either value is unavailable.

#### `migrate`

```text
RUNTIME_TARGET=api
NODE_ENV=production
DATABASE_MIGRATOR_URL=<private URL for stockcontrol_migrator>
DATABASE_RUNTIME_ROLE=stockcontrol_app
```

Do not give `migrate` the runtime URL. Do not give `api` the administrator or
migrator URL. The migration process exits zero after a successful integrity
check and non-zero on any migration failure.

### 4. Bootstrap PostgreSQL

Create a temporary private service named `bootstrap` from the same repository,
using `/infra/railway/bootstrap.railway.json`, `RUNTIME_TARGET=api`, and these
three secrets:

```text
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
DATABASE_MIGRATOR_URL=postgresql://stockcontrol_migrator:<64-hex-secret>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
DATABASE_URL=postgresql://stockcontrol_app:<different-64-hex-secret>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
```

Generate each 64-hex-character value independently from 32 random bytes using
a password manager or approved secret generator. Both proposed URLs must use
the same private host, port and database as `DATABASE_ADMIN_URL`; only their
username/password differs.

Deploy `bootstrap` once and require a successful, completed deployment. Its
command is:

```text
node packages/platform/database/dist/bootstrap-roles.js
```

The command refuses endpoint/database mismatches or unsafe pre-existing role
attributes. It restricts public privileges and creates the migrator/runtime
boundary without printing connection strings or passwords. On a safe rerun it
does not rotate compatible existing-role passwords; instead, it connects
through both supplied role URLs and verifies their identity/database, so a
wrong or stale secret fails closed. Copy the migrator URL to `migrate` and the
runtime URL to `api`, then delete the entire temporary `bootstrap` service.
This removes `DATABASE_ADMIN_URL` from the application deployment surface.

Never use `scripts/postgres/init/001_roles.sql` against Railway. It contains
fixed local-development names and passwords.

### 5. Deploy, migrate and create the Admin

1. Confirm `PUBLIC_APP_ORIGIN` is the exact temporary web HTTPS origin.
2. Deploy the `migrate` service from the approved commit and wait for a
   successful, completed deployment.
3. Deploy `api` from the same commit and wait for
   `/api/v1/health/ready` to pass.
4. Deploy `web`. Its Railway health check is Nginx's own `/health`, so the web
   service reports on the web service. Prove the proxy path separately with the
   readiness check in step 6 — a health check that reached through to the API
   would mark `web` unhealthy whenever `api` restarts, which is precisely the
   window this release order creates.
5. Open an interactive shell in the API deployment (right-click `api` and copy
   Railway's SSH command), then run:

   ```text
   node apps/api/dist/setup-first-admin.js --email <admin-email> --display-name "<admin name>"
   ```

   Enter and confirm the password at the hidden terminal prompts. Production
   passwords must contain 15 to 128 Unicode characters. The setup refuses to
   run if any user already exists and never prints the password.

6. Sign in as the Admin and complete the smoke checks below.
7. Add the customer domain to `web`, wait for managed TLS, change
   `PUBLIC_APP_ORIGIN`, and redeploy `api` then `web`.

Do not run `pnpm db:seed` in production. The demo seed is destructive and is
also guarded from running when `NODE_ENV=production`.

## Release procedure

For every production release:

1. Merge only after GitHub Actions is green.
2. Record the commit SHA and confirm the working migration is backward
   compatible with the currently active API.
3. Use **Deploy Latest Commit** on `migrate`; require a successful completion.
4. Deploy that same commit to `api`; require readiness.
5. Deploy that same commit to `web`; require proxied readiness.
6. Run the smoke checks and observe logs/metrics before closing the release.

If migration fails, stop and leave the existing API/web deployments active.
For an application regression with a compatible schema, redeploy the preceding
API and web commit. Never roll a database backward by editing migration history.

## Smoke checks

Replace `APP_ORIGIN` with the exact HTTPS origin. Unsafe requests include the
same-origin `Origin` header required by the API.

```bash
curl --fail --show-error --silent "$APP_ORIGIN/health"
curl --fail --show-error --silent "$APP_ORIGIN/api/v1/health/live"
curl --fail --show-error --silent "$APP_ORIGIN/api/v1/health/ready"
curl --fail --show-error --silent "$APP_ORIGIN/api/v1/version"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  -H "Origin: $APP_ORIGIN" \
  -H 'Content-Type: application/json' \
  --data '{"email":"nobody@example.invalid","password":"intentionally-invalid"}' \
  "$APP_ORIGIN/api/v1/auth/sign-in")" = 401
```

Then verify in a browser:

- the Admin can sign in and an invalid password is rejected;
- the session cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and scoped to `/`;
- an authenticated inventory read and one reversible stock operation work;
- a floor plan or item photo can be uploaded, viewed and deleted;
- `/api/*` works only through `web` and the API has no public domain;
- the response includes CSP, HSTS, frame, content-type, referrer and camera
  permission headers; and
- `/api/v1/version` reports the deployed Git commit rather than `unknown`.

## Admin password recovery

Self-service email reset is deferred for the MVP. If the Admin loses their
password, open an interactive shell in the private API deployment and run:

```text
node apps/api/dist/reset-admin-password.js --email <admin-email>
```

Enter and confirm the replacement at the hidden prompts. The command requires
the normalized email to identify one active Admin, enforces the same
15-to-128-character policy, updates the hash atomically and revokes every
session for that account. It does not print the email or password. Record the
operator, time and reason in the incident or support record without recording
the secret.

## Recovery and routine operation

- Configure Railway deployment-failure and resource alerts for all persistent
  services, plus a monthly project-spend limit appropriate to two users.
- Check PostgreSQL recovery status after every material Railway configuration
  change. Rehearse a restore into a separate environment before launch and
  quarterly thereafter.
- A database restore does not restore the `media` Bucket. Preserve the current
  Bucket while investigating any data incident.
- Record the restore point, restored service, schema version, commit, smoke
  results and measured recovery time.
- Never delete a project, PostgreSQL service or Bucket as a retry mechanism.

Railway references: [Config as Code](https://docs.railway.com/config-as-code/reference),
[Dockerfiles](https://docs.railway.com/builds/dockerfiles),
[private networking](https://docs.railway.com/networking/private-networking),
[PostgreSQL](https://docs.railway.com/databases/postgresql), and
[storage buckets](https://docs.railway.com/storage-buckets).
