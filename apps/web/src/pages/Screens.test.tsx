import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthenticatedSession, UserRole } from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "../api/ApiClient";
import { StockControlProviders } from "../app/App";
import type { AuthClient, SignInCredentials } from "../auth/auth-types";
import { createFakeApiClient, engineerDashboard, testItemDetail, testJob } from "../test/fake-api";
import { DashboardPage } from "./DashboardPage";
import { InventoryPage } from "./InventoryPage";
import { ItemDetailPage } from "./ItemDetailPage";
import { JobDetailPage } from "./JobDetailPage";
import { RequestsPage } from "./RequestsPage";
import { TransactionsPage } from "./TransactionsPage";
import { UsersPage } from "./UsersPage";

function sessionFor(role: UserRole): AuthenticatedSession {
  return {
    user: {
      id: `user-${role}`,
      email: `${role.toLowerCase()}@example.com`,
      displayName: `Sam Field`,
      role,
    },
    issuedAt: "2026-07-30T09:00:00.000Z",
    expiresAt: "2026-07-30T21:00:00.000Z",
  };
}

class StubAuthClient implements AuthClient {
  public constructor(private readonly session: AuthenticatedSession) {}

  public getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.session);
  }

  public signIn(credentials: SignInCredentials): Promise<AuthenticatedSession> {
    void credentials;
    return Promise.resolve(this.session);
  }

  public signOut(): Promise<void> {
    return Promise.resolve();
  }
}

function renderScreen(
  element: React.ReactElement,
  options: {
    readonly role?: UserRole;
    readonly path?: string;
    readonly route?: string;
    readonly api?: ApiClient;
  } = {},
): void {
  const { role = "Office", path = "/", route = "/", api = createFakeApiClient() } = options;

  render(
    <StockControlProviders authClient={new StubAuthClient(sessionFor(role))} apiClient={api}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </MemoryRouter>
    </StockControlProviders>,
  );
}

describe("dashboard", () => {
  it("greets the signed-in user and shows the counts the API returned", async () => {
    renderScreen(<DashboardPage />);

    expect(
      await screen.findByRole("heading", { name: /Good to see you, Sam/u }),
    ).toBeInTheDocument();
    expect(screen.getByText("235")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("surfaces low stock, the request queue and open reservations for Office", async () => {
    renderScreen(<DashboardPage />);

    await screen.findByRole("heading", { name: /Good to see you/u });

    expect(screen.getByRole("heading", { name: "Low on stock" })).toBeInTheDocument();
    expect(screen.getByText(/ITM-0099/u)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock requests" })).toBeInTheDocument();
    expect(screen.getByText(/REQ-0001/u)).toBeInTheDocument();
    expect(screen.getByText(/30 ea remaining to collect for J-1001/u)).toBeInTheDocument();
  });

  /*
   * The Engineer dashboard is a different screen, not the same one with pieces
   * hidden: no business totals, no low stock, no activity feed — just the stock
   * list, their jobs, and what they have committed or asked for.
   */
  it("gives an Engineer their own stock, jobs and commitments instead", async () => {
    renderScreen(<DashboardPage />, {
      role: "Engineer",
      api: createFakeApiClient({ "/dashboard": engineerDashboard }),
    });

    await screen.findByRole("heading", { name: /Good to see you/u });

    expect(await screen.findByRole("table", { name: "Inventory" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your jobs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stock committed for you" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your stock requests" })).toBeInTheDocument();

    expect(screen.queryByRole("heading", { name: "Low on stock" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent activity" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Items in catalogue" })).not.toBeInTheDocument();
  });

  it("shows an Engineer how much of an item is reserved for them", async () => {
    renderScreen(<DashboardPage />, {
      role: "Engineer",
      api: createFakeApiClient({ "/dashboard": engineerDashboard }),
    });

    const table = await screen.findByRole("table", { name: "Inventory" });

    expect(
      within(table).getByRole("columnheader", { name: "Committed for you" }),
    ).toBeInTheDocument();
    const row = within(table).getByText("M6 × 30 mm zinc-plated hex bolt").closest("tr");
    expect(within(row as HTMLElement).getByText("30")).toBeInTheDocument();
  });
});

describe("inventory", () => {
  it("lists items with on hand, reserved and available", async () => {
    renderScreen(<InventoryPage />);

    const table = await screen.findByRole("table", { name: "Inventory" });
    const row = within(table).getByText("M6 × 30 mm zinc-plated hex bolt").closest("tr");

    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("420")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("50")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("350")).toBeInTheDocument();
  });

  it("expands a row to show the per-location breakdown", async () => {
    const user = userEvent.setup();
    renderScreen(<InventoryPage />);

    await screen.findByRole("table", { name: "Inventory" });
    await user.click(screen.getByRole("button", { name: /Show locations for ITM-0001/u }));

    const breakdown = await screen.findByRole("table", { name: /Locations holding ITM-0001/u });
    expect(within(breakdown).getByText(/MAIN-A1/u)).toBeInTheDocument();
    expect(within(breakdown).getByText("Job site")).toBeInTheDocument();
  });

  it("offers item creation to Office but not to an Engineer", async () => {
    renderScreen(<InventoryPage />, { role: "Office" });
    expect(await screen.findByRole("button", { name: "New item" })).toBeInTheDocument();

    renderScreen(<InventoryPage />, { role: "Engineer" });
    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "What you have, and where" })).toHaveLength(2);
    });
    expect(screen.getAllByRole("button", { name: "New item" })).toHaveLength(1);
  });
});

