import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PageHelp } from "./PageHelp";

describe("PageHelp", () => {
  it("walks through role-aware page guidance", async () => {
    const user = userEvent.setup();

    render(
      <>
        <button data-help-target="inventory-search">Search</button>
        <button data-help-target="inventory-results">Results</button>
        <button data-help-target="inventory-actions">Actions</button>
        <PageHelp path="/inventory" role="Engineer" />
      </>,
    );

    await user.click(screen.getByRole("button", { name: "How to use this page" }));

    expect(screen.getByRole("dialog", { name: /Inventory/u })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Inventory Step 1 of 3/u })).toBeInTheDocument();
    expect(screen.getByText(/Search the catalogue/u)).toBeInTheDocument();
    expect(screen.getByText("Search inventory")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toHaveClass("page-help-highlight");

    await user.click(screen.getByRole("button", { name: "Focus this control" }));
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Expand a row to see locations/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Results" })).toHaveClass("page-help-highlight");
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Close page help" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Inventory/u })).not.toBeInTheDocument();
    });
  });

  it("shows the sign-in walkthrough without a role", async () => {
    const user = userEvent.setup();

    render(<PageHelp path="/sign-in" />);
    await user.click(screen.getByRole("button", { name: "How to use this page" }));

    expect(screen.getByRole("heading", { name: /Sign in/u })).toBeInTheDocument();
    expect(screen.getByText(/Select the Username field/u)).toBeInTheDocument();
  });
});
