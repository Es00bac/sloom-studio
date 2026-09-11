import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  areDockablePanelLayoutsEqual,
  createDefaultDockablePanelLayout,
  DOCKED_SIDE_PANEL_MIN_HEIGHT,
  moveFloatingPanelRect,
  nextPanelZOrder,
  normalizeDockColumn,
  normalizeFloatingPanelRect,
  panelKey,
  resizeDockedPanelRect,
  resizeFloatingPanelRect,
  sanitizeDockablePanelLayout,
  type DockablePanelDefault,
  type DockablePanelFloatingRectSpace,
  type DockablePanelLayout,
  type DockablePanelMode,
  type DockablePanelSnapTarget,
  type DockZone,
  type PanelRect,
  type ResizeDelta,
  type ViewportSize,
} from '../lib/dockablePanel';

export type WorkspaceViewDefaultPreset = 'reset' | 'balanced' | 'focus' | 'all-panels';

export interface DockablePanelSnapshot {
  layouts: Record<string, DockablePanelLayout>;
}

/** A named snapshot of one workspace's panel arrangement, saved by the user. */
export interface SavedDockableLayout {
  id: string;
  workspaceId: string;
  name: string;
  layouts: Record<string, DockablePanelLayout>;
  collapsedDockColumns: Record<string, boolean>;
}

interface DockablePanelState extends DockablePanelSnapshot {
  defaults: Record<string, DockablePanelLayout>;
  /** Collapsed side-dock columns, keyed by `${workspaceId}:${zone}:${column}`. */
  collapsedDockColumns: Record<string, boolean>;
  /** User-saved named layouts (all workspaces). */
  savedLayouts: SavedDockableLayout[];
  saveCurrentLayout: (workspaceId: string, name: string) => string;
  applySavedLayout: (id: string) => void;
  deleteSavedLayout: (id: string) => void;
  registerPanelDefaults: (defaults: DockablePanelDefault[]) => void;
  setPanelMode: (workspaceId: string, panelId: string, mode: DockablePanelMode) => void;
  setPanelDockColumn: (workspaceId: string, panelId: string, column: number) => void;
  toggleDockColumnCollapsed: (workspaceId: string, zone: DockZone, column: number) => void;
  dockPanel: (workspaceId: string, panelId: string, zone: DockZone) => void;
  snapPanelToDockTarget: (workspaceId: string, panelId: string, target: DockablePanelSnapTarget) => void;
  floatPanel: (workspaceId: string, panelId: string, rect?: Partial<PanelRect>, viewport?: ViewportSize, options?: { constrainPosition?: boolean; constrainSize?: boolean; floatingRectSpace?: DockablePanelFloatingRectSpace }) => void;
  hidePanel: (workspaceId: string, panelId: string) => void;
  collapsePanel: (workspaceId: string, panelId: string) => void;
  closePanel: (workspaceId: string, panelId: string) => void;
  moveFloatingPanel: (workspaceId: string, panelId: string, deltaX: number, deltaY: number, viewport: ViewportSize, options?: { constrainPosition?: boolean }) => void;
  resizeFloatingPanel: (workspaceId: string, panelId: string, resize: ResizeDelta, viewport: ViewportSize, options?: { constrainPosition?: boolean; constrainSize?: boolean }) => void;
  resizeDockedPanel: (workspaceId: string, panelId: string, resize: ResizeDelta, viewport: ViewportSize) => void;
  resizeAdjacentDockedPanelHeights: (workspaceId: string, upperPanelId: string, lowerPanelId: string, deltaY: number) => void;
  bringPanelToFront: (workspaceId: string, panelId: string) => void;
  groupPanelWithPanel: (workspaceId: string, panelId: string, targetPanelId: string) => void;
  activatePanelTab: (workspaceId: string, panelId: string) => void;
  reorderPanelTab: (workspaceId: string, panelId: string, targetPanelId: string, placement: 'before' | 'after') => void;
  ungroupPanelTab: (workspaceId: string, panelId: string) => void;
  splitPanelTab: (workspaceId: string, panelId: string) => void;
  resetPanelLayout: (workspaceId: string, panelId: string) => void;
  resetWorkspacePanels: (workspaceId: string) => void;
  applyWorkspaceViewDefault: (workspaceId: string, preset: WorkspaceViewDefaultPreset) => void;
  resetAllPanelLayouts: () => void;
}

