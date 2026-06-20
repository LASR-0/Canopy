import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type TagVariant = "ok" | "warn" | "err" | "idle" | "info" | "done" | "coral";

interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
  className?: string;
}

export function Tag({ variant = "idle", children, className }: TagProps) {
  return (
    <span className={cn("s-badge tag", `b-${variant}`, className)}>
      {children}
    </span>
  );
}

export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("cap-chip", className)}>{children}</span>
  );
}
