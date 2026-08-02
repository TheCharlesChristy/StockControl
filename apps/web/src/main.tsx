import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationErrorBoundary } from "./app/ErrorBoundaries";

/*
 * Keep the application import behind a boundary. A missing dependency or a
 * stale generated package must produce a useful recovery screen, not an empty
 * root element with no explanation.
 */
const App = lazy(async () => ({
  default: (await import("./app/App")).App,
}));

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (rootElement === null) {
  throw new Error("StockControl root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ApplicationErrorBoundary>
      <Suspense
        fallback={
          <main id="main-content" role="status" aria-live="polite">
            Starting StockControl…
          </main>
        }
      >
        <App />
      </Suspense>
    </ApplicationErrorBoundary>
  </StrictMode>,
);
