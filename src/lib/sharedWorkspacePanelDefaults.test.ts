import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_DOCKED_SIDE_PANEL_WIDTH,
  type DockablePanelLayout,
  createDefaultDockablePanelLayout,
  resolveDockedPanelStyleMetrics,
  resolveSharedDockablePanelCanvasOffsetPx,
} from './dockablePanel';
import {
  getSharedWorkspacePanelBodyClassName,
  getSharedWorkspacePanelDefaults,
  getSharedWorkspacePanelTopOffsetPx,
  getSharedSourceBinCanvasOffsetClassName,
  getSharedSourceBinCanvasOffsetPx,
} from './sharedWorkspacePanelDefaults';

describe('shared workspace panel defaults', () => {
  it('keeps Flow source bin visible and bookmarks on a compact rail while Add Nodes lives in the fixed titlebar', () => {
    const defaults = getSharedWorkspacePanelDefaults('flow');

    expect(defaults.map((panel) => panel.panelId)).toEqual(['source-bin', 'bookmarks']);
    expect(defaults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ panelId: 'source-bin', mode: 'docked', dockZone: 'left' }),
        expect.objectContaining({ panelId: 'bookmarks', mode: 'collapsed', dockZone: 'right' }),
      ]),
    );
  });

  it('keeps Image and Paper scoped to the shared source bin surface', () => {
    expect(getSharedWorkspacePanelDefaults('image')).toEqual([
      expect.objectContaining({ workspaceId: 'image', panelId: 'source-bin', dockZone: 'left' }),
    ]);
    expect(getSharedWorkspacePanelDefaults('paper')).toEqual([
      expect.objectContaining({
        workspaceId: 'paper',
        panelId: 'source-bin',
        mode: 'collapsed',
        dockZone: 'left',
      }),
    ]);
  });

  it('starts shared source bins as flush left dock sidebars without workspace margins', () => {
    for (const workspaceId of ['flow', 'image', 'paper'] as const) {
      const sourceBin = getSharedWorkspacePanelDefaults(workspaceId).find((panel) => panel.panelId === 'source-bin');

      expect(sourceBin).toMatchObject({
        mode: workspaceId === 'paper' ? 'collapsed' : 'docked',
        dockZone: 'left',
        floatingRect: expect.objectContaining({ x: 0 }),
      });
    }
  });

  it('keeps Image shared dock panels below workspace-local header rows', () => {
    expect(getSharedWorkspacePanelTopOffsetPx('flow')).toBe(64);
    expect(getSharedWorkspacePanelTopOffsetPx('image')).toBeGreaterThan(getSharedWorkspacePanelTopOffsetPx('flow'));
  });

  it('keeps Paper shared dock panels directly below the app topbar when Paper controls live in the titlebar', () => {
    // The workspace container already sits BELOW the in-flow topbar, so "directly below the
    // topbar" means zero offset. The old expectation (= flow's 64) copied Flow's offset, but Flow's
    // 64 clears Flow's own in-container toolbar rows — Paper has none (its controls are portaled
    // into the titlebar), so the copied offset left the shared Source Bin hanging 64px lower than
    // Paper's flush-mounted Inspector.
    expect(getSharedWorkspacePanelTopOffsetPx('paper')).toBe(0);
  });

  it('uses non-padding overflow chrome for scrollable dockable source-bin and bookmark content', () => {
    expect(getSharedWorkspacePanelBodyClassName('source-bin')).toBe('min-h-0 overflow-hidden p-0');
    expect(getSharedWorkspacePanelBodyClassName('bookmarks')).toBe('min-h-0 overflow-hidden p-0');
  });

  it('offsets document workspaces only when the shared source bin owns the left dock edge', () => {
    expect(getSharedSourceBinCanvasOffsetClassName()).toBe('ml-0');
    expect(getSharedSourceBinCanvasOffsetClassName({ dockZone: 'left', mode: 'docked' })).toBe('ml-[22rem]');
    expect(getSharedSourceBinCanvasOffsetClassName({ dockZone: 'left', mode: 'collapsed' })).toBe('ml-0');
    expect(getSharedSourceBinCanvasOffsetClassName({ dockZone: 'left', mode: 'floating' })).toBe('ml-0');
    expect(getSharedSourceBinCanvasOffsetClassName({ dockZone: 'right', mode: 'docked' })).toBe('ml-0');
  });

  it('uses the live docked source-bin width for document workspace offsets', () => {
    expect(getSharedSourceBinCanvasOffsetPx({ dockZone: 'left', mode: 'docked', floatingRect: { width: 420 } })).toBe(420);
    expect(getSharedSourceBinCanvasOffsetPx({ dockZone: 'left', mode: 'collapsed', floatingRect: { width: 280 } })).toBe(COLLAPSED_DOCKED_SIDE_PANEL_WIDTH);
    expect(getSharedSourceBinCanvasOffsetPx({ dockZone: 'left', mode: 'floating', floatingRect: { width: 420 } })).toBe(0);
    expect(getSharedSourceBinCanvasOffsetPx({ dockZone: 'right', mode: 'docked', floatingRect: { width: 420 } })).toBe(0);
  });

  it('derives workspace offsets from resolved dock chrome instead of stale saved source-bin width', () => {
    const sourceBin = createDefaultDockablePanelLayout({
      workspaceId: 'paper',
      panelId: 'source-bin',
      dockZone: 'left',
      floatingRect: { width: 352, height: 640 },
      minSize: { width: 320, height: 320 },
    });
    const collapsed = { ...sourceBin, mode: 'collapsed' as const };

    expect(resolveDockedPanelStyleMetrics(collapsed).width).toBe(COLLAPSED_DOCKED_SIDE_PANEL_WIDTH);
    expect(resolveSharedDockablePanelCanvasOffsetPx(collapsed)).toBe(COLLAPSED_DOCKED_SIDE_PANEL_WIDTH);
    expect(resolveSharedDockablePanelCanvasOffsetPx(sourceBin as DockablePanelLayout)).toBe(352);
    expect(resolveSharedDockablePanelCanvasOffsetPx({ ...sourceBin, dockZone: 'right' })).toBe(0);
  });
});
