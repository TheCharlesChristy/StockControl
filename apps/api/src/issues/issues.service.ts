import type { ReportIssueResponse } from "@stockcontrol/contracts";
import { resourceUnavailable, validationFailed } from "@stockcontrol/contracts";
import { ApplicationFailureException } from "@stockcontrol/platform";

import type { CurrentUser } from "../auth/session-service";

const DEFAULT_REPOSITORY = "TheCharlesChristy/StockControl";
const GITHUB_API_ORIGIN = "https://api.github.com";
const MAXIMUM_TITLE_CHARACTERS = 120;
const MAXIMUM_DESCRIPTION_CHARACTERS = 10_000;
const MAXIMUM_PAGE_CHARACTERS = 300;

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface GitHubConfiguration {
  readonly repository: string;
  readonly token: string;
}

interface GitHubIssueResponse {
  readonly html_url?: unknown;
}

export interface CreateIssueInput {
  readonly title: string;
  readonly description: string;
  readonly page: string;
  readonly reporter: Pick<CurrentUser, "id" | "displayName" | "role">;
}

const REPORTS_PER_WINDOW = 5;
const REPORT_WINDOW_MILLISECONDS = 60 * 60 * 1_000;
const MAX_TRACKED_REPORTERS = 1_000;

/**
 * A bounded per-reporter throttle. This endpoint spends the installation's
 * GitHub credential and writes to a repository the whole world can read, so an
 * account that is merely signed in must not be able to file without limit —
 * whether that is somebody leaning on the button or somebody who has taken a
 * session. The key is the user id from the session, which the caller cannot
 * choose.
 */
class ReportThrottle {
  private readonly windows = new Map<string, { count: number; readonly expiresAt: number }>();

  public constructor(private readonly now: () => number = Date.now) {}

  public allow(userId: string): boolean {
    const now = this.now();

    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) {
        this.windows.delete(key);
      }
    }

    const current = this.windows.get(userId);

    if (current === undefined) {
      if (this.windows.size >= MAX_TRACKED_REPORTERS) {
        const oldest = this.windows.keys().next().value;
        if (oldest !== undefined) this.windows.delete(oldest);
      }

      this.windows.set(userId, { count: 1, expiresAt: now + REPORT_WINDOW_MILLISECONDS });
      return true;
    }

    if (current.count >= REPORTS_PER_WINDOW) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

function configurationFrom(environment: NodeJS.ProcessEnv): GitHubConfiguration | undefined {
  const token = environment.GITHUB_TOKEN?.trim();
  const repository = environment.GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;

  if (token === undefined || token.length === 0 || !/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
    return undefined;
  }

  return { repository, token };
}

function issueUrlFrom(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.origin === "https://github.com" && url.pathname.includes("/issues/")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wraps reporter-supplied text in a fence long enough that the text cannot end
 * it. Everything here is written by whoever is signed in and read by a
 * maintainer in GitHub's issue view, where bare Markdown would let a reporter
 * forge headings, embed images that phone home on open, or plant a link that
 * does not say where it goes.
 */
function fencedBlock(value: string): string {
  const longestRun = [...value.matchAll(/`+/gu)].reduce(
    (longest, [run]) => Math.max(longest, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));

  return `${fence}text\n${value}\n${fence}`;
}

function reporterLabel(reporter: CreateIssueInput["reporter"]): string {
  return `${reporter.displayName} (${reporter.role})`;
}

function externalServiceFailure(detail: string): ApplicationFailureException {
  return new ApplicationFailureException(
    resourceUnavailable({ code: "issues.github_unavailable", detail }),
  );
}

export class IssuesService {
  public constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
    private readonly throttle: ReportThrottle = new ReportThrottle(),
  ) {}

  public isConfigured(): boolean {
    return configurationFrom(this.environment) !== undefined;
  }

  public async create(input: CreateIssueInput): Promise<ReportIssueResponse> {
    const title = input.title.trim();
    const description = input.description.trim();
    const page = input.page.trim();
    const errors: Record<string, readonly string[]> = {};

    if (title.length === 0) {
      errors["title"] = ["Enter a title."];
    } else if (title.length > MAXIMUM_TITLE_CHARACTERS) {
      errors["title"] = [`Use ${String(MAXIMUM_TITLE_CHARACTERS)} characters or fewer.`];
    }

    if (description.length === 0) {
      errors["description"] = ["Enter a description."];
    } else if (description.length > MAXIMUM_DESCRIPTION_CHARACTERS) {
      errors["description"] = [
        `Use ${String(MAXIMUM_DESCRIPTION_CHARACTERS)} characters or fewer.`,
      ];
    }

    if (page.length > MAXIMUM_PAGE_CHARACTERS) {
      errors["page"] = [`Use ${String(MAXIMUM_PAGE_CHARACTERS)} characters or fewer.`];
    }

    if (Object.keys(errors).length > 0) {
      throw new ApplicationFailureException(validationFailed(errors));
    }

    const configuration = configurationFrom(this.environment);

    if (configuration === undefined) {
      throw externalServiceFailure(
        "Issue reporting is not configured. Contact an administrator to enable it.",
      );
    }

    /*
     * Checked after validation so a malformed attempt does not consume the
     * reporter's allowance, and before the request so a throttled one never
     * reaches GitHub.
     */
    if (!this.throttle.allow(input.reporter.id)) {
      throw new ApplicationFailureException(
        validationFailed({
          description: [
            `You can report up to ${String(REPORTS_PER_WINDOW)} issues an hour. Add detail to an existing report instead.`,
          ],
        }),
      );
    }

    const [owner, repository] = configuration.repository.split("/");
    const endpoint = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repository!)}/issues`;
    const body = [
      "## Description",
      "",
      fencedBlock(description),
      "",
      "## Context",
      "",
      fencedBlock(`Page:        ${page || "/"}\nReported by: ${reporterLabel(input.reporter)}`),
      "",
      "_Submitted from StockControl._",
    ].join("\n");

    let response: Response;
    try {
      response = await this.fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${configuration.token}`,
          "Content-Type": "application/json",
          "User-Agent": "StockControl",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ title, body }),
      });
    } catch {
      throw externalServiceFailure("GitHub could not be reached. Try again in a moment.");
    }

    if (!response.ok) {
      throw externalServiceFailure("GitHub could not accept the issue. Try again in a moment.");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw externalServiceFailure("GitHub returned an invalid response. Try again in a moment.");
    }

    const issueUrl = issueUrlFrom(
      typeof payload === "object" && payload !== null && "html_url" in payload
        ? (payload as GitHubIssueResponse).html_url
        : undefined,
    );

    if (issueUrl === undefined) {
      throw externalServiceFailure("GitHub returned an invalid issue link. Try again in a moment.");
    }

    return { issueUrl };
  }
}
