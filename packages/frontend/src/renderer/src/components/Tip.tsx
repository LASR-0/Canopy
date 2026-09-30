import { isValidElement, type ReactElement, type ReactNode } from "react";
import { Tooltip } from "radix-ui";

/**
 * Canopy's tooltip, in place of the browser's native `title` popup: that one
 * waits about a second, ignores the theme, and cannot be styled.
 *
 * Wrap the element the tip describes. Empty `content` renders the child alone,
 * so a conditional tip needs no branch at the call site. A disabled button gets
 * no pointer events, so it is wrapped in a span that carries the tip instead;
 * those tips are often the ones that say why the button is disabled.
 *
 * Needs a `TipProvider` above it (the Shell has one).
 */
export function Tip({ content, side = "top", children }: {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactElement;
}) {
  if (content == null || content === false || content === "") return children;
  const disabled = isValidElement<{ disabled?: boolean }>(children) && children.props.disabled === true;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        {disabled ? <span className="tip-wrap">{children}</span> : children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** One per app. Moving between tips skips the delay, as native tooltips do. */
export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}
