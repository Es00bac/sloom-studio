import { useState } from 'react';

/**
 * Right-click node actions (collapse/group/etc.) are wired through React Flow's
 * `onNodeContextMenu`, which only fires on a native `contextmenu` gesture — invisible and
 * unreachable for touch users (UX review F07).
 *
 * Rather than fork the menu contents, a visible "⋯" button re-dispatches the same native
 * `contextmenu` event from inside the node. The event bubbles up to the `.react-flow__node`
 * wrapper, so React Flow's existing handler opens the identical menu at the button's anchor.
 */
export function dispatchNodeContextMenu(
  target: Element | null | undefined,
  clientX: number,
  clientY: number,
): boolean {
  if (!target) {
    return false;
  }

  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 2,
  });

  return target.dispatchEvent(event);
}

/**
 * Anchors the synthetic context menu just under the ⋯ button so the menu appears attached to
 * the affordance the user tapped.
 */
export function getNodeContextMenuAnchor(buttonRect: {
  left: number;
  bottom: number;
}): { clientX: number; clientY: number } {
  return { clientX: buttonRect.left, clientY: buttonRect.bottom };
}

export function detectCoarsePointer(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) {
    return false;
  }

  if ((win.navigator?.maxTouchPoints ?? 0) > 0) {
    return true;
  }

  try {
    return win.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Touch capability is effectively static for a session, so this is resolved once (no resize
 * listeners per node) — the ⋯ button then stays visible on touch surfaces.
 */
export function useCoarsePointer(): boolean {
  const [coarse] = useState(() => detectCoarsePointer());
  return coarse;
}
