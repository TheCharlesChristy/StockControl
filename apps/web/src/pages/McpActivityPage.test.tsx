import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CssBaseline, ThemeProvider } from "@mui/material";
import type {
  AuthenticatedSession,
  McpActivityListResponse,
  McpConnectionListResponse,
  UserRole,
} from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "../api/ApiContext";
import { AuthProvider } from "../auth/AuthContext";
import type { AuthClient, SessionOutcome } from "../auth/auth-types";
import { createFakeApiClient } from "../test/fake-api";
import { stockControlTheme } from "../theme";
import { McpActivityPage } from "./McpActivityPage";

function sessionFor(role: UserRole): AuthenticatedSession {
  return {
    user: {
      id: `user-${role}`,
      username: role.toLowerCase(),
      email: `${role.toLowerCase()}@example.com`,
      displayName: "Sam Field",
      role,
      profilePhotoUrl: null,
      mustChangePassword: false,
    },
    issuedAt: "2026-07-30T09:00:00.000Z",
    expiresAt: "2026-07-30T21:00:00.000Z",
  };
}

class StubAuthClient implements AuthClient {
  public getSession(signal: AbortSignal): Promise<SessionOutcome | null> {
    signal.throwIfAborted();
    return Promise.resolve({ session: sessionFor("Admin"), features: { stockCapture: false } });
  }

  public signIn(): Promise<SessionOutcome> {
    return Promise.resolve({ session: sessionFor("Admin"), features: { stockCapture: false } });
  }

  public signOut(): Promise<void> {
    return Promise.resolve();
  }
}

const activity: McpActivityListResponse = {
  rows: [
    {
      id: "activity-1",
      correlationId: "correlation-1",
      actorUserId: "user-Admin",
      actorName: "Sam Field",
      grantId: "grant-1",
      clientId: "chatgpt",
      toolName: "search_items",
      contractVersion: "2026-08-01",
      operation: "read",
      outcome: "Succeeded",
      arguments: { query: "bolt" },
      actionSummary: "Search catalogue",
      failureCode: null,
      durationMs: 42,
      effectLinks: [{ type: "item", id: "item-1" }],
      receivedAt: "2026-08-21T09:00:00.000Z",
      completedAt: "2026-08-21T09:00:00.042Z",
    },
  ],
  total: 51,
  limit: 50,
  offset: 0,
};

const connections: McpConnectionListResponse = {
  connections: [
    {
      id: "grant-1",
      clientId: "chatgpt",
      scopes: ["stock:read"],
      createdAt: "2026-08-20T09:00:00.000Z",
      revokedAt: null,
    },
    {
      id: "grant-2",
      clientId: "chatgpt",
      scopes: ["stock:read"],
      createdAt: "2026-08-19T09:00:00.000Z",
      revokedAt: "2026-08-20T09:00:00.000Z",
    },
  ],
};

function renderPage(
  activityResponse: McpActivityListResponse,
  connectionsResponse: McpConnectionListResponse,
  route = "/mcp-activity",
): void {
  render(
    <ThemeProvider theme={stockControlTheme}>
      <CssBaseline />
      <AuthProvider client={new StubAuthClient()}>
        <ApiProvider
          client={createFakeApiClient({
            "/mcp-activity": activityResponse,
            "/mcp-activity/connections": connectionsResponse,
          })}
        >
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path="/mcp-activity" element={<McpActivityPage />} />
            </Routes>
          </MemoryRouter>
        </ApiProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}

describe("McpActivityPage", () => {
  it("shows activity, connection state, filters, and paging", async () => {
    const user = userEvent.setup();
    renderPage(activity, connections);

    expect(await screen.findByRole("heading", { name: "ChatGPT activity" })).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "ChatGPT activity" });
    const row = within(table).getByText("search_items").closest("tr");

    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Succeeded")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(/Search catalogue/u)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("item: item-1")).toBeInTheDocument();
    expect(screen.getByText("chatgpt · stock:read")).toBeInTheDocument();
    expect(screen.getByText("chatgpt · stock:read · revoked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revoke" })).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Tool" }), "search_items");
    await user.click(screen.getByRole("combobox", { name: "Result" }));
    await user.click(await screen.findByRole("option", { name: "Succeeded" }));
    await user.click(screen.getByRole("button", { name: "Go to page 2" }));

    expect(screen.getByRole("textbox", { name: "Tool" })).toHaveValue("search_items");
  });

  it("shows the empty state when filters return no activity or connections", async () => {
    renderPage(
      { rows: [], total: 0, limit: 50, offset: 0 },
      { connections: [] },
      "/mcp-activity?outcome=Incomplete&operation=read&page=0",
    );

    expect(await screen.findByText("No ChatGPT activity matches")).toBeInTheDocument();
    expect(screen.getByText("No connections.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "ChatGPT activity" })).not.toBeInTheDocument();
  });
});
