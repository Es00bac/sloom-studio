import { useEffect, useMemo, useState } from 'react';
import { DockablePanel } from '../DockablePanel/DockablePanel';
import {
  createDefaultDockablePanelLayout,
  panelKey,
  sanitizeDockablePanelLayout,
  type DockablePanelLayout,
  type DockZone,
} from '../../lib/dockablePanel';
import {
  getSharedWorkspacePanelBodyClassName,
  getSharedWorkspacePanelDefaults,
  getSharedWorkspacePanelTopOffsetPx,
  type SharedWorkspaceId,
  type SharedWorkspacePanelDefault,
} from '../../lib/sharedWorkspacePanelDefaults';
import { Z_INDEX } from '../../lib/zIndex';
import { useDockablePanelStore } from '../../store/dockablePanelStore';
import { FlowBookmarkSidebar } from './FlowBookmarkSidebar';
import { FlowSourceBinSidebar } from './FlowSourceBinSidebar';

interface SharedWorkspaceDockablePanelsProps {
  workspaceId: SharedWorkspaceId;
  onCenterBookmarkNode: (nodeId: string) => void;
}

interface SharedPanelEntry {
  definition: SharedWorkspacePanelDefault;
  layout: DockablePanelLayout;
}

export function SharedWorkspaceDockablePanels({
  workspaceId,
  onCenterBookmarkNode,
}: SharedWorkspaceDockablePanelsProps) {
  const defaults = useMemo(() => getSharedWorkspacePanelDefaults(workspaceId), [workspaceId]);
  const registerPanelDefaults = useDockablePanelStore((state) => state.registerPanelDefaults);
  const layouts = useDockablePanelStore((state) => state.layouts);
  const viewport = useViewportSize();

  useEffect(() => {
    registerPanelDefaults(defaults);
  }, [defaults, registerPanelDefaults]);

  const panelEntries = useMemo(
    () =>
      defaults.map((definition, index) => {
        const key = panelKey(workspaceId, definition.panelId);
        const defaultLayout = createDefaultDockablePanelLayout(definition, index);
        const layout = sanitizeDockablePanelLayout(
          layouts[key],
          defaultLayout,
          viewport,
          { constrainFloatingRectPosition: false, constrainFloatingRectSize: false },
        );
        return { definition, layout };
      }),
    [defaults, layouts, viewport, workspaceId],
  );
  const visibleEntries = panelEntries.filter((entry) => entry.layout.mode !== 'hidden');
  const dockedEntries = sortSharedPanelEntries(
    visibleEntries.filter((entry) => entry.layout.mode === 'docked' || entry.layout.mode === 'collapsed'),
  );
  const floatingEntries = sortSharedPanelEntries(visibleEntries.filter((entry) => entry.layout.mode === 'floating'));
  const topOffsetPx = getSharedWorkspacePanelTopOffsetPx(workspaceId);

  return (
    <div className="pointer-events-none absolute inset-0" style={{ zIndex: Z_INDEX.dockedPanel }}>
      {(['left', 'right', 'top', 'bottom', 'overlay'] as const).map((zone) => (
        <SharedDockZoneStack
          entries={dockedEntries}
          key={zone}
          onCenterBookmarkNode={onCenterBookmarkNode}
          topOffsetPx={topOffsetPx}
          viewport={viewport}
          zone={zone}
        />
      ))}
      {floatingEntries.map((entry) => renderSharedPanel(entry.definition, entry.layout, viewport, onCenterBookmarkNode))}
    </div>
  );
}

