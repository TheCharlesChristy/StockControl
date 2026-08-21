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
 * Printing an item page shows only its dedicated label block.
 */
const printStyles = (
  <GlobalStyles
    styles={{
      "@media print": {
        "header, nav, .no-print, .MuiAppBar-root, .MuiDrawer-root": { display: "none !important" },
        "body *": { visibility: "hidden !important" },
        ".print-label, .print-label *": { visibility: "visible !important" },
        main: { paddingTop: "0 !important", marginLeft: "0 !important" },
        ".print-only": { display: "block !important" },
        "main > div": {
          maxWidth: "none !important",
          padding: "0 !important",
        },
        ".print-label": {
          border: "none !important",
          boxShadow: "none !important",
          position: "absolute",
          top: "5mm",
          left: "50%",
          transform: "translateX(-50%)",
          margin: "0 !important",
          padding: "1.5mm !important",
          width: "48mm !important",
          maxWidth: "48mm !important",
          textAlign: "center",
        },
        ".print-label .print-name": {
          margin: 0,
          fontSize: "8pt",
          fontWeight: 600,
          lineHeight: 1.15,
          overflowWrap: "anywhere",
        },
        ".print-label .print-reference": {
          margin: "1mm 0 1.5mm",
          fontSize: "7pt",
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: "0.06em",
        },
        ".print-label .print-qr": {
          width: "44mm",
          maxWidth: "44mm",
          margin: "0 auto",
        },
        ".print-label .print-barcode": {
          width: "44mm",
          maxWidth: "44mm",
          margin: "1mm auto 0",
        },
        ".print-label .print-barcode svg": {
          height: "auto !important",
          display: "block",
        },
        body: { backgroundImage: "none !important" },
        "@page": { margin: "5mm" },
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
