import { useCallback, useRef, useState } from 'react';
import type { DockablePanelDefinition } from '../../../components/DockablePanel';
import { VIDEO_PANEL_IDS } from '../../../lib/videoDockablePanels';

/**
 * Phone layout for the video workspace (approved design: "preview + tabbed NLE panels").
 *
 * A traditional multi-pane NLE doesn't fit a phone, so instead of the desktop
 * DockablePanelHost we keep the Program Monitor preview pinned at the top and turn the
 * remaining workspace panels into a horizontally scrollable tab bar, showing one
 * full-width panel at a time. Crucially we reuse the EXACT same panel `content` nodes the
 * desktop builds (real preview, real multi-track timeline, real inspector, real source
 * bin) — this is a layout-only shell over the same `.sloom` timeline/store data, not a
 * reimplementation.
 */

const MOBILE_TAB_ORDER: readonly string[] = [
  VIDEO_PANEL_IDS.timeline,
  VIDEO_PANEL_IDS.inspector,
  VIDEO_PANEL_IDS.projectSourceBin,
  VIDEO_PANEL_IDS.sequenceSettings,
  VIDEO_PANEL_IDS.exportPreset,
  VIDEO_PANEL_IDS.premiereParity,
  VIDEO_PANEL_IDS.diagnostics,
];

// Short, thumb-friendly labels for the phone tab bar (desktop titles are too long).
const MOBILE_TAB_LABELS: Record<string, string> = {
  [VIDEO_PANEL_IDS.timeline]: 'Timeline',
  [VIDEO_PANEL_IDS.inspector]: 'Clip',
  [VIDEO_PANEL_IDS.projectSourceBin]: 'Source',
  [VIDEO_PANEL_IDS.sequenceSettings]: 'Sequence',
  [VIDEO_PANEL_IDS.exportPreset]: 'Export',
  [VIDEO_PANEL_IDS.premiereParity]: 'Readiness',
  [VIDEO_PANEL_IDS.diagnostics]: 'Diagnostics',
};

export interface VideoWorkspaceMobileShellProps {
  panels: DockablePanelDefinition[];
  previewPanelId?: string;
}

export function VideoWorkspaceMobileShell({
  panels,
  previewPanelId = VIDEO_PANEL_IDS.programMonitor,
}: VideoWorkspaceMobileShellProps) {
  const previewPanel = panels.find((panel) => panel.panelId === previewPanelId);
  const tabPanels = MOBILE_TAB_ORDER.map((panelId) =>
    panels.find((panel) => panel.panelId === panelId),
  ).filter((panel): panel is DockablePanelDefinition => Boolean(panel));

  const [activePanelId, setActivePanelId] = useState<string>(tabPanels[0]?.panelId ?? '');
  const activePanel = tabPanels.find((panel) => panel.panelId === activePanelId) ?? tabPanels[0];
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const activatePanel = useCallback((panelId: string, focus = false) => {
    setActivePanelId(panelId);
    if (focus) {
      tabRefs.current.get(panelId)?.focus();
    }
  }, []);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, panelId: string) => {
    const index = tabPanels.findIndex((panel) => panel.panelId === panelId);
    if (index < 0 || tabPanels.length === 0) return;

    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabPanels.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabPanels.length) % tabPanels.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabPanels.length - 1;
    else return;

    event.preventDefault();
    activatePanel(tabPanels[nextIndex].panelId, true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-mobile-video-shell="true">
      {/*
        F10 phone gate — the desktop multi-pane NLE can't fully fit a phone, so this shell is
        an honestly reduced experience (preview + core panels). This notice sets that
        expectation instead of pretending the full editor is available here.
      */}
      <div
        className="shrink-0 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-100/90"
        data-mobile-video-gate="true"
      >
        Phone Video keeps the live Program Monitor and one real editor panel at a time. Use Timeline
        for focused clip edits; precision multi-track trimming and rendering work best on desktop or a tablet.
      </div>

      {previewPanel ? (
        <div
          className="min-h-0 shrink-0 overflow-hidden rounded-xl border border-gray-700/60 bg-black/50"
          data-mobile-video-preview="true"
          style={{ height: 'clamp(170px, 38vh, 420px)' }}
        >
          {previewPanel.content}
        </div>
      ) : null}

      <div
        aria-label="Video editor panels"
        className="flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-gray-700/60 bg-[#0f131b] p-1"
        role="tablist"
      >
        {tabPanels.map((panel) => {
          const isActive = activePanel?.panelId === panel.panelId;
          return (
            <button
              aria-controls={`mobile-video-panel-${panel.panelId}`}
              aria-selected={isActive}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive ? 'bg-cyan-500/20 text-cyan-50' : 'text-gray-400 hover:text-white'
              }`}
              id={`mobile-video-tab-${panel.panelId}`}
              key={panel.panelId}
              onClick={() => activatePanel(panel.panelId)}
              onKeyDown={(event) => handleTabKeyDown(event, panel.panelId)}
              ref={(element) => {
                if (element) tabRefs.current.set(panel.panelId, element);
                else tabRefs.current.delete(panel.panelId);
              }}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              type="button"
            >
              {MOBILE_TAB_LABELS[panel.panelId] ?? panel.title}
            </button>
          );
        })}
      </div>

      <div
        className="min-h-0 flex-1 overflow-hidden rounded-xl border border-gray-700/60 bg-[#0b0e14]"
        data-mobile-video-active-panel={activePanel?.panelId}
        id={activePanel ? `mobile-video-panel-${activePanel.panelId}` : undefined}
        aria-labelledby={activePanel ? `mobile-video-tab-${activePanel.panelId}` : undefined}
        role="tabpanel"
      >
        {activePanel?.content}
      </div>
    </div>
  );
}
