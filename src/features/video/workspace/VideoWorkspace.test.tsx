import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramStageClip } from '../../../components/Editor/ManualEditorWorkspaceUtils';
import { getVideoCanvasDimensions } from '../../../lib/videoCanvas';
import { createEditorVisualClip } from '../../../lib/manualEditorState';
import { buildVisualClipFromEditorAsset, createEditorAsset } from '../../../lib/editorAssets';
import { buildVideoParityDiagnostics, buildVideoSequenceSummary } from '../../../lib/videoPremiereParity';
import { buildVideoCompositionRenderCacheSignature } from '../../../lib/videoRenderCache';
import { selectNextVideoRenderQueueWork } from '../../../lib/videoRenderQueue';
import { createDefaultVideoWorkflowDeliveryJob } from '../../../lib/videoWorkflowIntegration';
import { createDefaultEditorProfessionalWorkflowState } from '../../../types/videoProduction';
import { sanitizeEditorProfessionalWorkflowState } from '../../../lib/videoProductionState';
import {
  buildVideoClipClipboard,
  createVideoClipboardVisualTimelineClip,
  planVideoClipPaste,
} from '../../../lib/videoClipClipboard';
import { applyClipSetTransitionToTimelineMarkers, planClipTimelineMarkerPaste } from '../../../lib/editorTimelineMarkers';
import { createEditorAudioClip } from '../../../lib/manualEditorState';
import { proposeTranscriptSelectionEdit, type EditableTranscriptWord } from '../../../lib/videoTranscriptEditing';
import type { VideoExportReadinessSummary } from '../../../lib/videoExportReadiness';
import type { VideoRenderBackendSummary } from '../../../lib/videoRenderBackendStatus';
import type { AspectRatio, VideoExportPresetPlanId, VideoResolution } from '../../../types/flow';
import {
  ProgramMonitorPanel,
  SourceItemCard,
  TimelineMarkerFlag,
  TrackAddControl,
  VIDEO_TIMELINE_MARKER_HELP_HOTKEYS,
  buildEditorClipMarkerTransitionDescriptors,
  buildEditorHistoryRestorePatch,
  buildVideoDeliveryQueueHost,
  buildKeyboardTrimEditPatch,
  buildTimelineClipRemovalPatch,
  buildTrackMenuOptions,
  captureTimelineClipMarkerClipboard,
  isTimelineMarkerRemovalKey,
  planWorkspaceTranscriptEdit,
  requestVideoMarkerImportApproval,
  resolveClipFitState,
  searchEditableTranscriptSafely,
  summarizeWorkspaceTranscriptPlan,
} from './VideoWorkspace';
import type { SourceBinItem } from '../../../lib/sourceBin';
import type { ManagedFontRegistrationGateState } from './useManagedFontRegistrationGate';

function renderProgramMonitor({
  aspectRatio = '16:9',
  videoResolution = '1080p',
  canvas = getVideoCanvasDimensions(aspectRatio, videoResolution),
  exportReadiness = {
    tone: 'ready',
    label: 'Ready',
    detail: 'Video export sources are available.',
    issueCount: 0,
  },
  renderBackendStatus = {
    tone: 'gpu',
    label: 'Auto GPU-first',
    detail: 'Auto prefers AMD VAAPI GPU, then native CPU, then browser FFmpeg.',
  },
  incrementalRenderSummary,
  renderCacheDetailLines,
  previewUrl,
  previewOutputMetadata,
  playheadSeconds = 0,
  errorMessage,
  isRunning = false,
  renderStatusMessage,
  stageClips = [],
  stageMode = 'stage',
  selectedClip = stageClips[0]?.clip,
  hasActiveComposition = true,
  onCreateStarterSequence,
  onRevealSourceBin,
  initialSidebarTab,
  managedFontGate,
  exportPresetId,
}: {
  aspectRatio?: AspectRatio;
  videoResolution?: VideoResolution;
  canvas?: { width: number; height: number };
  exportReadiness?: VideoExportReadinessSummary;
  renderBackendStatus?: VideoRenderBackendSummary;
  incrementalRenderSummary?: string;
  renderCacheDetailLines?: string[];
  previewUrl?: string;
  previewOutputMetadata?: Record<string, unknown>;
  playheadSeconds?: number;
  errorMessage?: string;
  isRunning?: boolean;
  renderStatusMessage?: string;
  stageMode?: 'stage' | 'rendered';
  selectedClip?: ProgramStageClip['clip'];
  stageClips?: ProgramStageClip[];
  hasActiveComposition?: boolean;
  onCreateStarterSequence?: () => void;
  onRevealSourceBin?: () => void;
  initialSidebarTab?: 'tools' | 'info' | 'output';
  managedFontGate?: ManagedFontRegistrationGateState;
  exportPresetId?: VideoExportPresetPlanId;
} = {}): string {
  const visualClips = stageClips.map((stageClip) => stageClip.clip);
  const durationSeconds = Math.max(0, ...stageClips.map((stageClip) => stageClip.durationSeconds));

  return renderToStaticMarkup(
    <ProgramMonitorPanel
      activeTool="select"
      aspectRatio={aspectRatio}
      audioClipCount={0}
      canvas={canvas}
      errorMessage={errorMessage}
      exportPresetPlan={{ presetId: exportPresetId ?? 'review-h264-1080p' }}
      exportReadiness={exportReadiness}
      frameRate={30}
      hasActiveComposition={hasActiveComposition}
      hasCaptionCues={false}
      initialSidebarTab={initialSidebarTab}
      onCreateStarterSequence={onCreateStarterSequence}
      onRevealSourceBin={onRevealSourceBin}
      incrementalRenderSummary={incrementalRenderSummary}
      isRunning={isRunning}
      managedFontGate={managedFontGate}
      monitorParityNotices={[]}
      onAddEditorAsset={vi.fn()}
      onAspectRatioChange={vi.fn()}
      onExportCaptions={vi.fn()}
      onExportPresetPlanChange={vi.fn()}
      onFrameRateChange={vi.fn()}
      onOpenClipContextMenu={vi.fn()}
      onOpenContextMenu={vi.fn()}
      onResolutionChange={vi.fn()}
      onRun={vi.fn()}
      onSelectClip={vi.fn()}
      onSelectStageObject={vi.fn()}
      onSetMonitorMode={vi.fn()}
      onUpdateClip={vi.fn()}
      onUpdateStageObject={vi.fn()}
      parityDiagnostics={buildVideoParityDiagnostics({ visualClips, stageObjects: [] })}
      previewOutputMetadata={previewOutputMetadata}
      previewUrl={previewUrl}
      playheadSeconds={playheadSeconds}
      renderBackendStatus={renderBackendStatus}
      renderCacheDetailLines={renderCacheDetailLines}
      renderStatusMessage={renderStatusMessage}
      selectedClip={selectedClip}
      selectedStageObject={undefined}
      sequenceSummary={buildVideoSequenceSummary(aspectRatio, videoResolution, canvas, durationSeconds, 30)}
      stageClips={stageClips}
      stageMode={stageMode}
      stageObjects={[]}
      videoRef={createRef<HTMLVideoElement>()}
      videoResolution={videoResolution}
      visualClipCount={visualClips.length}
    />,
  );
}

