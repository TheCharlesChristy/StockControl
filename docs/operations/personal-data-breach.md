# Personal data breach

An incident becomes a personal data breach the moment personal data is
destroyed, lost, altered, disclosed or accessed without authorisation —
accidentally or not. Losing it counts. So does sending it to the wrong person,
and so does a backup that turns out not to restore.

Handle the incident through [incident response](./incident-response.md). This
runbook is the notification clock that runs alongside it, because that clock
starts before the incident is over.

## The clock

**72 hours from awareness** to notify the ICO, where the breach is likely to
result in a risk to people's rights and freedoms.

"Awareness" is when you have a reasonable degree of certainty that a breach has
occurred. It is not when the investigation finishes. If you are 72 hours in and
still do not know the full extent, notify anyway with what you have and say
that information will follow — Article 33(4) expressly allows notifying in
phases. A late notification with a complete story is a worse outcome than a
prompt one with gaps.

Where people are at **high risk**, they must also be told, **without undue
delay** — which is a shorter deadline than 72 hours, not a longer one.

## What to do, in order

1. **Contain and record the time.** Note when you became aware, in UTC. That
   timestamp is the start of everything.
2. **Work out what data, whose, and how much.** Personal data is what makes
   this a breach; the volume and the sensitivity decide the rest.
3. **Assess the risk to those people.** The question is what could happen to
   _them_, not how embarrassing it is for the business. Consider identity
   fraud, financial loss, loss of confidentiality, reputational damage, and
   whether the data allows somebody to be found. A staff member's stock
   movement history is low risk; a leaked credential is not.
4. **Decide on notification** using the table below, and record the reasoning
   either way. A decision not to notify has to be defensible, which means it
   has to be written down.
5. **Notify the ICO** if required, at
   [ico.org.uk/for-organisations/report-a-breach](https://ico.org.uk/for-organisations/report-a-breach/),
   or by phone on 0303 123 1113. Where an EU supervisory authority is the lead,
   notify that one instead.
6. **Tell the people affected** if the risk is high. In plain language: what
   happened, what it means for them, what you are doing, and what they should
   do. Not a legal notice.
7. **Record it** — every breach, including the ones you did not notify.
   Article 33(5) requires the register regardless of the outcome.

## Whether to notify

|                   | ICO within 72h           | Tell the people          |
| ----------------- | ------------------------ | ------------------------ |
| No risk to people | No — but still record it | No                       |
| Some risk         | Yes                      | No                       |
| High risk         | Yes                      | Yes, without undue delay |

You need not tell the people if the data was encrypted and the key is safe, or
if you have since taken steps that mean the high risk will not materialise, or
if telling them individually is disproportionate — in which case make a public
communication instead. The ICO can require you to tell them anyway.

## What this system makes easier

- **Working out what a compromised account could reach.** Effective permission
  is the intersection of the role's capability and the grant, evaluated on the
  server for every request, so a role tells you the ceiling.
- **Working out what was actually done.** Stock movements, map edits and
  assistant tool calls are append-only, and the runtime role cannot delete
  them — so an attacker who reached the API could not erase the record of it.
- **Cutting access off.** Deactivating a user revokes their sessions;
  revoking an OAuth grant takes effect on the next call. Neither waits for a
  deploy.

## What makes it harder

- **Object storage is not in the database.** Photographs and floor plans live
  in the bucket. Scope them separately.
- **Backups outlive deletions.** A record deleted from the live database is
  still in any backup taken before it. Relevant to what a restored backup would
  reintroduce.
- **The issue tracker is public.** Anything a member of staff put into a report
  is already published. If the breach _is_ a report containing personal data,
  deleting the issue does not un-publish it — treat it as disclosed and assess
  on that basis.

## If you are the processor, not the controller

Where the vendor operates an installation for a customer, the vendor is the
processor. A processor does not notify the ICO. A processor must notify the
**controller** without undue delay, and then support them. Say what happened,
what data, and what you are doing — and do it fast, because their 72 hours
starts when you tell them.

## Afterwards

Add it to the register: what happened, the effects, and what was done. Then the
part that matters — what would have prevented it, and whether that is now
scheduled. A breach register with no corresponding changes in the repository is
a record of nothing being learned.
