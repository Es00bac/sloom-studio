import type { DockablePanelMode } from './dockablePanel';

export interface DockablePanelVisibilityOptions {
  /** Treat a `collapsed` panel as shown (so toggling hides it). Default true. */
  treatCollapsedAsShown?: boolean;
}

export interface DockablePanelToggleOptions extends DockablePanelVisibilityOptions {
  /** Mode to restore to when un-hiding. Default `docked`. */
  restoreMode?: Exclude<DockablePanelMode, 'hidden' | 'collapsed'>;
}

/** Resolve a panel's effective mode from its layout, its registered default, then `hidden`. */
export function resolveDockablePanelMode(
  mode: DockablePanelMode | undefined,
  defaultMode: DockablePanelMode | undefined,
): DockablePanelMode {
  return mode ?? defaultMode ?? 'hidden';
}

export function isDockablePanelShown(
  mode: DockablePanelMode,
  options: DockablePanelVisibilityOptions = {},
): boolean {
  if (mode === 'hidden') {
    return false;
  }

  if (mode === 'collapsed') {
    return options.treatCollapsedAsShown ?? true;
  }

  return true;
}

/** The mode a Window-menu toggle should switch the panel to: hide if shown, else restore. */
export function getDockablePanelToggleMode(
  mode: DockablePanelMode,
  options: DockablePanelToggleOptions = {},
): DockablePanelMode {
  return isDockablePanelShown(mode, options) ? 'hidden' : options.restoreMode ?? 'docked';
}
