/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_VIDEO_RICH_MARKER_TIME_MS, type VideoRichMarker } from '../../../lib/videoRichMarkers';
import { createVideoTimelineSearchIndex, updateVideoTimelineSearchShard } from '../../../lib/videoTimelineSearchIndex';
import { SearchMarkersPanel, VIDEO_MARKER_PAGE_SIZE, type SearchMarkersPanelProps } from './SearchMarkersPanel';

const markers: VideoRichMarker[] = [
  { id: 'note-a', name: 'First note', notes: 'Check eyeline', kind: 'comment', color: '#22d3ee', target: { kind: 'point', timeMs: 1_000 }, createdAt: 1, updatedAt: 1 },
  { id: 'note-b', name: 'Chapter two', notes: '', kind: 'chapter', color: '#f59e0b', target: { kind: 'range', startMs: 5_000, endMs: 8_000 }, createdAt: 2, updatedAt: 2 },
];

function createProps(): SearchMarkersPanelProps {
  const index = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), {
    shardId: 'sequence-a', revision: 'rev-1', documents: [
      { id: 'clip-a', entityKind: 'clip', label: 'Interview closeup', sequenceId: 'sequence-a', clipId: 'clip-a', startMs: 2_000, onlineState: 'online', proxyState: 'ready', effectNames: ['Warm'] },
      { id: 'caption-a', entityKind: 'caption', label: 'Welcome home', sequenceId: 'sequence-a', startMs: 3_000 },
    ],
  });
  return {
    index, markers, currentTimeMs: 2_500, activeSequenceId: 'sequence-a', selectedClipId: 'clip-a',
    onNavigate: vi.fn(), onMarkerCommand: vi.fn(), onQueryChange: vi.fn(),
  };
}