function makeImageStageClip(clip: ProgramStageClip['clip'], sourceWidth = 1280, sourceHeight = 720): ProgramStageClip {
  return {
    clip,
    durationSeconds: clip.durationSeconds ?? 4,
    localTimeSeconds: 0,
    sourceHeight,
    sourceWidth,
    item: {
      id: clip.sourceNodeId,
      nodeId: clip.sourceNodeId,
      kind: 'image',
      label: 'Program source',
      assetUrl: 'data:image/png;base64,stub',
      createdAt: 1,
    },
  };
}

describe('ProgramMonitorPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mounts a native-only MXF delivery selection without pretending browser rendering can run it', () => {
    const html = renderProgramMonitor({ initialSidebarTab: 'output', exportPresetId: 'broadcast-mxf' });

    expect(html).toContain('Broadcast MXF handoff (native CPU)');
    expect(html).toContain('(native required)');
    expect(html).toContain('MPEG-2 4:2:2 / 48 kHz PCM when source audio is present');
    expect(html).not.toContain('value="broadcast-mxf" disabled');
  });

  it('keeps the edit stage and Program Tools primary instead of embedding full secondary panels', () => {
    const html = renderProgramMonitor();

    expect(html).toContain('Program Tools');
    expect(html).toContain('data-program-stage-shell');
    expect(html).toContain('data-video-render-button="true"');
    expect(html).toContain('data-video-rendered-preview-tab="true"');
    expect(html).not.toContain('Sequence Settings');
    expect(html).not.toContain('Export Preset');
  });

  it('marks rendered video previews with a stable smoke selector', () => {
    const html = renderProgramMonitor({
      playheadSeconds: 42.5,
      previewUrl: 'blob:native-video-render-smoke',
      stageMode: 'rendered',
    });

    expect(html).toContain('data-video-rendered-preview="true"');
    expect(html).toContain('data-video-rendered-preview-state="ready"');
    expect(html).toContain('data-video-rendered-preview-playhead="42.5"');
    expect(html).toContain('blob:native-video-render-smoke');
  });

  it('mounts decoded-frame scopes in Program Monitor Info only for a playable rendered preview', () => {
    const ready = renderProgramMonitor({
      initialSidebarTab: 'info',
      previewUrl: 'blob:program-preview-for-scopes',
      stageMode: 'rendered',
    });
    expect(ready).toContain('data-video-decoded-scopes="idle"');
    expect(ready).toContain('data-video-decoded-scopes-source="rendered-program-monitor"');
    expect(ready).toContain('Measures only pixels already decoded by the mounted rendered Program Monitor.');

    const stage = renderProgramMonitor({ initialSidebarTab: 'info', stageMode: 'stage' });
    expect(stage).toContain('data-video-decoded-scopes="unavailable"');
    expect(stage).toContain('Switch the Program Monitor to Rendered Preview');
  });

  it('surfaces an explicit idle rendered-preview descriptor before any render starts', () => {
    const html = renderProgramMonitor({
      stageMode: 'rendered',
    });

    expect(html).toContain('data-video-render-preview-status="idle"');
    expect(html).toContain('Ready to render');
    expect(html).toContain('Run Render to build a playable Program Monitor preview for this composition.');
  });

  it('shows an explicit waiting state when rendered preview mode is active before a preview asset exists', () => {
    const html = renderProgramMonitor({
      stageMode: 'rendered',
      isRunning: true,
      renderStatusMessage: 'Rendering editor sequence locally…',
    });

    expect(html).toContain('data-video-render-preview-status="rendering"');
    expect(html).toContain('data-video-rendered-preview-state="waiting"');
    expect(html).toContain('Rendering preview');
    expect(html).toContain('Rendering editor sequence locally…');
    expect(html).not.toContain('data-program-stage-shell');
  });

  it('surfaces a completed rendered-preview descriptor with output metadata for playable video renders', () => {
    const html = renderProgramMonitor({
      previewUrl: 'blob:native-video-render-smoke',
      previewOutputMetadata: {
        fileName: 'signal-loom-program.mp4',
        mimeType: 'video/mp4',
        frameCount: 180,
        durationSeconds: 6,
      },
      stageMode: 'rendered',
    });

    expect(html).toContain('data-video-render-preview-status="completed"');
    expect(html).toContain('Preview ready');
    expect(html).toContain('signal-loom-program.mp4');
    expect(html).toContain('video/mp4');
    expect(html).toContain('180 frames');
  });

  it('shows an explicit error state when rendered preview mode has no playable preview', () => {
    const html = renderProgramMonitor({
      stageMode: 'rendered',
      errorMessage: 'Render failed because ffmpeg could not open one source clip.',
    });

    expect(html).toContain('data-video-render-preview-status="failed"');
    expect(html).toContain('data-video-rendered-preview-state="error"');
    expect(html).toContain('Rendered preview unavailable');
    expect(html).toContain('Render failed because ffmpeg could not open one source clip.');
    expect(html).not.toContain('data-program-stage-shell');
  });

  it('surfaces a no-playable-output reason when the render completes without a browser-previewable video', () => {
    const html = renderProgramMonitor({
      previewOutputMetadata: {
        fileName: 'signal-loom-program.mov',
        mimeType: 'video/quicktime',
      },
      renderStatusMessage: 'Render completed to a native-only QuickTime output.',
      stageMode: 'rendered',
    });

    expect(html).toContain('data-video-render-preview-status="unsupported"');
    expect(html).toContain('Preview unavailable');
    expect(html).toContain('Render completed to a native-only QuickTime output.');
    expect(html).toContain('browser preview may be unsupported');
  });

  it('renders clip stroke, opacity, filters, and incremental render cache summary in the program monitor', () => {
    const clip = createEditorVisualClip('source-1', 'image', {
      id: 'visual-stroked',
      durationSeconds: 4,
      fitMode: 'contain',
      opacityPercent: 65,
      scalePercent: 50,
      filterStack: [
        { id: 'contrast', kind: 'contrast', amount: 20, enabled: true },
      ],
      stroke: {
        enabled: true,
        color: '#ff00cc',
        widthPx: 8,
        opacityPercent: 80,
      },
    });
    const html = renderProgramMonitor({
      incrementalRenderSummary: 'Incremental render plan: 1/3 timeline spans changed.',
      initialSidebarTab: 'info',
      stageClips: [makeImageStageClip(clip)],
    });

    expect(html).toContain('Render cache');
    expect(html).toContain('Incremental render plan: 1/3 timeline spans changed.');
    expect(html).toContain('opacity:0.65');
    expect(html).toContain('filter:contrast(1.2)');
    expect(html).toContain('box-shadow:inset 0 0 0');
    expect(html).toContain('rgba(255, 0, 204, 0.800)');
  });

  it('renders export readiness and legacy analysis-only cache status in the program monitor', () => {
    const html = renderProgramMonitor({
      initialSidebarTab: 'info',
      exportReadiness: {
        tone: 'info',
        label: 'Analysis only',
        detail: 'Dirty spans are analysis-only until cached segment artifacts exist.',
        issueCount: 1,
      },
      incrementalRenderSummary: 'Incremental render plan: 1/3 timeline spans changed.',
    });

    expect(html).toContain('data-video-export-readiness="true"');
    expect(html).toContain('data-video-export-readiness-tone="info"');
    expect(html).toContain('Export');
    expect(html).toContain('Analysis only');
    expect(html).toContain('until cached segment artifacts exist');
  });

  it('renders inspectable render-cache assembly details in the program monitor', () => {
    const html = renderProgramMonitor({
      initialSidebarTab: 'info',
      incrementalRenderSummary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
      renderCacheDetailLines: [
        'Reuse 0.0s-1.0s from cached segment (1 clip).',
        'Extract 1.0s-2.5s from the new full render because timeline span changed (2 clips).',
        'Native segment assembly fallback: used the full rendered output because Cached segment 0-1000 must be a materialized data URL for native assembly.',
      ],
    });

    expect(html).toContain('data-video-render-cache-details="true"');
    expect(html).toContain('Reuse 0.0s-1.0s from cached segment (1 clip).');
    expect(html).toContain('Extract 1.0s-2.5s from the new full render because timeline span changed (2 clips).');
    expect(html).toContain('Native segment assembly fallback: used the full rendered output because Cached segment 0-1000 must be a materialized data URL for native assembly.');
  });

  it('renders the configured render backend in the program monitor', () => {
    const html = renderProgramMonitor({
      initialSidebarTab: 'info',
      renderBackendStatus: {
        tone: 'gpu',
        label: 'AMD VAAPI',
        detail: 'Forced AMD VAAPI GPU encode through the local native render service.',
      },
    });

    expect(html).toContain('data-video-render-backend="true"');
    expect(html).toContain('data-video-render-backend-tone="gpu"');
    expect(html).toContain('Backend');
    expect(html).toContain('AMD VAAPI');
    expect(html).toContain('Forced AMD VAAPI GPU encode');
  });

  it('disables rendering when export readiness reports missing media', () => {
    const html = renderProgramMonitor({
      exportReadiness: {
        tone: 'error',
        label: 'Missing media',
        detail: '1 missing timeline source must be restored before export is reliable.',
        issueCount: 1,
      },
    });

    const renderButton = html.match(/<button[^>]*data-video-render-button="true"[^>]*>/)?.[0];

    expect(renderButton).toBeDefined();
    expect(renderButton).toContain('disabled=""');
    expect(renderButton).toContain('title="1 missing timeline source must be restored before export is reliable."');
  });

  it('renders vertical program monitor clip geometry from the active canvas dimensions', () => {
    const canvas = getVideoCanvasDimensions('9:16', '1080p');
    const clip = createEditorVisualClip('source-vertical', 'image', {
      id: 'visual-vertical',
      durationSeconds: 4,
      fitMode: 'contain',
      scalePercent: 100,
    });

    const html = renderProgramMonitor({
      aspectRatio: '9:16',
      canvas,
      stageClips: [makeImageStageClip(clip, 1920, 1080)],
    });

    expect(html).toContain('width:1080px');
    expect(html).toContain('height:607.5px');
    expect(html).toContain('left:0px');
    expect(html).toContain('top:656.25px');
  });

  it('renders chroma key clips as keyed Program Monitor previews while preserving styling', () => {
    const clip = createEditorVisualClip('source-chroma', 'image', {
      id: 'visual-chroma',
      durationSeconds: 4,
      fitMode: 'contain',
      opacityPercent: 75,
      filterStack: [
        { id: 'brightness', kind: 'brightness', amount: 15, enabled: true },
      ],
      chromaKey: {
        enabled: true,
        color: '#00ff00',
        similarityPercent: 22,
        blendPercent: 7,
      },
      stroke: {
        enabled: true,
        color: '#22d3ee',
        widthPx: 6,
        opacityPercent: 90,
      },
    });
    const html = renderProgramMonitor({
      stageClips: [makeImageStageClip(clip)],
    });

    expect(html).toContain('data-chroma-key-preview="true"');
    expect(html).toContain('Chroma keyed preview for Program source');
    expect(html).not.toContain('Chroma key preview is export-only');
    expect(html).not.toContain('Program Monitor shows the unkeyed source');
    expect(html).not.toContain('data-chroma-key-export-notice="true"');
    expect(html).toContain('opacity:0.75');
    expect(html).toContain('filter:brightness(1.15)');
    expect(html).toContain('box-shadow:inset 0 0 0');
    expect(html).toContain('rgba(34, 211, 238, 0.900)');
  });

  it('renders a plain image clip with a wall-clock <img>, not a canvas', () => {
    const clip = createEditorVisualClip('source-1', 'image', {
      id: 'visual-plain',
      durationSeconds: 4,
    });
    const html = renderProgramMonitor({
      stageClips: [makeImageStageClip(clip)],
    });

    expect(html).toContain('<img');
    expect(html).not.toContain('<canvas');
  });

  it('renders a GIF image clip (detected via mimeType) with a canvas instead of a wall-clock <img>', () => {
    const clip = createEditorVisualClip('source-gif', 'image', {
      id: 'visual-gif',
      durationSeconds: 4,
    });
    const stageClip = makeImageStageClip(clip);
    const html = renderProgramMonitor({
      stageClips: [{
        ...stageClip,
        item: { ...stageClip.item!, mimeType: 'image/gif' },
      }],
    });

    expect(html).toContain('<canvas');
    expect(html).not.toContain('<img');
  });
});

