import { render, screen } from "@testing-library/react";
import axe from "axe-core";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  SignInCredentials,
} from "../auth/auth-types";
import { createFakeApiClient } from "../test/fake-api";
import { StockControlProviders } from "./App";
import { AppRoutes } from "./AppRoutes";

const adminUser: AuthenticatedUser = {
  id: "accessibility-admin",
  email: "admin@example.com",
  displayName: "Accessibility Admin",
  role: "Admin",
  profilePhotoUrl: null,
  mustChangePassword: false,
};

const adminSession: AuthenticatedSession = {
  user: adminUser,
  issuedAt: "2026-07-29T09:00:00.000Z",
  expiresAt: "2026-07-29T21:00:00.000Z",
};

class AccessibilityAuthClient implements AuthClient {
  public constructor(private readonly session: AuthenticatedSession | null) {}

  public getSession(signal: AbortSignal): Promise<AuthenticatedSession | null> {
    signal.throwIfAborted();
    return Promise.resolve(this.session);
  }

  public signIn(credentials: SignInCredentials): Promise<AuthenticatedSession> {
    void credentials;
    return Promise.resolve(adminSession);
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
      <StockControlProviders
        authClient={new AccessibilityAuthClient(null)}
        apiClient={createFakeApiClient()}
      >
        <MemoryRouter initialEntries={["/sign-in"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    await screen.findByRole("heading", { name: "Sign in" });
    await expectNoAccessibilityViolations(container);
  });

  it("has no detectable violations in the authenticated dashboard shell", async () => {
    const { container } = render(
      <StockControlProviders
        authClient={new AccessibilityAuthClient(adminSession)}
        apiClient={createFakeApiClient()}
      >
        <MemoryRouter initialEntries={["/dashboard"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    await screen.findByRole("heading", { name: /Good to see you/u });
    await expectNoAccessibilityViolations(container);
  });

  it("has no detectable violations on the building map", async () => {
    const { container } = render(
      <StockControlProviders
        authClient={new AccessibilityAuthClient(adminSession)}
        apiClient={createFakeApiClient()}
      >
        <MemoryRouter initialEntries={["/locations"]}>
          <AppRoutes />
        </MemoryRouter>
      </StockControlProviders>,
    );

    /* Generous: this route is code-split, so the chunk resolves before the map does. */
    const canvas = await screen.findByRole(
      "application",
      { name: /Main warehouse map/u },
      { timeout: 5000 },
    );

    /*
     * The canvas is a single tab stop that moves an active descendant, rather
     * than one tab stop per region plus four per selection handle.
     */
    expect(canvas).toHaveAttribute("tabindex", "0");
    expect(container.querySelectorAll("svg [tabindex]")).toHaveLength(0);
    await expectNoAccessibilityViolations(container);
  });
});
