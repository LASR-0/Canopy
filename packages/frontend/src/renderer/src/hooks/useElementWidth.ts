import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The rendered content size of an element, kept current as it resizes.
 *
 * For SVGs that should draw at their real pixel size. A fixed viewBox stretched
 * to fit scales everything in it — text included — so a chart's labels were
 * huge on a wide window and unreadable on a narrow one. Drawing in the measured
 * size keeps text at its CSS size and lets only the plot grow.
 */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (w: number, h: number) => {
      // Whole pixels: sub-pixel jitter would otherwise re-render on every frame of a resize.
      const next = { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
      setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    measure(
      rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
    );
    const observer = new ResizeObserver(([entry]) => entry && measure(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/** The content width alone. */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback: number): number {
  return useElementSize(ref, { width: fallback, height: 0 }).width;
}
