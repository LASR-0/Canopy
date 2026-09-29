import type { ReactNode } from "react";

/**
 * A page's scrolling body.
 *
 * One component rather than the two patterns pages had grown (`.scroll` +
 * `.canvas-pad`, and an inline-padded flex div), so padding and the maximum
 * content width are decided once. On a wide screen the content stops at
 * `--content-max` and centres, instead of stretching a sensor card across a
 * 2560 px monitor.
 */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="page-body">
      <div className={className ? `page-inner ${className}` : "page-inner"}>{children}</div>
    </div>
  );
}
