import { describe, expect, it } from 'vitest';
import { buildFcpXmlSequenceFromEditor } from './fcpXmlSequenceMapping';
import { createEditorVisualClip } from './manualEditorState';
import type { EditorAudioClip } from '../types/flow';

const audioClip: EditorAudioClip = {
  id: 'audio-1',
  sourceNodeId: 'vo-node',
  offsetMs: 500,
  sourceInMs: 750,
  sourceOutMs: 3_250,
  trackIndex: 0,
  volumePercent: 100,
  enabled: true,
};

describe('buildFcpXmlSequenceFromEditor', () => {
  it('maps a trimmed video clip with the render pipeline source-range math', () => {
    const clip = {
      ...createEditorVisualClip('cam-a', 'video', { trackIndex: 1, durationSeconds: 3 }),
      startMs: 2000,
      sourceInMs: 500,
      sourceOutMs: 3500,
    };

    const sequence = buildFcpXmlSequenceFromEditor({
      name: 'Cut 1',
      frameRate: 30,
      widthPx: 1920,
      heightPx: 1080,
      visualClips: [clip],
      audioClips: [audioClip],
      resolveVisualMedia: () => ({
        label: 'A-cam',
        nativeFilePath: '/footage/a-cam.mp4',
        sourceDurationSeconds: 10,
        timelineDurationSeconds: 3,
      }),
      resolveAudioMedia: () => ({ label: 'VO', nativeFilePath: '/audio/vo.wav', sourceDurationSeconds: 4 }),
    });

    expect(sequence.timebase).toBe(30);
    expect(sequence.videoClips).toEqual([
      expect.objectContaining({
        name: 'A-cam',
        trackIndex: 1,
        startMs: 2000,
        sourceInMs: 500,
        sourceOutMs: 3500,
        pathUrl: '/footage/a-cam.mp4',
      }),
    ]);
    expect(sequence.audioClips).toEqual([
      expect.objectContaining({ name: 'VO', startMs: 500, sourceInMs: 750, sourceOutMs: 3250, enabled: true }),
    ]);
  });

  it('gives stills their timeline length as the source window', () => {
    const still = { ...createEditorVisualClip('panel-1', 'image', { durationSeconds: 5 }), startMs: 0 };
    const sequence = buildFcpXmlSequenceFromEditor({
      name: 'Panels',
      frameRate: 24,
      widthPx: 1920,
      heightPx: 1080,
      visualClips: [still],
      audioClips: [],
      resolveVisualMedia: () => ({ label: 'p01-panel-01', timelineDurationSeconds: 5 }),
      resolveAudioMedia: () => ({}),
    });

    expect(sequence.videoClips[0].sourceInMs).toBe(0);
    expect(sequence.videoClips[0].sourceOutMs).toBe(5000);
    expect(sequence.videoClips[0].pathUrl).toBeUndefined(); // relinks in Premiere by design
  });
});
