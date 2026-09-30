import { useMemo, useRef, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { api, BACKEND_URL } from "@/lib/http";
import { METRIC_META, formatMetricValue, unitLabel } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import type { Metric, ReadingResolution, ReadingSeries } from "@canopy/shared-types";
import { ChartPanel, download, nightSpans, stats, svgToImage, toPoints, type RangeKey } from "./chart";

const DAY = 86_400_000;

type WindowKey = "24h" | "7d" | "30d" | "grow" | "custom";

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "grow", label: "This grow" },
  { key: "custom", label: "Custom" },
];

const RESOLUTIONS: { key: ReadingResolution; label: string; hint: string }[] = [
  { key: "raw", label: "Raw", hint: "every reading" },
  { key: "hourly", label: "Hourly", hint: "average, min and max per hour" },
  { key: "daily", label: "Daily", hint: "average, min and max per day" },
];

/** The chart's tick spacing is chosen per range; a custom window borrows the nearest. */
function rangeFor(span: number): RangeKey {
  return span <= 8 * 3_600_000 ? "6H" : span <= 2 * DAY ? "24H" : span <= 10 * DAY ? "7D" : "30D";
}

const toDateInput = (t: number) => new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const fmtDay = (t: number) => new Date(t).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

interface StatRow { metric: Metric; unit: string; avg?: number; min?: number; max?: number }

/**
 * Draw the report sheet: a title, the window, a card per metric with its
 * average, min and max, then the chart. Canvas rather than a screenshot, so
 * the sheet is the same whatever the window size, and its colours are the
 * theme's own, read from the page.
 */
async function composeReport(svg: SVGSVGElement, title: string, subtitle: string, rows: StatRow[]): Promise<Blob | null> {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const bg = getComputedStyle(document.body).backgroundColor || "#0d1117";
  const fg = color("--fg-default", "#e6edf3");
  const muted = color("--fg-muted", "#848d97");
  const border = color("--border-default", "#30363d");
  const card = color("--canvas-subtle", "#161b22");
  const sans = getComputedStyle(document.body).fontFamily;

  const { image, width: chartW, height: chartH } = await svgToImage(svg);
  const PAD = 24;
  const CARD_W = 190;
  const CARD_H = 70;
  const GAP = 10;
  const W = Math.max(chartW + PAD * 2, 640);
  const perRow = Math.max(1, Math.floor((W - PAD * 2 + GAP) / (CARD_W + GAP)));
  const cardRows = Math.ceil(rows.length / perRow);
  const headerH = 64;
  const cardsH = cardRows * (CARD_H + GAP);
  const H = PAD + headerH + cardsH + GAP + chartH + PAD;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = fg;
  ctx.font = `600 20px ${sans}`;
  ctx.fillText(title, PAD, PAD + 20);
  ctx.fillStyle = muted;
  ctx.font = `13px ${sans}`;
  ctx.fillText(subtitle, PAD, PAD + 44);

  rows.forEach((row, i) => {
    const x = PAD + (i % perRow) * (CARD_W + GAP);
    const y = PAD + headerH + Math.floor(i / perRow) * (CARD_H + GAP);
    ctx.fillStyle = card;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, CARD_W - 1, CARD_H - 1, 7);
    ctx.fill();
    ctx.stroke();

    const meta = METRIC_META[row.metric];
    ctx.fillStyle = meta.color;
    ctx.fillRect(x + 12, y + 14, 10, 3);
    ctx.fillStyle = fg;
    ctx.font = `600 12px ${sans}`;
    ctx.fillText(`${meta.label}${row.unit ? ` (${row.unit})` : ""}`, x + 28, y + 19);

    const cells: [string, number | undefined][] = [["avg", row.avg], ["min", row.min], ["max", row.max]];
    cells.forEach(([k, v], j) => {
      const cx = x + 12 + j * ((CARD_W - 24) / 3);
      ctx.fillStyle = muted;
      ctx.font = `10px ${sans}`;
      ctx.fillText(k.toUpperCase(), cx, y + 40);
      ctx.fillStyle = fg;
      ctx.font = `600 14px ${sans}`;
      ctx.fillText(v != null ? formatMetricValue(v, row.metric) : "—", cx, y + 58);
    });
  });

  ctx.drawImage(image, PAD, PAD + headerH + cardsH + GAP, chartW, chartH);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * The report generator: pick a window, metrics and a resolution, then export
 * the selection as CSV (every reading, or hourly or daily rollups) or as a PNG
 * report sheet.
 */
