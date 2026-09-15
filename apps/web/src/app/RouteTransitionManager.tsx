import { useEffect, useRef, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { CHANGE_PASSWORD_PATH } from "../auth/RouteGuards";
import { navigationItems } from "../navigation";

const fixedRouteTitles: Readonly<Record<string, string>> = {
  "/sign-in": "Sign in",
  "/loading": "Loading",
  "/error": "Error",
  "/profile": "Profile",
  [CHANGE_PASSWORD_PATH]: "Change password",
};

/*
 * A record route (e.g. /jobs/:jobId) has no nav entry of its own, so it
 * falls back to the section that opens it rather than reading "Page not
 * found" for every item, job and person the app actually knows about.
 */
const detailRouteSections: ReadonlyArray<readonly [prefix: string, title: string]> = [
  ["/inventory/", "Inventory"],
  ["/jobs/", "Jobs"],
  ["/team/", "Team & access"],
];

function titleForPath(pathname: string): string {
  const navigationItem = navigationItems.find((item) => item.path === pathname);

  if (navigationItem !== undefined) {
    return navigationItem.label;
  }

  const fixedTitle = fixedRouteTitles[pathname];

  if (fixedTitle !== undefined) {
    return fixedTitle;
  }

  const detailSection = detailRouteSections.find(([prefix]) => pathname.startsWith(prefix));

  return detailSection?.[1] ?? "Page not found";
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
