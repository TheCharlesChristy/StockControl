import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AuthenticatedSession } from "@stockcontrol/contracts";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ApiError, type ApiClient } from "../api/ApiClient";
import { StockControlProviders } from "../app/App";
import { RequireAuthentication } from "../auth/RouteGuards";
import type { AuthClient, SessionOutcome, SignInCredentials } from "../auth/auth-types";
import { createFakeApiClient, type RecordedRequest } from "../test/fake-api";
import { ChangePasswordPage } from "./ChangePasswordPage";

const sessionWith = (mustChangePassword: boolean): AuthenticatedSession => ({
  user: {
    id: "user-1",
    username: "sam",
    email: "sam@example.com",
    displayName: "Sam Field",
    role: "Engineer",
    profilePhotoUrl: null,
    mustChangePassword,
  },
  issuedAt: "2026-07-30T09:00:00.000Z",
  expiresAt: "2026-07-30T21:00:00.000Z",
});

class StubAuthClient implements AuthClient {
  public constructor(private readonly session: AuthenticatedSession) {}

  public getSession(signal: AbortSignal): Promise<SessionOutcome | null> {
    signal.throwIfAborted();
    return Promise.resolve({ session: this.session, features: { stockCapture: false } });
  }

  public signIn(credentials: SignInCredentials): Promise<SessionOutcome> {
    void credentials;
    return Promise.resolve({ session: this.session, features: { stockCapture: false } });
  }

  public signOut(): Promise<void> {
    return Promise.resolve();
  }
}

const renderPage = (
  options: {
    readonly mustChangePassword?: boolean;
    readonly api?: ApiClient;
  } = {},
): void => {
  const { mustChangePassword = false, api = createFakeApiClient() } = options;

  render(
    <StockControlProviders
      authClient={new StubAuthClient(sessionWith(mustChangePassword))}
      apiClient={api}
    >
      <MemoryRouter initialEntries={["/change-password"]}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/profile" element={<p>Profile</p>} />
        </Routes>
      </MemoryRouter>
    </StockControlProviders>,
  );
};

describe("changing your own password", () => {
  it("sends the current and new password and returns to the profile", async () => {
    const requests: RecordedRequest[] = [];
    const api = createFakeApiClient({ "/auth/password": { changed: true } }, (request) =>
      requests.push(request),
    );

    renderPage({ api });

    await userEvent.type(await screen.findByLabelText(/Current password/u), "the-old-one-here");
    await userEvent.type(screen.getByLabelText(/^New password/u), "a-much-better-passphrase");
    await userEvent.type(
      screen.getByLabelText(/Confirm new password/u),
      "a-much-better-passphrase",
    );
    await userEvent.click(screen.getByRole("button", { name: /Change password/u }));

    await screen.findByText("Profile");
    expect(requests).toContainEqual({
      method: "POST",
      path: "/auth/password",
      body: {
        currentPassword: "the-old-one-here",
        newPassword: "a-much-better-passphrase",
      },
    });
  });

  it("will not submit while the confirmation disagrees", async () => {
    const requests: RecordedRequest[] = [];
    const api = createFakeApiClient({}, (request) => requests.push(request));

    renderPage({ api });

    await userEvent.type(await screen.findByLabelText(/Current password/u), "the-old-one-here");
    await userEvent.type(screen.getByLabelText(/^New password/u), "a-much-better-passphrase");
    await userEvent.type(screen.getByLabelText(/Confirm new password/u), "something-else-here");

    expect(screen.getByText("This does not match the new password.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change password/u })).toBeDisabled();
    expect(requests.some((request) => request.path === "/auth/password")).toBe(false);
  });

  it("puts the server's rejection next to the field it belongs to", async () => {
    const api = createFakeApiClient();
    vi.spyOn(api, "changePassword").mockRejectedValue(
      new ApiError(422, "request.validation_failed", "Validation failed", {
        currentPassword: ["That password was not recognised."],
      }),
    );

    renderPage({ api });

    await userEvent.type(await screen.findByLabelText(/Current password/u), "wrong-password-x");
    await userEvent.type(screen.getByLabelText(/^New password/u), "a-much-better-passphrase");
    await userEvent.type(
      screen.getByLabelText(/Confirm new password/u),
      "a-much-better-passphrase",
    );
    await userEvent.click(screen.getByRole("button", { name: /Change password/u }));

    await waitFor(() => {
      expect(screen.getByText("That password was not recognised.")).toBeInTheDocument();
    });
    expect(screen.queryByText("Profile")).not.toBeInTheDocument();
  });

  /*
   * A forced change is the whole point of the flag: leaving it dismissible
   * would leave the account on a password its Admin also knows.
   */
  it("offers no way out when the change is required", async () => {
    renderPage({ mustChangePassword: true });

    expect(await screen.findByText(/somebody else chose/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("offers a way out when the change is voluntary", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("an account holding a password somebody else chose", () => {
  const renderGuarded = (mustChangePassword: boolean): void => {
    render(
      <StockControlProviders
        authClient={new StubAuthClient(sessionWith(mustChangePassword))}
        apiClient={createFakeApiClient()}
      >
        <MemoryRouter initialEntries={["/dashboard"]}>
          <Routes>
            <Route element={<RequireAuthentication />}>
              <Route path="/dashboard" element={<p>Dashboard</p>} />
              <Route path="/change-password" element={<p>Change password</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </StockControlProviders>,
    );
  };

  it("is sent to change it before reaching anything else", async () => {
    renderGuarded(true);

    expect(await screen.findByText("Change password")).toBeInTheDocument();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("is left alone once the password is its own", async () => {
    renderGuarded(false);

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
  });
});
