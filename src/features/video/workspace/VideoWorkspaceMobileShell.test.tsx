// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoWorkspaceMobileShell } from './VideoWorkspaceMobileShell';
import { VIDEO_PANEL_IDS } from '../../../lib/videoDockablePanels';
import type { DockablePanelDefinition } from '../../../components/DockablePanel';

const makePanel = (panelId: string, title: string): DockablePanelDefinition =>
  ({
    panelId,
    workspaceId: 'video',
    title,
    content: <div data-testid={`content-${panelId}`}>{title} content</div>,
  }) as unknown as DockablePanelDefinition;

const panels: DockablePanelDefinition[] = [
  makePanel(VIDEO_PANEL_IDS.programMonitor, 'Program Monitor'),
  makePanel(VIDEO_PANEL_IDS.timeline, 'Timeline'),
  makePanel(VIDEO_PANEL_IDS.inspector, 'Inspector'),
  makePanel(VIDEO_PANEL_IDS.projectSourceBin, 'Project Source Bin'),
];

describe('VideoWorkspaceMobileShell', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  const render = () => {
    act(() => {
      root!.render(<VideoWorkspaceMobileShell panels={panels} />);
    });
  };

  it('pins the program monitor as the preview region', () => {
    render();
    const preview = document.querySelector('[data-mobile-video-preview="true"]');
    expect(preview).not.toBeNull();
    expect(
      preview?.querySelector(`[data-testid="content-${VIDEO_PANEL_IDS.programMonitor}"]`),
    ).not.toBeNull();
  });

  it('shows editing panels as tabs (relabeled) and defaults to Timeline', () => {
    render();
    const tablist = document.querySelector('[role="tablist"]');
    expect(tablist?.textContent).toContain('Timeline');
    expect(tablist?.textContent).toContain('Clip'); // inspector relabeled for phone
    expect(tablist?.textContent).toContain('Source');
    const active = document.querySelector('[data-mobile-video-active-panel]');
    expect(active?.getAttribute('data-mobile-video-active-panel')).toBe(VIDEO_PANEL_IDS.timeline);
    expect(document.querySelector(`[data-testid="content-${VIDEO_PANEL_IDS.timeline}"]`)).not.toBeNull();
  });

  it('switches the active panel when a tab is tapped', () => {
    render();
    const tabs = [...document.querySelectorAll('[role="tab"]')] as HTMLButtonElement[];
    const sourceTab = tabs.find((tab) => tab.textContent === 'Source');
    expect(sourceTab).toBeTruthy();
    act(() => {
      sourceTab!.click();
    });
    const active = document.querySelector('[data-mobile-video-active-panel]');
    expect(active?.getAttribute('data-mobile-video-active-panel')).toBe(VIDEO_PANEL_IDS.projectSourceBin);
    expect(
      document.querySelector(`[data-testid="content-${VIDEO_PANEL_IDS.projectSourceBin}"]`),
    ).not.toBeNull();
    // mount-active-only: the timeline content is no longer mounted after switching away
    expect(document.querySelector(`[data-testid="content-${VIDEO_PANEL_IDS.timeline}"]`)).toBeNull();
  });

  it('uses a bounded roving tab stop so a keyboard can reach every live panel', () => {
    render();
    const timeline = [...document.querySelectorAll('[role="tab"]')]
      .find((tab): tab is HTMLButtonElement => tab.textContent === 'Timeline');
    const clip = [...document.querySelectorAll('[role="tab"]')]
      .find((tab): tab is HTMLButtonElement => tab.textContent === 'Clip');
    expect(timeline).toBeTruthy();
    expect(clip).toBeTruthy();
    expect(timeline?.tabIndex).toBe(0);
    expect(clip?.tabIndex).toBe(-1);

    act(() => {
      timeline!.focus();
      timeline!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });

    expect(clip?.getAttribute('aria-selected')).toBe('true');
    expect(clip?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(clip);
    expect(clip?.getAttribute('aria-controls')).toBe(`mobile-video-panel-${VIDEO_PANEL_IDS.inspector}`);
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(clip?.id);
  });

  it('does not render the program monitor as a tab', () => {
    render();
    const tabLabels = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabLabels).not.toContain('Program Monitor');
  });

  it('renders an honest phone gate notice about the reduced experience (F10)', () => {
    render();
    const gate = document.querySelector('[data-mobile-video-gate="true"]');
    expect(gate).not.toBeNull();
    expect(gate?.textContent).toContain('focused clip edits');
    expect(gate?.textContent).toContain('desktop or a tablet');
  });

  it('is available immediately rather than sitting behind the former first-session blocking advisory', () => {
    const workspaceSource = readFileSync(resolve(process.cwd(), 'src/features/video/workspace/VideoWorkspace.tsx'), 'utf8');
    expect(workspaceSource).toContain('<VideoWorkspaceMobileShell');
    expect(workspaceSource).not.toContain('data-video-phone-advisory');
  });
});