function SharedDockZoneStack({
  zone,
  entries,
  viewport,
  topOffsetPx,
  onCenterBookmarkNode,
}: {
  zone: DockZone;
  entries: SharedPanelEntry[];
  viewport: { width: number; height: number };
  topOffsetPx: number;
  onCenterBookmarkNode: (nodeId: string) => void;
}) {
  const zoneEntries = entries.filter((entry) => entry.layout.dockZone === zone);
  if (zoneEntries.length === 0) return null;

  if (zone === 'overlay') {
    return (
      <div
        className="absolute left-1/2 flex max-h-[calc(100%-6rem)] w-[min(520px,calc(100%-2rem))] -translate-x-1/2 flex-col gap-0 pointer-events-none"
        style={{ top: topOffsetPx + 16 }}
      >
        {zoneEntries.map((entry, index) => renderSharedPanel(
          entry.definition,
          entry.layout,
          viewport,
          onCenterBookmarkNode,
          `h-auto min-h-0 rounded-none ${entry.layout.mode === 'collapsed' ? `mt-2 ${index === 0 ? 'mt-8' : ''}` : 'flex-1'}`,
        ))}
      </div>
    );
  }

  if (zone === 'top' || zone === 'bottom') {
    return (
      <div
        className={`absolute ${zone === 'bottom' ? 'bottom-0' : ''} left-0 right-0 flex min-w-0 ${zone === 'top' ? 'flex-row' : 'flex-row-reverse'} gap-0 pointer-events-none`}
        style={zone === 'top' ? { top: topOffsetPx } : undefined}
      >
        {zoneEntries.map((entry, index) => renderSharedPanel(
          entry.definition,
          entry.layout,
          viewport,
          onCenterBookmarkNode,
          `min-w-0 rounded-none ${entry.layout.mode === 'collapsed' ? `ml-2 ${index === 0 ? 'ml-8' : ''}` : 'flex-1'}`,
        ))}
      </div>
    );
  }

  const edgeClassName = zone === 'right' ? 'right-0' : 'left-0';
  // Only stretch the edge container full-height when a panel is actually
  // expanded (its `flex-1` child needs the room). When every panel is a
  // collapsed handle, anchoring both top AND bottom turned the rail into a
  // full-height invisible strip; dropping `bottom-0` lets it be content-height,
  // i.e. a genuine compact handle rail.
  const edgeHasExpandedPanel = zoneEntries.some((entry) => entry.layout.mode !== 'collapsed');
  return (
    <div
      className={`absolute ${edgeHasExpandedPanel ? 'bottom-0' : ''} ${edgeClassName} flex min-h-0 flex-col gap-0 pointer-events-none`}
      style={{ top: topOffsetPx }}
    >
      {zoneEntries.map((entry, index) => renderSharedPanel(
        entry.definition,
        entry.layout,
        viewport,
        onCenterBookmarkNode,
        `h-auto min-h-0 rounded-none ${entry.layout.mode === 'collapsed' ? `mt-2 ${index === 0 ? 'mt-24' : ''}` : 'flex-1'}`,
      ))}
    </div>
  );
}

function renderSharedPanel(
  definition: SharedWorkspacePanelDefault,
  layout: DockablePanelLayout,
  viewport: { width: number; height: number },
  onCenterBookmarkNode: (nodeId: string) => void,
  className = '',
) {
  return (
    <DockablePanel
      allowedDockZones={definition.allowedDockZones}
      bodyClassName={getSharedWorkspacePanelBodyClassName(definition.panelId)}
      className={`pointer-events-auto ${className}`}
      key={definition.panelId}
      layout={layout}
      title={definition.title}
      viewport={viewport}
    >
      {renderPanelContent(definition.panelId, layout.workspaceId as SharedWorkspaceId, onCenterBookmarkNode)}
    </DockablePanel>
  );
}

function renderPanelContent(
  panelId: SharedWorkspacePanelDefault['panelId'],
  workspaceId: SharedWorkspaceId,
  onCenterBookmarkNode: (nodeId: string) => void,
) {
  if (panelId === 'source-bin') return <FlowSourceBinSidebar dockable workspaceId={workspaceId} />;
  return <FlowBookmarkSidebar dockable onCenterNode={onCenterBookmarkNode} />;
}

function sortSharedPanelEntries(entries: SharedPanelEntry[]): SharedPanelEntry[] {
  return [...entries].sort((a, b) => (
    a.layout.dockZone.localeCompare(b.layout.dockZone)
    || a.layout.zOrder - b.layout.zOrder
    || a.layout.panelId.localeCompare(b.layout.panelId)
  ));
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
