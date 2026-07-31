import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";

import type { ApiClient } from "../api/ApiClient";
import { ApiProvider } from "../api/ApiContext";
import { AuthProvider } from "../auth/AuthContext";
import type { AuthClient } from "../auth/auth-types";
import { stockControlTheme } from "../theme";
import { AppRoutes } from "./AppRoutes";
import { ApplicationErrorBoundary } from "./ErrorBoundaries";

/**
 * Printing an item page should produce a label, not a screenshot of the app.
 * Everything marked no-print drops away and the label block stands alone.
 */
const printStyles = (
  <GlobalStyles
    styles={{
      "@media print": {
        "header, nav, .no-print, .MuiAppBar-root, .MuiDrawer-root": { display: "none !important" },
        main: { paddingTop: "0 !important", marginLeft: "0 !important" },
        ".print-label": {
          border: "none !important",
          boxShadow: "none !important",
          margin: "0 auto",
          padding: "0 !important",
        },
        body: { backgroundImage: "none !important" },
      },
    }}
  />
);

interface StockControlProvidersProps {
  readonly authClient?: AuthClient | undefined;
  readonly apiClient?: ApiClient | undefined;
  readonly children: ReactNode;
}

export function StockControlProviders({
  authClient,
  apiClient,
  children,
}: StockControlProvidersProps): ReactElement {
  return (
    <ThemeProvider theme={stockControlTheme}>
      <CssBaseline />
      {printStyles}
      <AuthProvider client={authClient}>
        <ApiProvider client={apiClient}>{children}</ApiProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export function App(): ReactElement {
  return (
    <ApplicationErrorBoundary>
      <StockControlProviders>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </StockControlProviders>
    </ApplicationErrorBoundary>
  );
}
