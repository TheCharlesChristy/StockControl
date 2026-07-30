import { fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  SignInCredentials,
  SignInResult,
  UserRole,
  VerifyMfaCredentials,
} from "../auth/auth-types";
import { setDesktopViewport } from "../test/setup";
import { StockControlProviders } from "./App";
import { AppRoutes } from "./AppRoutes";

function userForRole(role: UserRole): AuthenticatedUser {
  const effectiveCapabilities = {
    Engineer: [
      "inventory.view",
      "inventory.take",
      "jobs.view",
      "jobs.reservations.request",
      "purchasing.request",
      "locations.view",
    ],
    Office: [
      "inventory.view",
      "inventory.take",
      "jobs.view",
      "purchasing.view",
      "stocktakes.start",
      "locations.view",
      "reports.operational",
    ],
    Admin: [
      "inventory.view",
      "inventory.take",
      "jobs.view",
      "purchasing.view",
      "stocktakes.start",
      "locations.view",
      "reports.financial",
      "users.view",
    ],
  } as const satisfies Readonly<Record<UserRole, readonly string[]>>;

  return {
    id: `test-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@example.com`,
    displayName: `${role} User`,
    role,
    status: "Active",
    effectiveCapabilities: effectiveCapabilities[role],
    permissionCatalogueVersion: 1,
    mfaEnabled: role === "Admin",
  };
}

function sessionForUser(user: AuthenticatedUser): AuthenticatedSession {
  return {
    user,
    assurance: user.mfaEnabled ? "mfa" : "password",
    issuedAt: "2026-07-29T09:00:00.000Z",
    idleExpiresAt: "2026-07-29T11:00:00.000Z",
    absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
    recentlyAuthenticatedAt: "2026-07-29T09:00:00.000Z",
  };
}

class FakeAuthClient implements AuthClient {
  private session: AuthenticatedSession | null;
  private pendingMfa = false;

  public constructor(
    sessionUser: AuthenticatedUser | null = null,
    private readonly signInUser: AuthenticatedUser = userForRole("Office"),
  ) {
    this.session = sessionUser === null ? null : sessionForUser(sessionUser);
  }

  public getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.session);
  }

  public signIn(credentials: SignInCredentials): Promise<SignInResult> {
    void credentials;

    if (this.signInUser.mfaEnabled) {
      this.pendingMfa = true;
      return Promise.resolve({
        outcome: "mfa_required",
        challenge: {
          id: "test-mfa-challenge",
          expiresAt: "2026-07-29T09:05:00.000Z",
          methods: ["totp", "recovery_code"],
        },
      });
    }

    this.session = sessionForUser(this.signInUser);
    return Promise.resolve({
      outcome: "authenticated",
      session: this.session,
    });
  }

  public verifyMfa(
    credentials: VerifyMfaCredentials,
  ): Promise<{ readonly outcome: "authenticated"; readonly session: AuthenticatedSession }> {
    if (
      !this.pendingMfa ||
      credentials.challengeId !== "test-mfa-challenge" ||
      credentials.code !== "123456"
    ) {
      return Promise.reject(new Error("MFA verification failed."));
    }

    this.pendingMfa = false;
    this.session = sessionForUser(this.signInUser);
    return Promise.resolve({
      outcome: "authenticated",
      session: this.session,
    });
  }

  public signOut(): Promise<void> {
    this.pendingMfa = false;
    this.session = null;
    return Promise.resolve();
  }
}

