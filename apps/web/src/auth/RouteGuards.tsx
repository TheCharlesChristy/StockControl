import type { ReactElement, ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { FullPageLoading } from "../components/RouteStates";
import { getRedirectPath, signInPathFor } from "../pages/SignInPage";
import { useAuth } from "./AuthContext";

interface SignedOutOnlyProps {
  readonly children: ReactNode;
}

export const CHANGE_PASSWORD_PATH = "/change-password";

export function RequireAuthentication(): ReactElement {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <FullPageLoading />;
  }

  if (status !== "authenticated") {
    return (
      <Navigate
        to={signInPathFor(`${location.pathname}${location.search}${location.hash}`)}
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  /*
   * An account whose password was chosen by somebody else goes nowhere until it
   * has one of its own. This is a convenience, not the control: the server does
   * not let the browser decide anything, and a user who skipped this screen
   * would simply be using a password their Admin also knows.
   */
  if (user?.mustChangePassword === true && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  }

  return <Outlet />;
}

export function SignedOutOnly({ children }: SignedOutOnlyProps): ReactElement {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <FullPageLoading />;
  }

  /*
   * The same destination the sign-in page itself picks. Signing in flips the
   * status here at the moment the page runs its own redirect, so if this sent
   * everyone to the dashboard the two would race — and a visitor who arrived
   * from a scanned QR code would be bounced off the item they asked for,
   * intermittently, depending on which navigation landed last.
   */
  if (status === "authenticated") {
    return <Navigate to={getRedirectPath(location.state, location.search)} replace />;
  }

  return <>{children}</>;
}
