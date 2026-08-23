# Records of processing

Article 30 requires a written record of what is processed and why. The
small-organisation exemption in Article 30(5) does **not** apply here: it is
lifted where processing is not occasional, and where it includes regular and
systematic monitoring. Recording every stock movement against the person who
made it is both.

Rows marked _installation_ have to be filled in per deployment. The rest are
true of the software wherever it runs.

## Controller

| Field                      | Value                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Controller                 | _installation_ — the business running it                                                                                             |
| Contact for data questions | _installation_ — also set as `VITE_PRIVACY_CONTACT`                                                                                  |
| Data protection officer    | Not required. A small business doing this is unlikely to meet the Article 37 threshold; record the decision rather than assuming it. |
| Representative in the EU   | _installation_ — required by Article 27 only if the business is outside the EU and serves people in it                               |

The software vendor is not a controller. Where the vendor operates an
installation on the customer's behalf, they are a processor and need an
Article 28 contract.

## Processing activities

### 1. Running staff accounts

|                 |                                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Why**         | To give people access, and to know who is who                                                                         |
| **People**      | Employees and contractors with accounts                                                                               |
| **Data**        | Username, display name, role, optional email address, password hash, profile photograph if uploaded, sign-in sessions |
| **Basis**       | Article 6(1)(b) — necessary to perform the contract of employment; Article 6(1)(f) for keeping the account secure     |
| **Kept**        | While employed; see [retention](./retention-schedule.md)                                                              |
| **Shared with** | Nobody outside the business                                                                                           |

### 2. Recording stock movements

The central one, and the one that is monitoring.

|                 |                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why**         | To know what the business owns, where it is, and what happened to it                                                                         |
| **People**      | Anybody who moves stock                                                                                                                      |
| **Data**        | Every receipt, issue, transfer, adjustment, reservation, collection and release, with the item, quantity, location, job, time and the person |
| **Basis**       | Article 6(1)(f) — legitimate interests. Balanced in the [impact assessment](./impact-assessment.md#the-balancing-test)                       |
| **Kept**        | 6 years — accounting record                                                                                                                  |
| **Shared with** | Colleagues, within the application                                                                                                           |

Also covered: stock requests raised and decided, job assignments, reservations,
and edits to location maps. Same basis, same reasoning, shorter retention.

### 3. Assisted stock capture — _only where `STOCK_CAPTURE_ENABLED=true`_

|            |                                                                                                                                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why**    | To identify stock from a photograph instead of typing it in                                                                                                                                                                                                    |
| **People** | Whoever takes the photograph, and anybody incidentally in shot                                                                                                                                                                                                 |
| **Data**   | Photographs of a stockroom, derived similarity vectors, what the recogniser proposed, and whether the person accepted it                                                                                                                                       |
| **Basis**  | Article 6(1)(f) — legitimate interests in an accurate, quickly captured inventory                                                                                                                                                                              |
| **Kept**   | Photographs ≤ 30 days; session records 90 days                                                                                                                                                                                                                 |
| **Note**   | A photograph taken in a working stockroom can catch a colleague in the background. It is not taken for that, is not searched for people, and is deleted quickly — which is why the retention job treats these rows as evidence rather than as business records |

### 4. The ChatGPT assistant — _only where `MCP_ENABLED=true`_

|                 |                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Why**         | To let a person ask operational questions and issue confirmed commands                                           |
| **People**      | The member of staff who connects an account                                                                      |
| **Data**        | Which tool was called, the validated arguments, what it produced, and who asked. Deliberately **not** the prompt |
| **Basis**       | Article 6(1)(f) — legitimate interests in an auditable record of assistant-mediated activity                     |
| **Kept**        | 12 months                                                                                                        |
| **Shared with** | OpenAI — see below                                                                                               |

### 5. Issue reports

|           |                                                                                                                                                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why**   | To let staff report faults                                                                                                                                                  |
| **Data**  | What the reporter writes, the page, and a digest standing in for their identity                                                                                             |
| **Basis** | Article 6(1)(f) — legitimate interests in fixing the software                                                                                                               |
| **Note**  | Published to a world-readable tracker. The reporter's name and role are not sent. The dialog says so before they write anything, and asks them to keep customer details out |

## Categories of personal data

No special category data under Article 9 is processed, and none should be. No
criminal offence data under Article 10. No children's data. If a customer starts
recording, say, a health reason in a stock request note, that changes and the
assessment has to be redone — free-text fields are where this goes wrong.

Note that `jobs.customer` frequently holds the name and implied address of a
domestic customer, which is personal data about somebody who is not a member of
staff. It is held under Article 6(1)(b) as part of performing that customer's
job, and it falls under the same six-year accounting retention.

## Processors

| Processor          | What they do                                               | Where                               | Contract                                  |
| ------------------ | ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------- |
| Railway            | Hosts the application, the database and the object storage | _installation_ — confirm the region | Railway's DPA                             |
| GitHub (Microsoft) | Receives issue reports; hosts the source                   | US                                  | GitHub's DPA                              |
| OpenAI             | Receives assistant requests, where the integration is on   | US                                  | OpenAI's DPA and the customer's own terms |

Nobody else. There is no analytics provider, no error-reporting service, no
advertising network, no CDN, and no third-party font host — the fonts are
served by the application itself, which is enforced by the Content Security
Policy rather than by remembering.

## International transfers

Railway, GitHub and OpenAI are US companies. Transfers to them rely on the
UK IDTA or the UK Addendum to the EU Standard Contractual Clauses, as
incorporated in each of their data processing agreements, together with the EU
and UK adequacy decisions for the US Data Privacy Framework where the provider
is certified under it.

Two practical points that matter more than the paperwork:

- **Pick the region deliberately.** Railway offers EU regions. An installation
  serving UK or EU staff should use one, which turns the largest transfer into
  no transfer at all. Record the chosen region here.
- **The issue tracker is not a transfer problem, it is a publication
  problem.** Content posted there is public worldwide. That is why the
  reporter's identity is not sent, and why the dialog warns about customer
  details.

## Security

Summarised in [`SECURITY.md`](../../SECURITY.md), which is the maintained
version. The Article 32 relevant points: authentication default-closed,
authorisation on the server through a single gate, scrypt password hashing,
random session tokens stored as digests in `__Host-` cookies, per-account and
per-source sign-in throttling, a least-privilege runtime database role that
cannot change the schema or erase the audit trail, TLS enforced, uploads
validated by magic bytes and stored privately, and error messages never
serialised into logs or responses.
