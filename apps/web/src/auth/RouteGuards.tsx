import type { ReactElement, ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { FullPageLoading } from "../components/RouteStates";
import { useAuth } from "./AuthContext";

interface SignedOutOnlyProps {
  readonly children: ReactNode;
}

export function RequireAuthentication(): ReactElement {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <FullPageLoading />;
  }

  if (status !== "authenticated") {
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return <Outlet />;
}

export function SignedOutOnly({ children }: SignedOutOnlyProps): ReactElement {
  const { status } = useAuth();

  if (status === "checking") {
    return <FullPageLoading />;
  }

  if (status === "authenticated") {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
