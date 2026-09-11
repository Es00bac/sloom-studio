import { describe, expect, it } from 'vitest';
import { sanitizeEditorWorkspaceSnapshot } from './editorStore';

describe('editorStore persistence hardening', () => {
  it('falls back from invalid editor workspace values', () => {
    expect(
      sanitizeEditorWorkspaceSnapshot({
        workspaceView: 'video',
        sourceBinTab: 'bad-tab',
        sourceMonitorVisible: 'yes',
        programMonitorVisible: false,
        inspectorVisible: null,
        sourceBinVisible: true,
        sourceMonitorWidth: Number.POSITIVE_INFINITY,
        inspectorWidth: -100,
        sourceBinWidth: 9999,
        monitorSplitPercent: Number.NaN,
        monitorSectionHeight: 9999,
        timelineVisualTrackHeight: 'tall',
        timelineAudioTrackHeight: 1,
      }),
    ).toMatchObject({
      workspaceView: 'flow',
      sourceBinTab: 'media',
      sourceMonitorVisible: true,
      programMonitorVisible: false,
      inspectorVisible: true,
      sourceBinVisible: true,
      sourceMonitorWidth: 320,
      inspectorWidth: 260,
      sourceBinWidth: 520,
      monitorSplitPercent: 50,
      monitorSectionHeight: 900,
      timelineVisualTrackHeight: 84,
      timelineAudioTrackHeight: 44,
    });
  });

  it('opens the source and program monitors in the default video editing layout', () => {
    expect(sanitizeEditorWorkspaceSnapshot({})).toMatchObject({
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      monitorSplitPercent: 50,
    });
  });

  it('bounds and deduplicates professional multi-clip selection state', () => {
    const selectedVisualClipIds = Array.from({ length: 2_100 }, (_, index) => `visual-${index}`);
    selectedVisualClipIds.splice(2, 0, 'visual-1');
    const snapshot = sanitizeEditorWorkspaceSnapshot({
      selectedVisualClipIds,
      selectedAudioClipIds: ['audio-1', 'audio-1', 42],
    });

    expect(snapshot.selectedVisualClipIds).toHaveLength(2_000);
    expect(snapshot.selectedVisualClipIds.slice(0, 3)).toEqual(['visual-0', 'visual-1', 'visual-2']);
    expect(snapshot.selectedAudioClipIds).toEqual(['audio-1']);
  });
});
