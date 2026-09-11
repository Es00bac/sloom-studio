import { describe, expect, it } from 'vitest';
import {
  MAX_TIMELINE_MARKERS,
  MAX_TIMELINE_MARKER_SECONDS,
  TIMELINE_MARKER_COLORS,
  addTimelineMarker,
  applyClipSetTransitionToTimelineMarkers,
  applyClipSplitToTimelineMarkers,
  applyClipTrimToTimelineMarkers,
  isTimelineMarkerWithinBounds,
  normalizeTimelineMarkers,
  planClipTimelineMarkerPaste,
  reconcileClipTimelineMarkers,
  removeClipsFromTimelineMarkers,
  removeTimelineMarker,
  updateTimelineMarker,
  type TimelineMarker,
  type TimelineMarkerClipTransitionDescriptor,
} from './editorTimelineMarkers';
import { MAX_VIDEO_PROJECT_DURATION_MS } from './videoProductionState';

describe('editor timeline markers', () => {
  it('uses the canonical 12-hour Video project duration as its time ceiling', () => {
    expect(MAX_TIMELINE_MARKER_SECONDS * 1_000).toBe(MAX_VIDEO_PROJECT_DURATION_MS);
  });

  it('normalizes junk: drops non-finite entries, clamps finite time, sorts, and fills defaults', () => {
    const markers = normalizeTimelineMarkers([
      { seconds: 5, label: 'b' },
      { seconds: -1 },
      { seconds: 'x' },
      null,
      { id: 'keep', seconds: 1.2345, label: 'a', color: '#123456' },
    ]);
    expect(markers).toHaveLength(3);
    expect(markers[0]).toMatchObject({ seconds: 0, label: '', kind: 'comment' });
    expect(markers[1]).toMatchObject({ id: 'keep', seconds: 1.235, label: 'a', color: '#123456' });
    expect(markers[2].label).toBe('b');
    expect(markers[2].color).toBe(TIMELINE_MARKER_COLORS[0]);
  });

  it('adds auto-labeled markers cycling the palette, sorted, no near-duplicates', () => {
    let markers = addTimelineMarker([], 4);
    markers = addTimelineMarker(markers, 2);
    expect(markers.map((m) => m.seconds)).toEqual([2, 4]);
    expect(markers.map((m) => m.label).sort()).toEqual(['Marker 1', 'Marker 2']);
    expect(markers[0].color).not.toBe(markers[1].color);
    // adding within 50ms of an existing marker is a no-op
    expect(addTimelineMarker(markers, 2.01)).toHaveLength(2);
  });

  it('removes and updates by id, keeping time order', () => {
    let markers = addTimelineMarker(addTimelineMarker([], 1), 3);
    const first = markers[0];
    markers = updateTimelineMarker(markers, first.id, { seconds: 5, label: 'moved' });
    expect(markers[1]).toMatchObject({ id: first.id, seconds: 5, label: 'moved' });
    expect(removeTimelineMarker(markers, first.id)).toHaveLength(1);
  });

  it('preserves rich fields and timestamps while bounding ids, ranges, colors, and capacity', () => {
    const source = Array.from({ length: MAX_TIMELINE_MARKERS + 1 }, (_, index) => ({
      id: index === 1 ? 'marker-0' : `marker-${index}`,
      seconds: index === 0 ? MAX_TIMELINE_MARKER_SECONDS + 50 : index / 1_000,
      endSeconds: index === 0 ? MAX_TIMELINE_MARKER_SECONDS + 500 : undefined,
      label: index === 0 ? 'Final review' : `Marker ${index}`,
      color: index === 0 ? ' #AABBCC ' : '#22d3ee',
      kind: index === 0 ? 'review' : 'comment',
      notes: index === 0 ? 'Client-approved note' : undefined,
      createdAt: index === 0 ? 123.4 : undefined,
      updatedAt: index === 0 ? 456.7 : undefined,
    }));

    const normalized = normalizeTimelineMarkers(source);

    expect(normalized).toHaveLength(MAX_TIMELINE_MARKERS - 1);
    expect(normalized.at(-1)).toMatchObject({
      id: 'marker-0',
      seconds: MAX_TIMELINE_MARKER_SECONDS,
      label: 'Final review',
      color: '#aabbcc',
      kind: 'review',
      notes: 'Client-approved note',
      createdAt: 123,
      updatedAt: 457,
    });
    expect(normalized.at(-1)?.endSeconds).toBeUndefined();
    expect(normalized.every(isTimelineMarkerWithinBounds)).toBe(true);
  });

  it('rejects non-finite add times and records deterministic update timestamps when supplied', () => {
    expect(addTimelineMarker([], Number.POSITIVE_INFINITY)).toEqual([]);
    const added = addTimelineMarker([], -2);
    expect(added[0]).toMatchObject({ seconds: 0, createdAt: expect.any(Number), updatedAt: expect.any(Number) });
    const updated = updateTimelineMarker(added, added[0].id, {
      endSeconds: 2.5,
      kind: 'chapter',
      notes: 'Opening',
      updatedAt: 999,
    });
    expect(updated[0]).toMatchObject({
      seconds: 0,
      endSeconds: 2.5,
      kind: 'chapter',
      notes: 'Opening',
      createdAt: added[0].createdAt,
      updatedAt: 999,
    });
  });

  describe('clip-relative markers', () => {
    const clipMarker = (overrides: Partial<TimelineMarker> = {}): TimelineMarker => ({
      id: 'clip-note',
      seconds: 4,
      label: 'Cut note',
      color: '#fbbf24',
      kind: 'edit',
      clipId: 'visual-1',
      clipOffsetMs: 1_500,
      createdAt: 100,
      updatedAt: 200,
      ...overrides,
    });

    it('preserves clip offsets through normalization only for clip-owned markers and bounds them like times', () => {
      const normalized = normalizeTimelineMarkers([
        clipMarker({ clipOffsetMs: 1_500.4 }),
        clipMarker({ id: 'high', clipOffsetMs: MAX_VIDEO_PROJECT_DURATION_MS + 5_000 }),
        clipMarker({ id: 'negative', clipOffsetMs: -250 }),
        clipMarker({ id: 'orphan-offset', clipId: undefined, clipOffsetMs: 900 }),
      ]);
      expect(normalized[0]).toMatchObject({ id: 'clip-note', clipId: 'visual-1', clipOffsetMs: 1_500 });
      expect(normalized.find((marker) => marker.id === 'high')?.clipOffsetMs).toBe(MAX_VIDEO_PROJECT_DURATION_MS);
      expect(normalized.find((marker) => marker.id === 'negative')?.clipOffsetMs).toBe(0);
      // An offset without an owning clip is invalid data: normalization and bounds both fail
      // closed on the whole marker rather than keeping an ambiguously anchored row.
      expect(normalized.some((marker) => marker.id === 'orphan-offset')).toBe(false);
      expect(isTimelineMarkerWithinBounds(clipMarker({ clipId: undefined, clipOffsetMs: 900 }))).toBe(false);
      expect(normalized.every(isTimelineMarkerWithinBounds)).toBe(true);
      expect(isTimelineMarkerWithinBounds(clipMarker({ clipOffsetMs: Number.POSITIVE_INFINITY }))).toBe(false);
      expect(isTimelineMarkerWithinBounds(clipMarker({ clipOffsetMs: MAX_VIDEO_PROJECT_DURATION_MS + 1 }))).toBe(false);
    });

    it('moving a clip changes displayed sequence time while the owned offset is retained', () => {
      const markers = [clipMarker(), { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' }];
      const moved = reconcileClipTimelineMarkers(markers, [{ id: 'visual-1', startMs: 9_000 }]);

      expect(moved[0]).toMatchObject({ id: 'clip-note', clipId: 'visual-1', clipOffsetMs: 1_500, seconds: 10.5 });
      expect(moved[1]).toEqual(markers[1]);
      // A second reconcile at the same position is a stable no-op that returns the same reference.
      expect(reconcileClipTimelineMarkers(moved, [{ id: 'visual-1', startMs: 9_000 }])).toBe(moved);
    });

    it('adopts legacy clip markers by deriving their offset once and keeps orphans untouched', () => {
      const legacy = [clipMarker({ clipOffsetMs: undefined, seconds: 5.25 })];
      const adopted = reconcileClipTimelineMarkers(legacy, [{ id: 'visual-1', startMs: 2_000 }]);
      expect(adopted[0]).toMatchObject({ clipOffsetMs: 3_250, seconds: 5.25 });

      const orphan = [clipMarker({ clipId: 'missing-clip' })];
      expect(reconcileClipTimelineMarkers(orphan, [{ id: 'visual-1', startMs: 9_000 }])).toBe(orphan);
    });

    it('trims keep the content anchor: start-edge trims shift offsets and out-of-range markers are removed', () => {
      const markers = [
        clipMarker({ id: 'survives', clipOffsetMs: 2_000 }),
        clipMarker({ id: 'trimmed-out', clipOffsetMs: 500 }),
        clipMarker({ id: 'edge-keeper', clipOffsetMs: 1_000 }),
        clipMarker({ id: 'past-end', clipOffsetMs: 4_500 }),
        { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' },
      ];
      // Start-edge trim: clip start 2s -> 3s (content shift +1s), new duration 3s.
      const startTrim = applyClipTrimToTimelineMarkers(markers, {
        clipId: 'visual-1',
        previousStartMs: 2_000,
        nextStartMs: 3_000,
        contentShiftMs: 1_000,
        nextDurationMs: 3_000,
      });
      expect(startTrim.find((marker) => marker.id === 'survives')).toMatchObject({ clipOffsetMs: 1_000 });
      expect(startTrim.find((marker) => marker.id === 'survives')?.seconds).toBe(4);
      expect(startTrim.some((marker) => marker.id === 'trimmed-out')).toBe(false);
      expect(startTrim.find((marker) => marker.id === 'absolute')).toBeDefined();

      // End-edge trim: no content shift, markers beyond the new 1s duration are removed while a
      // marker sitting exactly on the new end edge survives.
      const endTrim = applyClipTrimToTimelineMarkers(markers, {
        clipId: 'visual-1',
        previousStartMs: 2_000,
        nextStartMs: 2_000,
        contentShiftMs: 0,
        nextDurationMs: 1_000,
      });
      expect(endTrim.find((marker) => marker.id === 'edge-keeper')?.clipOffsetMs).toBe(1_000);
      expect(endTrim.find((marker) => marker.id === 'trimmed-out')?.clipOffsetMs).toBe(500);
      expect(endTrim.some((marker) => marker.id === 'survives')).toBe(false);
      expect(endTrim.some((marker) => marker.id === 'past-end')).toBe(false);
    });

    it('splitting deterministically partitions and re-owns markers at the split point', () => {
      const markers = [
        clipMarker({ id: 'left-keeper', clipOffsetMs: 900 }),
        clipMarker({ id: 'split-point', clipOffsetMs: 2_000 }),
        clipMarker({ id: 'right-keeper', clipOffsetMs: 3_400 }),
        { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' },
      ];
      const split = applyClipSplitToTimelineMarkers(markers, {
        clipId: 'visual-1',
        clipStartMs: 2_000,
        splitMs: 4_000,
        rightClipId: 'visual-right',
      });

      expect(split.find((marker) => marker.id === 'left-keeper')).toMatchObject({ clipId: 'visual-1', clipOffsetMs: 900 });
      expect(split.find((marker) => marker.id === 'split-point')).toMatchObject({ clipId: 'visual-right', clipOffsetMs: 0 });
      expect(split.find((marker) => marker.id === 'right-keeper')).toMatchObject({ clipId: 'visual-right', clipOffsetMs: 1_400 });
      // Displayed sequence time is derived from the owning clip, so both sides keep their place.
      expect(split.find((marker) => marker.id === 'right-keeper')?.seconds).toBe(5.4);
      expect(split.find((marker) => marker.id === 'absolute')).toBeDefined();
    });

    it('deleting clips removes only the markers they own', () => {
      const markers = [
        clipMarker(),
        clipMarker({ id: 'audio-note', clipId: 'audio-1', clipOffsetMs: 250 }),
        { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' },
      ];
      const remaining = removeClipsFromTimelineMarkers(markers, ['visual-1', 'audio-2']);
      expect(remaining.map((marker) => marker.id)).toEqual(['audio-note', 'absolute']);
    });

    it('pasting remaps clip ownership and marker ids without collisions and preserves authored fields', () => {
      const markers = [
        clipMarker({ id: 'shared-copy', clipId: 'old-owner', clipOffsetMs: 800, seconds: 3 }),
        { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' },
      ];
      const pasted = planClipTimelineMarkerPaste({
        markers,
        clipboardMarkers: [
          clipMarker({ id: 'shared-copy', clipOffsetMs: 1_500 }),
          clipMarker({ id: 'shared-copy', clipId: 'audio-9', clipOffsetMs: 200 }),
        ],
        pastedClips: [
          { id: 'visual-1-copy', copiedFromClipId: 'visual-1', startMs: 10_000 },
          { id: 'audio-9-copy-2', copiedFromClipId: 'audio-9', startMs: 10_000 },
        ],
        overwriteFragments: new Map([
          ['old-owner', [{ id: 'old-owner-overwrite-fragment', startMs: 2_000, durationMs: 1_500 }]],
        ]),
        now: 5_000,
      });

      const owned = pasted.filter((marker) => [
        'visual-1-copy', 'audio-9-copy-2', 'old-owner-overwrite-fragment',
      ].includes(marker.clipId ?? ''));
      expect(owned).toHaveLength(3);
      expect(pasted.find((marker) => marker.clipId === 'visual-1-copy')).toMatchObject({
        id: 'shared-copy-copy',
        clipOffsetMs: 1_500,
        seconds: 11.5,
        label: 'Cut note',
        color: '#fbbf24',
        kind: 'edit',
        createdAt: 100,
        updatedAt: 5_000,
      });
      expect(pasted.find((marker) => marker.clipId === 'audio-9-copy-2')).toMatchObject({
        id: 'shared-copy-copy-2',
        clipOffsetMs: 200,
        seconds: 10.2,
      });
      // The overwritten original re-owns its surviving marker to the retained fragment.
      expect(pasted.find((marker) => marker.clipId === 'old-owner-overwrite-fragment')).toMatchObject({
        id: 'shared-copy',
        clipOffsetMs: 1_000,
        seconds: 3,
      });
      expect(pasted.find((marker) => marker.id === 'absolute')).toBeDefined();
      expect(new Set(pasted.map((marker) => marker.id)).size).toBe(pasted.length);
    });

    it('paste is a reference-preserving no-op without clipboard markers and enforces the shared capacity', () => {
      const markers = [clipMarker()];
      expect(planClipTimelineMarkerPaste({
        markers,
        clipboardMarkers: [],
        pastedClips: [],
        overwriteFragments: new Map(),
        now: 1,
      })).toBe(markers);

      const bulk = Array.from({ length: MAX_TIMELINE_MARKERS - 1 }, (_, index) => ({
        id: `existing-${index}`,
        seconds: 0,
        label: 'Existing',
        color: '#22d3ee',
      }));
      const capped = planClipTimelineMarkerPaste({
        markers: bulk,
        clipboardMarkers: [clipMarker({ id: 'overflow-a' }), clipMarker({ id: 'overflow-b' })],
        pastedClips: [{ id: 'visual-1-copy', copiedFromClipId: 'visual-1', startMs: 0 }],
        overwriteFragments: new Map(),
        now: 1,
      });
      expect(capped).toHaveLength(MAX_TIMELINE_MARKERS);
      expect(capped.some((marker) => marker.id === 'overflow-a-copy')).toBe(true);
      expect(capped.some((marker) => marker.id === 'overflow-b-copy')).toBe(false);
    });

    /** Editor clip view for transition maintenance: content span = [sourceInMs, sourceInMs + durationMs * rate). */
    const clipDescriptor = (
      overrides: Partial<TimelineMarkerClipTransitionDescriptor> = {},
    ): TimelineMarkerClipTransitionDescriptor => ({
      id: 'visual-1',
      kind: 'visual',
      trackIndex: 0,
      sourceNodeId: 'source-a',
      startMs: 2_000,
      durationMs: 4_000,
      sourceInMs: 0,
      rate: 1,
      ...overrides,
    });

    it('applies head-trim semantics to advanced roll trims: surviving content keeps its timeline place', () => {
      // Roll: the clip's start advances and its consumed source head grows by the same amount.
      const markers = [
        clipMarker({ id: 'head-lost', clipOffsetMs: 500 }),
        clipMarker({ id: 'kept', clipOffsetMs: 2_000 }),
        { id: 'absolute', seconds: 4, label: 'Absolute', color: '#22d3ee' },
      ];
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers,
        [clipDescriptor()],
        [clipDescriptor({ startMs: 3_000, durationMs: 3_000, sourceInMs: 1_000 })]);

      expect(transitioned.some((marker) => marker.id === 'head-lost')).toBe(false);
      expect(transitioned.find((marker) => marker.id === 'kept')).toMatchObject({ clipOffsetMs: 1_000, seconds: 4 });
      expect(transitioned.find((marker) => marker.id === 'absolute')).toBeDefined();
    });

    it('moves ripple-shifted clips intact: offset retained, display follows the clip', () => {
      const markers = [clipMarker({ id: 'follows', clipOffsetMs: 2_000 })];
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers,
        [clipDescriptor()],
        [clipDescriptor({ startMs: 1_000 })]);

      expect(transitioned.find((marker) => marker.id === 'follows')).toMatchObject({ clipOffsetMs: 2_000, seconds: 3 });
    });

    it('anchors slip sessions to content: markers follow the source window and out-of-window markers drop', () => {
      const markers = [
        clipMarker({ id: 'slipped-out', clipOffsetMs: 500 }),
        clipMarker({ id: 'slipped', clipOffsetMs: 1_500 }),
      ];
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers,
        [clipDescriptor()],
        [clipDescriptor({ sourceInMs: 1_000 })]);

      expect(transitioned.some((marker) => marker.id === 'slipped-out')).toBe(false);
      expect(transitioned.find((marker) => marker.id === 'slipped')).toMatchObject({ clipOffsetMs: 500, seconds: 2.5 });
    });

    it('extract and transcript fragment re-own surviving markers and drop the removed range', () => {
      // Extract removes timeline [3000,5000) from a 2s..8s clip: the original keeps content
      // [0,1000) and a `-right` fragment carries content [3000,4000) starting at 3s.
      const markers = [
        clipMarker({ id: 'stays-left', clipOffsetMs: 500 }),
        clipMarker({ id: 'removed-range', clipOffsetMs: 2_500 }),
        clipMarker({ id: 'reowned', clipOffsetMs: 3_500 }),
      ];
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers,
        [clipDescriptor({ durationMs: 6_000 })],
        [
          clipDescriptor({ durationMs: 1_000 }),
          clipDescriptor({ id: 'visual-1-right', startMs: 3_000, durationMs: 1_000, sourceInMs: 3_000 }),
        ]);

      expect(transitioned.find((marker) => marker.id === 'stays-left')).toMatchObject({ clipId: 'visual-1', clipOffsetMs: 500 });
      expect(transitioned.some((marker) => marker.id === 'removed-range')).toBe(false);
      expect(transitioned.find((marker) => marker.id === 'reowned')).toMatchObject({
        clipId: 'visual-1-right',
        clipOffsetMs: 500,
        seconds: 3.5,
      });
    });

    it('prunes markers of removed clips, leaves foreign owners untouched, and no-ops by reference', () => {
      const markers = [
        clipMarker(),
        clipMarker({ id: 'gone-audio', clipId: 'audio-1', clipOffsetMs: 100 }),
        clipMarker({ id: 'foreign', clipId: 'not-in-this-edit', clipOffsetMs: 100 }),
      ];
      const before = [clipDescriptor(), clipDescriptor({ id: 'audio-1', kind: 'audio', startMs: 5_000 })];
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers, before, [clipDescriptor()]);
      expect(transitioned.map((marker) => marker.id)).toEqual(['clip-note', 'foreign']);

      const unchanged = applyClipSetTransitionToTimelineMarkers(markers, before, before);
      expect(unchanged).toBe(markers);
    });

    it('passes markers through an unchanged parent even with degenerate zero-length timing', () => {
      const markers = [clipMarker({ id: 'unknown-audio', clipId: 'audio-1', clipOffsetMs: 300 })];
      const descriptor = clipDescriptor({ id: 'audio-1', kind: 'audio', startMs: 5_000, durationMs: 0, sourceInMs: 0 });
      expect(applyClipSetTransitionToTimelineMarkers(markers, [descriptor], [descriptor])).toBe(markers);
    });

    it('respects playback rate when mapping content through head trims', () => {
      const markers = [clipMarker({ id: 'fast', clipOffsetMs: 2_000 })];
      // A 2x clip consumes source head at twice the timeline rate.
      const transitioned = applyClipSetTransitionToTimelineMarkers(markers,
        [clipDescriptor({ rate: 2, durationMs: 3_000 })],
        [clipDescriptor({ rate: 2, durationMs: 2_000, sourceInMs: 1_000, startMs: 2_500 })]);

      expect(transitioned.find((marker) => marker.id === 'fast')).toMatchObject({ clipOffsetMs: 1_500, seconds: 4 });
    });
  });
});
