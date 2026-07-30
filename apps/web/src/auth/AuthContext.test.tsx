import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi, type Mock } from "vitest";

import type { AuthClient, AuthenticatedSession, AuthenticatedUser } from "./auth-types";
import { AuthProvider, useAuth } from "./AuthContext";

type GetSession = AuthClient["getSession"];
type SignIn = AuthClient["signIn"];
type VerifyMfa = AuthClient["verifyMfa"];
type SignOut = AuthClient["signOut"];

interface AuthClientImplementations {
  readonly getSession?: GetSession;
  readonly signIn?: SignIn;
  readonly verifyMfa?: VerifyMfa;
  readonly signOut?: SignOut;
}

interface AuthClientHarness {
  readonly client: AuthClient;
  readonly getSession: Mock<GetSession>;
  readonly signIn: Mock<SignIn>;
  readonly verifyMfa: Mock<VerifyMfa>;
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
  status: "Active",
  effectiveCapabilities: ["inventory.view"],
  permissionCatalogueVersion: 1,
  mfaEnabled: false,
};

const officeSession: AuthenticatedSession = {
  user: officeUser,
  assurance: "password",
  issuedAt: "2026-07-29T09:00:00.000Z",
  idleExpiresAt: "2026-07-29T11:00:00.000Z",
  absoluteExpiresAt: "2026-07-29T21:00:00.000Z",
  recentlyAuthenticatedAt: "2026-07-29T09:00:00.000Z",
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createAuthClient(implementations: AuthClientImplementations = {}): AuthClientHarness {
  const getSession = vi.fn<GetSession>(implementations.getSession ?? (() => Promise.resolve(null)));
  const signIn = vi.fn<SignIn>(
    implementations.signIn ??
      (() => Promise.resolve({ outcome: "authenticated", session: officeSession })),
  );
  const verifyMfa = vi.fn<VerifyMfa>(
    implementations.verifyMfa ??
      (() => Promise.resolve({ outcome: "authenticated", session: officeSession })),
  );
  const signOut = vi.fn<SignOut>(implementations.signOut ?? (() => Promise.resolve()));

  return {
    client: {
      getSession,
      signIn,
      verifyMfa,
      signOut,
    },
    getSession,
    signIn,
    verifyMfa,
    signOut,
  };
}

function AuthProbe(): ReactElement {
  const { cancelMfa, mfaChallenge, signIn, signOut, status, user, verifyMfa } = useAuth();

  return (
    <>
      <output aria-label="Authentication status">{status}</output>
      <output aria-label="Authenticated user">{user?.email ?? "none"}</output>
      <output aria-label="MFA challenge">{mfaChallenge?.id ?? "none"}</output>
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
          void verifyMfa("123456");
        }}
      >
        Verify MFA through context
      </button>
      <button type="button" onClick={cancelMfa}>
        Cancel MFA through context
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

function renderProvider(client: AuthClient): ReturnType<typeof render> {
  return render(
    <AuthProvider client={client}>
      <AuthProbe />
    </AuthProvider>,
  );
}

describe("AuthProvider", () => {
  it("reports checking until a valid existing session resolves", async () => {
    const session = createDeferred<AuthenticatedSession | null>();
    const { client, getSession } = createAuthClient({
      getSession: () => session.promise,
    });

    renderProvider(client);

    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("checking");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent("none");
    expect(getSession).toHaveBeenCalledOnce();
    expect(getSession.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);

    await act(async () => {
      session.resolve(officeSession);
      await session.promise;
    });

    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent(officeUser.email);
  });

  it("becomes anonymous when there is no existing session", async () => {
    const { client } = createAuthClient();

    renderProvider(client);

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent("none");
  });

  it("fails closed to anonymous when session lookup fails", async () => {
    const { client } = createAuthClient({
      getSession: () => Promise.reject(new Error("Authentication service unavailable")),
    });

    renderProvider(client);

    expect(await screen.findByText("anonymous")).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent("none");
  });

  it("normalizes the email and stores an authenticated session after sign-in", async () => {
    const engineerUser: AuthenticatedUser = {
      ...officeUser,
      id: "user-engineer-1",
      email: "office.owner@example.com",
      displayName: "Office Owner",
      role: "Engineer",
    };
    const engineerSession: AuthenticatedSession = {
      ...officeSession,
      user: engineerUser,
    };
    const { client, signIn } = createAuthClient({
      signIn: () => Promise.resolve({ outcome: "authenticated", session: engineerSession }),
    });
    const user = userEvent.setup();

    renderProvider(client);
    await screen.findByText("anonymous");

    await user.click(screen.getByRole("button", { name: "Sign in through context" }));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith({
        email: "office.owner@example.com",
        password: "unchanged-password",
      });
    });
    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent(engineerUser.email);
  });

  it("holds an MFA challenge without exposing a user, then completes authentication", async () => {
    const { client, verifyMfa } = createAuthClient({
      signIn: () =>
        Promise.resolve({
          outcome: "mfa_required",
          challenge: {
            id: "challenge-1",
            expiresAt: "2026-07-29T09:05:00.000Z",
            methods: ["totp", "recovery_code"],
          },
        }),
    });
    const user = userEvent.setup();

    renderProvider(client);
    await screen.findByText("anonymous");
    await user.click(screen.getByRole("button", { name: "Sign in through context" }));

    expect(await screen.findByText("mfa_required")).toBeInTheDocument();
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent("none");
    expect(screen.getByLabelText("MFA challenge")).toHaveTextContent("challenge-1");

    await user.click(screen.getByRole("button", { name: "Verify MFA through context" }));

    await waitFor(() => {
      expect(verifyMfa).toHaveBeenCalledWith({
        challengeId: "challenge-1",
        code: "123456",
      });
    });
    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("MFA challenge")).toHaveTextContent("none");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent(officeUser.email);
  });

  it("can abandon an MFA challenge", async () => {
    const { client } = createAuthClient({
      signIn: () =>
        Promise.resolve({
          outcome: "mfa_required",
          challenge: {
            id: "challenge-1",
            expiresAt: "2026-07-29T09:05:00.000Z",
            methods: ["totp"],
          },
        }),
    });
    const user = userEvent.setup();

    renderProvider(client);
    await screen.findByText("anonymous");
    await user.click(screen.getByRole("button", { name: "Sign in through context" }));
    await screen.findByText("mfa_required");
    await user.click(screen.getByRole("button", { name: "Cancel MFA through context" }));

    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("anonymous");
    expect(screen.getByLabelText("MFA challenge")).toHaveTextContent("none");
  });

  it("does not let an MFA-cancel action discard an authenticated session", async () => {
    const { client } = createAuthClient({
      getSession: () => Promise.resolve(officeSession),
    });
    const user = userEvent.setup();

    renderProvider(client);
    await screen.findByText("authenticated");
    await user.click(screen.getByRole("button", { name: "Cancel MFA through context" }));

    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent(officeUser.email);
  });

  it("rejects MFA verification when no challenge is active", async () => {
    function VerificationProbe(): ReactElement {
      const { verifyMfa } = useAuth();

      return (
        <button
          type="button"
          onClick={() => {
            void verifyMfa("123456").catch((error: unknown) => {
              const message = error instanceof Error ? error.message : "unknown";
              document.body.dataset["verificationError"] = message;
            });
          }}
        >
          Verify without challenge
        </button>
      );
    }

    const { client, verifyMfa } = createAuthClient();
    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <VerificationProbe />
      </AuthProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Verify without challenge" }));

    await waitFor(() => {
      expect(document.body.dataset["verificationError"]).toBe("No MFA challenge is active.");
    });
    expect(verifyMfa).not.toHaveBeenCalled();
  });

  it("clears the authenticated session after sign-out completes", async () => {
    const { client, signOut } = createAuthClient({
      getSession: () => Promise.resolve(officeSession),
    });
    const user = userEvent.setup();

    renderProvider(client);
    await screen.findByText("authenticated");

    await user.click(screen.getByRole("button", { name: "Sign out through context" }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledOnce();
    });
    expect(screen.getByLabelText("Authentication status")).toHaveTextContent("anonymous");
    expect(screen.getByLabelText("Authenticated user")).toHaveTextContent("none");
  });

  it("does not change state when sign-in, verification, or sign-out fails", async () => {
    const { client } = createAuthClient({
      getSession: () => Promise.resolve(officeSession),
      signIn: () => Promise.reject(new Error("Invalid credentials")),
      verifyMfa: () => Promise.reject(new Error("Invalid code")),
      signOut: () => Promise.reject(new Error("Sign-out service unavailable")),
    });

    function RejectionProbe(): ReactElement {
      const { signIn, signOut, status, user } = useAuth();

      return (
        <>
          <output aria-label="Failure status">{status}</output>
          <output aria-label="Failure user">{user?.email ?? "none"}</output>
          <button
            type="button"
            onClick={() => {
              void signIn("new@example.com", "password").catch(() => undefined);
            }}
          >
            Rejected sign in
          </button>
          <button
            type="button"
            onClick={() => {
              void signOut().catch(() => undefined);
            }}
          >
            Rejected sign out
          </button>
        </>
      );
    }

    const user = userEvent.setup();
    render(
      <AuthProvider client={client}>
        <RejectionProbe />
      </AuthProvider>,
    );
    await screen.findByText("authenticated");

    await user.click(screen.getByRole("button", { name: "Rejected sign in" }));
    expect(screen.getByLabelText("Failure status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("Failure user")).toHaveTextContent(officeUser.email);

    await user.click(screen.getByRole("button", { name: "Rejected sign out" }));
    expect(screen.getByLabelText("Failure status")).toHaveTextContent("authenticated");
    expect(screen.getByLabelText("Failure user")).toHaveTextContent(officeUser.email);
  });

  it("aborts an in-flight session lookup when unmounted", async () => {
    let observedSignal: AbortSignal | undefined;
    const { client } = createAuthClient({
      getSession: (signal) => {
        observedSignal = signal;

        return new Promise<AuthenticatedSession | null>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Session lookup aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    });

    const { unmount } = renderProvider(client);

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(false);

    unmount();

    expect(observedSignal?.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
  });
});

describe("useAuth", () => {
  it("throws a clear error outside an AuthProvider", () => {
    expect(() => render(<AuthProbe />)).toThrow("useAuth must be used within an AuthProvider.");
  });
});
