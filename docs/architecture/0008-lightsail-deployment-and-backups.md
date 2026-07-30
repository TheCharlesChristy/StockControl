# ADR 0008: Deploy one customer per AWS Lightsail installation

- Status: Accepted
- Date: 2026-07-29
- Requirements: Product requirements 12 and 15.3

## Context

The MVP requires a dedicated installation and domain for each customer, HTTPS,
best-effort operation, automated monitoring, encrypted daily backups retained
for at least 30 days, and tested restoration. Multi-region and enterprise
availability are explicitly deferred.

## Decision

Provision a separate AWS Lightsail Linux instance and static IP for each
customer. Run the versioned web and worker containers plus PostgreSQL 18 behind
a TLS-terminating reverse proxy. Permit public ingress only for HTTP (redirect)
and HTTPS; restrict SSH to configured vendor administration networks.

Keep production secrets outside Git and Terraform configuration, inject them
from the operator's encrypted secret store, and use distinct credentials per
installation. Store private documents in a customer-specific private S3 bucket
following ADR 0006.

Create daily consistent PostgreSQL logical backups, application configuration
manifests without secret values, and object-storage inventories. Encrypt backup
objects in a customer-specific private S3 bucket with versioning and lifecycle
retention of at least 30 days. Lightsail snapshots are an additional recovery
aid, not the database backup mechanism.

Before release, take an on-demand pre-release backup. Deploy only the immutable
image digest built from the approved commit, run migrations once, then check
health, worker progress, and a read-only application smoke test. Roll back the
application image when schema compatibility allows; otherwise follow the tested
database and object restore runbook.

## Consequences

- Customer data and failures are isolated at installation level.
- Capacity upgrades and patching are repeated per installation but remain
  suitable for the initial customer count.
- Terraform provisions non-secret AWS resources; Ansible configures the host.
  Operators supply DNS, TLS, image digests, and secrets through controlled
  channels.
- Backup success is monitored daily. A restore rehearsal is mandatory before
  first launch, after material infrastructure changes, and on a regular
  operational schedule.
- Recovery objectives are measured during rehearsals and agreed contractually;
  this ADR does not invent an MVP SLA.

## Rejected alternatives

- Shared multi-customer platform: contradicts the approved deployment model.
- Multi-region orchestration: unnecessary for the MVP baseline.
- Lightsail snapshots alone: do not provide the required application-consistent
  database/object recovery workflow or 30-day logical retention policy.