function renderSourceItemCard(item: SourceBinItem, onRelink?: () => void, relinkDisabled = false): string {
  return renderToStaticMarkup(
    <SourceItemCard
      durationSeconds={undefined}
      isSelected={false}
      item={item}
      onAddAudio={vi.fn()}
      onAddVisual={vi.fn()}
      onAlignCaptions={vi.fn()}
      onApplyCaptions={vi.fn()}
      onAutoCaptions={vi.fn()}
      onCleanDialogue={vi.fn()}
      onOpenPreview={vi.fn()}
      onRelink={onRelink}
      relinkDisabled={relinkDisabled}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
      onToggleCollapsed={vi.fn()}
      onToggleStarred={vi.fn()}
      onUseAsAlignmentScript={vi.fn()}
    />,
  );
}

describe('SourceItemCard', () => {
  it('surfaces Page N import envelope labels for Paper-dropped source assets in Video', () => {
    const html = renderSourceItemCard({
      id: 'paper-import-item-1',
      nodeId: 'paper-import-item-1',
      label: 'native-paper-os-drop.png',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,stub',
      createdAt: 1,
      envelopeId: 'paper-page-imports:paper-1:page-2',
      envelopeLabel: 'Page 2 imports',
      envelopeIndex: 0,
    });

    expect(html).toContain('native-paper-os-drop.png');
    expect(html).toContain('Page 2 imports');
  });

  it('shows the primary "+Add" affordance instead of cryptic V1-V4 clip buttons (F05)', () => {
    const html = renderSourceItemCard({
      id: 'image-item-1',
      nodeId: 'image-item-1',
      label: 'hero-frame.png',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,stub',
      createdAt: 1,
    });

    // Primary add + labelled track menu.
    expect(html).toContain('Add Video');
    expect(html).toContain('aria-label="Choose Video track"');
    expect(html).toContain('Video 4');
    // The bare "V1" cryptic buttons are gone (the visible label is now "Video 1").
    expect(html).not.toContain('>V1<');
  });

  it('offers generated caption files as an apply-to-timeline action', () => {
    const html = renderSourceItemCard({
      id: 'captions-1',
      nodeId: 'captions-1',
      label: 'captions.vtt',
      kind: 'subtitle',
      mimeType: 'text/vtt',
      assetUrl: 'signal-loom-asset://captions-1',
      createdAt: 1,
    });

    expect(html).toContain('Apply To Timeline');
    expect(html).toContain('Use As Alignment Script');
    expect(html).toContain('captions.vtt');
  });

  it('offers audio and video sources an Auto Captions action', () => {
    const html = renderSourceItemCard({
      id: 'audio-1',
      nodeId: 'audio-1',
      label: 'interview.wav',
      kind: 'audio',
      mimeType: 'audio/wav',
      assetUrl: 'data:audio/wav;base64,UklGRg==',
      createdAt: 1,
    });

    expect(html).toContain('Auto Captions');
    expect(html).toContain('Clean Dialogue');
    expect(html).toContain('Align Captions');
  });

  it('exposes relink only when the native media-management route is supplied', () => {
    const item: SourceBinItem = {
      id: 'offline-video',
      nodeId: 'offline-video',
      label: 'offline.mov',
      kind: 'video',
      mimeType: 'video/quicktime',
      createdAt: 1,
      professional: { version: 1, origin: 'imported', onlineState: 'offline' },
    };

    expect(renderSourceItemCard(item)).not.toContain('Relink…');
    const nativeHtml = renderSourceItemCard(item, vi.fn());
    expect(nativeHtml).toContain('Relink…');
    expect(nativeHtml).toMatch(/>offline<\/span>/);
    expect(nativeHtml).toContain('an existing saved fingerprint must match');
    expect(renderSourceItemCard(item, vi.fn(), true)).toContain('disabled=""');
  });
});

