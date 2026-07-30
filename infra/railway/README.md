# Railway deployment

StockControl is deployed as four Railway services in one customer project:

- `web`: the public React/Nginx service;
- `api`: a private NestJS API service;
- `worker`: a private long-running job worker;
- `postgres`: Railway PostgreSQL.

Add one private Railway Bucket for documents and generated files. Keep the
service name `api`: the web image proxies `/api/*` to
`http://api.railway.internal:3000`.

## Service configuration

Create the `web`, `api`, and `worker` services from the same GitHub repository
and Dockerfile. Set the build-time variable below on each service:

| Service  | `RUNTIME_TARGET` | Listener port              | Health check                       |
| -------- | ---------------- | -------------------------- | ---------------------------------- |
| `web`    | `web`            | `8080`                     | `/health`                          |
| `api`    | `api`            | `3000`                     | `/api/v1/health/ready`             |
| `worker` | `worker`         | Railway `PORT` (or `3001`) | `/health/ready` on the worker port |

Railway exposes service variables to Docker builds when the variable is
declared as a Docker `ARG`; the root Dockerfile declares `RUNTIME_TARGET` for
this purpose. The default target is `web`, preserving ordinary local builds.

Only `web` receives a public domain. The API and worker use Railway private
networking. Set the public domain as:

```text
PUBLIC_APP_URL=https://<customer-domain>
ALLOWED_WEB_ORIGINS=https://<customer-domain>
```

Set `PORT=3000` on the `api` service. The web proxy intentionally targets
`api.railway.internal:3000`; fixing this listener port avoids a mismatch if
Railway's automatic port selection changes. The `web` service should expose
port `8080`. The worker may use Railway's injected `PORT`; its health endpoint
falls back to `3001` for local and explicitly configured deployments.

The API and worker receive the private PostgreSQL URL and the Railway Bucket
credentials. Keep runtime and migration database roles separate:

```text
DATABASE_URL=<stockcontrol_app connection URL>
DATABASE_MIGRATOR_URL=<stockcontrol_migrator connection URL>
DATABASE_RUNTIME_ROLE=stockcontrol_app
```

Railway's PostgreSQL service initially supplies an administrative connection.
Use the reviewed role-bootstrap/migration procedure before exposing the web
service. Never put the administrative password in the API or worker service.

## Local development

MinIO remains the local S3-compatible implementation. The Railway bucket is
also S3-compatible, so the application storage adapter does not need an AWS
SDK-specific code path. Replace only the endpoint, bucket and credentials in
the Railway environment.

## Release checklist

1. GitHub Actions checks pass: formatting, linting, type checking, tests and
   build.
2. Railway builds each target from the same commit.
3. Database migrations complete with the migrator role.
4. API readiness and worker readiness are healthy.
5. Web `/health` is healthy and `/api/*` requests reach the private API.
6. A harmless private-bucket upload and download succeeds.
7. The customer domain resolves over HTTPS.

The former Lightsail, Ansible and systemd deployment files remain available as
historical infrastructure until the first Railway restore rehearsal succeeds.
