import { useState } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
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

const PAGES: Record<PageId, React.ComponentType> = {
  overview:     Overview,
  setup:        SetupView,
  automation:   Automation,
  "grow-cycle": GrowCycle,
  journal:      Journal,
  maintenance:  Maintenance,
  logging:      Logging,
  settings:     Settings,
};

export function Shell() {
  const [page, setPage] = useState<PageId>("overview");
  const Page = PAGES[page];

  return (
    <ThemeProvider>
      <div className="app">
        <Titlebar />
        <div className="body">
          <Sidebar active={page} onNavigate={setPage} />
          <div className="main">
            <Page />
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}