describe('SearchMarkersPanel', () => {
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

  it('renders accessible search/marker tabs with honest indexing and visible limits', () => {
    const markup = renderToStaticMarkup(<SearchMarkersPanel {...createProps()} />);
    expect(markup).toContain('aria-label="Timeline search and markers"');
    expect(markup.match(/role="tab"/gu)).toHaveLength(2);
    expect(markup.match(/aria-controls=/gu)).toHaveLength(2);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('Revision-indexed project metadata');
    expect(markup).toContain('capped at 500');
    expect(markup).toContain('Search project metadata');
  });

  it('searches indexed metadata and emits navigation/query callbacks', () => {
    const props = createProps();
    act(() => root.render(<SearchMarkersPanel {...props} />));
    changeInput('Search project metadata', 'welcome');
    expect(props.onQueryChange).toHaveBeenCalledWith('welcome');
    clickButton('Welcome home');
    expect(props.onNavigate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'search-result', result: expect.objectContaining({ document: expect.objectContaining({ id: 'caption-a' }) }),
    }));
  });

  it('authors, navigates, exchanges, and confirms deletion through typed marker callbacks', () => {
    const props = createProps();
    act(() => root.render(<SearchMarkersPanel {...props} />));
    clickButton('Markers · 2');
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain('Markers · 2');
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('2/20,000 markers');
    expect(container.querySelector('[aria-label^="Go to First note"]')?.getAttribute('aria-label')).toContain('comment point marker');
    expect(container.querySelector('[aria-label^="Go to First note"]')?.getAttribute('aria-label')).toContain('color #22d3ee');
    clickButton('Next marker');
    expect(props.onNavigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'marker', marker: expect.objectContaining({ id: 'note-b' }) }));

    changeInput('Marker name', 'Range review');
    changeSelect('Marker target', 'range');
    clickButton('Add at playhead');
    expect(props.onMarkerCommand).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'add-marker', draft: expect.objectContaining({ name: 'Range review', target: { kind: 'range', startMs: 2_500, endMs: 7_500 } }),
    }));
    clickButton('Import JSON');
    clickButton('Export CSV');
    expect(props.onMarkerCommand).toHaveBeenCalledWith({ kind: 'request-import', format: 'json' });
    expect(props.onMarkerCommand).toHaveBeenCalledWith({ kind: 'request-export', format: 'csv' });

    const deleteFirst = container.querySelector('[aria-label="Delete First note"]');
    expect(deleteFirst?.getAttribute('aria-expanded')).toBe('false');
    clickButton('Delete First note');
    expect(deleteFirst?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="alertdialog"][aria-label="Confirm marker removal"]')).not.toBeNull();
    expect(props.onMarkerCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete-marker' }));
    clickButton('Cancel');
    expect(deleteFirst?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(props.onMarkerCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete-marker' }));
    clickButton('Delete First note');
    clickButton('Confirm remove');
    expect(props.onMarkerCommand).toHaveBeenCalledWith({ kind: 'delete-marker', markerId: 'note-a' });
  });

  it('pages large marker collections and exposes native-sync resource failures visibly', () => {
    const props = createProps();
    props.markers = Array.from({ length: VIDEO_MARKER_PAGE_SIZE * 2 + 1 }, (_, index) => ({
      id: `marker-${index}`,
      name: `Marker ${index}`,
      notes: '',
      kind: 'comment' as const,
      color: '#22d3ee',
      target: { kind: 'point' as const, timeMs: index * 1_000 },
      createdAt: index,
      updatedAt: index,
    }));
    props.nativeSyncWarning = 'Native timeline sync is unavailable. Local project save remains available.';
    act(() => root.render(<SearchMarkersPanel {...props} />));
    clickButton(`Markers · ${props.markers.length}`);

    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(VIDEO_MARKER_PAGE_SIZE);
    expect(container.querySelector('[aria-label="Marker pages"]')?.textContent).toContain(`Showing 1–${VIDEO_MARKER_PAGE_SIZE} of ${props.markers.length} markers`);
    expect(container.querySelector('[role="alert"][data-marker-native-sync="unavailable"]')?.textContent).toContain('Local project save remains available');
    clickButton('Next marker page');
    expect(container.querySelector('[aria-label^="Go to Marker 250,"]')).not.toBeNull();
    expect(container.querySelector('[aria-label^="Go to Marker 0,"]')).toBeNull();
  });

  it('visibly disables an impossible range at 12 hours and clamps a near-ceiling range to a valid end', () => {
    const props = { ...createProps(), currentTimeMs: MAX_VIDEO_RICH_MARKER_TIME_MS };
    act(() => root.render(<SearchMarkersPanel {...props} />));
    clickButton('Markers · 2');
    changeSelect('Marker target', 'range');

    const addButton = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Add at playhead')) as HTMLButtonElement | undefined;
    expect(addButton?.disabled).toBe(true);
    expect(addButton?.getAttribute('aria-describedby')).toBeTruthy();
    expect(container.querySelector('[role="alert"][data-marker-range-limit="reached"]')?.textContent).toContain('12-hour project limit');
    const form = container.querySelector('form[aria-label="Add marker"]');
    act(() => form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(props.onMarkerCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'add-marker' }));

    act(() => root.render(<SearchMarkersPanel {...props} currentTimeMs={MAX_VIDEO_RICH_MARKER_TIME_MS - 1} />));
    expect(addButton?.disabled).toBe(false);
    expect(container.querySelector('[data-marker-range-limit="reached"]')).toBeNull();
    clickButton('Add at playhead');
    expect(props.onMarkerCommand).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'add-marker',
      draft: expect.objectContaining({
        target: {
          kind: 'range',
          startMs: MAX_VIDEO_RICH_MARKER_TIME_MS - 1,
          endMs: MAX_VIDEO_RICH_MARKER_TIME_MS,
        },
      }),
    }));
  });

  function clickButton(label: string): void {
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label
      || candidate.getAttribute('aria-label') === label
      || candidate.textContent?.includes(label));
    expect(button, `button ${label}`).toBeDefined();
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function changeInput(label: string, value: string): void {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    act(() => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  function changeSelect(label: string, value: string): void {
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    expect(select).not.toBeNull();
    act(() => {
      if (!select) return;
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
});
