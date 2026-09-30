import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { Tip } from "@/components/Tip";
import { cn } from "@/lib/utils";

type Stage = "idle" | "confirm" | "pending";

/** How long the armed button waits for the second click. */
const CONFIRM_MS = 5000;
/** How long a countdown delete can still be cancelled. Matches `del-trace` in index.css. */
const COUNTDOWN_MS = 3000;

/**
 * Canopy's one delete button: a ghost button that turns red on hover.
 *
 * The first click only arms it. It stays red and asks for a second click,
 * and disarms if focus moves away or nothing happens for five seconds. With
 * `countdown`, the second click starts a three-second countdown traced round
 * the border, and a third click cancels. Use that for deletes that take a lot
 * with them and cannot be undone.
 *
 * Without a `label` the button is a trash icon, and widens to show the
 * question while armed.
 */
export function DeleteButton({
  onDelete,
  label,
  confirmLabel,
  ariaLabel,
  title,
  countdown = false,
  disabled = false,
  size = "sm",
  onPendingChange,
}: {
  onDelete: () => void;
  /** Visible text, e.g. "Delete" or "Forget all". Omit for an icon-only button. */
  label?: string;
  /** Text while armed. Defaults to "Are you sure?", or "Delete?" when icon-only. */
  confirmLabel?: string;
  ariaLabel?: string;
  title?: string | undefined;
  countdown?: boolean;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Told when the countdown starts and stops, so a form can lock while it runs. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timeouts outlive the render that set them, so they call the latest onDelete.
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const pending = stage === "pending";
  useEffect(() => { onPendingChange?.(pending); }, [pending, onPendingChange]);

  const onClick = () => {
    clear();
    if (stage === "idle") {
      setStage("confirm");
      timer.current = setTimeout(() => setStage("idle"), CONFIRM_MS);
    } else if (stage === "confirm" && countdown) {
      setStage("pending");
      timer.current = setTimeout(() => {
        setStage("idle");
        onDeleteRef.current();
      }, COUNTDOWN_MS);
    } else if (stage === "confirm") {
      setStage("idle");
      onDeleteRef.current();
    } else {
      setStage("idle"); // cancelled during the countdown
    }
  };

  const onBlur = () => {
    if (stage === "confirm") {
      clear();
      setStage("idle");
    }
  };

  const text =
    stage === "confirm" ? confirmLabel ?? (label ? "Are you sure?" : "Delete?")
    : stage === "pending" ? "Deleting…"
    : label;

  return (
    <Tip content={pending ? "Click to cancel" : title}>
      <button
        type="button"
        className={cn(
          "btn ghost-danger",
          size === "sm" && "sm",
          !text && "del-icon",
          stage === "confirm" && "armed",
          pending && "pending",
        )}
        onClick={onClick}
        onBlur={onBlur}
        disabled={disabled}
        aria-label={text ? undefined : ariaLabel ?? "Delete"}
      >
        <Icon name="trash" size={13} />
        {text}
      </button>
    </Tip>
  );
}
