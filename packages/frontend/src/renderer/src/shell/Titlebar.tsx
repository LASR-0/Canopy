import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { cn } from "@/lib/utils";
import { SearchPalette } from "./SearchPalette";
import { NotificationBell } from "./NotificationBell";

const isMac = window.canopyWindow.platform === "darwin";

/**
 * Re-fetches what is on screen: the queries mounted now, which are the current
 * page's and the shell's. The icon spins until they are back, and for at least
 * a moment, so a fast refresh still shows that it happened.
 */
function RefreshButton() {
  const qc = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  const refresh = async () => {
    if (spinning) return;
    setSpinning(true);
    await Promise.all([
      qc.refetchQueries({ type: "active" }),
      new Promise((r) => setTimeout(r, 500)),
    ]);
    setSpinning(false);
  };

  return (
    <Tip content="Refresh this page" side="bottom">
      <button className="tb-icon-btn" onClick={() => void refresh()} aria-label="Refresh this page">
        <span className={cn("tb-refresh", spinning && "spinning")}><Icon name="refresh" size={15} /></span>
      </button>
    </Tip>
  );
}

/** The titlebar's search box opens the palette; so does Ctrl+K (⌘K on a Mac). */
function SearchButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button className="cmdk" onClick={() => setOpen(true)} aria-label="Search" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"}>
        <Icon name="search" size={13} />
        <span style={{ flex: 1, textAlign: "left" }}>Search…</span>
        <kbd className="kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </>
  );
}

export function Titlebar() {
  return (
    <div className="titlebar">
      {isMac ? (
        <div className="traffic">
          <span className="r" />
          <span className="y" />
          <span className="g" />
        </div>
      ) : null}

      <div className="tb-brand">
        <div className="mark">
          <Icon name="leaf" size={13} />
        </div>
        Canopy
      </div>

      <div className="tb-spacer" />

      <SearchButton />

      <div className="tb-spacer" />

      <NotificationBell />
      <RefreshButton />

      {!isMac && (
        <div className="win-controls">
          <button className="win-btn" onClick={() => window.canopyWindow.minimize()} aria-label="Minimise">
            <Icon name="minus" size={12} />
          </button>
          <button className="win-btn" onClick={() => window.canopyWindow.toggleMaximize()} aria-label="Maximise">
            <svg viewBox="0 0 10 10" width={10} height={10} fill="none" stroke="currentColor" strokeWidth={1.2} aria-hidden>
              <rect x="1" y="1" width="8" height="8" rx="1" />
            </svg>
          </button>
          <button className="win-btn close" onClick={() => window.canopyWindow.close()} aria-label="Close">
            <Icon name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
