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
export type Navigate = (page: PageId, focusId?: string) => void;

/**
 * `focusId` names an element on the page to bring into view once it renders:
 * the one marked `data-search-id={focusId}`. Search uses it to land on a
 * device, automation, task or journal entry rather than the top of its page.
 */
export const NavigationContext = createContext<Navigate>(() => {});

export function useNavigate(): Navigate {
  return useContext(NavigationContext);
}
