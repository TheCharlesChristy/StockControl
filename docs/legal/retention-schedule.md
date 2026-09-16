# Retention schedule

Personal data may be kept no longer than it is needed for what it was
collected for. That is Article 5(1)(e), and it is the principle most often
broken by simply never deleting anything.

This schedule is enforced by `pnpm db:retain`, which is the only thing that
enforces it. The windows live in
`packages/platform/database/src/retention/schedule.ts`; this document is why
they are what they are.

## What is kept, and for how long

| Record                                         | Kept for  | Why that long                                                                                   |
| ---------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| Stock movements (`transactions`)               | 6 years   | Accounting records. Companies Act 2006 s.388 and HMRC's six-year rule set this, not us.         |
| User accounts (`users`)                        | See below | Held while the ledger that points at them is held.                                              |
| Assistant activity (`mcp_*`)                   | 12 months | Long enough to investigate a disputed action. Committed to in ADR 0010.                         |
| Assistant grant history (`oauth_grant_events`) | 12 months | Same window; it is the record of who connected what.                                            |
| Map edits (`map_edit_events`)                  | 12 months | Operational history. A year covers "who moved this and when" and no business need runs past it. |
| Capture session working state                  | 90 days   | The receipt is in `transactions`; this is the working-out. A quarter covers a disputed count.   |
| Capture photographs (object storage)           | ≤ 30 days | Enforced separately by the worker's expiry sweep, against `delete_after`.                       |
| Sign-in sessions (`sessions`)                  | To expiry | Swept hourly by the API once expired.                                                           |
| Assistant sign-in attempts                     | Minutes   | Short-lived by construction; swept continuously.                                                |
| Backups                                        | See below | Set by the platform, not by this schedule.                                                      |

## Two things this job deliberately does not delete

**The stock ledger.** `transactions` is both the company's accounting record
and the record of who moved what, so it cannot be aged out on a twelve-month
monitoring clock — the six-year obligation wins. It is also append-only by
database grant, and `stock_levels` is derived from it, so deleting a row would
quietly falsify a count rather than remove a record. Erasure at the six-year
boundary is a reviewed manual operation. When that first becomes due, the
question to answer is whether the actor can be detached from movements older
than six years while leaving the quantities intact — which is a schema change,
not a job.

**User accounts.** A leaver is deactivated, which ends their access
immediately and is the control that matters. The row survives because every
table recording what a person did references it with `on delete restrict`; the
database refuses to erase anybody with history, deliberately. An account with
no history can be, and is, deleted outright.

Both positions are recorded in the schedule file itself so that the next
person to read the code finds the reasoning without coming here.

## Running it

```bash
pnpm db:retain -- --dry-run   # what is out of policy, removing nothing
pnpm db:retain                # apply it
pnpm db:retain:prod           # the built entrypoint, for a scheduled job
```

It runs under `DATABASE_MIGRATOR_URL`, not the API's credential. This is the
point: the audit tables are append-only to the runtime role on purpose, so
that somebody who reaches the API cannot erase the record of what they did.
Granting the API delete so a nightly sweep could work would give away exactly
what the append-only grant was protecting.

The whole run is one transaction. Every foreign key these rules touch is
`on delete restrict`, so a half-applied purge would leave children whose
parents survived and the next run would fail rather than repair itself. A row
still held up by something outside this schedule's own hierarchy — a session
whose photograph bytes the worker has not yet confirmed deleted, say — is
simply left out of that run rather than attempted and failed; see the
conditions noted against the affected rules in `schedule.ts`.

Schedule it **daily**, off-peak. It is idempotent, and a run with nothing to do
costs one query per table.

## Changing a window

Both windows are environment variables — `RETENTION_AUDIT_DAYS` and
`RETENTION_CAPTURE_DAYS`. A malformed value is refused rather than defaulted,
because a job that reports success while keeping records for a period nobody
chose is worse than one that fails.

Before changing one:

1. Run `pnpm db:retain -- --dry-run` with the new value to see what it would
   destroy. Deletion is not reversible outside a backup restore.
2. Shortening a window past a live investigation or a pending subject access
   request destroys evidence you are obliged to keep. Check first.
3. Update the table above and the
   [privacy notice](./privacy-notice.md#how-long-it-is-kept), which tells
   people these periods. Changing the code and not the notice makes the notice
   untrue.

## Backups

Backups are outside this job's reach, and deleting a record from the live
database does not delete it from a backup taken before the deletion. This is
accepted rather than solved: the ICO's position is that backup data may be put
"beyond use" while it ages out on its own cycle, provided it is not restored
selectively to bring a deleted record back.

What that requires in practice: a backup is restored whole or not at all, and
the retention job runs after any restore. The
[backup and restore runbook](../operations/backup-and-restore.md) is where the
cycle length is recorded.
