import { Icon } from "@/components/Icon";

const isMac = window.canopyWindow.platform === "darwin";

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

      <div className="cmdk">
        <Icon name="search" size={13} />
        <span style={{ flex: 1 }}>Search…</span>
        <kbd className="kbd">⌘K</kbd>
      </div>

      <div className="tb-spacer" />

      <button className="tb-icon-btn"><Icon name="bell" size={15} /></button>
      <button className="tb-icon-btn"><Icon name="refresh" size={15} /></button>
      <div className="tb-avatar">L</div>

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
