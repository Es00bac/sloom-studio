// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveVisualClipDuration } from '../../../lib/manualEditorTimeline';
import { createEditorAudioClip, createEditorVisualClip } from '../../../lib/manualEditorState';
import { isAudioTrackAudible } from '../../../lib/editorAudioMix';
import { composeSequenceMedia } from '../../../lib/mediaComposition';
import { renderStageFrameSequence } from '../../../lib/stageFrameExport';
import { executeNodeRequest } from '../../../lib/flowExecution';
import { buildExecutionContextForNode } from '../../../store/flowStore';
import { useSourceBinStore } from '../../../store/sourceBinStore';
import { InspectorPanel } from './VideoWorkspace';
import type { AppNode, EditorAudioClip, RuntimeSettingsSnapshot } from '../../../types/flow';

vi.mock('../../../lib/mediaComposition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/mediaComposition')>()),
  composeSequenceMedia: vi.fn(),
}));

vi.mock('../../../lib/stageFrameExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/stageFrameExport')>()),
  renderStageFrameSequence: vi.fn().mockResolvedValue(null),
}));

const mockedComposeSequenceMedia = vi.mocked(composeSequenceMedia);
const mockedRenderStageFrameSequence = vi.mocked(renderStageFrameSequence);

const runtimeSettings = {
  apiKeys: {},
  defaultModels: {},
  providerSettings: {
    renderBackendPreference: 'native-cpu',
    localNativeRenderUrl: 'http://127.0.0.1:41736',
    batchMaxRetries: 0,
    batchRetryBaseDelayMs: 1,
  },
} as RuntimeSettingsSnapshot;

