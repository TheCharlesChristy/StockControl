import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  SessionFeatures,
  SessionOutcome,
  SignInCredentials,
  UserRole,
} from "../auth/auth-types";
import { createFakeApiClient } from "../test/fake-api";
import { setDesktopViewport } from "../test/setup";
import { StockControlProviders } from "./App";
import { AppRoutes } from "./AppRoutes";

function userForRole(role: UserRole): AuthenticatedUser {
  return {
    id: `test-${role.toLowerCase()}`,
    username: role.toLowerCase(),
    email: `${role.toLowerCase()}@example.com`,
    displayName: `${role} User`,
    role,
    profilePhotoUrl: null,
    mustChangePassword: false,
  };
}

function sessionForUser(user: AuthenticatedUser): AuthenticatedSession {
  return {
    user,
    issuedAt: "2026-07-29T09:00:00.000Z",
    expiresAt: "2026-07-29T21:00:00.000Z",
  };
}

const noFeatures: SessionFeatures = { stockCapture: false };

class FakeAuthClient implements AuthClient {
  private session: AuthenticatedSession | null;

  public constructor(
    sessionUser: AuthenticatedUser | null = null,
    private readonly signInUser: AuthenticatedUser = userForRole("Office"),
    private readonly features: SessionFeatures = noFeatures,
  ) {
    this.session = sessionUser === null ? null : sessionForUser(sessionUser);
  }

  public getSession(signal: AbortSignal): Promise<SessionOutcome | null> {
    signal.throwIfAborted();
    return Promise.resolve(
      this.session === null ? null : { session: this.session, features: this.features },
    );
  }

  public signIn(credentials: SignInCredentials): Promise<SessionOutcome> {
    void credentials;
    this.session = sessionForUser(this.signInUser);
    return Promise.resolve({ session: this.session, features: this.features });
  }

  public signOut(): Promise<void> {
    this.session = null;
    return Promise.resolve();
  }
}

function renderRoute(path: string, authClient: AuthClient = new FakeAuthClient()): RenderResult {
  return render(
    <StockControlProviders authClient={authClient} apiClient={createFakeApiClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </StockControlProviders>,
  );
}

function renderSignInWithRedirect(
  from: unknown,
  authClient: AuthClient = new FakeAuthClient(),
): RenderResult {
  return render(
    <StockControlProviders authClient={authClient} apiClient={createFakeApiClient()}>
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/sign-in",
            state: { from },
          },
        ]}
      >
        <AppRoutes />
      </MemoryRouter>
    </StockControlProviders>,
  );
}

