import { cn } from "@/lib/utils";

interface SignalBarsProps {
  /** 0 = no signal, 4 = full */
  strength: 0 | 1 | 2 | 3 | 4;
  className?: string;
}

const HEIGHTS = [4, 7, 10, 14];

export function SignalBars({ strength, className }: SignalBarsProps) {
  return (
    <div className={cn("flex items-end gap-[2px]", className)} aria-label={`Signal: ${strength}/4`}>
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className={cn(
            "block w-[3px] rounded-[1px]",
            i < strength ? "bg-fg-default" : "bg-border-default",
          )}
          style={{ height: h }}
        />
      ))}
    </div>
  );
}
