# Incident response

## Priorities

Protect people and customer data, stop further damage, preserve evidence,
restore dependable service, and communicate accurately. Never erase or rewrite
stock or audit history to hide an incident symptom.

## Triage

1. Record UTC discovery time, reporter, customer installation, symptoms,
   affected workflows/data, current release, and correlation IDs.
2. Classify severity and assign an incident lead, technical operator,
   communications owner, and scribe. One person may fill several roles for a
   small event, but actions remain attributable.
3. Validate the alert from an independent signal. Use read-only investigation
   first.
4. Preserve application, proxy, worker, host, authentication, AWS, database,
   outbox/job, and deployment logs. Record their source and checksum.
5. Determine whether this is availability, integrity, confidentiality, or a
   combination, and whether another customer installation could be affected.

## Contain

Choose the least destructive effective containment:

- revoke affected sessions, invitations, reset links, access keys, or operator
  access;
- stop a worker or isolate a failing endpoint while preserving database state;
- block malicious network sources or remove public routing;
- make a suspected document credential unusable and verify buckets remain
  private;
- stop writes and take an incident snapshot/backup if integrity is uncertain.

Do not delete containers, logs, database rows, object versions, or compromised
hosts before evidence and recovery needs are assessed. Do not rotate a key
without identifying every dependent service and a safe replacement route.

## Eradicate and recover

1. Identify the cause and affected time/data boundary.
2. Fix through a reviewed commit or infrastructure change; do not patch
   production by hand.
3. Rotate exposed credentials and revoke derived sessions.
4. For corrupted state, select a verified recovery point and use the restore
   runbook. Preserve later ledger/audit evidence for controlled reconciliation.
5. Deploy only an approved immutable image and complete release verification.
6. Monitor an explicit observation window before declaring recovery.

## Communication and obligations

The communications owner follows the customer contract and applicable legal
process for notification, jurisdiction, personal data, evidence, and timing.
State confirmed facts, impact, mitigations, and next update time; distinguish
inference from evidence. Never put secrets or unnecessary personal data in chat
or tickets.

## Close and learn

Document timeline, root and contributing causes, affected data/workflows,
detection and recovery times, evidence, customer communication, and remaining
risk. Assign dated actions for code, tests, monitoring, runbooks, access, and
architecture. A blameless review does not remove accountability for approving
and verifying corrective work. Update requirements traceability or add an ADR
when the corrective action changes an approved baseline.
