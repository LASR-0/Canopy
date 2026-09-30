import { useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/Icon";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

const pad = (n: number) => String(n).padStart(2, "0");

function parse(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [Number.isFinite(h) ? h! : 0, Number.isFinite(m) ? m! : 0];
}

type Part = "h" | "m";

/**
 * A 24-hour time, "HH:MM", in place of the native `<input type="time">`,
 * whose look and picker belong to the OS rather than to Canopy.
 *
 * Hours and minutes are separate segments. Type digits into them, or step
 * them with the arrow keys; two hour digits move on to the minutes. A click
 * opens a grid of hours and five-minute steps, and picking a minute closes
 * it. Other minutes are typed.
 */
export function TimeField({ value, onChange, ariaLabel, className }: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [h, m] = parse(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLSpanElement>(null);
  const minRef = useRef<HTMLSpanElement>(null);
  // The first digit typed into a segment, waiting to see whether a second follows.
  const typed = useRef<{ part: Part; digit: number } | null>(null);

  const set = (hour: number, minute: number) => onChange(`${pad(hour)}:${pad(minute)}`);

  const onKey = (part: Part) => (e: KeyboardEvent) => {
    const max = part === "h" ? 23 : 59;
    const cur = part === "h" ? h : m;
    const put = (n: number) => (part === "h" ? set(n, m) : set(h, n));

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      typed.current = null;
      const step = e.key === "ArrowUp" ? 1 : -1;
      put((cur + step + max + 1) % (max + 1));
    } else if (/^[0-9]$/.test(e.key)) {
      e.preventDefault();
      const d = Number(e.key);
      const first = typed.current?.part === part ? typed.current.digit : null;
      if (first === null) {
        put(d);
        // A digit that cannot start a two-digit value completes the segment.
        if (d * 10 > max) {
          typed.current = null;
          if (part === "h") minRef.current?.focus();
        } else {
          typed.current = { part, digit: d };
        }
      } else {
        put(Math.min(max, first * 10 + d));
        typed.current = null;
        if (part === "h") minRef.current?.focus();
      }
    } else if (e.key === "Backspace") {
      e.preventDefault();
      typed.current = null;
      put(0);
    } else if (e.key === "ArrowRight" && part === "h") {
      e.preventDefault();
      minRef.current?.focus();
    } else if (e.key === "ArrowLeft" && part === "m") {
      e.preventDefault();
      hourRef.current?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  const segment = (part: Part) => (
    <span
      ref={part === "h" ? hourRef : minRef}
      className="tfield-seg"
      role="spinbutton"
      tabIndex={0}
      aria-label={`${ariaLabel}, ${part === "h" ? "hours" : "minutes"}`}
      aria-valuemin={0}
      aria-valuemax={part === "h" ? 23 : 59}
      aria-valuenow={part === "h" ? h : m}
      aria-valuetext={value}
      onKeyDown={onKey(part)}
      onBlur={() => { typed.current = null; }}
    >
      {pad(part === "h" ? h : m)}
    </span>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          ref={box}
          className={cn("tfield", open && "open", className)}
          onClick={(e) => {
            // A click on the box, not a segment, starts at the hours.
            if (e.target === e.currentTarget) hourRef.current?.focus();
            setOpen(true);
          }}
        >
          <Icon name="clock" size={13} />
          {segment("h")}
          <span className="tfield-sep">:</span>
          {segment("m")}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="tpick p-0"
        side="bottom"
        align="start"
        sideOffset={6}
        // Focus stays in the segments, so typing still works with the grid open.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (box.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <div className="tpick-label">Hour</div>
        <div className="tpick-grid hours">
          {HOURS.map((n) => (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              className={cn("tpick-cell", n === h && "on")}
              onClick={() => set(n, m)}
            >
              {pad(n)}
            </button>
          ))}
        </div>
        <div className="tpick-label">Minute</div>
        <div className="tpick-grid">
          {MINUTES.map((n) => (
            <button
              key={n}
              type="button"
              tabIndex={-1}
              className={cn("tpick-cell", n === m && "on")}
              onClick={() => { set(h, n); setOpen(false); }}
            >
              :{pad(n)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
