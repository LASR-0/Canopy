import { cn } from "@/lib/utils";

interface ToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ on, onChange, disabled = false }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn("toggle", on && "on")}
      style={{ opacity: disabled ? 0.5 : undefined, cursor: disabled ? "not-allowed" : undefined }}
    >
      <span className="knob" />
    </button>
  );
}
