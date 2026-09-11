import { describe, expect, it } from 'vitest';
import {
  buildAudioTimelineBlocks,
  buildVisualTimelineBlocks,
  getTimelineDurationSeconds,
  resolveVisualClipDuration,
} from './manualEditorTimeline';
import type { SourceBinItem } from './sourceBin';
import type { EditorAudioClip, EditorVisualClip } from '../types/flow';

function createItem(item: Partial<SourceBinItem> & Pick<SourceBinItem, 'id' | 'nodeId' | 'kind' | 'label'>): SourceBinItem {
  return item;
}

function createVisualClip(overrides: Partial<EditorVisualClip> & Pick<EditorVisualClip, 'id' | 'sourceNodeId' | 'sourceKind'>): EditorVisualClip {
  return {
    trackIndex: 0,
    startMs: 0,
    sourceInMs: 0,
    durationSeconds: undefined,
    trimStartMs: 0,
    trimEndMs: 0,
    playbackRate: 1,
    reversePlayback: false,
    fitMode: 'contain',
    scalePercent: 100,
    scaleMotionEnabled: false,
    endScalePercent: 100,
    opacityPercent: 100,
    rotationDeg: 0,
    rotationMotionEnabled: false,
    endRotationDeg: 0,
    flipHorizontal: false,
    flipVertical: false,
    positionX: 0,
    positionY: 0,
    motionEnabled: false,
    endPositionX: 0,
    endPositionY: 0,
    cropLeftPercent: 0,
    cropRightPercent: 0,
    cropTopPercent: 0,
    cropBottomPercent: 0,
    cropPanXPercent: 0,
    cropPanYPercent: 0,
    cropRotationDeg: 0,
    filterStack: [],
    transitionIn: 'none',
    transitionOut: 'none',
    transitionDurationMs: 500,
    textContent: undefined,
    textFontFamily: 'Inter, system-ui, sans-serif',
    textSizePx: 64,
    textColor: '#f3f4f6',
    textEffect: 'shadow',
    textBackgroundOpacityPercent: 0,
    ...overrides,
  };
}

describe('resolveVisualClipDuration', () => {
  it('uses the explicit duration for image and text clips', () => {
    const itemMap = new Map<string, SourceBinItem>();

    expect(
      resolveVisualClipDuration(
        createVisualClip({
          id: 'visual-1',
          sourceNodeId: 'image-1',
          sourceKind: 'image',
          durationSeconds: 6,
        }),
        itemMap,
        {},
      ),
    ).toBe(6);
  });

  it.each(['speech', 'thought', 'caption'])('keeps %s comics on the authored still-duration contract', (comicKind) => {
    const comic = createVisualClip({
      id: `comic-${comicKind}`,
      sourceNodeId: `comic-${comicKind}`,
      sourceKind: 'comic',
      startMs: 2_000,
      durationSeconds: 4,
      comicKind: comicKind as EditorVisualClip['comicKind'],
    });

    const blocks = buildVisualTimelineBlocks([comic], new Map(), {});

    expect(resolveVisualClipDuration(comic, new Map(), {})).toBe(4);
    expect(blocks[0]).toMatchObject({
      startSeconds: 2,
      durationSeconds: 4,
      endSeconds: 6,
    });
    expect(getTimelineDurationSeconds(blocks, [])).toBe(6);
  });

  it('falls back to media duration for video clips', () => {
    const item = createItem({
      id: 'source-video-1',
      nodeId: 'video-1',
      kind: 'video',
      label: 'Video 1',
    });

    expect(
      resolveVisualClipDuration(
        createVisualClip({
          id: 'visual-1',
          sourceNodeId: 'video-1',
          sourceKind: 'video',
        }),
        new Map([[item.nodeId, item]]),
        {
          [item.id]: 8,
        },
      ),
    ).toBe(8);
  });

  it('uses explicit source ranges for non-destructive video cuts', () => {
    const item = createItem({
      id: 'source-video-1',
      nodeId: 'video-1',
      kind: 'video',
      label: 'Video 1',
    });

    expect(
      resolveVisualClipDuration(
        createVisualClip({
          id: 'visual-1',
          sourceNodeId: 'video-1',
          sourceKind: 'video',
          sourceInMs: 10_000,
          sourceOutMs: 20_000,
          trimStartMs: 0,
          trimEndMs: 0,
        }),
        new Map([[item.nodeId, item]]),
        {
          [item.id]: 30,
        },
      ),
    ).toBe(10);
  });
});

