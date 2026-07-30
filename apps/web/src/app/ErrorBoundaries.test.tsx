import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ApplicationErrorBoundary, RouteErrorBoundary } from "./ErrorBoundaries";

function BrokenView(): ReactElement {
  throw new Error("Deliberate test failure");
}

describe("StockControl error boundaries", () => {
  it("contains an application startup error with a usable fallback", () => {
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ApplicationErrorBoundary>
        <BrokenView />
      </ApplicationErrorBoundary>,
    );

    expect(
      screen.getByRole("heading", { name: "StockControl could not start" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    errorOutput.mockRestore();
  });

  it("contains a route error and can retry the affected page", async () => {
    const errorOutput = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const user = userEvent.setup();
    let shouldFail = true;

    function RecoverableView(): ReactElement {
      if (shouldFail) {
        throw new Error("Deliberate route failure");
      }

      return <h1>Recovered page</h1>;
    }

    render(
      <MemoryRouter initialEntries={["/inventory"]}>
        <RouteErrorBoundary>
          <RecoverableView />
        </RouteErrorBoundary>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "This page could not be displayed" }),
    ).toBeInTheDocument();

    shouldFail = false;
    await user.click(screen.getByRole("button", { name: "Retry page" }));

    expect(screen.getByRole("heading", { name: "Recovered page" })).toBeInTheDocument();
    errorOutput.mockRestore();
  });
});
