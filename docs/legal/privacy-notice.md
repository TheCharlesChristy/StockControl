# Privacy notice

This is the source text for the notice at `/privacy` in the application
(`apps/web/src/pages/PrivacyNoticePage.tsx`). If you change one, change the
other — a notice that does not match what the software does is worse than none.

Written for staff, in the words they would use. Article 13 requires that a
notice be concise, transparent, intelligible and in clear and plain language;
that is a legal requirement, not a style preference.

Two placeholders are filled in per installation, from
`VITE_DATA_CONTROLLER_NAME` and `VITE_PRIVACY_CONTACT`. Until they are set,
the page says plainly that nobody has been named.

---

## How StockControl uses your information

StockControl keeps track of stock: what the business has, where it is, and who
moved it. Keeping that record means keeping some information about you. This
page explains what, why, and what you can do about it. It is written to be
read, not filed.

### Who is responsible

**{controller}** decides what StockControl records and why, and is answerable
for it under UK and EU data protection law. Questions, or any of the requests
below: **{contact}**.

### What is recorded about you

**Your account.** Your username, the name shown to your colleagues, your role,
and an email address if you gave one. Your password is stored scrambled in a
way that cannot be turned back into a password.

**Your photograph**, only if you or an Admin uploads one. You can remove it
from your profile at any time.

**When you sign in** — enough to keep you signed in and to stop somebody
guessing their way into your account.

**What you do with stock.** Every time stock is received, issued, moved,
adjusted, reserved or collected, StockControl records what moved, where, and
that it was you. This is the part of the record that matters most, and the part
you cannot switch off — it is how a business knows what it owns.

**Requests and jobs** — stock you asked for, decisions you made on someone
else's request, and the jobs you were assigned to.

**Changes you make to a map** — who moved a location, and what it looked like
beforehand.

**Photographs you take to identify stock**, if your installation has assisted
stock capture switched on. The photographs are deleted after the session; the
stock they produced stays.

**Anything you ask an assistant to do**, if your installation is connected to
ChatGPT. What you asked it to do is recorded here; what you typed into ChatGPT
is not.

### Why it is allowed

Most of this is recorded because the business has a legitimate interest in
knowing what happened to its own stock — who took what, and when — and because
it has to keep accurate accounting records. Your account details are recorded
because there is no way to give you access without them.

None of it rests on you agreeing to it, so withdrawing agreement is not
something you need to do. If you object to a particular use of it, say so and
it has to be considered on its merits.

StockControl is not used to score you, rank you, rate your productivity, or
make any decision about you automatically.

### How long it is kept

|                                     |                                                                                                                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock movements                     | Six years. They are the company's accounting records, and the law sets that period, not us.                                                                                                                                            |
| Assistant activity and map changes  | Twelve months, then deleted automatically.                                                                                                                                                                                             |
| Photographs taken to identify stock | Within thirty days at the latest, and usually as soon as the session finishes.                                                                                                                                                         |
| Sign-in sessions                    | Removed once they expire.                                                                                                                                                                                                              |
| Your account                        | Kept while you work here. When you leave it is switched off, which ends your access at once. The account itself stays for as long as the stock records that point at it, because removing it would break the record of who moved what. |

### Who else sees it

**Your colleagues.** Your name shows against stock you moved and requests you
raised. Admins can see your account and your activity.

**The company running the servers.** StockControl is hosted on Railway, which
stores the database and the photographs. They do not use any of it for their
own purposes.

**GitHub.** If you use Report an issue, what you write is published on a public
issue tracker that anyone can read. Your name is not attached — a reference
code is, so the team can come back to you. Do not put customer details in a
report.

**OpenAI**, only if your installation is connected to ChatGPT, and only what
you ask it. Nothing is sent there unless somebody connects an account
deliberately.

Some of these are outside the UK and the EU. Where that is the case, the
transfer relies on the safeguards those companies have in place for it.

### Cookies

StockControl sets one cookie, and only once you sign in. It is what keeps you
signed in, it holds nothing but a random value, and it is deleted when you sign
out. There is no tracking, no advertising and no analytics here, which is why
there is no banner asking you to accept anything.

### What you can ask for

**A copy of your information.** Download it yourself from your profile page,
whenever you like. You do not need to ask permission.

**A correction.** If your name or details are wrong, an Admin can fix them.
Stock movements cannot be rewritten — a mistake is corrected by a further
movement, so the record stays honest.

**Deletion.** Your account can be removed if it has no stock activity against
it. Where it has, the movements have to stay for the six years above, and the
account stays with them.

**To object, or to restrict how it is used.** Say so, and it has to be
considered. You will get a reason either way.

Requests are answered within one month. If you are not happy with the answer,
you can complain to the Information Commissioner's Office at
[ico.org.uk](https://ico.org.uk/make-a-complaint/), or to the data protection
authority where you live. You can go to them directly — you do not have to come
to us first.

### If something goes wrong

If information is lost or exposed, and it is likely to put anyone at risk, the
regulator is told within 72 hours and the people affected are told without
delay. If you think something has gone wrong, say so early — you will not be in
trouble for raising it.

---

_Last reviewed 23 August 2026._

## A note on the cookie position

Worth stating explicitly because it is the question people expect to be
answered with a banner.

PECR regulation 6 requires consent for storing or accessing information on a
user's device, **except** where it is strictly necessary to provide a service
the user has explicitly requested. A session cookie that exists solely to keep
somebody signed in is the textbook example of that exemption.

StockControl sets exactly one cookie, on sign-in, holding a random session
identifier. There is no analytics, no advertising, no embedded third-party
content, and no third-party font host — the fonts are served by the
application, which the Content Security Policy enforces rather than trusting.

So: **no consent banner is required, and adding one would be wrong.** A banner
asking permission for a strictly necessary cookie teaches people that the
question is meaningless. If a future change introduces any non-essential
storage, consent becomes required and this section stops being true.