export const useDockablePanelStore = create<DockablePanelState>()(
  persist(
    (set, get) => ({
      defaults: {},
      layouts: {},
      collapsedDockColumns: {},
      savedLayouts: [],
      saveCurrentLayout: (workspaceId, name) => {
        const id = `saved-${workspaceId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        set((state) => {
          const layouts = Object.fromEntries(
            Object.entries(state.layouts)
              .filter(([, layout]) => layout.workspaceId === workspaceId)
              .map(([key, layout]) => [key, cloneDockablePanelLayout(layout)]),
          );
          const collapsedDockColumns = Object.fromEntries(
            Object.entries(state.collapsedDockColumns).filter(([key]) => key.startsWith(`${workspaceId}:`)),
          );
          const entry: SavedDockableLayout = {
            id,
            workspaceId,
            name: name.trim() || `Layout ${state.savedLayouts.filter((l) => l.workspaceId === workspaceId).length + 1}`,
            layouts,
            collapsedDockColumns,
          };
          return { savedLayouts: [...state.savedLayouts, entry] };
        });
        return id;
      },
      applySavedLayout: (id) => {
        set((state) => {
          const entry = state.savedLayouts.find((layout) => layout.id === id);
          if (!entry) return state;
          // Replace this workspace's panels + collapsed columns; leave other workspaces intact.
          const layouts = { ...state.layouts };
          for (const key of Object.keys(layouts)) {
            if (layouts[key].workspaceId === entry.workspaceId) delete layouts[key];
          }
          for (const [key, storedLayout] of Object.entries(entry.layouts)) {
            const fallback = state.defaults[key] ?? state.layouts[key] ?? fallbackLayoutFromKey(key);
            const layout = sanitizeDockablePanelLayout(
              storedLayout,
              fallback,
              undefined,
              { constrainFloatingRectPosition: false, constrainFloatingRectSize: false },
            );
            if (layout.workspaceId !== entry.workspaceId) continue;
            layouts[key] = cloneDockablePanelLayout(layout);
          }
          const collapsedDockColumns = Object.fromEntries(
            Object.entries(state.collapsedDockColumns).filter(([key]) => !key.startsWith(`${entry.workspaceId}:`)),
          );
          for (const [key, value] of Object.entries(entry.collapsedDockColumns)) {
            collapsedDockColumns[key] = value;
          }
          return { layouts, collapsedDockColumns };
        });
      },
      deleteSavedLayout: (id) => {
        set((state) => ({ savedLayouts: state.savedLayouts.filter((layout) => layout.id !== id) }));
      },
      registerPanelDefaults: (defaults) => {
        const registered = buildRegisteredPanelDefaults(get(), defaults);
        if (!registered.changed) return;
        set({ defaults: registered.defaults, layouts: registered.layouts });
      },
      setPanelMode: (workspaceId, panelId, mode) => {
        updatePanelGroup(
          set,
          get,
          workspaceId,
          panelId,
          (layout) => ({ ...layout, mode }),
          { syncDockedSideContainerWidth: true },
        );
      },
      setPanelDockColumn: (workspaceId, panelId, column) => {
        const dockColumn = Math.max(0, Math.round(column));
        updatePanelGroup(set, get, workspaceId, panelId, (layout) => ({
          ...layout,
          mode: 'docked',
          dockColumn,
        }), { syncDockedSideContainerWidth: true });
      },
      toggleDockColumnCollapsed: (workspaceId, zone, column) => {
        const key = `${workspaceId}:${zone}:${Math.max(0, Math.round(column))}`;
        set((state) => ({
          collapsedDockColumns: { ...state.collapsedDockColumns, [key]: !state.collapsedDockColumns[key] },
        }));
      },
      dockPanel: (workspaceId, panelId, zone) => {
        updatePanelGroup(set, get, workspaceId, panelId, (layout) => ({
          ...layout,
          mode: 'docked',
          dockZone: zone,
          floatingRectSpace: undefined,
        }), { syncDockedSideContainerWidth: true });
      },
      snapPanelToDockTarget: (workspaceId, panelId, target) => {
        if (target.mode === 'tab') {
          set((state) => ({
            layouts: groupPanelWithPanelLayouts(state.layouts, state.defaults, workspaceId, panelId, target.referencePanelId),
          }));
          return;
        }

        if (target.mode !== 'docked') {
          return;
        }

        const key = panelKey(workspaceId, panelId);
        set((state) => {
          const current = state.layouts[key] ?? state.defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId });
          const nextLayouts = { ...state.layouts };
          const dockedCurrent: DockablePanelLayout = {
            ...current,
            mode: 'docked',
            dockZone: target.dockZone,
            dockColumn: target.dockColumn ?? 0,
            floatingRectSpace: undefined,
          };

          const orderedZoneEntries = Object.entries(state.layouts)
            .filter(([entryKey, layout]) => (
              entryKey !== key
              && (!current.tabGroupId || layout.tabGroupId !== current.tabGroupId)
              && layout.workspaceId === workspaceId
              && layout.dockZone === target.dockZone
              && (layout.mode === 'docked' || layout.mode === 'collapsed')
            ))
            .sort(([, a], [, b]) => a.zOrder - b.zOrder || a.panelId.localeCompare(b.panelId));

          let insertIndex = orderedZoneEntries.length;
          if (target.placement === 'start') {
            insertIndex = 0;
          } else if ((target.placement === 'before' || target.placement === 'after') && target.referencePanelId) {
            const referenceIndex = orderedZoneEntries.findIndex(([, layout]) => layout.panelId === target.referencePanelId);
            if (referenceIndex >= 0) {
              insertIndex = referenceIndex + (target.placement === 'after' ? 1 : 0);
            }
          }

          const orderedWithCurrent: Array<[string, DockablePanelLayout]> = [...orderedZoneEntries];
          orderedWithCurrent.splice(insertIndex, 0, [key, dockedCurrent]);

          orderedWithCurrent.forEach(([entryKey, layout], index) => {
            const nextLayout = {
              ...(nextLayouts[entryKey] ?? layout),
              mode: entryKey === key ? 'docked' : layout.mode,
              dockZone: target.dockZone,
              zOrder: index,
            };
            nextLayouts[entryKey] = nextLayout;
            syncTabGroupLayouts(nextLayouts, nextLayout, {
              mode: nextLayout.mode,
              dockZone: nextLayout.dockZone,
              dockColumn: nextLayout.dockColumn,
              floatingRect: nextLayout.floatingRect,
              floatingRectSpace: nextLayout.floatingRectSpace,
              zOrder: nextLayout.zOrder,
            });
            syncDockedSideContainerWidth(nextLayouts, nextLayout);
          });

          return { layouts: nextLayouts };
        });
      },
      floatPanel: (workspaceId, panelId, rect, viewport = defaultViewport(), options = {}) => {
        updatePanelGroup(set, get, workspaceId, panelId, (layout, layouts) => {
          const floatingRectSpace = resolveNextFloatingRectSpace(layout.floatingRectSpace, rect, options.floatingRectSpace);
          const floatingRect = normalizeFloatingPanelRect(
            { ...layout.floatingRect, ...rect },
            viewport,
            layout.minSize,
            {
              constrainPosition: options.constrainPosition ?? false,
              constrainSize: options.constrainSize,
            },
          );
          return {
            ...layout,
            mode: 'floating',
            floatingRectSpace,
            floatingRect,
            zOrder: nextPanelZOrder(Object.values(layouts)),
          };
        });
      },
      hidePanel: (workspaceId, panelId) => {
        updatePanel(set, get, workspaceId, panelId, (layout) => ({ ...layout, mode: 'hidden' }));
      },
      collapsePanel: (workspaceId, panelId) => {
        updatePanel(set, get, workspaceId, panelId, (layout) => ({ ...layout, mode: 'collapsed' }));
      },
      closePanel: (workspaceId, panelId) => {
        get().hidePanel(workspaceId, panelId);
      },
      moveFloatingPanel: (workspaceId, panelId, deltaX, deltaY, viewport, options = {}) => {
        updatePanelGroup(set, get, workspaceId, panelId, (layout) => ({
          ...layout,
          floatingRect: moveFloatingPanelRect(
            layout.floatingRect,
            deltaX,
            deltaY,
            viewport,
            layout.minSize,
            { constrainPosition: options.constrainPosition ?? false },
          ),
        }));
      },
      resizeFloatingPanel: (workspaceId, panelId, resize, viewport, options = {}) => {
        updatePanelGroup(set, get, workspaceId, panelId, (layout) => ({
          ...layout,
          floatingRect: resizeFloatingPanelRect(
            layout.floatingRect,
            resize,
            viewport,
            layout.minSize,
            {
              constrainPosition: options.constrainPosition ?? false,
              constrainSize: options.constrainSize,
            },
          ),
        }));
      },
      resizeDockedPanel: (workspaceId, panelId, resize, viewport) => {
        const key = panelKey(workspaceId, panelId);
        set((state) => {
          const current = state.layouts[key] ?? state.defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId });
          if (current.dockZone === 'center' && resize.edgeX !== 0) {
            return resizeCenterDockedSplitPanel(state.layouts, current, resize);
          }

          const resizedCurrent = resizeDockedPanelRect(current.floatingRect, current.dockZone, resize, viewport, current.minSize);
          const nextLayouts = { ...state.layouts };

          for (const [entryKey, layout] of Object.entries(state.layouts)) {
            if (
              layout.workspaceId !== workspaceId
              || layout.dockZone !== current.dockZone
              || layout.mode !== 'docked'
              || (
                (current.dockZone === 'left' || current.dockZone === 'right')
                && normalizeDockColumn(layout.dockColumn) !== normalizeDockColumn(current.dockColumn)
              )
            ) {
              continue;
            }

            // Do not link sizes between shared workspace panels (source-bin/bookmarks) and standard tool panels
            const isShared = layout.panelId === 'source-bin' || layout.panelId === 'bookmarks';
            const isCurrentShared = current.panelId === 'source-bin' || current.panelId === 'bookmarks';
            if (isShared !== isCurrentShared) {
              continue;
            }

            nextLayouts[entryKey] = {
              ...layout,
              floatingRect: resizeDockedPanelRectToMatch(layout, resizedCurrent, viewport),
            };
          }

          if (!nextLayouts[key]) {
            nextLayouts[key] = {
              ...current,
              floatingRect: resizedCurrent,
            };
          }

          return { layouts: nextLayouts };
        });
      },
      resizeAdjacentDockedPanelHeights: (workspaceId, upperPanelId, lowerPanelId, deltaY) => {
        set((state) => {
          const resized = resizeAdjacentDockedPanelHeightLayouts(
            state.layouts,
            workspaceId,
            upperPanelId,
            lowerPanelId,
            deltaY,
          );
          return resized.layouts === state.layouts ? state : resized;
        });
      },
      bringPanelToFront: (workspaceId, panelId) => {
        updatePanelGroup(set, get, workspaceId, panelId, (layout, layouts) => (
          layout.mode === 'floating'
            ? {
                ...layout,
                zOrder: nextPanelZOrder(Object.values(layouts)),
              }
            : layout
        ));
      },
      groupPanelWithPanel: (workspaceId, panelId, targetPanelId) => {
        set((state) => ({
          layouts: groupPanelWithPanelLayouts(state.layouts, state.defaults, workspaceId, panelId, targetPanelId),
        }));
      },
      activatePanelTab: (workspaceId, panelId) => {
        set((state) => ({
          layouts: activatePanelTabLayouts(state.layouts, workspaceId, panelId),
        }));
      },
      reorderPanelTab: (workspaceId, panelId, targetPanelId, placement) => {
        set((state) => ({
          layouts: reorderPanelTabLayouts(state.layouts, workspaceId, panelId, targetPanelId, placement),
        }));
      },
      ungroupPanelTab: (workspaceId, panelId) => {
        set((state) => ({
          layouts: ungroupPanelTabLayouts(state.layouts, workspaceId, panelId),
        }));
      },
      splitPanelTab: (workspaceId, panelId) => {
        set((state) => ({
          layouts: ungroupPanelTabLayouts(state.layouts, workspaceId, panelId),
        }));
      },
      resetPanelLayout: (workspaceId, panelId) => {
        const key = panelKey(workspaceId, panelId);
        set((state) => ({
          layouts: {
            ...state.layouts,
            [key]: state.defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId }),
          },
        }));
      },
      resetWorkspacePanels: (workspaceId) => {
        set((state) => {
          const layouts = { ...state.layouts };
          for (const [key, layout] of Object.entries(state.defaults)) {
            if (layout.workspaceId === workspaceId) {
              layouts[key] = layout;
            }
          }
          const collapsedDockColumns = Object.fromEntries(
            Object.entries(state.collapsedDockColumns).filter(([key]) => !key.startsWith(`${workspaceId}:`)),
          );
          return { layouts, collapsedDockColumns };
        });
      },
      applyWorkspaceViewDefault: (workspaceId, preset) => {
        set((state) => {
          const layouts = { ...state.layouts };
          for (const [key, defaultLayout] of Object.entries(state.defaults)) {
            if (defaultLayout.workspaceId !== workspaceId) continue;
            layouts[key] = createWorkspaceViewDefaultLayout(defaultLayout, preset);
          }
          return { layouts };
        });
      },
      resetAllPanelLayouts: () => {
        set((state) => ({ layouts: { ...state.defaults }, collapsedDockColumns: {} }));
      },
    }),
    {
      name: 'signal-loom-dockable-panels',
      storage: createJSONStorage(() => getPanelLayoutStorage()),
      partialize: (state) => ({
        layouts: state.layouts,
        collapsedDockColumns: state.collapsedDockColumns,
        savedLayouts: state.savedLayouts,
      }),
      merge: (persisted, current) => ({
        ...current,
        layouts: sanitizePersistedLayouts((persisted as Partial<DockablePanelSnapshot> | undefined)?.layouts, current.layouts),
        collapsedDockColumns:
          (persisted as { collapsedDockColumns?: Record<string, boolean> } | undefined)?.collapsedDockColumns
          ?? current.collapsedDockColumns,
        savedLayouts:
          sanitizeSavedLayouts(
            (persisted as { savedLayouts?: SavedDockableLayout[] } | undefined)?.savedLayouts,
            current.layouts,
          ),
      }),
    },
  ),
);

function buildRegisteredPanelDefaults(
  state: DockablePanelState,
  defaults: DockablePanelDefault[],
): { defaults: Record<string, DockablePanelLayout>; layouts: Record<string, DockablePanelLayout>; changed: boolean } {
  const nextDefaults = { ...state.defaults };
  const nextLayouts = { ...state.layouts };
  let changed = false;

  for (const input of defaults) {
    const key = panelKey(input.workspaceId, input.panelId);
    const previousDefault = nextDefaults[key];
    const defaultLayout = createDefaultDockablePanelLayout(
      input,
      nextDefaults[key]?.zOrder ?? Object.keys(nextDefaults).length,
    );
    const persistedLayout = nextLayouts[key];
    const nextLayout = previousDefault && areDockablePanelLayoutsEqual(persistedLayout, previousDefault)
      ? defaultLayout
      : mergePersistedLayout(persistedLayout, defaultLayout, input);
    if (!areDockablePanelLayoutsEqual(nextDefaults[key], defaultLayout)) {
      nextDefaults[key] = defaultLayout;
      changed = true;
    }
    if (!areDockablePanelLayoutsEqual(nextLayouts[key], nextLayout)) {
      nextLayouts[key] = nextLayout;
      changed = true;
    }
  }

  return {
    defaults: changed ? nextDefaults : state.defaults,
    layouts: changed ? nextLayouts : state.layouts,
    changed,
  };
}

function mergePersistedLayout(
  persisted: unknown,
  defaultLayout: DockablePanelLayout,
  defaultInput: DockablePanelDefault,
): DockablePanelLayout {
  const sanitized = sanitizeDockablePanelLayout(
    persisted,
    defaultLayout,
    undefined,
    { constrainFloatingRectPosition: false, constrainFloatingRectSize: false },
  );
  return defaultInput.fixedSize
    ? repairFixedSizeDefaultLayout(sanitized, defaultLayout)
    : sanitized;
}

function repairFixedSizeDefaultLayout(
  layout: DockablePanelLayout,
  defaultLayout: DockablePanelLayout,
): DockablePanelLayout {
  const mode = layout.mode === 'hidden' ? 'hidden' : defaultLayout.mode;
  return {
    ...layout,
    mode,
    dockZone: defaultLayout.dockZone,
    floatingRect: {
      ...layout.floatingRect,
      width: defaultLayout.floatingRect.width,
      height: defaultLayout.floatingRect.height,
    },
    minSize: { ...defaultLayout.minSize },
  };
}

function resizeDockedPanelRectToMatch(
  layout: DockablePanelLayout,
  targetRect: PanelRect,
  viewport: ViewportSize,
): PanelRect {
  if (layout.dockZone === 'left' || layout.dockZone === 'right') {
    const targetDelta = targetRect.width - layout.floatingRect.width;
    return resizeDockedPanelRect(
      layout.floatingRect,
      layout.dockZone,
      {
        edgeX: layout.dockZone === 'right' ? -1 : 1,
        edgeY: 0,
        deltaX: layout.dockZone === 'right' ? -targetDelta : targetDelta,
        deltaY: 0,
      },
      viewport,
      layout.minSize,
    );
  }

  if (layout.dockZone === 'top' || layout.dockZone === 'bottom') {
    const targetDelta = targetRect.height - layout.floatingRect.height;
    return resizeDockedPanelRect(
      layout.floatingRect,
      layout.dockZone,
      {
        edgeX: 0,
        edgeY: layout.dockZone === 'bottom' ? -1 : 1,
        deltaX: 0,
        deltaY: layout.dockZone === 'bottom' ? -targetDelta : targetDelta,
      },
      viewport,
      layout.minSize,
    );
  }

  return targetRect;
}

function resizeCenterDockedSplitPanel(
  layouts: Record<string, DockablePanelLayout>,
  current: DockablePanelLayout,
  resize: ResizeDelta,
): { layouts: Record<string, DockablePanelLayout> } {
  const zoneEntries = Object.entries(layouts)
    .filter(([, layout]) => (
      layout.workspaceId === current.workspaceId
      && layout.dockZone === 'center'
      && layout.mode === 'docked'
    ))
    .sort(([, a], [, b]) => a.zOrder - b.zOrder || a.panelId.localeCompare(b.panelId));
  const currentIndex = zoneEntries.findIndex(([, layout]) => layout.panelId === current.panelId);
  const neighborIndex = resize.edgeX > 0 ? currentIndex + 1 : currentIndex - 1;

  if (currentIndex < 0 || neighborIndex < 0 || neighborIndex >= zoneEntries.length) {
    return { layouts };
  }

  const [currentKey, currentLayout] = zoneEntries[currentIndex];
  const [neighborKey, neighborLayout] = zoneEntries[neighborIndex];
  const [leftKey, leftLayout, rightKey, rightLayout] = resize.edgeX > 0
    ? [currentKey, currentLayout, neighborKey, neighborLayout]
    : [neighborKey, neighborLayout, currentKey, currentLayout];
  const totalWidth = Math.max(
    leftLayout.minSize.width + rightLayout.minSize.width,
    leftLayout.floatingRect.width + rightLayout.floatingRect.width,
  );
  const rawLeftWidth = leftLayout.floatingRect.width + (resize.edgeX > 0 ? resize.deltaX : -resize.deltaX);
  const maxLeftWidth = Math.max(leftLayout.minSize.width, totalWidth - rightLayout.minSize.width);
  const nextLeftWidth = clampNumber(rawLeftWidth, leftLayout.minSize.width, maxLeftWidth);
  const nextRightWidth = totalWidth - nextLeftWidth;

  return {
    layouts: {
      ...layouts,
      [leftKey]: {
        ...leftLayout,
        floatingRect: {
          ...leftLayout.floatingRect,
          width: nextLeftWidth,
        },
      },
      [rightKey]: {
        ...rightLayout,
        floatingRect: {
          ...rightLayout.floatingRect,
          width: nextRightWidth,
        },
      },
    },
  };
}

interface DockedSideStackSlot {
  layouts: Array<[string, DockablePanelLayout]>;
  panelIds: Set<string>;
  height: number;
  minHeight: number;
}

function resizeAdjacentDockedPanelHeightLayouts(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  upperPanelId: string,
  lowerPanelId: string,
  deltaY: number,
): { layouts: Record<string, DockablePanelLayout> } {
  if (!Number.isFinite(deltaY) || deltaY === 0 || upperPanelId === lowerPanelId) {
    return { layouts };
  }

  const upper = layouts[panelKey(workspaceId, upperPanelId)];
  const lower = layouts[panelKey(workspaceId, lowerPanelId)];
  if (
    !upper
    || !lower
    || upper.mode !== 'docked'
    || lower.mode !== 'docked'
    || (upper.dockZone !== 'left' && upper.dockZone !== 'right')
    || lower.dockZone !== upper.dockZone
    || normalizeDockColumn(lower.dockColumn) !== normalizeDockColumn(upper.dockColumn)
  ) {
    return { layouts };
  }

  const stackLayouts = Object.entries(layouts)
    .filter(([, layout]) => (
      layout.workspaceId === workspaceId
      && layout.mode === 'docked'
      && layout.dockZone === upper.dockZone
      && normalizeDockColumn(layout.dockColumn) === normalizeDockColumn(upper.dockColumn)
    ))
    .sort(([, a], [, b]) => a.zOrder - b.zOrder || a.panelId.localeCompare(b.panelId));
  const slots = buildDockedSideStackSlots(stackLayouts);
  const upperIndex = slots.findIndex((slot) => slot.panelIds.has(upperPanelId));
  const lowerIndex = slots.findIndex((slot) => slot.panelIds.has(lowerPanelId));
  if (upperIndex < 0 || lowerIndex !== upperIndex + 1) {
    return { layouts };
  }

  const upperSlot = slots[upperIndex];
  const lowerSlot = slots[lowerIndex];
  const totalHeight = upperSlot.height + lowerSlot.height;
  if (totalHeight < upperSlot.minHeight + lowerSlot.minHeight) {
    return { layouts };
  }
  const nextUpperHeight = clampNumber(
    upperSlot.height + deltaY,
    upperSlot.minHeight,
    totalHeight - lowerSlot.minHeight,
  );
  const nextLowerHeight = totalHeight - nextUpperHeight;
  if (nextUpperHeight === upperSlot.height && nextLowerHeight === lowerSlot.height) {
    return { layouts };
  }

  const nextLayouts = { ...layouts };
  for (const [key, layout] of upperSlot.layouts) {
    nextLayouts[key] = {
      ...layout,
      floatingRect: { ...layout.floatingRect, height: nextUpperHeight },
    };
  }
  for (const [key, layout] of lowerSlot.layouts) {
    nextLayouts[key] = {
      ...layout,
      floatingRect: { ...layout.floatingRect, height: nextLowerHeight },
    };
  }
  return { layouts: nextLayouts };
}

function buildDockedSideStackSlots(
  layouts: Array<[string, DockablePanelLayout]>,
): DockedSideStackSlot[] {
  const slots: DockedSideStackSlot[] = [];
  const emittedTabGroups = new Set<string>();
  for (const entry of layouts) {
    const [, layout] = entry;
    const tabGroupId = layout.tabGroupId?.trim();
    const slotLayouts = tabGroupId
      ? layouts.filter(([, candidate]) => candidate.tabGroupId === tabGroupId)
      : [entry];
    if (tabGroupId) {
      if (emittedTabGroups.has(tabGroupId)) continue;
      emittedTabGroups.add(tabGroupId);
    }
    slots.push({
      layouts: slotLayouts,
      panelIds: new Set(slotLayouts.map(([, member]) => member.panelId)),
      height: Math.max(...slotLayouts.map(([, member]) => member.floatingRect.height)),
      minHeight: Math.max(
        DOCKED_SIDE_PANEL_MIN_HEIGHT,
        ...slotLayouts.map(([, member]) => member.minSize.height),
      ),
    });
  }
  return slots;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

function createWorkspaceViewDefaultLayout(
  defaultLayout: DockablePanelLayout,
  preset: WorkspaceViewDefaultPreset,
): DockablePanelLayout {
  if (preset === 'reset' || preset === 'balanced') {
    return defaultLayout;
  }

  if (preset === 'all-panels') {
    return {
      ...defaultLayout,
      mode: 'docked',
    };
  }

  return {
    ...defaultLayout,
    mode: isFocusWorkspacePanel(defaultLayout) ? 'docked' : 'hidden',
  };
}

const FOCUS_WORKSPACE_PANEL_IDS = new Set([
  'bottom-toolbar',
  'document-strip',
  'program-monitor',
  'timeline',
  'tools',
]);

function isFocusWorkspacePanel(layout: DockablePanelLayout): boolean {
  return layout.dockZone === 'center' || FOCUS_WORKSPACE_PANEL_IDS.has(layout.panelId);
}

function sanitizePersistedLayouts(
  persisted: unknown,
  currentLayouts: Record<string, DockablePanelLayout>,
): Record<string, DockablePanelLayout> {
  if (!isRecord(persisted)) return currentLayouts;
  const layouts: Record<string, DockablePanelLayout> = {};
  for (const [key, value] of Object.entries(persisted)) {
    const fallback = currentLayouts[key] ?? fallbackLayoutFromKey(key);
    layouts[key] = sanitizeDockablePanelLayout(
      value,
      fallback,
      undefined,
      { constrainFloatingRectPosition: false, constrainFloatingRectSize: false },
    );
  }
  return layouts;
}

function sanitizeSavedLayouts(
  persisted: unknown,
  currentLayouts: Record<string, DockablePanelLayout>,
): SavedDockableLayout[] {
  if (!Array.isArray(persisted)) return [];
  return persisted.flatMap((value) => {
    if (
      !isRecord(value)
      || typeof value.id !== 'string'
      || typeof value.workspaceId !== 'string'
      || typeof value.name !== 'string'
      || !isRecord(value.layouts)
    ) {
      return [];
    }

    const layouts: Record<string, DockablePanelLayout> = {};
    for (const [key, storedLayout] of Object.entries(value.layouts)) {
      const fallback = currentLayouts[key] ?? fallbackLayoutFromKey(key);
      const layout = sanitizeDockablePanelLayout(
        storedLayout,
        fallback,
        undefined,
        { constrainFloatingRectPosition: false, constrainFloatingRectSize: false },
      );
      if (layout.workspaceId === value.workspaceId) {
        layouts[key] = layout;
      }
    }

    const collapsedDockColumns = isRecord(value.collapsedDockColumns)
      ? Object.fromEntries(
          Object.entries(value.collapsedDockColumns)
            .filter(([key, collapsed]) => key.startsWith(`${value.workspaceId}:`) && typeof collapsed === 'boolean'),
        ) as Record<string, boolean>
      : {};

    return [{
      id: value.id,
      workspaceId: value.workspaceId,
      name: value.name.trim() || 'Saved layout',
      layouts,
      collapsedDockColumns,
    }];
  });
}

function cloneDockablePanelLayout(layout: DockablePanelLayout): DockablePanelLayout {
  return {
    ...layout,
    floatingRect: { ...layout.floatingRect },
    minSize: { ...layout.minSize },
  };
}

function resolveNextFloatingRectSpace(
  current: DockablePanelFloatingRectSpace | undefined,
  rect: Partial<PanelRect> | undefined,
  requested: DockablePanelFloatingRectSpace | undefined,
): DockablePanelFloatingRectSpace | undefined {
  if (requested === 'screen') return 'screen';
  if (requested === 'owner') return undefined;
  return rect ? undefined : current;
}

function fallbackLayoutFromKey(key: string): DockablePanelLayout {
  const [workspaceId = 'workspace', panelId = 'panel'] = key.split('/');
  return createDefaultDockablePanelLayout({ workspaceId, panelId });
}

function updatePanel(
  set: (partial: (state: DockablePanelState) => Partial<DockablePanelState>) => void,
  get: () => DockablePanelState,
  workspaceId: string,
  panelId: string,
  updater: (layout: DockablePanelLayout, layouts: Record<string, DockablePanelLayout>) => DockablePanelLayout,
): void {
  const key = panelKey(workspaceId, panelId);
  set((state) => {
    const current = state.layouts[key] ?? state.defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId });
    const nextLayout = updater(current, state.layouts);
    return {
      layouts: {
        ...state.layouts,
        [key]: nextLayout,
      },
    };
  });
  void get;
}

function updatePanelGroup(
  set: (partial: (state: DockablePanelState) => Partial<DockablePanelState>) => void,
  get: () => DockablePanelState,
  workspaceId: string,
  panelId: string,
  updater: (layout: DockablePanelLayout, layouts: Record<string, DockablePanelLayout>) => DockablePanelLayout,
  options: { syncDockedSideContainerWidth?: boolean } = {},
): void {
  const key = panelKey(workspaceId, panelId);
  set((state) => {
    const current = state.layouts[key] ?? state.defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId });
    const nextLayout = updater(current, state.layouts);
    const nextLayouts = {
      ...state.layouts,
      [key]: nextLayout,
    };
    syncTabGroupLayouts(nextLayouts, nextLayout, {
      mode: nextLayout.mode,
      dockZone: nextLayout.dockZone,
      dockColumn: nextLayout.dockColumn,
      floatingRect: nextLayout.floatingRect,
      floatingRectSpace: nextLayout.floatingRectSpace,
      zOrder: nextLayout.zOrder,
    });
    if (options.syncDockedSideContainerWidth) {
      syncDockedSideContainerWidth(nextLayouts, nextLayout);
    }
    return { layouts: nextLayouts };
  });
  void get;
}

function groupPanelWithPanelLayouts(
  layouts: Record<string, DockablePanelLayout>,
  defaults: Record<string, DockablePanelLayout>,
  workspaceId: string,
  panelId: string,
  targetPanelId: string,
): Record<string, DockablePanelLayout> {
  if (panelId === targetPanelId) return layouts;

  const key = panelKey(workspaceId, panelId);
  const targetKey = panelKey(workspaceId, targetPanelId);
  const currentInput = layouts[key] ?? defaults[key] ?? createDefaultDockablePanelLayout({ workspaceId, panelId });
  const targetInput = layouts[targetKey] ?? defaults[targetKey] ?? createDefaultDockablePanelLayout({ workspaceId, panelId: targetPanelId });
  const nextLayouts = {
    ...layouts,
    [key]: currentInput,
    [targetKey]: targetInput,
  };

  if (currentInput.tabGroupId && currentInput.tabGroupId === targetInput.tabGroupId) {
    return activatePanelTabLayouts(nextLayouts, workspaceId, panelId);
  }

  removePanelFromTabGroup(nextLayouts, workspaceId, panelId);
  const target = nextLayouts[targetKey] ?? targetInput;
  const current = nextLayouts[key] ?? currentInput;
  const tabGroupId = target.tabGroupId ?? createTabGroupId(workspaceId, target.panelId);
  const targetMembers = resolveTabGroupMembers(nextLayouts, workspaceId, tabGroupId);
  const nextOrder = targetMembers.length
    ? Math.max(...targetMembers.map((layout) => layout.tabGroupOrder ?? 0)) + 1
    : 1;

  if (!target.tabGroupId) {
    nextLayouts[targetKey] = {
      ...target,
      tabGroupId,
      tabGroupOrder: 0,
      tabGroupActive: false,
    };
  }

  for (const [entryKey, layout] of Object.entries(nextLayouts)) {
    if (layout.workspaceId !== workspaceId || layout.tabGroupId !== tabGroupId) continue;
    nextLayouts[entryKey] = {
      ...layout,
      mode: target.mode,
      dockZone: target.dockZone,
      dockColumn: target.dockColumn,
      floatingRect: { ...target.floatingRect },
      floatingRectSpace: target.floatingRectSpace,
      zOrder: target.zOrder,
      tabGroupActive: false,
    };
  }

  nextLayouts[key] = {
    ...current,
    mode: target.mode,
    dockZone: target.dockZone,
    dockColumn: target.dockColumn,
    floatingRect: { ...target.floatingRect },
    floatingRectSpace: target.floatingRectSpace,
    zOrder: target.zOrder,
    tabGroupId,
    tabGroupOrder: nextOrder,
    tabGroupActive: true,
  };

  syncDockedSideContainerWidth(nextLayouts, nextLayouts[key]);

  return ensureValidTabGroups(nextLayouts, workspaceId);
}

function activatePanelTabLayouts(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  panelId: string,
): Record<string, DockablePanelLayout> {
  const key = panelKey(workspaceId, panelId);
  const layout = layouts[key];
  if (!layout?.tabGroupId) return layouts;
  const nextLayouts = { ...layouts };
  const groupMembers = Object.entries(layouts)
    .filter(([, entryLayout]) => (
      entryLayout.workspaceId === workspaceId
      && entryLayout.tabGroupId === layout.tabGroupId
    ))
    .sort(([, a], [, b]) => (
      Number(b.tabGroupActive) - Number(a.tabGroupActive)
      || (a.tabGroupOrder ?? 0) - (b.tabGroupOrder ?? 0)
      || a.panelId.localeCompare(b.panelId)
    ));
  const referenceLayout = groupMembers[0]?.[1] ?? layout;
  for (const [entryKey, entryLayout] of Object.entries(layouts)) {
    if (entryLayout.workspaceId !== workspaceId || entryLayout.tabGroupId !== layout.tabGroupId) continue;
    nextLayouts[entryKey] = {
      ...entryLayout,
      mode: referenceLayout.mode,
      dockZone: referenceLayout.dockZone,
      dockColumn: referenceLayout.dockColumn,
      floatingRect: { ...referenceLayout.floatingRect },
      floatingRectSpace: referenceLayout.floatingRectSpace,
      zOrder: referenceLayout.zOrder,
      tabGroupActive: entryKey === key,
    };
  }
  return nextLayouts;
}

function ungroupPanelTabLayouts(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  panelId: string,
): Record<string, DockablePanelLayout> {
  const key = panelKey(workspaceId, panelId);
  const layout = layouts[key];
  if (!layout?.tabGroupId) return layouts;
  const groupMembersBefore = Object.entries(layouts).filter(([, entryLayout]) => (
    entryLayout.workspaceId === workspaceId
    && entryLayout.tabGroupId === layout.tabGroupId
  ));
  const nextLayouts = { ...layouts };
  removePanelFromTabGroup(nextLayouts, workspaceId, panelId);
  stabilizeUngroupedDockedTabOrder(nextLayouts, workspaceId, layout, groupMembersBefore);
  return ensureValidTabGroups(nextLayouts, workspaceId, layout.tabGroupId);
}

function reorderPanelTabLayouts(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  panelId: string,
  targetPanelId: string,
  placement: 'before' | 'after',
): Record<string, DockablePanelLayout> {
  if (panelId === targetPanelId) return layouts;
  const key = panelKey(workspaceId, panelId);
  const targetKey = panelKey(workspaceId, targetPanelId);
  const layout = layouts[key];
  const target = layouts[targetKey];
  if (!layout?.tabGroupId || !target?.tabGroupId || layout.tabGroupId !== target.tabGroupId) {
    return layouts;
  }

  const members = Object.entries(layouts)
    .filter(([, entryLayout]) => (
      entryLayout.workspaceId === workspaceId
      && entryLayout.tabGroupId === layout.tabGroupId
    ))
    .sort(([, a], [, b]) => (
      (a.tabGroupOrder ?? 0) - (b.tabGroupOrder ?? 0)
      || a.panelId.localeCompare(b.panelId)
    ));
  const movingEntry = members.find(([entryKey]) => entryKey === key);
  if (!movingEntry) return layouts;

  const orderedEntries = members.filter(([entryKey]) => entryKey !== key);
  const targetIndex = orderedEntries.findIndex(([entryKey]) => entryKey === targetKey);
  if (targetIndex < 0) return layouts;

  orderedEntries.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, movingEntry);
  const nextLayouts = { ...layouts };
  orderedEntries.forEach(([entryKey, entryLayout], index) => {
    nextLayouts[entryKey] = {
      ...entryLayout,
      tabGroupOrder: index,
    };
  });

  return ensureValidTabGroups(nextLayouts, workspaceId, layout.tabGroupId);
}

function removePanelFromTabGroup(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  panelId: string,
): void {
  const key = panelKey(workspaceId, panelId);
  const layout = layouts[key];
  if (!layout?.tabGroupId) return;
  layouts[key] = {
    ...layout,
    tabGroupId: undefined,
    tabGroupOrder: undefined,
    tabGroupActive: undefined,
  };
  ensureValidTabGroups(layouts, workspaceId, layout.tabGroupId);
}

function stabilizeUngroupedDockedTabOrder(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  ungroupedLayout: DockablePanelLayout,
  groupMembersBefore: Array<[string, DockablePanelLayout]>,
): void {
  if (
    !ungroupedLayout.tabGroupId
    || (ungroupedLayout.mode !== 'docked' && ungroupedLayout.mode !== 'collapsed')
  ) {
    return;
  }

  const ungroupedKey = panelKey(workspaceId, ungroupedLayout.panelId);
  const groupMemberKeys = new Set(groupMembersBefore.map(([entryKey]) => entryKey));
  const groupZOrder = Math.min(...groupMembersBefore.map(([, layout]) => layout.zOrder));
  const remainingGroupEntries = groupMembersBefore
    .filter(([entryKey, layout]) => (
      entryKey !== ungroupedKey
      && layouts[entryKey]
      && layout.workspaceId === workspaceId
      && layout.dockZone === ungroupedLayout.dockZone
      && (layout.mode === 'docked' || layout.mode === 'collapsed')
    ))
    .sort(([, a], [, b]) => (
      (a.tabGroupOrder ?? 0) - (b.tabGroupOrder ?? 0)
      || a.panelId.localeCompare(b.panelId)
    ));
  const ungroupedCurrent = layouts[ungroupedKey];
  if (!ungroupedCurrent) return;

  type StackUnit =
    | { type: 'panel'; key: string; zOrder: number; panelId: string }
    | { type: 'group'; keys: string[]; zOrder: number; panelId: string };

  const ungroupedOrder = ungroupedLayout.tabGroupOrder ?? 0;
  const formerGroupUnits: StackUnit[] = [];
  if (remainingGroupEntries.length <= 1) {
    const individualEntries = [
      ...remainingGroupEntries.map(([entryKey, layout]) => ({
        entryKey,
        panelId: layout.panelId,
        order: layout.tabGroupOrder ?? 0,
      })),
      {
        entryKey: ungroupedKey,
        panelId: ungroupedLayout.panelId,
        order: ungroupedOrder,
      },
    ].sort((a, b) => a.order - b.order || a.panelId.localeCompare(b.panelId));

    formerGroupUnits.push(...individualEntries.map((entry) => ({
      type: 'panel' as const,
      key: entry.entryKey,
      zOrder: groupZOrder,
      panelId: entry.panelId,
    })));
  } else {
    const remainingOrders = remainingGroupEntries.map(([, layout]) => layout.tabGroupOrder ?? 0);
    const groupUnit: StackUnit = {
      type: 'group',
      keys: remainingGroupEntries.map(([entryKey]) => entryKey),
      zOrder: groupZOrder,
      panelId: remainingGroupEntries[0]?.[1].panelId ?? ungroupedLayout.panelId,
    };
    const ungroupedUnit: StackUnit = {
      type: 'panel',
      key: ungroupedKey,
      zOrder: groupZOrder,
      panelId: ungroupedLayout.panelId,
    };
    formerGroupUnits.push(
      ungroupedOrder < Math.min(...remainingOrders)
        ? ungroupedUnit
        : groupUnit,
      ungroupedOrder < Math.min(...remainingOrders)
        ? groupUnit
        : ungroupedUnit,
    );
  }

  const unrelatedUnits: StackUnit[] = Object.entries(layouts)
    .filter(([entryKey, layout]) => (
      !groupMemberKeys.has(entryKey)
      && layout.workspaceId === workspaceId
      && layout.dockZone === ungroupedLayout.dockZone
      && (layout.mode === 'docked' || layout.mode === 'collapsed')
    ))
    .map(([entryKey, layout]) => ({
      type: 'panel' as const,
      key: entryKey,
      zOrder: layout.zOrder,
      panelId: layout.panelId,
    }))
    .sort((a, b) => a.zOrder - b.zOrder || a.panelId.localeCompare(b.panelId));

  const insertIndex = unrelatedUnits.findIndex((unit) => unit.zOrder >= groupZOrder);
  const orderedUnits = [...unrelatedUnits];
  orderedUnits.splice(insertIndex < 0 ? orderedUnits.length : insertIndex, 0, ...formerGroupUnits);

  orderedUnits.forEach((unit, index) => {
    if (unit.type === 'panel') {
      const layout = layouts[unit.key];
      if (!layout) return;
      layouts[unit.key] = {
        ...layout,
        zOrder: index,
      };
      return;
    }

    for (const entryKey of unit.keys) {
      const layout = layouts[entryKey];
      if (!layout) continue;
      layouts[entryKey] = {
        ...layout,
        zOrder: index,
      };
    }
  });
}

function ensureValidTabGroups(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  groupId?: string,
): Record<string, DockablePanelLayout> {
  const groups = new Map<string, Array<[string, DockablePanelLayout]>>();
  for (const entry of Object.entries(layouts)) {
    const [, layout] = entry;
    if (layout.workspaceId !== workspaceId || !layout.tabGroupId) continue;
    if (groupId && layout.tabGroupId !== groupId) continue;
    const members = groups.get(layout.tabGroupId) ?? [];
    members.push(entry);
    groups.set(layout.tabGroupId, members);
  }

  for (const members of groups.values()) {
    if (members.length <= 1) {
      for (const [entryKey, layout] of members) {
        layouts[entryKey] = {
          ...layout,
          tabGroupId: undefined,
          tabGroupOrder: undefined,
          tabGroupActive: undefined,
        };
      }
      continue;
    }

    const sortedMembers = [...members].sort(([, a], [, b]) => (
      (a.tabGroupOrder ?? 0) - (b.tabGroupOrder ?? 0)
      || a.panelId.localeCompare(b.panelId)
    ));
    const activeMember = sortedMembers.find(([, layout]) => layout.tabGroupActive) ?? sortedMembers[0];
    sortedMembers.forEach(([entryKey, layout], index) => {
      layouts[entryKey] = {
        ...layout,
        tabGroupOrder: index,
        tabGroupActive: entryKey === activeMember[0],
      };
    });
  }

  return layouts;
}

function resolveTabGroupMembers(
  layouts: Record<string, DockablePanelLayout>,
  workspaceId: string,
  tabGroupId: string,
): DockablePanelLayout[] {
  return Object.values(layouts).filter((layout) => (
    layout.workspaceId === workspaceId
    && layout.tabGroupId === tabGroupId
  ));
}

function syncTabGroupLayouts(
  layouts: Record<string, DockablePanelLayout>,
  source: DockablePanelLayout,
  shared: Pick<DockablePanelLayout, 'mode' | 'dockZone' | 'dockColumn' | 'floatingRect' | 'floatingRectSpace' | 'zOrder'>,
): void {
  if (!source.tabGroupId) return;
  for (const [entryKey, layout] of Object.entries(layouts)) {
    if (
      layout.workspaceId !== source.workspaceId
      || layout.panelId === source.panelId
      || layout.tabGroupId !== source.tabGroupId
    ) {
      continue;
    }
    layouts[entryKey] = {
      ...layout,
      ...shared,
      floatingRect: { ...shared.floatingRect },
    };
  }
}

function syncDockedSideContainerWidth(
  layouts: Record<string, DockablePanelLayout>,
  source: DockablePanelLayout,
): void {
  if (source.mode !== 'docked' || (source.dockZone !== 'left' && source.dockZone !== 'right')) {
    return;
  }

  const sourceShared = isSharedDockContainerPanel(source.panelId);
  const entries = Object.entries(layouts)
    .filter(([, layout]) => (
      layout.workspaceId === source.workspaceId
      && layout.mode === 'docked'
      && layout.dockZone === source.dockZone
      && normalizeDockColumn(layout.dockColumn) === normalizeDockColumn(source.dockColumn)
      && isSharedDockContainerPanel(layout.panelId) === sourceShared
    ))
    .sort(([, a], [, b]) => a.zOrder - b.zOrder || a.panelId.localeCompare(b.panelId));
  if (!entries.length) return;

  const reference = entries.find(([, layout]) => layout.panelId !== source.panelId)?.[1] ?? source;
  const width = reference.floatingRect.width;
  for (const [entryKey, layout] of entries) {
    if (layout.floatingRect.width === width) continue;
    layouts[entryKey] = {
      ...layout,
      floatingRect: {
        ...layout.floatingRect,
        width,
      },
    };
  }
}

function isSharedDockContainerPanel(panelId: string): boolean {
  return panelId === 'source-bin' || panelId === 'bookmarks';
}

function createTabGroupId(workspaceId: string, panelId: string): string {
  return `${workspaceId}-tab-group-${panelId}`;
}

function defaultViewport(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1280, height: 720 };
  return { width: window.innerWidth, height: window.innerHeight };
}

const memoryPanelStorage = new Map<string, string>();

function getPanelLayoutStorage(): StateStorage {
  let browserStorage: Storage | undefined;
  try {
    browserStorage = typeof globalThis === 'undefined' ? undefined : globalThis.localStorage;
  } catch {
    browserStorage = undefined;
  }
  if (
    browserStorage &&
    typeof browserStorage.getItem === 'function' &&
    typeof browserStorage.setItem === 'function' &&
    typeof browserStorage.removeItem === 'function'
  ) {
    return {
      getItem: (name) => {
        try {
          return browserStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          browserStorage.setItem(name, value);
        } catch {
          // Ignore unavailable/quota-limited storage during startup.
        }
      },
      removeItem: (name) => {
        try {
          browserStorage.removeItem(name);
        } catch {
          // Ignore unavailable storage during startup.
        }
      },
    };
  }
  return {
    getItem: (name) => memoryPanelStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryPanelStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryPanelStorage.delete(name);
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
