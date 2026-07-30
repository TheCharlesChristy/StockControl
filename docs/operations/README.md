# Operations handbook

These runbooks govern each dedicated customer installation.

| Runbook                                           | Use                                                       |
| ------------------------------------------------- | --------------------------------------------------------- |
| [Railway deployment](./railway-deployment.md)     | Plan and operate a Railway customer installation          |
| [Release](./release.md)                           | Promote an approved release commit                        |
| [Database credentials](./database-credentials.md) | Rotate existing PostgreSQL credentials safely             |
| [Backup and restore](./backup-and-restore.md)     | Verify backups and rehearse or perform recovery           |
| [Monitoring](./monitoring.md)                     | Operate health checks, alerts, and routine maintenance    |
| [Incident response](./incident-response.md)       | Contain, recover, and learn from an incident              |
| [Legacy Lightsail deployment](./deployment.md)    | Historical AWS/Lightsail procedure retained for reference |

Runbooks use UTC for evidence and timelines. Every customer installation has an
owner, Railway workspace/project, domain, data jurisdiction, support contacts,
and encrypted secret-store reference in the vendor's operational register, not
in this repository.

Commands are examples for a trained operator. Confirm the target account,
customer, environment, host, and backup path before any state-changing command.
Production access and recovery actions require an approved change or incident
record.
