import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "../api/ApiContext";
import { createFakeApiClient } from "../test/fake-api";
import { ReportIssueDialog } from "./ReportIssueDialog";

describe("ReportIssueDialog", () => {
  it("submits the form and links to the created GitHub issue", async () => {
    const user = userEvent.setup();
    const requests: Array<{
      readonly method: string;
      readonly path: string;
      readonly body: unknown;
    }> = [];
    const api = createFakeApiClient(
      { "/issues": { issueUrl: "https://github.com/example/repo/issues/42" } },
      (request) => requests.push(request),
    );

    render(
      <ApiProvider client={api}>
        <MemoryRouter>
          <ReportIssueDialog onClose={() => undefined} page="/inventory" />
        </MemoryRouter>
      </ApiProvider>,
    );

    await user.type(
      screen.getByRole("textbox", { name: /^Title/u }),
      "The inventory count is wrong",
    );
    await user.type(
      screen.getByRole("textbox", { name: /^What happened\?/u }),
      "The count is wrong after refreshing.",
    );
    await user.click(screen.getByRole("button", { name: "Submit issue" }));

    expect(await screen.findByRole("heading", { name: "Issue reported" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open GitHub issue" })).toHaveAttribute(
      "href",
      "https://github.com/example/repo/issues/42",
    );
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: "POST", path: "/issues" });
    expect(requests[0]?.body).toEqual({
      title: "The inventory count is wrong",
      description: "The count is wrong after refreshing.",
      page: "/inventory",
    });
  });
});
