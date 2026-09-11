import { Fragment, type AriaRole, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  createDockablePanelDefaultSignature,
  isCollapsedFloatingDockablePanel,
  sortDockedPanels,
  sortPanelsByZOrder,
  sanitizeDockablePanelLayout,
  DOCKED_SIDE_PANEL_MIN_HEIGHT,
  type DockZone,
  type DockablePanelDefault,
  type DockablePanelLayout,
} from '../../lib/dockablePanel';
import {
  resolveActiveDockZoneLayout,
  shouldSplitDockZoneEntries,
} from '../../lib/dockablePanelStack';
import { Z_INDEX } from '../../lib/zIndex';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { ErrorBoundary } from '../Recovery/ErrorBoundary';
import { DockablePanel, type DockablePanelChrome } from './DockablePanel';

export interface DockablePanelDefinition extends DockablePanelDefault {
  title: string;
  content: ReactNode;
  className?: string;
  bodyClassName?: string;
  allowedDockZones?: DockZone[];
  chrome?: DockablePanelChrome;
  fixedSize?: boolean;
  role?: AriaRole;
  ariaModal?: boolean;
  centerDockPresentation?: 'tabs' | 'split';
}

interface DockablePanelRenderPanelEntry {
  type: 'panel';
  key: string;
  layout: DockablePanelLayout;
}

interface DockablePanelRenderTabGroupEntry {
  type: 'tab-group';
  key: string;
  groupId: string;
  layouts: DockablePanelLayout[];
  activeLayout: DockablePanelLayout;
}

type DockablePanelRenderEntry = DockablePanelRenderPanelEntry | DockablePanelRenderTabGroupEntry;

interface DockableTabContextMenuState {
  x: number;
  y: number;
  layout: DockablePanelLayout;
}

export interface DockablePanelHostProps {
  workspaceId: string;
  panels: DockablePanelDefinition[];
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function DockablePanelHost({ workspaceId, panels, children, className = '', style }: DockablePanelHostProps) {
  const registerPanelDefaults = useDockablePanelStore((state) => state.registerPanelDefaults);
  const layouts = useDockablePanelStore((state) => state.layouts);
  const definitions = useMemo(
    () => new Map(panels.map((panel) => [panel.panelId, panel])),
    [panels],
  );
  const panelDefaultSignature = useMemo(
    () => createDockablePanelDefaultSignature(panels.map((panel) => ({
      workspaceId,
      panelId: panel.panelId,
      mode: panel.mode,
      dockZone: panel.dockZone,
      dockColumn: panel.dockColumn,
      floatingRect: panel.floatingRect,
      floatingRectSpace: panel.floatingRectSpace,
      minSize: panel.minSize,
      fixedSize: panel.fixedSize,
      tabGroupId: panel.tabGroupId,
      tabGroupOrder: panel.tabGroupOrder,
      tabGroupActive: panel.tabGroupActive,
    }))),
    [panels, workspaceId],
  );
  const viewport = useViewportSize();

  useEffect(() => {
    const panelDefaults = JSON.parse(panelDefaultSignature) as DockablePanelDefault[];
    registerPanelDefaults(panelDefaults);
  }, [panelDefaultSignature, registerPanelDefaults]);

  const workspaceLayouts = useMemo(
    () => Object.values(layouts).filter((layout) => layout.workspaceId === workspaceId && definitions.has(layout.panelId)),
    [definitions, layouts, workspaceId],
  );
  // Minimized (collapsed) panels in zones without an edge strip render as slim
  // floating strips, so they route with the floating layer, not the dock grid.
  const floatingPanels = sortPanelsByZOrder(
    workspaceLayouts.filter((layout) => layout.mode === 'floating' || isCollapsedFloatingDockablePanel(layout)),
  );
  const dockedPanels = sortDockedPanels(
    workspaceLayouts.filter(
      (layout) => (layout.mode === 'docked' || layout.mode === 'collapsed') && !isCollapsedFloatingDockablePanel(layout),
    ),
  );

  return (
    <div className={`relative min-h-0 min-w-0 overflow-hidden ${className}`} style={style}>
      <div className="grid h-full min-h-0 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_minmax(0,1fr)_auto] gap-0">
        <DockZoneStack className="col-span-3 row-start-1" layouts={dockedPanels} zone="top" definitions={definitions} viewport={viewport} />
        <DockZoneStack className="col-start-1 row-start-2" layouts={dockedPanels} zone="left" definitions={definitions} viewport={viewport} />
        <main className="relative col-start-2 row-start-2 min-h-0 min-w-0 overflow-hidden border border-white/5 bg-black/10">
          {children}
          <DockZoneStack className="absolute inset-3" layouts={dockedPanels} zone="center" definitions={definitions} viewport={viewport} />
          <DockZoneStack className="pointer-events-none absolute inset-3" layouts={dockedPanels} zone="overlay" definitions={definitions} viewport={viewport} />
        </main>
        <DockZoneStack className="col-start-3 row-start-2" layouts={dockedPanels} zone="right" definitions={definitions} viewport={viewport} />
        <DockZoneStack className="col-span-3 row-start-3" layouts={dockedPanels} zone="bottom" definitions={definitions} viewport={viewport} />
      </div>
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: Z_INDEX.floatingPanelBase }}>
        {buildDockablePanelRenderEntries(floatingPanels).map((entry) => renderPanelEntry(entry, definitions, viewport, 'pointer-events-auto'))}
      </div>
    </div>
  );
}

