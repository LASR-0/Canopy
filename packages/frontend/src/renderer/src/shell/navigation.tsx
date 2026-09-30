import { createContext, useContext, useEffect } from "react";
import type { PageId } from "./Sidebar";

/**
 * Lets a page send the user to another page.
 *
 * Navigation is plain state in the Shell. Pages had no way to reach it, so every
 * cross-page link in the prototype ("Open Automation", "Configure thresholds")
 * was either dropped or became a dialog on the wrong page. A context rather
 * than a router: there are nine pages and no URLs.
 */
export interface NavOptions {
  /**
   * An element on the page to bring into view once it renders: the one marked
   * `data-search-id={focusId}`. Search uses it to land on a device,
   * automation, task or journal entry rather than the top of its page.
   */
  focusId?: string | undefined;
  /** A tab to open on the page, for pages that read it with `useTabRequest`. */
  tab?: string | undefined;
}

export type Navigate = (page: PageId, options?: NavOptions) => void;

export const NavigationContext = createContext<Navigate>(() => {});

export function useNavigate(): Navigate {
  return useContext(NavigationContext);
}

/**
 * The latest tab asked for. A new object per request, so asking for the tab
 * already asked for still re-applies it after the user has moved away.
 */
export interface TabRequest {
  page: PageId;
  tab: string;
}

export const TabRequestContext = createContext<TabRequest | null>(null);

/** Calls `onTab` when another page navigates here asking for a tab. */
export function useTabRequest(page: PageId, onTab: (tab: string) => void): void {
  const request = useContext(TabRequestContext);
  useEffect(() => {
    if (request && request.page === page) onTab(request.tab);
    // Only a new request should switch the tab; onTab is a fresh closure each render.
  }, [request, page]);
}
