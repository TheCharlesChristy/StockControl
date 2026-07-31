import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import { RequireAuthentication, SignedOutOnly } from "../auth/RouteGuards";
import { AccessDeniedPage, ErrorPage, LoadingPage, NotFoundPage } from "../components/RouteStates";
import { AppShell } from "../layout/AppShell";
import { canAccessNavigationItem, navigationItems } from "../navigation";
import { DashboardPage } from "../pages/DashboardPage";
import { InventoryPage } from "../pages/InventoryPage";
import { ItemDetailPage } from "../pages/ItemDetailPage";
import { JobDetailPage } from "../pages/JobDetailPage";
import { JobsPage } from "../pages/JobsPage";
import { SignInPage } from "../pages/SignInPage";
import { TransactionsPage } from "../pages/TransactionsPage";
import { UsersPage } from "../pages/UsersPage";
import { RouteErrorBoundary } from "./ErrorBoundaries";
import { RouteTransitionManager } from "./RouteTransitionManager";

interface GuardedProps {
  readonly path: string;
  readonly children: ReactElement;
}

/**
 * Keeps a route's visibility and its navigation entry in step. The server
 * checks the same rule again on every request it serves.
 */
function Guarded({ path, children }: GuardedProps): ReactElement | null {
  const { user } = useAuth();
  const item = navigationItems.find((candidate) => candidate.path === path);

  if (user === null) {
    return null;
  }

  if (item !== undefined && !canAccessNavigationItem(user, item)) {
    return <AccessDeniedPage />;
  }

  return children;
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
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/:itemId" element={<ItemDetailPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:jobId" element={<JobDetailPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route
              path="/team"
              element={
                <Guarded path="/team">
                  <UsersPage />
                </Guarded>
              }
            />
            <Route path="/loading" element={<LoadingPage />} />
            <Route path="/error" element={<ErrorPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </RouteErrorBoundary>
  );
}
