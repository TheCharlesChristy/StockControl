import { describe, expect, it, vi } from "vitest";

import { ApplicationFailureException } from "@stockcontrol/platform";

import { IssuesService } from "../src/issues/issues.service";

const reporter = { displayName: "Olivia Desk", role: "Office" as const };

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
