import { useCallback, useEffect, useState } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { TipProvider } from "@/components/Tip";
import { Titlebar } from "./Titlebar";
import { Sidebar, type PageId } from "./Sidebar";

import { Overview }    from "@/pages/Overview";
import { SetupView }   from "@/pages/SetupView";
import { Automation }  from "@/pages/Automation";
import { GrowCycle }   from "@/pages/GrowCycle";
import { Journal }     from "@/pages/Journal";
import { Maintenance } from "@/pages/Maintenance";
import { Logging }     from "@/pages/Logging";
import { Settings }    from "@/pages/Settings";
import { Targets }     from "@/pages/Targets";
import { NavigationContext, type Navigate } from "./navigation";

const PAGES: Record<PageId, React.ComponentType> = {
  overview:     Overview,
  setup:        SetupView,
  automation:   Automation,
  targets:      Targets,
  "grow-cycle": GrowCycle,
  journal:      Journal,
  maintenance:  Maintenance,
  logging:      Logging,
  settings:     Settings,
};

/** How long to wait for a focus target to render: its page may still be loading. */
const FOCUS_WAIT_MS = 3000;

/**
 * Scrolls the element marked `data-search-id={id}` into view and flashes it,
 * once it exists. If it sits in a closed section (`data-collapsed`), the
 * section is sent a `reveal` event first. Polled per frame rather than observed: the target appears
 * whenever its page's query resolves, and this runs once per navigation.
 */
function useFocusTarget(id: string | null, onDone: () => void) {
  useEffect(() => {
    if (!id) return;
    const until = performance.now() + FOCUS_WAIT_MS;
    let frame = 0;
    let flash: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-search-id="${CSS.escape(id)}"]`);
      // Inside a closed section: ask it to open, and look again next frame.
      const collapsed = el?.closest("[data-collapsed]");
      if (collapsed && performance.now() < until) {
        collapsed.dispatchEvent(new Event("reveal"));
        frame = requestAnimationFrame(look);
      } else if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("search-flash");
        flash = setTimeout(() => { el.classList.remove("search-flash"); onDone(); }, 1600);
      } else if (performance.now() < until) {
        frame = requestAnimationFrame(look);
      } else {
        onDone();
      }
    };
    frame = requestAnimationFrame(look);
    return () => { cancelAnimationFrame(frame); clearTimeout(flash); };
  }, [id, onDone]);
}

export function Shell() {
  const [page, setPage] = useState<PageId>("overview");
  const [focus, setFocus] = useState<string | null>(null);
  const Page = PAGES[page];

  const navigate: Navigate = useCallback((to, focusId) => {
    setPage(to);
    setFocus(focusId ?? null);
  }, []);
  const clearFocus = useCallback(() => setFocus(null), []);
  useFocusTarget(focus, clearFocus);

  return (
    <ThemeProvider>
      <TipProvider>
        <NavigationContext.Provider value={navigate}>
          <div className="app">
            <Titlebar />
            <div className="body">
              <Sidebar active={page} onNavigate={navigate} />
              <div className="main">
                <Page />
              </div>
            </div>
          </div>
        </NavigationContext.Provider>
      </TipProvider>
    </ThemeProvider>
  );
}