async function completeValidSignIn(): Promise<void> {
  const user = userEvent.setup();
  fireEvent.change(await screen.findByLabelText("Username"), {
    target: { value: "office" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password123" },
  });
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("StockControl application routes", () => {
  it("redirects an anonymous protected-route visit to sign in", async () => {
    renderRoute("/inventory");

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("shows accessible validation feedback for invalid credentials", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in");

    await user.type(await screen.findByLabelText("Username"), "not a username");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use letters, numbers, dots, hyphens and underscores only",
    );
  });

  it("requires a password before calling the authentication service", async () => {
    const user = userEvent.setup();
    const client = new FakeAuthClient();
    const signIn = vi.spyOn(client, "signIn");
    renderRoute("/sign-in", client);

    await user.type(await screen.findByLabelText("Username"), "office");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your password.");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("can show and hide the password without changing its value", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in");
    const password = await screen.findByLabelText("Password");

    await user.type(password, "password123");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("password123");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("shows safe feedback and restores the form when sign-in fails", async () => {
    const client: AuthClient = {
      getSession: () => Promise.resolve(null),
      signIn: () => Promise.reject(new Error("Credentials rejected")),
      signOut: () => Promise.resolve(),
    };
    renderRoute("/sign-in", client);

    await completeValidSignIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in. Check your details and try again.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByLabelText("Username")).toBeEnabled();
  });

  /*
   * Scanning an item's QR code while signed out has to come back to that item
   * once you have signed in. It is the only journey that survives sign-in.
   */
  it("returns a signed-in user to a record they asked for by link", async () => {
    renderSignInWithRedirect("/inventory/item-1");

    await completeValidSignIn();

    expect(
      await screen.findByRole("heading", { name: /M6 × 30 mm zinc-plated hex bolt/u }),
    ).toBeInTheDocument();
  });

  /*
   * Arriving from a camera is a full page load, so there is no router history
   * state to carry the destination — only the URL. This is the case the demo
   * journey walks, and the one that used to bounce to the dashboard.
   */
  it("returns to the record when only the URL remembers it", async () => {
    renderRoute("/sign-in?next=%2Finventory%2Fitem-1");

    await completeValidSignIn();

    expect(
      await screen.findByRole("heading", { name: /M6 × 30 mm zinc-plated hex bolt/u }),
    ).toBeInTheDocument();
  });

  /*
   * Signing in flips the auth status while the sign-in page is running its own
   * redirect. Both sides have to choose the same destination or they race, and
   * the visitor lands wherever the later navigation happened to point.
   */
  it("sends an already-signed-in visitor on /sign-in to the record, not the dashboard", async () => {
    renderRoute("/sign-in?next=%2Finventory%2Fitem-1", new FakeAuthClient(userForRole("Office")));

    expect(
      await screen.findByRole("heading", { name: /M6 × 30 mm zinc-plated hex bolt/u }),
    ).toBeInTheDocument();
  });

  it.each([
    null,
    "https://malicious.example/steal",
    "//malicious.example/steal",
    String.raw`/\malicious.example\steal`,
    "/sign-in",
    /* A section, not a record: signing in again starts at the dashboard. */
    "/inventory?query=bolts#results",
    "/transactions",
  ])("falls back to the dashboard for redirect state %#", async (from) => {
    renderSignInWithRedirect(from);

    await completeValidSignIn();

    expect(await screen.findByRole("heading", { name: /Good to see you/u })).toBeInTheDocument();
  });

  it("signs an Admin into the role-aware dashboard shell", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in", new FakeAuthClient(null, userForRole("Admin")));

    fireEvent.change(await screen.findByLabelText("Username"), {
      target: { value: "admin.owner" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: /Good to see you/u })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  }, 15_000);

  it("shows counts and recent activity from the API rather than invented figures", async () => {
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    expect(await screen.findByRole("heading", { name: /Good to see you/u })).toBeInTheDocument();
    expect(await screen.findByText("235")).toBeInTheDocument();
    expect(screen.getByText(/Olivia Desk/u)).toBeInTheDocument();
    expect(screen.queryByText("£184k")).not.toBeInTheDocument();
  });

  it("shows issue reporting only after the API confirms it is configured", async () => {
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    expect(await screen.findByRole("button", { name: "Report an issue" })).toBeInTheDocument();
  });

  it("updates the document title and focuses main content after navigation", async () => {
    const user = userEvent.setup();
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    await screen.findByRole("heading", { name: /Good to see you/u });
    await waitFor(() => {
      expect(document.title).toBe("Overview · StockControl");
    });

    await user.click(screen.getByRole("link", { name: "Inventory" }));

    expect(
      await screen.findByRole("heading", { name: "What you have, and where" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe("Inventory · StockControl");
      expect(screen.getByRole("main")).toHaveFocus();
    });
  });

  it("opens and closes the role-aware navigation on a mobile viewport", async () => {
    setDesktopViewport(false);
    const user = userEvent.setup();
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    const openNavigation = await screen.findByRole("button", {
      name: "Open navigation",
    });
    expect(openNavigation).toHaveAttribute("aria-expanded", "false");

    await user.click(openNavigation);

    expect(openNavigation).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByRole("link", { name: "Inventory" }));

    expect(
      await screen.findByRole("heading", { name: "What you have, and where" }),
    ).toBeInTheDocument();
    expect(openNavigation).toHaveAttribute("aria-expanded", "false");
  });

  it.each(["Engineer", "Office"] as const)(
    "protects the Admin-only team section from %s",
    async (role) => {
      renderRoute("/team", new FakeAuthClient(userForRole(role)));

      expect(await screen.findByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Team & access" })).not.toBeInTheDocument();
    },
  );

  it("gives an Admin the team section", async () => {
    renderRoute("/team", new FakeAuthClient(userForRole("Admin")));

    expect(await screen.findByRole("heading", { name: "Who can do what" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  it.each([
    {
      path: "/loading",
      heading: "Loading workspace data",
    },
    {
      path: "/error",
      heading: "This view could not be loaded",
    },
    {
      path: "/not-a-real-page",
      heading: "Page not found",
    },
  ])("renders the $heading route state", async ({ path, heading }): Promise<void> => {
    renderRoute(path, new FakeAuthClient(userForRole("Admin")));

    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
  });
});
