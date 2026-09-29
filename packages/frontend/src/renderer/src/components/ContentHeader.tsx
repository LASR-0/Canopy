import type { ReactNode } from "react";

interface ContentHeaderProps {
  title: string;
  crumbs?: string[];
  badge?: ReactNode;
  actions?: ReactNode;
}

export function ContentHeader({ title, crumbs, badge, actions }: ContentHeaderProps) {
  return (
    <div className="content-header">
      {/* Inner row shares the body's max width, so the title lines up with the
          content under it on a wide screen instead of hugging the sidebar. */}
      <div className="ch-inner">
      <div className="ch-titles">
        {crumbs && crumbs.length > 0 && (
          <div className="ch-crumb">
            {crumbs.map((crumb, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <span className="sep">/</span>}
                {crumb}
              </span>
            ))}
          </div>
        )}
        <div className="ch-title">
          {title}
          {badge}
        </div>
      </div>
      {actions && <div className="ch-actions">{actions}</div>}
      </div>
    </div>
  );
}
