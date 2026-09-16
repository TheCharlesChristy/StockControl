# Data protection

StockControl records what a business owns, where it is, and who moved it. The
last of those is personal data about members of staff, and recording it
continuously is monitoring. That is lawful, and it is what an inventory system
is for — but it comes with obligations, and this folder is where they are
written down.

The law in scope is the UK GDPR and the Data Protection Act 2018, the EU GDPR
where an installation serves people in the EU, and PECR for the cookie
position. The documents here are drafted for a single-customer installation
run by a small business.

| Document                                            | What it is for                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------- |
| [Privacy notice](./privacy-notice.md)               | What staff are told, and the source text for the in-app page                |
| [Records of processing](./records-of-processing.md) | The Article 30 record, the transfer register, and the processors            |
| [Retention schedule](./retention-schedule.md)       | How long each kind of record is kept, and what enforces it                  |
| [Impact assessment](./impact-assessment.md)         | The Article 35 DPIA, the monitoring balancing test, and the AI Act position |
| [Responding to a request](./data-subject-rights.md) | What to do when somebody asks for their data, or objects                    |
| [Accessibility](./accessibility-statement.md)       | The accessibility position and what is known to be imperfect                |

A personal data breach is an incident first. It is handled through
[incident response](../operations/incident-response.md), which hands off to
[the personal data breach procedure](../operations/personal-data-breach.md)
for the notification clock.

## Who has to do what

These documents describe obligations that fall on **the business running the
installation**, not on this repository. The software makes them possible;
somebody still has to do them.

Before an installation goes live:

- [ ] Name the controller and a contact in the deployment's
      `VITE_DATA_CONTROLLER_NAME` and `VITE_PRIVACY_CONTACT`. Until this is
      done the in-app notice says plainly that nobody has been named, which is
      honest but is not a notice.
- [ ] Read the [privacy notice](./privacy-notice.md), change what is not true
      of this business, and give it to every member of staff who gets an
      account — before they get it, not after.
- [ ] Fill in the installation-specific rows of the
      [records of processing](./records-of-processing.md): the controller's
      details, the hosting region, and whether the ChatGPT integration and
      assisted capture are switched on.
- [ ] Work through the [impact assessment](./impact-assessment.md) and record
      the decision. It is short, and it is the document a regulator asks for
      first when the subject is staff monitoring.
- [ ] Schedule `pnpm db:retain:prod`. Nothing else enforces the retention
      schedule, and a policy nothing enforces is not a policy.
- [ ] Confirm the Railway region and the backup retention match what the
      [transfer register](./records-of-processing.md#international-transfers)
      says they are.

## What the software does on its own

Worth knowing, because it changes what the business has to do by hand:

- **A person can get their own data without asking.** The profile page
  produces a complete copy of everything held about them, on demand. Most
  subject access requests never need to reach a human.
- **Retention is enforced by a job**, not by good intentions —
  `pnpm db:retain`, run under the migrator credential so that the API cannot
  erase its own audit trail. `--dry-run` shows what a change would destroy
  before it destroys it.
- **There is no consent banner, and none is needed.** One strictly necessary
  session cookie, no analytics, no advertising, no third-party fonts or
  scripts. The [privacy notice](./privacy-notice.md#cookies) says so.
- **Issue reports carry no name.** The reporter appears on the public tracker
  as a digest; the mapping stays in the installation's own logs.
- **Nothing about a person is decided automatically.** No scoring, no ranking,
  no productivity measurement. This matters for Article 22 and it is worth
  keeping true.