export function ReportModal({
  open, onClose, workspaceId, workspaceName, growName, growStartedAt, available, initialMetrics,
  targets, photoperiod, rawRetentionDays,
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  growName?: string | undefined;
  growStartedAt?: string | undefined;
  available: Metric[];
  initialMetrics: Metric[];
  targets: Map<Metric, [number, number]>;
  photoperiod?: { on: string; off: string } | undefined;
  rawRetentionDays: number;
}) {
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [customFrom, setCustomFrom] = useState(() => toDateInput(Date.now() - 7 * DAY));
  const [customTo, setCustomTo] = useState(() => toDateInput(Date.now()));
  const [metrics, setMetrics] = useState<ReadonlySet<Metric>>(() => new Set(initialMetrics));
  const [resolution, setResolution] = useState<ReadingResolution>("hourly");
  const [format, setFormat] = useState<"csv" | "png">("png");
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState({ night: true, targets: true, oor: true });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const today = toDateInput(Date.now());
  const bounds = useMemo(() => {
    const now = Date.now();
    switch (windowKey) {
      case "24h": return { from: now - DAY, to: now };
      case "7d": return { from: now - 7 * DAY, to: now };
      case "30d": return { from: now - 30 * DAY, to: now };
      case "grow": return { from: growStartedAt ? Date.parse(growStartedAt) : now - 7 * DAY, to: now };
      case "custom": {
        const from = new Date(`${customFrom}T00:00:00`).getTime();
        // The end date is inclusive, and never past now.
        const to = Math.min(new Date(`${customTo}T00:00:00`).getTime() + DAY - 1, now);
        return { from: Math.min(from, to), to };
      }
    }
  }, [windowKey, customFrom, customTo, growStartedAt]);

  const rawFrom = Date.now() - rawRetentionDays * DAY;
  const rawPartial = bounds.from < rawFrom;
  const chosen = available.filter((m) => metrics.has(m));
  const span = bounds.to - bounds.from;

  const results = useQueries({
    queries: open && format === "png" ? chosen.map((metric) => ({
      queryKey: ["series", workspaceId, metric, "report", bounds.from, bounds.to, resolution],
      queryFn: () =>
        api("POST /readings/series", {
          body: {
            workspaceId,
            metric,
            from: new Date(bounds.from).toISOString(),
            to: new Date(bounds.to).toISOString(),
            resolution,
          },
        }),
      staleTime: 60_000,
    })) : [],
  });
  const seriesByMetric = new Map<Metric, ReadingSeries>();
  chosen.forEach((m, i) => { const d = results[i]?.data; if (d) seriesByMetric.set(m, d); });
  const seriesFor = (m: Metric) => seriesByMetric.get(m);
  const loading = results.some((r) => r.isFetching);

  const statRows: StatRow[] = chosen.map((metric) => {
    const summary = stats(toPoints(seriesFor(metric)));
    const unit = unitLabel(seriesFor(metric)?.unit ?? "");
    // "pH (pH)" and "Lux (lux)" say nothing twice.
    const named = unit.toLowerCase() === METRIC_META[metric].label.toLowerCase();
    return { metric, unit: named ? "" : unit, ...(summary ?? {}) };
  });
  const night = photoperiod ? nightSpans(photoperiod.on, photoperiod.off, bounds.from, bounds.to) : [];

  const windowText = `${fmtDay(bounds.from)} – ${fmtDay(bounds.to)}`;
  const title = `${workspaceName}${growName ? ` · ${growName}` : ""}`;
  const stamp = `${toDateInput(bounds.from)}_${toDateInput(bounds.to)}`;

  const toggleMetric = (m: Metric) =>
    setMetrics((prev) => {
      const next = new Set(prev);
      if (!next.delete(m)) next.add(m);
      return next;
    });

  const exportIt = async () => {
    if (chosen.length === 0) return;
    if (format === "csv") {
      // A native download: Electron streams it to disk, where a large raw
      // export held in the renderer as a blob could run to hundreds of MB.
      const query = new URLSearchParams({
        from: new Date(bounds.from).toISOString(),
        to: new Date(bounds.to).toISOString(),
        metrics: chosen.join(","),
        resolution,
      });
      const link = document.createElement("a");
      link.href = `${BACKEND_URL}/workspaces/${workspaceId}/readings/export?${query}`;
      link.click();
      return;
    }
    if (!svgRef.current) return;
    setBusy(true);
    try {
      const blob = await composeReport(svgRef.current, title, `${windowText} · ${resolution} · generated ${fmtDay(Date.now())}`, statRows);
      if (blob) download(`canopy-report-${stamp}.png`, blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report"
      icon="logging"
      className="report-modal"
      footer={
        <>
          <span className="rp-note">
            {format === "csv"
              ? "One row per reading: timestamp, metric, unit, value, device, channel."
              : `${chosen.length} metric${chosen.length === 1 ? "" : "s"} · ${windowText}`}
          </span>
          <span className="spacer" />
          <button className="btn sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" onClick={() => void exportIt()} disabled={chosen.length === 0 || busy || (format === "png" && loading)}>
            <Icon name={format === "csv" ? "external" : "camera"} size={13} />
            {busy ? "Exporting…" : format === "csv" ? "Export CSV" : "Export PNG"}
          </button>
        </>
      }
    >
      <div className="rp">
        <div className="rp-field">
          <span className="rp-label">Window</span>
          <div className="rp-choices">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                className={cn("copt", windowKey === w.key && "on")}
                disabled={w.key === "grow" && !growStartedAt}
                onClick={() => setWindowKey(w.key)}
              >
                {w.label}
              </button>
            ))}
          </div>
          {windowKey === "custom" && (
            <div className="rp-dates">
              <input type="date" className="au-num rp-date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From" />
              <span className="au-inline-label">to</span>
              <input type="date" className="au-num rp-date" value={customTo} min={customFrom} max={today} onChange={(e) => setCustomTo(e.target.value)} aria-label="To" />
            </div>
          )}
        </div>

        <div className="rp-field">
          <span className="rp-label">Metrics</span>
          <div className="rp-choices">
            {available.map((m) => (
              <button key={m} className={cn("copt", metrics.has(m) && "on")} onClick={() => toggleMetric(m)}>
                <span className="swatch-sq" style={{ background: METRIC_META[m].color }} /> {METRIC_META[m].label}
              </button>
            ))}
          </div>
        </div>

        <div className="rp-field">
          <span className="rp-label">Resolution</span>
          <div className="rp-choices">
            {RESOLUTIONS.map((r) => (
              <button key={r.key} className={cn("copt", resolution === r.key && "on")} onClick={() => setResolution(r.key)}>
                {r.label} <span className="lt-n">{r.hint}</span>
              </button>
            ))}
          </div>
          {resolution === "raw" && rawPartial && (
            <p className="rp-warn">
              Raw readings are kept {rawRetentionDays} days (Settings → Data &amp; Storage), so this window has none before {fmtDay(rawFrom)}.
              Hourly or daily covers all of it.
            </p>
          )}
          {resolution === "raw" && format === "png" && span > 8 * 3_600_000 && (
            <p className="rp-note">The chart draws windows longer than 6 hours from the hourly rollups; the CSV has every reading.</p>
          )}
        </div>

        <div className="rp-field">
          <span className="rp-label">Format</span>
          <div className="rp-choices">
            <button className={cn("copt", format === "png" && "on")} onClick={() => setFormat("png")}>
              <Icon name="camera" size={12} /> PNG report
            </button>
            <button className={cn("copt", format === "csv" && "on")} onClick={() => setFormat("csv")}>
              <Icon name="external" size={12} /> CSV data
            </button>
          </div>
        </div>

        {format === "png" && chosen.length > 0 && (
          <div className="rp-preview" style={{ opacity: loading ? 0.6 : 1 }}>
            <div className="rp-title">{title}</div>
            <div className="rp-sub">{windowText} · {resolution}</div>
            <div className="stat-strip">
              {statRows.map((row) => (
                <div className="stat-card" key={row.metric}>
                  <div className="sc-top">
                    <span className="sc-sw" style={{ background: METRIC_META[row.metric].color }} />
                    <span className="sc-name">{METRIC_META[row.metric].label}</span>
                    {row.unit && <span className="sc-unit">{row.unit}</span>}
                  </div>
                  <div className="sc-stats">
                    {(["avg", "min", "max"] as const).map((k) => (
                      <div className="sc-stat" key={k}>
                        <span className="sc-k">{k}</span>
                        <span className="sc-v">{row[k] != null ? formatMetricValue(row[k]!, row.metric) : "—"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <ChartPanel
              metrics={chosen}
              seriesFor={seriesFor}
              mode="overlay"
              range={rangeFor(span)}
              from={bounds.from}
              to={bounds.to}
              latest={new Map()}
              opts={opts}
              night={night}
              targets={targets}
              events={[]}
              eventGroups={new Set()}
              onToggleEventGroup={() => {}}
              onToggleOpt={(key) => setOpts((p) => ({ ...p, [key]: !p[key] }))}
              svgRef={svgRef}
              markerToggles={false}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
