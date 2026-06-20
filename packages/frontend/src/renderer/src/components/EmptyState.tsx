import { Icon, type IconName } from "@/components/Icon";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  hint?: string;
}

export function EmptyState({ icon, title, description, action, hint }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <div className="empty-ico">
          <Icon name={icon} size={28} />
        </div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {action}
        {hint && <div className="pill">{hint}</div>}
      </div>
    </div>
  );
}