function DockZoneStack({
  zone,
  layouts,
  definitions,
  viewport,
  className = '',
}: {
  zone: DockZone;
  layouts: DockablePanelLayout[];
  definitions: Map<string, DockablePanelDefinition>;
  viewport: { width: number; height: number };
  className?: string;
}) {
  const zoneLayouts = layouts.filter((layout) => layout.dockZone === zone);
  const zoneEntries = buildDockablePanelRenderEntries(zoneLayouts);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const splitResizeRef = useRef<{
    pointerId: number;
    panelId: string;
    adjacentPanelId?: string;
    workspaceId: string;
    lastX: number;
    lastY: number;
  } | null>(null);
  const resizeDockedPanel = useDockablePanelStore((state) => state.resizeDockedPanel);
  const resizeAdjacentDockedPanelHeights = useDockablePanelStore((state) => state.resizeAdjacentDockedPanelHeights);
  const collapsedDockColumns = useDockablePanelStore((state) => state.collapsedDockColumns);
  const toggleDockColumnCollapsed = useDockablePanelStore((state) => state.toggleDockColumnCollapsed);
  const activeLayout = resolveActiveDockZoneLayout(zoneEntries.map(getRenderEntryHostLayout), activePanelId);
  const activeEntry = activeLayout ? zoneEntries.find((entry) => renderEntryContainsPanel(entry, activeLayout.panelId)) : undefined;
  // Entry-based: a tab group holding a split-capable panel (e.g. Inspector tabbed onto the Source
  // Monitor) keeps its split slot instead of degrading the whole center to a one-visible-tab strip.
  const shouldSplitCenter = shouldSplitDockZoneEntries(
    zone,
    zoneEntries.map((entry) => ({
      memberPanelIds: entry.type === 'panel'
        ? [entry.layout.panelId]
        : entry.layouts.map((member) => member.panelId),
    })),
    (panelId) => definitions.get(panelId)?.centerDockPresentation === 'split',
  );
  const isSideDockZone = zone === 'left' || zone === 'right';
  // Group side-zone panels into columns (by dockColumn), ordered left→right.
  const sideColumns: { column: number; entries: typeof zoneEntries }[] = isSideDockZone
    ? (() => {
        const byColumn = new Map<number, typeof zoneEntries>();
        for (const entry of zoneEntries) {
          const column = Math.max(0, Math.round(getRenderEntryHostLayout(entry).dockColumn ?? 0));
          const list = byColumn.get(column);
          if (list) list.push(entry);
          else byColumn.set(column, [entry]);
        }
        return [...byColumn.keys()].sort((a, b) => a - b).map((column) => ({ column, entries: byColumn.get(column)! }));
      })()
    : [];

  if (zoneEntries.length === 0) return null;
  if (!activeLayout) return null;
  const hostWorkspaceId = activeLayout.workspaceId;

  const startSplitResize = (
    event: PointerEvent<HTMLDivElement>,
    layout: DockablePanelLayout,
    adjacentLayout?: DockablePanelLayout,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    splitResizeRef.current = {
      pointerId: event.pointerId,
      panelId: layout.panelId,
      adjacentPanelId: adjacentLayout?.panelId,
      workspaceId: layout.workspaceId,
      lastX: event.clientX,
      lastY: event.clientY,
    };
  };

  const continueSplitResize = (event: PointerEvent<HTMLDivElement>, isVertical?: boolean) => {
    const current = splitResizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    
    if (isVertical) {
      const deltaY = event.clientY - current.lastY;
      if (deltaY !== 0 && current.adjacentPanelId) {
        resizeAdjacentDockedPanelHeights(
          current.workspaceId,
          current.panelId,
          current.adjacentPanelId,
          deltaY,
        );
        splitResizeRef.current = { ...current, lastY: event.clientY };
      }
    } else {
      const deltaX = event.clientX - current.lastX;
      if (deltaX !== 0) {
        resizeDockedPanel(
          current.workspaceId,
          current.panelId,
          { edgeX: 1, edgeY: 0, deltaX, deltaY: 0 },
          viewport,
        );
        splitResizeRef.current = { ...current, lastX: event.clientX };
      }
    }
  };

  const endSplitResize = (event: PointerEvent<HTMLDivElement>) => {
    const current = splitResizeRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    splitResizeRef.current = null;
  };

  return (
    <aside className={`min-h-0 min-w-0 ${className}`} style={{ zIndex: Z_INDEX.dockedPanel }}>
      {shouldSplitCenter ? (
        <div className="flex h-full min-h-0 min-w-0 gap-2">
          {zoneEntries.map((entry, index) => {
            const hostLayout = getRenderEntryHostLayout(entry);
            return (
            <Fragment key={entry.key}>
              <div
                className="flex min-h-0 min-w-0"
                style={{ flex: `${Math.max(1, hostLayout.floatingRect.width)} 1 0` }}
              >
                {renderPanelEntry(
                  entry,
                  definitions,
                  viewport,
                  'h-full min-w-0 flex-1',
                )}
              </div>
              {index < zoneEntries.length - 1 ? (
                <div
                  aria-label={`${definitions.get(hostLayout.panelId)?.title ?? hostLayout.panelId} split resize divider`}
                  className="w-2 shrink-0 cursor-col-resize touch-none rounded-full border-x border-cyan-200/10 bg-cyan-300/10 transition-colors hover:border-cyan-200/60 hover:bg-cyan-300/25"
                  onPointerCancel={endSplitResize}
                  onPointerDown={(event) => startSplitResize(event, hostLayout)}
                  onPointerMove={(e) => continueSplitResize(e, false)}
                  onPointerUp={endSplitResize}
                  role="separator"
                  title="Resize docked panels"
                />
              ) : null}
            </Fragment>
            );
          })}
        </div>
      ) : zoneEntries.length > 1 && (zone === 'center' || zone === 'overlay') ? (
        <div className="mb-1 flex max-w-full gap-1 overflow-auto rounded-lg border border-cyan-300/10 bg-[#08111d]/90 p-1">
          {zoneEntries.map((entry) => {
            const layout = getRenderEntryHostLayout(entry);
            const definition = definitions.get(layout.panelId);
            return (
              <button
                className={`rounded-md px-2 py-1 text-xs ${layout.panelId === activeLayout.panelId ? 'bg-cyan-300/20 text-white' : 'text-cyan-100/60 hover:bg-cyan-300/10'}`}
                key={layout.panelId}
                onClick={() => setActivePanelId(layout.panelId)}
                type="button"
              >
                {definition?.title ?? layout.panelId}
              </button>
            );
          })}
        </div>
      ) : null}
      {shouldSplitCenter ? null
        : isSideDockZone && zoneEntries.length > 1 ? (
        <div data-dock-zone-columns={zone} className="flex h-full min-h-0 min-w-0 flex-row gap-0">
          {sideColumns.map(({ column, entries: columnEntries }) => {
            const columnKey = `${hostWorkspaceId}:${zone}:${column}`;
            const collapsed = Boolean(collapsedDockColumns[columnKey]);
            const columnWidth = Math.max(...columnEntries.map((entry) => {
              const layout = getRenderEntryHostLayout(entry);
              return Math.max(layout.minSize.width, layout.floatingRect.width);
            }));
            if (collapsed) {
              const railLabel = columnEntries
                .map((entry) => definitions.get(getRenderEntryHostLayout(entry).panelId)?.title ?? '')
                .filter(Boolean)
                .join('   ·   ');
              return (
                <button
                  key={column}
                  type="button"
                  data-dock-zone-column-rail={column}
                  aria-label={`Expand ${zone} dock column ${column + 1}`}
                  className="flex h-full w-6 shrink-0 flex-col items-center gap-2 border-l border-cyan-300/10 bg-[#0a1018]/85 py-2 text-cyan-100/55 hover:text-white"
                  onClick={() => toggleDockColumnCollapsed(hostWorkspaceId, zone, column)}
                  title="Expand column"
                >
                  <ChevronLeft size={14} />
                  <span className="text-[10px] uppercase tracking-wider [writing-mode:vertical-rl]">{railLabel}</span>
                </button>
              );
            }
            return (
              <div
                key={column}
                data-dock-zone-column={column}
                className="relative flex h-full min-h-0 shrink-0 flex-row border-l border-cyan-300/5 first:border-l-0"
              >
                <div
                  data-dock-zone-stack={zone}
                  className="flex h-full min-h-0 min-w-0 flex-col items-stretch gap-0 overflow-y-auto overscroll-contain"
                  style={{ width: columnWidth }}
                >
                  {columnEntries.map((entry, index) => {
                    const layout = getRenderEntryHostLayout(entry);
                    const renderLayout = {
                      ...layout,
                      floatingRect: { ...layout.floatingRect, width: columnWidth },
                      // The stack wrapper owns the vertical minimum. If the panel keeps its larger
                      // authored/floating minimum here, CSS `min-height` makes it overflow the flex
                      // slot and visually overlap the following panel at shorter viewports.
                      minSize: {
                        ...layout.minSize,
                        width: Math.max(layout.minSize.width, columnWidth),
                        height: Math.min(layout.minSize.height, DOCKED_SIDE_PANEL_MIN_HEIGHT),
                      },
                    };
                    return (
                      <Fragment key={entry.key}>
                        <div
                          className="min-h-0 min-w-0 w-full shrink-0"
                          style={{ flex: `${Math.max(1, layout.floatingRect.height)} 1 0`, minHeight: DOCKED_SIDE_PANEL_MIN_HEIGHT }}
                          data-dock-zone-stack-panel={zone}
                        >
                          {renderPanelEntry(
                            entry.type === 'panel'
                              ? { ...entry, layout: renderLayout }
                              : { ...entry, activeLayout: renderLayout },
                            definitions,
                            viewport,
                            'w-full',
                          )}
                        </div>
                        {index < columnEntries.length - 1 ? (
                          <div
                            aria-label="Vertical resize divider"
                            className="h-2 w-full shrink-0 cursor-row-resize touch-none rounded-full border-y border-cyan-200/10 bg-cyan-300/10 transition-colors hover:border-cyan-200/60 hover:bg-cyan-300/25"
                            onPointerCancel={endSplitResize}
                            onPointerDown={(event) => startSplitResize(
                              event,
                              layout,
                              getRenderEntryHostLayout(columnEntries[index + 1]),
                            )}
                            onPointerMove={(e) => continueSplitResize(e, true)}
                            onPointerUp={endSplitResize}
                            role="separator"
                            title="Resize stacked panels"
                          />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
                <button
                  type="button"
                  data-dock-zone-column-collapse={column}
                  aria-label={`Collapse ${zone} dock column ${column + 1}`}
                  className="flex h-full w-3.5 shrink-0 items-center justify-center border-l border-cyan-300/10 bg-[#0a1018]/60 text-cyan-100/40 transition-colors hover:bg-cyan-300/15 hover:text-white"
                  onClick={() => toggleDockColumnCollapsed(hostWorkspaceId, zone, column)}
                  title="Collapse column"
                >
                  <ChevronRight size={11} />
                </button>
              </div>
            );
          })}
        </div>
      ) : zoneEntries.length > 1 && zone !== 'center' && zone !== 'overlay' ? (
        <div data-dock-zone-stack={zone} className="flex h-full min-h-0 min-w-0 flex-row gap-0">
          {zoneEntries.map((entry) => (
            <div key={entry.key} className="min-w-0 flex-1" data-dock-zone-stack-panel={zone}>
              {renderPanelEntry(entry, definitions, viewport, 'min-w-0 flex-1')}
            </div>
          ))}
        </div>
      ) : activeEntry ? renderPanelEntry(activeEntry, definitions, viewport) : null}
    </aside>
  );
}

function renderPanelEntry(
  entry: DockablePanelRenderEntry,
  definitions: Map<string, DockablePanelDefinition>,
  viewport: { width: number; height: number },
  className = '',
) {
  if (entry.type === 'tab-group') {
    return renderPanelGroup(entry, definitions, viewport, className);
  }
  return renderPanel(entry.layout, definitions, viewport, className);
}

function renderPanel(
  layout: DockablePanelLayout,
  definitions: Map<string, DockablePanelDefinition>,
  viewport: { width: number; height: number },
  className = '',
) {
  const definition = definitions.get(layout.panelId);
  if (!definition) return null;
  const renderLayout = prepareDockablePanelRenderLayout(layout, definition, viewport);
  return (
    <DockablePanel
      allowedDockZones={definition.allowedDockZones}
      bodyClassName={definition.bodyClassName}
      centerSplitCapable={definition.centerDockPresentation === 'split'}
      className={`${definition.className ?? ''} ${className}`}
      key={layout.panelId}
      layout={renderLayout}
      ariaModal={definition.ariaModal}
      chrome={definition.chrome}
      fixedSize={definition.fixedSize}
      role={definition.role}
      title={definition.title}
      viewport={viewport}
    >
      <ErrorBoundary
        className="min-h-full"
        level="panel"
        resetKeys={[layout.workspaceId, layout.panelId, layout.mode]}
        title={`${definition.title} Panel`}
      >
        {definition.content}
      </ErrorBoundary>
    </DockablePanel>
  );
}

function renderPanelGroup(
  entry: DockablePanelRenderTabGroupEntry,
  definitions: Map<string, DockablePanelDefinition>,
  viewport: { width: number; height: number },
  className = '',
) {
  const activeDefinition = definitions.get(entry.activeLayout.panelId);
  if (!activeDefinition) return null;
  const renderLayout = prepareDockablePanelRenderLayout(entry.activeLayout, activeDefinition, viewport);
  const activePanel = (
    <div data-dockable-tab-panel={entry.activeLayout.panelId}>
      <ErrorBoundary
        className="min-h-full"
        level="panel"
        resetKeys={[entry.activeLayout.workspaceId, entry.activeLayout.panelId, entry.activeLayout.mode]}
        title={`${activeDefinition.title} Panel`}
      >
        {activeDefinition.content}
      </ErrorBoundary>
    </div>
  );

  return (
    <DockablePanel
      allowedDockZones={activeDefinition.allowedDockZones}
      bodyClassName={activeDefinition.bodyClassName}
      className={`${activeDefinition.className ?? ''} ${className}`}
      key={entry.key}
      layout={renderLayout}
      ariaModal={activeDefinition.ariaModal}
      chrome={activeDefinition.chrome}
      externalWindowKey={entry.groupId}
      fixedSize={activeDefinition.fixedSize}
      role={activeDefinition.role}
      tabs={<DockablePanelTabStrip entry={entry} definitions={definitions} />}
      title={activeDefinition.title}
      viewport={viewport}
    >
      {activePanel}
    </DockablePanel>
  );
}

function DockablePanelTabStrip({
  entry,
  definitions,
}: {
  entry: DockablePanelRenderTabGroupEntry;
  definitions: Map<string, DockablePanelDefinition>;
}) {
  const activatePanelTab = useDockablePanelStore((state) => state.activatePanelTab);
  const floatPanel = useDockablePanelStore((state) => state.floatPanel);
  const reorderPanelTab = useDockablePanelStore((state) => state.reorderPanelTab);
  const resetPanelLayout = useDockablePanelStore((state) => state.resetPanelLayout);
  const ungroupPanelTab = useDockablePanelStore((state) => state.ungroupPanelTab);
  const orderedLayouts = sortTabGroupLayouts(entry.layouts);
  const [contextMenu, setContextMenu] = useState<DockableTabContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const openContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, layout: DockablePanelLayout) => {
    event.preventDefault();
    event.stopPropagation();
    activatePanelTab(layout.workspaceId, layout.panelId);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      layout,
    });
  };

  const runContextMenuAction = (action: () => void) => {
    action();
    setContextMenu(null);
  };

  const contextMenuIndex = contextMenu
    ? orderedLayouts.findIndex((layout) => layout.panelId === contextMenu.layout.panelId)
    : -1;
  const previousTab = contextMenuIndex > 0 ? orderedLayouts[contextMenuIndex - 1] : null;
  const nextTab = contextMenuIndex >= 0 && contextMenuIndex < orderedLayouts.length - 1
    ? orderedLayouts[contextMenuIndex + 1]
    : null;

  return (
    <div
      aria-label="Panel group tabs"
      className="relative flex min-w-0 max-w-full gap-0 overflow-x-auto"
      data-dockable-tab-list={entry.groupId}
      role="tablist"
    >
      {orderedLayouts.map((layout) => {
        const definition = definitions.get(layout.panelId);
        const active = layout.panelId === entry.activeLayout.panelId;
        return (
          <button
            aria-selected={active}
            className={`min-w-0 shrink-0 border-r border-cyan-300/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
              active
                ? 'bg-cyan-300/18 text-white'
                : 'bg-[#08111d] text-cyan-100/55 hover:bg-cyan-300/10 hover:text-cyan-50'
            }`}
            key={layout.panelId}
            onClick={(event) => {
              event.stopPropagation();
              activatePanelTab(layout.workspaceId, layout.panelId);
            }}
            onContextMenu={(event) => openContextMenu(event, layout)}
            onPointerDown={(event) => event.stopPropagation()}
            role="tab"
            title={definition?.title ?? layout.panelId}
            type="button"
          >
            <span className="block max-w-[9rem] truncate">{definition?.title ?? layout.panelId}</span>
          </button>
        );
      })}
      {contextMenu ? (
        <div
          aria-label="Panel tab context menu"
          className="theme-popover fixed min-w-40 overflow-hidden rounded-md border border-cyan-300/25 bg-[#08111d] py-1 text-left text-[11px] font-semibold text-cyan-50 shadow-2xl"
          data-dockable-tab-context-menu="true"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: Z_INDEX.contextMenu,
          }}
        >
          <DockableTabContextMenuButton
            action="activate"
            label="Activate Tab"
            onSelect={() => runContextMenuAction(() => activatePanelTab(contextMenu.layout.workspaceId, contextMenu.layout.panelId))}
          />
          <DockableTabContextMenuButton
            action="move-left"
            disabled={!previousTab}
            label="Move Tab Left"
            onSelect={() => {
              if (!previousTab) return;
              runContextMenuAction(() => reorderPanelTab(
                contextMenu.layout.workspaceId,
                contextMenu.layout.panelId,
                previousTab.panelId,
                'before',
              ));
            }}
          />
          <DockableTabContextMenuButton
            action="move-right"
            disabled={!nextTab}
            label="Move Tab Right"
            onSelect={() => {
              if (!nextTab) return;
              runContextMenuAction(() => reorderPanelTab(
                contextMenu.layout.workspaceId,
                contextMenu.layout.panelId,
                nextTab.panelId,
                'after',
              ));
            }}
          />
          <DockableTabContextMenuButton
            action="ungroup"
            label="Ungroup Tab"
            onSelect={() => runContextMenuAction(() => ungroupPanelTab(contextMenu.layout.workspaceId, contextMenu.layout.panelId))}
          />
          <DockableTabContextMenuButton
            action="float"
            label="Float Tab"
            onSelect={() => runContextMenuAction(() => floatPanel(contextMenu.layout.workspaceId, contextMenu.layout.panelId))}
          />
          <DockableTabContextMenuButton
            action="reset"
            label="Reset Panel"
            onSelect={() => runContextMenuAction(() => resetPanelLayout(contextMenu.layout.workspaceId, contextMenu.layout.panelId))}
          />
        </div>
      ) : null}
    </div>
  );
}

function DockableTabContextMenuButton({
  action,
  disabled = false,
  label,
  onSelect,
}: {
  action: string;
  disabled?: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      className="block w-full px-3 py-1.5 text-left hover:bg-cyan-300/12 disabled:cursor-not-allowed disabled:text-cyan-100/35 disabled:hover:bg-transparent"
      data-dockable-tab-menu-action={action}
      disabled={disabled}
      onClick={onSelect}
      role="menuitem"
      type="button"
    >
      {label}
    </button>
  );
}

function buildDockablePanelRenderEntries(layouts: DockablePanelLayout[]): DockablePanelRenderEntry[] {
  const groupMembers = new Map<string, DockablePanelLayout[]>();
  for (const layout of layouts) {
    if (!layout.tabGroupId) continue;
    const key = `${layout.workspaceId}/${layout.tabGroupId}`;
    const members = groupMembers.get(key) ?? [];
    members.push(layout);
    groupMembers.set(key, members);
  }

  const emittedGroups = new Set<string>();
  const entries: DockablePanelRenderEntry[] = [];
  for (const layout of layouts) {
    if (!layout.tabGroupId) {
      entries.push({ type: 'panel', key: layout.panelId, layout });
      continue;
    }

    const groupKey = `${layout.workspaceId}/${layout.tabGroupId}`;
    if (emittedGroups.has(groupKey)) continue;
    emittedGroups.add(groupKey);
    const members = groupMembers.get(groupKey) ?? [layout];
    if (members.length < 2) {
      entries.push({ type: 'panel', key: layout.panelId, layout });
      continue;
    }
    const activeLayout = createTabGroupHostLayout(members);
    entries.push({
      type: 'tab-group',
      key: groupKey,
      groupId: layout.tabGroupId,
      layouts: sortTabGroupLayouts(members),
      activeLayout,
    });
  }
  return entries;
}

function createTabGroupHostLayout(layouts: DockablePanelLayout[]): DockablePanelLayout {
  const activeLayout = sortTabGroupLayouts(layouts).find((layout) => layout.tabGroupActive) ?? sortTabGroupLayouts(layouts)[0];
  if (activeLayout.mode === 'floating') {
    return {
      ...activeLayout,
      floatingRect: { ...activeLayout.floatingRect },
      minSize: { ...activeLayout.minSize },
    };
  }
  const maxMinWidth = Math.max(...layouts.map((layout) => layout.minSize.width));
  const maxMinHeight = Math.max(...layouts.map((layout) => layout.minSize.height));
  const maxRectWidth = Math.max(...layouts.map((layout) => layout.floatingRect.width));
  const maxRectHeight = Math.max(...layouts.map((layout) => layout.floatingRect.height));
  return {
    ...activeLayout,
    minSize: {
      width: maxMinWidth,
      height: maxMinHeight,
    },
    floatingRect: {
      ...activeLayout.floatingRect,
      width: Math.max(activeLayout.floatingRect.width, maxRectWidth),
      height: Math.max(activeLayout.floatingRect.height, maxRectHeight),
    },
  };
}

function sortTabGroupLayouts(layouts: DockablePanelLayout[]): DockablePanelLayout[] {
  return [...layouts].sort((a, b) => (
    (a.tabGroupOrder ?? 0) - (b.tabGroupOrder ?? 0)
    || a.panelId.localeCompare(b.panelId)
  ));
}

function getRenderEntryHostLayout(entry: DockablePanelRenderEntry): DockablePanelLayout {
  return entry.type === 'tab-group' ? entry.activeLayout : entry.layout;
}

function renderEntryContainsPanel(entry: DockablePanelRenderEntry, panelId: string): boolean {
  return entry.type === 'panel'
    ? entry.layout.panelId === panelId
    : entry.layouts.some((layout) => layout.panelId === panelId);
}

export function prepareDockablePanelRenderLayout(
  layout: DockablePanelLayout,
  definition: Pick<DockablePanelDefinition, 'fixedSize' | 'floatingRect' | 'minSize'>,
  viewport: { width: number; height: number },
): DockablePanelLayout {
  const safeLayout = sanitizeDockablePanelLayout(
    layout,
    layout,
    viewport,
    layout.mode === 'floating'
      ? { constrainFloatingRectPosition: false, constrainFloatingRectSize: false }
      : undefined,
  );

  return definition.fixedSize
    ? {
        ...safeLayout,
        floatingRect: {
          ...safeLayout.floatingRect,
          width: Math.round(definition.floatingRect?.width ?? safeLayout.floatingRect.width),
          height: Math.round(definition.floatingRect?.height ?? safeLayout.floatingRect.height),
        },
        minSize: {
          width: Math.round(definition.minSize?.width ?? safeLayout.minSize.width),
          height: Math.round(definition.minSize?.height ?? safeLayout.minSize.height),
        },
      }
    : safeLayout;
}

function useViewportSize() {
  const read = () => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  });
  const [size, setSize] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setSize(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}