function renderRoute(path: string, authClient: AuthClient = new FakeAuthClient()): RenderResult {
  return render(
    <StockControlProviders authClient={authClient}>
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
    <StockControlProviders authClient={authClient}>
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
  fireEvent.change(await screen.findByLabelText("Work email"), {
    target: { value: "office@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password123" },
  });
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("StockControl application routes", () => {
  it("redirects an anonymous protected-route visit to sign in", async () => {
    renderRoute("/inventory");

    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Work email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("shows accessible validation feedback for invalid credentials", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in");

    await user.type(await screen.findByLabelText("Work email"), "invalid-email");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid work email address.");
  });

  it("requires a password before calling the authentication service", async () => {
    const user = userEvent.setup();
    const client = new FakeAuthClient();
    const signIn = vi.spyOn(client, "signIn");
    renderRoute("/sign-in", client);

    await user.type(await screen.findByLabelText("Work email"), "office@example.com");
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
      verifyMfa: () => Promise.reject(new Error("MFA rejected")),
      signOut: () => Promise.resolve(),
    };
    renderRoute("/sign-in", client);

    await completeValidSignIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign you in. Check your details and try again.",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByLabelText("Work email")).toBeEnabled();
  });

  it("returns a signed-in user to a safe requested section", async () => {
    renderSignInWithRedirect("/inventory?query=bolts#results");

    await completeValidSignIn();

    expect(await screen.findByRole("heading", { name: "Inventory" })).toBeInTheDocument();
  });

  it.each([
    null,
    "https://malicious.example/steal",
    "//malicious.example/steal",
    String.raw`/\malicious.example\steal`,
    "/sign-in",
  ])("falls back to the dashboard for unsafe redirect state %#", async (from) => {
    renderSignInWithRedirect(from);

    await completeValidSignIn();

    expect(
      await screen.findByRole("heading", {
        name: "Keep stock moving without surprises",
      }),
    ).toBeInTheDocument();
  });

  it("signs an Admin into the role-aware dashboard shell", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in", new FakeAuthClient(null, userForRole("Admin")));

    fireEvent.change(await screen.findByLabelText("Work email"), {
      target: { value: "admin.owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByRole("heading", { name: "Verify your identity" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Authenticator or recovery code"), {
      target: { value: "123456" },
    });
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));

    expect(
      await screen.findByRole("heading", {
        name: "Inventory command centre",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  }, 15_000);

  it("validates MFA safely and lets the user choose another account", async () => {
    const user = userEvent.setup();
    renderRoute("/sign-in", new FakeAuthClient(null, userForRole("Admin")));

    fireEvent.change(await screen.findByLabelText("Work email"), {
      target: { value: "admin.owner@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await screen.findByRole("heading", { name: "Verify your identity" });

    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter your authenticator code or a recovery code.",
    );

    fireEvent.change(screen.getByLabelText("Authenticator or recovery code"), {
      target: { value: "000000" },
    });
    await user.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code could not be verified. Check it and try again.",
    );

    await user.click(screen.getByRole("button", { name: "Use another account" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toHaveValue("");
  }, 15_000);

  it("labels dashboard placeholders instead of presenting invented stock data", async () => {
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    expect(await screen.findByText("Interface preview: no live stock data")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText("£184k")).not.toBeInTheDocument();
    expect(screen.queryByText(/encrypted backup/i)).not.toBeInTheDocument();
  });

  it("updates the document title and focuses main content after navigation", async () => {
    const user = userEvent.setup();
    renderRoute("/dashboard", new FakeAuthClient(userForRole("Admin")));

    await screen.findByRole("heading", { name: "Inventory command centre" });
    await waitFor(() => {
      expect(document.title).toBe("Overview · StockControl");
    });

    await user.click(screen.getByRole("link", { name: "Inventory" }));

    expect(await screen.findByRole("heading", { name: "Inventory" })).toBeInTheDocument();
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

    expect(await screen.findByRole("heading", { name: "Inventory" })).toBeInTheDocument();
    expect(openNavigation).toHaveAttribute("aria-expanded", "false");
  });

  it("protects a capability-restricted section from an Engineer", async () => {
    renderRoute("/team", new FakeAuthClient(userForRole("Engineer")));

    expect(await screen.findByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team & access" })).not.toBeInTheDocument();
  });

  it("uses effective capabilities so an individual Office override can expose team access", async () => {
    const officeWithUserAccess: AuthenticatedUser = {
      ...userForRole("Office"),
      effectiveCapabilities: [...userForRole("Office").effectiveCapabilities, "users.view"],
    };

    renderRoute("/team", new FakeAuthClient(officeWithUserAccess));

    expect(await screen.findByRole("heading", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team & access" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  it("honours an effective denial even when the role template is Admin", async () => {
    const adminWithoutUserAccess: AuthenticatedUser = {
      ...userForRole("Admin"),
      effectiveCapabilities: ["inventory.view"],
    };

    renderRoute("/team", new FakeAuthClient(adminWithoutUserAccess));

    expect(await screen.findByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Team & access" })).not.toBeInTheDocument();
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
