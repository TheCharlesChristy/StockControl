import { Suspense, lazy, type ReactElement } from "react";
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
import { RequestsPage } from "../pages/RequestsPage";
import { ProfilePage } from "../pages/ProfilePage";
import { SignInPage } from "../pages/SignInPage";
import { TransactionsPage } from "../pages/TransactionsPage";
import { UserDetailPage } from "../pages/UserDetailPage";
import { UsersPage } from "../pages/UsersPage";
import { RouteErrorBoundary } from "./ErrorBoundaries";
import { RouteTransitionManager } from "./RouteTransitionManager";

/*
 * The map editor and its twenty icon modules are worth their own chunk: no other
 * screen needs them, and most sessions never open this one.
 */
const LocationsPage = lazy(async () => ({
  default: (await import("../pages/LocationsPage")).LocationsPage,
}));

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
            {/*
             * The inventory *list* is an Office and Admin section, but an item's
             * own page is not: it is where a QR code lands, and every role needs
             * it. Only routes with a navigation entry are role-guarded.
             */}
            <Route
              path="/inventory"
              element={
                <Guarded path="/inventory">
                  <InventoryPage />
                </Guarded>
              }
            />
            <Route path="/inventory/:itemId" element={<ItemDetailPage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/jobs/:jobId" element={<JobDetailPage />} />
            <Route
              path="/requests"
              element={
                <Guarded path="/requests">
                  <RequestsPage />
                </Guarded>
              }
            />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route
              path="/locations"
              element={
                <Suspense fallback={<LoadingPage />}>
                  <LocationsPage />
                </Suspense>
              }
            />
            <Route
              path="/team"
              element={
                <Guarded path="/team">
                  <UsersPage />
                </Guarded>
              }
            />
            <Route
              path="/team/:userId"
              element={
                <Guarded path="/team">
                  <UserDetailPage />
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
