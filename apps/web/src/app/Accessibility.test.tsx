import { fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  SignInCredentials,
  SignInResult,
  VerifyMfaCredentials,
} from "../auth/auth-types";
import { StockControlProviders } from "./App";
import { AppRoutes } from "./AppRoutes";

const adminUser: AuthenticatedUser = {
  id: "accessibility-admin",
  email: "admin@example.com",
  displayName: "Accessibility Admin",
  role: "Admin",
  status: "Active",
  effectiveCapabilities: ["inventory.view", "users.manage"],
  permissionCatalogueVersion: 1,
  mfaEnabled: true,
};

const adminSession: AuthenticatedSession = {
  user: adminUser,
  assurance: "mfa",
  issuedAt: "2026-07-29T09:00:00.000Z",
  idleExpiresAt: "2026-07-29T09:30:00.000Z",
  absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
  recentlyAuthenticatedAt: "2026-07-29T09:00:00.000Z",
};

class AccessibilityAuthClient implements AuthClient {
  public constructor(
    private readonly session: AuthenticatedSession | null,
    private readonly requireMfa = false,
  ) {}

  public getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.session);
  }

  public signIn(credentials: SignInCredentials): Promise<SignInResult> {
    void credentials;

    if (this.requireMfa) {
      return Promise.resolve({
        outcome: "mfa_required",
        challenge: {
          id: "accessibility-mfa",
          expiresAt: "2026-07-29T09:05:00.000Z",
          methods: ["totp", "recovery_code"],
        },
      });
    }

    return Promise.resolve({ outcome: "authenticated", session: adminSession });
  }

  public verifyMfa(
    credentials: VerifyMfaCredentials,
  ): Promise<{ readonly outcome: "authenticated"; readonly session: AuthenticatedSession }> {
    void credentials;
    return Promise.resolve({ outcome: "authenticated", session: adminSession });
  }

  public signOut(): Promise<void> {
    return Promise.resolve();
  }
}

async function expectNoAccessibilityViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, {
    rules: {
      "color-contrast": {
        enabled: false,
      },
    },
  });
  const summary = results.violations
    .map((violation) => `${violation.id}: ${violation.help}`)
    .join("\n");

  expect(results.violations, summary).toHaveLength(0);
}

describe("StockControl automated accessibility checks", () => {
  it("has no detectable violations on the sign-in page", async () => {
    const { container } = render(
      <StockControlProviders authClient={new AccessibilityAuthClient(null)}>
        <MemoryRouter initialEntries={["/sign-in"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    await screen.findByRole("heading", { name: "Welcome back" });
    await expectNoAccessibilityViolations(container);
  });

  it("has no detectable violations on the MFA challenge", async () => {
    const { container } = render(
      <StockControlProviders authClient={new AccessibilityAuthClient(null, true)}>
        <MemoryRouter initialEntries={["/sign-in"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    fireEvent.change(await screen.findByLabelText("Work email"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "password123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await screen.findByRole("heading", { name: "Verify your identity" });
    await expectNoAccessibilityViolations(container);
  });

  it("has no detectable violations in the authenticated dashboard shell", async () => {
    const { container } = render(
      <StockControlProviders authClient={new AccessibilityAuthClient(adminSession)}>
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    await screen.findByRole("heading", { name: "Inventory command centre" });
    await expectNoAccessibilityViolations(container);
  });
});
