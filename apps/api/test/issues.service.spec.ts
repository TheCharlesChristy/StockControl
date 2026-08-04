import { describe, expect, it, vi } from "vitest";

import { ApplicationFailureException } from "@stockcontrol/platform";

import { IssuesService } from "../src/issues/issues.service";

const reporter = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Olivia Desk",
  role: "Office" as const,
};

const acceptingGitHub = (): ReturnType<typeof vi.fn> =>
  vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ html_url: "https://github.com/example/repo/issues/42" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    ),
  );

const configuredService = (fetchImplementation: ReturnType<typeof vi.fn>): IssuesService =>
  new IssuesService(
    { GITHUB_TOKEN: "github-token", GITHUB_REPOSITORY: "example/repo" },
    fetchImplementation as never,
  );

describe("IssuesService", () => {
  it("reports whether issue submission has been configured", () => {
    expect(new IssuesService({}).isConfigured()).toBe(false);
    expect(
      new IssuesService({
        GITHUB_REPOSITORY: "example/repo",
        GITHUB_TOKEN: "token",
      }).isConfigured(),
    ).toBe(true);
  });

  it("creates a GitHub issue with the report context", async () => {
    const fetchImplementation = vi.fn(
      (input: string | URL, init?: RequestInit): Promise<Response> => {
        void input;
        void init;
        return Promise.resolve(
          new Response(JSON.stringify({ html_url: "https://github.com/example/repo/issues/42" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    );
    const service = new IssuesService(
      { GITHUB_TOKEN: "github-token", GITHUB_REPOSITORY: "example/repo" },
      fetchImplementation,
    );

    await expect(
      service.create({
        title: "The inventory count is wrong",
        description: "The count changed after refreshing the page.",
        page: "/inventory",
        reporter,
      }),
    ).resolves.toEqual({ issueUrl: "https://github.com/example/repo/issues/42" });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.github.com/repos/example/repo/issues",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer github-token" }),
        body: expect.any(String),
      }),
    );
    const requestBody = JSON.parse(
      (fetchImplementation.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}",
    ) as { readonly title?: string; readonly body?: string };
    expect(requestBody.title).toBe("The inventory count is wrong");
    expect(requestBody.body).toContain("/inventory");
    expect(requestBody.body).toContain("Olivia Desk (Office)");
  });

  /*
   * Everything in the body is written by whoever is signed in and read by a
   * maintainer in GitHub's issue view. Bare Markdown would let a reporter forge
   * headings, embed a remote image, or plant a link that hides its destination.
   */
  describe("reporter-supplied text", () => {
    const bodySentTo = (fetchImplementation: ReturnType<typeof vi.fn>): string =>
      (
        JSON.parse(
          (fetchImplementation.mock.calls[0]?.[1]?.body as string | undefined) ?? "{}",
        ) as { readonly body?: string }
      ).body ?? "";

    /** What GitHub renders as Markdown: everything not inside a fenced block. */
    const outsideFences = (body: string): string =>
      body.replaceAll(/^(`{3,})text\n[\s\S]*?\n\1$/gmu, "");

    it("is fenced rather than interpolated as Markdown", async () => {
      const fetchImplementation = acceptingGitHub();

      await configuredService(fetchImplementation).create({
        title: "Formatting",
        description: "## Not a real heading\n[click me](https://example.invalid/phish)",
        page: "/inventory",
        reporter,
      });

      const body = bodySentTo(fetchImplementation);
      expect(body).toContain("```text");
      expect(body).toContain("## Not a real heading");

      const rendered = outsideFences(body);
      expect(rendered).not.toContain("Not a real heading");
      expect(rendered).not.toContain("example.invalid");
      /* The only headings left are the two this service writes itself. */
      expect(rendered.match(/^## /gmu)).toEqual(["## ", "## "]);
    });

    it("cannot close the fence by including backticks of its own", async () => {
      const fetchImplementation = acceptingGitHub();

      await configuredService(fetchImplementation).create({
        title: "Escaping",
        description: "```\n## escaped out\n```",
        page: "/inventory",
        reporter,
      });

      const body = bodySentTo(fetchImplementation);
      expect(body).toContain("````text");

      const rendered = outsideFences(body);
      expect(rendered).not.toContain("escaped out");
      expect(rendered.match(/^## /gmu)).toEqual(["## ", "## "]);
    });
  });

  /*
   * This endpoint spends the installation's GitHub credential and writes to a
   * repository anyone can read, and it is open to every signed-in role.
   */
  it("stops one reporter filing without limit", async () => {
    const fetchImplementation = acceptingGitHub();
    const service = configuredService(fetchImplementation);
    const report = {
      title: "A problem",
      description: "Something needs attention.",
      page: "/dashboard",
      reporter,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.create(report)).resolves.toMatchObject({
        issueUrl: "https://github.com/example/repo/issues/42",
      });
    }

    await expect(service.create(report)).rejects.toMatchObject({
      failure: { code: "request.validation_failed" },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("throttles each reporter separately", async () => {
    const fetchImplementation = acceptingGitHub();
    const service = configuredService(fetchImplementation);
    const report = {
      title: "A problem",
      description: "Something needs attention.",
      page: "/dashboard",
      reporter,
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.create(report);
    }

    await expect(
      service.create({
        ...report,
        reporter: { ...reporter, id: "22222222-2222-4222-8222-222222222222" },
      }),
    ).resolves.toMatchObject({ issueUrl: "https://github.com/example/repo/issues/42" });
  });

  it("does not spend the allowance on a report that failed validation", async () => {
    const fetchImplementation = acceptingGitHub();
    const service = configuredService(fetchImplementation);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(
        service.create({ title: "", description: "", page: "/dashboard", reporter }),
      ).rejects.toBeInstanceOf(ApplicationFailureException);
    }

    await expect(
      service.create({
        title: "A real problem",
        description: "Something needs attention.",
        page: "/dashboard",
        reporter,
      }),
    ).resolves.toMatchObject({ issueUrl: "https://github.com/example/repo/issues/42" });
  });

  it("returns field validation errors before contacting GitHub", async () => {
    const fetchImplementation = vi.fn();
    const service = new IssuesService(
      { GITHUB_TOKEN: "github-token", GITHUB_REPOSITORY: "example/repo" },
      fetchImplementation,
    );

    const result = service.create({
      title: "",
      description: "",
      page: "/dashboard",
      reporter,
    });

    await expect(result).rejects.toBeInstanceOf(ApplicationFailureException);
    await expect(result).rejects.toMatchObject({
      failure: {
        code: "request.validation_failed",
        errors: {
          title: ["Enter a title."],
          description: ["Enter a description."],
        },
      },
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reports a safe configuration error when no GitHub token is available", async () => {
    const service = new IssuesService({}, vi.fn());

    await expect(
      service.create({
        title: "A problem",
        description: "Something needs attention.",
        page: "/dashboard",
        reporter,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "issues.github_unavailable",
        detail: "Issue reporting is not configured. Contact an administrator to enable it.",
      },
    });
  });
});
