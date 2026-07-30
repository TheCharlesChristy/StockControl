import { CssBaseline, ThemeProvider } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext";
import type { AuthClient } from "../auth/auth-types";
import { stockControlTheme } from "../theme";
import { AppRoutes } from "./AppRoutes";
import { ApplicationErrorBoundary } from "./ErrorBoundaries";

interface StockControlProvidersProps {
  readonly authClient?: AuthClient | undefined;
  readonly children: ReactNode;
}

export function StockControlProviders({
  authClient,
  children,
}: StockControlProvidersProps): ReactElement {
  return (
    <ThemeProvider theme={stockControlTheme}>
      <CssBaseline />
      <AuthProvider client={authClient}>{children}</AuthProvider>
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
