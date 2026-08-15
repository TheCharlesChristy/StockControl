import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ApiProvider } from "../api/ApiContext";
import {
  dismissConsoleError,
  getConsoleErrorEntries,
  installConsoleErrorCapture,
} from "../hooks/use-console-error-notifications";
import { createFakeApiClient, type RecordedRequest } from "../test/fake-api";
import { ConsoleErrorNotifications } from "./ConsoleErrorNotifications";

installConsoleErrorCapture();

afterEach((): void => {
  /*
   * Unmount before touching the module-level store: dismissing an entry
   * while a subscribed component is still mounted updates it outside of
   * `act()`, and React's own warning about that is itself a console.error —
   * which this suite's install would otherwise capture right back.
   */
  cleanup();
  for (const entry of getConsoleErrorEntries()) {
    dismissConsoleError(entry.id);
  }
});

function renderNotifications(
  reportingEnabled: boolean,
  overrides: Readonly<Record<string, unknown>> = {},
  onRequest?: (request: RecordedRequest) => void,
): RenderResult {
  const api = createFakeApiClient(overrides, onRequest);
  return render(
    <ApiProvider client={api}>
      <MemoryRouter>
        <ConsoleErrorNotifications page="/inventory" reportingEnabled={reportingEnabled} />
      </MemoryRouter>
    </ApiProvider>,
  );
}

describe("ConsoleErrorNotifications", () => {
  it("renders nothing when no console errors have happened", () => {
    renderNotifications(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a card for a console error and removes it when dismissed", async () => {
    const user = userEvent.setup();
    console.error("The stock count could not be saved");

    renderNotifications(true);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The stock count could not be saved")).toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Dismiss error notification" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("collapses a repeated error into a single card showing a count", async () => {
    console.error("Duplicate failure message");
    console.error("Duplicate failure message");

    renderNotifications(true);

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(within(alerts[0]!).getByText("×2")).toBeInTheDocument();
  });

  it("hides the report bug action when issue reporting is disabled", async () => {
    console.error("Cannot reach the API");

    renderNotifications(false);

    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
  });

  it("opens the report dialog prefilled with the error summary and submits it through the normal issue-reporting endpoint", async () => {
    const user = userEvent.setup();
    const requests: RecordedRequest[] = [];
    console.error(new Error("Boom: could not load the dashboard"));

    renderNotifications(
      true,
      { "/issues": { issueUrl: "https://github.com/example/repo/issues/7" } },
      (request) => requests.push(request),
    );

    await user.click(await screen.findByRole("button", { name: "Report bug" }));

    const titleField = screen.getByRole("textbox", { name: /^Title/u });
    const descriptionField = screen.getByRole("textbox", { name: /^What happened\?/u });
    expect(titleField).toHaveValue("Console error: Boom: could not load the dashboard");
    expect((descriptionField as HTMLTextAreaElement).value).toContain(
      "Boom: could not load the dashboard",
    );

    await user.click(screen.getByRole("button", { name: "Submit issue" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: "POST", path: "/issues" });
    const body = requests[0]?.body as { title: string; description: string; page: string };
    expect(body.title).toBe("Console error: Boom: could not load the dashboard");
    expect(body.page).toBe("/inventory");
  });
});
