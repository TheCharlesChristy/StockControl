# Responding to a request

Somebody has asked for their data, or objected to something. This is what to
do.

**One month**, from the day you receive it. Extendable by two further months
for a genuinely complex request, but you must tell the person inside the first
month that you are extending, and why. There is no fee.

A request does not have to say "subject access request", does not have to be in
writing, and does not have to come to a particular person. A verbal request to
a supervisor starts the clock. Make sure whoever handles the post and the phone
knows to pass one on the same day.

## First: can they just do it themselves?

For a request to see their data, usually yes. Anybody with an account can
download everything held about them from **Profile → Your information →
Download my information**. It is complete, it is generated fresh, and it needs
nobody's permission.

Point them at it. If they want it anyway, or they have left and their account
is deactivated, an Admin can produce the same file from the person's page.

## By right

### Access — Article 15

The export covers it. Alongside the data itself, Article 15 also entitles them
to the purposes, the categories, the recipients, the retention periods and
their other rights — all of which are in the [privacy
notice](./privacy-notice.md). Send both.

Two things the export handles for you, worth knowing when you are checking it:

- The password hash is not in it. A hash is not information about the person
  and cannot be reversed into their password.
- Third parties appear as identifiers rather than names — the person who
  assigned them a job, for instance. Article 15(4) says a copy must not
  adversely affect others' rights. If the person specifically asks who that
  was, and telling them is reasonable in the circumstances, you can tell them;
  that is a judgement, so record it.

### Rectification — Article 16

An Admin can correct a name, username, email address or role from the person's
page.

**Stock movements cannot be edited, and this is not a limitation to apologise
for.** A ledger that can be rewritten is not a ledger. A wrong movement is
corrected by making a further movement, which is how stock control has always
worked. Explain it that way: the record of the mistake stays, and so does the
record of the correction, and the current count is right.

### Erasure — Article 17

Rarely available here, and the reasons are good ones.

- **An account with no stock activity** can be deleted outright. The
  application does this.
- **An account with activity** cannot. The database refuses it, deliberately —
  every table recording what a person did references the user row with
  `on delete restrict`. Deactivate instead, which ends their access
  immediately.
- **Stock movements** are retained under Article 17(3)(b) — processing
  necessary for compliance with a legal obligation, here the six-year
  accounting requirement. This is a lawful refusal, not a technical excuse.

Tell them which of these applies, and tell them they can complain to the ICO
about the answer.

### Portability — Article 20

The export is JSON, which is structured, commonly used and machine-readable.
Note that portability only covers data provided by the person and processed on
consent or contract — most of the ledger is legitimate interests and so is
outside it. Sending the whole export anyway is simpler and harms nobody.

### Objection — Article 21

The one that needs actual thought. Legitimate interests processing can be
objected to, and you must stop unless you can show compelling legitimate
grounds that override their interests.

For the stock ledger you almost certainly can — the [balancing
test](./impact-assessment.md#the-balancing-test) is already written, and the
six-year accounting obligation runs underneath it independently. But you have
to actually consider their specific circumstances rather than sending the
standard answer, and you have to record that you did.

If somebody objects, take it seriously enough to ask why. An objection to
being recorded at all is different from an objection to something specific
that has been done with the record, and the second one may be telling you
about a problem worth fixing.

### Restriction — Article 18

Available while an objection or an accuracy dispute is being resolved. There
is no restriction flag in the product; in practice, deactivating the account
and leaving the data alone achieves it. Do not delete anything while a
restriction is in force.

## Checking who you are talking to

Verify identity where you have genuine doubt, but do not use verification as
delay — the clock only pauses if you have asked for something you actually
need. For a current member of staff signed into their own account, you already
know who they are.

A request from a third party — a solicitor, a family member, a former
employee's representative — needs written authority from the person before you
send anything.

## Refusing

You can refuse a manifestly unfounded or excessive request, and repetitive
requests may be excessive. This is a narrow exemption and is not a way out of
an awkward one. If you refuse, you must tell them why, tell them they can
complain to the ICO, and tell them they can seek a judicial remedy — inside
the same month.

## Keep a record

For each request: what was asked, when it arrived, who dealt with it, what was
sent, what was withheld and on what ground, and the date of the reply. This is
the evidence that the process works, and it is what a regulator asks for.

If you get an objection or a refusal decision wrong, the person can complain to
the ICO at [ico.org.uk](https://ico.org.uk/make-a-complaint/). They can go
straight there without coming to you first, and the notice tells them so.