describe("item detail", () => {
  const options = {
    path: "/inventory/:itemId",
    route: `/inventory/${testItemDetail.id}`,
  } as const;

  it("separates store stock from job-site stock in the figures", async () => {
    renderScreen(<ItemDetailPage />, options);

    await screen.findByRole("heading", { name: testItemDetail.name });

    /*
     * Read per tile rather than across the page: every tile now carries the
     * unit, so a bare "400 ea" also matches the location holding that much.
     */
    const figure = (label: string): string =>
      within(screen.getByRole("group", { name: label })).getByRole("paragraph").textContent;

    expect(figure("Total in stock")).toBe("420 ea");
    expect(figure("In stores")).toBe("400 ea");
    expect(figure("At job sites")).toBe("20 ea");
    expect(figure("Ready to use")).toBe("350 ea");
  });

  it("renders a QR code labelled with the item reference", async () => {
    renderScreen(<ItemDetailPage />, options);

    expect(
      await screen.findByRole("img", { name: "QR code linking to ITM-0001" }),
    ).toBeInTheDocument();
  });

  it("renders a valid item barcode", async () => {
    renderScreen(<ItemDetailPage />, options);

    expect(
      await screen.findByRole("img", { name: "EAN-13 barcode 5010000000011" }),
    ).toBeInTheDocument();
  });

  it("shows an Engineer only the operations their role allows", async () => {
    renderScreen(<ItemDetailPage />, { ...options, role: "Engineer" });

    await screen.findByRole("heading", { name: testItemDetail.name });

    expect(screen.getByRole("button", { name: "Take from store" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request stock" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  /*
   * The server already narrows the payload; this checks the screen does not
   * then label somebody else's movements as if they were shared.
   */
  it("titles an Engineer's history as their own and drops the actor column", async () => {
    renderScreen(<ItemDetailPage />, { ...options, role: "Engineer" });

    await screen.findByRole("heading", { name: testItemDetail.name });

    expect(screen.getByRole("heading", { name: "Your activity on this item" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent transactions" })).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Recent transactions" });
    expect(within(table).queryByRole("columnheader", { name: "Who" })).not.toBeInTheDocument();
  });

  it("offers Office the catalogue controls an Engineer does not get", async () => {
    renderScreen(<ItemDetailPage />, options);

    await screen.findByRole("heading", { name: testItemDetail.name });

    expect(screen.getByRole("heading", { name: "Recent transactions" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Edit item details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive item" })).toBeInTheDocument();
  });

  it("requires a reason before an adjustment can be submitted", async () => {
    const user = userEvent.setup();
    renderScreen(<ItemDetailPage />, options);

    await screen.findByRole("heading", { name: testItemDetail.name });
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Correct a counted quantity" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Reason/u)).toBeRequired();
    expect(within(dialog).getByLabelText(/Total counted/u)).toBeInTheDocument();
  });
});

describe("job detail", () => {
  const options = { path: "/jobs/:jobId", route: `/jobs/${testJob.id}` } as const;

  it("shows reserved, collected and outstanding for each reservation", async () => {
    renderScreen(<ItemDetailPage />, options);
    renderScreen(<JobDetailPage />, options);

    const table = await screen.findByRole("table", { name: "Reservations" });
    const row = within(table).getByText("ITM-0001").closest("tr") as HTMLElement;

    expect(within(row).getByText("50 ea")).toBeInTheDocument();
    expect(within(row).getByText("20 ea")).toBeInTheDocument();
    expect(within(row).getByText("30 ea")).toBeInTheDocument();
  });

  it("warns that closing leaves job-site stock where it is", async () => {
    renderScreen(<JobDetailPage />, options);

    await screen.findByRole("heading", { name: testJob.name });

    expect(
      screen.getByText(/Closing the job releases stock still committed to it/u),
    ).toBeInTheDocument();
  });

  it("lets Office release a reservation but not an Engineer", async () => {
    renderScreen(<JobDetailPage />, { ...options, role: "Office" });
    expect(await screen.findByRole("button", { name: "Release remaining" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close job" })).toBeInTheDocument();

    renderScreen(<JobDetailPage />, { ...options, role: "Engineer" });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Collect to site" })).toHaveLength(2);
    });
    expect(screen.getAllByRole("button", { name: "Release remaining" })).toHaveLength(1);
  });

  it("defaults a collection to the outstanding quantity", async () => {
    const user = userEvent.setup();
    renderScreen(<JobDetailPage />, options);

    await screen.findByRole("heading", { name: testJob.name });
    await user.click(screen.getByRole("button", { name: "Collect to site" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Quantity/u)).toHaveValue("30");
  });
});

describe("transactions", () => {
  it("lists the log with actor and reason columns", async () => {
    renderScreen(<TransactionsPage />);

    const table = await screen.findByRole("table", { name: "Transaction log" });

    expect(within(table).getByText("Olivia Desk")).toBeInTheDocument();
    expect(within(table).getByText("Receive")).toBeInTheDocument();
    expect(within(table).getByText("MAIN-A1")).toBeInTheDocument();
  });

  it("offers Office a filter for who did something", async () => {
    renderScreen(<TransactionsPage />);

    await screen.findByRole("table", { name: "Transaction log" });

    expect(screen.getByRole("combobox", { name: "Who" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Action" })).toBeInTheDocument();
  });

  it("presents the log to an Engineer as their own record", async () => {
    renderScreen(<TransactionsPage />, { role: "Engineer" });

    expect(await screen.findByRole("heading", { name: "Your activity" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Who" })).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Transaction log" });
    expect(within(table).queryByRole("columnheader", { name: "Who" })).not.toBeInTheDocument();
  });

  /* Filters live in the URL so a narrowed log can be linked to and shared. */
  it("keeps its filters in the address bar", async () => {
    const user = userEvent.setup();
    renderScreen(<TransactionsPage />, {
      path: "/transactions",
      route: "/transactions?itemId=ITM-0001",
    });

    await screen.findByRole("table", { name: "Transaction log" });
    expect(screen.getByLabelText("Item")).toHaveValue("ITM-0001");

    await user.clear(screen.getByLabelText("Item"));
    await user.type(screen.getByLabelText("Item"), "ITM-0002");

    await waitFor(() => {
      expect(screen.getByLabelText("Item")).toHaveValue("ITM-0002");
    });
  });
});

describe("stock requests", () => {
  it("lets Office decide a request and shows who asked for what", async () => {
    const user = userEvent.setup();
    renderScreen(<RequestsPage />);

    expect(await screen.findByText(/REQ-0001/u)).toBeInTheDocument();
    expect(screen.getByText(/Sam Field/u)).toBeInTheDocument();
    expect(screen.getByText(/Running short on site/u)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reject" }));

    const dialog = await screen.findByRole("dialog");
    /* A refusal has to say why, so the person who asked is not left guessing. */
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
  });

  it("offers an Engineer no way to decide their own request", async () => {
    renderScreen(<DashboardPage />, {
      role: "Engineer",
      api: createFakeApiClient({ "/dashboard": engineerDashboard }),
    });

    expect(await screen.findByText(/REQ-0001/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });
});

describe("users", () => {
  it("lists users and marks the signed-in Admin as themselves", async () => {
    renderScreen(<UsersPage />, { role: "Admin" });

    const table = await screen.findByRole("table", { name: "Users" });

    expect(within(table).getByText("admin@example.com")).toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: "Active: Admin User" })).toBeChecked();
  });
});
