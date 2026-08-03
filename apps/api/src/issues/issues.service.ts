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
  readonly reporter: Pick<CurrentUser, "displayName" | "role">;
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

function externalServiceFailure(detail: string): ApplicationFailureException {
  return new ApplicationFailureException(
    resourceUnavailable({ code: "issues.github_unavailable", detail }),
  );
}

export class IssuesService {
  public constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
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

    const [owner, repository] = configuration.repository.split("/");
    const endpoint = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repository!)}/issues`;
    const body = [
      "## Description",
      description,
      "",
      "## Context",
      `- Page: \`${page || "/"}\``,
      `- Reported by: ${input.reporter.displayName} (${input.reporter.role})`,
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
