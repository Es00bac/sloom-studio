export const Z_INDEX = {
  workspaceChrome: 20,
  dockedPanel: 30,
  floatingPanelBase: 60,
  floatingPanelActive: 70,
  // Always-on-top tool palettes (Image/Paper): above all docked + floating panels and the source bin,
  // but below context menus and modals. Pinned palettes are portaled to <body> so this wins globally.
  pinnedPalette: 75,
  contextMenu: 80,
  modal: 90,
  toast: 100,
} as const;

export type ZIndexLayer = keyof typeof Z_INDEX;

export function zIndexForFloatingPanel(order: number): number {
  const normalizedOrder = Number.isFinite(order) ? Math.max(0, Math.round(order)) : 0;
  return Math.min(Z_INDEX.contextMenu - 1, Z_INDEX.floatingPanelBase + normalizedOrder);
}
