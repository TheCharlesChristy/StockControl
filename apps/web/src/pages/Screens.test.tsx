import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthenticatedSession, UserRole } from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "../api/ApiClient";
import { StockControlProviders } from "../app/App";
import type { AuthClient, SignInCredentials } from "../auth/auth-types";
import { createFakeApiClient, testItemDetail, testJob } from "../test/fake-api";
import { DashboardPage } from "./DashboardPage";
import { InventoryPage } from "./InventoryPage";
import { ItemDetailPage } from "./ItemDetailPage";
import { JobDetailPage } from "./JobDetailPage";
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

  it("surfaces low stock and the user's own open reservations", async () => {
    renderScreen(<DashboardPage />);

    await screen.findByRole("heading", { name: /Good to see you/u });

    expect(screen.getByRole("heading", { name: "Low stock" })).toBeInTheDocument();
    expect(screen.getByText(/ITM-0099/u)).toBeInTheDocument();
    expect(screen.getByText(/30 ea outstanding for J-1001/u)).toBeInTheDocument();
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

    expect(screen.getByText("420 ea")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("350")).toBeInTheDocument();
  });

  it("renders a QR code labelled with the item reference", async () => {
    renderScreen(<ItemDetailPage />, options);

    expect(
      await screen.findByRole("img", { name: "QR code linking to ITM-0001" }),
    ).toBeInTheDocument();
  });

  it("shows an Engineer only the operations their role allows", async () => {
    renderScreen(<ItemDetailPage />, { ...options, role: "Engineer" });

    await screen.findByRole("heading", { name: testItemDetail.name });

    expect(screen.getByRole("button", { name: "Issue" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Receive" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Adjust" })).not.toBeInTheDocument();
  });

  it("requires a reason before an adjustment can be submitted", async () => {
    const user = userEvent.setup();
    renderScreen(<ItemDetailPage />, options);

    await screen.findByRole("heading", { name: testItemDetail.name });
    await user.click(screen.getByRole("button", { name: "Adjust" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Reason/u)).toBeRequired();
    expect(within(dialog).getByLabelText(/Counted quantity/u)).toBeInTheDocument();
  });
});

describe("job detail", () => {
  const options = { path: "/jobs/:jobId", route: `/jobs/${testJob.id}` } as const;

  it("shows reserved, collected and outstanding for each reservation", async () => {
    renderScreen(<ItemDetailPage />, options);
    renderScreen(<JobDetailPage />, options);

    const table = await screen.findByRole("table", { name: "Reservations" });
    const row = within(table).getByText("ITM-0001").closest("tr") as HTMLElement;

    expect(within(row).getByText("50")).toBeInTheDocument();
    expect(within(row).getByText("20")).toBeInTheDocument();
    expect(within(row).getByText("30")).toBeInTheDocument();
  });

  it("warns that closing leaves job-site stock where it is", async () => {
    renderScreen(<JobDetailPage />, options);

    await screen.findByRole("heading", { name: testJob.name });

    expect(
      screen.getByText(/Closing the job releases uncollected reservations/u),
    ).toBeInTheDocument();
  });

  it("lets Office release a reservation but not an Engineer", async () => {
    renderScreen(<JobDetailPage />, { ...options, role: "Office" });
    expect(await screen.findByRole("button", { name: "Release" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close job" })).toBeInTheDocument();

    renderScreen(<JobDetailPage />, { ...options, role: "Engineer" });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Collect" })).toHaveLength(2);
    });
    expect(screen.getAllByRole("button", { name: "Release" })).toHaveLength(1);
  });

  it("defaults a collection to the outstanding quantity", async () => {
    const user = userEvent.setup();
    renderScreen(<JobDetailPage />, options);

    await screen.findByRole("heading", { name: testJob.name });
    await user.click(screen.getByRole("button", { name: "Collect" }));

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
});

describe("users", () => {
  it("lists users and marks the signed-in Admin as themselves", async () => {
    renderScreen(<UsersPage />, { role: "Admin" });

    const table = await screen.findByRole("table", { name: "Users" });

    expect(within(table).getByText("admin@example.com")).toBeInTheDocument();
    expect(within(table).getByRole("checkbox", { name: "Active: Admin User" })).toBeChecked();
  });
});
