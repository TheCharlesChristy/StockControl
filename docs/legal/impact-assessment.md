# Data protection impact assessment

## Whether one is needed

Article 35 requires a DPIA where processing is likely to result in a high risk
to people's rights. The ICO's list of triggers includes the systematic
monitoring of employees and the use of innovative technology.

StockControl records every stock movement against the person who made it,
continuously, for as long as they are employed. That is systematic monitoring
of workers, regardless of the fact that its purpose is stock control rather
than supervision. Where assisted capture is enabled it also uses machine
learning on photographs taken in the workplace.

**A DPIA is required.** This is it. It is deliberately short: the processing is
narrow and the honest answer to most of it is "this is what an inventory
system does".

## What is processed

Set out in the [records of processing](./records-of-processing.md). The part
this assessment is about is activity 2 — the ledger — and activity 3, assisted
capture.

## Necessity and proportionality

The purpose is knowing what the business owns and what happened to it. Stock
goes missing, counts drift, and an engineer needs to know whether a part is in
the van or the store. None of that can be answered by a system that records
quantities without recording who moved them: a count that changed with nobody
attached is not a record, it is a rumour.

Alternatives considered:

- **Do not record the person.** Rejected. It removes the ability to resolve a
  discrepancy at all, and makes the ledger useless for the accounting purpose
  it also serves.
- **Record the person, but delete it sooner than the quantities.** Attractive,
  and not currently possible: the ledger is append-only and `stock_levels` is
  derived from it. Recorded in the [retention
  schedule](./retention-schedule.md#two-things-this-job-deliberately-does-not-delete)
  as the question to answer when the six-year boundary first falls due.
- **Aggregate rather than itemise.** Rejected. The accounting obligation is
  itemised.

What is deliberately **not** done, and should stay that way:

- No productivity metric, ranking, league table or scoring of any kind.
- No location tracking. A location is a place stock sits, not a place a person
  is.
- No timing of individuals, no idle detection, no keystroke or screen capture.
- No automated decision-making about a person, so Article 22 is not engaged.
- No prompts stored from the assistant — the record is what was done, not what
  was typed.

## The balancing test

The ledger runs on legitimate interests, so Article 6(1)(f) needs its three
parts answered.

**Is the interest legitimate?** Yes. Knowing what your own stock is doing is a
core business interest, and for the accounting portion it is close to a legal
obligation.

**Is the processing necessary for it?** Yes, as above. There is no less
intrusive way to attribute a movement than to record who made it.

**Is it overridden by the individual's interests?** No, on balance, for these
reasons:

- It is what a person would expect. Anybody who has worked a stockroom expects
  their name against what they signed out. There is no surprise here, which is
  the factor that most often decides these.
- It is narrow. It records an action taken at work on the employer's property,
  and nothing about the person beyond that.
- It is not used against them by design. There is no scoring and no automated
  decision, and this document is the place to notice if that ever changes.
- It is transparent. The [privacy notice](./privacy-notice.md) says plainly
  that this is recorded and that it cannot be switched off.
- They can see it. Anybody can download their whole record from their profile
  page, without asking anyone's permission.

**Conclusion:** legitimate interests is available and the balance favours
processing. The right to object under Article 21 still applies and must be
considered on its merits if exercised — see [responding to a
request](./data-subject-rights.md).

This test should be re-run if the product ever grows a feature that reports on
people rather than on stock. That is the change that would flip it.

## Risks and what is done about them

| Risk                                                   | Likelihood                                       | Impact                                                            | What reduces it                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The ledger is used to performance-manage staff         | Medium                                           | High — it would be processing for a purpose nobody was told about | No feature supports it. The notice says what it is for. A reporting feature about people would need this assessment redone               |
| Records kept indefinitely                              | Was **high** — nothing deleted anything          | Medium                                                            | A scheduled retention job now enforces the schedule, and the windows are documented and previewable                                      |
| Somebody who breaches the API erases the evidence      | Low                                              | High                                                              | The runtime role holds no delete on audit tables. Purging is a separate credential                                                       |
| A stockroom photograph catches a colleague             | Medium                                           | Low                                                               | Not taken for that and never searched for people. Deleted within 30 days. Treated as evidence, not a business record                     |
| Staff identity published to a public issue tracker     | Was **certain** — the name and role were sent    | Medium                                                            | Only an opaque digest is sent now. The dialog says the report is public before anything is typed                                         |
| Every page load discloses a user's IP to a third party | Was **certain** — fonts loaded from Google's CDN | Low                                                               | Fonts are served by the application. The CSP no longer permits an external font host                                                     |
| Free-text notes accumulate special category data       | Medium                                           | High                                                              | Cannot be prevented technically. Tell staff not to; it is in the notice and the report dialog                                            |
| A subject access request cannot be answered completely | Was medium                                       | Medium                                                            | The export is generated from a list checked against the live schema by an integration test, so a new table cannot quietly fall out of it |

The four "was" rows are the findings this assessment was written alongside.
They are recorded as they were, rather than tidied away, because a DPIA that
shows only the finished state is not evidence of anything.

## The EU AI Act

Assisted stock capture uses machine learning to suggest which catalogue item a
photograph shows. Where the integration is enabled, the business is a
**deployer** of an AI system.

**Classification: minimal risk.** It recognises objects on a shelf. It is not
listed in Annex III, it makes no decision about a person, it does not infer
emotion, and it performs no biometric identification — the similarity vectors
are of stock items, not of people. The prohibitions in Article 5 are not
engaged and the high-risk obligations in Chapter III do not apply.

Two things still do:

- **Article 4, AI literacy**, in force since 2 February 2025. Deployers must
  take measures to ensure staff using an AI system understand it well enough to
  use it sensibly. In practice: tell people the suggestions are guesses, that
  confidence is shown as a band rather than a number precisely so it is not
  read as certainty, and that they are expected to check before confirming.
  The [user guide](../user-guide/add-stock.md) is where that belongs.
- **Not misrepresenting it.** The product already refuses to show a fusion
  score as a probability to a person, which is the right instinct and worth
  keeping.

If the recogniser is ever pointed at people, or its output used to assess
anybody, this classification is void and the assessment must be redone before
that ships.

## Outcome

Processing may proceed. The residual risk after the measures above is low, and
no prior consultation with the ICO under Article 36 is required.

Review this document when: a feature reports on people rather than stock; the
recogniser's purpose changes; a new processor is added; or the six-year ledger
boundary first falls due. Otherwise, annually.

|             |                |
| ----------- | -------------- |
| Assessed    | _installation_ |
| Reviewed by | _installation_ |
| Next review | _installation_ |
