import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** "default" = Primer-style bordered tabs; "segmented" = monospace segmented control */
  variant?: "default" | "segmented";
  className?: string;
}

export function Tabs({ items, active, onChange, variant = "default", className }: TabsProps) {
  const isSegmented = variant === "segmented";

  return (
    <div
      className={cn(
        "inline-flex overflow-hidden rounded-md border border-border-default",
        !isSegmented && "rounded-[7px]",
        className,
      )}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "cursor-pointer border-none py-1.5",
            isSegmented
              ? "px-3 font-mono text-[12px]"
              : "px-4 font-sans text-[13px] font-semibold",
            i > 0 && "border-l border-border-default",
            active === item.id
              ? "bg-canvas-subtle text-fg"
              : "bg-transparent text-fg-muted hover:bg-canvas-subtle hover:text-fg",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
