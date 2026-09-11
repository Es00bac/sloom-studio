import type { DockablePanelMode } from '../../../lib/dockablePanel';

interface PaperPanelVisibilityOptions {
  treatCollapsedAsShown?: boolean;
}

interface PaperPanelToggleOptions extends PaperPanelVisibilityOptions {
  restoreMode?: Exclude<DockablePanelMode, 'hidden' | 'collapsed'>;
}

export function resolvePaperPanelMode(
  mode: DockablePanelMode | undefined,
  defaultMode: DockablePanelMode | undefined,
): DockablePanelMode {
  return mode ?? defaultMode ?? 'hidden';
}

export function isPaperPanelShown(
  mode: DockablePanelMode,
  options: PaperPanelVisibilityOptions = {},
): boolean {
  if (mode === 'hidden') {
    return false;
  }

  if (mode === 'collapsed') {
    return options.treatCollapsedAsShown ?? true;
  }

  return true;
}

export function getPaperPanelToggleMode(
  mode: DockablePanelMode,
  options: PaperPanelToggleOptions = {},
): DockablePanelMode {
  return isPaperPanelShown(mode, options) ? 'hidden' : options.restoreMode ?? 'docked';
}