describe('ProgramMonitorPanel empty state (F10)', () => {
  it('offers actionable starter templates and a Source Library shortcut when no composition exists', () => {
    const html = renderProgramMonitor({
      hasActiveComposition: false,
      onCreateStarterSequence: vi.fn(),
      onRevealSourceBin: vi.fn(),
    });

    expect(html).toContain('Create 1080p sequence');
    expect(html).toContain('Add media from the Source Library');
  });
});

describe('resolveClipFitState (F09 shared fit state)', () => {
  it('reads fit mode from the single clip source of truth regardless of playhead progress', () => {
    const clip = createEditorVisualClip('node-1', 'image', { fitMode: 'cover', scalePercent: 140 });

    // The Program Tools panel and the Inspector call this helper at different playhead
    // progress values — the fit mode must stay identical (one source of truth).
    const programToolsView = resolveClipFitState(clip, 0);
    const inspectorView = resolveClipFitState(clip, 75);

    expect(programToolsView.fitMode).toBe('cover');
    expect(inspectorView.fitMode).toBe('cover');
    expect(programToolsView.fitMode).toBe(inspectorView.fitMode);
    // It still carries the keyframe-derived transform fields both surfaces rely on.
    expect(programToolsView).toHaveProperty('scalePercent');
    expect(programToolsView).toHaveProperty('opacityPercent');
    expect(programToolsView).toHaveProperty('rotationDeg');
  });
});

describe('buildTrackMenuOptions (F05)', () => {
  it('produces labelled options for each track', () => {
    expect(buildTrackMenuOptions(4, 'Video')).toEqual([
      { trackIndex: 0, label: 'Video 1' },
      { trackIndex: 1, label: 'Video 2' },
      { trackIndex: 2, label: 'Video 3' },
      { trackIndex: 3, label: 'Video 4' },
    ]);
    expect(buildTrackMenuOptions(0, 'Audio')).toEqual([]);
  });
});

describe('TrackAddControl (F05)', () => {
  const StubIcon = () => null;

  it('renders a primary Add button plus a labelled track menu', () => {
    const html = renderToStaticMarkup(
      <TrackAddControl icon={StubIcon} noun="Video" onAdd={vi.fn()} trackCount={4} />,
    );

    expect(html).toContain('Add Video');
    expect(html).toContain('title="Add to Video 1"');
    expect(html).toContain('aria-label="Choose Video track"');
    expect(html).toContain('Video 1');
    expect(html).toContain('Video 4');
  });

  it('omits the track menu when there is a single track', () => {
    const html = renderToStaticMarkup(
      <TrackAddControl icon={StubIcon} noun="Audio" onAdd={vi.fn()} trackCount={1} />,
    );

    expect(html).toContain('Add Audio');
    expect(html).not.toContain('aria-label="Choose Audio track"');
  });
});
function makeTextStageClip(clip: ProgramStageClip['clip'], asset?: ProgramStageClip['asset']): ProgramStageClip {
  return {
    clip,
    durationSeconds: clip.durationSeconds ?? 4,
    localTimeSeconds: 0,
    sourceWidth: 1280,
    sourceHeight: 720,
    asset,
  };
}

describe('ProgramMonitorPanel text preview', () => {
  it('quotes multi-word bundled families in the straight text preview (FBL-012)', () => {
    const clip = createEditorVisualClip('asset-1', 'text', {
      textFontFamily: 'M PLUS 1, sans-serif',
      textSizePx: 96,
      textTypography: { fontWeight: 700, fontStyle: 'italic' },
    });
    const html = renderProgramMonitor({
      stageClips: [makeTextStageClip(clip)],
    });

    expect(html).toContain('font-family:&quot;M PLUS 1&quot;, sans-serif');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
  });

  it('does not paint managed text or a stale rendered preview while registration is loading or failed', () => {
    const clip = createEditorVisualClip('asset-managed', 'text', {
      textContent: 'Must stay gated',
      textFontFamily: 'Duplicate Family',
      textTypography: {
        managedFace: {
          kind: 'bundled', schemaVersion: 2, faceId: 'face-a', family: 'Duplicate Family',
          weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0,
          sha256: 'a'.repeat(64), byteLength: 100,
        },
      },
    });
    const loading = renderProgramMonitor({
      managedFontGate: { status: 'loading', retry: vi.fn() },
      previewUrl: 'blob:stale-preview',
      stageClips: [makeTextStageClip(clip)],
    });
    expect(loading).toContain('data-video-managed-font-gate="loading"');
    expect(loading).not.toContain('Must stay gated');
    expect(loading).not.toContain('blob:stale-preview');

    const failed = renderProgramMonitor({
      managedFontGate: { status: 'error', error: 'Full hash mismatch', retry: vi.fn() },
      stageClips: [makeTextStageClip(clip)],
    });
    expect(failed).toContain('data-video-managed-font-gate="error"');
    expect(failed).toContain('Full hash mismatch');
    expect(failed).toContain('Retry managed font registration');
    expect(failed).not.toContain('Must stay gated');
  });
});

describe('buildVisualClipFromEditorAsset', () => {
  it('carries family/weight/style from a text asset into the clip typography (AUD-026)', () => {
    const asset = createEditorAsset('text', { label: 'Title' });
    asset.textDefaults = {
      ...asset.textDefaults!,
      fontFamily: 'M PLUS 1, sans-serif',
      fontWeight: 700,
      fontStyle: 'italic',
    };

    const clip = buildVisualClipFromEditorAsset(asset, { trackIndex: 1, startMs: 250 });

    expect(clip.sourceKind).toBe('text');
    expect(clip.textFontFamily).toBe('M PLUS 1, sans-serif');
    expect(clip.textTypography).toEqual({ fontWeight: 700, fontStyle: 'italic' });
    expect(clip.trackIndex).toBe(1);
    expect(clip.startMs).toBe(250);
  });

  it('survives normalization and save/load boundaries intact', () => {
    const asset = createEditorAsset('text', { label: 'Title' });
    asset.textDefaults = {
      ...asset.textDefaults!,
      fontFamily: 'Source Sans 3, sans-serif',
      fontWeight: 600,
      fontStyle: 'italic',
    };

    const clip = buildVisualClipFromEditorAsset(asset, { trackIndex: 0, startMs: 0 });
    const normalized = createEditorVisualClip(clip.sourceNodeId, clip.sourceKind, clip);

    expect(normalized.textTypography).toEqual({ fontWeight: 600, fontStyle: 'italic' });
  });
});

