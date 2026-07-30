import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactElement } from "react";
import { useAuth } from "../auth/AuthContext";
import { RequireAuthentication, SignedOutOnly } from "../auth/RouteGuards";
import {
  AccessDeniedPage,
  ErrorPage,
  LoadingPage,
  NotFoundPage,
  PlaceholderPage,
} from "../components/RouteStates";
import { AppShell } from "../layout/AppShell";
import { canAccessNavigationItem, navigationItems, type NavigationItem } from "../navigation";
import { DashboardPage } from "../pages/DashboardPage";
import { SignInPage } from "../pages/SignInPage";
import { RouteErrorBoundary } from "./ErrorBoundaries";
import { RouteTransitionManager } from "./RouteTransitionManager";

interface ProtectedSectionProps {
  readonly item: NavigationItem;
}

function ProtectedSection({ item }: ProtectedSectionProps): ReactElement | null {
  const { user } = useAuth();

  if (user === null) {
    return null;
  }

  if (!canAccessNavigationItem(user, item)) {
    return <AccessDeniedPage />;
  }

  return <PlaceholderPage title={item.label} description={item.description} />;
}

export function AppRoutes(): ReactElement {
  return (
    <RouteErrorBoundary>
      <RouteTransitionManager />
      <Routes>
        <Route
          path="/sign-in"
          element={
            <SignedOutOnly>
              <SignInPage />
            </SignedOutOnly>
          }
        />

        <Route element={<RequireAuthentication />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            {navigationItems
              .filter((item) => item.path !== "/dashboard")
              .map((item) => (
                <Route
                  key={item.path}
                  path={item.path}
                  element={<ProtectedSection item={item} />}
                />
              ))}
            <Route path="/loading" element={<LoadingPage />} />
            <Route path="/error" element={<ErrorPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </RouteErrorBoundary>
  );
}