describe('InspectorPanel comic duration', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mockedComposeSequenceMedia.mockReset();
    mockedRenderStageFrameSequence.mockReset().mockResolvedValue(null);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  it.each(['speech-bubble', 'thought-bubble', 'caption'] as const)(
    'edits %s through the still-duration field consumed by the timeline resolver',
    (comicKind) => {
      const clip = createEditorVisualClip(`comic-${comicKind}`, 'comic', {
        durationSeconds: 4,
        comicKind,
      });
      const onUpdateVisualClip = vi.fn();

      act(() => {
        root!.render(
          <InspectorPanel
            audioTrackVolumes={[]}
            onAddOrUpdateKeyframe={vi.fn()}
            onCommitVisualCropAsImageAsset={vi.fn()}
            onEditVisualText={vi.fn()}
            onGenerateNarrationFromText={vi.fn()}
            onJumpKeyframe={vi.fn()}
            onMoveAudioToTrack={vi.fn()}
            onMoveVisualToTrack={vi.fn()}
            onRemoveAudioClip={vi.fn()}
            onSplitAudioClip={vi.fn(() => false)}
            onMatchAudioSpeechLevel={vi.fn()}
            onRemoveAudioKeyframe={vi.fn()}
            onRemoveStageObject={vi.fn()}
            onRemoveVisualClip={vi.fn()}
            onRemoveVisualKeyframe={vi.fn()}
            onSelectSource={vi.fn()}
            onUpdateAudioClip={vi.fn()}
            onUpdateAudioKeyframe={vi.fn()}
            onUpdateStageObject={vi.fn()}
            onUpdateVisualClip={onUpdateVisualClip}
            onUpdateVisualKeyframe={vi.fn()}
            sequenceDurationSeconds={4}
            timelineCursorSeconds={0}
            visualClip={clip}
            visualDurationSeconds={resolveVisualClipDuration(clip, new Map(), {})}
          />,
        );
      });

      const durationInput = [...host!.querySelectorAll('label')].find((label) =>
        label.firstElementChild?.textContent === 'Clip duration',
      )?.querySelector('input');
      expect(durationInput).toBeTruthy();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(durationInput, '6');
      act(() => durationInput!.dispatchEvent(new Event('input', { bubbles: true })));

      expect(onUpdateVisualClip).toHaveBeenCalledWith({ durationSeconds: 6 });
      expect(resolveVisualClipDuration({ ...clip, ...onUpdateVisualClip.mock.calls[0][0] }, new Map(), {})).toBe(6);
    },
  );

  it('exposes source-aware audio trim, split, and measured speech matching without rewriting clip volume', () => {
    const clip = createEditorAudioClip('clean-source', 0, {
      offsetMs: 2_000,
      sourceInMs: 1_000,
      sourceOutMs: 5_000,
      volumePercent: 80,
      loudnessReferenceSourceNodeId: 'original-source',
      loudnessReferenceSourceInMs: 1_000,
      loudnessReferenceSourceOutMs: 5_000,
    });
    const onUpdateAudioClip = vi.fn();
    const onSplitAudioClip = vi.fn(() => true);
    const onMatchAudioSpeechLevel = vi.fn();
    const onDialogueAuditionSide = vi.fn();

    act(() => {
      root!.render(
        <InspectorPanel
          audioClip={clip}
          audioDurationSeconds={4}
          audioSourceDurationSeconds={8}
          audioSourceItem={{ id: 'clean-source', nodeId: 'clean-source', label: 'Clean dialogue', kind: 'audio' }}
          audioTrackVolumes={[100]}
          onAddOrUpdateKeyframe={vi.fn()}
          onCommitVisualCropAsImageAsset={vi.fn()}
          onEditVisualText={vi.fn()}
          onGenerateNarrationFromText={vi.fn()}
          onJumpKeyframe={vi.fn()}
          onMatchAudioSpeechLevel={onMatchAudioSpeechLevel}
          onDialogueAuditionSide={onDialogueAuditionSide}
          onStopDialogueAudition={vi.fn()}
          onSetDialogueAuditionCalibration={vi.fn()}
          onMoveAudioToTrack={vi.fn()}
          onMoveVisualToTrack={vi.fn()}
          onRemoveAudioClip={vi.fn()}
          onRemoveAudioKeyframe={vi.fn()}
          onRemoveStageObject={vi.fn()}
          onRemoveVisualClip={vi.fn()}
          onRemoveVisualKeyframe={vi.fn()}
          onSelectSource={vi.fn()}
          onSplitAudioClip={onSplitAudioClip}
          onUpdateAudioClip={onUpdateAudioClip}
          onUpdateAudioKeyframe={vi.fn()}
          onUpdateStageObject={vi.fn()}
          onUpdateVisualClip={vi.fn()}
          onUpdateVisualKeyframe={vi.fn()}
          sequenceDurationSeconds={6}
          timelineCursorSeconds={4}
        />,
      );
    });

    expect(host!.textContent).toContain('Source range');
    expect(host!.textContent).toContain('This is not LUFS normalization.');
    const sourceInInput = [...host!.querySelectorAll('label')].find((label) =>
      label.firstElementChild?.textContent === 'Source in',
    )?.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(sourceInInput, '2');
    act(() => sourceInInput!.dispatchEvent(new Event('input', { bubbles: true })));
    expect(onUpdateAudioClip).toHaveBeenCalledWith(expect.objectContaining({
      sourceInMs: 2_000,
      sourceOutMs: 5_000,
      offsetMs: 3_000,
      volumePercent: 80,
    }));

    const splitButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Split At Playhead'))!;
    const matchButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Match Speech Level'))!;
    const dialoguePresetButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Dialogue preset'))!;
    const originalDryButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Original · dry'))!;
    act(() => splitButton.click());
    act(() => matchButton.click());
    act(() => dialoguePresetButton.click());
    act(() => originalDryButton.click());
    expect(onSplitAudioClip).toHaveBeenCalledOnce();
    expect(onMatchAudioSpeechLevel).toHaveBeenCalledOnce();
    expect(onDialogueAuditionSide).toHaveBeenCalledWith('original-dry');
    expect(onUpdateAudioClip).toHaveBeenCalledWith({
      audioProcessing: expect.objectContaining({
        processingEnabled: true,
        highPassEnabled: true,
        gateEnabled: false,
        compressorEnabled: true,
        limiterEnabled: true,
      }),
    });
  });

  it('mounts auto-ducking controls and carries their persisted settings to both render backends', async () => {
    const target = { ...createEditorAudioClip('music-source', 1), id: 'music-clip' };
    const control = { ...createEditorAudioClip('dialogue-source', 0), id: 'dialogue-clip' };
    const onUpdateAudioClip = vi.fn((patch: Partial<EditorAudioClip>) => Object.assign(target, patch));

    const renderInspector = () => {
      root!.render(
        <InspectorPanel
          audioClip={target}
          audioClips={[target, control]}
          audioDurationSeconds={4}
          audioSourceDurationSeconds={4}
          audioSourceItem={{ id: 'music-source', nodeId: 'music-source', label: 'Music', kind: 'audio' }}
          audioSourceItemsByClipId={new Map([
            [control.id, { id: control.id, nodeId: control.id, label: 'Dialogue', kind: 'audio' as const }],
          ])}
          audioTrackVolumes={[100, 100]}
          onAddOrUpdateKeyframe={vi.fn()}
          onCommitVisualCropAsImageAsset={vi.fn()}
          onEditVisualText={vi.fn()}
          onGenerateNarrationFromText={vi.fn()}
          onJumpKeyframe={vi.fn()}
          onMatchAudioSpeechLevel={vi.fn()}
          onMoveAudioToTrack={vi.fn()}
          onMoveVisualToTrack={vi.fn()}
          onRemoveAudioClip={vi.fn()}
          onRemoveAudioKeyframe={vi.fn()}
          onRemoveStageObject={vi.fn()}
          onRemoveVisualClip={vi.fn()}
          onRemoveVisualKeyframe={vi.fn()}
          onSelectSource={vi.fn()}
          onSplitAudioClip={vi.fn(() => false)}
          onUpdateAudioClip={onUpdateAudioClip}
          onUpdateAudioKeyframe={vi.fn()}
          onUpdateStageObject={vi.fn()}
          onUpdateVisualClip={vi.fn()}
          onUpdateVisualKeyframe={vi.fn()}
          sequenceDurationSeconds={4}
          timelineCursorSeconds={0}
        />,
      );
    };

    act(() => {
      renderInspector();
    });

    expect(host!.textContent).toContain('Auto-ducking');
    expect(host!.textContent).toContain('Browser composition refuses enabled auto-ducking');
    expect(host!.textContent).toContain('Dialogue · A1');
    expect((host!.querySelector('input[min="-60"]') as HTMLInputElement | null)?.value).toBe('-30');
    const enabled = [...host!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
      input.parentElement?.textContent?.includes('Lower this clip from a control clip'),
    )!;
    act(() => enabled.click());
    act(() => renderInspector());
    const source = [...host!.querySelectorAll('label')].find((label) =>
      label.firstElementChild?.textContent === 'Control clip',
    )?.querySelector('select') as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(source, control.id);
    act(() => source.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onUpdateAudioClip).toHaveBeenCalledWith(expect.objectContaining({
      audioDucking: expect.objectContaining({ enabled: true, controlClipId: control.id }),
    }));

    const visual = createEditorVisualClip('cover-source', 'image', { durationSeconds: 4 });
    const composition = {
      id: 'composition-ducking', type: 'composition', position: { x: 0, y: 0 },
      data: { editorVisualClips: [visual], editorAudioClips: [target, control] },
    } as AppNode;
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [
        { id: 'cover-source', label: 'Cover', kind: 'image', assetUrl: 'data:image/png;base64,UE5H', createdAt: 1 },
        { id: 'music-source', label: 'Music', kind: 'audio', assetUrl: 'data:audio/wav;base64,UklGRg==', createdAt: 1 },
        { id: 'dialogue-source', label: 'Dialogue', kind: 'audio', assetUrl: 'data:audio/wav;base64,UklGRg==', createdAt: 1 },
      ] }],
      dismissedSourceKeys: [],
    });
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sequence-output');

    await executeNodeRequest(
      composition,
      buildExecutionContextForNode(composition, [composition], []),
      runtimeSettings,
    );

    const audioTracks = expect.arrayContaining([
      expect.objectContaining({
        id: target.id,
        audioDucking: expect.objectContaining({ enabled: true, controlClipId: control.id }),
      }),
    ]);
    expect(mockedRenderStageFrameSequence).toHaveBeenCalledWith(expect.objectContaining({ audioTracks }));
    expect(mockedComposeSequenceMedia).toHaveBeenCalledWith(expect.objectContaining({ audioTracks }));
  });

  it('carries fifth and highest-bound audio-track authority into both render backends', async () => {
    const fifthTrackClip = { ...createEditorAudioClip('fifth-source', 4), id: 'fifth-track-clip' };
    const highestTrackClip = { ...createEditorAudioClip('highest-source', 63), id: 'highest-track-clip' };
    const visualClip = createEditorVisualClip('cover-source', 'image', { durationSeconds: 4 });
    const composition = {
      id: 'composition-track-authority', type: 'composition', position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [visualClip],
        editorAudioClips: [fifthTrackClip, highestTrackClip],
        editorAudioTrackVolumes: [100, 100, 100, 100, 35, ...Array.from({ length: 58 }, () => 100), 42],
        editorMutedAudioTracks: [4, 63],
        editorSoloAudioTracks: [],
      },
    } as AppNode;
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [
        { id: 'cover-source', label: 'Cover', kind: 'image', assetUrl: 'data:image/png;base64,UE5H', createdAt: 1 },
        { id: 'fifth-source', label: 'Fifth', kind: 'audio', assetUrl: 'data:audio/wav;base64,UklGRg==', createdAt: 1 },
        { id: 'highest-source', label: 'Highest', kind: 'audio', assetUrl: 'data:audio/wav;base64,UklGRg==', createdAt: 1 },
      ] }],
      dismissedSourceKeys: [],
    });
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });

    await executeNodeRequest(composition, buildExecutionContextForNode(composition, [composition], []), runtimeSettings);

    for (const call of [mockedRenderStageFrameSequence.mock.calls[0], mockedComposeSequenceMedia.mock.calls[0]]) {
      const audioTracks = call?.[0]?.audioTracks;
      expect(audioTracks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: fifthTrackClip.id, trackIndex: 4, trackVolumePercent: 35, enabled: false }),
        expect.objectContaining({ id: highestTrackClip.id, trackIndex: 63, trackVolumePercent: 42, enabled: false }),
      ]));
    }
  });

  it('bounds hostile professional track counts while preserving the highest supported authority in both backends', async () => {
    const highestTrackClip = { ...createEditorAudioClip('highest-source', 63), id: 'hostile-highest-track-clip' };
    const visualClip = createEditorVisualClip('cover-source', 'image', { durationSeconds: 4 });
    const composition = {
      id: 'composition-hostile-track-count', type: 'composition', position: { x: 0, y: 0 },
      data: {
        editorVisualClips: [visualClip],
        editorAudioClips: [highestTrackClip],
        editorAudioTrackVolumes: [...Array.from({ length: 64 }, () => 100), 35, Number.NaN],
        editorMutedAudioTracks: [63, 64, 1.5, -1, '63'],
        editorSoloAudioTracks: [63, 64, Number.POSITIVE_INFINITY],
        editorProfessionalState: {
          tracks: Array.from({ length: 128 }, (_, index) => ({
            id: `audio:${index}`, kind: 'audio', name: `Audio ${index + 1}`, order: index, enabled: true, locked: false,
          })),
        },
      },
    } as unknown as AppNode;
    useSourceBinStore.setState({
      bins: [{ id: 'default', name: 'Source Library', collapsed: false, createdAt: 1, items: [
        { id: 'cover-source', label: 'Cover', kind: 'image', assetUrl: 'data:image/png;base64,UE5H', createdAt: 1 },
        { id: 'highest-source', label: 'Highest', kind: 'audio', assetUrl: 'data:audio/wav;base64,UklGRg==', createdAt: 1 },
      ] }],
      dismissedSourceKeys: [],
    });
    mockedComposeSequenceMedia.mockResolvedValue({
      blob: new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
      mimeType: 'video/mp4', extension: 'mp4', fileName: 'sequence-output.mp4', renderBackend: 'cpu',
    });

    await executeNodeRequest(composition, buildExecutionContextForNode(composition, [composition], []), runtimeSettings);

    for (const call of [mockedRenderStageFrameSequence.mock.calls[0], mockedComposeSequenceMedia.mock.calls[0]]) {
      const audioTracks = call?.[0]?.audioTracks;
      expect(audioTracks).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: highestTrackClip.id, trackIndex: 63, trackVolumePercent: 100, enabled: false }),
      ]));
    }
  });

  it('does not offer controls from muted or solo-ineligible tracks', () => {
    const target = createEditorAudioClip('music-target', 1);
    const mutedControl = createEditorAudioClip('muted-dialogue', 0);
    act(() => {
      root!.render(
        <InspectorPanel
          audioClip={target}
          audioClips={[target, mutedControl]}
          audioSourceDurationSeconds={4}
          audioSourceItemsByClipId={new Map([
            [mutedControl.id, { id: mutedControl.id, nodeId: mutedControl.id, label: 'Muted dialogue', kind: 'audio' as const }],
          ])}
          audioTrackVolumes={[100, 100]}
          mutedAudioTracks={[mutedControl.trackIndex]}
          onAddOrUpdateKeyframe={vi.fn()}
          onCommitVisualCropAsImageAsset={vi.fn()}
          onEditVisualText={vi.fn()}
          onGenerateNarrationFromText={vi.fn()}
          onJumpKeyframe={vi.fn()}
          onMatchAudioSpeechLevel={vi.fn()}
          onMoveAudioToTrack={vi.fn()}
          onMoveVisualToTrack={vi.fn()}
          onRemoveAudioClip={vi.fn()}
          onRemoveAudioKeyframe={vi.fn()}
          onRemoveStageObject={vi.fn()}
          onRemoveVisualClip={vi.fn()}
          onRemoveVisualKeyframe={vi.fn()}
          onSelectSource={vi.fn()}
          onSplitAudioClip={vi.fn(() => false)}
          onUpdateAudioClip={vi.fn()}
          onUpdateAudioKeyframe={vi.fn()}
          onUpdateStageObject={vi.fn()}
          onUpdateVisualClip={vi.fn()}
          onUpdateVisualKeyframe={vi.fn()}
          sequenceDurationSeconds={4}
          timelineCursorSeconds={0}
        />,
      );
    });

    const source = [...host!.querySelectorAll('label')].find((label) =>
      label.firstElementChild?.textContent === 'Control clip',
    )?.querySelector('select') as HTMLSelectElement;
    expect(source.options).toHaveLength(1);
    expect(source.options[0]?.textContent).toBe('Select a control clip');
  });

  it('makes compositing, filters, and chroma-key presets discoverable in the visual inspector', () => {
    const clip = createEditorVisualClip('camera-source', 'video');
    const onUpdateVisualClip = vi.fn();

    act(() => {
      root!.render(
        <InspectorPanel
          audioTrackVolumes={[]}
          onAddOrUpdateKeyframe={vi.fn()}
          onCommitVisualCropAsImageAsset={vi.fn()}
          onEditVisualText={vi.fn()}
          onGenerateNarrationFromText={vi.fn()}
          onJumpKeyframe={vi.fn()}
          onMatchAudioSpeechLevel={vi.fn()}
          onMoveAudioToTrack={vi.fn()}
          onMoveVisualToTrack={vi.fn()}
          onRemoveAudioClip={vi.fn()}
          onRemoveAudioKeyframe={vi.fn()}
          onRemoveStageObject={vi.fn()}
          onRemoveVisualClip={vi.fn()}
          onRemoveVisualKeyframe={vi.fn()}
          onSelectSource={vi.fn()}
          onSplitAudioClip={vi.fn(() => false)}
          onUpdateAudioClip={vi.fn()}
          onUpdateAudioKeyframe={vi.fn()}
          onUpdateStageObject={vi.fn()}
          onUpdateVisualClip={onUpdateVisualClip}
          onUpdateVisualKeyframe={vi.fn()}
          sequenceDurationSeconds={12}
          timelineCursorSeconds={0}
          visualClip={clip}
          visualDurationSeconds={12}
          visualSourceDurationSeconds={12}
          visualSourceItem={{ id: 'camera-source', nodeId: 'camera-source', label: 'A001.mov', kind: 'video', isGenerated: false }}
        />,
      );
    });

    expect(host!.querySelector('[data-video-professional-effects="true"]')).toBeTruthy();
    expect(host!.textContent).toContain('Effects, Compositing & Keying');
    expect(host!.textContent).toContain('Higher video tracks composite above lower tracks.');

    const preset = host!.querySelector('select[aria-label="Clip effect preset"]') as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(preset, 'green-screen');
    act(() => preset.dispatchEvent(new Event('change', { bubbles: true })));
    const applyButton = [...host!.querySelectorAll('button')].find((button) => button.textContent?.includes('Apply preset'))!;
    act(() => applyButton.click());

    expect(onUpdateVisualClip).toHaveBeenCalledWith(expect.objectContaining({
      blendMode: 'normal',
      filterStack: [],
      chromaKey: expect.objectContaining({ enabled: true, color: '#00ff00' }),
    }));
  });
});

