import { describe, expect, it } from 'vitest';
import { panelKey } from './dockablePanel';
import {
  VIDEO_PANEL_IDS,
  VIDEO_WORKSPACE_ID,
  buildVideoDockablePanelDefaults,
} from './videoDockablePanels';

describe('video dockable panel defaults', () => {
  it('defines all primary Video workspace panels with persisted video workspace keys', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: true,
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinWidth: 300,
      inspectorWidth: 280,
      monitorSplitPercent: 50,
      monitorSectionHeight: 560,
    });

    expect(defaults.map((panel) => panel.panelId)).toEqual(Object.values(VIDEO_PANEL_IDS));
    expect(defaults.every((panel) => panel.workspaceId === VIDEO_WORKSPACE_ID)).toBe(true);
    expect(panelKey(VIDEO_WORKSPACE_ID, VIDEO_PANEL_IDS.programMonitor)).toBe('video/program-monitor');
  });

  it('migrates existing editor visibility state into first-run panel modes', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: false,
      sourceMonitorVisible: false,
      programMonitorVisible: false,
      inspectorVisible: false,
      sourceBinWidth: 340,
      inspectorWidth: 320,
      monitorSplitPercent: 60,
      monitorSectionHeight: 480,
    });
    const byId = new Map(defaults.map((panel) => [panel.panelId, panel]));

    expect(byId.get(VIDEO_PANEL_IDS.projectSourceBin)?.mode).toBe('hidden');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.dockZone).toBe('center');
    expect(byId.get(VIDEO_PANEL_IDS.programMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.programMonitor)?.dockZone).toBe('center');
    expect(byId.get(VIDEO_PANEL_IDS.inspector)?.mode).toBe('hidden');
    expect(byId.get(VIDEO_PANEL_IDS.timeline)?.mode).toBe('docked');
  });

  it('uses legacy split and size settings for floating migration rects', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: true,
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinWidth: 360,
      inspectorWidth: 340,
      monitorSplitPercent: 70,
      monitorSectionHeight: 640,
    });
    const source = defaults.find((panel) => panel.panelId === VIDEO_PANEL_IDS.sourceMonitor);
    const program = defaults.find((panel) => panel.panelId === VIDEO_PANEL_IDS.programMonitor);
    const inspector = defaults.find((panel) => panel.panelId === VIDEO_PANEL_IDS.inspector);

    expect(source?.floatingRect).toMatchObject({ x: 400, width: 672, height: 640 });
    expect(program?.floatingRect).toMatchObject({ width: 420, height: 640 });
    expect(inspector?.floatingRect?.width).toBe(340);
  });

  it('keeps reset defaults focused on the program monitor and timeline instead of docking every secondary panel', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: true,
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinWidth: 300,
      inspectorWidth: 320,
      monitorSplitPercent: 50,
      monitorSectionHeight: 520,
    });
    const byId = new Map(defaults.map((panel) => [panel.panelId, panel]));

    expect(byId.get(VIDEO_PANEL_IDS.projectSourceBin)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.programMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.inspector)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.timeline)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.dockZone).toBe('center');
    expect(byId.get(VIDEO_PANEL_IDS.premiereParity)?.mode).toBe('hidden');
    expect(byId.get(VIDEO_PANEL_IDS.sequenceSettings)?.mode).toBe('hidden');
    expect(byId.get(VIDEO_PANEL_IDS.exportPreset)?.mode).toBe('hidden');
    expect(byId.get(VIDEO_PANEL_IDS.diagnostics)?.mode).toBe('hidden');
    const timeline = byId.get(VIDEO_PANEL_IDS.timeline);
    expect(timeline).toBeDefined();
    expect(timeline?.floatingRect?.height ?? 0).toBeGreaterThanOrEqual(280);
    expect(timeline?.floatingRect?.height ?? 0).toBeLessThanOrEqual(400);
    expect(timeline?.minSize?.height ?? 0).toBeLessThanOrEqual(280);
  });

  it('keeps the reset monitors plus timeline vertical budget workable on common laptop heights', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: true,
      sourceMonitorVisible: false,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinWidth: 280,
      inspectorWidth: 320,
      monitorSplitPercent: 50,
      monitorSectionHeight: 440,
    });
    const byId = new Map(defaults.map((panel) => [panel.panelId, panel]));
    const program = byId.get(VIDEO_PANEL_IDS.programMonitor);
    const timeline = byId.get(VIDEO_PANEL_IDS.timeline);

    expect((program?.minSize?.height ?? 0) + (timeline?.floatingRect?.height ?? 0)).toBeLessThanOrEqual(620);
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.dockZone).toBe('center');
  });

  it('gives the default side-by-side monitors a usable bottom timeline area', () => {
    const defaults = buildVideoDockablePanelDefaults({
      sourceBinVisible: true,
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinWidth: 280,
      inspectorWidth: 320,
      monitorSplitPercent: 50,
      monitorSectionHeight: 440,
    });
    const byId = new Map(defaults.map((panel) => [panel.panelId, panel]));

    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.programMonitor)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.timeline)?.mode).toBe('docked');
    expect(byId.get(VIDEO_PANEL_IDS.timeline)?.dockZone).toBe('bottom');
    expect(byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.floatingRect?.width ?? 0).toBeGreaterThan(
      byId.get(VIDEO_PANEL_IDS.sourceMonitor)?.minSize?.width ?? 0,
    );
    expect(byId.get(VIDEO_PANEL_IDS.programMonitor)?.floatingRect?.width ?? 0).toBeGreaterThan(
      byId.get(VIDEO_PANEL_IDS.programMonitor)?.minSize?.width ?? 0,
    );
    expect(byId.get(VIDEO_PANEL_IDS.timeline)?.floatingRect?.height ?? 0).toBeGreaterThanOrEqual(360);
  });
});
