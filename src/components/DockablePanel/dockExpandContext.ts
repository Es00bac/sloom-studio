import { createContext, useContext } from 'react';

/**
 * Tells panel content whether it is rendered inside a side-docked (left/right) dock column that
 * already scrolls as a whole. When true, panels should expand to their natural content height and
 * NOT introduce their own inner scroll regions ("no iframes" — only the whole sidebar scrolls).
 * Defaults to false so floating panels (and panels rendered directly in tests) keep their own scroll.
 */
export const DockExpandContext = createContext<boolean>(false);

/** Returns true when the surrounding dock wants this panel to expand vertically instead of scroll. */
export function useDockExpandToContent(): boolean {
  return useContext(DockExpandContext);
}
