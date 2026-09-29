import { createContext, useContext } from "react";
import type { PageId } from "./Sidebar";

/**
 * Lets a page send the user to another page.
 *
 * Navigation is plain state in the Shell. Pages had no way to reach it, so every
 * cross-page link in the prototype ("Open Automation", "Configure thresholds")
 * was either dropped or became a dialog on the wrong page. A context rather
 * than a router: there are eight pages and no URLs.
 */
export const NavigationContext = createContext<(page: PageId) => void>(() => {});

export function useNavigate(): (page: PageId) => void {
  return useContext(NavigationContext);
}