describe('buildVisualTimelineBlocks', () => {
  it('lays out visual clips by explicit start time on the timeline', () => {
    const clips: EditorVisualClip[] = [
      createVisualClip({
        id: 'visual-1',
        sourceNodeId: 'image-1',
        sourceKind: 'image',
        trackIndex: 0,
        startMs: 2000,
        durationSeconds: 4,
      }),
      createVisualClip({
        id: 'visual-2',
        sourceNodeId: 'video-1',
        sourceKind: 'video',
        trackIndex: 1,
        startMs: 500,
      }),
    ];
    const videoItem = createItem({
      id: 'source-video-1',
      nodeId: 'video-1',
      kind: 'video',
      label: 'Video 1',
    });

    const blocks = buildVisualTimelineBlocks(clips, new Map([[videoItem.nodeId, videoItem]]), {
      [videoItem.id]: 6,
    });

    expect(blocks.map((block) => ({
      id: block.clip.id,
      startSeconds: block.startSeconds,
      endSeconds: block.endSeconds,
    }))).toEqual([
      { id: 'visual-1', startSeconds: 2, endSeconds: 6 },
      { id: 'visual-2', startSeconds: 0.5, endSeconds: 6.5 },
    ]);
  });

  it('shortens video clips when trims and playback speed are applied', () => {
    const videoItem = createItem({
      id: 'source-video-1',
      nodeId: 'video-1',
      kind: 'video',
      label: 'Video 1',
    });

    const blocks = buildVisualTimelineBlocks(
      [
        createVisualClip({
          id: 'visual-1',
          sourceNodeId: 'video-1',
          sourceKind: 'video',
          trimStartMs: 1000,
          trimEndMs: 3000,
          playbackRate: 2,
        }),
      ],
      new Map([[videoItem.nodeId, videoItem]]),
      {
        [videoItem.id]: 12,
      },
    );

    expect(blocks[0]).toMatchObject({
      startSeconds: 0,
      durationSeconds: 4,
      endSeconds: 4,
    });
  });
});

describe('buildAudioTimelineBlocks', () => {
  it('preserves audio offsets when building timeline blocks', () => {
    const clips: EditorAudioClip[] = [
      {
        id: 'audio-1',
        sourceNodeId: 'audio-1',
        offsetMs: 1500,
        trackIndex: 0,
        volumePercent: 100,
        enabled: true,
      },
    ];
    const audioItem = createItem({
      id: 'source-audio-1',
      nodeId: 'audio-1',
      kind: 'audio',
      label: 'Audio 1',
    });

    const blocks = buildAudioTimelineBlocks(clips, new Map([[audioItem.nodeId, audioItem]]), {
      [audioItem.id]: 3,
    });

    expect(blocks[0]).toMatchObject({
      startSeconds: 1.5,
      durationSeconds: 3,
      endSeconds: 4.5,
    });
  });

  it('uses only the selected audio source range for block duration and timeline extent', () => {
    const audioItem = createItem({ id: 'source-audio-2', nodeId: 'audio-2', kind: 'audio', label: 'Audio 2' });
    const blocks = buildAudioTimelineBlocks([{
      id: 'audio-2',
      sourceNodeId: 'audio-2',
      offsetMs: 2_000,
      sourceInMs: 1_500,
      sourceOutMs: 4_250,
      trackIndex: 0,
      volumePercent: 100,
      enabled: true,
    }], new Map([[audioItem.nodeId, audioItem]]), { [audioItem.id]: 8 });

    expect(blocks[0]).toMatchObject({ startSeconds: 2, durationSeconds: 2.75, endSeconds: 4.75 });
  });
});

describe('getTimelineDurationSeconds', () => {
  it('returns the larger of the visual and audio extents', () => {
    expect(
      getTimelineDurationSeconds(
        [
          {
            clip: {} as EditorVisualClip,
            startSeconds: 0,
            durationSeconds: 8,
            endSeconds: 8,
          },
        ],
        [
          {
            clip: {} as EditorAudioClip,
            startSeconds: 3,
            durationSeconds: 7,
            endSeconds: 10,
          },
        ],
      ),
    ).toBe(10);
  });
});
