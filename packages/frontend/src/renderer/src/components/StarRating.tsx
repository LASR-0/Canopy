import { useState } from "react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  max?: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  className?: string;
}

export function StarRating({ value, max = 5, onChange, readOnly = false, className }: StarRatingProps) {
  const [hover, setHover] = useState(0);
  const display = hover || value;

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          onMouseEnter={() => !readOnly && setHover(n)}
          onMouseLeave={() => !readOnly && setHover(0)}
          className={cn(
            "grid place-items-center bg-transparent p-0",
            readOnly ? "cursor-default" : "cursor-pointer",
            n <= display ? "text-star-gold" : "text-border-default",
          )}
          style={{ border: "none" }}
        >
          <svg viewBox="0 0 16 16" width={16} height={16} fill="currentColor" aria-hidden>
            <path d="M8 1.6l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.9 4.3 13.1l.8-4.2L2 6l4.2-.5z"/>
          </svg>
        </button>
      ))}
      {value > 0 && (
        <span className="ml-1.5 text-[14px] font-semibold tabular-nums text-fg">
          {value.toFixed(1)}
        </span>
      )}
    </div>
  );
}
