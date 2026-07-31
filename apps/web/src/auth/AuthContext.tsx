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
import type { AuthClient, AuthenticatedSession, AuthenticatedUser } from "./auth-types";

export type { AuthClient, AuthenticatedSession, AuthenticatedUser, UserRole } from "./auth-types";

type AuthenticationStatus = "checking" | "anonymous" | "authenticated";

interface AuthContextValue {
  readonly status: AuthenticationStatus;
  readonly session: AuthenticatedSession | null;
  readonly user: AuthenticatedUser | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
}

interface AuthProviderProps {
  readonly client?: AuthClient | undefined;
  readonly children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthenticationState {
  readonly status: AuthenticationStatus;
  readonly session: AuthenticatedSession | null;
}

const checkingState: AuthenticationState = { status: "checking", session: null };
const anonymousState: AuthenticationState = { status: "anonymous", session: null };

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
      .then((session) => {
        setState(session === null ? anonymousState : { status: "authenticated", session });
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
      const session = await client.signIn({
        email: email.trim().toLowerCase(),
        password,
      });

      setState({ status: "authenticated", session });
    },
    [client],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await client.signOut();
    setState(anonymousState);
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      session: state.session,
      user: state.session?.user ?? null,
      signIn,
      signOut,
    }),
    [signIn, signOut, state],
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
