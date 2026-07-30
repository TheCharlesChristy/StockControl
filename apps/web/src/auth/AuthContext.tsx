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
  MfaChallenge,
  SignInResult,
} from "./auth-types";

export type {
  AuthClient,
  AuthenticatedSession,
  AuthenticatedUser,
  MfaChallenge,
  UserRole,
} from "./auth-types";

type AuthenticationStatus = "checking" | "anonymous" | "mfa_required" | "authenticated";

interface AuthContextValue {
  readonly status: AuthenticationStatus;
  readonly session: AuthenticatedSession | null;
  readonly user: AuthenticatedUser | null;
  readonly mfaChallenge: MfaChallenge | null;
  readonly signIn: (email: string, password: string) => Promise<SignInResult["outcome"]>;
  readonly verifyMfa: (code: string) => Promise<void>;
  readonly cancelMfa: () => void;
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
  readonly mfaChallenge: MfaChallenge | null;
}

const checkingState: AuthenticationState = {
  status: "checking",
  session: null,
  mfaChallenge: null,
};

const anonymousState: AuthenticationState = {
  status: "anonymous",
  session: null,
  mfaChallenge: null,
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
      .then((session) => {
        setState(
          session === null
            ? anonymousState
            : {
                status: "authenticated",
                session,
                mfaChallenge: null,
              },
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
    async (email: string, password: string): Promise<SignInResult["outcome"]> => {
      const result = await client.signIn({
        email: email.trim().toLowerCase(),
        password,
      });

      setState(
        result.outcome === "authenticated"
          ? {
              status: "authenticated",
              session: result.session,
              mfaChallenge: null,
            }
          : {
              status: "mfa_required",
              session: null,
              mfaChallenge: result.challenge,
            },
      );

      return result.outcome;
    },
    [client],
  );

  const verifyMfa = useCallback(
    async (code: string): Promise<void> => {
      if (state.mfaChallenge === null) {
        throw new Error("No MFA challenge is active.");
      }

      const result = await client.verifyMfa({
        challengeId: state.mfaChallenge.id,
        code,
      });

      setState({
        status: "authenticated",
        session: result.session,
        mfaChallenge: null,
      });
    },
    [client, state.mfaChallenge],
  );

  const cancelMfa = useCallback((): void => {
    setState((currentState) =>
      currentState.status === "mfa_required" ? anonymousState : currentState,
    );
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await client.signOut();
    setState(anonymousState);
  }, [client]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      session: state.session,
      user: state.session?.user ?? null,
      mfaChallenge: state.mfaChallenge,
      signIn,
      verifyMfa,
      cancelMfa,
      signOut,
    }),
    [cancelMfa, signIn, signOut, state, verifyMfa],
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
