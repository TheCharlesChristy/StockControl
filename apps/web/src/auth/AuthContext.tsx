import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { createDefaultAuthClient } from "./AuthClient";
import type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  SessionFeatures,
} from "./auth-types";

export type { AuthClient, AuthenticatedSession, AuthenticatedUser, UserRole } from "./auth-types";

type AuthenticationStatus = "checking" | "anonymous" | "authenticated";

const NO_FEATURES: SessionFeatures = { stockCapture: false };

interface AuthContextValue {
  readonly status: AuthenticationStatus;
  readonly session: AuthenticatedSession | null;
  readonly user: AuthenticatedUser | null;
  readonly features: SessionFeatures;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

interface AuthProviderProps {
  readonly client?: AuthClient | undefined;
  readonly children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthenticationState {
  readonly status: AuthenticationStatus;
  readonly session: AuthenticatedSession | null;
  readonly features: SessionFeatures;
}

const checkingState: AuthenticationState = {
  status: "checking",
  session: null,
  features: NO_FEATURES,
};
const anonymousState: AuthenticationState = {
  status: "anonymous",
  session: null,
  features: NO_FEATURES,
};

export function AuthProvider({
  children,
  client: providedClient,
}: AuthProviderProps): ReactElement {
  const client = useMemo(() => providedClient ?? createDefaultAuthClient(), [providedClient]);
  const [state, setState] = useState<AuthenticationState>(checkingState);

  useEffect(() => {
    const controller = new AbortController();

    void client
      .getSession(controller.signal)
      .then((outcome) => {
        setState(
          outcome === null
            ? anonymousState
            : { status: "authenticated", session: outcome.session, features: outcome.features },
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setState(anonymousState);
      });

    return (): void => {
      controller.abort();
    };
  }, [client]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      const outcome = await client.signIn({
        email: email.trim().toLowerCase(),
        password,
      });

      setState({ status: "authenticated", session: outcome.session, features: outcome.features });
    },
    [client],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await client.signOut();
    setState(anonymousState);
  }, [client]);

  const refresh = useCallback(async (): Promise<void> => {
    const outcome = await client.getSession(new AbortController().signal);
    setState(
      outcome === null
        ? anonymousState
        : { status: "authenticated", session: outcome.session, features: outcome.features },
    );
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      session: state.session,
      user: state.session?.user ?? null,
      features: state.features,
      signIn,
      signOut,
      refresh,
    }),
    [refresh, signIn, signOut, state],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);

  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
