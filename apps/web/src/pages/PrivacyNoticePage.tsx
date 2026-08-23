import { Alert, Box, Divider, Link, Paper, Stack, Typography } from "@mui/material";
import type { ReactElement, ReactNode } from "react";

/** Unset and set-to-blank mean the same thing: nobody has said. */
const configured = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <Stack spacing={1.5} component="section">
      <Typography variant="h4" component="h2">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function Body({ children }: { children: ReactNode }): ReactElement {
  return (
    <Typography variant="body1" color="text.secondary">
      {children}
    </Typography>
  );
}

function Rows({ rows }: { rows: readonly (readonly [string, string])[] }): ReactElement {
  return (
    <Box component="dl" sx={{ m: 0, display: "grid", gap: 1.5 }}>
      {rows.map(([term, description]) => (
        <Box key={term}>
          <Typography component="dt" variant="subtitle2">
            {term}
          </Typography>
          <Typography component="dd" variant="body2" color="text.secondary" sx={{ m: 0 }}>
            {description}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * What StockControl records about the people who use it, in the words they
 * would use themselves.
 *
 * Reachable without signing in, deliberately. Somebody deciding whether to
 * take a job, or who has just been handed an account, should be able to read
 * this before they are inside — and a notice you can only see once you have
 * agreed to be recorded is not much of a notice.
 */
export function PrivacyNoticePage(): ReactElement {
  const controller = configured(import.meta.env.VITE_DATA_CONTROLLER_NAME);
  const contact = configured(import.meta.env.VITE_PRIVACY_CONTACT);
  const contactLine = contact ?? "Ask your manager, or whoever set up your StockControl account.";
  const controllerName =
    controller ?? "the business you work for, which runs this copy of StockControl";

  return (
    <Box sx={{ maxWidth: 820, mx: "auto", p: { xs: 2, sm: 3 } }}>
      <Paper sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Stack spacing={4}>
          <Stack spacing={1}>
            <Typography variant="h2" component="h1">
              How StockControl uses your information
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Last reviewed 23 August 2026
            </Typography>
          </Stack>

          <Body>
            StockControl keeps track of stock: what the business has, where it is, and who moved it.
            Keeping that record means keeping some information about you. This page explains what,
            why, and what you can do about it. It is written to be read, not filed.
          </Body>

          {(controller === undefined || contact === undefined) && (
            <Alert severity="info">
              This installation has not recorded who is answerable for the information it holds.
              Whoever set it up should fill that in — until then, ask your manager.
            </Alert>
          )}

          <Divider />

          <Section title="Who is responsible">
            <Body>
              {controllerName} decides what StockControl records and why, and is answerable for it
              under UK and EU data protection law. Questions, or any of the requests below:{" "}
              {contactLine}
            </Body>
          </Section>

          <Section title="What is recorded about you">
            <Rows
              rows={[
                [
                  "Your account",
                  "Your username, the name shown to your colleagues, your role, and an email address if you gave one. Your password is stored scrambled in a way that cannot be turned back into a password.",
                ],
                [
                  "Your photograph",
                  "Only if you or an Admin uploads one. You can remove it from your profile at any time.",
                ],
                [
                  "When you sign in",
                  "Enough to keep you signed in and to stop somebody guessing their way into your account.",
                ],
                [
                  "What you do with stock",
                  "Every time stock is received, issued, moved, adjusted, reserved or collected, StockControl records what moved, where, and that it was you. This is the part of the record that matters most, and the part you cannot switch off — it is how a business knows what it owns.",
                ],
                [
                  "Requests and jobs",
                  "Stock you asked for, decisions you made on someone else's request, and the jobs you were assigned to.",
                ],
                [
                  "Changes you make to a map",
                  "Who moved a location, and what it looked like beforehand.",
                ],
                [
                  "Photographs you take to identify stock",
                  "If your installation has assisted stock capture switched on. The photographs are deleted after the session; the stock they produced stays.",
                ],
                [
                  "Anything you ask an assistant to do",
                  "If your installation is connected to ChatGPT. What you asked it to do is recorded here; what you typed into ChatGPT is not.",
                ],
              ]}
            />
          </Section>

          <Section title="Why it is allowed">
            <Body>
              Most of this is recorded because the business has a legitimate interest in knowing
              what happened to its own stock — who took what, and when — and because it has to keep
              accurate accounting records. Your account details are recorded because there is no way
              to give you access without them. None of it rests on you agreeing to it, so
              withdrawing agreement is not something you need to do; if you object to a particular
              use of it, say so and it has to be considered on its merits.
            </Body>
            <Body>
              StockControl is not used to score you, rank you, rate your productivity, or make any
              decision about you automatically.
            </Body>
          </Section>

          <Section title="How long it is kept">
            <Rows
              rows={[
                [
                  "Stock movements",
                  "Six years. They are the company's accounting records, and the law sets that period, not us.",
                ],
                [
                  "Assistant activity and map changes",
                  "Twelve months, then deleted automatically.",
                ],
                [
                  "Photographs taken to identify stock",
                  "Deleted within thirty days at the latest, and usually as soon as the session finishes.",
                ],
                ["Sign-in sessions", "Removed once they expire."],
                [
                  "Your account",
                  "Kept while you work here. When you leave it is switched off, which ends your access at once. The account itself stays for as long as the stock records that point at it, because removing it would break the record of who moved what.",
                ],
              ]}
            />
          </Section>

          <Section title="Who else sees it">
            <Rows
              rows={[
                [
                  "Your colleagues",
                  "Your name shows against stock you moved and requests you raised. Admins can see your account and your activity.",
                ],
                [
                  "The company running the servers",
                  "StockControl is hosted on Railway, which stores the database and the photographs. They do not use any of it for their own purposes.",
                ],
                [
                  "GitHub",
                  "If you use Report an issue, what you write is published on a public issue tracker that anyone can read. Your name is not attached — a reference code is, so the team can come back to you. Do not put customer details in a report.",
                ],
                [
                  "OpenAI",
                  "Only if your installation is connected to ChatGPT, and only what you ask it. Nothing is sent there unless somebody connects an account deliberately.",
                ],
              ]}
            />
            <Body>
              Some of these are outside the UK and the EU. Where that is the case, the transfer
              relies on the safeguards those companies have in place for it.
            </Body>
          </Section>

          <Section title="Cookies">
            <Body>
              StockControl sets one cookie, and only once you sign in. It is what keeps you signed
              in, it holds nothing but a random value, and it is deleted when you sign out. There is
              no tracking, no advertising and no analytics here, which is why there is no banner
              asking you to accept anything.
            </Body>
          </Section>

          <Section title="What you can ask for">
            <Rows
              rows={[
                [
                  "A copy of your information",
                  "Download it yourself from your profile page, whenever you like. You do not need to ask permission.",
                ],
                [
                  "A correction",
                  "If your name or details are wrong, an Admin can fix them. Stock movements cannot be rewritten — a mistake is corrected by a further movement, so the record stays honest.",
                ],
                [
                  "Deletion",
                  "Your account can be removed if it has no stock activity against it. Where it has, the movements have to stay for the six years above, and the account stays with them.",
                ],
                [
                  "To object, or to restrict how it is used",
                  "Say so, and it has to be considered. You will get a reason either way.",
                ],
              ]}
            />
            <Body>
              Requests are answered within one month. If you are not happy with the answer, you can
              complain to the Information Commissioner&apos;s Office at{" "}
              <Link href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">
                ico.org.uk
              </Link>
              , or to the data protection authority where you live. You can go to them directly —
              you do not have to come to us first.
            </Body>
          </Section>

          <Section title="If something goes wrong">
            <Body>
              If information is lost or exposed, and it is likely to put anyone at risk, the
              regulator is told within 72 hours and the people affected are told without delay. If
              you think something has gone wrong, say so early — you will not be in trouble for
              raising it.
            </Body>
          </Section>
        </Stack>
      </Paper>
    </Box>
  );
}
