import { useEffect, useRef, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { navigationItems } from "../navigation";

const fixedRouteTitles: Readonly<Record<string, string>> = {
  "/sign-in": "Sign in",
  "/loading": "Loading",
  "/error": "Error",
};

function titleForPath(pathname: string): string {
  const navigationItem = navigationItems.find((item) => item.path === pathname);

  if (navigationItem !== undefined) {
    return navigationItem.label;
  }

  return fixedRouteTitles[pathname] ?? "Page not found";
}

export function RouteTransitionManager(): ReactElement | null {
  const { pathname } = useLocation();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    document.title = `${titleForPath(pathname)} · StockControl`;

    if (previousPathname.current !== null && previousPathname.current !== pathname) {
      document.querySelector<HTMLElement>("#main-content, main")?.focus();
    }

    previousPathname.current = pathname;
  }, [pathname]);

  return null;
}
