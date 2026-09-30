import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useActiveWorkspace } from "@/hooks/useWorkspace";
import { useActiveGrow } from "@/hooks/useActiveGrow";
import { useDevices } from "@/hooks/useDevices";
import { useAutomations } from "@/hooks/useAutomations";
import { useJournal } from "@/hooks/useJournal";
import { useMaintenance } from "@/hooks/useMaintenance";
import { cn } from "@/lib/utils";
import { NAV, type PageId } from "./Sidebar";
import { useNavigate } from "./navigation";

interface Result {
  key: string;
  group: string;
  icon: IconName;
  label: string;
  detail?: string;
  page: PageId;
  focusId?: string;
}

/** Results per group, so one long list cannot push the others out of sight. */
const PER_GROUP = 6;

/**
 * How well `text` matches `q`: 3 at the start, 2 at the start of a word,
 * 1 anywhere, 0 not at all. Plain substring matching, no fuzzy search: the
 * lists are short, and a result that contains what was typed is predictable.
 */
function score(q: string, ...texts: (string | undefined)[]): number {
  let best = 0;
  for (const text of texts) {
    if (!text) continue;
    const t = text.toLowerCase();
    const at = t.indexOf(q);
    if (at < 0) continue;
    const s = at === 0 ? 3 : /[\s\-_/·]/.test(t[at - 1]!) ? 2 : 1;
    if (s > best) best = s;
  }
  return best;
}

/**
 * The titlebar search: pages, devices, automations, maintenance tasks and the
 * active grow's journal entries, in one list. Picking a result opens its page
 * and scrolls to the item (see `useFocusTarget` in the Shell).
 *
 * Mounted only while open, so its queries load on first use rather than at
 * startup. Most will already be cached from visiting the pages.
 */
export function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const workspace = useActiveWorkspace();
  const { data: grow } = useActiveGrow();
  const { data: devices = [] } = useDevices(workspace?.id);
  const { data: automations = [] } = useAutomations(workspace?.id);
  const { data: tasks = [] } = useMaintenance(workspace?.id);
  const { data: entries = [] } = useJournal(workspace?.id, grow?.id);

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    const pages: Result[] = NAV.map((n) => ({
      key: `page:${n.id}`, group: "Pages", icon: n.icon, label: n.label, page: n.id,
    }));
    // Empty, it is a page switcher.
    if (!q) return pages;

    const ranked = <T,>(items: T[], s: (item: T) => number, make: (item: T) => Result) =>
      items
        .map((item) => ({ item, s: s(item) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, PER_GROUP)
        .map((r) => make(r.item));

    return [
      ...ranked(pages, (p) => score(q, p.label), (p) => p),
      ...ranked(devices, (d) => score(q, d.name, d.model, d.address.host, d.address.mqttTopicPrefix), (d) => ({
        key: `device:${d.id}`, group: "Devices", icon: "plug", label: d.name,
        detail: [d.model, d.online ? "online" : "offline"].filter(Boolean).join(" · "),
        page: "settings", focusId: d.id,
      })),
      ...ranked(automations, (a) => score(q, a.name), (a) => ({
        key: `automation:${a.id}`, group: "Automations", icon: "automation", label: a.name,
        detail: a.enabled ? "enabled" : "disabled",
        page: "automation", focusId: a.id,
      })),
      ...ranked(tasks, (t) => score(q, t.name), (t) => ({
        key: `task:${t.id}`, group: "Maintenance", icon: "maintenance", label: t.name,
        page: "maintenance", focusId: t.id,
      })),
      ...ranked(entries, (e) => score(q, e.title, e.body, e.hypothesis, e.result), (e) => ({
        key: `entry:${e.id}`, group: "Journal", icon: "journal", label: e.title,
        detail: `Day ${e.growDay}`,
        page: "journal", focusId: e.id,
      })),
    ];
  }, [query, devices, automations, tasks, entries]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const open = (r: Result | undefined) => {
    if (!r) return;
    navigate(r.page, { focusId: r.focusId });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="sp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sp" role="dialog" aria-modal aria-label="Search">
        <div className="sp-input">
          <Icon name="search" size={15} />
          <input
            autoFocus
            value={query}
            placeholder="Search pages, devices, automations, tasks, journal…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-controls="sp-list"
            aria-activedescendant={results[active] ? `sp-${results[active]!.key}` : undefined}
          />
        </div>
        <div className="sp-list" id="sp-list" role="listbox" ref={listRef}>
          {results.length === 0 && <div className="sp-empty">Nothing matches “{query.trim()}”.</div>}
          {results.map((r, i) => (
            <div key={r.key}>
              {(i === 0 || results[i - 1]!.group !== r.group) && <div className="sp-group">{r.group}</div>}
              <div
                id={`sp-${r.key}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                className={cn("sp-item", i === active && "on")}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => open(r)}
              >
                <Icon name={r.icon} size={14} />
                <span className="sp-label">{r.label}</span>
                {r.detail && <span className="sp-detail">{r.detail}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="sp-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          <span><kbd className="kbd">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
