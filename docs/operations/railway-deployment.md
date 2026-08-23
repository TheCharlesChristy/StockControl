# Railway production MVP operations

The executable setup and acceptance runbook is
[`infra/railway/README.md`](../../infra/railway/README.md). This document records
the operating decisions for the first small customer installation.

## Deployment baseline

- Region: Railway EU West (Amsterdam).
- Capacity: one public `web` replica and one private `api` replica for one or
  two concurrent users.
- Data: private Railway PostgreSQL plus a private Railway Bucket named `media`.
- Release task: private `migrate` service that runs to completion for each
  release. Initial provisioning also uses a fourth, temporary private
  `bootstrap` service, which is deleted after role verification.
- Worker: omitted until it performs business work.
- Authentication: password-only for the MVP, with a shared 15-to-128-character
  policy enforced whenever a password is set: first-Admin setup, Admin-created
  users and operator Admin recovery.
- Recovery: Railway-native PostgreSQL recovery only; Bucket object history and
  independent backup are deferred and recorded risks.

Only `web` has a public domain. Browser/API traffic stays same-origin and Nginx
forwards `/api/*` to Railway private DNS. The API requires the configured
`PUBLIC_APP_ORIGIN` on unsafe production requests.

## Change control

GitHub autodeploys remain disabled because GitHub-triggered Railway deployments
of monorepo services are independent and do not provide migration ordering.
Every release uses the same reviewed commit in this order:

1. GitHub Actions passes quality, tests and both production-image builds.
2. `migrate` completes successfully with `DATABASE_MIGRATOR_URL` and the
   non-secret `DATABASE_RUNTIME_ROLE`; it never receives `DATABASE_URL` or the
   runtime password.
3. `api` reaches database-backed readiness with only the runtime database URL.
4. `web` reaches the API readiness route through the private proxy.
5. The operator completes the runbook smoke tests and observation period.

Migration failure stops the release before either persistent service changes.
An application rollback redeploys the preceding compatible API/web commit; it
does not rewrite migration history or customer data.

## Secrets and access

- Store passwords and connection URLs only in Railway's variable editor.
- Never copy the PostgreSQL administrator URL into `api`, `web` or `migrate`.
- `api` receives `DATABASE_URL`; `migrate` receives
  `DATABASE_MIGRATOR_URL` and the non-secret runtime role name.
- The first Admin password is entered only at the hidden prompt inside an
  interactive API container shell.
- Admin password recovery uses the runbook's interactive private-container
  command, revokes existing sessions and is recorded as an operator action.
- Disable PostgreSQL's public TCP proxy and do not generate API/migration
  domains.
- Require MFA on the Railway workspace even though application MFA is deferred.

## Backup and incident limits

Enable and monitor the strongest Railway PostgreSQL backup/PITR option on the
selected plan. Restore rehearsals use an isolated Railway environment and
record the restore point, schema version, release commit, checks and recovery
time.

Railway Bucket contents are live data, not an independent backup. The MVP
cannot recover a deleted or overwritten media object from Railway-native
history. During an incident, preserve the Bucket and database before changing
anything. Do not delete a service/project as a retry. Adding a versioned
off-platform media/database copy is the first recovery upgrade after launch.

## Data protection configuration

Set before a customer installation takes real data. None of it has a safe
inferred default, and the software says so rather than guessing.

On the `web` service, at build time:

| Variable                    | What it is                                            |
| --------------------------- | ----------------------------------------------------- |
| `VITE_DATA_CONTROLLER_NAME` | The business answerable for the data — its legal name |
| `VITE_PRIVACY_CONTACT`      | Where a member of staff sends a question or a request |

These name the controller in the in-app privacy notice. Until they are set the
notice says plainly that nobody has been named, which is honest but is not a
notice. They are read at build time, so changing one needs a redeploy of `web`.

On the retention job:

| Variable                 | Default | What it governs                              |
| ------------------------ | ------- | -------------------------------------------- |
| `RETENTION_AUDIT_DAYS`   | `365`   | Assistant activity, grant history, map edits |
| `RETENTION_CAPTURE_DAYS` | `90`    | Assisted capture session records             |

**Schedule `pnpm db:retain:prod` daily**, as a Railway cron service with the
migrator credential — not on the `api` service. The API's database role
deliberately cannot delete audit records, so that reaching the API does not let
somebody erase the evidence of it; the purge therefore needs
`DATABASE_MIGRATOR_URL`, the same credential the release migration step uses.

Nothing else enforces retention. If this job is not scheduled, records are kept
for ever and the privacy notice's retention periods are untrue.

Run `pnpm db:retain -- --dry-run` before changing a window: it reports what is
out of policy without removing anything, and deletion is not reversible outside
a backup restore. The reasoning behind each period is in
[the retention schedule](../legal/retention-schedule.md).

Also confirm at launch:

- The Railway **region**. An installation serving UK or EU staff should use an
  EU region, which turns the largest international transfer into no transfer.
  Record the choice in
  [records of processing](../legal/records-of-processing.md#international-transfers).
- The rest of the go-live checklist in [`docs/legal/`](../legal/README.md).

## Routine checks

- Confirm the retention job ran, and that its last run reported a plausible
  number of rows rather than silently failing.
- Review deployment failures, API/web CPU and memory, PostgreSQL connections
  and storage, and project spend.
- Test external web health plus proxied API readiness after every release.
- Confirm `/api/v1/version` matches the approved Git SHA.
- Test a private media upload/read/delete after storage or credential changes.
- Review sign-in rate-limit and rejected-origin security events when
  investigating access failures.
- Restore PostgreSQL before launch and quarterly thereafter.

See also [incident response](./incident-response.md),
[personal data breach](./personal-data-breach.md),
[monitoring](./monitoring.md), and the
[Railway infrastructure runbook](../../infra/railway/README.md).
