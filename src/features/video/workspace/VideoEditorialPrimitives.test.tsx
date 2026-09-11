/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdvancedTrimClip, AdvancedTrimTrack } from '../../../lib/videoAdvancedTrim';
import { buildVideoTimelineNavigationModel } from '../../../lib/videoTimelineNavigation';
import { beginVideoTrimToolSession } from '../../../lib/videoTimelineToolSessions';
import { CommandPaletteDialog } from './CommandPaletteDialog';
import { TimelineMinimap } from './TimelineMinimap';
import { TrimSessionOverlay } from './TrimSessionOverlay';

describe('Video editorial integration primitives', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders an accessible contextual command dialog and emits one command ID', () => {
    const onInvoke = vi.fn();
    const markup = renderToStaticMarkup(
      <CommandPaletteDialog context="timeline" onClose={vi.fn()} onInvoke={onInvoke} onQueryChange={vi.fn()} open query="rate stretch" />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('Rate Stretch Tool');
    act(() => root.render(<CommandPaletteDialog context="timeline" onClose={vi.fn()} onInvoke={onInvoke} onQueryChange={vi.fn()} open query="rate stretch" />));
    const option = container.querySelector<HTMLButtonElement>('[role="option"]');
    act(() => option?.click());
    expect(onInvoke).toHaveBeenCalledWith('video.tools.rate-stretch');
  });

  it('exposes trim delta, commit, and cancel through coarse callbacks', () => {
    const tracks: AdvancedTrimTrack[] = [{ id: 'v1', kind: 'video', locked: false }];
    const clips: AdvancedTrimClip[] = [{
      id: 'clip', kind: 'video', trackId: 'v1', startMs: 0, durationMs: 1_000,
      sourceInMs: 2_000, sourceDurationMs: 10_000, playbackRate: 1, reverse: false,
    }];
    const begun = beginVideoTrimToolSession(clips, tracks, { mode: 'slip', primaryClipId: 'clip', framesPerSecond: 25 });
    if (!begun.ok) throw new Error(begun.reason);
    const onUpdate = vi.fn();
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    act(() => root.render(<TrimSessionOverlay onCancel={onCancel} onCommit={onCommit} onUpdate={onUpdate} session={begun.session} />));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('+0 frames');
    const input = container.querySelector<HTMLInputElement>('[aria-label="Trim delta milliseconds"]');
    act(() => {
      if (!input) return;
      setNativeInputValue(input, '80');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith({ deltaMs: 80, source: 'numeric' });
    const apply = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Apply trim');
    act(() => apply?.click());
    expect(onCommit).toHaveBeenCalledOnce();
  });

  it('renders a bounded minimap and emits typed seek and viewport navigation', () => {
    const built = buildVideoTimelineNavigationModel({
      durationMs: 10_000,
      trackCount: 1,
      bucketCount: 4,
      clips: [{ id: 'clip', trackIndex: 0, startMs: 1_000, durationMs: 2_000, kind: 'video' }],
      viewport: { startMs: 0, endMs: 2_000 },
      workArea: { startMs: 1_000, endMs: 8_000 },
    });
    if (!built.ok) throw new Error(built.reason);
    const onNavigate = vi.fn();
    const markup = renderToStaticMarkup(<TimelineMinimap model={built.model} onNavigate={onNavigate} playheadMs={1_000} />);
    expect(markup).toContain('aria-label="Timeline overview"');
    expect(markup).toContain('4 buckets');
    expect(markup).toContain('Clear work area');
    act(() => root.render(<TimelineMinimap model={built.model} onNavigate={onNavigate} playheadMs={1_000} />));
    const slider = container.querySelector<HTMLInputElement>('[aria-label="Timeline overview playhead"]');
    act(() => {
      if (!slider) return;
      setNativeInputValue(slider, '5000');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'seek', timeMs: 5_000 });
    const later = container.querySelector<HTMLButtonElement>('[aria-label="Move timeline viewport later"]');
    act(() => later?.click());
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'viewport', range: { startMs: 1_600, endMs: 3_600 } });
  });
});

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
}
