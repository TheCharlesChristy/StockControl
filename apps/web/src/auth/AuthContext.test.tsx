import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { AuthClient, AuthenticatedSession, AuthenticatedUser } from "./auth-types";
import { AuthProvider, useAuth } from "./AuthContext";

type GetSession = AuthClient["getSession"];
type SignIn = AuthClient["signIn"];
type SignOut = AuthClient["signOut"];

interface AuthClientImplementations {
  readonly getSession?: GetSession;
  readonly signIn?: SignIn;
  readonly signOut?: SignOut;
}

interface AuthClientHarness {
  readonly client: AuthClient;
  readonly getSession: Mock<GetSession>;
  readonly signIn: Mock<SignIn>;
  readonly signOut: Mock<SignOut>;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

const officeUser: AuthenticatedUser = {
  id: "user-office-1",
  email: "office@example.com",
  displayName: "Office User",
  role: "Office",
  profilePhotoUrl: null,
  mustChangePassword: false,
};

const officeSession: AuthenticatedSession = {
  user: officeUser,
  issuedAt: "2026-07-29T09:00:00.000Z",
  expiresAt: "2026-07-29T21:00:00.000Z",
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function createAuthClient(implementations: AuthClientImplementations = {}): AuthClientHarness {
  const getSession = vi.fn<GetSession>(implementations.getSession ?? (() => Promise.resolve(null)));
  const signIn = vi.fn<SignIn>(implementations.signIn ?? (() => Promise.resolve(officeSession)));
  const signOut = vi.fn<SignOut>(implementations.signOut ?? (() => Promise.resolve()));

  return {
    client: { getSession, signIn, signOut },
    getSession,
    signIn,
    signOut,
  };
}

function AuthProbe(): ReactElement {
  const { signIn, signOut, status, user } = useAuth();

  return (
    <>
      <output aria-label="Authentication status">{status}</output>
      <output aria-label="Authenticated user">{user?.email ?? "none"}</output>
      <button
        type="button"
        onClick={() => {
          void signIn("  OFFICE.OWNER@EXAMPLE.COM  ", "unchanged-password");
        }}
      >
        Sign in through context
      </button>
      <button
        type="button"
        onClick={() => {
          void signOut();
        }}
      >
        Sign out through context
      </button>
    </>
  );
}

function renderProbe(client: AuthClient): void {
  render(
    <AuthProvider client={client}>
      <AuthProbe />
    </AuthProvider>,
  );
}

const statusText = (): string =>
  screen.getByRole("status", { name: "Authentication status" }).textContent;

describe("AuthProvider", () => {
  it("reports checking until the initial session lookup settles", async () => {
    const deferred = createDeferred<AuthenticatedSession | null>();
    renderProbe(createAuthClient({ getSession: () => deferred.promise }).client);

    expect(statusText()).toBe("checking");

    await act(async () => {
      deferred.resolve(null);
      await deferred.promise;
    });

    await waitFor(() => {
      expect(statusText()).toBe("anonymous");
    });
  });

  it("restores an existing session as authenticated", async () => {
    renderProbe(createAuthClient({ getSession: () => Promise.resolve(officeSession) }).client);

    await waitFor(() => {
      expect(statusText()).toBe("authenticated");
    });
    expect(screen.getByRole("status", { name: "Authenticated user" })).toHaveTextContent(
      "office@example.com",
    );
  });

  it("falls back to anonymous when the session lookup fails", async () => {
    renderProbe(
      createAuthClient({ getSession: () => Promise.reject(new Error("network")) }).client,
    );

    await waitFor(() => {
      expect(statusText()).toBe("anonymous");
    });
  });

  it("normalizes the email before signing in and becomes authenticated", async () => {
    const harness = createAuthClient();
    renderProbe(harness.client);
    await waitFor(() => {
      expect(statusText()).toBe("anonymous");
    });

    await userEvent.click(screen.getByRole("button", { name: "Sign in through context" }));

    await waitFor(() => {
      expect(statusText()).toBe("authenticated");
    });
    expect(harness.signIn).toHaveBeenCalledWith({
      email: "office.owner@example.com",
      password: "unchanged-password",
    });
  });

  it("returns to anonymous after signing out", async () => {
    const harness = createAuthClient({ getSession: () => Promise.resolve(officeSession) });
    renderProbe(harness.client);
    await waitFor(() => {
      expect(statusText()).toBe("authenticated");
    });

    await userEvent.click(screen.getByRole("button", { name: "Sign out through context" }));

    await waitFor(() => {
      expect(statusText()).toBe("anonymous");
    });
    expect(harness.signOut).toHaveBeenCalledTimes(1);
  });

  it("requires a provider", () => {
    expect(() => render(<AuthProbe />)).toThrow("useAuth must be used within an AuthProvider.");
  });
});