describe('InspectorPanel live ducking picker authority', () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
  });

  const renderInspector = (overrides: Partial<Parameters<typeof InspectorPanel>[0]> = {}) => {
    act(() => {
      root!.render(
        <InspectorPanel
          audioTrackVolumes={[100, 100, 100]}
          onAddOrUpdateKeyframe={vi.fn()}
          onCommitVisualCropAsImageAsset={vi.fn()}
          onEditVisualText={vi.fn()}
          onGenerateNarrationFromText={vi.fn()}
          onJumpKeyframe={vi.fn()}
          onMatchAudioSpeechLevel={vi.fn()}
          onMoveAudioToTrack={vi.fn()}
          onMoveVisualToTrack={vi.fn()}
          onRemoveAudioClip={vi.fn()}
          onRemoveAudioKeyframe={vi.fn()}
          onRemoveStageObject={vi.fn()}
          onRemoveVisualClip={vi.fn()}
          onRemoveVisualKeyframe={vi.fn()}
          onSelectSource={vi.fn()}
          onSplitAudioClip={vi.fn(() => false)}
          onUpdateAudioClip={vi.fn()}
          onUpdateAudioKeyframe={vi.fn()}
          onUpdateStageObject={vi.fn()}
          onUpdateVisualClip={vi.fn()}
          onUpdateVisualKeyframe={vi.fn()}
          sequenceDurationSeconds={6}
          timelineCursorSeconds={0}
          {...overrides}
        />,
      );
    });
  };

  const controlClipSelect = (): HTMLSelectElement => {
    const select = [...host!.querySelectorAll('label')].find((label) =>
      label.firstElementChild?.textContent === 'Control clip',
    )?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    return select;
  };

  const offeredControlIds = (): string[] =>
    [...controlClipSelect().options]
      .map((option) => option.value)
      .filter((value) => value !== '');

  it('labels the control by its source name on the live path while the dead fallback shape stays unidentifiable', () => {
    const target = createEditorAudioClip('music-source', 1);
    const control = createEditorAudioClip('dialogue-source', 0);

    renderInspector({
      audioClip: target,
      audioClips: [target, control],
      audioSourceItemsByClipId: new Map([
        [control.id, { id: control.id, nodeId: control.id, label: 'Interview dialogue', kind: 'audio' as const }],
      ]),
    });
    const liveOptions = [...controlClipSelect().options].map((option) => option.textContent);
    expect(liveOptions).toContain('Interview dialogue · A1');
    expect(liveOptions).not.toContain('Audio track 1 · A1');


    renderInspector({
      audioClip: target,
      audioClips: [target, control],
    });
    const deadFallbackOptions = [...controlClipSelect().options].map((option) => option.textContent);
    expect(deadFallbackOptions).toContain('Audio track 1 · A1');
  });

  it('excludes a muted-track control on the live path while the dead fallback shape still offers it', () => {
    const target = createEditorAudioClip('music-source', 1);
    const control = createEditorAudioClip('muted-dialogue', 0);

    renderInspector({
      audioClip: target,
      audioClips: [target, control],
      mutedAudioTracks: [control.trackIndex],
    });
    expect(offeredControlIds()).toEqual([]);


    renderInspector({
      audioClip: target,
      audioClips: [target, control],
    });
    expect(offeredControlIds()).toEqual([control.id]);
  });

  it('excludes a solo-ineligible control on the live path while the dead fallback shape still offers it', () => {
    const target = createEditorAudioClip('music-source', 1);
    const control = createEditorAudioClip('unsoloed-dialogue', 0);

    renderInspector({
      audioClip: target,
      audioClips: [target, control],
      soloAudioTracks: [target.trackIndex],
    });
    expect(offeredControlIds()).toEqual([]);


    renderInspector({
      audioClip: target,
      audioClips: [target, control],
    });
    expect(offeredControlIds()).toEqual([control.id]);
  });

  it('offers exactly the control set the export executor keeps audible', () => {
    const target = createEditorAudioClip('music-source', 1);
    const dialogue = createEditorAudioClip('dialogue-source', 0);
    const disabled = createEditorAudioClip('disabled-source', 0, { enabled: false });
    const foley = createEditorAudioClip('foley-source', 2);
    const audioClips: EditorAudioClip[] = [target, dialogue, disabled, foley];
    const sourceMap = new Map(audioClips.map((clip) => [
      clip.id,
      { id: clip.id, nodeId: clip.id, label: clip.id, kind: 'audio' as const },
    ]));

    const arrangements: Array<{ label: string; muted: number[]; solo: number[] }> = [
      { label: 'no mute or solo', muted: [], solo: [] },
      { label: 'muted control track', muted: [dialogue.trackIndex], solo: [] },
      { label: 'soloed target track only', muted: [], solo: [target.trackIndex] },
      { label: 'solo covering one control track', muted: [], solo: [foley.trackIndex] },
    ];

    for (const arrangement of arrangements) {
      renderInspector({
        audioClip: target,
        audioClips,
        audioSourceItemsByClipId: sourceMap,
        mutedAudioTracks: arrangement.muted,
        soloAudioTracks: arrangement.solo,
      });

      // The export executor (flowStore collectEditorAudioSequence) keeps a clip exactly when it is
      // enabled and its track is audible under the same mute/solo authority.
      const exportKept = audioClips
        .filter((clip) => clip.id !== target.id)
        .filter((clip) => clip.enabled && isAudioTrackAudible(clip.trackIndex, arrangement.muted, arrangement.solo))
        .map((clip) => clip.id)
        .sort();
      expect(offeredControlIds().sort(), arrangement.label).toEqual(exportKept);
    }
  });

  it('wires the authoritative values into the live dockable/mobile mount, not only the dead legacy fallback', () => {
    const workspaceSource = readFileSync(resolve(process.cwd(), 'src/features/video/workspace/VideoWorkspace.tsx'), 'utf8');

    const liveMountStart = workspaceSource.indexOf("withVideoPanelDefault('inspector'");
    const liveMountEnd = workspaceSource.indexOf("withVideoPanelDefault('premiereParity'");
    expect(liveMountStart).toBeGreaterThan(-1);
    expect(liveMountEnd).toBeGreaterThan(liveMountStart);
    const liveMount = workspaceSource.slice(liveMountStart, liveMountEnd);
    expect(liveMount).toContain('mutedAudioTracks={mutedAudioTracks}');
    expect(liveMount).toContain('soloAudioTracks={soloAudioTracks}');
    expect(liveMount).toContain('audioSourceItemsByClipId={new Map(audioClips.map((clip) => [clip.id, sourceItemByNodeId.get(clip.sourceNodeId)]))}');

    expect(workspaceSource).toContain('const renderLegacyVideoFallback = false;');

    const legacyMountStart = workspaceSource.indexOf('{renderLegacyVideoFallback ? (');
    expect(legacyMountStart).toBeGreaterThan(liveMountEnd);
    const legacyMount = workspaceSource.slice(legacyMountStart);
    expect(legacyMount).toContain('mutedAudioTracks={mutedAudioTracks}');

    expect(workspaceSource).toContain('<VideoWorkspaceMobileShell panels={videoPanels}');
    expect(workspaceSource).toContain('<DockablePanelHost className="h-full" panels={videoPanels}');
  });

  it('discloses the un-ducked preview boundary in the mounted ducking section', () => {
    const target = createEditorAudioClip('music-source', 1);
    renderInspector({ audioClip: target, audioClips: [target] });
    expect(host!.textContent).toContain('Timeline and monitor preview stay un-ducked');
  });

  it('passes every persisted audio-track authority into the composition cache signature', () => {
    const workspaceSource = readFileSync(resolve(process.cwd(), 'src/features/video/workspace/VideoWorkspace.tsx'), 'utf8');
    const signatureStart = workspaceSource.indexOf('buildVideoCompositionRenderCacheSignature({');
    const signatureEnd = workspaceSource.indexOf('    }),', signatureStart);
    expect(signatureStart).toBeGreaterThan(-1);
    expect(signatureEnd).toBeGreaterThan(signatureStart);

    const signatureInput = workspaceSource.slice(signatureStart, signatureEnd);
    expect(signatureInput).toContain('editorMutedAudioTracks: mutedAudioTracks');
    expect(signatureInput).toContain('editorSoloAudioTracks: soloAudioTracks');
    expect(signatureInput).toContain('editorAudioTrackVolumes: audioTrackVolumes');
  });
});
