# Enabling assisted stock capture on an existing Railway installation

This is an addendum to [`infra/railway/README.md`](../../infra/railway/README.md),
not a replacement for it. It assumes a working `web`/`api`/PostgreSQL/`media`
installation already following that runbook, and covers only what assisted
stock capture (`docs/stock-capture-technical-spec.md`) adds on top of it.

## Nothing changes until you act

`STOCK_CAPTURE_ENABLED` is read once at API startup and defaults to off. The
commit that adds this feature can be deployed to `api` and `web` exactly like
any other release — migration included — and the running installation behaves
identically to before: no new route is registered, no navigation entry
appears, no new background work runs. Everything below is opt-in, and every
step can be reverted by unsetting one variable (see **Turning it off**).

## Two enablement paths

The feature has a hard dependency on exactly one new service, `worker`
(the durable job queue and its handlers). Two further services,
`recognition-core` and `recognition-fusion`, are optional model backends.
Every stage they would provide — OCR, visual similarity, the vision-language
model — degrades to reporting itself `Unavailable` when its service is not
configured, per specification section 9.3's per-stage guarantee. A session
still reaches `ReviewReady` on whatever evidence exists, even none, and a
person can always type the item in by hand.

**Path A — barcode and manual entry only** is available today with this
commit. It needs `worker` and the database migration, nothing else.

**Path B — the full recognition pipeline** additionally needs
`recognition-core` and `recognition-fusion`, which now have a reproducible
provisional model manifest. The specification's S0 benchmark (top-five recall,
Strong-band precision, warm/cold latency, measured Railway cost — section 20)
has not been run because no consented evaluation set was provided. Path B can
verify the real runtime locally, but it must not be described as having passed
the accuracy/resource promotion gates until that evidence exists.

## Path A — deploy the worker and turn the flag on

### 1. Deploy the migration

Release this commit through the normal procedure in
`infra/railway/README.md` — `migrate`, then `api`, then `web` — waiting for
each to succeed before the next. `migrate` applies migration
`0007_assisted_stock_capture` (the seven new tables under the `stockcontrol`
schema) and grants the `stockcontrol_app` runtime role exactly the privileges
`RUNTIME_TABLE_PRIVILEGES` declares for them; no separate grant step exists or
is needed. `api` and `web` start exactly as before — the flag is still unset.

### 2. Create the `worker` service

Create one retained, **private** service named `worker` (no public domain),
connected to this repository and its production branch, Config as Code path
`/infra/railway/worker.railway.json`. Leave GitHub autodeploy disabled, same
as the other retained services.

```text
RUNTIME_TARGET=worker
NODE_ENV=production
DATABASE_URL=<the same private stockcontrol_app URL configured on api>
FLOOR_PLAN_S3_ENDPOINT=${{media.ENDPOINT}}
FLOOR_PLAN_S3_BUCKET=${{media.BUCKET}}
FLOOR_PLAN_S3_REGION=${{media.REGION}}
FLOOR_PLAN_S3_ACCESS_KEY=${{media.ACCESS_KEY_ID}}
FLOOR_PLAN_S3_SECRET_KEY=${{media.SECRET_ACCESS_KEY}}
FLOOR_PLAN_S3_URL_STYLE=virtual
```

Nothing here is new credentials or a new bucket: `worker` downloads,
uploads and deletes objects in the exact `media` Bucket `api` already
presigns uploads into, using the same five connection variables `api`
already has. `DATABASE_URL` is the same runtime-role connection string
already configured on `api` — one role, one set of grants, two processes
reading and writing through it. Do not give `worker` the migrator or
administrator URL.

Leave `PORT` unset. Railway supplies it automatically, and the image's own
`HEALTHCHECK` and `worker.railway.json`'s `healthcheckPath` (`/health/ready`)
already read it the same way `api` and `web` do.

Every other worker variable —`WORKER_HEARTBEAT_MS`, `RECOGNITION_POLL_MS`,
`RECOGNITION_BATCH_SIZE`, `RECOGNITION_LEASE_MS`,
`RECOGNITION_LEASE_RENEWAL_MS`, `WORKER_DATABASE_POOL_MAX`,
`STOCK_CAPTURE_SESSION_LIFETIME_SECONDS`,
`STOCK_CAPTURE_UPLOAD_GRANT_SECONDS`, `STOCK_CAPTURE_MAX_ATTEMPTS`— has a
default suitable for a small installation. Set one only if you have a
specific, measured reason to.

Deploy `worker` and confirm `/health/ready` passes before continuing. It
claims nothing yet — `STOCK_CAPTURE_ENABLED` is still off everywhere, so
`api` never enqueues a job for it to find.

### 3. Turn the flag on

Add to `api`:

```text
STOCK_CAPTURE_ENABLED=true
```