describe('timeline marker workspace integration', () => {
  it('publishes help that exactly matches the routed add/previous/next marker shortcuts', () => {
    expect(VIDEO_TIMELINE_MARKER_HELP_HOTKEYS).toEqual([
      ['Ctrl/Cmd + M', 'Drop a labeled marker at the playhead'],
      ['Shift + M', 'Jump to the previous timeline marker'],
      ['Alt/Option + M', 'Jump to the next timeline marker'],
    ]);
  });

  it('gives ruler flags an accessible marker identity, state, color, time, and removal keys', () => {
    const html = renderToStaticMarkup(
      <TimelineMarkerFlag
        displayTimelineSeconds={10}
        marker={{
          id: 'review-range',
          seconds: 1.25,
          endSeconds: 3.5,
          label: 'Client review',
          color: '#f472b6',
          kind: 'review',
        }}
        onJump={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain('data-timeline-marker-id="review-range"');
    expect(html).toContain('aria-keyshortcuts="Enter Delete Backspace"');
    expect(html).toContain('aria-label="Client review, review range marker at 1.250 to 3.500 seconds, color #f472b6. Press Enter to jump; Delete or Backspace to remove."');
    expect(html).toContain('left:12.5%');
    expect(html).toContain('background:#f472b6');
    expect(isTimelineMarkerRemovalKey('Delete')).toBe(true);
    expect(isTimelineMarkerRemovalKey('Backspace')).toBe(true);
    expect(isTimelineMarkerRemovalKey('Enter')).toBe(false);
  });

  it('identifies clip-relative ruler flags as clip markers with the same accessible removal behavior', () => {
    const html = renderToStaticMarkup(
      <TimelineMarkerFlag
        displayTimelineSeconds={10}
        marker={{
          id: 'clip-note',
          seconds: 3.5,
          label: 'Cut note',
          color: '#fbbf24',
          kind: 'edit',
          clipId: 'visual-1',
          clipOffsetMs: 1_500,
        }}
        onJump={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain('data-timeline-marker-id="clip-note"');
    expect(html).toContain('aria-keyshortcuts="Enter Delete Backspace"');
    expect(html).toContain('aria-label="Cut note, edit clip marker at 3.500 seconds, color #fbbf24. Press Enter to jump; Delete or Backspace to remove."');
    expect(html).toContain('left:35%');
  });

  it('does not replace markers until import warnings receive an explicit approval', async () => {
    const requestConfirmation = vi.fn().mockResolvedValue(false);
    const clean = { requiresConfirmation: false, issues: [], message: '' };
    await expect(requestVideoMarkerImportApproval(clean, requestConfirmation)).resolves.toBe(true);
    expect(requestConfirmation).not.toHaveBeenCalled();

    const review = {
      requiresConfirmation: true,
      issues: ['Sequence mismatch.'],
      message: 'Sequence mismatch. Continue?',
    };
    await expect(requestVideoMarkerImportApproval(review, requestConfirmation)).resolves.toBe(false);
    expect(requestConfirmation).toHaveBeenCalledWith('Sequence mismatch. Continue?', 'Review Marker Import');
  });

  it('keeps timeline markers render-neutral in the composition cache signature', () => {
    const renderInput = {
      aspectRatio: '16:9',
      videoResolution: '1080p',
      frameRate: 30,
      timelineDurationSeconds: 5,
      visualClips: [{ id: 'clip-a', sourceNodeId: 'source-a', startMs: 0, durationSeconds: 5 }],
      audioClips: [],
      stageObjects: [],
    };
    const withMarkers = {
      ...renderInput,
      editorTimelineMarkers: [{ id: 'marker-a', seconds: 1, label: 'Review', color: '#22d3ee' }],
    };
    const withClipMarkers = {
      ...renderInput,
      editorTimelineMarkers: [
        { id: 'marker-a', seconds: 1, label: 'Review', color: '#22d3ee' },
        { id: 'clip-note', seconds: 2, label: 'Anchored', color: '#fbbf24', clipId: 'clip-a', clipOffsetMs: 2_000 },
      ],
    };

    expect(buildVideoCompositionRenderCacheSignature(withMarkers)).toBe(buildVideoCompositionRenderCacheSignature(renderInput));
    expect(buildVideoCompositionRenderCacheSignature(withClipMarkers)).toBe(buildVideoCompositionRenderCacheSignature(renderInput));
  });
});

describe('clip marker lifecycle routes', () => {
  const visual = { ...createEditorVisualClip('source-a', 'video', { trackIndex: 0, startMs: 2_000, sourceInMs: 0, sourceOutMs: 4_000 }), id: 'visual-1' };
  const otherVisual = { ...createEditorVisualClip('source-b', 'video', { trackIndex: 0, startMs: 8_000 }), id: 'visual-2' };
  const audio = {
    ...createEditorAudioClip('source-a', 0, { offsetMs: 5_000, sourceInMs: 0, sourceOutMs: 4_000 }),
    id: 'audio-1',
  };
  const markers = () => [
    {
      id: 'visual-note', seconds: 3.5, label: 'Cut note', color: '#fbbf24', kind: 'edit' as const,
      clipId: 'visual-1', clipOffsetMs: 1_500, createdAt: 100, updatedAt: 200,
    },
    {
      id: 'audio-note', seconds: 5.25, label: 'Audio note', color: '#a78bfa', kind: 'sync' as const,
      clipId: 'audio-1', clipOffsetMs: 250, createdAt: 100, updatedAt: 200,
    },
    { id: 'absolute', seconds: 1, label: 'Absolute', color: '#22d3ee' },
  ];

  it('routes audio lane removal through one atomic patch that also removes owned markers', () => {
    const patch = buildTimelineClipRemovalPatch(
      { visualClips: [visual], audioClips: [audio], timelineMarkers: markers() },
      ['audio-1'],
    );

    expect(patch.editorAudioClips).toHaveLength(0);
    expect(patch.editorVisualClips).toEqual([visual]);
    expect(patch.editorTimelineMarkers.map((marker) => marker.id)).toEqual(['visual-note', 'absolute']);
  });

  it('routes visual removal (Remove From Cut / keyboard delete) through the same atomic patch', () => {
    const patch = buildTimelineClipRemovalPatch(
      { visualClips: [visual, otherVisual], audioClips: [audio], timelineMarkers: markers() },
      ['visual-1'],
    );

    expect(patch.editorVisualClips.map((clip) => clip.id)).toEqual(['visual-2']);
    expect(patch.editorAudioClips).toEqual([audio]);
    expect(patch.editorTimelineMarkers.map((marker) => marker.id)).toEqual(['audio-note', 'absolute']);
  });

  it('captures selection markers for the clipboard with resolved offsets, then cut removes them atomically', () => {
    const captured = captureTimelineClipMarkerClipboard(markers(), [visual], [audio], ['visual-1']);
    expect(captured.map((marker) => [marker.id, marker.clipId, marker.clipOffsetMs])).toEqual([
      ['visual-note', 'visual-1', 1_500],
    ]);

    const cut = buildTimelineClipRemovalPatch(
      { visualClips: [visual], audioClips: [audio], timelineMarkers: markers() },
      ['visual-1'],
    );
    expect(cut.editorTimelineMarkers.some((marker) => marker.clipId === 'visual-1')).toBe(false);
  });

  it('pastes the captured markers onto remapped clip copies through the real clipboard planners', () => {
    const clipboardClip = createVideoClipboardVisualTimelineClip({
      clip: visual,
      trackId: 'video:0',
      sourceItemId: 'source-a',
    });
    const built = buildVideoClipClipboard({
      operation: 'copy',
      sourceSequenceId: 'sequence-1',
      sourceRevision: 'revision-1',
      clips: [clipboardClip],
      selectedClipIds: ['visual-1'],
      tracks: [{ id: 'video:0', kind: 'video', order: 0, locked: false }],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const plan = planVideoClipPaste({
      clipboard: built.document,
      destinationSequenceId: 'sequence-1',
      atMs: 10_000,
      mode: 'overwrite',
      tracks: [{ id: 'video:0', kind: 'video', order: 0, locked: false }],
      availableSourceItemIds: new Set(['source-a']),
      existingClips: [clipboardClip],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const captured = captureTimelineClipMarkerClipboard(markers(), [visual], [audio], ['visual-1']);
    const pasted = planClipTimelineMarkerPaste({
      markers: markers(),
      clipboardMarkers: captured,
      pastedClips: plan.plan.clips.map((descriptor) => ({
        id: descriptor.id,
        copiedFromClipId: descriptor.copiedFromClipId,
        startMs: descriptor.startMs,
      })),
      overwriteFragments: new Map(),
      now: 5_000,
    });

    const pastedMarker = pasted.find((marker) => marker.clipId === 'visual-1-copy');
    expect(pastedMarker).toMatchObject({
      id: 'visual-note-copy',
      clipOffsetMs: 1_500,
      seconds: 11.5,
      label: 'Cut note',
      color: '#fbbf24',
      kind: 'edit',
      createdAt: 100,
      updatedAt: 5_000,
    });
    expect(pasted.find((marker) => marker.id === 'visual-note')?.clipId).toBe('visual-1');
    expect(new Set(pasted.map((marker) => marker.id)).size).toBe(pasted.length);
  });

  it('runs extract-style transitions through the route descriptor builder used by trim, lift/extract, transcript, and batch commits', () => {
    const beforeVisual = visual;
    const afterVisual = { ...createEditorVisualClip('source-a', 'video', { trackIndex: 0, startMs: 2_000, sourceOutMs: 1_000 }), id: 'visual-1' };
    const fragment = {
      ...createEditorVisualClip('source-a', 'video', {
        trackIndex: 0,
        startMs: 3_000,
        sourceInMs: 3_000,
        sourceOutMs: 4_000,
      }),
      id: 'visual-1-right',
    };
    const before = buildEditorClipMarkerTransitionDescriptors([beforeVisual], [], new Map([
      [beforeVisual.id, { durationMs: 6_000, sourceInMs: 0 }],
    ]));
    const after = buildEditorClipMarkerTransitionDescriptors([afterVisual, fragment], [], new Map([
      [afterVisual.id, { durationMs: 1_000, sourceInMs: 0 }],
      [fragment.id, { durationMs: 1_000, sourceInMs: 3_000 }],
    ]));

    const transitioned = applyClipSetTransitionToTimelineMarkers(
      [
        { id: 'stays-left', seconds: 2.5, label: 'Left', color: '#fbbf24', clipId: 'visual-1', clipOffsetMs: 500 },
        { id: 'removed-range', seconds: 4.5, label: 'Removed', color: '#fbbf24', clipId: 'visual-1', clipOffsetMs: 2_500 },
        { id: 'reowned', seconds: 5.5, label: 'Reowned', color: '#fbbf24', clipId: 'visual-1', clipOffsetMs: 3_500 },
      ],
      before,
      after,
    );

    expect(transitioned.find((marker) => marker.id === 'stays-left')).toMatchObject({ clipId: 'visual-1', clipOffsetMs: 500 });
    expect(transitioned.some((marker) => marker.id === 'removed-range')).toBe(false);
    expect(transitioned.find((marker) => marker.id === 'reowned')).toMatchObject({
      clipId: 'visual-1-right',
      clipOffsetMs: 500,
      seconds: 3.5,
    });
    // Descriptors carry the identity fields that drive fragment inference.
    expect(before[0]).toMatchObject({ id: 'visual-1', kind: 'visual', trackIndex: 0, sourceNodeId: 'source-a', startMs: 2_000, rate: 1 });
    expect(after.find((descriptor) => descriptor.id === 'visual-1-right')).toMatchObject({ startMs: 3_000, sourceInMs: 3_000, durationMs: 1_000 });
  });
});

describe('keyboard Q/W/E trim marker routes', () => {
  const SOURCE_DURATION_MS = 10_000;
  const makeClip = (id: string, startMs: number, trimStartMs: number, trimEndMs: number) => ({
    ...createEditorVisualClip('source-a', 'video', { trackIndex: 0, startMs, trimStartMs, trimEndMs }),
    id,
  });
  // Tight lane: clipA [0s,4s) then clipB [4s,8s), each a 4s window out of a 10s source.
  const clipA = makeClip('visual-a', 0, 0, 6_000);
  const clipB = makeClip('visual-b', 4_000, 0, 6_000);
  const blocks = [
    { clip: clipA, startMs: 0, durationMs: 4_000 },
    { clip: clipB, startMs: 4_000, durationMs: 4_000 },
  ];
  // Resolver mirrors the effective window for clips without explicit in/out: [trimStart, source - trimEnd].
  const resolveTiming = (visual: readonly ReturnType<typeof makeClip>[]) => new Map(
    visual.map((clip) => [clip.id, {
      durationMs: SOURCE_DURATION_MS - (clip.trimStartMs ?? 0) - (clip.trimEndMs ?? 0),
      sourceInMs: clip.trimStartMs ?? 0,
    }]),
  );
  const markers = () => [
    { id: 'a-head', seconds: 0.5, label: 'Head', color: '#fbbf24', clipId: 'visual-a', clipOffsetMs: 500 },
    { id: 'a-mid', seconds: 2.5, label: 'Mid', color: '#fbbf24', clipId: 'visual-a', clipOffsetMs: 2_500 },
    { id: 'b-own', seconds: 5, label: 'B', color: '#a78bfa', clipId: 'visual-b', clipOffsetMs: 1_000 },
    { id: 'absolute', seconds: 1, label: 'Absolute', color: '#22d3ee' },
  ];

  const runRoute = (kind: 'ripple-in' | 'ripple-out' | 'roll', playheadMs: number, selectedClipId = 'visual-a') =>
    buildKeyboardTrimEditPatch({
      kind,
      visualClips: [clipA, clipB],
      timelineMarkers: markers(),
      selectedClipId,
      playheadMs,
      blocks,
      resolveClipTiming: resolveTiming,
    });

  it('keyboard ripple-in (Q) head-trims owned markers: trimmed-away content loses markers, survivors shift, the lane follows', () => {
    // Q to playhead 1s: clipA's head [0,1s) is consumed; clipB slides left to 3s.
    const patch = runRoute('ripple-in', 1_000);
    if (!patch) throw new Error('expected a ripple-in patch');

    const nextMarkers = patch.editorTimelineMarkers ?? [];
    expect(nextMarkers.some((marker) => marker.id === 'a-head')).toBe(false);
    expect(nextMarkers.find((marker) => marker.id === 'a-mid')).toMatchObject({ clipId: 'visual-a', clipOffsetMs: 1_500, seconds: 1.5 });
    expect(nextMarkers.find((marker) => marker.id === 'b-own')).toMatchObject({ clipId: 'visual-b', clipOffsetMs: 1_000, seconds: 4 });
    expect(nextMarkers.find((marker) => marker.id === 'absolute')).toBeDefined();
    expect(patch.editorVisualClips.find((clip) => clip.id === 'visual-b')).toMatchObject({ startMs: 3_000 });
  });

  it('keyboard ripple-out (W) tail-trims owned markers beyond the new duration and slides the lane', () => {
    // W to playhead 2s: clipA now ends at 2s; clipB slides left to 2s.
    const patch = runRoute('ripple-out', 2_000);
    if (!patch) throw new Error('expected a ripple-out patch');

    const nextMarkers = patch.editorTimelineMarkers ?? [];
    expect(nextMarkers.some((marker) => marker.id === 'a-mid')).toBe(false);
    expect(nextMarkers.find((marker) => marker.id === 'a-head')).toMatchObject({ clipId: 'visual-a', clipOffsetMs: 500, seconds: 0.5 });
    expect(nextMarkers.find((marker) => marker.id === 'b-own')).toMatchObject({ clipId: 'visual-b', clipOffsetMs: 1_000, seconds: 3 });
    expect(patch.editorVisualClips.find((clip) => clip.id === 'visual-b')).toMatchObject({ startMs: 2_000 });
  });

  it('keyboard roll (E) applies head-trim semantics to the right clip while the left clip only grows', () => {
    // E rolls the 4s cut to 5s: clipA extends to 5s; clipB's head is trimmed and it moves to 5s.
    const patch = runRoute('roll', 5_000);
    if (!patch) throw new Error('expected a roll patch');

    const nextMarkers = patch.editorTimelineMarkers ?? [];
    expect(nextMarkers.find((marker) => marker.id === 'a-head')).toMatchObject({ clipId: 'visual-a', clipOffsetMs: 500, seconds: 0.5 });
    expect(nextMarkers.find((marker) => marker.id === 'a-mid')).toMatchObject({ clipId: 'visual-a', clipOffsetMs: 2_500, seconds: 2.5 });
    // clipB's content is anchored: its 1s-offset marker keeps its timeline place at 5s.
    expect(nextMarkers.find((marker) => marker.id === 'b-own')).toMatchObject({ clipId: 'visual-b', clipOffsetMs: 0, seconds: 5 });
    expect(nextMarkers.find((marker) => marker.id === 'absolute')).toBeDefined();
  });

  it('returns undefined for no-op or impossible trims and omits the marker patch when no marker changes', () => {
    expect(runRoute('ripple-in', 0)).toBeUndefined();
    // A clip with no owned markers anywhere: the marker patch key is omitted entirely.
    const patch = buildKeyboardTrimEditPatch({
      kind: 'ripple-in',
      visualClips: [clipA, clipB],
      timelineMarkers: [{ id: 'absolute', seconds: 1, label: 'Absolute', color: '#22d3ee' }],
      selectedClipId: 'visual-a',
      playheadMs: 1_000,
      blocks,
      resolveClipTiming: resolveTiming,
    });
    if (!patch) throw new Error('expected a patch');
    expect(patch.editorTimelineMarkers).toBeUndefined();
  });
});

describe('workspace transcript edit route', () => {
  const transcriptWords: EditableTranscriptWord[] = [
    { id: 'word-1', text: 'Remove', startMs: 3_000, endMs: 4_000 },
    { id: 'word-2', text: 'this', startMs: 4_000, endMs: 5_000 },
  ];
  const proposal = proposeTranscriptSelectionEdit({
    words: transcriptWords,
    selection: { kind: 'time-range', startMs: 3_000, endMs: 5_000 },
  });

  function transcriptVisual(overrides: Partial<ReturnType<typeof createEditorVisualClip>> = {}) {
    return {
      ...createEditorVisualClip('imported-video-node', 'video', {
        trackIndex: 0,
        startMs: 0,
        sourceInMs: 0,
        sourceOutMs: 10_000,
        durationSeconds: 10,
        playbackRate: 1,
      }),
      id: 'visual-source',
      professional: { linkGroupId: 'linked-av' },
      ...overrides,
    };
  }

  function transcriptAudio(overrides: Partial<ReturnType<typeof createEditorAudioClip>> = {}) {
    return {
      ...createEditorAudioClip('imported-video-node', 0, { sourceInMs: 0, sourceOutMs: 10_000 }),
      id: 'audio-source',
      professional: { linkGroupId: 'linked-av', pan: 0 },
      ...overrides,
    };
  }

  const basePlan = {
    visualTrackCount: 4,
    audioTrackCount: 4,
    lockedVisualTrackIndexes: [] as number[],
    lockedAudioTrackIndexes: [] as number[],
    audioDurationMsByClipId: {} as Record<string, number>,
    words: transcriptWords,
    sourceProposal: proposal,
    sourceItemIdentityIds: ['source-library-item', 'imported-video-node'],
  };

  it('routes one selected linked occurrence through mapping into the exact committed timeline clips', () => {
    const plan = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual()],
      audioClips: [transcriptAudio()],
      selectedVisualClipIds: ['visual-source'],
      selectedAudioClipIds: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.occurrenceCount).toBe(2);
    // Selecting one member of the linked A/V group still edits the whole group atomically.
    expect(plan.value.patch.affectedClipIds).toEqual(['audio-source', 'visual-source']);
    expect(plan.value.visualClips.map((clip) => [clip.id, clip.startMs, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['visual-source', 0, 0, 3_000],
      ['visual:visual-source:transcript:0:right', 3_000, 5_000, 10_000],
    ]);
    expect(plan.value.audioClips.map((clip) => [clip.id, clip.offsetMs, clip.sourceInMs, clip.sourceOutMs])).toEqual([
      ['audio-source', 0, 0, 3_000],
      ['audio:audio-source:transcript:0:right', 3_000, 5_000, 10_000],
    ]);
    // The split fragments stay linked so later transcript edits keep A/V atomicity.
    expect(plan.value.visualClips[1]?.professional?.linkGroupId).toBe('linked-av::transcript:0:right');
    expect(plan.value.audioClips[1]?.professional?.linkGroupId).toBe('linked-av::transcript:0:right');
  });

  it('demands an explicit occurrence when the transcribed source appears more than once', () => {
    const ambiguous = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual(), transcriptVisual({ id: 'visual-repeat', startMs: 12_000 })],
      audioClips: [transcriptAudio()],
      selectedVisualClipIds: [],
      selectedAudioClipIds: [],
    });
    expect(ambiguous).toMatchObject({ ok: false, kind: 'ambiguous-occurrence', occurrenceCount: 3 });

    const resolved = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual(), transcriptVisual({ id: 'visual-repeat', startMs: 12_000, professional: undefined })],
      audioClips: [transcriptAudio()],
      selectedVisualClipIds: ['visual-repeat'],
      selectedAudioClipIds: [],
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.patch.affectedClipIds).toEqual(['visual-repeat']);
    expect(resolved.value.visualClips.filter((clip) => clip.id === 'visual-source')).toHaveLength(1);

    const missing = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual({ sourceNodeId: 'other-node' })],
      audioClips: [],
      selectedVisualClipIds: [],
      selectedAudioClipIds: [],
    });
    expect(missing).toMatchObject({ ok: false, kind: 'no-occurrence', occurrenceCount: 0 });
  });

  it('threads the real track locks into the apply gate', () => {
    const plan = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual()],
      audioClips: [transcriptAudio()],
      selectedVisualClipIds: ['visual-source'],
      selectedAudioClipIds: [],
      lockedAudioTrackIndexes: [0],
    });
    expect(plan).toMatchObject({ ok: false, kind: 'apply-rejected' });
    if (plan.ok) return;
    expect(plan.detail).toContain('locked');
  });

  it('summarizes real plan results for the accessible preview surface', () => {
    const plan = planWorkspaceTranscriptEdit({
      ...basePlan,
      visualClips: [transcriptVisual()],
      audioClips: [transcriptAudio()],
      selectedVisualClipIds: ['visual-source'],
      selectedAudioClipIds: [],
    });
    if (!plan.ok) throw new Error('expected a successful plan');
    expect(summarizeWorkspaceTranscriptPlan(plan, proposal)).toBe(
      'Transcript patch preview: 2 clips affected · 2 splits · removes 2.00 s',
    );
    expect(summarizeWorkspaceTranscriptPlan({ ok: false, kind: 'ambiguous-occurrence', occurrenceCount: 3, detail: 'Select the exact timeline clip occurrence.' }, proposal)).toContain('Transcript patch preview unavailable');
    expect(summarizeWorkspaceTranscriptPlan({ ok: false, kind: 'apply-rejected', occurrenceCount: 2, detail: 'Clip is on a locked audio track.' }, proposal)).toContain('Transcript patch preview rejected');
  });

  it('keeps transcript search failures as messages instead of event-handler exceptions', () => {
    expect(searchEditableTranscriptSafely(transcriptWords, 'remove this')).toEqual({
      ok: true,
      matches: [{ wordStartIndex: 0, wordEndIndex: 1, startMs: 3_000, endMs: 5_000, text: 'Remove this' }],
    });
    expect(searchEditableTranscriptSafely(transcriptWords, 'x'.repeat(201))).toMatchObject({
      ok: false,
      message: expect.stringContaining('200'),
    });
    const unordered = [{ ...transcriptWords[1]! }, transcriptWords[0]!];
    expect(searchEditableTranscriptSafely(unordered, 'remove')).toMatchObject({
      ok: false,
      message: expect.stringMatching(/ordered/i),
    });
    expect(searchEditableTranscriptSafely([], 'anything')).toEqual({ ok: true, matches: [] });
  });

  it('keeps delivered render-queue work out of an editor history restore', () => {
    // The snapshot is what an undo of an unrelated timeline edit would restore: it still believes
    // both outputs are pending, because it was captured before the queue ran them.
    const stalePatch = {
      editorProfessionalWorkflowState: {
        deliveryJobs: [{
          id: 'job-1',
          profileId: 'standard-delivery',
          compositionSignature: 'sig-a',
          status: 'queued',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          hostDurability: 'browser-session-only',
          outputs: [
            { id: 'qc', label: 'QC', fileName: 'qc.json', status: 'queued', missingCapabilities: [], truthfulnessNote: '' },
            { id: 'captions', label: 'Captions', fileName: 'captions.vtt', status: 'queued', missingCapabilities: [], truthfulnessNote: '' },
          ],
        }],
        captionTracks: [],
      },
    } as unknown as Parameters<typeof buildEditorHistoryRestorePatch>[0];

    const liveJobs = sanitizeEditorProfessionalWorkflowState({
      deliveryJobs: [{
        id: 'job-1',
        profileId: 'standard-delivery',
        compositionSignature: 'sig-a',
        status: 'partial',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_500,
        hostDurability: 'browser-session-only',
        outputs: [
          { id: 'qc', label: 'QC', fileName: 'qc.json', status: 'succeeded', attempts: 1, missingCapabilities: [], truthfulnessNote: '', result: { byteSize: 2_048 } },
          { id: 'captions', label: 'Captions', fileName: 'captions.vtt', status: 'interrupted', attempts: 1, missingCapabilities: [], truthfulnessNote: '' },
        ],
      }],
    }).deliveryJobs;

    const restored = buildEditorHistoryRestorePatch(stalePatch, liveJobs);
    const jobs = restored.editorProfessionalWorkflowState?.deliveryJobs ?? [];

    expect(jobs[0]?.status).toBe('partial');
    expect(jobs[0]?.outputs?.map((output) => output.status)).toEqual(['succeeded', 'interrupted']);
    expect(jobs[0]?.outputs?.[0].result).toEqual({ byteSize: 2_048 });
    // Nothing the queue delivered was rewound into work the runner would repeat.
    expect(selectNextVideoRenderQueueWork(jobs, { currentCompositionSignature: 'sig-a' })).toBeUndefined();
  });
  it('lets the render queue plan the deliverables it can actually produce', () => {
    // The whole plan path end to end: the default profile against a sequence set to its default
    // export preset. Both runnable outputs must be queued, not blocked.
    const job = createDefaultVideoWorkflowDeliveryJob({
      jobId: 'delivery-1',
      createdAt: '2026-08-26T12:00:00.000Z',
      projectName: 'Sloom Studio',
      composition: { compositionId: 'composition-1', compositionName: 'Sequence', compositionSignature: 'sig-a' },
      host: buildVideoDeliveryQueueHost({ nativeAvailable: false, activeExportPresetId: 'review-h264-1080p' }),
      profile: createDefaultEditorProfessionalWorkflowState().deliveryProfiles[0],
    });

    expect(job.outputs.map((output) => [output.id, output.status])).toEqual([
      ['review', 'queued'],
      ['qc', 'queued'],
    ]);

    // Point the sequence at a different format and the video deliverable must block, naming the
    // preset it needs, rather than delivering an H.264 file under a ProRes plan.
    const mismatched = createDefaultVideoWorkflowDeliveryJob({
      jobId: 'delivery-2',
      createdAt: '2026-08-26T12:00:00.000Z',
      projectName: 'Sloom Studio',
      composition: { compositionId: 'composition-1', compositionName: 'Sequence', compositionSignature: 'sig-a' },
      host: buildVideoDeliveryQueueHost({ nativeAvailable: true, activeExportPresetId: 'prores-mov' }),
      profile: createDefaultEditorProfessionalWorkflowState().deliveryProfiles[0],
    });

    expect(mismatched.outputs.find((output) => output.id === 'review')).toMatchObject({
      status: 'blocked',
      missingCapabilities: ['render:composition-preset:review-h264-1080p'],
    });
    expect(mismatched.outputs.find((output) => output.id === 'qc')?.status).toBe('queued');
  });
});
