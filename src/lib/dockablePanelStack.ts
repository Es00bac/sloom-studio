const PREFERRED_CENTER_PANEL_IDS = ['program-monitor'] as const;

export function shouldSplitDockZoneLayouts<T extends { panelId: string }>(
  zone: string,
  zoneLayouts: T[],
  isSplitCapablePanel: (panelId: string) => boolean,
): boolean {
  return zone === 'center'
    && zoneLayouts.length > 1
    && zoneLayouts.every((layout) => isSplitCapablePanel(layout.panelId));
}

/**
 * Entry-level split check for the center zone. Unlike the per-layout check above, this keeps the
 * side-by-side monitor split alive when a tab GROUP occupies one of the slots: a group is
 * split-capable when any member is (e.g. Inspector tabbed onto the Source Monitor). Without this,
 * dropping a tabs-presentation panel onto a split-capable one degraded the whole center to a
 * single-visible-entry tab strip — the other monitor silently vanished from the layout.
 */
export function shouldSplitDockZoneEntries<T extends { memberPanelIds: readonly string[] }>(
  zone: string,
  entries: T[],
  isSplitCapablePanel: (panelId: string) => boolean,
): boolean {
  return zone === 'center'
    && entries.length > 1
    && entries.every((entry) => entry.memberPanelIds.some((panelId) => isSplitCapablePanel(panelId)));
}

export function resolveActiveDockZoneLayout<T extends { panelId: string }>(
  zoneLayouts: T[],
  activePanelId: string | null,
): T | undefined {
  return zoneLayouts.find((layout) => layout.panelId === activePanelId)
    ?? PREFERRED_CENTER_PANEL_IDS
      .map((panelId) => zoneLayouts.find((layout) => layout.panelId === panelId))
      .find((layout): layout is T => Boolean(layout))
    ?? zoneLayouts[0];
}