Redeploy `api` from the same commit, then redeploy `web` from the same
commit (it needs no new variables; the flag reaches the browser through the
session response `api` already returns, and this redeploy exists only to
keep the release procedure's "same commit on every service" invariant, not
because `web`'s behaviour depends on its own build). Confirm both readiness
checks pass.

### 4. Smoke-check the capture path

Sign in as an Office or Admin user. **Add stock** now appears in navigation.
Photograph a seeded item's barcode: it should resolve without any photograph
upload (the exact-match short cut) and reach the confirmation screen
directly. Photograph an unlabelled item: it should reach `ReviewReady`
recommending manual entry (no model services are configured in Path A), let
you type the item in, and post one stock receipt. Confirm the item's balance
and transaction log reflect it, and that resubmitting the same confirmation
does not create a second one.

Then confirm the janitor: after the commit above, and again after cancelling
an in-progress session from **Add stock**, check the `worker` logs for
`capture.cleanup.completed` — the photographs that session declared should
no longer exist in the `media` Bucket under `stock-capture/<sessionId>/`.

## Path B — add the recognition and fusion services

Do this only with the reviewed manifest revision intended for the deployment.
The current manifest includes recognition-core's OCR/embedding artefacts and
recognition-fusion's LFM2.5-VL-1.6B model/projector. It is a staging evaluation
candidate and remains provisional because the S0 accuracy and resource
benchmark was skipped; deployment must retain the manual/partial-assist posture
until those measurements are supplied.

### 1. Create `recognition-core`

Retained, private, no public domain. Config as Code path
`/infra/railway/recognition-core.railway.json`.

```text
RUNTIME_TARGET=recognition-core
PORT=8000
```

The model weights are baked into the image at build time by
`services/recognition-core/scripts/fetch_models.py`, driven by
`models/manifest.lock.json` — there is no runtime variable that points this
service at weights, and it makes no outbound request once running. Deploy
and confirm `/health/ready` passes; a `503` there means the manifest entry
did not resolve to files the service actually loaded, not a configuration
problem this runbook can fix.

### 2. Create `recognition-fusion`

Retained, private, no public domain. Config as Code path
`/infra/railway/recognition-fusion.railway.json`.

```text
RUNTIME_TARGET=recognition-fusion
PORT=8000
RECOGNITION_FUSION_MODEL_PATH=/models/lfm2.5-vl-1.6b-q4-0/LFM2.5-VL-1.6B-Q4_0.gguf
RECOGNITION_FUSION_MMPROJ_PATH=/models/lfm2.5-vl-1.6b-q4-0/mmproj-LFM2.5-VL-1.6b-F16.gguf
RECOGNITION_FUSION_API_KEY=<a fresh 64-hex-character secret>
```

The image contains one-release compatibility aliases for the former 3B paths,
so an existing staging service remains healthy during this variable migration.
Move Railway to the canonical 1.6B paths above before removing those aliases in
a later release.

Generate `RECOGNITION_FUSION_API_KEY` the same way the PostgreSQL role
passwords in the base runbook are generated — 32 random bytes, hex-encoded,
from a password manager or approved secret generator — and do not reuse a
secret from anywhere else. The two `_PATH` variables must match exactly
where the image build placed those files; wrong or missing paths fail the
container at startup (`docker-entrypoint.sh`'s own check), not silently.
Deploy and confirm `/health` passes.

### 3. Point `worker` at both

Add to `worker` and redeploy it:

```text
RECOGNITION_CORE_URL=http://${{recognition-core.RAILWAY_PRIVATE_DOMAIN}}:8000
RECOGNITION_FUSION_URL=http://${{recognition-fusion.RAILWAY_PRIVATE_DOMAIN}}:8000
RECOGNITION_FUSION_API_KEY=<the same secret set on recognition-fusion>
VISUAL_INDEX_EMBEDDING_MODEL=<the embedding model revision recognition-core reports>
```

`PORT=8000` is deliberate on both services. Railway injects `PORT` and the
runtime images listen on it, while these private worker URLs use port 8000.
Leaving the service port implicit can therefore make a healthy service listen
on Railway's assigned port while the worker calls a different one.

Optionally add `BRAVE_SEARCH_API_KEY` for the bounded web-evidence stage
(specification section 7.4); leave it unset to skip that stage entirely.

Every stage now has a service behind it. Re-run the smoke check in Path A
step 4 against a photograph with no barcode: it should now return OCR,
visual-similarity and VLM evidence rather than recommending manual entry
outright, still ending at a person confirming identity, quantity and
location before anything reaches stock.

## Resource sizing

Not measured. Section 20's cost and latency gates require a running Railway
deployment to measure against, which is exactly what this runbook produces
for the first time — there is no prior number to cite. Start every new
service at Railway's smallest plan tier, watch actual CPU/RAM/latency after
Path A (and again after Path B, which is materially heavier — `llama-server`
holds a loaded vision-language model in memory for the lifetime of the
service), and size up from what you observe rather than a guess recorded
here going stale.

## Turning it off

Unset `STOCK_CAPTURE_ENABLED` on `api` (or set it to anything other than
`true`) and redeploy. The routes stop being registered, the navigation entry
disappears, and no new capture work is enqueued. `worker`,
`recognition-core` and `recognition-fusion` can be left running harmlessly
idle or stopped independently — stopping them first is not required, since
`api` alone gates whether anything ever reaches them. No data is lost:
existing batches, sessions and committed stock transactions are untouched by
turning the flag off, and the capture janitor keeps deleting session
photographs on the schedule it always has, flag or no flag.

## What does not change

Deploying every service in this runbook without ever setting
`STOCK_CAPTURE_ENABLED=true` changes nothing observable about the existing
installation: the migration adds tables nothing else reads yet, `worker`
sits idle claiming no jobs, and `api`/`web` behave exactly as they did
before this commit.
