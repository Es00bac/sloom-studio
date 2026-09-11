import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, CSSProperties, ReactNode, RefObject } from 'react';
import {
  Archive,
  Captions,
  BookOpen,
  Film,
  Image as ImageIcon,
  MousePointer2,
  Music2,
  Play,
  Plus,
  Scissors,
  Search,
  Square,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Diamond,
  Star,
  Trash2,
  Type,
} from 'lucide-react';
import {
  addTimelineMarker,
  applyClipSetTransitionToTimelineMarkers,
  applyClipSplitToTimelineMarkers,
  applyClipTrimToTimelineMarkers,
  findAdjacentTimelineMarker,
  normalizeTimelineMarkers,
  planClipTimelineMarkerPaste,
  reconcileClipTimelineMarkers,
  removeClipsFromTimelineMarkers,
  removeTimelineMarker,
  type TimelineMarker,
  type TimelineMarkerClipHost,
  type TimelineMarkerClipTransitionDescriptor,
} from '../../../lib/editorTimelineMarkers';
import { resolveCrossfadePercents } from '../../../lib/editorAudioFades';
import {
  clampAudioFadeSeconds,
  formatAudioPercentWithDecibels,
  isAudioTrackAudible,
  normalizeAudioTrackIndexes,
  resolveAlignedDialogueTrack,
  toggleAudioTrackIndex,
} from '../../../lib/editorAudioMix';
import {
  COMIC_CARD_BODY_HEIGHT,
  COMIC_CARD_BODY_WIDTH,
  COMIC_CARD_HEIGHT,
  COMIC_CARD_WIDTH,
  drawComicStageObject,
  renderComicCard,
} from '../../../lib/mediaComposition';
import {
  COMIC_BODY_RADIUS_PERCENT,
  COMIC_TAIL_DEFAULT_TIP_X_PERCENT,
  COMIC_TAIL_DEFAULT_TIP_Y_PERCENT,
} from '../../../lib/videoComicTail';
import { computeArcTextGlyphs, createVideoTextCanvasMeasurer } from '../../../lib/videoTextFlow';
import { formatFontFamily } from '../../../lib/formatFontFamily';
import { decodeGifFrames, selectGifFrameIndexAtTime, type GifDecodeResult } from '../../../lib/gifFrames';
import { isTrackLocked, normalizeLockedTracks, toggleLockedTrack } from '../../../lib/editorTrackLocks';
import { isTrackCollapsed, normalizeCollapsedTracks, toggleCollapsedTrack } from '../../../lib/editorTrackCollapse';
import {
  resolveClipTrackIndexPatch,
  resolveTimelineDropTrackIndex,
  type TimelineLaneRect,
} from '../../../lib/editorTimelineTrackDrag';
import { advanceShuttleCursor, stepShuttleRate, toggleShuttlePlay } from './timelineTransport';
import { normalizeSourceMarks, overwriteTrackRange, shiftTrackClipsForInsert } from './threePointEdit';
import { findNearestEditPoint, rippleTrimClipToTarget, rollEditPointToTarget } from './trimEdit';
import { useFlowStore } from '../../../store/flowStore';
import { useFlowWorkspaceStore } from '../../../store/flowWorkspaceStore';
import { useConfirmationStore } from '../../../store/confirmationStore';
import { showAlertDialog } from '../../../store/alertDialogStore';
import { useEditorStore } from '../../../store/editorStore';
import { useMobileInterfaceStore } from '../../../store/mobileInterfaceStore';
import { useMobilePhoneInterfaceDescriptor } from '../../../lib/mobilePhoneInterface';
import { buildDecodedFrameScopesPanelKey } from '../../../lib/videoDecodedFrameScopes';
import { ProfessionalVideoToolsPanel } from './ProfessionalVideoToolsPanel';
import { DecodedFrameScopesPanel } from './DecodedFrameScopesPanel';
import { CommandPaletteDialog } from './CommandPaletteDialog';
import { TrimSessionOverlay } from './TrimSessionOverlay';
import { TimelineMinimap, type TimelineMinimapNavigation } from './TimelineMinimap';
import { ProjectNavigatorPanel, type ProjectNavigatorCommand } from './ProjectNavigatorPanel';
import { SearchMarkersPanel, type SearchMarkersCommand } from './SearchMarkersPanel';
import {
  ParameterKeyframeEditor,
  TranscriptEditingPanel,
  VoiceoverSfxDialog,
  type VoiceoverSfxDialogDraft,
} from './ProfessionalFinishingAuthoringControls';
import type {
  ProfessionalBatchCommand,
  ProfessionalCaptionCommand,
  ProfessionalDeliveryCommand,
  ProfessionalHistoryCommand,
  ProfessionalMediaLoggingCommand,
  ProfessionalQcCommand,
  ProfessionalReviewCommand,
  ProfessionalSourceRecordCommand,
  ProfessionalTrimCommand,
  ProfessionalTrimSessionSummary,
  ProfessionalWorkflowHistoryEntry,
} from './ProfessionalWorkflowToolsPanel';
import type { SourceBinItem } from '../../../lib/sourceBin';
import { buildDownloadFilename, downloadAsset } from '../../../lib/downloadAsset';
import {
  normalizeAutomationPoints,
} from '../../../lib/clipAutomation';
import {
  buildAudioTimelineBlocks,
  buildVisualTimelineBlocks,
  getTimelineDurationSeconds,
  resolveVisualClipDuration,
} from '../../../lib/manualEditorTimeline';
import { resolveVisualClipSourceRangeMs } from '../../../lib/editorTimelineSourceRange';
import {
  mergeTimelinePreviewResults,
  pruneTimelinePreviewMap,
  takePendingTimelinePreviewRequests,
} from '../../../lib/editorTimelinePreview';
import {
  pruneTimelineWaveformMap,
  takePendingTimelineWaveformRequests,
} from '../../../lib/editorTimelineWaveform';
import {
  addTimelineSnapPoint,
  normalizeTimelineSnapPoints,
  resolveTimelineSnapSeconds,
} from '../../../lib/editorTimelineSnap';
import {
  createEditorAudioClip,
  createEditorVisualClip,
  getEditorAudioTrackVolumes,
  getEditorAudioClips,
  getEditorVisualClips,
  getEditorVisualTrackKinds,
  selectOverlayTrackIndexForNewClip,
  toggleEditorVisualTrackKind,
} from '../../../lib/manualEditorState';
import type {
  AppNode,
  AspectRatio,
  AudioProvider,
  EditorAudioClip,
  EditorAsset,
  EditorAssetKind,
  EditorClipChromaKeySettings,
  EditorClipFilter,
  EditorClipFilterKind,
  EditorStageBlendMode,
  EditorStageObject,
  EditorTextTypography,
  EditorVisualClip,
  EditorVisualTrackKind,
  NodeData,
  RenderBackendPreference,
  TextClipEffect,
  TimelineAutomationPoint,
  VideoExportPresetPlanData,
  VideoExportPresetPlanId,
  VideoResolution,
} from '../../../types/flow';
import { materializeSourceBinItemDataUrl, useSourceBinStore } from '../../../store/sourceBinStore';
import { recordActivityTrailWorkspaceEvent } from '../../../store/activityTrailStore';
import { usePaperStore } from '../../../store/paperStore';
import type { ActivityTrailSource } from '../../../lib/activityTrail';
import { useShallow } from 'zustand/react/shallow';
import {
  captureFrameFromVideoElement,
  extractVideoFrameAtTime,
} from '../../../lib/videoFrameExtraction';
import { getAspectRatioValue, getVideoCanvasDimensions } from '../../../lib/videoCanvas';
import { exportSequenceToFcpXml } from '../../../lib/fcpXmlInterchange';
import { buildFcpXmlSequenceFromEditor, resolveFcpMediaPathFromAssetUrl } from '../../../lib/fcpXmlSequenceMapping';
import { DEFAULT_EXECUTION_CONFIG } from '../../../lib/providerCatalog';
import { EXPORT_BASENAME } from '../../../lib/brand';
import { extractWaveformPeaks } from '../../../lib/audioWaveform';
import {
  resolveEditorAudioSourceRangeMs,
  splitEditorAudioClipAtTimelineSeconds,
  trimEditorAudioClipEdge,
} from '../../../lib/editorAudioSourceRange';
import { measureSpeechLevelMatchFromUrls } from '../../../lib/audioSpeechLevelMatch';
import {
  DEFAULT_EDITOR_AUDIO_PROCESSING,
  RECOMMENDED_DIALOGUE_AUDIO_PROCESSING,
  normalizeEditorAudioProcessingSettings,
} from '../../../lib/editorAudioProcessing';
import {
  DEFAULT_EDITOR_AUDIO_DUCKING,
  normalizeEditorAudioDuckingSettings,
} from '../../../lib/editorAudioDucking';
import {
  startDialogueAudioAudition,
  type DialogueAuditionSession,
  type DialogueAuditionSide,
  type DialogueAuditionSummary,
} from '../../../lib/dialogueAudioAudition';
import {
  createEditorHistorySnapshot,
  createEditorHistoryState,
  pushEditorHistoryEntry,
  redoEditorHistory,
  undoEditorHistory,
} from '../../../lib/editorHistory';
import {
  buildTimelineOpacityPoint,
  isPrimaryTimelinePointerButton,
  resizeTimelineTrackHeight,
} from '../../../lib/editorTimelineInteraction';
import {
  buildEditorSourceItemLookup,
  mapLibraryItemToEditorSourceItem,
} from '../../../lib/editorSourceItems';
import {
  collectUsedVideoMediaItemIds,
  consolidateVideoMediaItems,
  isNativeVideoMediaManagementAvailable,
  relinkVideoMediaItem,
} from '../../../lib/videoMediaManagementNative';
import {
  buildSourceBinKindCounts,
  buildSourceBinOriginCounts,
  filterSourceBinItemsForDisplay,
  getSourceBinPreviewKind,
  resolveSourceBinItemOrigin,
  sortSourceBinItemsForDisplay,
  type SourceBinKindFilter,
  type SourceBinOriginFilter,
} from '../../../lib/sourceBinLayout';
import {
  buildTimelineRulerTicks,
  clampTimelineZoomPercent,
  formatEditorTimecode,
  formatTimelineRulerLabel,
  getTimelineMaxZoomPercent,
  isLongFormSequence,
  resolveTimelineViewportRange,
  timelineRangeIntersects,
  type TimelineViewportRange,
} from '../../../lib/videoLongFormTimeline';
import {
  buildProgramAudioPlaybackPlan,
  shouldCorrectProgramMediaTime,
  type ProgramAudioPlaybackItem,
} from '../../../lib/videoPlaybackTransport';
import {
  buildFlowNodePatchForSourceBinItem,
  getFlowNodeTypeForSourceBinItem,
} from '../../../lib/sourceBinFlowBridge';
import {
  buildTimelineClipFrameExportLabel,
  getTimelineClipFrameExportTimeSeconds,
} from '../../../lib/timelineClipFrameExport';
import type { TimelineClipFrameEdge } from '../../../lib/timelineClipFrameExport';
import { cropImageDataUrl } from '../../../lib/localImageEditing';
import { executeNodeRequest } from '../../../lib/flowExecution';
import { executeAndRecordProjectUsage } from '../../../lib/projectUsageRecording';
import { useSettingsStore } from '../../../store/settingsStore';
import { useProjectUsageStore } from '../../../store/projectUsageStore';
import { AdvancedColorPicker } from '../../../components/Common/AdvancedColorPicker';
import { BundledFontBrowser } from '../../../components/Common/BundledFontBrowser';
import {
  bundledFontFaceRuntimeFamilyName,
  bundledFontFaceStyleDescriptor,
  bundledFontFaceVariationSettingsCss,
  createBundledFontFaceReference,
} from '../../../lib/bundledFontLibrary';
import { collectVideoBundledFontDependencies } from '../../../lib/managedBundledFonts';
import type { ManagedBundledFontFaceIssue, ManagedBundledFontFaceReference } from '../../../types/managedFont';
import {
  useManagedFontRegistrationGate,
  type ManagedFontRegistrationGateState,
} from './useManagedFontRegistrationGate';
import {
  getEditorStageObjects,
  getStageObjectBlendModes,
} from '../../../lib/editorStageObjects';
import {
  copyVisualClipProperties,
  formatVisualClipPropertyList,
  getDefaultVisualClipPropertySelection,
  pasteVisualClipProperties,
  VISUAL_CLIP_PROPERTY_OPTIONS,
} from '../../../lib/editorClipPropertyClipboard';
import type {
  VisualClipCopiedProperty,
  VisualClipPropertyClipboard,
} from '../../../lib/editorClipPropertyClipboard';
import {
  createEditorAsset,
  getEditorAssets,
  getProjectEditorAssets,
  migrateStageObjectsToEditorAssets,
  buildVisualClipFromEditorAsset,
} from '../../../lib/editorAssets';
import {
  buildPaperStoryboardPageDescriptors,
  getPaperStoryboardExistingItemIds,
  publishPaperStoryboardPageSourcePayloads,
} from '../../../lib/paperVideoAssets';
import { createPaperPlacedDocumentRasterizationGuard } from '../../../lib/paperPlacedDocumentRasterization';
import {
  buildPaperDocumentExactManagedFontOutput,
  materializePaperDocumentAssetUrls,
} from '../../paper/assets/PaperAssetRuntime';
import { getSignalLoomNativeBridge, type NativeMenuCommand } from '../../../lib/nativeApp';
import { useNativeMenuCommand } from '../../../shared/native/useNativeMenuCommand';
import { fillTimelineGap, findTimelineGaps } from '../../../lib/editorTimelineGaps';
import type { TimelineGap } from '../../../lib/editorTimelineGaps';
import {
  getSelectedVisualClipCutTarget,
  splitVisualClipNonDestructively,
  trimVisualClipEdge,
} from '../../../lib/editorTimelineTrim';
import type { TimelineClipEdge } from '../../../lib/editorTimelineTrim';
import {
  buildClipEffectPresetPatch,
  buildClipEffectDescriptorForClip,
  getClipBlendModes,
  getClipEffectPresets,
  getClipFilterKinds,
  normalizeClipChromaKey,
  normalizeClipCrop,
  normalizeClipStroke,
  type ClipEffectPresetId,
} from '../../../lib/editorClipEffects';
import { compileVideoRuntimeIr } from '../../../lib/videoRuntimeNestedExecution';
import {
  buildStageObjectLayoutDescriptor,
  TEXT_LINE_HEIGHT,
} from '../../../lib/editorVisualLayout';
import { buildVideoMaskCssClipPath } from '../../../lib/videoVfxPipeline';
import { SharedContextMenu } from '../../../components/Common/SharedContextMenu';
import { MediaPreviewModal } from '../../../components/Nodes/MediaPreviewModal';
import type { SharedContextMenuItem } from '../../../lib/sharedContextMenu';
import {
  getAcceptStringForKinds,
  getBrowserPreviewSupportLabel,
  inferSourceKindFromFile,
  isGifAssetReference,
} from '../../../lib/mediaFormatRegistry';
import {
  applyVisualClipPatchAtProgress,
  audioKeyframesToVolumeAutomation,
  ensureVisualClipHasKeyframes,
  getAdjacentKeyframePercent,
  getAudioKeyframePercents,
  getAudioKeyframeStateAtProgress,
  getVisualKeyframePercents,
  getVisualKeyframeStateAtProgress,
  normalizeAudioKeyframes,
  normalizeVisualKeyframes,
  removeAudioKeyframe,
  removeVisualKeyframe,
  updateAudioKeyframe,
  updateVisualKeyframe,
  upsertAudioKeyframe,
  upsertVisualKeyframe,
  visualKeyframesToOpacityAutomation,
} from '../../../lib/editorKeyframes';
import { applyChromaKeyToImageData } from '../../../lib/chromaKeyPreview';
import {
  analyzeVideoExportReadiness,
  type VideoExportReadinessSummary,
  type VideoExportReadinessTone,
} from '../../../lib/videoExportReadiness';
import {
  summarizeVideoRenderBackend,
  type VideoRenderBackendSummary,
  type VideoRenderBackendTone,
} from '../../../lib/videoRenderBackendStatus';
import { mergeVideoDecodedSignalQcReport, pruneVideoDeliveryJobsToBound, sanitizeEditorProfessionalWorkflowState } from '../../../lib/videoProductionState';
import { projectExecutableMulticamClips } from '../../../lib/videoMulticamExecution';
import { sanitizeEditorProfessionalVideoState } from '../../../lib/videoProfessionalState';
import type { EditorProfessionalWorkflowState, VideoDeliveryJobRecord, VideoReviewAnnotation } from '../../../types/videoProduction';
import {
  VIDEO_PROFESSIONAL_STATE_VERSION,
  createDefaultEditorProfessionalVideoState,
  type SourceBinProfessionalMediaState,
} from '../../../types/videoProfessional';
import {
  createVideoMediaLogRecord,
  filterVideoMediaLogsBySmartBin,
  parseVideoSmartBinQuery,
  suggestVideoMediaDuplicates,
  type VideoMediaLoggingState,
} from '../../../lib/videoMediaLogging';
import {
  createVideoReviewWorkflow,
  exportVideoReviewPackageCsv,
  exportVideoReviewPackageJson,
  mergeVideoReviewWorkflows,
  parseVideoReviewPackageJson,
  type VideoReviewWorkflow,
} from '../../../lib/videoReviewWorkflow';
import {
  createVideoCaptionDocument,
  analyzeVideoCaptionQc,
  findReplaceVideoCaptions,
  parseVideoCaptionDocument,
  projectVideoCaptionsToTextClips,
  serializeVideoCaptionDocument,
  splitVideoCaptionCue,
  type VideoCaptionDocument,
} from '../../../lib/videoCaptionAuthoring';
import type { VideoStructuralQcReport } from '../../../lib/videoStructuralQc';
import type { VideoDeliveryPlanningEnvironment } from '../../../lib/videoDeliveryJobs';
import {
  cancelVideoRenderQueueJob,
  completeVideoRenderQueueOutput,
  failVideoRenderQueueOutput,
  queueVideoRenderJob,
  reconcileVideoRenderQueue,
  retryVideoRenderQueueJob,
  selectNextVideoRenderQueueWork,
  startVideoRenderQueueOutput,
  type VideoRenderQueueOutput,
  type VideoRenderQueueOutputResult,
  type VideoRenderQueueRecord,
  type VideoRenderQueueTransition,
} from '../../../lib/videoRenderQueue';
import { runVideoDecodedSignalQc } from '../../../lib/videoDecodedSignalRuntime';
import {
  applyVideoWorkflowBatchProposal,
  applyVideoWorkflowSourceRecordProposal,
  buildVideoWorkflowStructuralQc,
  videoCompositionPresetCapability,
  createDefaultVideoWorkflowDeliveryJob,
  normalizeVideoWorkflowBatch,
  normalizeVideoWorkflowSourceRecord,
  type VideoWorkflowTrackState,
  type VideoWorkflowSourceRecordClip,
  type VideoWorkflowSourceRecordProjection,
} from '../../../lib/videoWorkflowIntegration';
import {
  proposeVideoBatchDelete,
  proposeVideoBatchDuplicate,
  proposeVideoBatchEnabled,
  proposeVideoBatchMove,
  proposeVideoBatchTrackShift,
} from '../../../lib/videoBatchEditing';
import {
  findSourceRecordEdit,
  matchSourceRecordFrame,
  proposeSourceRecordExtract,
  proposeSourceRecordLift,
  type SourceRecordProposal,
} from '../../../lib/videoSourceRecordEditing';
import type { AdvancedTrimClip, AdvancedTrimSessionOptions } from '../../../lib/videoAdvancedTrim';
import {
  beginVideoTrimToolSession,
  cancelVideoTrimToolSession,
  commitVideoTrimToolSession,
  updateVideoTrimToolSession,
  updateVideoTrimToolSessionNumeric,
  type VideoTrimToolSession,
} from '../../../lib/videoTimelineToolSessions';

import {
  VIDEO_EXPORT_PRESET_OPTIONS,
  VIDEO_PREMIERE_PARITY_ROWS,
  buildVideoParityDiagnostics,
  buildVideoSequenceSummary,
  getHighPriorityVideoParityRows,
  getVideoExportPresetOption,
  getVideoMonitorParityNotices,
} from '../../../lib/videoPremiereParity';
import { resultValueAsMediaUrl } from '../../../lib/flowResultValues';
import {
  captionCuesToAlignmentText,
  captionCuesToTextClips,
  getCaptionFormatFromFileName,
  parseCaptionText,
  serializeSrtCaptions,
  serializeWebVttCaptions,
  textClipsToCaptionCues,
} from '../../../lib/videoCaptions';
import { TRANSCRIPTION_OUTPUT_HANDLES } from '../../../lib/timedTranscript';
import { AUDIO_PROCESS_OUTPUT_HANDLES } from '../../../lib/audioProcess';
import { buildVideoTimelineNavigationModel, type VideoTimelineNavigationModel } from '../../../lib/videoTimelineNavigation';
import { describeVideoTimelineCompositionSyncReadiness } from '../../../lib/videoTimelineNativeSync';
import {
  buildVideoTimelineSearchDocumentsWithReport,
  createVideoTimelineSearchIndex,
  updateVideoTimelineSearchShard,
} from '../../../lib/videoTimelineSearchIndex';
import {
  exportVideoRichMarkersCsv,
  exportVideoRichMarkersJson,
  importVideoRichMarkersCsv,
  importVideoRichMarkersJson,
  markerTimeMs,
  readVideoRichMarkerImportFile,
  removeVideoRichMarker,
  reviewVideoRichMarkerImport,
  timelineMarkerToVideoRichMarker,
  upsertVideoRichMarker,
  videoRichMarkerToTimelineMarker,
  type VideoRichMarker,
  type VideoRichMarkerImportReview,
} from '../../../lib/videoRichMarkers';
import {
  normalizeVideoSequenceNavigatorModel,
  planVideoSequenceDeletion,
  type VideoSequenceNavigatorModel,
} from '../../../lib/videoSequenceNavigator';
import {
  proposeTranscriptSelectionEdit,
  searchTranscript,
  type EditableTranscriptWord,
  type TranscriptEditProposal,
  type TranscriptSearchMatch,
} from '../../../lib/videoTranscriptEditing';
import { planAndApplyVideoSourceTranscriptEdit, type VideoTranscriptSourceAppliedTimeline } from '../../../lib/videoTranscriptApply';
import { evaluateProfessionalVideoParameter, type VideoParamKeyframeTrack } from '../../../lib/videoParamKeyframes';
import type { VideoVoiceoverParagraph } from '../../../lib/videoVoiceoverAuthoring';
import { VIDEO_COMMAND_NATIVE_ROUTES } from '../../../lib/videoCommandRegistry';
import {
  buildVideoClipClipboard,
  createVideoClipboardAudioTimelineClip,
  createVideoClipboardVisualTimelineClip,
  planVideoClipPaste,
  type VideoClipClipboardDocument,
  type VideoClipboardTimelineClip,
  type VideoClipboardTrack,
} from '../../../lib/videoClipClipboard';
import {
  groupVideoClipsForSync,
  linkVideoClips,
  unlinkVideoClips,
  ungroupVideoSyncGroups,
  type VideoSyncManagedClip,
} from '../../../lib/videoSyncManagement';
import { DockableDialog, DockablePanelHost, type DockablePanelDefinition } from '../../../components/DockablePanel';
import { VideoWorkspaceMobileShell } from './VideoWorkspaceMobileShell';
import { useDockablePanelStore } from '../../../store/dockablePanelStore';
import { panelKey } from '../../../lib/dockablePanel';
import { getDockablePanelToggleMode, resolveDockablePanelMode } from '../../../lib/dockablePanelVisibility';
import {
  VIDEO_PANEL_IDS,
  VIDEO_WORKSPACE_ID,
  buildVideoDockablePanelDefaults,
} from '../../../lib/videoDockablePanels';
import {
  buildVideoRenderClipSignature,
  buildVideoRenderDirtyPlan,
} from '../../../lib/videoRenderSegments';
import {
  buildVideoCompositionRenderCacheSignature,
  buildVideoRenderSegmentArtifactsForCompletedRender,
  buildVideoRenderAssemblyManifest,
  buildVideoRenderSegmentReusePlan,
  formatVideoRenderAssemblyManifestDetails,
  formatVideoRenderAssemblyResultDetail,
  normalizeVideoRenderAssemblyResult,
  normalizeVideoRenderCacheSegmentArtifacts,
  normalizeVideoRenderCacheSegmentSignatures,
  resolveVideoRenderCacheAction,
} from '../../../lib/videoRenderCache';
import {
  areMediaInfosEqual,
  blobToDataUrl,
  buildAudioWaveformSignature,
  buildClipPreviewSignature,
  buildTimelineClipEdgePreview,
  canUseSourceItemAsAudio,
  canUseSourceItemAsVisual,
  createDerivedVisualClipId,
  getAudioClipProgressPercent,
  getAudioTrackEndMs,
  getDefaultAudioTrackVolumes,
  getDraggedSourceItemId,
  getProgramStageClips,
  getSourceItemDurationSeconds,
  getSourceItemIcon,
  getSourceMediaInfo,
  getStageClipProgress,
  getStageClipLayout,
  getVisualClipProgressPercent,
  getVisualTrackEndMs,
  isEditableKeyboardTarget,
  mapWithConcurrency,
  normalizeAspectRatio,
  normalizeVideoFrameRate,
  normalizeVideoResolution,
  resolveSourceAspectRatio,
  roundNudgeCoordinate,
  type ProgramStageClip,
  type SourceMediaInfo,
  type TimelineBlockKind,
  type TimelineClipEdgePreview,
} from '../../../components/Editor/ManualEditorWorkspaceUtils';

const EDITOR_MEDIA_IMPORT_ACCEPT = getAcceptStringForKinds(['video', 'audio']);
const EDITOR_VIDEO_IMPORT_ACCEPT = getAcceptStringForKinds(['video']);
const EDITOR_AUDIO_IMPORT_ACCEPT = getAcceptStringForKinds(['audio']);
const EDITOR_IMAGE_IMPORT_ACCEPT = getAcceptStringForKinds(['image']);
const EDITOR_CAPTION_IMPORT_ACCEPT = getAcceptStringForKinds(['subtitle']);
const VIDEO_PANEL_TOGGLE_COMMANDS: Record<string, string> = {
  'editor:toggle-source-bin-panel': VIDEO_PANEL_IDS.projectSourceBin,
  'editor:toggle-source-monitor-panel': VIDEO_PANEL_IDS.sourceMonitor,
  'editor:toggle-program-monitor-panel': VIDEO_PANEL_IDS.programMonitor,
  'editor:toggle-inspector-panel': VIDEO_PANEL_IDS.inspector,
  'editor:toggle-timeline-panel': VIDEO_PANEL_IDS.timeline,
  'editor:toggle-premiere-parity-panel': VIDEO_PANEL_IDS.premiereParity,
  'editor:toggle-sequence-settings-panel': VIDEO_PANEL_IDS.sequenceSettings,
  'editor:toggle-export-preset-panel': VIDEO_PANEL_IDS.exportPreset,
  'editor:toggle-diagnostics-panel': VIDEO_PANEL_IDS.diagnostics,
};

const VIDEO_NATIVE_MENU_COMMANDS = [
  'edit:undo',
  'edit:redo',
  'edit:delete',
  'edit:select-all',
  'edit:deselect',
  'edit:copy',
  'edit:cut',
  'edit:paste',
  'timeline:select',
  'timeline:cut',
  'timeline:marquee',
  'timeline:ripple',
  'timeline:roll',
  'timeline:slip',
  'timeline:slide',
  'timeline:rate-stretch',
  'timeline:hand',
  'timeline:snap',
  'timeline:play-pause',
  'timeline:shuttle-reverse',
  'timeline:shuttle-stop',
  'timeline:shuttle-forward',
  'timeline:mark-in',
  'timeline:mark-out',
  'timeline:clear-in',
  'timeline:clear-out',
  'timeline:insert',
  'timeline:overwrite',
  'timeline:lift',
  'timeline:extract',
  'timeline:add-edit',
  'timeline:previous-edit',
  'timeline:next-edit',
  'timeline:track-select-forward',
  'timeline:track-select-backward',
  'timeline:zoom-selection',
  'timeline:zoom-in-out',
  'timeline:zoom-playhead',
  'timeline:previous-zoom',
  'timeline:trim-nudge-back',
  'timeline:trim-nudge-forward',
  'timeline:trim-commit',
  'timeline:trim-cancel',
  'timeline:add-marker',
  'timeline:previous-marker',
  'timeline:next-marker',
  'timeline:link',
  'timeline:unlink',
  'timeline:group',
  'timeline:ungroup',
  'timeline:add-keyframe',
  'timeline:previous-keyframe',
  'timeline:next-keyframe',
  'editor:toggle-source-bin-panel',
  'editor:toggle-source-monitor-panel',
  'editor:toggle-program-monitor-panel',
  'editor:toggle-inspector-panel',
  'editor:toggle-timeline-panel',
  'editor:toggle-premiere-parity-panel',
  'editor:toggle-sequence-settings-panel',
  'editor:toggle-export-preset-panel',
  'editor:toggle-diagnostics-panel',
  'editor:reset-panels',
  'help:keyboard-shortcuts',
] satisfies readonly NativeMenuCommand[];
const panelClassName = 'relative isolate rounded-xl border border-gray-700/60 bg-[#131821] shadow-2xl';
const activeTabClassName = 'rounded-md bg-blue-500/20 px-2 py-1.5 text-[11px] font-semibold text-blue-100';
const inactiveTabClassName = 'rounded-md px-2 py-1.5 text-[11px] font-semibold text-gray-400 transition-colors hover:text-white';
const smallEditorButtonClassName = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white';
const miniTrackButtonClassName = 'rounded-md border border-gray-700/60 bg-[#0f131b] px-2 py-1 text-[10px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white';
const sourceBinFilterButtonClassName = 'rounded-full border px-2 py-1 text-[10px] font-semibold transition-colors';
// Shared SECTION-LABEL styling for the Program Tools clusters (UX review F09) so every
// cluster heading reads as one consistent small-uppercase label.
const PROGRAM_TOOLS_SECTION_LABEL_CLASS = 'text-[10px] font-bold uppercase tracking-wider text-gray-400';
type SourceBinMediaPoolKind = 'image' | 'video' | 'audio' | 'subtitle';
const SOURCE_BIN_KIND_FILTER_OPTIONS: Array<{ id: SourceBinKindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'visual', label: 'Visual' },
  { id: 'video', label: 'Video' },
  { id: 'image', label: 'Image' },
  { id: 'audio', label: 'Audio' },
  { id: 'text', label: 'Text' },
  { id: 'subtitle', label: 'Captions' },
];
export const VIDEO_TIMELINE_MARKER_HELP_HOTKEYS = [
  ['Ctrl/Cmd + M', 'Drop a labeled marker at the playhead'],
  ['Shift + M', 'Jump to the previous timeline marker'],
  ['Alt/Option + M', 'Jump to the next timeline marker'],
] as const;

export async function requestVideoMarkerImportApproval(
  review: VideoRichMarkerImportReview,
  requestConfirmation: (message: string, title: string) => Promise<boolean>,
): Promise<boolean> {
  return review.requiresConfirmation
    ? requestConfirmation(review.message, 'Review Marker Import')
    : true;
}

export function isTimelineMarkerRemovalKey(key: string): boolean {
  return key === 'Delete' || key === 'Backspace';
}

/**
 * Route patch shared by every clip-removal lifecycle (lane Remove From Lane / Remove From Cut,
 * keyboard delete, inspector removal, and cut): one atomic composition patch that removes the
 * clips and the markers they own.
 */
export function buildTimelineClipRemovalPatch(
  state: {
    visualClips: readonly EditorVisualClip[];
    audioClips: readonly EditorAudioClip[];
    timelineMarkers: readonly TimelineMarker[];
  },
  clipIds: Iterable<string>,
): {
  editorVisualClips: EditorVisualClip[];
  editorAudioClips: EditorAudioClip[];
  editorTimelineMarkers: TimelineMarker[];
} {
  const removed = new Set(clipIds);
  return {
    editorVisualClips: state.visualClips.filter((clip) => !removed.has(clip.id)),
    editorAudioClips: state.audioClips.filter((clip) => !removed.has(clip.id)),
    editorTimelineMarkers: removeClipsFromTimelineMarkers(state.timelineMarkers, removed),
  };
}

/** Route capture for copy/cut: the selection's clip-owned markers with offsets resolved. */
export function captureTimelineClipMarkerClipboard(
  timelineMarkers: readonly TimelineMarker[],
  visualClips: readonly EditorVisualClip[],
  audioClips: readonly EditorAudioClip[],
  selectedClipIds: Iterable<string>,
): TimelineMarker[] {
  const selectedIdSet = new Set(selectedClipIds);
  const hosts: TimelineMarkerClipHost[] = [
    ...visualClips.filter((clip) => selectedIdSet.has(clip.id)).map((clip) => ({ id: clip.id, startMs: clip.startMs })),
    ...audioClips.filter((clip) => selectedIdSet.has(clip.id)).map((clip) => ({ id: clip.id, startMs: clip.offsetMs })),
  ];
  return reconcileClipTimelineMarkers(timelineMarkers, hosts)
    .filter((marker) => marker.clipId && selectedIdSet.has(marker.clipId));
}

/**
 * Route mapping from editor clips to transition descriptors for advanced trim commits, lift and
 * extract, transcript-applied edits, and batch operations. `timingByClipId` supplies each clip's
 * resolved timeline duration and effective source in-point.
 */
export function buildEditorClipMarkerTransitionDescriptors(
  visual: readonly EditorVisualClip[],
  audio: readonly EditorAudioClip[],
  timingByClipId: ReadonlyMap<string, { durationMs: number; sourceInMs: number }>,
): TimelineMarkerClipTransitionDescriptor[] {
  return [
    ...visual.map((clip) => {
      const timing = timingByClipId.get(clip.id);
      return {
        id: clip.id,
        kind: 'visual' as const,
        trackIndex: clip.trackIndex,
        sourceNodeId: clip.sourceNodeId,
        startMs: clip.startMs,
        durationMs: timing?.durationMs ?? Math.round((clip.durationSeconds ?? 4) * 1_000),
        sourceInMs: timing?.sourceInMs
          ?? Math.max(0, clip.sourceOutMs === undefined ? (clip.trimStartMs ?? 0) : (clip.sourceInMs ?? clip.trimStartMs ?? 0)),
        rate: Math.max(0.25, clip.playbackRate || 1),
      };
    }),
    ...audio.map((clip) => {
      const timing = timingByClipId.get(clip.id);
      return {
        id: clip.id,
        kind: 'audio' as const,
        trackIndex: clip.trackIndex,
        sourceNodeId: clip.sourceNodeId,
        startMs: clip.offsetMs,
        durationMs: timing?.durationMs ?? Math.max(0, (clip.sourceOutMs ?? 0) - (clip.sourceInMs ?? 0)),
        sourceInMs: timing?.sourceInMs ?? clip.sourceInMs ?? 0,
        rate: 1,
      };
    }),
  ];
}

/**
 * Keyboard Q/W/E trim route (ripple-in, ripple-out, roll): computes the clip edit through the
 * real trim math and applies the clip-owned marker transition in the same patch — head-trimmed
 * markers shift with their content, markers in trimmed-away content are removed, tail-trim
 * victims beyond the new duration are removed, and markers on ripple-shifted lane clips follow
 * their clip. Returns undefined when the edit is a no-op or impossible.
 */
export function buildKeyboardTrimEditPatch(input: {
  kind: 'ripple-in' | 'ripple-out' | 'roll';
  visualClips: readonly EditorVisualClip[];
  timelineMarkers: readonly TimelineMarker[];
  selectedClipId: string;
  playheadMs: number;
  blocks: ReadonlyArray<{ clip: EditorVisualClip; startMs: number; durationMs: number }>;
  resolveClipTiming: (visual: readonly EditorVisualClip[]) => ReadonlyMap<string, { durationMs: number; sourceInMs: number }>;
}): { editorVisualClips: EditorVisualClip[]; editorTimelineMarkers?: TimelineMarker[] } | undefined {
  const selected = input.visualClips.find((clip) => clip.id === input.selectedClipId);
  if (!selected) return undefined;
  let nextClips: EditorVisualClip[] | null;
  if (input.kind === 'roll') {
    const editPoint = findNearestEditPoint(input.blocks, selected.trackIndex, input.playheadMs);
    if (!editPoint) return undefined;
    nextClips = rollEditPointToTarget(input.blocks, editPoint.leftClipId, editPoint.rightClipId, input.playheadMs);
  } else {
    nextClips = rippleTrimClipToTarget(
      input.blocks,
      selected.id,
      input.kind === 'ripple-in' ? 'in' : 'out',
      input.playheadMs,
    );
  }
  if (!nextClips) return undefined;
  const nextMarkers = applyClipSetTransitionToTimelineMarkers(
    input.timelineMarkers,
    buildEditorClipMarkerTransitionDescriptors(input.visualClips, [], input.resolveClipTiming(input.visualClips)),
    buildEditorClipMarkerTransitionDescriptors(nextClips, [], input.resolveClipTiming(nextClips)),
  );
  return {
    editorVisualClips: nextClips,
    ...(nextMarkers !== input.timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
  };
}
/**
 * Transcript search as the workspace event handlers use it: never throws across the UI boundary.
 * Malformed stored transcript data and over-length queries become an actionable message instead
 * of an uncaught event-handler exception.
 */
export function searchEditableTranscriptSafely(
  words: readonly EditableTranscriptWord[],
  query: string,
): { ok: true; matches: TranscriptSearchMatch[] } | { ok: false; message: string } {
  try {
    return { ok: true, matches: searchTranscript(words, query) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Transcript search failed.' };
  }
}

export interface WorkspaceTranscriptEditPlanInput {
  visualClips: readonly EditorVisualClip[];
  audioClips: readonly EditorAudioClip[];
  selectedVisualClipIds: readonly string[];
  selectedAudioClipIds: readonly string[];
  visualTrackCount: number;
  audioTrackCount: number;
  lockedVisualTrackIndexes: readonly number[];
  lockedAudioTrackIndexes: readonly number[];
  audioDurationMsByClipId: Readonly<Record<string, number>>;
  words: readonly EditableTranscriptWord[];
  sourceProposal: TranscriptEditProposal;
  /** Identity ids of the transcribed source item (library item id plus its source node id). */
  sourceItemIdentityIds: readonly string[];
}

export type WorkspaceTranscriptEditPlanResult =
  | { ok: true; value: VideoTranscriptSourceAppliedTimeline; occurrenceCount: number }
  | { ok: false; kind: 'no-occurrence' | 'ambiguous-occurrence' | 'apply-rejected'; occurrenceCount: number; detail: string };

/**
 * The exact UI-to-timeline transcript edit route: resolve which timeline occurrence(s) of the
 * transcribed source the edit targets (explicit selection first, then a unique occurrence),
 * thread the real track locks, map source transcript time to record time, and run the bounded
 * atomic apply. Pure; the component only renders dialogs and commits the returned clips.
 */
export function planWorkspaceTranscriptEdit(input: WorkspaceTranscriptEditPlanInput): WorkspaceTranscriptEditPlanResult {
  const sourceIds = new Set(input.sourceItemIdentityIds);
  const selectedOccurrences = [
    ...input.visualClips.filter((clip) => input.selectedVisualClipIds.includes(clip.id) && sourceIds.has(clip.sourceNodeId)).map((clip) => ({ kind: 'visual' as const, clipId: clip.id })),
    ...input.audioClips.filter((clip) => input.selectedAudioClipIds.includes(clip.id) && sourceIds.has(clip.sourceNodeId)).map((clip) => ({ kind: 'audio' as const, clipId: clip.id })),
  ];
  const allOccurrences = [
    ...input.visualClips.filter((clip) => sourceIds.has(clip.sourceNodeId)).map((clip) => ({ kind: 'visual' as const, clipId: clip.id })),
    ...input.audioClips.filter((clip) => sourceIds.has(clip.sourceNodeId)).map((clip) => ({ kind: 'audio' as const, clipId: clip.id })),
  ];
  const sourceOccurrences = selectedOccurrences.length > 0
    ? selectedOccurrences
    : allOccurrences.length === 1
      ? allOccurrences
      : [];
  if (sourceOccurrences.length === 0) {
    return {
      ok: false,
      kind: allOccurrences.length === 0 ? 'no-occurrence' : 'ambiguous-occurrence',
      occurrenceCount: allOccurrences.length,
      detail: allOccurrences.length === 0
        ? 'This transcribed source is not used in the active sequence.'
        : 'This source appears more than once. Select the exact timeline clip occurrence to edit before applying the transcript deletion.',
    };
  }
  const lockedVisual = new Set(input.lockedVisualTrackIndexes);
  const lockedAudio = new Set(input.lockedAudioTrackIndexes);
  const applied = planAndApplyVideoSourceTranscriptEdit({
    visualClips: input.visualClips,
    audioClips: input.audioClips,
    tracks: [
      ...Array.from({ length: input.visualTrackCount }, (_, trackIndex) => ({ kind: 'visual' as const, trackIndex, locked: lockedVisual.has(trackIndex) })),
      ...Array.from({ length: input.audioTrackCount }, (_, trackIndex) => ({ kind: 'audio' as const, trackIndex, locked: lockedAudio.has(trackIndex) })),
    ],
    words: input.words,
    sourceProposal: input.sourceProposal,
    selectedClips: sourceOccurrences,
    audioDurationMsByClipId: input.audioDurationMsByClipId,
  });
  if (!applied.ok) {
    return { ok: false, kind: 'apply-rejected', occurrenceCount: allOccurrences.length, detail: applied.detail };
  }
  return { ok: true, value: applied.value, occurrenceCount: allOccurrences.length };
}

/** Accessible preview/confirmation text for the real transcript plan result. */
export function summarizeWorkspaceTranscriptPlan(
  plan: WorkspaceTranscriptEditPlanResult,
  proposal: TranscriptEditProposal,
): string {
  if (!plan.ok) {
    if (plan.kind === 'apply-rejected') return `Transcript patch preview rejected: ${plan.detail}`;
    return `Transcript patch preview unavailable: ${plan.detail}`;
  }
  const patch = plan.value.patch;
  const removedMs = proposal.commands.reduce((total, command) => total + command.durationMs, 0);
  const parts = [
    `Transcript patch preview: ${patch.affectedClipIds.length} clip${patch.affectedClipIds.length === 1 ? '' : 's'} affected`,
    `${patch.createdClipIds.length} split${patch.createdClipIds.length === 1 ? '' : 's'}`,
  ];
  if (patch.removedClipIds.length > 0) parts.push(`${patch.removedClipIds.length} removed`);
  parts.push(`removes ${(removedMs / 1_000).toFixed(2)} s`);
  return parts.join(' · ');
}


export function TimelineMarkerFlag({
  displayTimelineSeconds,
  marker,
  onJump,
  onRemove,
}: {
  displayTimelineSeconds: number;
  marker: TimelineMarker;
  onJump: (seconds: number) => void;
  onRemove: (markerId: string) => void;
}) {
  const markerType = marker.endSeconds !== undefined ? 'range' : marker.clipId ? 'clip' : 'point';
  const markerTime = marker.endSeconds === undefined
    ? `${marker.seconds.toFixed(3)} seconds`
    : `${marker.seconds.toFixed(3)} to ${marker.endSeconds.toFixed(3)} seconds`;
  const accessibleName = `${marker.label || 'Marker'}, ${marker.kind ?? 'comment'} ${markerType} marker at ${markerTime}, color ${marker.color}. Press Enter to jump; Delete or Backspace to remove.`;

  return (
    <button
      aria-keyshortcuts="Enter Delete Backspace"
      aria-label={accessibleName}
      className="absolute bottom-0 top-0 z-30 w-2 -translate-x-1/2 cursor-pointer bg-transparent"
      data-timeline-marker-id={marker.id}
      onClick={(event) => {
        event.stopPropagation();
        if (event.altKey) {
          onRemove(marker.id);
          return;
        }
        onJump(marker.seconds);
      }}
      onKeyDown={(event) => {
        if (!isTimelineMarkerRemovalKey(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        onRemove(marker.id);
      }}
      style={{ left: `${(marker.seconds / displayTimelineSeconds) * 100}%` }}
      title={`${marker.label} · ${marker.seconds.toFixed(1)}s — click to jump, Alt-click or press Delete to remove`}
      type="button"
    >
      <span aria-hidden="true" className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px]" style={{ background: marker.color }} />
      <span aria-hidden="true" className="absolute bottom-0 left-1/2 top-2 w-px -translate-x-1/2" style={{ background: marker.color, opacity: 0.75 }} />
    </button>
  );
}
const SOURCE_BIN_ORIGIN_FILTER_OPTIONS: Array<{ id: SourceBinOriginFilter; label: string }> = [
  { id: 'all', label: 'All media' },
  { id: 'ingested', label: 'Ingested' },
  { id: 'generated', label: 'Generated' },
];
const SOURCE_BIN_PAGE_SIZE = 48;
const VISUAL_TRACK_COUNT = 4;
const AUDIO_TRACK_COUNT = 4;

/**
 * Single source of truth for the selected clip's fit + transform at a playhead progress,
 * shared by the Program Tools cluster and the Inspector (UX review F09) so the two surfaces
 * always reflect the same fit/zoom state instead of deriving it independently.
 */
/** Friendly timeline label for clips without a bin item (comic bubbles/captions, text). */
function visualBlockLabel(clip: EditorVisualClip, itemLabel?: string): string {
  if (itemLabel) return itemLabel;
  if (clip.sourceKind === 'comic') {
    const text = clip.textContent?.trim();
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text;
    return clip.comicKind === 'caption' ? 'Caption' : clip.comicKind === 'thought-bubble' ? 'Thought Bubble' : 'Speech Bubble';
  }
  if (clip.sourceKind === 'text' && clip.textContent?.trim()) {
    const text = clip.textContent.trim();
    return text.length > 24 ? `${text.slice(0, 24)}…` : text;
  }
  return clip.sourceNodeId;
}

export function resolveClipFitState(clip: EditorVisualClip, progressPercent: number) {
  const legacy = getVisualKeyframeStateAtProgress(clip, progressPercent);
  const durationMs = Math.max(1, clip.professional?.parameterKeyframes?.find((track) => track.durationMs)?.durationMs ?? 1);
  const localTimeMs = (Math.max(0, Math.min(100, progressPercent)) / 100) * durationMs;
  const parameters = clip.professional?.parameterKeyframes;
  return {
    ...legacy,
    positionX: evaluateProfessionalVideoParameter(parameters, 'position-x', localTimeMs, { defaultValue: legacy.positionX }),
    positionY: evaluateProfessionalVideoParameter(parameters, 'position-y', localTimeMs, { defaultValue: legacy.positionY }),
    scalePercent: evaluateProfessionalVideoParameter(parameters, 'scale', localTimeMs, { defaultValue: legacy.scalePercent, minValue: 1 }),
    rotationDeg: evaluateProfessionalVideoParameter(parameters, 'rotation', localTimeMs, { defaultValue: legacy.rotationDeg }),
    opacityPercent: evaluateProfessionalVideoParameter(parameters, 'opacity', localTimeMs, { defaultValue: legacy.opacityPercent, minValue: 0, maxValue: 100 }),
    fitMode: clip.fitMode,
  };
}

/**
 * Maps a comic tail-tip percent (frame coords, 50/50 = body centre) to a CSS percent within the
 * clip's stage frame, and its inverse for the tail-drag handle. Shared contract with the comic card
 * in mediaComposition: the body box occupies `COMIC_CARD_BODY_*` of the `COMIC_CARD_*` card, and a
 * tip at percent 50±COMIC_BODY_RADIUS_PERCENT lands on the body edge.
 */
const COMIC_TAIL_HANDLE_FACTOR_X =
  (COMIC_CARD_BODY_WIDTH / COMIC_CARD_WIDTH) * (100 / (2 * COMIC_BODY_RADIUS_PERCENT));
const COMIC_TAIL_HANDLE_FACTOR_Y =
  (COMIC_CARD_BODY_HEIGHT / COMIC_CARD_HEIGHT) * (100 / (2 * COMIC_BODY_RADIUS_PERCENT));

function comicTailTipToFrameCssPercent(tipXPercent: number, tipYPercent: number): { leftPercent: number; topPercent: number } {
  return {
    leftPercent: 50 + (tipXPercent - 50) * COMIC_TAIL_HANDLE_FACTOR_X,
    topPercent: 50 + (tipYPercent - 50) * COMIC_TAIL_HANDLE_FACTOR_Y,
  };
}

function comicTailFrameFractionToTipPercent(xFractionFromCenter: number, yFractionFromCenter: number): { tipXPercent: number; tipYPercent: number } {
  return {
    tipXPercent: 50 + (xFractionFromCenter * 100) / COMIC_TAIL_HANDLE_FACTOR_X,
    tipYPercent: 50 + (yFractionFromCenter * 100) / COMIC_TAIL_HANDLE_FACTOR_Y,
  };
}
const TIMELINE_PREVIEW_DEBOUNCE_MS = 220;
const TIMELINE_PREVIEW_MAX_CLIPS = 32;
const TIMELINE_PREVIEW_CONCURRENCY = 2;
const MEDIA_METADATA_CONCURRENCY = 4;
const TIMELINE_WAVEFORM_CONCURRENCY = 1;
const TIMELINE_WAVEFORM_SAMPLE_COUNT = 80;
const TIMELINE_UNAVAILABLE_WAVEFORM_PEAKS: number[] = [];
const EDITOR_CLIP_FILTER_KINDS: EditorClipFilterKind[] = getClipFilterKinds();
const EDITOR_CLIP_EFFECT_PRESETS = getClipEffectPresets();

type TimelineTool =
  | 'select'
  | 'cut'
  | 'marquee'
  | 'range'
  | 'ripple'
  | 'roll'
  | 'slip'
  | 'slide'
  | 'rate-stretch'
  | 'hand'
  | 'snap';
type EditorContextMenuItem = Omit<SharedContextMenuItem, 'id'> & { id?: string };

interface TextEditDraft {
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic' | 'oblique';
  managedFace?: ManagedBundledFontFaceReference;
  managedFaceIssue?: ManagedBundledFontFaceIssue;
  fontSizePx: number;
  color: string;
  textEffect: TextClipEffect;
}

interface TextEditDialogState {
  mode: 'asset' | 'clip';
  targetId: string;
  title: string;
  draft: TextEditDraft;
}

export type VideoMediaImportHandling = 'link' | 'copy-to-scratch';

interface MediaImportDialogState {
  accept: string;
  kinds: Array<'video' | 'audio'>;
  handling: VideoMediaImportHandling;
  busy: boolean;
}

interface ProfessionalTrimRuntimePreview {
  baseCompositionSignature: string;
  description: string;
  projection: VideoWorkflowSourceRecordProjection;
  session: VideoTrimToolSession<VideoWorkflowSourceRecordClip & AdvancedTrimClip>;
}

export interface ManualEditorWorkspaceProps {
  getNewFlowNodePosition: () => { x: number; y: number };
  canCopyImportedMedia?: boolean;
  onImportMedia?: (
    kinds: Array<'video' | 'audio'>,
    handling: VideoMediaImportHandling,
  ) => Promise<boolean>;
}

export function VideoWorkspace({ canCopyImportedMedia = false, getNewFlowNodePosition, onImportMedia }: ManualEditorWorkspaceProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const addNode = useFlowStore((state) => state.addNode);
  const onNodesChange = useFlowStore((state) => state.onNodesChange);
  const runNode = useFlowStore((state) => state.runNode);
  const cancelNodeRun = useFlowStore((state) => state.cancelNodeRun);
  const removeEditorSourceReferences = useFlowStore((state) => state.removeEditorSourceReferences);
  const activeSourceBinId = useEditorStore((state) => state.activeSourceBinId);
  const activeCompositionId = useEditorStore((state) => state.activeCompositionId);
  const selectedSourceItemId = useEditorStore((state) => state.selectedSourceItemId);
  const selectedVisualClipId = useEditorStore((state) => state.selectedVisualClipId);
  const selectedAudioClipId = useEditorStore((state) => state.selectedAudioClipId);
  const selectedVisualClipIds = useEditorStore((state) => state.selectedVisualClipIds);
  const selectedAudioClipIds = useEditorStore((state) => state.selectedAudioClipIds);
  const selectedVisualClipIdSet = useMemo(() => new Set(selectedVisualClipIds), [selectedVisualClipIds]);
  const selectedAudioClipIdSet = useMemo(() => new Set(selectedAudioClipIds), [selectedAudioClipIds]);
  const sourceBinTab = useEditorStore((state) => state.sourceBinTab);
  const setActiveSourceBinId = useEditorStore((state) => state.setActiveSourceBinId);
  const setActiveCompositionId = useEditorStore((state) => state.setActiveCompositionId);
  const setSelectedSourceItemId = useEditorStore((state) => state.setSelectedSourceItemId);
  const setSelectedVisualClipId = useEditorStore((state) => state.setSelectedVisualClipId);
  const setSelectedAudioClipId = useEditorStore((state) => state.setSelectedAudioClipId);
  const setSelectedVisualClipIds = useEditorStore((state) => state.setSelectedVisualClipIds);
  const setSelectedAudioClipIds = useEditorStore((state) => state.setSelectedAudioClipIds);
  const setSourceBinTab = useEditorStore((state) => state.setSourceBinTab);
  const setPanelVisibility = useEditorStore((state) => state.setPanelVisibility);
  const setWorkspaceView = useEditorStore((state) => state.setWorkspaceView);
  const clearTimelineSelection = useEditorStore((state) => state.clearTimelineSelection);
  const sourceMonitorVisible = useEditorStore((state) => state.sourceMonitorVisible);
  const programMonitorVisible = useEditorStore((state) => state.programMonitorVisible);
  const inspectorVisible = useEditorStore((state) => state.inspectorVisible);
  const sourceBinVisible = useEditorStore((state) => state.sourceBinVisible);
  const inspectorWidth = useEditorStore((state) => state.inspectorWidth);
  const sourceBinWidth = useEditorStore((state) => state.sourceBinWidth);
  const monitorSplitPercent = useEditorStore((state) => state.monitorSplitPercent);
  const hydratedFlowWorkspaceId = useFlowWorkspaceStore((state) => state.hydratedWorkspaceId);
  const flowWorkspaces = useFlowWorkspaceStore((state) => state.workspaces);
  const monitorSectionHeight = useEditorStore((state) => state.monitorSectionHeight);
  const timelineVisualTrackHeight = useEditorStore((state) => state.timelineVisualTrackHeight);
  const timelineAudioTrackHeight = useEditorStore((state) => state.timelineAudioTrackHeight);
  const setPanelWidth = useEditorStore((state) => state.setPanelWidth);
  const setMonitorSplitPercent = useEditorStore((state) => state.setMonitorSplitPercent);
  const setMonitorSectionHeight = useEditorStore((state) => state.setMonitorSectionHeight);
  const setTimelineTrackHeight = useEditorStore((state) => state.setTimelineTrackHeight);
  const restoreWorkspaceSnapshot = useEditorStore((state) => state.restoreWorkspaceSnapshot);
  const resetWorkspacePanels = useDockablePanelStore((state) => state.resetWorkspacePanels);
  const libraryItems = useSourceBinStore(useShallow((state) => state.bins.flatMap((bin) => bin.items)));
  const importFiles = useSourceBinStore((state) => state.importFiles);
  const addAssetItem = useSourceBinStore((state) => state.addAssetItem);
  const removeSourceBinItem = useSourceBinStore((state) => state.removeItem);
  const toggleSourceBinItemStarred = useSourceBinStore((state) => state.toggleItemStarred);
  const updateSourceBinItemsProfessional = useSourceBinStore((state) => state.updateItemsProfessional);
  const setSourceBinItemCollapsed = useSourceBinStore((state) => state.setItemCollapsed);
  const setAllSourceBinItemsCollapsed = useSourceBinStore((state) => state.setAllItemsCollapsed);
  const renderBackendPreference = useSettingsStore((state) => state.providerSettings.renderBackendPreference);
  const setProviderSetting = useSettingsStore((state) => state.setProviderSetting);
  const paperDocument = usePaperStore((state) => state.document);
  const importAcceptRef = useRef<HTMLInputElement>(null);
  const sourceMonitorVideoRef = useRef<HTMLVideoElement | null>(null);
  const programMonitorVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineRulerScrollRef = useRef<HTMLDivElement | null>(null);
  const displayTimelineSecondsRef = useRef(10);
  const cutSelectedVisualClipAtPlayheadRef = useRef<(shiftKey?: boolean) => boolean>(() => false);
  const renderSegmentSignaturesRef = useRef<Record<string, string>>({});
  const [programMonitorMode, setProgramMonitorMode] = useState<'stage' | 'rendered'>('stage');
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select');
  const setTimelineToolWithActivity = useCallback((nextTool: TimelineTool, source: ActivityTrailSource = 'toolbar') => {
    setTimelineTool(nextTool);
    recordActivityTrailWorkspaceEvent('editor', 'Select Video timeline tool', nextTool, source);
  }, []);
  const [timelineZoomPercent, setTimelineZoomPercent] = useState(150);
  const [timelineViewportRange, setTimelineViewportRange] = useState<TimelineViewportRange>();
  const [incrementalRenderSummary, setIncrementalRenderSummary] = useState<string | undefined>();
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [mediaInfoMap, setMediaInfoMap] = useState<Record<string, SourceMediaInfo>>({});
  const [clipEdgePreviewMap, setClipEdgePreviewMap] = useState<Record<string, TimelineClipEdgePreview>>({});
  const [audioWaveformMap, setAudioWaveformMap] = useState<Record<string, number[]>>({});
  const [sourceBinSearchQuery, setSourceBinSearchQuery] = useState('');
  const [sourceBinKindFilter, setSourceBinKindFilter] = useState<SourceBinKindFilter>('all');
  const [sourceBinOriginFilter, setSourceBinOriginFilter] = useState<SourceBinOriginFilter>('all');
  const [activeProfessionalSmartBinId, setActiveProfessionalSmartBinId] = useState<string>();
  const [sourceBinVisibleItemLimits, setSourceBinVisibleItemLimits] = useState<Record<SourceBinMediaPoolKind, number>>({
    image: SOURCE_BIN_PAGE_SIZE,
    video: SOURCE_BIN_PAGE_SIZE,
    audio: SOURCE_BIN_PAGE_SIZE,
    subtitle: SOURCE_BIN_PAGE_SIZE,
  });
  const [mediaImportDialog, setMediaImportDialog] = useState<MediaImportDialogState | null>(null);
  const [mediaManagementBusy, setMediaManagementBusy] = useState(false);
  const [mediaManagementStatus, setMediaManagementStatus] = useState<string>();
  const [paperStoryboardImportStatus, setPaperStoryboardImportStatus] = useState<string | null>(null);
  const [isImportingPaperStoryboardPages, setIsImportingPaperStoryboardPages] = useState(false);
  const [sourceBinMediaPoolCollapsed, setSourceBinMediaPoolCollapsed] = useState<Record<SourceBinMediaPoolKind, boolean>>({
    image: false,
    video: false,
    audio: false,
    subtitle: false,
  });
  const [alignmentCaptionItemId, setAlignmentCaptionItemId] = useState<string>();
  const [speechLevelMatchState, setSpeechLevelMatchState] = useState<{
    clipId?: string;
    busy: boolean;
    message?: string;
  }>({ busy: false });
  const clipPreviewSignatureRef = useRef<Record<string, string>>({});
  const audioWaveformSignatureRef = useRef<Record<string, string>>({});
  const sourceMediaInfoSignatureRef = useRef<Record<string, string>>({});
  const sourceMediaInfoInFlightRef = useRef<Set<string>>(new Set());
  const workspaceMountedRef = useRef(true);
  const dialogueAuditionSessionRef = useRef<DialogueAuditionSession | undefined>(undefined);
  const dialogueAuditionGenerationRef = useRef(0);
  const dialogueAuditionAbortRef = useRef<AbortController | undefined>(undefined);
  const [dialogueAuditionState, setDialogueAuditionState] = useState<{
    clipId?: string;
    busy: boolean;
    playing: boolean;
    side: DialogueAuditionSide;
    calibrateCleanWithMatch: boolean;
    summary?: DialogueAuditionSummary;
    message?: string;
  }>({
    busy: false,
    playing: false,
    side: 'clean-dry',
    calibrateCleanWithMatch: true,
  });

  const sourceBinNodes = useMemo(() => nodes.filter((node) => node.type === 'sourceBin'), [nodes]);
  const compositionNodes = useMemo(() => nodes.filter((node) => node.type === 'composition'), [nodes]);

  useEffect(() => {
    workspaceMountedRef.current = true;
    return () => {
      workspaceMountedRef.current = false;
      dialogueAuditionGenerationRef.current += 1;
      dialogueAuditionAbortRef.current?.abort();
      dialogueAuditionAbortRef.current = undefined;
      dialogueAuditionSessionRef.current?.stop();
      dialogueAuditionSessionRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (!activeSourceBinId && sourceBinNodes[0]) {
      setActiveSourceBinId(sourceBinNodes[0].id);
    }
  }, [activeSourceBinId, setActiveSourceBinId, sourceBinNodes]);

  useEffect(() => {
    if (compositionNodes[0] && !compositionNodes.some((node) => node.id === activeCompositionId)) {
      setActiveCompositionId(compositionNodes[0].id);
    }
  }, [activeCompositionId, compositionNodes, setActiveCompositionId]);

  useEffect(() => {
    const validIds = new Set(compositionNodes.map((node) => node.id));
    setSequenceNavigatorTabs((current) => {
      const retained = current.filter((tab) => validIds.has(tab.sequenceId));
      if (activeCompositionId && validIds.has(activeCompositionId) && !retained.some((tab) => tab.sequenceId === activeCompositionId)) {
        return [...retained, { sequenceId: activeCompositionId, pinned: false }].slice(-32);
      }
      return retained;
    });
  }, [activeCompositionId, compositionNodes]);

  const activeComposition = compositionNodes.find((node) => node.id === activeCompositionId);
  const professionalWorkflowState = useMemo(
    () => sanitizeEditorProfessionalWorkflowState(activeComposition?.data.editorProfessionalWorkflowState),
    [activeComposition?.data.editorProfessionalWorkflowState],
  );
  const activeCompositionCachedResult = typeof activeComposition?.data.result === 'string' && activeComposition.data.result.length > 0
    ? activeComposition.data.result
    : undefined;
  const activeCompositionCachedRenderSignature = typeof activeComposition?.data.editorRenderCacheCompositionSignature === 'string'
    ? activeComposition.data.editorRenderCacheCompositionSignature
    : undefined;
  const activeCompositionCacheSignatures = useMemo(
    () => normalizeVideoRenderCacheSegmentSignatures(activeComposition?.data.editorRenderCacheSegmentSignatures),
    [activeComposition?.data.editorRenderCacheSegmentSignatures],
  );
  const activeCompositionSegmentArtifacts = useMemo(
    () => normalizeVideoRenderCacheSegmentArtifacts(activeComposition?.data.editorRenderCacheSegmentArtifacts),
    [activeComposition?.data.editorRenderCacheSegmentArtifacts],
  );
  const renderCacheDetailLines = useMemo(
    () => {
      const manifestLines = formatVideoRenderAssemblyManifestDetails(
        activeComposition?.data.editorRenderCacheAssemblyManifest
          ?? activeComposition?.data.editorRenderCacheLastAssemblyManifest,
      );
      const assemblyResultLine = formatVideoRenderAssemblyResultDetail(
        activeComposition?.data.resultOutputMetadata?.assemblyResult
          ?? activeComposition?.data.editorRenderCacheLastAssemblyResult,
      );
      return assemblyResultLine ? [...manifestLines, assemblyResultLine] : manifestLines;
    },
    [
      activeComposition?.data.editorRenderCacheAssemblyManifest,
      activeComposition?.data.editorRenderCacheLastAssemblyManifest,
      activeComposition?.data.editorRenderCacheLastAssemblyResult,
      activeComposition?.data.resultOutputMetadata,
    ],
  );

  useEffect(() => {
    renderSegmentSignaturesRef.current = activeCompositionCachedResult
      ? activeCompositionCacheSignatures
      : {};
  }, [activeComposition?.id, activeCompositionCacheSignatures, activeCompositionCachedResult]);

  const orderedLibraryItems = useMemo(
    () => sortSourceBinItemsForDisplay(libraryItems),
    [libraryItems],
  );
  const sourceItems = useMemo(
    () => orderedLibraryItems.map(mapLibraryItemToEditorSourceItem),
    [orderedLibraryItems],
  );
  const timelineSourceItems = useMemo(
    () => sourceItems.filter((item) => canUseSourceItemAsVisual(item) || canUseSourceItemAsAudio(item) || item.kind === 'subtitle'),
    [sourceItems],
  );
  const professionalMediaLogging = useMemo(
    () => buildProfessionalMediaLoggingState(timelineSourceItems, professionalWorkflowState),
    [professionalWorkflowState, timelineSourceItems],
  );
  const activeProfessionalSmartBin = useMemo(
    () => professionalMediaLogging.smartBins.find((bin) => bin.id === activeProfessionalSmartBinId),
    [activeProfessionalSmartBinId, professionalMediaLogging.smartBins],
  );
  const activeProfessionalSmartBinSourceIds = useMemo(
    () => activeProfessionalSmartBin
      ? new Set(filterVideoMediaLogsBySmartBin(professionalMediaLogging.records, activeProfessionalSmartBin).map((record) => record.sourceItemId))
      : undefined,
    [activeProfessionalSmartBin, professionalMediaLogging.records],
  );
  const sourceBinOriginCounts = useMemo(
    () => buildSourceBinOriginCounts(timelineSourceItems),
    [timelineSourceItems],
  );
  const sourceBinOriginItems = useMemo(
    () => filterSourceBinItemsForDisplay(timelineSourceItems, {
      kind: 'all',
      origin: sourceBinOriginFilter,
      query: '',
    }),
    [sourceBinOriginFilter, timelineSourceItems],
  );
  const sourceBinKindCounts = useMemo(
    () => buildSourceBinKindCounts(sourceBinOriginItems),
    [sourceBinOriginItems],
  );
  const mediaSourceItems = useMemo(
    () => {
      const filtered = filterSourceBinItemsForDisplay(timelineSourceItems, {
        kind: sourceBinKindFilter,
        origin: sourceBinOriginFilter,
        query: sourceBinSearchQuery,
      });
      return activeProfessionalSmartBinSourceIds
        ? filtered.filter((item) => activeProfessionalSmartBinSourceIds.has(item.id))
        : filtered;
    },
    [activeProfessionalSmartBinSourceIds, sourceBinKindFilter, sourceBinOriginFilter, sourceBinSearchQuery, timelineSourceItems],
  );
  const mediaSourceItemsByPool = useMemo(
    () => ({
      image: filterSourceBinItemsForDisplay(mediaSourceItems, { kind: 'image', query: '' }),
      video: filterSourceBinItemsForDisplay(mediaSourceItems, { kind: 'video', query: '' }),
      audio: filterSourceBinItemsForDisplay(mediaSourceItems, { kind: 'audio', query: '' }),
      subtitle: filterSourceBinItemsForDisplay(mediaSourceItems, { kind: 'subtitle', query: '' }),
    }),
    [mediaSourceItems],
  );
  const hasAnyMediaPoolItems = mediaSourceItemsByPool.image.length > 0
    || mediaSourceItemsByPool.video.length > 0
    || mediaSourceItemsByPool.audio.length > 0
    || mediaSourceItemsByPool.subtitle.length > 0;

  useEffect(() => {
    setSourceBinVisibleItemLimits({
      image: SOURCE_BIN_PAGE_SIZE,
      video: SOURCE_BIN_PAGE_SIZE,
      audio: SOURCE_BIN_PAGE_SIZE,
      subtitle: SOURCE_BIN_PAGE_SIZE,
    });
  }, [sourceBinKindFilter, sourceBinOriginFilter, sourceBinSearchQuery]);
  const visualClips = useMemo(
    () => (activeComposition ? getEditorVisualClips(activeComposition.data) : []),
    [activeComposition],
  );
  const audioClips = useMemo(
    () => (activeComposition ? getEditorAudioClips(activeComposition.data) : []),
    [activeComposition],
  );
  const visualTrackCount = useMemo(() => Math.min(64, Math.max(
    VISUAL_TRACK_COUNT,
    activeComposition?.data.editorProfessionalState?.tracks.filter((track) => track.kind === 'video').length ?? 0,
    visualClips.reduce((maximum, clip) => Math.max(maximum, clip.trackIndex + 1), 0),
  )), [activeComposition?.data.editorProfessionalState?.tracks, visualClips]);
  const audioTrackCount = useMemo(() => Math.min(64, Math.max(
    AUDIO_TRACK_COUNT,
    activeComposition?.data.editorProfessionalState?.tracks.filter((track) => track.kind === 'audio').length ?? 0,
    audioClips.reduce((maximum, clip) => Math.max(maximum, clip.trackIndex + 1), 0),
  )), [activeComposition?.data.editorProfessionalState?.tracks, audioClips]);
  const stageObjects = useMemo(
    () => (activeComposition ? getEditorStageObjects(activeComposition.data) : []),
    [activeComposition],
  );
  const compositionEditorAssets = useMemo(
    () => (activeComposition ? getEditorAssets(activeComposition.data) : []),
    [activeComposition],
  );
  const editorAssets = useMemo(
    () => getProjectEditorAssets(compositionEditorAssets, orderedLibraryItems),
    [compositionEditorAssets, orderedLibraryItems],
  );
  const paperStoryboardPageDescriptors = useMemo(
    () => buildPaperStoryboardPageDescriptors(paperDocument),
    [paperDocument],
  );
  const paperStoryboardExistingItemIds = useMemo(
    () => getPaperStoryboardExistingItemIds(libraryItems, paperStoryboardPageDescriptors),
    [libraryItems, paperStoryboardPageDescriptors],
  );
  const timelineSnapPoints = useMemo(
    () => normalizeTimelineSnapPoints(activeComposition?.data.editorTimelineSnapPoints),
    [activeComposition?.data.editorTimelineSnapPoints],
  );
  const timelineMarkers = useMemo(
    () => normalizeTimelineMarkers(activeComposition?.data.editorTimelineMarkers),
    [activeComposition?.data.editorTimelineMarkers],
  );
  const lockedVisualTracks = useMemo(
    () => normalizeLockedTracks(activeComposition?.data.editorLockedVisualTracks),
    [activeComposition?.data.editorLockedVisualTracks],
  );
  const lockedAudioTracks = useMemo(
    () => normalizeLockedTracks(activeComposition?.data.editorLockedAudioTracks),
    [activeComposition?.data.editorLockedAudioTracks],
  );
  const isVisualTrackLocked = (trackIndex: number) => isTrackLocked(lockedVisualTracks, trackIndex);
  const isAudioTrackLocked = (trackIndex: number) => isTrackLocked(lockedAudioTracks, trackIndex);
  const toggleVisualTrackLock = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorLockedVisualTracks: toggleLockedTrack(lockedVisualTracks, trackIndex) },
      isVisualTrackLocked(trackIndex) ? 'Unlock video track' : 'Lock video track',
    );
  };
  const toggleAudioTrackLock = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorLockedAudioTracks: toggleLockedTrack(lockedAudioTracks, trackIndex) },
      isAudioTrackLocked(trackIndex) ? 'Unlock audio track' : 'Lock audio track',
    );
  };
  const collapsedVisualTracks = useMemo(
    () => normalizeCollapsedTracks(activeComposition?.data.editorCollapsedVisualTracks),
    [activeComposition?.data.editorCollapsedVisualTracks],
  );
  const collapsedAudioTracks = useMemo(
    () => normalizeCollapsedTracks(activeComposition?.data.editorCollapsedAudioTracks),
    [activeComposition?.data.editorCollapsedAudioTracks],
  );
  const isVisualTrackCollapsed = (trackIndex: number) => isTrackCollapsed(collapsedVisualTracks, trackIndex);
  const isAudioTrackCollapsed = (trackIndex: number) => isTrackCollapsed(collapsedAudioTracks, trackIndex);
  const toggleVisualTrackCollapse = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorCollapsedVisualTracks: toggleCollapsedTrack(collapsedVisualTracks, trackIndex) },
      isVisualTrackCollapsed(trackIndex) ? 'Expand video track' : 'Collapse video track',
    );
  };
  const toggleAudioTrackCollapse = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorCollapsedAudioTracks: toggleCollapsedTrack(collapsedAudioTracks, trackIndex) },
      isAudioTrackCollapsed(trackIndex) ? 'Expand audio track' : 'Collapse audio track',
    );
  };
  // Overlay track kind (Phase 2D): a visual track can be designated 'overlay' so text/comic
  // clips live on their own track, visually distinct from panel-art (image/video) tracks. It's
  // metadata + placement preference + styling only — an overlay track is still a normal track.
  const visualTrackKinds = useMemo(
    () => getEditorVisualTrackKinds(activeComposition?.data ?? {}, visualTrackCount),
    [activeComposition?.data.editorVisualTrackKinds, visualTrackCount],
  );
  const toggleVisualTrackKind = (trackIndex: number) => {
    if (!activeComposition) return;
    const isOverlay = visualTrackKinds[trackIndex] === 'overlay';
    commitActiveCompositionPatch(
      { editorVisualTrackKinds: toggleEditorVisualTrackKind(visualTrackKinds, trackIndex) },
      isOverlay ? 'Unmark overlay track' : 'Mark overlay track',
    );
  };
  const editorAssetById = useMemo(
    () => new Map(editorAssets.map((asset) => [asset.id, asset])),
    [editorAssets],
  );
  const audioTrackVolumes = useMemo(
    () => (activeComposition ? getEditorAudioTrackVolumes(activeComposition.data, audioTrackCount) : getDefaultAudioTrackVolumes()),
    [activeComposition, audioTrackCount],
  );
  const mutedAudioTracks = useMemo(
    () => normalizeAudioTrackIndexes(activeComposition?.data.editorMutedAudioTracks, audioTrackCount),
    [activeComposition?.data.editorMutedAudioTracks, audioTrackCount],
  );
  const soloAudioTracks = useMemo(
    () => normalizeAudioTrackIndexes(activeComposition?.data.editorSoloAudioTracks, audioTrackCount),
    [activeComposition?.data.editorSoloAudioTracks, audioTrackCount],
  );
  const sourceItemByNodeId = useMemo(
    () => buildEditorSourceItemLookup(libraryItems),
    [libraryItems],
  );
  const projectVideoNodes = useMemo(
    () => [
      ...nodes,
      ...flowWorkspaces.flatMap((workspace) => (
        workspace.id === hydratedFlowWorkspaceId ? [] : workspace.flow.nodes
      )),
    ],
    [flowWorkspaces, hydratedFlowWorkspaceId, nodes],
  );
  const usedVideoMediaItemIds = useMemo(
    () => collectUsedVideoMediaItemIds(projectVideoNodes, libraryItems),
    [libraryItems, projectVideoNodes],
  );
  const consolidatableVideoMediaItemIds = useMemo(() => {
    const usedItemIds = new Set(usedVideoMediaItemIds);
    return libraryItems.flatMap((item) => (
      usedItemIds.has(item.id) && item.nativeFilePath ? [item.id] : []
    ));
  }, [libraryItems, usedVideoMediaItemIds]);
  const activeCompositionSourceMedia = useMemo(() => {
    if (!activeComposition) return [];
    const activeItemIds = new Set(collectUsedVideoMediaItemIds([activeComposition], libraryItems));
    return libraryItems.flatMap((item) => activeItemIds.has(item.id) ? [{
      id: item.id,
      assetId: item.assetId,
      nativeFilePath: item.nativeFilePath,
      scratchFileName: item.scratchFileName,
      mimeType: item.mimeType,
      onlineState: item.professional?.onlineState,
      sourceFingerprint: item.professional?.sourceFingerprint,
      proxy: item.professional?.proxy ? {
        status: item.professional.proxy.status,
        scratchFileName: item.professional.proxy.scratchFileName,
        sourceFingerprint: item.professional.proxy.sourceFingerprint,
      } : undefined,
    }] : []);
  }, [activeComposition, libraryItems]);
  const nativeVideoMediaManagementAvailable = isNativeVideoMediaManagementAvailable();
  const [timelineCursorSeconds, setTimelineCursorSeconds] = useState(0);
  // JKL shuttle transport: 0 = paused; ±1/±2/±4/±8 = play rate (see timelineTransport.ts).
  const [shuttleRate, setShuttleRate] = useState(0);
  // Source monitor I/O marks for three-point editing (threePointEdit.ts); keyed to the marked item.
  const [sourceMarks, setSourceMarks] = useState<{ itemId: string; inSeconds?: number; outSeconds?: number } | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('');
  const [selectedParameterTrackId, setSelectedParameterTrackId] = useState<string>();
  const [transcriptQuery, setTranscriptQuery] = useState('');
  const [transcriptMatches, setTranscriptMatches] = useState<TranscriptSearchMatch[]>([]);
  const [selectedTranscriptMatch, setSelectedTranscriptMatch] = useState<TranscriptSearchMatch>();
  const [pendingTranscriptProposal, setPendingTranscriptProposal] = useState<TranscriptEditProposal>();
  const [voiceoverSfxOpen, setVoiceoverSfxOpen] = useState(false);
  const [voiceoverSfxMode, setVoiceoverSfxMode] = useState<'voiceover' | 'range-sfx'>('voiceover');
  const [voiceoverSfxDraft, setVoiceoverSfxDraft] = useState<VoiceoverSfxDialogDraft>({
    paragraphText: '',
    languageCode: 'en',
    voiceId: '',
    sfxPrompt: '',
    rangeStartMs: 0,
    rangeEndMs: 3_000,
  });
  const [voiceoverRightsConfirmed, setVoiceoverRightsConfirmed] = useState(false);
  const [voiceoverBillingConfirmed, setVoiceoverBillingConfirmed] = useState(false);
  const [voiceoverBusy, setVoiceoverBusy] = useState(false);
  const [voiceoverStatus, setVoiceoverStatus] = useState<string>();
  const [voiceoverParagraphs, setVoiceoverParagraphs] = useState<VideoVoiceoverParagraph[]>([]);
  const [sequenceNavigatorTabs, setSequenceNavigatorTabs] = useState<Array<{ sequenceId: string; pinned: boolean }>>([]);
  const [collapsedSequenceBinIds, setCollapsedSequenceBinIds] = useState<string[]>([]);
  const markerImportRef = useRef<HTMLInputElement | null>(null);
  const [markerImportFormat, setMarkerImportFormat] = useState<'json' | 'csv'>('json');
  const [timelineClipClipboard, setTimelineClipClipboard] = useState<VideoClipClipboardDocument>();
  // Clip-owned markers riding the same copy/cut selection. The clipboard document itself stays
  // media-free per its schema, so owned markers travel as this parallel authored-decision state.
  const [timelineClipMarkerClipboard, setTimelineClipMarkerClipboard] = useState<TimelineMarker[]>([]);

  useEffect(() => {
    if (shuttleRate === 0) return undefined;
    let frame = 0;
    let last = performance.now();
    let pendingDeltaMs = 0;
    const tick = (now: number) => {
      const deltaMs = now - last;
      last = now;
      pendingDeltaMs += deltaMs;
      if (pendingDeltaMs < 1000 / 30) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const playbackDeltaMs = pendingDeltaMs;
      pendingDeltaMs = 0;
      setTimelineCursorSeconds((current) => {
        const { nextSeconds, stopped } = advanceShuttleCursor(current, shuttleRate, playbackDeltaMs, displayTimelineSecondsRef.current);
        if (stopped) {
          setShuttleRate(0);
        }
        return nextSeconds;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shuttleRate]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: EditorContextMenuItem[];
  } | null>(null);
  const [visualClipPropertyClipboard, setVisualClipPropertyClipboard] =
    useState<VisualClipPropertyClipboard | null>(null);
  const [visualClipPropertyDialog, setVisualClipPropertyDialog] = useState<{
    clipId: string;
    sourceLabel: string;
    selectedProperties: VisualClipCopiedProperty[];
  } | null>(null);
  const [textEditDialog, setTextEditDialog] = useState<TextEditDialogState | null>(null);
  const [selectedStageObjectId, setSelectedStageObjectId] = useState<string | undefined>(undefined);
  const [selectedTimelineGap, setSelectedTimelineGap] = useState<TimelineGap | null>(null);
  const [sourceBinPreview, setSourceBinPreview] = useState<{
    kind: 'image' | 'video';
    src: string;
    label: string;
  } | null>(null);
  const [editorHistory, setEditorHistory] = useState(createEditorHistoryState);
  const [professionalStructuralQcReport, setProfessionalStructuralQcReport] = useState<VideoStructuralQcReport>();
  const [decodedSignalQcRunning, setDecodedSignalQcRunning] = useState(false);
  const [professionalTrimPreview, setProfessionalTrimPreview] = useState<ProfessionalTrimRuntimePreview>();
  const decodedSignalQcAbortControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => {
    decodedSignalQcAbortControllerRef.current?.abort();
  }, []);
  const professionalTrimTargetClipIdRef = useRef<string | undefined>(undefined);
  const professionalTrimEdgeRef = useRef<AdvancedTrimSessionOptions['edge'] | undefined>(undefined);
  const managedFontDependencies = useMemo(
    () => collectVideoBundledFontDependencies({
      assets: compositionEditorAssets,
      visualClips,
      stageObjects,
    }),
    [compositionEditorAssets, stageObjects, visualClips],
  );

  const managedFontGate = useManagedFontRegistrationGate(managedFontDependencies);

  const applyEditorHistorySnapshot = useCallback((
    compositionId: string,
    snapshot: ReturnType<typeof createEditorHistorySnapshot>,
  ) => {
    setActiveCompositionId(compositionId);
    const live = useFlowStore.getState().nodes.find((node) => (
      node.id === compositionId && node.type === 'composition'
    ));
    patchNodeData(compositionId, buildEditorHistoryRestorePatch(
      snapshot.toPatch(),
      live ? sanitizeEditorProfessionalWorkflowState(live.data.editorProfessionalWorkflowState).deliveryJobs : [],
    ));
    clearTimelineSelection();
    setContextMenu(null);
  }, [clearTimelineSelection, patchNodeData, setActiveCompositionId, setContextMenu]);

  const undoEditor = useCallback(() => {
    const result = undoEditorHistory(editorHistory);

    if (!result.entry || !result.snapshot) {
      return;
    }

    setEditorHistory(result.history);
    applyEditorHistorySnapshot(result.entry.compositionId, result.snapshot);
  }, [applyEditorHistorySnapshot, editorHistory]);

  const redoEditor = useCallback(() => {
    const result = redoEditorHistory(editorHistory);

    if (!result.entry || !result.snapshot) {
      return;
    }

    setEditorHistory(result.history);
    applyEditorHistorySnapshot(result.entry.compositionId, result.snapshot);
  }, [applyEditorHistorySnapshot, editorHistory]);
  const [transcriptSearchError, setTranscriptSearchError] = useState<string>();
  const [transcriptPreviewSummary, setTranscriptPreviewSummary] = useState<string>();
  /** Compositions whose persisted render queue has already been repaired in this mount. */
  const reconciledRenderQueuesRef = useRef(new Set<string>());
  /** The single in-flight deliverable, held outside React state so a re-render cannot double-start it. */
  const renderQueueRunRef = useRef<string | undefined>(undefined);
  /**
   * The composition whose queue this session has been told to run. Deliberately session-scoped and
   * never persisted: reopening a project must not start a long render on its own, because the
   * project may be opened to look at something, on another machine, or with the renderer down. One
   * explicit action starts it.
   */
  const [runningRenderQueueCompositionId, setRunningRenderQueueCompositionId] = useState<string>();
  /** Advances when one async queue attempt releases the sole runner slot. */
  const [renderQueueRunEpoch, setRenderQueueRunEpoch] = useState(0);

  const commitCompositionPatchById = useCallback((compositionId: string, patch: Partial<NodeData>, label: string) => {
    const currentComposition = useFlowStore.getState().nodes.find((node) => (
      node.id === compositionId && node.type === 'composition'
    ));
    if (!currentComposition) return false;

    // Clip-owned markers derive their displayed sequence time from their owning clip's start, so
    // every commit that can move a clip reconciles marker displays in the same atomic patch. The
    // owned offset stays authoritative; markers whose clip is absent are left untouched.
    let effectivePatch = patch;
    const markersForPatch = normalizeTimelineMarkers(
      patch.editorTimelineMarkers ?? currentComposition.data.editorTimelineMarkers,
    );
    if (markersForPatch.some((marker) => marker.clipId)) {
      const mergedData = { ...currentComposition.data, ...patch };
      const clipMarkerHosts: TimelineMarkerClipHost[] = [
        ...getEditorVisualClips(mergedData).map((clip) => ({ id: clip.id, startMs: clip.startMs })),
        ...getEditorAudioClips(mergedData).map((clip) => ({ id: clip.id, startMs: clip.offsetMs })),
      ];
      const reconciled = reconcileClipTimelineMarkers(markersForPatch, clipMarkerHosts);
      if (reconciled !== markersForPatch) {
        effectivePatch = { ...patch, editorTimelineMarkers: reconciled };
      }
    }

    const before = createEditorHistorySnapshot(currentComposition.data);
    const after = createEditorHistorySnapshot({
      ...currentComposition.data,
      ...effectivePatch,
    });

    setEditorHistory((current) =>
      pushEditorHistoryEntry(current, {
        compositionId,
        before,
        after,
        label,
      }),
    );
    patchNodeData(compositionId, effectivePatch);
    return true;
  }, [patchNodeData]);

  const commitActiveCompositionPatch = useCallback((patch: Partial<NodeData>, label: string) => {
    if (!activeComposition) return;
    commitCompositionPatchById(activeComposition.id, patch, label);
  }, [activeComposition, commitCompositionPatchById]);

  useEffect(() => {
    if (timelineSourceItems.length === 0) {
      if (selectedSourceItemId) {
        setSelectedSourceItemId(undefined);
      }
      return;
    }

    if (!selectedSourceItemId || !timelineSourceItems.some((item) => item.id === selectedSourceItemId)) {
      setSelectedSourceItemId(timelineSourceItems[0].id);
    }
  }, [selectedSourceItemId, setSelectedSourceItemId, timelineSourceItems]);

  useEffect(() => {
    if (
      alignmentCaptionItemId
      && !timelineSourceItems.some((item) => item.id === alignmentCaptionItemId && item.kind === 'subtitle')
    ) {
      setAlignmentCaptionItemId(undefined);
    }
  }, [alignmentCaptionItemId, timelineSourceItems]);

  useEffect(() => {
    if (selectedVisualClipId && !visualClips.some((clip) => clip.id === selectedVisualClipId)) {
      setSelectedVisualClipId(undefined);
    }
  }, [selectedVisualClipId, setSelectedVisualClipId, visualClips]);

  useEffect(() => {
    if (selectedAudioClipId && !audioClips.some((clip) => clip.id === selectedAudioClipId)) {
      setSelectedAudioClipId(undefined);
    }
  }, [audioClips, selectedAudioClipId, setSelectedAudioClipId]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('contextmenu', close);

    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  // Bridges the keydown effect (subscribed early in the component) to the opacity/volume nudge
  // callback defined later, next to the other keyframe helpers — a direct dep would hit the TDZ.
  const nudgeSelectedClipLevelAtPlayheadRef = useRef<(deltaPercent: number) => boolean>(() => false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // App-level remappable shortcuts run in capture phase and mark handled events. Keep this
      // listener only as a compatibility fallback for commands not present in the shared catalog;
      // never execute a second edit for an already-routed professional command.
      if (event.defaultPrevented) return;
      if (isEditableKeyboardTarget(event.target)) {
        if (event.key !== 'Escape') {
          return;
        }
      }

      if (event.key === 'F1' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        setHelpOpen((current) => !current);
        return;
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
        setHelpOpen(false);
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const shortcutKey = event.key.toLowerCase();
      const isCommandShortcut = event.ctrlKey || event.metaKey;

      if (isCommandShortcut && shortcutKey === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoEditor();
        } else {
          undoEditor();
        }
        return;
      }

      if (isCommandShortcut && shortcutKey === 'y') {
        event.preventDefault();
        redoEditor();
        return;
      }

      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && isCommandShortcut && event.altKey) {
        // Ctrl/Cmd+Alt+Up/Down: opacity/volume nudge at the playhead (±5, Shift for ±1),
        // creating a keyframe there when none exists. Checked before the position nudge so
        // the modifier combo never doubles as a spatial move.
        const deltaPercent = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 1 : 5);

        if (nudgeSelectedClipLevelAtPlayheadRef.current(deltaPercent)) {
          event.preventDefault();
          return;
        }
      }

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const stepPx = event.shiftKey ? 10 : event.altKey ? 0.25 : 1;
        const deltaX = event.key === 'ArrowLeft' ? -stepPx : event.key === 'ArrowRight' ? stepPx : 0;
        const deltaY = event.key === 'ArrowUp' ? -stepPx : event.key === 'ArrowDown' ? stepPx : 0;

        if (selectedStageObjectId && activeComposition) {
          event.preventDefault();
          commitActiveCompositionPatch({
            editorStageObjects: stageObjects.map((object) =>
              object.id === selectedStageObjectId
                ? { ...object, x: roundNudgeCoordinate(object.x + deltaX), y: roundNudgeCoordinate(object.y + deltaY) }
                : object,
            ),
          }, 'Nudge stage object');
          return;
        }

        if (selectedVisualClipId && activeComposition) {
          event.preventDefault();
          commitActiveCompositionPatch({
            editorVisualClips: visualClips.map((clip) =>
              clip.id === selectedVisualClipId
                ? {
                    ...clip,
                    positionX: roundNudgeCoordinate(clip.positionX + deltaX),
                    positionY: roundNudgeCoordinate(clip.positionY + deltaY),
                    endPositionX: clip.motionEnabled ? roundNudgeCoordinate(clip.endPositionX + deltaX) : clip.endPositionX,
                    endPositionY: clip.motionEnabled ? roundNudgeCoordinate(clip.endPositionY + deltaY) : clip.endPositionY,
                  }
                : clip,
            ),
          }, 'Nudge visual clip');
          return;
        }

        if (selectedAudioClipId && activeComposition && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          event.preventDefault();
          const deltaMs = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1000 : 100);
          commitActiveCompositionPatch({
            editorAudioClips: audioClips.map((clip) =>
              clip.id === selectedAudioClipId
                ? { ...clip, offsetMs: Math.max(0, clip.offsetMs + deltaMs) }
                : clip,
            ),
          }, 'Nudge audio clip');
          return;
        }
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        setTimelineCursorSeconds((current) => {
          const direction = event.key === 'ArrowRight' ? 1 : -1;
          const nextSeconds = event.shiftKey
            ? direction > 0
              ? Math.ceil(current + 0.001)
              : Math.floor(current - 0.001)
            : current + direction * 0.1;

          return Math.max(0, Math.min(displayTimelineSecondsRef.current, nextSeconds));
        });
        return;
      }

      if (!isCommandShortcut && shortcutKey === 'v') {
        setTimelineToolWithActivity('select', 'keyboard');
        return;
      }

      if (!isCommandShortcut && shortcutKey === 'c') {
        event.preventDefault();
        if (!cutSelectedVisualClipAtPlayheadRef.current(event.shiftKey)) {
          setTimelineToolWithActivity('cut', 'keyboard');
        }
        return;
      }

      if (!isCommandShortcut && shortcutKey === 's') {
        setTimelineToolWithActivity('slip', 'keyboard');
        return;
      }

      if (!isCommandShortcut && shortcutKey === 'h') {
        setTimelineToolWithActivity('hand', 'keyboard');
        return;
      }

      if (!isCommandShortcut && shortcutKey === 'm' && !event.shiftKey) {
        setTimelineToolWithActivity('snap', 'keyboard');
        return;
      }

      // JKL shuttle + space transport (owner-approved pro-editor quartet, item 1).
      if (event.key === ' ' && !isCommandShortcut) {
        event.preventDefault();
        setShuttleRate((current) => toggleShuttlePlay(current));
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'l') {
        event.preventDefault();
        setShuttleRate((current) => stepShuttleRate(current, 1));
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'j') {
        event.preventDefault();
        setShuttleRate((current) => stepShuttleRate(current, -1));
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'k' && !event.shiftKey) {
        event.preventDefault();
        setShuttleRate(0);
        return;
      }
      if (event.key === 'Home') {
        event.preventDefault();
        setShuttleRate(0);
        setTimelineCursorSeconds(0);
        return;
      }
      if (event.key === 'End') {
        event.preventDefault();
        setShuttleRate(0);
        setTimelineCursorSeconds(displayTimelineSecondsRef.current);
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'i') {
        event.preventDefault();
        markSourcePointRef.current('in');
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'o') {
        event.preventDefault();
        markSourcePointRef.current('out');
        return;
      }
      if (!isCommandShortcut && event.key === ',') {
        event.preventDefault();
        performThreePointEditRef.current('insert');
        return;
      }
      if (!isCommandShortcut && event.key === '.') {
        event.preventDefault();
        performThreePointEditRef.current('overwrite');
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'q') {
        event.preventDefault();
        performTrimEditRef.current('ripple-in');
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'w') {
        event.preventDefault();
        performTrimEditRef.current('ripple-out');
        return;
      }
      if (!isCommandShortcut && shortcutKey === 'e') {
        event.preventDefault();
        performTrimEditRef.current('roll');
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedStageObjectId && activeComposition) {
          event.preventDefault();
          commitActiveCompositionPatch({
            editorStageObjects: stageObjects.filter((object) => object.id !== selectedStageObjectId),
          }, 'Remove stage object');
          setSelectedStageObjectId(undefined);
          return;
        }

        const selectedTimelineIds = new Set([...selectedVisualClipIds, ...selectedAudioClipIds].slice(0, 2_000));
        if (selectedTimelineIds.size > 0 && activeComposition) {
          event.preventDefault();
          const hasLockedSelection = visualClips.some((clip) => selectedTimelineIds.has(clip.id) && isVisualTrackLocked(clip.trackIndex))
            || audioClips.some((clip) => selectedTimelineIds.has(clip.id) && isAudioTrackLocked(clip.trackIndex));
          if (hasLockedSelection) return;
          commitActiveCompositionPatch(
            buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, selectedTimelineIds),
            `Remove ${selectedTimelineIds.size} selected timeline clip${selectedTimelineIds.size === 1 ? '' : 's'}`,
          );
          clearTimelineSelection();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    activeComposition,
    audioClips,
    commitActiveCompositionPatch,
    patchNodeData,
    redoEditor,
    selectedAudioClipIds,
    selectedAudioClipId,
    selectedStageObjectId,
    selectedVisualClipIds,
    setSelectedAudioClipId,
    setTimelineToolWithActivity,
    setSelectedVisualClipId,
    stageObjects,
    selectedVisualClipId,
    timelineMarkers,
    undoEditor,
    visualClips,
  ]);

  useEffect(() => {
    const candidates = new Map<string, SourceBinItem>();
    const addCandidate = (item: SourceBinItem | undefined) => {
      if (item) candidates.set(item.id, item);
    };

    for (const item of mediaSourceItemsByPool.image.slice(0, sourceBinVisibleItemLimits.image)) addCandidate(item);
    for (const item of mediaSourceItemsByPool.video.slice(0, sourceBinVisibleItemLimits.video)) addCandidate(item);
    for (const item of mediaSourceItemsByPool.audio.slice(0, sourceBinVisibleItemLimits.audio)) addCandidate(item);
    for (const clip of visualClips) addCandidate(sourceItemByNodeId.get(clip.sourceNodeId));
    for (const clip of audioClips) addCandidate(sourceItemByNodeId.get(clip.sourceNodeId));
    addCandidate(selectedSourceItemId ? sourceItemByNodeId.get(selectedSourceItemId) : undefined);

    const mediaRequests = [...candidates.values()].flatMap((item) => {
      if (item.kind !== 'image' && item.kind !== 'video' && item.kind !== 'audio' && item.kind !== 'composition') return [];
      const signature = `${item.assetUrl ?? ''}|${item.nativeFilePath ?? ''}|${item.mimeType ?? ''}`;
      const requestKey = `${item.id}|${signature}`;
      if (sourceMediaInfoSignatureRef.current[item.id] === signature || sourceMediaInfoInFlightRef.current.has(requestKey)) return [];
      sourceMediaInfoInFlightRef.current.add(requestKey);
      return [{ item, requestKey, signature }];
    });

    if (mediaRequests.length === 0) {
      return;
    }

    void mapWithConcurrency(
      mediaRequests,
      MEDIA_METADATA_CONCURRENCY,
      async ({ item, requestKey, signature }) => ({
        id: item.id,
        info: await getSourceMediaInfo(item),
        requestKey,
        signature,
      }),
    ).then((entries) => {
      if (!workspaceMountedRef.current) {
        return;
      }

      for (const entry of entries) sourceMediaInfoSignatureRef.current[entry.id] = entry.signature;

      setMediaInfoMap((current) => {
        const next = { ...current };
        let changed = false;

        for (const { id, info } of entries) {
          if (!areMediaInfosEqual(current[id], info)) {
            next[id] = info;
            changed = true;
          }
        }

        return changed ? next : current;
      });
    }).finally(() => {
      for (const request of mediaRequests) sourceMediaInfoInFlightRef.current.delete(request.requestKey);
    });

  }, [
    audioClips,
    mediaSourceItemsByPool,
    selectedSourceItemId,
    sourceBinVisibleItemLimits,
    sourceItemByNodeId,
    visualClips,
  ]);

  const durationMap = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(mediaInfoMap).map(([id, info]) => [id, info.durationSeconds ?? 0]),
      ),
    [mediaInfoMap],
  );
  const professionalWorkflowTrackState = useMemo<VideoWorkflowTrackState>(() => {
    const armedVideoTrackIndexes = [...new Set(
      visualClips.filter((clip) => selectedVisualClipIdSet.has(clip.id)).map((clip) => clip.trackIndex),
    )];
    const armedAudioTrackIndexes = [...new Set(
      audioClips.filter((clip) => selectedAudioClipIdSet.has(clip.id)).map((clip) => clip.trackIndex),
    )];
    return {
      videoTrackCount: visualTrackCount,
      audioTrackCount,
      lockedVideoTrackIndexes: lockedVisualTracks,
      lockedAudioTrackIndexes: lockedAudioTracks,
      syncLockedVideoTrackIndexes: professionalWorkflowState.editorial.syncLockedTrackIds.flatMap((trackId) => {
        const index = parseProfessionalTrackIndex(trackId, 'video', visualTrackCount);
        return index === undefined ? [] : [index];
      }),
      syncLockedAudioTrackIndexes: professionalWorkflowState.editorial.syncLockedTrackIds.flatMap((trackId) => {
        const index = parseProfessionalTrackIndex(trackId, 'audio', audioTrackCount);
        return index === undefined ? [] : [index];
      }),
      armedVideoTrackIndexes: armedVideoTrackIndexes.length ? armedVideoTrackIndexes : [0],
      armedAudioTrackIndexes: armedAudioTrackIndexes.length ? armedAudioTrackIndexes : [],
    };
  }, [
    audioClips,
    audioTrackCount,
    lockedAudioTracks,
    lockedVisualTracks,
    professionalWorkflowState.editorial.syncLockedTrackIds,
    selectedAudioClipIdSet,
    selectedVisualClipIdSet,
    visualClips,
    visualTrackCount,
  ]);
  const professionalFallbackDurationBySourceNodeId = useMemo(() => {
    const durations = new Map<string, number>();
    for (const clip of visualClips) {
      const durationMs = clip.sourceOutMs
        ?? clip.sourceInMs + Math.max(1_000, (clip.durationSeconds ?? 1) * 1_000 * clip.playbackRate);
      durations.set(clip.sourceNodeId, Math.max(durations.get(clip.sourceNodeId) ?? 0, durationMs));
    }
    for (const clip of audioClips) {
      const durationMs = clip.sourceOutMs ?? (clip.sourceInMs ?? 0) + 1_000;
      durations.set(clip.sourceNodeId, Math.max(durations.get(clip.sourceNodeId) ?? 0, durationMs));
    }
    return durations;
  }, [audioClips, visualClips]);
  const professionalSourceDurationMs = useCallback((source: SourceBinItem | undefined, sourceNodeId: string) => {
    const seconds = getSourceItemDurationSeconds(source, durationMap);
    if (seconds && seconds > 0) return seconds * 1_000;
    return Math.max(professionalFallbackDurationBySourceNodeId.get(sourceNodeId) ?? 0, 1_000);
  }, [durationMap, professionalFallbackDurationBySourceNodeId]);

  const visualBlocks = useMemo(
    () => buildVisualTimelineBlocks(visualClips, sourceItemByNodeId, durationMap),
    [durationMap, sourceItemByNodeId, visualClips],
  );
  const visualBlocksByTrack = useMemo(
    () => groupTimelineBlocksByTrack(visualBlocks, visualTrackCount),
    [visualBlocks, visualTrackCount],
  );
  const buildCurrentRenderDirtyPlan = useCallback((previousSegmentSignatures: Record<string, string>) => buildVideoRenderDirtyPlan({
    clips: visualBlocks.map((block) => ({
      id: block.clip.id,
      trackIndex: block.clip.trackIndex,
      startMs: Math.round(block.startSeconds * 1000),
      durationMs: Math.round(block.durationSeconds * 1000),
      signature: buildVideoRenderClipSignature({
        ...block.clip,
        durationMs: Math.round(block.durationSeconds * 1000),
        sourceSignature: block.item?.assetUrl ?? block.item?.id,
      }),
    })),
    previousSegmentSignatures,
  }), [visualBlocks]);
  const visualGapsByTrack = useMemo(
    () =>
      Array.from({ length: visualTrackCount }, (_, trackIndex) =>
        findTimelineGaps(
          visualBlocksByTrack[trackIndex].map((block) => ({
            id: block.clip.id,
            trackIndex: block.clip.trackIndex,
            startSeconds: block.startSeconds,
            endSeconds: block.endSeconds,
          })),
          trackIndex,
        ),
      ),
    [visualBlocksByTrack, visualTrackCount],
  );
  const audioBlocks = useMemo(
    () => buildAudioTimelineBlocks(audioClips, sourceItemByNodeId, durationMap),
    [audioClips, durationMap, sourceItemByNodeId],
  );
  const audioBlocksByTrack = useMemo(
    () => groupTimelineBlocksByTrack(audioBlocks, audioTrackCount),
    [audioBlocks, audioTrackCount],
  );
  const programAudioPlaybackPlan = useMemo(
    () => buildProgramAudioPlaybackPlan({
      audioBlocks,
      playheadSeconds: timelineCursorSeconds,
      trackVolumes: audioTrackVolumes,
      mutedTracks: mutedAudioTracks,
      soloTracks: soloAudioTracks,
      audioMixerBuses: activeComposition?.data.editorProfessionalState?.audioBuses,
    }),
    [activeComposition?.data.editorProfessionalState?.audioBuses, audioBlocks, audioTrackVolumes, mutedAudioTracks, soloAudioTracks, timelineCursorSeconds],
  );
  const programAudioPlaybackItems = programAudioPlaybackPlan.items;
  const sourceItemById = useMemo(
    () => new Map(sourceItems.map((item) => [item.id, item])),
    [sourceItems],
  );
  const selectedSourceItem = selectedSourceItemId ? sourceItemById.get(selectedSourceItemId) : undefined;
  const selectedVisualClip = useMemo(
    () => selectedVisualClipId
      ? visualClips.find((clip) => clip.id === selectedVisualClipId)
      : undefined,
    [selectedVisualClipId, visualClips],
  );
  const selectedAudioClip = selectedAudioClipId
    ? audioClips.find((clip) => clip.id === selectedAudioClipId)
    : undefined;
  const selectedAudioProcessingSignature = JSON.stringify(selectedAudioClip?.audioProcessing ?? null);

  useEffect(() => {
    const session = dialogueAuditionSessionRef.current;
    dialogueAuditionGenerationRef.current += 1;
    dialogueAuditionAbortRef.current?.abort();
    dialogueAuditionAbortRef.current = undefined;
    if (!session) return;
    session.stop();
    dialogueAuditionSessionRef.current = undefined;
    setDialogueAuditionState((current) => ({
      ...current,
      clipId: selectedAudioClipId,
      busy: false,
      playing: false,
      summary: undefined,
      message: 'Audition stopped because the selected clip or its processor settings changed.',
    }));
  }, [selectedAudioClipId, selectedAudioProcessingSignature]);
  const selectedStageObject = selectedStageObjectId
    ? stageObjects.find((object) => object.id === selectedStageObjectId)
    : undefined;

  useEffect(() => {
    const activeClipIds = visualClips.map((clip) => clip.id);
    const activeClipIdSet = new Set(activeClipIds);

    for (const clipId of Object.keys(clipPreviewSignatureRef.current)) {
      if (!activeClipIdSet.has(clipId)) {
        delete clipPreviewSignatureRef.current[clipId];
      }
    }

    const pruneTimer = window.setTimeout(() => {
      setClipEdgePreviewMap((current) =>
        pruneTimelinePreviewMap(current, activeClipIds, TIMELINE_PREVIEW_MAX_CLIPS),
      );
    }, 0);

    return () => window.clearTimeout(pruneTimer);
  }, [visualClips]);

  useEffect(() => {
    let cancelled = false;
    const previewTimer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }

      const candidateClips = visualClips.slice(-TIMELINE_PREVIEW_MAX_CLIPS);
      const previewRequests = takePendingTimelinePreviewRequests(candidateClips.flatMap((clip) => {
        const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
        const signature = buildClipPreviewSignature(clip, sourceItem, durationMap);

        if (!sourceItem) {
          return [];
        }

        return [{
          clipId: clip.id,
          signature,
          payload: {
            clip,
            sourceItem,
          },
        }];
      }), clipPreviewSignatureRef.current);

      if (previewRequests.length === 0) {
        return;
      }

      void mapWithConcurrency(
        previewRequests,
        TIMELINE_PREVIEW_CONCURRENCY,
        async ({ clipId, signature, payload }) => ({
          clipId,
          signature,
          preview: await buildTimelineClipEdgePreview(payload.clip, payload.sourceItem, durationMap).catch(() => undefined),
        }),
      ).then((results) => {
        if (cancelled) {
          return;
        }

        setClipEdgePreviewMap((current) =>
          mergeTimelinePreviewResults(
            current,
            results,
            visualClips.map((clip) => clip.id),
            TIMELINE_PREVIEW_MAX_CLIPS,
          ),
        );
      });
    }, TIMELINE_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(previewTimer);
    };
  }, [durationMap, sourceItemByNodeId, visualClips]);

  useEffect(() => {
    const activeClipIds = audioClips.map((clip) => clip.id);
    const activeClipIdSet = new Set(activeClipIds);

    for (const clipId of Object.keys(audioWaveformSignatureRef.current)) {
      if (!activeClipIdSet.has(clipId)) {
        delete audioWaveformSignatureRef.current[clipId];
      }
    }

    const pruneTimer = window.setTimeout(() => {
      setAudioWaveformMap((current) => pruneTimelineWaveformMap(current, activeClipIds));
    }, 0);

    return () => window.clearTimeout(pruneTimer);
  }, [audioClips]);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: number | undefined;
    const fallbackClipIds: string[] = [];
    const waveformRequests = takePendingTimelineWaveformRequests(audioClips.map((clip) => {
      const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
      const sourceDurationSeconds = getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0;
      const sourceRange = resolveEditorAudioSourceRangeMs(clip, sourceDurationSeconds);
      const signature = buildAudioWaveformSignature(sourceItem, clip, sourceDurationSeconds);

      if (sourceItem && sourceItem.kind !== 'audio') {
        fallbackClipIds.push(clip.id);
      }

      return {
        clipId: clip.id,
        signature,
        sourceUrl: sourceItem?.kind === 'audio' ? sourceItem.assetUrl : undefined,
        sourceInMs: sourceRange.sourceInMs,
        sourceOutMs: sourceRange.sourceOutMs,
      };
    }), audioWaveformSignatureRef.current);

    if (fallbackClipIds.length > 0) {
      fallbackTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        setAudioWaveformMap((current) => {
          let changed = false;
          const next = { ...current };

          for (const clipId of fallbackClipIds) {
            if (next[clipId] !== TIMELINE_UNAVAILABLE_WAVEFORM_PEAKS) {
              next[clipId] = TIMELINE_UNAVAILABLE_WAVEFORM_PEAKS;
              changed = true;
            }
          }

          return changed ? next : current;
        });
      }, 0);
    }

    if (waveformRequests.length === 0) {
      return () => {
        cancelled = true;

        if (fallbackTimer !== undefined) {
          window.clearTimeout(fallbackTimer);
        }
      };
    }

    void mapWithConcurrency(
      waveformRequests,
      TIMELINE_WAVEFORM_CONCURRENCY,
      async ({ clipIds, sourceUrl, signature, sourceInMs, sourceOutMs }) => ({
        clipIds,
        signature,
        peaks: await extractWaveformPeaks(sourceUrl, TIMELINE_WAVEFORM_SAMPLE_COUNT, { sourceInMs, sourceOutMs }),
      }),
    ).then((results) => {
      if (cancelled) {
        return;
      }

      if (results.length === 0) {
        return;
      }

      setAudioWaveformMap((current) => {
        const next = { ...current };

        for (const entry of results) {
          for (const clipId of entry.clipIds) {
            next[clipId] = entry.peaks;
          }
        }

        return next;
      });
    });

    return () => {
      cancelled = true;

      if (fallbackTimer !== undefined) {
        window.clearTimeout(fallbackTimer);
      }
    };
  }, [audioClips, durationMap, sourceItemByNodeId]);
  const sequenceDurationSeconds = getTimelineDurationSeconds(visualBlocks, audioBlocks);
  const displayTimelineSeconds = Math.max(
    Number(activeComposition?.data.compositionTimelineSeconds ?? 10),
    Math.ceil(sequenceDurationSeconds),
    1,
  );
  const timelineRulerTicks = useMemo(
    () => buildTimelineRulerTicks(displayTimelineSeconds, timelineZoomPercent),
    [displayTimelineSeconds, timelineZoomPercent],
  );
  const timelineMaxZoomPercent = getTimelineMaxZoomPercent(displayTimelineSeconds);
  const timelineContentWidthPercent = clampTimelineZoomPercent(timelineZoomPercent, displayTimelineSeconds);
  const longFormSequence = isLongFormSequence(sequenceDurationSeconds);
  const linkedMediaItemCount = useMemo(
    () => libraryItems.filter((item) => (
      (item.kind === 'video' || item.kind === 'audio')
      && Boolean(item.nativeFilePath)
      && !item.scratchFileName
    )).length,
    [libraryItems],
  );
  const updateTimelineViewportRange = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      setTimelineViewportRange(undefined);
      return;
    }
    const nextRange = resolveTimelineViewportRange({
      clientWidth: element.clientWidth,
      durationSeconds: displayTimelineSeconds,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    });
    setTimelineViewportRange((current) => (
      current
      && Math.abs(current.startSeconds - nextRange.startSeconds) < 0.05
      && Math.abs(current.endSeconds - nextRange.endSeconds) < 0.05
        ? current
        : nextRange
    ));
  }, [displayTimelineSeconds]);

  useEffect(() => {
    updateTimelineViewportRange(timelineScrollRef.current);
  }, [timelineContentWidthPercent, updateTimelineViewportRange]);

  useEffect(() => {
    setTimelineZoomPercent((current) => Math.min(current, timelineMaxZoomPercent));
  }, [timelineMaxZoomPercent]);

  useEffect(() => {
    if (!activeComposition || stageObjects.length === 0) {
      return;
    }

    const migrated = migrateStageObjectsToEditorAssets(stageObjects, {
      durationSeconds: Math.max(4, sequenceDurationSeconds || 4),
      trackIndex: 0,
    });

    queueMicrotask(() => {
      commitActiveCompositionPatch({
        editorAssets: [...compositionEditorAssets, ...migrated.assets],
        editorVisualClips: [...visualClips, ...migrated.clips],
        editorStageObjects: [],
      }, 'Migrate stage objects to editor assets');
      setSelectedStageObjectId(undefined);
    });
  }, [
    activeComposition,
    compositionEditorAssets,
    commitActiveCompositionPatch,
    sequenceDurationSeconds,
    stageObjects,
    visualClips,
  ]);

  useEffect(() => {
    displayTimelineSecondsRef.current = displayTimelineSeconds;
  }, [displayTimelineSeconds]);
  const previewUrl = resultValueAsMediaUrl(activeComposition?.data.result);
  const previewOutputMetadata = activeComposition?.data.resultOutputMetadata;
  const isProgramImageSequenceOutput = activeComposition?.data.resultMimeType === 'application/zip' &&
    Boolean(previewOutputMetadata && 'imageSequence' in previewOutputMetadata);
  const selectedVisualSourceItem = selectedVisualClip
    ? sourceItemByNodeId.get(selectedVisualClip.sourceNodeId)
    : undefined;
  const selectedVisualEditorAsset = selectedVisualClip
    ? editorAssetById.get(selectedVisualClip.sourceNodeId)
    : undefined;
  const selectedVisualBackingImageItem =
    selectedVisualSourceItem?.kind === 'image'
      ? selectedVisualSourceItem
      : selectedVisualEditorAsset?.kind === 'image' && selectedVisualEditorAsset.imageSourceId
        ? sourceItemByNodeId.get(selectedVisualEditorAsset.imageSourceId)
        : undefined;
  const selectedVisualSourceDurationSeconds = getSourceItemDurationSeconds(selectedVisualSourceItem, durationMap);
  const selectedVisualDurationSeconds = selectedVisualClip
    ? resolveVisualClipDuration(selectedVisualClip, sourceItemByNodeId, durationMap)
    : undefined;
  const selectedAudioDurationSeconds = selectedAudioClip
    ? audioBlocks.find((block) => block.clip.id === selectedAudioClip.id)?.durationSeconds
    : undefined;
  const selectedAudioSourceItem = selectedAudioClip
    ? sourceItemByNodeId.get(selectedAudioClip.sourceNodeId)
    : undefined;
  const selectedAudioSourceDurationSeconds = getSourceItemDurationSeconds(selectedAudioSourceItem, durationMap);
  const canKeyframeSelectedClip = Boolean(selectedVisualClip || selectedAudioClip);
  const compositionAspectRatio = normalizeAspectRatio(activeComposition?.data.aspectRatio);
  const compositionResolution = normalizeVideoResolution(activeComposition?.data.videoResolution);
  const compositionFrameRate = normalizeVideoFrameRate(activeComposition?.data.videoFrameRate);
  const professionalTrimSummary = useMemo<ProfessionalTrimSessionSummary | undefined>(() => professionalTrimPreview ? ({
    kind: professionalTrimPreview.session.mode,
    description: professionalTrimPreview.description,
    deltaFrames: Math.round((professionalTrimPreview.session.trim.appliedDeltaMs * compositionFrameRate) / 1_000),
  }) : undefined, [compositionFrameRate, professionalTrimPreview]);
  const programCanvas = getVideoCanvasDimensions(compositionAspectRatio, compositionResolution);
  const exportPresetPlan = useMemo(
    () => normalizeVideoExportPresetPlan(activeComposition?.data.editorExportPresetPlan),
    [activeComposition?.data.editorExportPresetPlan],
  );
  const currentCompositionRenderCacheSignature = useMemo(
    () => buildVideoCompositionRenderCacheSignature({
      aspectRatio: compositionAspectRatio,
      videoResolution: compositionResolution,
      frameRate: compositionFrameRate,
      timelineDurationSeconds: sequenceDurationSeconds,
      exportPresetPlan,
      visualClips,
      audioClips,
      editorMutedAudioTracks: mutedAudioTracks,
      editorSoloAudioTracks: soloAudioTracks,
      editorAudioTrackVolumes: audioTrackVolumes,
      sourceMedia: activeCompositionSourceMedia,
      stageObjects,
      professionalState: activeComposition?.data.editorProfessionalState,
      professionalWorkflowState: activeComposition?.data.editorProfessionalWorkflowState,
    }),
    [
      activeComposition?.data.editorProfessionalState,
      activeComposition?.data.editorProfessionalWorkflowState,
      activeCompositionSourceMedia,
      audioClips,
      audioTrackVolumes,
      compositionAspectRatio,
      compositionFrameRate,
      compositionResolution,
      exportPresetPlan,
      mutedAudioTracks,
      sequenceDurationSeconds,
      soloAudioTracks,
      stageObjects,
      visualClips,
    ],
  );
  const richTimelineMarkers = useMemo<VideoRichMarker[]>(
    () => timelineMarkers.map(timelineMarkerToVideoRichMarker),
    [timelineMarkers],
  );
  const markerNativeSyncReadiness = useMemo(
    () => activeComposition
      ? describeVideoTimelineCompositionSyncReadiness(activeComposition, hydratedFlowWorkspaceId)
      : undefined,
    [activeComposition, hydratedFlowWorkspaceId],
  );
  const timelineSearchState = useMemo(() => {
    const clips = [
      ...visualBlocks.map((block) => {
        const source = block.item ?? sourceItemByNodeId.get(block.clip.sourceNodeId);
        return {
          id: block.clip.id,
          label: visualBlockLabel(block.clip, source?.label),
          sequenceId: activeComposition?.id ?? 'no-composition',
          sourceItemId: source?.id ?? block.clip.sourceNodeId,
          trackId: block.clip.professional?.trackId ?? `video:${block.clip.trackIndex}`,
          startMs: Math.round(block.startSeconds * 1_000),
          endMs: Math.round(block.endSeconds * 1_000),
          tags: source?.professional?.tags,
          effectNames: block.clip.filterStack?.map((effect) => effect.kind),
          onlineState: source?.professional?.onlineState,
          proxyState: source?.professional?.proxy?.status,
        };
      }),
      ...audioBlocks.map((block) => {
        const source = block.item ?? sourceItemByNodeId.get(block.clip.sourceNodeId);
        return {
          id: block.clip.id,
          label: source?.label ?? block.clip.sourceNodeId,
          sequenceId: activeComposition?.id ?? 'no-composition',
          sourceItemId: source?.id ?? block.clip.sourceNodeId,
          trackId: block.clip.professional?.trackId ?? `audio:${block.clip.trackIndex}`,
          startMs: Math.round(block.startSeconds * 1_000),
          endMs: Math.round(block.endSeconds * 1_000),
          tags: source?.professional?.tags,
          onlineState: source?.professional?.onlineState,
          proxyState: source?.professional?.proxy?.status,
        };
      }),
    ];
    const construction = buildVideoTimelineSearchDocumentsWithReport({
      clips,
      logging: professionalMediaLogging.records,
      captions: professionalWorkflowState.captionTracks.flatMap((track) => track.cues.map((cue) => ({
        id: cue.id,
        trackId: track.id,
        sequenceId: activeComposition?.id ?? 'no-composition',
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        speaker: cue.speaker,
        language: track.language,
      }))),
      transcripts: timelineSourceItems.flatMap((item) => (item.professional?.transcript?.cues ?? []).map((cue) => ({
        id: cue.id,
        sourceItemId: item.id,
        text: cue.text,
        startMs: cue.startMs,
        endMs: cue.endMs,
        speaker: cue.speaker,
        language: item.professional?.transcript?.language,
      }))),
      markers: richTimelineMarkers,
      sequenceIdForMarkers: activeComposition?.id,
    });
    const index = updateVideoTimelineSearchShard(createVideoTimelineSearchIndex(), {
      shardId: activeComposition?.id ?? 'no-composition',
      revision: currentCompositionRenderCacheSignature,
      documents: construction.documents,
    });
    return { index, constructionReport: construction.report };
  }, [activeComposition?.id, audioBlocks, currentCompositionRenderCacheSignature, professionalMediaLogging.records, professionalWorkflowState.captionTracks, richTimelineMarkers, sourceItemByNodeId, timelineSourceItems, visualBlocks]);
  const timelineSearchIndex = timelineSearchState.index;
  const timelineSearchTruncationNotice = timelineSearchState.constructionReport.truncated || timelineSearchIndex.lastUpdateReport?.truncated
    ? `Search indexed ${timelineSearchIndex.documentCount.toLocaleString()} items; ${Math.max(timelineSearchState.constructionReport.droppedDocumentCount, timelineSearchIndex.lastUpdateReport?.droppedDocumentCount ?? 0).toLocaleString()} over-limit or invalid items were omitted deterministically.`
    : undefined;
  const timelineNavigationResult = useMemo(() => {
    const durationMs = Math.max(1_000, Math.round(displayTimelineSeconds * 1_000));
    const trackCount = visualTrackCount + audioTrackCount;
    const storedView = professionalWorkflowState.editorial.sequenceViewStates.find((view) => view.sequenceId === activeComposition?.id);
    const clips = [
      ...visualBlocks.map((block) => ({ id: block.clip.id, trackIndex: block.clip.trackIndex, startMs: Math.round(block.startSeconds * 1_000), durationMs: Math.max(1, Math.round(block.durationSeconds * 1_000)), kind: 'video' as const })),
      ...audioBlocks.map((block) => ({ id: block.clip.id, trackIndex: visualTrackCount + block.clip.trackIndex, startMs: Math.round(block.startSeconds * 1_000), durationMs: Math.max(1, Math.round(block.durationSeconds * 1_000)), kind: 'audio' as const, enabled: block.clip.enabled })),
    ];
    const result = buildVideoTimelineNavigationModel({
      durationMs,
      trackCount,
      clips,
      viewport: timelineViewportRange ? { startMs: timelineViewportRange.startSeconds * 1_000, endMs: timelineViewportRange.endSeconds * 1_000 } : undefined,
      workArea: storedView?.workArea ? { startMs: storedView.workArea.inMs, endMs: storedView.workArea.outMs } : undefined,
      bucketCount: 512,
    });
    return result;
  }, [activeComposition?.id, audioBlocks, audioTrackCount, displayTimelineSeconds, professionalWorkflowState.editorial.sequenceViewStates, timelineViewportRange, visualBlocks, visualTrackCount]);
  const timelineNavigationModel = timelineNavigationResult.ok ? timelineNavigationResult.model : undefined;
  const timelineNavigationUnavailableReason = timelineNavigationResult.ok
    ? undefined
    : `Timeline overview unavailable: ${timelineNavigationResult.reason.replaceAll('-', ' ')}. The editor keeps the full timeline intact.`;
  const projectSequenceBins = useMemo(() => {
    const stored = compositionNodes
      .map((node) => sanitizeEditorProfessionalWorkflowState(node.data.editorProfessionalWorkflowState).editorial.sequenceBins)
      .find((bins) => bins.length > 0);
    return stored ?? professionalWorkflowState.editorial.sequenceBins;
  }, [compositionNodes, professionalWorkflowState.editorial.sequenceBins]);
  const sequenceNavigatorModel = useMemo<VideoSequenceNavigatorModel>(() => {
    const bins = projectSequenceBins.map((bin, order) => ({ id: bin.id, name: bin.name, order, collapsed: collapsedSequenceBinIds.includes(bin.id) }));
    const binBySequenceId = new Map(projectSequenceBins.flatMap((bin) => bin.sequenceIds.map((sequenceId) => [sequenceId, bin.id])));
    const sequences = compositionNodes.slice(0, 128).map((node) => ({
      id: node.id,
      name: typeof node.data.customTitle === 'string' && node.data.customTitle.trim() ? node.data.customTitle.trim() : 'Video Composition',
      ...(binBySequenceId.get(node.id) ? { binId: binBySequenceId.get(node.id) } : {}),
      durationMs: node.id === activeComposition?.id ? Math.round(sequenceDurationSeconds * 1_000) : Math.max(0, Math.round(Number(node.data.compositionTimelineSeconds ?? 0) * 1_000)),
      frameRate: normalizeVideoFrameRate(node.data.videoFrameRate),
      createdAt: 0,
      updatedAt: 0,
      nestedSequenceIds: getEditorVisualClips(node.data)
        .filter((clip) => clip.sourceKind === 'composition')
        .map((clip) => clip.sourceNodeId),
    }));
    const availableIds = new Set(sequences.map((sequence) => sequence.id));
    const tabs = sequenceNavigatorTabs.filter((tab) => availableIds.has(tab.sequenceId)).slice(0, 32);
    const viewStateBySequenceId = Object.fromEntries(compositionNodes.slice(0, 128).map((node) => {
      const stored = sanitizeEditorProfessionalWorkflowState(node.data.editorProfessionalWorkflowState)
        .editorial.sequenceViewStates.find((view) => view.sequenceId === node.id);
      const zoomPxPerSecond = Math.max(1, 80 * ((stored?.zoomPercent ?? (node.id === activeComposition?.id ? timelineZoomPercent : 100)) / 100));
      return [node.id, {
        playheadMs: node.id === activeComposition?.id ? Math.round(timelineCursorSeconds * 1_000) : 0,
        scrollLeftMs: Math.max(0, ((stored?.scrollLeftPx ?? 0) / zoomPxPerSecond) * 1_000),
        verticalScrollPx: 0,
        zoomPxPerSecond,
        selectedClipIds: node.id === activeComposition?.id
          ? [...selectedVisualClipIds, ...selectedAudioClipIds].slice(0, 2_000)
          : [],
      }];
    }));
    return normalizeVideoSequenceNavigatorModel({
      version: 1,
      bins,
      sequences,
      tabs,
      ...(activeComposition?.id ? { activeSequenceId: activeComposition.id } : {}),
      viewStateBySequenceId,
      dependencies: [],
    });
  }, [activeComposition?.id, collapsedSequenceBinIds, compositionNodes, projectSequenceBins, selectedAudioClipIds, selectedVisualClipIds, sequenceDurationSeconds, sequenceNavigatorTabs, timelineCursorSeconds, timelineZoomPercent]);
  const editableTranscriptSourceItem = useMemo(
    () => selectedSourceItem?.professional?.transcript
      ? selectedSourceItem
      : timelineSourceItems.find((item) => item.professional?.transcript),
    [selectedSourceItem, timelineSourceItems],
  );
  const editableTranscriptWords = useMemo<EditableTranscriptWord[]>(() => {
    const transcript = editableTranscriptSourceItem?.professional?.transcript;
    return (transcript?.cues ?? []).flatMap((cue) => {
      const tokens = cue.text.trim().split(/\s+/).filter(Boolean);
      const span = Math.max(1, cue.endMs - cue.startMs);
      return tokens.map((text, index) => ({
        id: `${cue.id}:word:${index}`,
        text,
        startMs: cue.startMs + (span * index) / tokens.length,
        endMs: cue.startMs + (span * (index + 1)) / tokens.length,
        ...(cue.speaker ? { speakerId: cue.speaker } : {}),
      }));
    });
  }, [editableTranscriptSourceItem?.professional?.transcript]);
  const parameterKeyframeTracks = useMemo<VideoParamKeyframeTrack[]>(() => {
    const stored = selectedVisualClip?.professional?.parameterKeyframes ?? selectedAudioClip?.professional?.parameterKeyframes ?? [];
    const storedByParameter = new Map(stored.map((track) => [track.parameter, track]));
    const supportedParameters = selectedVisualClip
      ? ['opacity', 'scale', 'rotation', 'position-x', 'position-y']
      : selectedAudioClip
        ? ['volume']
        : [];
    const sourceTracks = supportedParameters.map((parameter) => storedByParameter.get(parameter) ?? {
      id: parameter,
      parameter,
      keyframes: [],
    });
    return sourceTracks.map((track) => ({
      version: 1,
      id: track.id,
      parameterId: track.parameter,
      label: track.parameter,
      defaultValue: track.parameter === 'volume' ? (selectedAudioClip?.volumePercent ?? 100)
        : track.parameter === 'opacity' ? (selectedVisualClip?.opacityPercent ?? 100)
          : track.parameter === 'scale' ? (selectedVisualClip?.scalePercent ?? 100)
            : track.parameter === 'rotation' ? (selectedVisualClip?.rotationDeg ?? 0)
              : track.parameter === 'position-x' ? (selectedVisualClip?.positionX ?? 0)
                : track.parameter === 'position-y' ? (selectedVisualClip?.positionY ?? 0)
                  : 0,
      minValue: track.parameter === 'opacity' || track.parameter === 'volume' ? 0 : track.parameter === 'scale' ? 1 : undefined,
      maxValue: track.parameter === 'opacity' ? 100 : undefined,
      keyframes: track.keyframes.map((keyframe) => ({
        id: keyframe.id,
        timeMs: keyframe.timeMs,
        value: keyframe.value,
        interpolation: keyframe.interpolation === 'bezier' ? 'cubic-bezier' : keyframe.interpolation,
        bezier: keyframe.bezier ? { x1: keyframe.bezier.outX, y1: keyframe.bezier.outY, x2: keyframe.bezier.inX, y2: keyframe.bezier.inY } : undefined,
      })),
    }));
  }, [selectedAudioClip, selectedVisualClip]);
  const videoClipboardTracks = useMemo<VideoClipboardTrack[]>(() => [
    ...Array.from({ length: visualTrackCount }, (_, order) => ({ id: `video:${order}`, kind: 'video' as const, order, locked: isVisualTrackLocked(order) })),
    ...Array.from({ length: audioTrackCount }, (_, order) => ({ id: `audio:${order}`, kind: 'audio' as const, order, locked: isAudioTrackLocked(order) })),
  ], [audioTrackCount, lockedAudioTracks, lockedVisualTracks, visualTrackCount]);
  const videoClipboardClips = useMemo<VideoClipboardTimelineClip[]>(() => [
    ...visualBlocks.map((block) => createVideoClipboardVisualTimelineClip({
      clip: block.clip,
      trackId: `video:${block.clip.trackIndex}`,
      sourceItemId: block.clip.sourceNodeId,
      label: block.item?.label,
    })),
    ...audioBlocks.map((block) => createVideoClipboardAudioTimelineClip({
      clip: block.clip,
      trackId: `audio:${block.clip.trackIndex}`,
      sourceItemId: block.clip.sourceNodeId,
      durationMs: Math.max(1, Math.round(block.durationSeconds * 1_000)),
      label: block.item?.label,
    })),
  ], [audioBlocks, visualBlocks]);
  const videoSyncManagedClips = useMemo<VideoSyncManagedClip[]>(() => [
    ...visualClips.map((clip) => ({ id: clip.id, trackId: `video:${clip.trackIndex}`, startMs: clip.startMs, sourceInMs: clip.sourceInMs + clip.trimStartMs, linkGroupId: clip.professional?.linkGroupId, syncGroupId: clip.professional?.syncGroupId })),
    ...audioClips.map((clip) => ({ id: clip.id, trackId: `audio:${clip.trackIndex}`, startMs: clip.offsetMs, sourceInMs: clip.sourceInMs ?? 0, linkGroupId: clip.professional?.linkGroupId, syncGroupId: clip.professional?.syncGroupId })),
  ], [audioClips, visualClips]);
  useEffect(() => {
    setProfessionalStructuralQcReport(undefined);
    setProfessionalTrimPreview(undefined);
  }, [currentCompositionRenderCacheSignature]);
  const professionalReviewWorkflow = useMemo(
    () => buildProfessionalReviewWorkflow(
      activeComposition?.id ?? 'no-composition',
      currentCompositionRenderCacheSignature,
      professionalWorkflowState,
    ),
    [activeComposition?.id, currentCompositionRenderCacheSignature, professionalWorkflowState],
  );
  const professionalCaptionDocument = useMemo(
    () => buildProfessionalCaptionDocument(professionalWorkflowState),
    [professionalWorkflowState],
  );
  /**
   * Every render-queue write reads the persisted record fresh from the store, applies one bounded
   * transition, and writes it back. The runner and the user act on the same queue concurrently, so
   * a transition computed against a stale render's closure could otherwise resurrect a cancelled
   * job. These writes deliberately bypass the editor undo stack: queue progress is runtime truth,
   * not an authoring edit, and delivered work must never be undone back into pending work.
   */
  const mutateRenderQueue = useCallback((
    compositionId: string,
    transition: (records: readonly VideoRenderQueueRecord[]) => VideoRenderQueueTransition,
  ): VideoRenderQueueTransition | undefined => {
    const node = useFlowStore.getState().nodes.find((candidate) => (
      candidate.id === compositionId && candidate.type === 'composition'
    ));
    if (!node) return undefined;
    const state = sanitizeEditorProfessionalWorkflowState(node.data.editorProfessionalWorkflowState);
    const result = transition(state.deliveryJobs);
    if (!result.changed) return result;
    patchNodeData(compositionId, {
      editorProfessionalWorkflowState: { ...state, deliveryJobs: result.records },
    });
    return result;
  }, [patchNodeData]);
  const professionalHistoryEntries = useMemo<ProfessionalWorkflowHistoryEntry[]>(
    () => editorHistory.undoStack.map((entry, index) => ({
      id: `undo:${index}`,
      label: entry.label,
      current: index === editorHistory.undoStack.length - 1,
    })),
    [editorHistory.undoStack],
  );
  const sequenceSummary = buildVideoSequenceSummary(
    compositionAspectRatio,
    compositionResolution,
    programCanvas,
    sequenceDurationSeconds,
    compositionFrameRate,
  );
  const parityDiagnostics = useMemo(
    () => buildVideoParityDiagnostics({ visualClips, stageObjects }),
    [stageObjects, visualClips],
  );
  const videoRuntime = useMemo(
    () => compileVideoRuntimeIr({
      visualClips,
      professionalState: activeComposition?.data.editorProfessionalState,
    }),
    [activeComposition?.data.editorProfessionalState, visualClips],
  );
  const runtimeVisualClips = useMemo(
    () => videoRuntime.ok ? videoRuntime.ir.visualClips : [],
    [videoRuntime],
  );
  const monitorParityNotices = [
    ...getVideoMonitorParityNotices({
      visualClips,
      stageObjects,
      exportPresetPlan,
    }),
    ...(videoRuntime.ok ? [] : [`Nested/adjustment monitor refused: ${videoRuntime.errors.join(' ')}`]),
  ];
  const multicamProjection = useMemo(
    () => projectExecutableMulticamClips(
      runtimeVisualClips,
      sanitizeEditorProfessionalVideoState(activeComposition?.data.editorProfessionalState),
      new Set([...sourceItemByNodeId.keys(), ...editorAssetById.keys()]),
      new Set([...sourceItemByNodeId.entries()].flatMap(([id, item]) => item.kind === 'video' || item.kind === 'composition' ? [id] : [])),
    ),
    [activeComposition?.data.editorProfessionalState, editorAssetById, runtimeVisualClips, sourceItemByNodeId],
  );
  const executableVisualClips = useMemo(
    () => videoRuntime.ok && multicamProjection.ok ? multicamProjection.clips : [],
    [multicamProjection, videoRuntime.ok],
  );
  const programStageClips = useMemo(
    () =>
      getProgramStageClips(
        executableVisualClips,
        sourceItemByNodeId,
        editorAssetById,
        durationMap,
        mediaInfoMap,
        timelineCursorSeconds,
      ),
    [durationMap, editorAssetById, executableVisualClips, mediaInfoMap, sourceItemByNodeId, timelineCursorSeconds],
  );
  const exportReadiness = useMemo(
    () => analyzeVideoExportReadiness({
      audioClips,
      availableSourceIds: sourceItemByNodeId.keys(),
      dirtySpanSummary: incrementalRenderSummary,
      hasComposition: Boolean(activeComposition),
      managedFontState: managedFontGate,
      stageObjectCount: stageObjects.length,
      visualClips,
    }).summary,
    [activeComposition, audioClips, incrementalRenderSummary, managedFontGate, sourceItemByNodeId, stageObjects.length, visualClips],
  );
  const renderBackendStatus = useMemo(
    () => summarizeVideoRenderBackend(renderBackendPreference),
    [renderBackendPreference],
  );

  const selectSourceItem = (itemId: string) => {
    clearTimelineSelection();
    setSelectedStageObjectId(undefined);
    setSelectedTimelineGap(null);
    setSelectedSourceItemId(itemId);
  };

  const openSourceBinPreview = (item: SourceBinItem) => {
    const previewKind = getSourceBinPreviewKind(item);

    if (!previewKind || !item.assetUrl) {
      selectSourceItem(item.id);
      return;
    }

    setSourceBinPreview({
      kind: previewKind,
      src: item.assetUrl,
      label: item.label,
    });
  };

  const selectVisualClip = (clip: EditorVisualClip, additive = false) => {
    if (additive) {
      const nextIds = selectedVisualClipIds.includes(clip.id)
        ? selectedVisualClipIds.filter((id) => id !== clip.id)
        : [...selectedVisualClipIds, clip.id].slice(-2_000);
      setSelectedVisualClipIds(nextIds, nextIds.includes(clip.id) ? clip.id : undefined);
      setSelectedAudioClipIds([]);
    } else {
      setSelectedVisualClipId(clip.id);
      setSelectedAudioClipId(undefined);
    }
    setSelectedStageObjectId(undefined);
    setSelectedTimelineGap(null);
    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    if (sourceItem) {
      setSelectedSourceItemId(sourceItem.id);
    }
  };

  const selectAudioClip = (clip: EditorAudioClip, additive = false) => {
    if (additive) {
      const nextIds = selectedAudioClipIds.includes(clip.id)
        ? selectedAudioClipIds.filter((id) => id !== clip.id)
        : [...selectedAudioClipIds, clip.id].slice(-2_000);
      setSelectedAudioClipIds(nextIds, nextIds.includes(clip.id) ? clip.id : undefined);
      setSelectedVisualClipIds([]);
    } else {
      setSelectedAudioClipId(clip.id);
      setSelectedVisualClipId(undefined);
    }
    setSelectedStageObjectId(undefined);
    setSelectedTimelineGap(null);
    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    if (sourceItem) {
      setSelectedSourceItemId(sourceItem.id);
    }
  };

  const selectStageObject = (objectId: string) => {
    clearTimelineSelection();
    setSelectedSourceItemId(undefined);
    setSelectedTimelineGap(null);
    setSelectedStageObjectId(objectId);
  };

  const addVisualClip = (item: SourceBinItem, trackIndex = 0) => {
    if (!activeComposition) {
      return;
    }

    if (!['image', 'video', 'composition', 'text'].includes(item.kind)) {
      return;
    }
    if (isVisualTrackLocked(trackIndex)) return;

    const nextClip = createEditorVisualClip(
      item.nodeId,
      item.kind as 'image' | 'video' | 'composition' | 'text',
      {
        trackIndex,
        startMs: getVisualTrackEndMs(visualBlocks, trackIndex),
      },
    );
    commitActiveCompositionPatch({
      editorVisualClips: [...visualClips, nextClip],
    }, 'Add visual clip');
    setSelectedVisualClipId(nextClip.id);
    setSelectedAudioClipId(undefined);
    setSelectedSourceItemId(item.id);
    recordActivityTrailWorkspaceEvent('editor', 'Add visual clip to timeline', `V${trackIndex + 1}`, 'toolbar');
  };

  const addAudioClip = (item: SourceBinItem, trackIndex = 0) => {
    if (!activeComposition || !canUseSourceItemAsAudio(item)) {
      return;
    }
    if (isAudioTrackLocked(trackIndex)) return;

    const nextClip = createEditorAudioClip(item.nodeId, trackIndex);
    nextClip.offsetMs = getAudioTrackEndMs(audioBlocks, trackIndex);
    commitActiveCompositionPatch({
      editorAudioClips: [...audioClips, nextClip],
    }, 'Add audio clip');
    setSelectedAudioClipId(nextClip.id);
    setSelectedVisualClipId(undefined);
    setSelectedSourceItemId(item.id);
    recordActivityTrailWorkspaceEvent('editor', 'Add audio clip to timeline', `A${trackIndex + 1}`, 'toolbar');
  };

  const loadCaptionSourceItem = async (item: SourceBinItem) => {
    if (item.kind !== 'subtitle') throw new Error('Choose a saved caption file.');
    const libraryItem = libraryItems.find((candidate) => candidate.id === item.id);
    if (!libraryItem) throw new Error('The saved caption file is no longer available.');

    const dataUrl = await materializeSourceBinItemDataUrl(libraryItem);
    if (!dataUrl) throw new Error('The saved caption file could not be materialized.');
    const text = await (await fetch(dataUrl)).text();
    const formatHint = getCaptionFormatFromFileName(item.label)
      ?? (item.mimeType?.includes('vtt') ? 'vtt' : item.mimeType?.includes('subrip') ? 'srt' : undefined);
    const cues = parseCaptionText(text, formatHint);
    if (cues.length === 0) throw new Error('The caption file does not contain any valid timed cues.');
    return cues;
  };

  const applyCaptionSourceItem = async (item: SourceBinItem) => {
    if (!activeComposition || item.kind !== 'subtitle') return;
    const compositionId = activeComposition.id;

    try {
      const cues = await loadCaptionSourceItem(item);

      const trackIndex = visualTrackCount - 1;
      const currentComposition = useFlowStore.getState().nodes.find((node) => (
        node.id === compositionId && node.type === 'composition'
      ));
      if (!currentComposition) throw new Error('The target composition is no longer available.');
      const currentVisualClips = getEditorVisualClips(currentComposition.data);
      const trackKinds = getEditorVisualTrackKinds(currentComposition.data);
      trackKinds[trackIndex] = 'overlay';
      const captionClips = captionCuesToTextClips(cues, {
        sourceNodeId: item.id,
        trackIndex,
      });
      commitCompositionPatchById(compositionId, {
        editorVisualClips: [...currentVisualClips, ...captionClips],
        editorVisualTrackKinds: trackKinds,
      }, 'Apply saved captions');
      setSelectedSourceItemId(item.id);
      recordActivityTrailWorkspaceEvent('editor', 'Apply captions to timeline', `${cues.length} cues`, 'toolbar');
    } catch (error) {
      await showAlertDialog({
        title: 'Captions Could Not Be Applied',
        message: error instanceof Error ? error.message : 'The saved captions could not be read.',
        tone: 'danger',
      });
    }
  };

  const markSourcePoint = (which: 'in' | 'out') => {
    if (!selectedSourceItem) return;
    const atSeconds = sourceMonitorVideoRef.current?.currentTime ?? 0;
    setSourceMarks((current) => ({
      itemId: selectedSourceItem.id,
      ...(current?.itemId === selectedSourceItem.id ? current : {}),
      [which === 'in' ? 'inSeconds' : 'outSeconds']: atSeconds,
    }));
  };

  // Three-point edit: enabled source patches land on their record targets in one atomic history
  // transaction. Legacy projects without explicit patch state default to V1/A1.
  const performThreePointEdit = (mode: 'insert' | 'overwrite') => {
    if (!activeComposition || !selectedSourceItem) return;
    const visualPatch = professionalWorkflowState.editorial.sourcePatches.find((patch) => patch.sourceKind === 'video');
    const audioPatch = professionalWorkflowState.editorial.sourcePatches.find((patch) => patch.sourceKind === 'audio');
    const visualTrackIndex = parseProfessionalTrackIndex(visualPatch?.targetTrackId ?? 'video:0', 'video', visualTrackCount);
    const audioTrackIndex = parseProfessionalTrackIndex(audioPatch?.targetTrackId ?? 'audio:0', 'audio', audioTrackCount);
    const wantsVisual = canUseSourceItemAsVisual(selectedSourceItem)
      && visualPatch?.enabled !== false
      && visualTrackIndex !== undefined
      && (!visualPatch || professionalWorkflowState.editorial.recordTargetTrackIds.length === 0 || professionalWorkflowState.editorial.recordTargetTrackIds.includes(visualPatch.targetTrackId));
    const wantsAudio = canUseSourceItemAsAudio(selectedSourceItem)
      && audioPatch?.enabled !== false
      && audioTrackIndex !== undefined
      && (!audioPatch || professionalWorkflowState.editorial.recordTargetTrackIds.length === 0 || professionalWorkflowState.editorial.recordTargetTrackIds.includes(audioPatch.targetTrackId));
    const editVisual = wantsVisual && visualTrackIndex !== undefined && !isVisualTrackLocked(visualTrackIndex);
    const editAudio = wantsAudio && audioTrackIndex !== undefined && !isAudioTrackLocked(audioTrackIndex);
    if (!editVisual && !editAudio) return;
    const sourceDurationSeconds = getSourceItemDurationSeconds(selectedSourceItem, durationMap) ?? 4;
    const marks = sourceMarks?.itemId === selectedSourceItem.id ? sourceMarks : {};
    const { sourceInMs, sourceOutMs } = normalizeSourceMarks(marks, sourceDurationSeconds);
    const editDurationMs = sourceOutMs - sourceInMs;
    const playheadMs = Math.max(0, Math.round(timelineCursorSeconds * 1000));
    // visualBlocks measure in seconds; the edit math runs in ms like the clip model.
    const blocksMs = visualBlocks.map((blockEntry) => ({
      clip: blockEntry.clip,
      startMs: Math.round(blockEntry.startSeconds * 1000),
      durationMs: Math.round(blockEntry.durationSeconds * 1000),
    }));
    const linkGroupId = editVisual && editAudio ? `source-edit-link-${globalThis.crypto?.randomUUID?.() ?? Date.now()}` : undefined;
    const newVisualClip = editVisual && visualTrackIndex !== undefined ? createEditorVisualClip(
      selectedSourceItem.nodeId,
      selectedSourceItem.kind === 'composition' ? 'composition' : selectedSourceItem.kind === 'image' ? 'image' : 'video',
      selectedSourceItem.kind === 'video'
        ? { trackIndex: visualTrackIndex, startMs: playheadMs, sourceInMs, sourceOutMs }
        : { trackIndex: visualTrackIndex, startMs: playheadMs, durationSeconds: editDurationMs / 1000 },
    ) : undefined;
    const nextVisualClips = newVisualClip && visualTrackIndex !== undefined
      ? mode === 'overwrite'
        ? [...overwriteTrackRange(blocksMs, visualTrackIndex, playheadMs, editDurationMs).clips, { ...newVisualClip, professional: { ...(newVisualClip.professional ?? {}), trackId: `video:${visualTrackIndex}`, linkGroupId } }]
        : [...shiftTrackClipsForInsert(overwriteTrackRange(blocksMs, visualTrackIndex, playheadMs, 0).clips, visualTrackIndex, playheadMs, editDurationMs), { ...newVisualClip, professional: { ...(newVisualClip.professional ?? {}), trackId: `video:${visualTrackIndex}`, linkGroupId } }]
      : visualClips;
    const newAudioClip = editAudio && audioTrackIndex !== undefined
      ? { ...createEditorAudioClip(selectedSourceItem.nodeId, audioTrackIndex, { offsetMs: playheadMs, sourceInMs, sourceOutMs }), professional: { pan: 0, trackId: `audio:${audioTrackIndex}`, linkGroupId } }
      : undefined;
    const nextAudioClips = newAudioClip && audioTrackIndex !== undefined
      ? mode === 'overwrite'
        ? [...overwriteAudioTrackRange(audioBlocks, audioClips, audioTrackIndex, playheadMs, editDurationMs), newAudioClip]
        : [...insertAudioTrackRange(audioBlocks, audioClips, audioTrackIndex, playheadMs, editDurationMs), newAudioClip]
      : audioClips;
    commitActiveCompositionPatch({ editorVisualClips: nextVisualClips, editorAudioClips: nextAudioClips }, mode === 'insert' ? 'Insert patched source edit' : 'Overwrite patched source edit');
    setSelectedVisualClipIds(newVisualClip ? [newVisualClip.id] : [], newVisualClip?.id);
    setSelectedAudioClipIds(newAudioClip ? [newAudioClip.id] : [], newAudioClip?.id);
    recordActivityTrailWorkspaceEvent(
      'editor',
      mode === 'insert' ? 'Insert edit at playhead' : 'Overwrite edit at playhead',
      `${editVisual && visualTrackIndex !== undefined ? `V${visualTrackIndex + 1}` : ''}${editVisual && editAudio ? ' + ' : ''}${editAudio && audioTrackIndex !== undefined ? `A${audioTrackIndex + 1}` : ''}`,
      'toolbar',
    );
  };

  // Playhead-driven ripple/roll (quartet item 4): Q ripples the selected clip's IN edge to the
  // playhead, W its OUT edge, E rolls the nearest cut on the clip's lane to the playhead. The
  // clip edit and its clip-owned marker transition commit as one atomic patch.
  const performTrimEdit = (kind: 'ripple-in' | 'ripple-out' | 'roll') => {
    if (!activeComposition || !selectedVisualClipId) return;
    const selected = visualClips.find((candidate) => candidate.id === selectedVisualClipId);
    if (!selected || isVisualTrackLocked(selected.trackIndex)) return;
    const playheadMs = Math.max(0, Math.round(timelineCursorSeconds * 1000));
    const blocksMs = visualBlocks.map((blockEntry) => ({
      clip: blockEntry.clip,
      startMs: Math.round(blockEntry.startSeconds * 1000),
      durationMs: Math.round(blockEntry.durationSeconds * 1000),
    }));
    const patch = buildKeyboardTrimEditPatch({
      kind,
      visualClips,
      timelineMarkers,
      selectedClipId: selected.id,
      playheadMs,
      blocks: blocksMs,
      resolveClipTiming: (visual) => resolveEditorClipMarkerTiming(visual, []),
    });
    if (!patch) return;
    commitActiveCompositionPatch(patch, kind === 'roll' ? 'Roll edit point' : kind === 'ripple-in' ? 'Ripple trim in' : 'Ripple trim out');
  };
  const performTrimEditRef = useRef(performTrimEdit);
  useEffect(() => {
    performTrimEditRef.current = performTrimEdit;
  });

  // Motion comics: a bubble/caption is an editor ASSET + a timeline CLIP at the playhead —
  // clips inherit keyframes, opacity/position animation, transitions, and track rules.
  // (Stage objects are a migrated-away concept: a legacy effect converts them to assets.)
  const addComicStageObject = (kind: 'speech-bubble' | 'thought-bubble' | 'caption') => {
    if (!activeComposition) return;
    const asset = createEditorAsset('comic', { comicKind: kind });
    const defaults = asset.comicDefaults;
    // Comic clips created from this toolbar action have no explicit track picker — prefer a
    // dedicated overlay track when one exists, so captions/bubbles land as "a separate thing"
    // without disturbing today's default (track 0) when no overlay track has been designated.
    const overlayTrackIndex = selectOverlayTrackIndexForNewClip('comic', visualTrackKinds);
    const nextClip = createEditorVisualClip(asset.id, 'comic', {
      trackIndex: overlayTrackIndex ?? 0,
      startMs: Math.max(0, Math.round(timelineCursorSeconds * 1000)),
      durationSeconds: 4,
      comicKind: kind,
      comicTailAngleDeg: defaults?.tailAngleDeg,
      comicTailLengthPx: defaults?.tailLengthPx,
      comicLineHeightPercent: defaults?.lineHeightPercent,
      comicLetterSpacingPx: defaults?.letterSpacingPx,
      comicTextAlign: defaults?.textAlign,
      textContent: defaults?.text,
      textFontFamily: defaults?.fontFamily,
      textSizePx: defaults?.fontSizePx,
      textColor: defaults?.textColor,
      shapeFillColor: defaults?.fillColor,
      shapeBorderColor: defaults?.strokeColor,
      shapeBorderWidth: defaults?.strokeWidthPx,
      scalePercent: 40,
      positionX: -20,
      positionY: -20,
    });
    commitActiveCompositionPatch({
      editorAssets: [asset, ...compositionEditorAssets],
      editorVisualClips: [...visualClips, nextClip],
    }, kind === 'caption' ? 'Add caption' : kind === 'thought-bubble' ? 'Add thought bubble' : 'Add speech bubble');
    setSelectedVisualClipId(nextClip.id);
    setSelectedStageObjectId(undefined);
    recordActivityTrailWorkspaceEvent('editor', 'Add motion-comic element', kind, 'toolbar');
  };

  const markSourcePointRef = useRef(markSourcePoint);
  const performThreePointEditRef = useRef(performThreePointEdit);
  useEffect(() => {
    markSourcePointRef.current = markSourcePoint;
    performThreePointEditRef.current = performThreePointEdit;
  });

  const updateVisualClips = useCallback((nextClips: EditorVisualClip[], label = 'Update visual clips') => {
    commitActiveCompositionPatch({ editorVisualClips: nextClips }, label);
  }, [commitActiveCompositionPatch]);

  const updateAudioClips = useCallback((nextClips: EditorAudioClip[], label = 'Update audio clips') => {
    commitActiveCompositionPatch({ editorAudioClips: nextClips }, label);
  }, [commitActiveCompositionPatch]);

  // Shared clip-timing resolver for clip-marker transitions: resolved timeline durations plus
  // effective source in-points, with an authored-window fallback for unknown-duration audio.
  const resolveEditorClipMarkerTiming = useCallback(
    (visual: readonly EditorVisualClip[], audio: readonly EditorAudioClip[]) => new Map<string, { durationMs: number; sourceInMs: number }>([
      ...visual.map((clip) => [clip.id, {
        durationMs: Math.round(resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap) * 1_000),
        sourceInMs: Math.max(0, clip.sourceOutMs === undefined ? (clip.trimStartMs ?? 0) : (clip.sourceInMs ?? clip.trimStartMs ?? 0)),
      }] as const),
      ...audio.map((clip) => {
        const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
        const range = resolveEditorAudioSourceRangeMs(clip, sourceItem ? getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0 : 0);
        return [clip.id, range.durationMs > 0
          ? { durationMs: range.durationMs, sourceInMs: range.sourceInMs }
          : { durationMs: Math.max(0, (clip.sourceOutMs ?? 0) - (clip.sourceInMs ?? 0)), sourceInMs: clip.sourceInMs ?? 0 }] as const;
      }),
    ]),
    [durationMap, sourceItemByNodeId],
  );

  const updateActiveCompositionSettings = (patch: Record<string, unknown>) => {
    if (!activeComposition) {
      return;
    }

    commitActiveCompositionPatch(patch, 'Update composition settings');
  };

  const handleProfessionalWorkflowStateChange = (
    nextState: EditorProfessionalWorkflowState,
    label: string,
  ) => {
    const sanitized = sanitizeEditorProfessionalWorkflowState(nextState, {
      validTargetTrackIds: [
        ...Array.from({ length: visualTrackCount }, (_, index) => `video:${index}`),
        ...Array.from({ length: audioTrackCount }, (_, index) => `audio:${index}`),
      ],
    });
    commitActiveCompositionPatch({
      editorProfessionalWorkflowState: sanitized,
      videoFrameRate: Math.round((sanitized.timebase.numerator / sanitized.timebase.denominator) * 1_000) / 1_000,
    }, label);
  };

  const handleProfessionalHistoryCommand = (command: ProfessionalHistoryCommand) => {
    if (command.kind === 'undo') {
      undoEditor();
      return;
    }
    if (command.kind === 'redo') {
      redoEditor();
      return;
    }
    const index = Number(command.entryId.replace(/^undo:/, ''));
    const entry = editorHistory.undoStack[index];
    if (!entry || !Number.isInteger(index)) return;
    const removed = editorHistory.undoStack.slice(index + 1);
    setEditorHistory({
      ...editorHistory,
      undoStack: editorHistory.undoStack.slice(0, index + 1),
      redoStack: [...editorHistory.redoStack, ...removed.reverse()].slice(-editorHistory.limit),
    });
    applyEditorHistorySnapshot(entry.compositionId, entry.after);
  };

  const handleProfessionalMediaLoggingCommand = async (command: ProfessionalMediaLoggingCommand) => {
    if (command.kind === 'patch-selected') {
      const libraryById = new Map(libraryItems.map((item) => [item.id, item]));
      const updates: Array<{ id: string; professional: SourceBinProfessionalMediaState }> = [];
      for (const sourceItemId of command.sourceItemIds.slice(0, 2_000)) {
        const source = sourceItemById.get(sourceItemId);
        if (!source) continue;
        const libraryId = source.sourceBinItemId
          ?? libraryById.get(source.id)?.id
          ?? libraryById.get(source.nodeId)?.id;
        if (!libraryId) continue;
        const prior = source.professional ?? {
          version: VIDEO_PROFESSIONAL_STATE_VERSION,
          origin: source.isGenerated ? 'generated' as const : 'imported' as const,
        };
        const status = command.patch.status === 'approved'
          ? 'approved' as const
          : command.patch.status === 'select'
            ? 'selected' as const
          : command.patch.status === 'reject'
            ? 'rejected' as const
            : command.patch.status === 'hold' ? 'alternate' as const : 'unreviewed' as const;
        const removeTags = new Set((command.patch.removeTags ?? []).map((tag) => tag.trim().toLocaleLowerCase()));
        const tags = [...new Set([
          ...(prior.tags ?? []).filter((tag) => !removeTags.has(tag.toLocaleLowerCase())),
          ...(command.patch.addTags ?? []),
        ].map((tag) => tag.trim()).filter(Boolean))].slice(0, 64);
        updates.push({ id: libraryId, professional: {
          ...prior,
          tags,
          rating: command.patch.rating ?? prior.rating,
          logging: {
            ...prior.logging,
            reel: command.patch.reel ?? prior.logging?.reel,
            scene: command.patch.scene ?? prior.logging?.scene,
            shot: command.patch.shot ?? prior.logging?.shot,
            take: command.patch.take ?? prior.logging?.take,
            camera: command.patch.camera ?? prior.logging?.camera,
            recordedAt: command.patch.recordedOn ?? prior.logging?.recordedAt,
            notes: command.patch.notes ?? prior.logging?.notes,
            colorLabel: command.patch.labelColor ?? prior.logging?.colorLabel,
            status,
          },
        } });
      }
      updateSourceBinItemsProfessional(updates);
      return;
    }
    if (command.kind === 'save-smart-bin') {
      const name = command.name.trim();
      const query = command.query.trim();
      if (!name || !query || professionalWorkflowState.smartBins.length >= 100) return;
      handleProfessionalWorkflowStateChange({
        ...professionalWorkflowState,
        smartBins: [...professionalWorkflowState.smartBins, {
          id: `smart-bin-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
          name,
          query,
          sortBy: 'rating',
          sortDirection: 'descending',
        }],
      }, 'Save Video smart bin');
      return;
    }
    if (command.kind === 'apply-smart-bin') {
      setActiveProfessionalSmartBinId(command.smartBinId);
      setSourceBinSearchQuery('');
      return;
    }
    if (command.kind === 'suggest-duplicates') {
      const suggestions = suggestVideoMediaDuplicates(professionalMediaLogging.records);
      await showAlertDialog({
        title: 'Duplicate Suggestions',
        message: suggestions.length
          ? `${suggestions.length} evidence-based possible duplicate pair${suggestions.length === 1 ? '' : 's'} found. No media was deleted or merged.`
          : 'No exact or probable duplicate pairs were found from the saved metadata.',
      });
      return;
    }
    const source = timelineSourceItems.find((item) => item.id === command.sourceItemId);
    if (!source || source.kind === 'text' || !source.assetUrl && !source.nativeFilePath) return;
    const parent = libraryItems.find((item) => item.id === (source.sourceBinItemId ?? source.id))
      ?? libraryItems.find((item) => item.id === source.nodeId);
    const professional: SourceBinProfessionalMediaState = {
      ...(source.professional ?? {
        version: VIDEO_PROFESSIONAL_STATE_VERSION,
        origin: source.isGenerated ? 'generated' : 'imported',
      }),
      subclip: {
        parentSourceItemId: parent?.id ?? source.id,
        sourceInMs: command.sourceInMs,
        sourceOutMs: command.sourceOutMs,
      },
    };
    const created = await addAssetItem({
      label: command.name.trim() || `${source.label} subclip`,
      kind: source.kind,
      mimeType: source.mimeType ?? parent?.mimeType ?? 'application/octet-stream',
      dataUrl: source.assetUrl ?? parent?.assetUrl ?? '',
      nativeFilePath: source.nativeFilePath ?? parent?.nativeFilePath,
      isGenerated: source.isGenerated,
      sourceKey: `${parent?.sourceKey ?? source.id}:subclip:${command.sourceInMs}:${command.sourceOutMs}`,
      professional,
    });
    setSelectedSourceItemId(created.id);
  };

  const handleProfessionalReviewCommand = (command: ProfessionalReviewCommand) => {
    if (command.kind === 'add-annotation') {
      const isAudio = command.clipId ? audioClips.some((clip) => clip.id === command.clipId) : false;
      const now = Date.now();
      const annotation: VideoReviewAnnotation = {
        id: `review-${globalThis.crypto?.randomUUID?.() ?? now}`,
        target: command.clipId ? (isAudio ? 'audio-clip' : 'visual-clip') : 'sequence-point',
        startMs: command.playheadMs,
        clipId: command.clipId,
        author: command.author,
        text: command.body,
        status: 'open',
        priority: command.priority === 'urgent' ? 'blocking' : command.priority,
        createdAt: now,
        updatedAt: now,
        replies: [],
      };
      handleProfessionalWorkflowStateChange({
        ...professionalWorkflowState,
        reviewAnnotations: [...professionalWorkflowState.reviewAnnotations, annotation].slice(-5_000),
      }, 'Add local Video review note');
      return;
    }
    if (command.kind === 'set-approval') {
      const now = Date.now();
      handleProfessionalWorkflowStateChange({
        ...professionalWorkflowState,
        reviewApprovals: [...professionalWorkflowState.reviewApprovals, {
          id: `approval-${globalThis.crypto?.randomUUID?.() ?? now}`,
          reviewer: 'Local reviewer',
          compositionSignature: command.compositionSignature,
          status: command.status,
          createdAt: now,
        }].slice(-5_000),
      }, command.status === 'approved' ? 'Approve Video composition signature' : 'Request Video review changes');
      return;
    }
    if (command.kind === 'navigate') {
      const annotation = professionalWorkflowState.reviewAnnotations.find((candidate) => candidate.id === command.annotationId);
      if (!annotation) return;
      setTimelineCursorSeconds(annotation.startMs / 1_000);
      const visual = annotation.clipId ? visualClips.find((clip) => clip.id === annotation.clipId) : undefined;
      const audio = annotation.clipId ? audioClips.find((clip) => clip.id === annotation.clipId) : undefined;
      if (visual) selectVisualClip(visual);
      else if (audio) selectAudioClip(audio);
      return;
    }
    if (command.kind === 'resolve') {
      handleProfessionalWorkflowStateChange({
        ...professionalWorkflowState,
        reviewAnnotations: professionalWorkflowState.reviewAnnotations.map((annotation) => annotation.id === command.annotationId
          ? { ...annotation, status: 'resolved', updatedAt: Date.now() }
          : annotation),
      }, 'Resolve local Video review note');
      return;
    }
    if (command.kind === 'import-report') {
      try {
        const incoming = parseVideoReviewPackageJson(command.data, {
          compositionId: activeComposition?.id ?? 'no-composition',
          compositionSignature: currentCompositionRenderCacheSignature,
        });
        const merged = mergeVideoReviewWorkflows(
          professionalReviewWorkflow,
          incoming,
          currentCompositionRenderCacheSignature,
        );
        const nextAnnotations: VideoReviewAnnotation[] = merged.annotations.map((annotation) => {
          const target = annotation.target;
          return {
            id: annotation.id,
            target: target.kind === 'clip'
              ? (audioClips.some((clip) => clip.id === target.clipId) ? 'audio-clip' : 'visual-clip')
              : target.kind === 'range' ? 'sequence-range' : 'sequence-point',
            startMs: target.kind === 'point' ? target.timeMs : target.kind === 'range' ? target.startMs : target.timeMs ?? 0,
            endMs: target.kind === 'range' ? target.endMs : undefined,
            clipId: target.kind === 'clip' ? target.clipId : undefined,
            author: annotation.author,
            text: annotation.body,
            status: annotation.status === 'resolved' || annotation.status === 'wont-fix' ? 'resolved' : 'open',
            priority: annotation.priority === 'urgent' ? 'blocking' : annotation.priority,
            assignee: annotation.assignee,
            createdAt: annotation.createdAt,
            updatedAt: annotation.updatedAt,
            replies: annotation.replies.map((reply) => ({ id: reply.id, author: reply.author, text: reply.body, createdAt: reply.createdAt })),
          };
        });
        const importedApproval = merged.approval.compositionSignature
          && (merged.approval.status === 'approved' || merged.approval.status === 'changes-requested')
          ? {
              id: `approval-import-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
              reviewer: merged.approval.reviewer ?? 'Imported reviewer',
              compositionSignature: merged.approval.compositionSignature,
              status: merged.approval.status,
              createdAt: merged.approval.decidedAt ?? 0,
              note: merged.approval.note,
            }
          : undefined;
        const nextApprovals = importedApproval && !professionalWorkflowState.reviewApprovals.some((approval) => (
          approval.reviewer === importedApproval.reviewer
          && approval.compositionSignature === importedApproval.compositionSignature
          && approval.status === importedApproval.status
          && approval.createdAt === importedApproval.createdAt
          && approval.note === importedApproval.note
        ))
          ? [...professionalWorkflowState.reviewApprovals, importedApproval]
          : professionalWorkflowState.reviewApprovals;
        handleProfessionalWorkflowStateChange({
          ...professionalWorkflowState,
          reviewAnnotations: nextAnnotations,
          reviewApprovals: nextApprovals.slice(-5_000),
        }, 'Merge local Video review package');
      } catch (error) {
        void showAlertDialog({ title: 'Review Import Failed', message: error instanceof Error ? error.message : 'The review JSON could not be imported.', tone: 'danger' });
      }
      return;
    }
    const data = command.format === 'json'
      ? exportVideoReviewPackageJson(professionalReviewWorkflow)
      : exportVideoReviewPackageCsv(professionalReviewWorkflow);
    downloadProfessionalText(data, `sloom-video-review.${command.format}`, command.format === 'json' ? 'application/json' : 'text/csv');
  };

  const saveProfessionalCaptionDocument = (document: VideoCaptionDocument, label: string) => {
    const existing = professionalWorkflowState.captionTracks.find((track) => track.id === document.id);
    const track = {
      id: document.id,
      name: existing?.name ?? 'Primary captions',
      language: document.language ?? existing?.language ?? 'und',
      service: existing?.service ?? 'captions' as const,
      style: {
        fontFamily: document.defaultStyle.fontFamily,
        fontSizePx: document.defaultStyle.fontSizePx,
        textColor: document.defaultStyle.color,
        backgroundOpacityPercent: document.defaultStyle.backgroundOpacityPercent,
        safeAreaPercent: existing?.style.safeAreaPercent ?? 10,
      },
      cues: document.cues.map((cue) => ({
        id: cue.id,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text: cue.text,
        speaker: cue.speaker,
        position: cue.position?.anchor === 'top' ? 'top' as const : cue.position?.anchor === 'middle' ? 'center' as const : 'bottom' as const,
      })),
    };
    const nextState = {
      ...professionalWorkflowState,
      captionTracks: [track, ...professionalWorkflowState.captionTracks.filter((candidate) => candidate.id !== track.id)].slice(0, 32),
    };
    const sourceNodeId = `caption-document:${document.id}`;
    const trackIndex = Math.max(0, visualTrackKinds.findIndex((kind) => kind === 'overlay'));
    const projected = projectVideoCaptionsToTextClips(document, { sourceNodeId, trackIndex });
    const nextTrackKinds = [...visualTrackKinds];
    nextTrackKinds[trackIndex] = 'overlay';
    commitActiveCompositionPatch({
      editorProfessionalWorkflowState: nextState,
      editorVisualClips: [...visualClips.filter((clip) => clip.sourceNodeId !== sourceNodeId), ...projected],
      editorVisualTrackKinds: nextTrackKinds,
    }, label);
  };

  const handleProfessionalCaptionCommand = async (command: ProfessionalCaptionCommand) => {
    if (command.kind === 'import') {
      const imported = parseVideoCaptionDocument(command.data, command.format, {
        id: professionalCaptionDocument.id,
        language: command.language ?? professionalCaptionDocument.language,
      });
      if (imported.cues.length === 0) {
        throw new Error('The selected caption file has no valid bounded timed-text cues; the timeline was left unchanged.');
      }
      saveProfessionalCaptionDocument(imported, `Import ${command.format.toUpperCase()} caption cues`);
      return;
    }
    if (command.kind === 'set-language') {
      const language = command.language.trim().slice(0, 32);
      if (!language) throw new Error('Caption delivery language is required.');
      saveProfessionalCaptionDocument({ ...professionalCaptionDocument, language }, 'Set caption delivery language');
      return;
    }
    if (command.kind === 'set-embedding') {
      const primaryTrack = professionalWorkflowState.captionTracks[0];
      if (command.enabled && (!primaryTrack || primaryTrack.cues.length === 0)) {
        throw new Error('Add or import a primary caption track before enabling embedded delivery.');
      }
      handleProfessionalWorkflowStateChange({
        ...professionalWorkflowState,
        captionEmbedding: command.enabled
          ? { enabled: true, ...(primaryTrack ? { trackId: primaryTrack.id } : {}) }
          : { enabled: false },
      }, command.enabled ? 'Enable embedded mov_text caption delivery' : 'Disable embedded caption delivery');
      return;
    }
    if (command.kind === 'add-cue') {
      const startMs = Math.max(0, Math.round(command.playheadMs));
      saveProfessionalCaptionDocument(createVideoCaptionDocument({
        ...professionalCaptionDocument,
        cues: [...professionalCaptionDocument.cues, {
          id: `cue-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
          startMs,
          endMs: startMs + 2_000,
          text: 'New caption',
          language: professionalCaptionDocument.language,
        }],
      }), 'Add semantic caption cue');
      return;
    }
    if (command.kind === 'update-cue') {
      const startMs = Math.max(0, Math.round(command.startMs));
      const endMs = Math.max(startMs + 1, Math.round(command.endMs));
      saveProfessionalCaptionDocument({
        ...professionalCaptionDocument,
        cues: professionalCaptionDocument.cues.map((cue) => cue.id === command.cueId
          ? { ...cue, startMs, endMs, text: command.text.trim() || cue.text }
          : cue),
      }, 'Edit semantic caption cue');
      return;
    }
    if (command.kind === 'delete-cue') {
      saveProfessionalCaptionDocument({
        ...professionalCaptionDocument,
        cues: professionalCaptionDocument.cues.filter((cue) => cue.id !== command.cueId),
      }, 'Delete semantic caption cue');
      return;
    }
    if (command.kind === 'split-cue') {
      const cue = professionalCaptionDocument.cues.find((candidate) => candidate.id === command.cueId);
      if (!cue || cue.endMs - cue.startMs < 2) return;
      saveProfessionalCaptionDocument(splitVideoCaptionCue(
        professionalCaptionDocument,
        cue.id,
        Math.round((cue.startMs + cue.endMs) / 2),
        `${cue.id}-split-${Date.now()}`,
      ), 'Split semantic caption cue');
      return;
    }
    if (command.kind === 'find-replace') {
      const result = findReplaceVideoCaptions(professionalCaptionDocument, command.find, command.replacement);
      saveProfessionalCaptionDocument(result.document, `Replace text in ${result.changedCueIds.length} caption cue(s)`);
      return;
    }
    if (command.kind === 'run-accessibility-qc') {
      const issues = analyzeVideoCaptionQc(professionalCaptionDocument);
      await showAlertDialog({
        title: 'Caption Accessibility QC',
        message: issues.length
          ? `${issues.length} issue${issues.length === 1 ? '' : 's'} found across reading speed, line length, overlap, short gaps, and title-safe position.`
          : 'No caption accessibility issues were found by the structural caption checks.',
      });
      return;
    }
    const result = serializeVideoCaptionDocument(professionalCaptionDocument, command.format);
    downloadProfessionalText(result.data, `sloom-captions${result.fileExtension}`, result.mediaType);
  };

  const handleProfessionalBatchCommand = (command: ProfessionalBatchCommand) => {
    const normalized = normalizeVideoWorkflowBatch({
      visualClips,
      audioClips,
      trackState: professionalWorkflowTrackState,
      sourceItems: timelineSourceItems,
      sourceDurationMs: professionalSourceDurationMs,
    });
    if (!normalized.ok) {
      void showAlertDialog({ title: 'Batch Edit Unavailable', message: `The batch edit was rejected: ${normalized.reason}.`, tone: 'danger' });
      return;
    }
    const frameMs = 1_000 / compositionFrameRate;
    const selected = command.clipIds.slice(0, 2_000);
    if (command.kind === 'toggle-enabled' && selected.some((id) => visualClips.some((clip) => clip.id === id))) {
      void showAlertDialog({ title: 'Visual Enable Is Not Representable', message: 'The current visual clip schema has no enabled switch. Audio clips can be enabled or disabled; visual clips were left unchanged.', tone: 'danger' });
      return;
    }
    const proposal = command.kind === 'move'
      ? proposeVideoBatchMove(normalized.value.clips, normalized.value.tracks, selected, { deltaMs: command.deltaFrames * frameMs })
      : command.kind === 'track-shift'
        ? proposeVideoBatchTrackShift(normalized.value.clips, normalized.value.tracks, selected, command.trackDelta)
        : command.kind === 'duplicate'
          ? proposeVideoBatchDuplicate(normalized.value.clips, normalized.value.tracks, selected, { deltaMs: command.deltaFrames * frameMs })
          : command.kind === 'delete'
            ? proposeVideoBatchDelete(normalized.value.clips, normalized.value.tracks, selected)
            : proposeVideoBatchEnabled(
                normalized.value.clips,
                normalized.value.tracks,
                selected,
                !audioClips.find((clip) => selected.includes(clip.id))?.enabled,
              );
    const applied = applyVideoWorkflowBatchProposal(normalized.value, proposal);
    if (!applied.ok) {
      void showAlertDialog({ title: 'Batch Edit Rejected', message: `No clips changed: ${applied.reason}.`, tone: 'danger' });
      return;
    }
    const nextMarkers = transitionClipOwnedTimelineMarkers(visualClips, audioClips, applied.value.visualClips, applied.value.audioClips);
    commitActiveCompositionPatch({
      editorVisualClips: applied.value.visualClips,
      editorAudioClips: applied.value.audioClips,
      ...markerPatchFor(nextMarkers),
    }, `Professional batch ${command.kind}`);
    const nextSelected = proposal.selectedClipIds;
    setSelectedVisualClipIds(nextSelected.filter((id) => applied.value.visualClips.some((clip) => clip.id === id)));
    setSelectedAudioClipIds(nextSelected.filter((id) => applied.value.audioClips.some((clip) => clip.id === id)));
  };

  const handleProfessionalSourceRecordCommand = (command: ProfessionalSourceRecordCommand) => {
    if (command.kind === 'replace') {
      performThreePointEdit('overwrite');
      return;
    }
    const normalized = normalizeVideoWorkflowSourceRecord({
      visualClips,
      audioClips,
      trackState: professionalWorkflowTrackState,
      sourceItems: timelineSourceItems,
      sourceDurationMs: professionalSourceDurationMs,
    });
    if (!normalized.ok) {
      void showAlertDialog({ title: 'Source / Record Edit Unavailable', message: normalized.reason, tone: 'danger' });
      return;
    }
    if (command.kind === 'previous-edit' || command.kind === 'next-edit') {
      const navigation = findSourceRecordEdit(
        normalized.value.clips,
        normalized.value.tracks,
        command.playheadMs,
        command.kind === 'previous-edit' ? 'previous' : 'next',
      );
      if (navigation.found && navigation.timeMs !== undefined) setTimelineCursorSeconds(navigation.timeMs / 1_000);
      return;
    }
    const selectedId = command.kind === 'match-frame'
      ? command.clipId
      : selectedVisualClipIds[0] ?? selectedAudioClipIds[0];
    const selected = normalized.value.clips.find((clip) => clip.id === selectedId)
      ?? normalized.value.clips.find((clip) => command.playheadMs >= clip.startMs && command.playheadMs <= clip.startMs + clip.durationMs);
    if (!selected) return;
    if (command.kind === 'match-frame') {
      const match = matchSourceRecordFrame(normalized.value.clips, selected.id, command.playheadMs);
      if (!match.matched || !match.match) return;
      const source = timelineSourceItems.find((item) => item.id === match.match?.sourceId || item.nodeId === match.match?.sourceId);
      if (source) {
        selectSourceItem(source.id);
        if (sourceMonitorVideoRef.current) sourceMonitorVideoRef.current.currentTime = match.match.sourceTimeMs / 1_000;
      }
      return;
    }
    const range = { inMs: selected.startMs, outMs: selected.startMs + selected.durationMs };
    const proposal = command.kind === 'lift'
      ? proposeSourceRecordLift(normalized.value.clips, normalized.value.tracks, range, { targetTrackIds: [selected.trackId] })
      : proposeSourceRecordExtract(normalized.value.clips, normalized.value.tracks, range, { targetTrackIds: [selected.trackId] });
    const applied = applyVideoWorkflowSourceRecordProposal(normalized.value, proposal);
    if (!applied.ok) {
      void showAlertDialog({ title: 'Source / Record Edit Rejected', message: applied.reason, tone: 'danger' });
      return;
    }
    const nextMarkers = transitionClipOwnedTimelineMarkers(visualClips, audioClips, applied.value.visualClips, applied.value.audioClips);
    commitActiveCompositionPatch({
      editorVisualClips: applied.value.visualClips,
      editorAudioClips: applied.value.audioClips,
      ...markerPatchFor(nextMarkers),
    }, command.kind === 'lift' ? 'Lift selected record range' : 'Extract selected record range');
    clearTimelineSelection();
  };

  const handleProfessionalTrimCommand = (command: ProfessionalTrimCommand) => {
    if (command.kind === 'cancel') {
      if (professionalTrimPreview) cancelVideoTrimToolSession(professionalTrimPreview.session);
      setProfessionalTrimPreview(undefined);
      return;
    }
    if (command.kind === 'commit') {
      if (!professionalTrimPreview) return;
      if (professionalTrimPreview.baseCompositionSignature !== currentCompositionRenderCacheSignature) {
        void showAlertDialog({
          title: 'Trim Session Is Stale',
          message: 'The timeline changed after this trim began. Cancel it and start again so no newer edit is overwritten.',
          tone: 'warning',
        });
        return;
      }
      const committed = commitVideoTrimToolSession(professionalTrimPreview.session);
      if (!committed.ok) {
        void showAlertDialog({ title: 'Trim Commit Rejected', message: committed.reason, tone: 'danger' });
        return;
      }
      const recordTrackIds = [...new Set(committed.session.trim.affectedClipIds.flatMap((clipId) => {
        const clip = committed.session.trim.previewClips.find((candidate) => candidate.id === clipId);
        return clip ? [clip.trackId] : [];
      }))];
      const proposal: SourceRecordProposal<VideoWorkflowSourceRecordClip> = {
        applied: true,
        clips: committed.session.trim.previewClips,
        affectedClipIds: committed.session.trim.affectedClipIds,
        createdClipIds: [],
        removedClipIds: [],
        recordTrackIds,
      };
      const applied = applyVideoWorkflowSourceRecordProposal(professionalTrimPreview.projection, proposal);
      if (!applied.ok) {
        void showAlertDialog({ title: 'Trim Commit Rejected', message: applied.reason, tone: 'danger' });
        return;
      }
      const nextMarkers = transitionClipOwnedTimelineMarkers(visualClips, audioClips, applied.value.visualClips, applied.value.audioClips);
      commitActiveCompositionPatch({
        editorVisualClips: applied.value.visualClips,
        editorAudioClips: applied.value.audioClips,
        ...markerPatchFor(nextMarkers),
      }, `${committed.session.mode[0].toUpperCase()}${committed.session.mode.slice(1)} trim`);
      setProfessionalTrimPreview(undefined);
      return;
    }
    if (!('deltaFrames' in command)) return;
    if (command.kind === 'update') {
      if (!professionalTrimPreview) return;
      const updated = updateVideoTrimToolSessionNumeric(professionalTrimPreview.session, {
        value: command.deltaFrames,
        unit: 'frames',
      });
      if (!updated.ok) {
        void showAlertDialog({ title: 'Trim Update Rejected', message: updated.reason, tone: 'warning' });
        return;
      }
      setProfessionalTrimPreview({ ...professionalTrimPreview, session: updated.session });
      return;
    }
    const selectedClipId = professionalTrimTargetClipIdRef.current ?? selectedVisualClipId ?? selectedAudioClipId;
    const requestedEdge = professionalTrimEdgeRef.current;
    professionalTrimTargetClipIdRef.current = undefined;
    professionalTrimEdgeRef.current = undefined;
    if (!selectedClipId) {
      void showAlertDialog({ title: 'Select A Clip', message: 'Select a visual or audio clip before beginning an advanced trim.', tone: 'warning' });
      return;
    }
    const normalized = normalizeVideoWorkflowSourceRecord({
      visualClips,
      audioClips,
      trackState: professionalWorkflowTrackState,
      sourceItems: timelineSourceItems,
      sourceDurationMs: professionalSourceDurationMs,
    });
    if (!normalized.ok) {
      void showAlertDialog({ title: 'Trim Session Unavailable', message: normalized.reason, tone: 'danger' });
      return;
    }
    const selected = normalized.value.clips.find((clip) => clip.id === selectedClipId);
    if (!selected) return;
    const sameTrack = normalized.value.clips
      .filter((clip) => clip.trackId === selected.trackId && clip.kind === selected.kind && clip.id !== selected.id)
      .sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
    const epsilon = 0.01;
    const left = sameTrack.find((clip) => Math.abs(clip.startMs + clip.durationMs - selected.startMs) <= epsilon);
    const right = sameTrack.find((clip) => Math.abs(selected.startMs + selected.durationMs - clip.startMs) <= epsilon);
    const options: AdvancedTrimSessionOptions & { framesPerSecond: number } = {
      mode: command.mode,
      primaryClipId: selected.id,
      includeLinked: true,
      minimumDurationMs: 1_000 / compositionFrameRate,
      framesPerSecond: compositionFrameRate,
    };
    if (command.mode === 'ripple') {
      options.edge = requestedEdge ?? 'out';
    } else if (command.mode === 'roll') {
      if (requestedEdge === 'in' && left) {
        options.primaryClipId = left.id;
        options.secondaryClipId = selected.id;
      } else if (right) options.secondaryClipId = right.id;
      else if (left) {
        options.primaryClipId = left.id;
        options.secondaryClipId = selected.id;
      }
    } else if (command.mode === 'slide') {
      options.leftNeighborClipId = left?.id;
      options.rightNeighborClipId = right?.id;
    }
    const begun = beginVideoTrimToolSession(
      normalized.value.clips as readonly (VideoWorkflowSourceRecordClip & AdvancedTrimClip)[],
      normalized.value.tracks,
      options,
    );
    if (!begun.ok) {
      void showAlertDialog({
        title: 'Trim Session Unavailable',
        message: command.mode === 'roll' || command.mode === 'slide'
          ? `This edit needs contiguous unlocked neighbor clips with sufficient source handles (${begun.reason}).`
          : `The selected clip cannot begin this trim (${begun.reason}).`,
        tone: 'warning',
      });
      return;
    }
    const updated = updateVideoTrimToolSessionNumeric(begun.session, { value: command.deltaFrames, unit: 'frames' });
    if (!updated.ok) {
      void showAlertDialog({ title: 'Trim Update Rejected', message: updated.reason, tone: 'warning' });
      return;
    }
    setProfessionalTrimPreview({
      baseCompositionSignature: currentCompositionRenderCacheSignature,
      projection: normalized.value,
      session: updated.session,
      description: command.mode === 'slip'
        ? 'Source content moves inside the clip while its record position stays fixed.'
        : command.mode === 'slide'
          ? 'The selected clip moves while contiguous neighbors compensate on both sides.'
          : command.mode === 'roll'
            ? 'The shared cut moves while the combined record duration stays fixed.'
            : 'The selected out edge and downstream clips move together.',
    });
  };

  const beginProfessionalTrimFromTimeline = (
    clipId: string,
    mode: Extract<TimelineTool, 'ripple' | 'roll' | 'slip' | 'slide'>,
    edge?: TimelineClipEdge,
  ) => {
    professionalTrimTargetClipIdRef.current = clipId;
    professionalTrimEdgeRef.current = edge === 'start' ? 'in' : edge === 'end' ? 'out' : undefined;
    handleProfessionalTrimCommand({ kind: 'begin', mode, deltaFrames: 0 });
  };

  /** One structural-QC build shared by the QC button and the render queue's QC deliverable. */
  const buildCurrentStructuralQcReport = () => buildVideoWorkflowStructuralQc({
    visualClips,
    audioClips,
    trackState: professionalWorkflowTrackState,
    sourceItems: timelineSourceItems,
    sourceDurationMs: professionalSourceDurationMs,
    captionTracks: professionalWorkflowState.captionTracks,
    framesPerSecond: compositionFrameRate,
    projectDurationMs: sequenceDurationSeconds * 1_000,
    compositionSignature: currentCompositionRenderCacheSignature,
    renderCacheSignature: activeComposition?.data.editorRenderCacheCompositionSignature,
    workingColorSpace: activeComposition?.data.editorProfessionalState?.workingColorSpace,
    deliveryColorSpace: 'rec709',
    deliveryColorTransformState: activeComposition?.data.editorProfessionalState?.workingColorSpace === 'rec709' ? 'configured' : 'setup-only',
  });

  const handleProfessionalQcCommand = async (command: ProfessionalQcCommand) => {
    if (command.kind === 'cancel-decoded-signal') {
      decodedSignalQcAbortControllerRef.current?.abort();
      return;
  }
    if (command.kind === 'navigate') {
      const issue = professionalStructuralQcReport?.issues.find((candidate) => candidate.id === command.issueId)
        ?? professionalWorkflowState.decodedSignalQcReport?.issues.find((candidate) => candidate.id === command.issueId);
      if (!issue) return;
      const navigation = issue.navigation;
      if (!navigation) return;
      if ('timeMs' in navigation && navigation.timeMs !== undefined) setTimelineCursorSeconds(navigation.timeMs / 1_000);
      else if ('frame' in navigation && navigation.frame !== undefined) setTimelineCursorSeconds(navigation.frame / compositionFrameRate);
      const clipId = 'clipId' in navigation ? navigation.clipId : undefined;
      const visual = clipId ? visualClips.find((clip) => clip.id === clipId) : undefined;
      const audio = clipId ? audioClips.find((clip) => clip.id === clipId) : undefined;
      if (visual) selectVisualClip(visual);
      else if (audio) selectAudioClip(audio);
      else if (navigation.sourceId) {
        const source = timelineSourceItems.find((item) => item.id === navigation.sourceId || item.nodeId === navigation.sourceId);
        if (source) {
          selectSourceItem(source.id);
          if ('timeMs' in navigation && navigation.timeMs !== undefined && sourceMonitorVideoRef.current) {
            sourceMonitorVideoRef.current.currentTime = navigation.timeMs / 1_000;
          }
        }
      }
      return;
    }
    if (command.kind === 'run-decoded-signal') {
      if (decodedSignalQcRunning) return;
      const compositionId = activeComposition?.id;
      if (!compositionId) return;
      const sources = timelineSourceItems.flatMap((source) => source.kind === 'video' || source.kind === 'audio'
        ? [{ id: source.id, label: source.label, kind: source.kind, assetUrl: source.assetUrl }]
        : []);
      if (sources.length === 0) {
        void showAlertDialog({ title: 'Decoded-signal QC Could Not Run', message: 'Add a browser-readable Video or Audio source before running decoded-signal QC.', tone: 'danger' });
        return;
      }
      const controller = new AbortController();
      decodedSignalQcAbortControllerRef.current = controller;
      setDecodedSignalQcRunning(true);
      try {
        const result = await runVideoDecodedSignalQc({
          sources,
          compositionSignature: currentCompositionRenderCacheSignature,
          signal: controller.signal,
        });
        if (!result.cancelled) {
          const latestComposition = useFlowStore.getState().nodes.find((node) => (
            node.id === compositionId && node.type === 'composition'
          ));
          if (latestComposition) {
            // The browser decode can take minutes. Merge only its compact report
            // into the latest workflow snapshot, preserving review/caption/work-area
            // and sync-lock edits made after the user clicked Run.
            commitCompositionPatchById(compositionId, {
              editorProfessionalWorkflowState: mergeVideoDecodedSignalQcReport(
                latestComposition.data.editorProfessionalWorkflowState,
                result.report,
              ),
            }, 'Run decoded-signal QC');
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          void showAlertDialog({
            title: 'Decoded-signal QC Could Not Run',
            message: error instanceof Error ? error.message : 'The decoded-signal analyzer did not complete.',
            tone: 'danger',
          });
        }
      } finally {
        if (decodedSignalQcAbortControllerRef.current === controller) {
          decodedSignalQcAbortControllerRef.current = undefined;
          setDecodedSignalQcRunning(false);
        }
      }
      return;
    }
    const report = buildCurrentStructuralQcReport();
    if (!report.ok) {
      void showAlertDialog({ title: 'Structural QC Could Not Run', message: report.reason, tone: 'danger' });
      return;
    }
    setProfessionalStructuralQcReport(report.value);
  };

  const handleProfessionalDeliveryCommand = (command: ProfessionalDeliveryCommand) => {
    const compositionId = activeComposition?.id;
    if (command.kind === 'resume-queue') {
      if (compositionId) setRunningRenderQueueCompositionId(compositionId);
      return;
    }
    if (command.kind === 'cancel' || command.kind === 'queue' || command.kind === 'retry') {
      if (!compositionId) return;
      const context = { now: Date.now(), currentCompositionSignature: currentCompositionRenderCacheSignature };
      const result = mutateRenderQueue(compositionId, (records) => {
        if (command.kind === 'cancel') return cancelVideoRenderQueueJob(records, command.jobId, context);
        if (command.kind === 'queue') return queueVideoRenderJob(records, command.jobId, context);
        return retryVideoRenderQueueJob(records, command.jobId, context);
      });
      // A refused transition always carries the real reason, so the user is told why rather than
      // watching a button do nothing.
      if (result && !result.changed && result.reason) {
        void showAlertDialog({ title: 'Render Queue Unchanged', message: result.reason });
        return;
      }
      if (command.kind === 'cancel') {
        // A running video deliverable is the composition's own node run, so cancelling the job has
        // to stop that run too, not just relabel the record.
        if (renderQueueRunRef.current?.startsWith(`${command.jobId}:`)) cancelNodeRun(compositionId);
        return;
      }
      // Queue and Resume are the explicit "start working" actions for this session.
      setRunningRenderQueueCompositionId(compositionId);
      return;
    }
    if (command.kind === 'export-manifest') {
      const record = professionalWorkflowState.deliveryJobs.find((candidate) => candidate.id === command.jobId);
      if (!record) return;
      const profileName = professionalWorkflowState.deliveryProfiles
        .find((profile) => profile.id === record.profileId)?.name ?? record.profileId;
      downloadProfessionalText(
        JSON.stringify({ format: 'sloom-video-delivery-manifest-v1', profileName, ...record }, null, 2),
        `${record.id}-manifest.json`,
        'application/json',
      );
      return;
    }
    if (!activeComposition) return;
    const profile = professionalWorkflowState.deliveryProfiles.find((candidate) => candidate.id === command.profileId);
    if (!profile || !profile.targets.some((target) => target.enabled)) {
      void showAlertDialog({ title: 'Delivery Profile Unavailable', message: 'The selected delivery profile is missing or has no enabled outputs.', tone: 'danger' });
      return;
    }
    const createdAt = new Date().toISOString();
    const nativeAvailable = Boolean(getSignalLoomNativeBridge());
    const job = createDefaultVideoWorkflowDeliveryJob({
      jobId: `delivery-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      createdAt,
      projectName: 'Sloom Studio',
      composition: {
        compositionId: activeComposition.id,
        compositionName: typeof activeComposition.data.customTitle === 'string' ? activeComposition.data.customTitle : 'Video composition',
        compositionSignature: command.compositionSignature,
      },
      host: buildVideoDeliveryQueueHost({ nativeAvailable, activeExportPresetId: exportPresetPlan.presetId }),
      profile,
    });
    const now = Date.now();
    const record: VideoDeliveryJobRecord = {
      id: job.id,
      profileId: command.profileId,
      compositionSignature: job.frozenCompositionSignature,
      status: job.status === 'blocked' ? 'failed' : 'planned',
      createdAt: now,
      updatedAt: now,
      hostDurability: nativeAvailable ? 'native-restart-check' : 'browser-session-only',
      outputs: job.outputs.map((output) => ({
        id: output.id,
        label: output.label,
        fileName: output.fileName,
        extension: output.extension,
        container: output.container,
        codec: output.codec,
        target: output.target,
        status: output.status === 'canceled' ? 'cancelled' : output.status,
        missingCapabilities: [...output.missingCapabilities],
        checksumIntent: output.checksumIntent,
        manifestIntent: output.manifestIntent,
        executionDurability: output.executionDurability,
        truthfulnessNote: output.truthfulnessNote,
        attempts: 0,
      })),
      manifestIntent: {
        includeFrozenCompositionSignature: true,
        includeOutputChecksums: job.manifestIntent.includeOutputChecksums,
      },
      message: job.status === 'blocked'
        ? 'No output in this plan can run yet; each one lists the capability it is waiting on.'
        : 'Plan saved. Queue it to put the runnable outputs in the durable render queue.',
    };
    mutateRenderQueue(activeComposition.id, (records) => ({
      // Same rule as reconciliation: a full queue forgets finished jobs, never pending ones.
      records: pruneVideoDeliveryJobsToBound([...records, record]),
      changed: true,
    }));
  };

  /**
   * Restart recovery. Runs once per composition per mount, before the runner is allowed to start
   * anything, so a record left `running` by a session that no longer exists is repaired to
   * `interrupted` instead of being reported as live work. Re-entry on remount is intentional: if
   * this component went away, so did the only thing that could have been rendering.
   */
  useEffect(() => {
    const compositionId = activeComposition?.id;
    if (!compositionId || reconciledRenderQueuesRef.current.has(compositionId)) return;
    reconciledRenderQueuesRef.current.add(compositionId);
    mutateRenderQueue(compositionId, (records) => reconcileVideoRenderQueue(records, {
      now: Date.now(),
      resolveReference: (reference) => {
        // Only Source Library artifacts are checkable from the renderer. A composition render lives
        // in the render cache or on disk, so this reports "cannot tell" rather than guessing that a
        // finished render is gone and re-spending it.
        if (!reference.startsWith(SOURCE_LIBRARY_REFERENCE_PREFIX)) return undefined;
        const itemId = reference.slice(SOURCE_LIBRARY_REFERENCE_PREFIX.length);
        return useSourceBinStore.getState().bins.some((bin) => bin.items.some((item) => item.id === itemId));
      },
    }));
  }, [activeComposition?.id, mutateRenderQueue]);


  const handleCreateComposition = () => {
    const compositionId = addNode('composition', getNewFlowNodePosition());
    patchNodeData(compositionId, {
      customTitle: 'Video Composition',
      editorAssets: [],
    });
    setActiveCompositionId(compositionId);
    recordActivityTrailWorkspaceEvent('editor', 'Create Video Composition', 'composition', 'toolbar');
  };

  // F10 starter template — creates a composition pre-set to a 1080p 16:9 sequence.
  const handleCreateStarterSequence = () => {
    const compositionId = addNode('composition', getNewFlowNodePosition());
    patchNodeData(compositionId, {
      customTitle: '1080p Sequence',
      editorAssets: [],
      aspectRatio: '16:9',
      videoResolution: '1080p',
    });
    setActiveCompositionId(compositionId);
    recordActivityTrailWorkspaceEvent('editor', 'Create 1080p starter sequence', 'composition', 'toolbar');
  };

  // F10 empty-state action — reveals the Source Library media panel so the user can add media.
  const handleRevealSourceBin = () => {
    setPanelVisibility('sourceBinVisible', true);
    setSourceBinTab('media');
  };

  // Scoped Premiere interop (task #33): export the active sequence as FCP7 XML — the dialect
  // Premiere round-trips via File > Import. Media with on-disk paths links directly; generated
  // assets relink by name (standard interchange behavior, warned below).
  const handleExportFcpXml = () => {
    if (!activeComposition) {
      return;
    }

    const sequenceName = typeof activeComposition.data.customTitle === 'string' && activeComposition.data.customTitle.trim()
      ? activeComposition.data.customTitle.trim()
      : 'Sloom Studio Sequence';
    const sequence = buildFcpXmlSequenceFromEditor({
      name: sequenceName,
      frameRate: compositionFrameRate,
      widthPx: programCanvas.width,
      heightPx: programCanvas.height,
      visualClips,
      audioClips,
      resolveVisualMedia: (clip) => {
        const item = sourceItemByNodeId.get(clip.sourceNodeId);
        return {
          label: item?.label ?? clip.sourceNodeId,
          nativeFilePath: item?.nativeFilePath ?? resolveFcpMediaPathFromAssetUrl(item?.assetUrl),
          sourceDurationSeconds: getSourceItemDurationSeconds(item, durationMap) ?? 0,
          timelineDurationSeconds: resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap),
        };
      },
      resolveAudioMedia: (clip) => {
        const item = sourceItemByNodeId.get(clip.sourceNodeId);
        return {
          label: item?.label ?? clip.sourceNodeId,
          nativeFilePath: item?.nativeFilePath ?? resolveFcpMediaPathFromAssetUrl(item?.assetUrl),
          sourceDurationSeconds: getSourceItemDurationSeconds(item, durationMap) ?? 0,
        };
      },
    });

    const { xml, warnings } = exportSequenceToFcpXml(sequence);
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = `${sequenceName.replace(/[^a-zA-Z0-9 _-]/g, '_')}.xml`;
    anchor.click();
    URL.revokeObjectURL(url);

    if (warnings.length > 0) {
      void showAlertDialog({
        title: 'FCP7 XML exported with relink notes',
        message: `${warnings.slice(0, 6).join('\n')}${warnings.length > 6 ? `\n…and ${warnings.length - 6} more.` : ''}`,
        tone: 'info',
      });
    }
  };

  const addEditorAsset = (kind: EditorAssetKind) => {
    const nextAsset = createEditorAsset(kind);
    if (!activeComposition) {
      const compositionId = addNode('composition', getNewFlowNodePosition());
      patchNodeData(compositionId, {
        customTitle: 'Video Composition',
        editorAssets: [nextAsset],
      });
      setActiveCompositionId(compositionId);
    } else {
      commitActiveCompositionPatch({
        editorAssets: [nextAsset, ...compositionEditorAssets],
      }, `Add ${kind} editor asset`);
    }
    setSourceBinTab('editorAssets');
    recordActivityTrailWorkspaceEvent('editor', 'Create Video editor asset', kind, 'toolbar');

    if (nextAsset.kind === 'text') {
      setTextEditDialog({
        mode: 'asset',
        targetId: nextAsset.id,
        title: 'Edit Text Asset',
        draft: buildTextDraftFromAsset(nextAsset),
      });
    }
  };

  const placeEditorAssetOnTrack = (asset: EditorAsset, trackIndex = 0) => {
    if (!activeComposition) {
      return;
    }

    const nextClip = buildVisualClipFromEditorAsset(asset, {
      trackIndex,
      startMs: getVisualTrackEndMs(visualBlocks, trackIndex),
    });

    commitActiveCompositionPatch({
      editorVisualClips: [...visualClips, nextClip],
    }, 'Place editor asset on timeline');
    setSelectedVisualClipId(nextClip.id);
    setSelectedAudioClipId(undefined);
    setSelectedStageObjectId(undefined);
    recordActivityTrailWorkspaceEvent('editor', 'Place editor asset on timeline', `V${trackIndex + 1}`, 'toolbar');
  };

  const updateStageObject = (objectId: string, patch: Partial<EditorStageObject>) => {
    if (!activeComposition) {
      return;
    }

    commitActiveCompositionPatch({
      editorStageObjects: stageObjects.map((object) =>
        object.id === objectId
          ? ({ ...object, ...patch } as EditorStageObject)
          : object,
      ),
    }, 'Update stage object');
  };

  const removeStageObject = (objectId: string) => {
    if (!activeComposition) {
      return;
    }

    commitActiveCompositionPatch({
      editorStageObjects: stageObjects.filter((object) => object.id !== objectId),
    }, 'Remove stage object');
    setSelectedStageObjectId(undefined);
  };

  const updateSelectedVisualClip = (patch: Partial<EditorVisualClip>) => {
    if (!selectedVisualClip) {
      return;
    }

    const progressPercent = selectedVisualDurationSeconds
      ? getVisualClipProgressPercent(selectedVisualClip, selectedVisualDurationSeconds, timelineCursorSeconds)
      : 0;

    updateVisualClips(
      visualClips.map((clip) =>
        clip.id === selectedVisualClip.id
          ? applyVisualClipPatchAtProgress(clip, progressPercent, patch)
          : clip,
      ),
    );
  };

  const updateVisualClipById = (clipId: string, patch: Partial<EditorVisualClip>) => {
    updateVisualClips(
      visualClips.map((clip) =>
        clip.id === clipId
          ? 'keyframes' in patch
            ? ensureVisualClipHasKeyframes({ ...clip, ...patch })
            : { ...clip, ...patch }
          : clip,
      ),
    );
  };

  const openTextAssetEditDialog = (asset: EditorAsset) => {
    if (asset.kind !== 'text') {
      return;
    }

    if (!compositionEditorAssets.some((candidate) => candidate.id === asset.id)) {
      commitActiveCompositionPatch({
        editorAssets: [asset, ...compositionEditorAssets],
      }, 'Materialize source text asset');
    }

    setContextMenu(null);
    setTextEditDialog({
      mode: 'asset',
      targetId: asset.id,
      title: 'Edit Text Asset',
      draft: buildTextDraftFromAsset(asset),
    });
  };

  const openTextClipEditDialog = (clip: EditorVisualClip) => {
    if (clip.sourceKind !== 'text') {
      return;
    }

    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    const asset = editorAssetById.get(clip.sourceNodeId);

    setContextMenu(null);
    setTextEditDialog({
      mode: 'clip',
      targetId: clip.id,
      title: 'Edit Timeline Text',
      draft: buildTextDraftFromClip(clip, asset, sourceItem),
    });
  };

  const updateTextEditDraft = (patch: Partial<TextEditDraft>) => {
    setTextEditDialog((current) =>
      current
        ? {
            ...current,
            draft: { ...current.draft, ...patch },
          }
        : current,
    );
  };

  const saveTextEditDialog = () => {
    if (!textEditDialog || !activeComposition) {
      return;
    }

    const draft = normalizeTextEditDraft(textEditDialog.draft);

    if (textEditDialog.mode === 'asset') {
      commitActiveCompositionPatch({
        editorAssets: compositionEditorAssets.map((asset) =>
          asset.id === textEditDialog.targetId && asset.kind === 'text'
            ? {
                ...asset,
                label: buildTextAssetLabel(draft.text),
                updatedAt: Date.now(),
                textDefaults: {
                  text: draft.text,
                  fontFamily: draft.fontFamily,
                  fontWeight: draft.fontWeight,
                  fontStyle: draft.fontStyle,
                  managedFace: draft.managedFace,
                  managedFaceIssue: draft.managedFaceIssue,
                  fontSizePx: draft.fontSizePx,
                  color: draft.color,
                  textEffect: draft.textEffect,
                  textBackgroundOpacityPercent: 0,
                },
              }
            : asset,
        ),
      }, 'Edit text asset');
    } else {
      const existingTypography = visualClips.find((c) => c.id === textEditDialog.targetId)?.textTypography;
      updateVisualClipById(textEditDialog.targetId, {
        textContent: draft.text,
        textFontFamily: draft.fontFamily,
        textSizePx: draft.fontSizePx,
        textColor: draft.color,
        textEffect: draft.textEffect,
        textBackgroundOpacityPercent: 0,
        textTypography: {
          ...existingTypography,
          fontWeight: draft.fontWeight,
          fontStyle: draft.fontStyle,
          managedFace: draft.managedFace,
          managedFaceIssue: draft.managedFaceIssue,
        },
      });
    }

    setTextEditDialog(null);
  };

  const addVisualOpacityAutomationPoint = (clipId: string, point: TimelineAutomationPoint) => {
    const clip = visualClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    updateVisualClips(
      visualClips.map((candidate) =>
        candidate.id === clipId
          ? upsertVisualKeyframe(candidate, point.timePercent, { opacityPercent: Math.round(point.valuePercent) })
          : candidate,
      ),
      'Add opacity keyframe',
    );
  };

  const updateVisualOpacityAutomationPoint = (
    clipId: string,
    pointIndex: number,
    point: TimelineAutomationPoint,
  ) => {
    const clip = visualClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    const keyframes = normalizeVisualKeyframes(clip);

    if (!keyframes[pointIndex]) {
      return;
    }

    const nextKeyframes = keyframes.map((candidate, index) => {
      if (index !== pointIndex) {
        return candidate;
      }

      return {
        ...candidate,
        timePercent: index === 0 ? 0 : index === keyframes.length - 1 ? 100 : point.timePercent,
        opacityPercent: Math.round(point.valuePercent),
      };
    });

    updateVisualClips(
      visualClips.map((candidate) =>
        candidate.id === clipId
          ? ensureVisualClipHasKeyframes({ ...candidate, keyframes: nextKeyframes })
          : candidate,
      ),
      'Update opacity keyframe',
    );
  };

  const removeVisualOpacityAutomationPoint = (clipId: string, pointIndex: number) => {
    const clip = visualClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    const keyframes = normalizeVisualKeyframes(clip);

    if (pointIndex <= 0 || pointIndex >= keyframes.length - 1) {
      return;
    }

    updateVisualClips(
      visualClips.map((candidate) =>
        candidate.id === clipId
          ? removeVisualKeyframe(candidate, pointIndex)
          : candidate,
      ),
      'Remove opacity keyframe',
    );
  };

  const updateSelectedAudioClip = (patch: Partial<EditorAudioClip>) => {
    if (!selectedAudioClip) {
      return;
    }

    updateAudioClips(
      audioClips.map((clip) => (clip.id === selectedAudioClip.id ? { ...clip, ...patch } : clip)),
    );
  };

  const persistParameterKeyframeTracks = (tracks: readonly VideoParamKeyframeTrack[], label: string) => {
    const persistedDurationMs = Math.max(1, Math.round((selectedVisualDurationSeconds ?? selectedAudioDurationSeconds ?? 0.001) * 1_000));
    const parameterKeyframes = tracks.map((track) => ({
      id: track.id,
      parameter: track.parameterId,
      durationMs: persistedDurationMs,
      keyframes: [...track.keyframes]
        .sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id))
        .map((keyframe) => ({
          id: keyframe.id,
          timeMs: keyframe.timeMs,
          value: keyframe.value,
          interpolation: keyframe.interpolation === 'cubic-bezier' ? 'bezier' as const : keyframe.interpolation,
          bezier: keyframe.bezier ? {
            outX: keyframe.bezier.x1,
            outY: keyframe.bezier.y1,
            inX: keyframe.bezier.x2,
            inY: keyframe.bezier.y2,
          } : undefined,
        })),
    }));
    if (selectedVisualClip) {
      const durationMs = Math.max(1, Math.round((selectedVisualDurationSeconds ?? 0.001) * 1_000));
      updateVisualClips(visualClips.map((clip) => {
        if (clip.id !== selectedVisualClip.id) return clip;
        let next: EditorVisualClip = { ...clip, professional: { ...(clip.professional ?? {}), parameterKeyframes } };
        for (const track of tracks) {
          for (const keyframe of track.keyframes) {
            const progress = Math.max(0, Math.min(100, (keyframe.timeMs / durationMs) * 100));
            const keyframePatch = track.parameterId === 'opacity' ? { opacityPercent: keyframe.value }
              : track.parameterId === 'scale' ? { scalePercent: keyframe.value }
                : track.parameterId === 'rotation' ? { rotationDeg: keyframe.value }
                  : track.parameterId === 'position-x' ? { positionX: keyframe.value }
                    : track.parameterId === 'position-y' ? { positionY: keyframe.value }
                      : undefined;
            if (keyframePatch) next = upsertVisualKeyframe(next, progress, keyframePatch);
          }
        }
        return next;
      }), label);
    } else if (selectedAudioClip) {
      const durationMs = Math.max(1, Math.round((selectedAudioDurationSeconds ?? 0.001) * 1_000));
      updateAudioClips(audioClips.map((clip) => {
        if (clip.id !== selectedAudioClip.id) return clip;
        let next: EditorAudioClip = { ...clip, professional: { pan: clip.professional?.pan ?? 0, ...(clip.professional ?? {}), parameterKeyframes } };
        const volumeTrack = tracks.find((track) => track.parameterId === 'volume');
        for (const keyframe of volumeTrack?.keyframes ?? []) {
          next = upsertAudioKeyframe(next, Math.max(0, Math.min(100, (keyframe.timeMs / durationMs) * 100)), { volumePercent: keyframe.value });
        }
        return next;
      }), label);
    }
  };

  const addParameterKeyframe = (trackId: string, timeMs: number) => {
    const next = parameterKeyframeTracks.map((track) => {
      if (track.id !== trackId) return track;
      const existing = track.keyframes.find((keyframe) => Math.abs(keyframe.timeMs - timeMs) < 0.5);
      const value = existing?.value ?? track.defaultValue;
      const keyframe = { id: existing?.id ?? `parameter-key-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, timeMs, value, interpolation: existing?.interpolation ?? 'linear' as const };
      return { ...track, keyframes: [...track.keyframes.filter((candidate) => candidate.id !== existing?.id), keyframe].sort((left, right) => left.timeMs - right.timeMs) };
    });
    persistParameterKeyframeTracks(next, 'Add parameter keyframe');
  };

  const changeParameterKeyframe = (trackId: string, keyframeId: string, patch: Partial<VideoParamKeyframeTrack['keyframes'][number]>) => {
    const next = parameterKeyframeTracks.map((track) => track.id === trackId
      ? { ...track, keyframes: track.keyframes.map((keyframe) => keyframe.id === keyframeId ? { ...keyframe, ...patch } : keyframe) }
      : track);
    persistParameterKeyframeTracks(next, 'Update parameter keyframe');
  };

  const removeParameterKeyframe = (trackId: string, keyframeId: string) => {
    persistParameterKeyframeTracks(parameterKeyframeTracks.map((track) => track.id === trackId
      ? { ...track, keyframes: track.keyframes.filter((keyframe) => keyframe.id !== keyframeId) }
      : track), 'Remove parameter keyframe');
  };

  const previewTranscriptSelection = () => {
    if (!selectedTranscriptMatch || editableTranscriptWords.length === 0) return;
    let proposal: TranscriptEditProposal;
    try {
      proposal = proposeTranscriptSelectionEdit({
        words: editableTranscriptWords,
        selection: { kind: 'time-range', startMs: selectedTranscriptMatch.startMs, endMs: selectedTranscriptMatch.endMs },
      });
    } catch (error) {
      setPendingTranscriptProposal(undefined);
      setTranscriptPreviewSummary(`Transcript patch preview rejected: ${error instanceof Error ? error.message : 'invalid transcript selection.'}`);
      return;
    }
    setPendingTranscriptProposal(proposal);
    if (!activeComposition || !editableTranscriptSourceItem) {
      setTranscriptPreviewSummary('Open a sequence using this transcribed source to preview the timeline patch.');
      return;
    }
    const plan = planWorkspaceTranscriptEdit({
      visualClips,
      audioClips,
      selectedVisualClipIds,
      selectedAudioClipIds,
      visualTrackCount,
      audioTrackCount,
      lockedVisualTrackIndexes: lockedVisualTracks,
      lockedAudioTrackIndexes: lockedAudioTracks,
      audioDurationMsByClipId: Object.fromEntries(audioBlocks.map((block) => [block.clip.id, Math.max(1, Math.round(block.durationSeconds * 1_000))])),
      words: editableTranscriptWords,
      sourceProposal: proposal,
      sourceItemIdentityIds: [editableTranscriptSourceItem.id, editableTranscriptSourceItem.nodeId],
    });
    setTranscriptPreviewSummary(summarizeWorkspaceTranscriptPlan(plan, proposal));
  };

  const applyPendingTranscriptEdit = () => {
    if (!pendingTranscriptProposal || !activeComposition || !editableTranscriptSourceItem) return;
    const plan = planWorkspaceTranscriptEdit({
      visualClips,
      audioClips,
      selectedVisualClipIds,
      selectedAudioClipIds,
      visualTrackCount,
      audioTrackCount,
      lockedVisualTrackIndexes: lockedVisualTracks,
      lockedAudioTrackIndexes: lockedAudioTracks,
      audioDurationMsByClipId: Object.fromEntries(audioBlocks.map((block) => [block.clip.id, Math.max(1, Math.round(block.durationSeconds * 1_000))])),
      words: editableTranscriptWords,
      sourceProposal: pendingTranscriptProposal,
      sourceItemIdentityIds: [editableTranscriptSourceItem.id, editableTranscriptSourceItem.nodeId],
    });
    if (!plan.ok && plan.kind !== 'apply-rejected') {
      void showAlertDialog({
        title: 'Choose A Timeline Occurrence',
        message: plan.detail,
        tone: 'warning',
      });
      return;
    }
    if (!plan.ok) {
      void showAlertDialog({ title: 'Transcript Edit Rejected', message: plan.detail, tone: 'danger' });
      return;
    }
    const nextMarkers = transitionClipOwnedTimelineMarkers(visualClips, audioClips, plan.value.visualClips, plan.value.audioClips);
    commitActiveCompositionPatch({
      editorVisualClips: plan.value.visualClips,
      editorAudioClips: plan.value.audioClips,
      ...markerPatchFor(nextMarkers),
    }, pendingTranscriptProposal.title);
    setPendingTranscriptProposal(undefined);
    setSelectedTranscriptMatch(undefined);
    setTranscriptMatches([]);
    setTranscriptSearchError(undefined);
    setTranscriptPreviewSummary(undefined);
  };

  const updateProjectSequenceBins = (
    nextBins: EditorProfessionalWorkflowState['editorial']['sequenceBins'],
    label: string,
  ) => {
    const bounded = nextBins.slice(0, 128);
    for (const node of compositionNodes) {
      const state = sanitizeEditorProfessionalWorkflowState(node.data.editorProfessionalWorkflowState);
      const nextState = sanitizeEditorProfessionalWorkflowState({
        ...state,
        editorial: { ...state.editorial, sequenceBins: bounded },
      });
      if (node.id === activeComposition?.id) {
        handleProfessionalWorkflowStateChange(nextState, label);
      } else {
        patchNodeData(node.id, { editorProfessionalWorkflowState: nextState });
      }
    }
  };

  const handleProjectNavigatorCommand = (command: ProjectNavigatorCommand) => {
    if (command.kind === 'activate-sequence') {
      setActiveCompositionId(command.sequenceId);
      return;
    }
    if (command.kind === 'open-tab') {
      setSequenceNavigatorTabs((current) => current.some((tab) => tab.sequenceId === command.sequenceId)
        ? current
        : [...current, { sequenceId: command.sequenceId, pinned: false }].slice(-32));
      setActiveCompositionId(command.sequenceId);
      return;
    }
    if (command.kind === 'close-tab') {
      setSequenceNavigatorTabs((current) => current.filter((tab) => tab.sequenceId !== command.sequenceId || tab.pinned));
      return;
    }
    if (command.kind === 'toggle-tab-pin') {
      setSequenceNavigatorTabs((current) => current.map((tab) => tab.sequenceId === command.sequenceId ? { ...tab, pinned: command.pinned } : tab));
      return;
    }
    if (command.kind === 'toggle-bin') {
      setCollapsedSequenceBinIds((current) => command.collapsed
        ? [...new Set([...current, command.binId])]
        : current.filter((id) => id !== command.binId));
      return;
    }
    if (command.kind === 'create-bin') {
      const id = `sequence-bin-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
      updateProjectSequenceBins([...projectSequenceBins, { id, name: command.name, sequenceIds: [] }], 'Create sequence bin');
      return;
    }
    if (command.kind === 'move-to-bin') {
      updateProjectSequenceBins(projectSequenceBins.map((bin) => ({
        ...bin,
        sequenceIds: bin.id === command.binId
          ? [...bin.sequenceIds.filter((id) => id !== command.sequenceId), command.sequenceId]
          : bin.sequenceIds.filter((id) => id !== command.sequenceId),
      })), 'Move sequence to bin');
      return;
    }
    const source = compositionNodes.find((node) => node.id === command.sequenceId);
    if (!source) return;
    if (command.kind === 'rename-sequence') {
      patchNodeData(source.id, { customTitle: command.name });
      return;
    }
    if (command.kind === 'duplicate-sequence') {
      const nextId = addNode('composition', { x: source.position.x + 48, y: source.position.y + 48 }, {
        ...source.data,
        customTitle: command.suggestedName,
        result: undefined,
        resultOutputMetadata: undefined,
      });
      setSequenceNavigatorTabs((current) => [...current, { sequenceId: nextId, pinned: false }].slice(-32));
      setActiveCompositionId(nextId);
      return;
    }
    if (command.kind === 'delete-sequence') {
      if (compositionNodes.length <= 1) {
        void showAlertDialog({ title: 'Sequence Required', message: 'A Video project must keep at least one composition.', tone: 'warning' });
        return;
      }
      const deletion = planVideoSequenceDeletion(sequenceNavigatorModel, source.id);
      if (!deletion.canDelete) {
        void showAlertDialog({
          title: 'Sequence Is In Use',
          message: deletion.blockers.length > 0
            ? `Remove these dependencies before deleting ${sequenceNavigatorModel.sequences.find((sequence) => sequence.id === source.id)?.name ?? 'the sequence'}: ${deletion.blockers.map((blocker) => blocker.label).join('; ')}.`
            : 'The selected sequence could not be found in the project navigator.',
          tone: 'warning',
        });
        return;
      }
      updateProjectSequenceBins(projectSequenceBins.map((bin) => ({
        ...bin,
        sequenceIds: bin.sequenceIds.filter((sequenceId) => sequenceId !== source.id),
      })), 'Remove sequence from project bins');
      if (deletion.nextActiveSequenceId) setActiveCompositionId(deletion.nextActiveSequenceId);
      void onNodesChange([{ id: source.id, type: 'remove' }]);
    }
  };

  const updateEditorialSourcePatch = (sourceKind: 'video' | 'audio', patch: { targetTrackId?: string; enabled?: boolean }) => {
    const current = professionalWorkflowState.editorial.sourcePatches.find((candidate) => candidate.sourceKind === sourceKind) ?? {
      id: `source-patch-${sourceKind}`,
      sourceKind,
      sourceTrackIndex: 0,
      targetTrackId: `${sourceKind}:0`,
      enabled: true,
    };
    const next = { ...current, ...patch };
    handleProfessionalWorkflowStateChange({
      ...professionalWorkflowState,
      editorial: {
        ...professionalWorkflowState.editorial,
        sourcePatches: [...professionalWorkflowState.editorial.sourcePatches.filter((candidate) => candidate.sourceKind !== sourceKind), next],
        recordTargetTrackIds: [...new Set([...professionalWorkflowState.editorial.recordTargetTrackIds.filter((id) => id !== current.targetTrackId), next.targetTrackId])],
      },
    }, `Update ${sourceKind} source patch`);
  };

  const writeTimelineClipboard = (operation: 'copy' | 'cut') => {
    if (!activeComposition) return;
    const selectedIds = [...selectedVisualClipIds, ...selectedAudioClipIds];
    const built = buildVideoClipClipboard({
      operation,
      sourceSequenceId: activeComposition.id,
      sourceRevision: currentCompositionRenderCacheSignature,
      clips: videoClipboardClips,
      selectedClipIds: selectedIds,
      tracks: videoClipboardTracks,
    });
    if (!built.ok) {
      void showAlertDialog({ title: 'Timeline Clipboard Unavailable', message: built.errors.map((error) => error.message).join(' '), tone: 'warning' });
      return;
    }
    setTimelineClipClipboard(built.document);
    // Capture the selection's clip-owned markers with their offsets resolved against the current
    // clip positions, so legacy markers without an explicit offset still paste relatively.
    setTimelineClipMarkerClipboard(captureTimelineClipMarkerClipboard(timelineMarkers, visualClips, audioClips, selectedIds));
    if (operation === 'cut') {
      commitActiveCompositionPatch(
        buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, selectedIds),
        `Cut ${selectedIds.length} timeline clip${selectedIds.length === 1 ? '' : 's'}`,
      );
      clearTimelineSelection();
    }
  };

  const pasteTimelineClipboard = (mode: 'overwrite' | 'insert' = 'overwrite') => {
    if (!activeComposition || !timelineClipClipboard) return;
    const plan = planVideoClipPaste({
      clipboard: timelineClipClipboard,
      destinationSequenceId: activeComposition.id,
      atMs: Math.round(timelineCursorSeconds * 1_000),
      mode,
      tracks: videoClipboardTracks,
      availableSourceItemIds: new Set(timelineSourceItems.flatMap((item) => [item.id, item.nodeId])),
      existingClips: videoClipboardClips,
    });
    if (!plan.ok) {
      void showAlertDialog({ title: 'Paste Rejected', message: plan.errors.map((error) => error.message).join(' '), tone: 'danger' });
      return;
    }
    const shifts = new Map(plan.plan.insertShifts.map((shift) => [shift.clipId, shift.deltaMs]));
    const materializeVisual = (descriptor: VideoClipboardTimelineClip): EditorVisualClip => {
      if (descriptor.authoredClip?.kind === 'visual') return descriptor.authoredClip.clip;
      const source = sourceItemByNodeId.get(descriptor.sourceItemId);
      const trackIndex = Number(descriptor.trackId.split(':')[1] ?? 0);
      const clip = createEditorVisualClip(descriptor.sourceItemId, source?.kind === 'image' || source?.kind === 'composition' ? source.kind : 'video', {
        trackIndex,
        startMs: descriptor.startMs,
        sourceInMs: descriptor.sourceInMs,
        sourceOutMs: descriptor.sourceOutMs,
        durationSeconds: descriptor.durationMs / 1_000,
      });
      return {
        ...clip,
        id: descriptor.id,
        professional: { trackId: descriptor.trackId, linkGroupId: descriptor.linkGroupId, syncGroupId: descriptor.syncGroupId },
      };
    };
    const materializeAudio = (descriptor: VideoClipboardTimelineClip): EditorAudioClip => {
      if (descriptor.authoredClip?.kind === 'audio') return descriptor.authoredClip.clip;
      const clip = createEditorAudioClip(descriptor.sourceItemId, Number(descriptor.trackId.split(':')[1] ?? 0), {
        id: descriptor.id,
        offsetMs: descriptor.startMs,
        sourceInMs: descriptor.sourceInMs,
        sourceOutMs: descriptor.sourceOutMs ?? descriptor.sourceInMs + descriptor.durationMs,
      });
      return {
        ...clip,
        id: descriptor.id,
        professional: { pan: 0, trackId: descriptor.trackId, linkGroupId: descriptor.linkGroupId, syncGroupId: descriptor.syncGroupId },
      };
    };
    const pastedVisual = plan.plan.clips.filter((clip) => clip.kind === 'visual').map(materializeVisual);
    const pastedAudio = plan.plan.clips.filter((clip) => clip.kind === 'audio').map(materializeAudio);
    const overwriteReplacementById = new Map(plan.plan.overwriteReplacements.map((replacement) => [replacement.originalClipId, replacement]));
    const nextVisual = visualClips.flatMap((clip) => {
      const replacement = overwriteReplacementById.get(clip.id);
      if (replacement) return replacement.retainedFragments.filter((fragment) => fragment.kind === 'visual').map(materializeVisual);
      return [shifts.has(clip.id) ? { ...clip, startMs: clip.startMs + (shifts.get(clip.id) ?? 0) } : clip];
    });
    const nextAudio = audioClips.flatMap((clip) => {
      const replacement = overwriteReplacementById.get(clip.id);
      if (replacement) return replacement.retainedFragments.filter((fragment) => fragment.kind === 'audio').map(materializeAudio);
      return [shifts.has(clip.id) ? { ...clip, offsetMs: clip.offsetMs + (shifts.get(clip.id) ?? 0) } : clip];
    });
    // Paste remaps clip-marker ownership onto the pasted clip copies with collision-free marker
    // ids; overwritten originals partition their surviving markers onto retained fragments, and
    // insert-shifted clips keep their owned markers aligned through the commit reconciliation.
    const nextMarkers = planClipTimelineMarkerPaste({
      markers: timelineMarkers,
      clipboardMarkers: timelineClipMarkerClipboard,
      pastedClips: plan.plan.clips.map((descriptor) => ({
        id: descriptor.id,
        copiedFromClipId: descriptor.copiedFromClipId,
        startMs: descriptor.startMs,
      })),
      overwriteFragments: new Map(plan.plan.overwriteReplacements.map((replacement) => [
        replacement.originalClipId,
        replacement.retainedFragments.map((fragment) => ({
          id: fragment.id,
          startMs: fragment.startMs,
          durationMs: fragment.durationMs,
        })),
      ])),
      now: Date.now(),
    });
    commitActiveCompositionPatch({
      editorVisualClips: [...nextVisual, ...pastedVisual],
      editorAudioClips: [...nextAudio, ...pastedAudio],
      ...(nextMarkers !== timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
    }, `${mode === 'insert' ? 'Insert' : 'Overwrite'} paste timeline clips`);
    setSelectedVisualClipIds(pastedVisual.map((clip) => clip.id), pastedVisual.at(-1)?.id);
    setSelectedAudioClipIds(pastedAudio.map((clip) => clip.id), pastedAudio.at(-1)?.id);
    if (timelineClipClipboard.operation === 'cut') {
      setTimelineClipClipboard(undefined);
      setTimelineClipMarkerClipboard([]);
    }
  };

  const applySyncManagedClips = (managed: readonly VideoSyncManagedClip[], label: string) => {
    const byId = new Map(managed.map((clip) => [clip.id, clip]));
    commitActiveCompositionPatch({
      editorVisualClips: visualClips.map((clip) => {
        const update = byId.get(clip.id);
        if (!update) return clip;
        return { ...clip, professional: { ...(clip.professional ?? {}), linkGroupId: update.linkGroupId, syncGroupId: update.syncGroupId } };
      }),
      editorAudioClips: audioClips.map((clip) => {
        const update = byId.get(clip.id);
        if (!update) return clip;
        return { ...clip, professional: { pan: clip.professional?.pan ?? 0, ...(clip.professional ?? {}), linkGroupId: update.linkGroupId, syncGroupId: update.syncGroupId } };
      }),
    }, label);
  };

  const mutateSelectedSyncState = (kind: 'link' | 'unlink' | 'group' | 'ungroup') => {
    const selectedIds = [...selectedVisualClipIds, ...selectedAudioClipIds];
    const locks = { lockedTrackIds: new Set(videoClipboardTracks.filter((track) => track.locked).map((track) => track.id)) };
    if (kind === 'link' || kind === 'unlink') {
      const result = kind === 'link'
        ? linkVideoClips(videoSyncManagedClips, selectedIds, `link-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, locks)
        : unlinkVideoClips(videoSyncManagedClips, selectedIds, locks);
      if (!result.ok) {
        void showAlertDialog({ title: 'Clip Link Rejected', message: result.errors.map((error) => error.message).join(' '), tone: 'warning' });
        return;
      }
      applySyncManagedClips(result.clips, kind === 'link' ? 'Link selected clips' : 'Unlink selected clips');
      return;
    }
    const existingGroupIds = [...new Set(videoSyncManagedClips.flatMap((clip) => clip.syncGroupId ? [clip.syncGroupId] : []))];
    const state = {
      groups: existingGroupIds.map((id) => {
        const members = videoSyncManagedClips.filter((clip) => clip.syncGroupId === id);
        const anchor = members[0]!;
        return { id, anchorClipId: anchor.id, createdRevisionKey: currentCompositionRenderCacheSignature, members: members.map((clip) => ({ clipId: clip.id, expectedDeltaMs: (clip.startMs - clip.sourceInMs) - (anchor.startMs - anchor.sourceInMs) })) };
      }),
    };
    const result = kind === 'group'
      ? groupVideoClipsForSync({ clips: videoSyncManagedClips, clipIds: selectedIds, groupId: `sync-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, revisionKey: currentCompositionRenderCacheSignature, state, locks })
      : ungroupVideoSyncGroups({ clips: videoSyncManagedClips, groupIds: [...new Set(selectedIds.flatMap((id) => videoSyncManagedClips.find((clip) => clip.id === id)?.syncGroupId ?? []))], state, locks });
    if (!result.ok) {
      void showAlertDialog({ title: 'Sync Group Rejected', message: result.errors.map((error) => error.message).join(' '), tone: 'warning' });
      return;
    }
    applySyncManagedClips(result.clips, kind === 'group' ? 'Group selected clips for sync' : 'Ungroup selected sync clips');
  };

  const updateAudioClipById = (clipId: string, patch: Partial<EditorAudioClip>) => {
    updateAudioClips(
      audioClips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
    );
  };

  const updateAudioTrackVolume = (trackIndex: number, volumePercent: number) => {
    if (!activeComposition) {
      return;
    }

    const nextVolumes = [...audioTrackVolumes];
    nextVolumes[trackIndex] = Math.max(0, Math.min(100, Math.round(volumePercent)));
    commitActiveCompositionPatch({
      editorAudioTrackVolumes: nextVolumes,
    }, 'Update audio track volume');
  };

  const toggleAudioTrackMute = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch({
      editorMutedAudioTracks: toggleAudioTrackIndex(mutedAudioTracks, trackIndex),
    }, mutedAudioTracks.includes(trackIndex) ? 'Unmute audio track' : 'Mute audio track');
  };

  const toggleAudioTrackSolo = (trackIndex: number) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch({
      editorSoloAudioTracks: toggleAudioTrackIndex(soloAudioTracks, trackIndex),
    }, soloAudioTracks.includes(trackIndex) ? 'Unsolo audio track' : 'Solo audio track');
  };

  const addAudioVolumeAutomationPoint = (clipId: string, point: TimelineAutomationPoint) => {
    const clip = audioClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    updateAudioClipById(clipId, {
      volumeAutomationPoints: normalizeAutomationPoints(
        [...normalizeAutomationPoints(clip.volumeAutomationPoints, 100), point],
        100,
      ),
    });
  };

  const updateAudioVolumeAutomationPoint = (
    clipId: string,
    pointIndex: number,
    point: TimelineAutomationPoint,
  ) => {
    const clip = audioClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    const normalizedPoints = normalizeAutomationPoints(clip.volumeAutomationPoints, 100);

    if (!normalizedPoints[pointIndex]) {
      return;
    }

    const nextPoints = normalizedPoints.map((candidate, index) => {
      if (index !== pointIndex) {
        return candidate;
      }

      return {
        timePercent:
          index === 0 ? 0 : index === normalizedPoints.length - 1 ? 100 : point.timePercent,
        valuePercent: point.valuePercent,
      };
    });

    updateAudioClipById(clipId, {
      volumeAutomationPoints: normalizeAutomationPoints(nextPoints, 100),
    });
  };

  const removeAudioVolumeAutomationPoint = (clipId: string, pointIndex: number) => {
    const clip = audioClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    const normalizedPoints = normalizeAutomationPoints(clip.volumeAutomationPoints, 100);

    if (pointIndex <= 0 || pointIndex >= normalizedPoints.length - 1) {
      return;
    }

    updateAudioClipById(clipId, {
      volumeAutomationPoints: normalizeAutomationPoints(
        normalizedPoints.filter((_, index) => index !== pointIndex),
        100,
      ),
    });
  };

  const addOrUpdateKeyframeAtPlayhead = useCallback(() => {
    if (selectedVisualClip && selectedVisualDurationSeconds) {
      const progressPercent = getVisualClipProgressPercent(
        selectedVisualClip,
        selectedVisualDurationSeconds,
        timelineCursorSeconds,
      );
      const nextClip = upsertVisualKeyframe(selectedVisualClip, progressPercent);

      updateVisualClips(
        visualClips.map((clip) => (clip.id === selectedVisualClip.id ? nextClip : clip)),
        'Add visual keyframe',
      );
      return;
    }

    if (selectedAudioClip && selectedAudioDurationSeconds) {
      const progressPercent = getAudioClipProgressPercent(
        selectedAudioClip,
        selectedAudioDurationSeconds,
        timelineCursorSeconds,
      );
      const nextClip = upsertAudioKeyframe(selectedAudioClip, progressPercent);

      updateAudioClips(
        audioClips.map((clip) => (clip.id === selectedAudioClip.id ? nextClip : clip)),
        'Add volume keyframe',
      );
    }
  }, [
    audioClips,
    selectedAudioClip,
    selectedAudioDurationSeconds,
    selectedVisualClip,
    selectedVisualDurationSeconds,
    timelineCursorSeconds,
    updateAudioClips,
    updateVisualClips,
    visualClips,
  ]);

  // Ctrl/Cmd+Alt+Up/Down: nudge opacity (visual clip) or volume (audio clip) at the playhead.
  // upsertVisual/AudioKeyframe samples the interpolated state first, so when no keyframe exists
  // at the playhead one is created there before the nudge lands — the owner's requested behavior.
  const nudgeSelectedClipLevelAtPlayhead = useCallback((deltaPercent: number): boolean => {
    if (selectedVisualClip && selectedVisualDurationSeconds) {
      const progressPercent = getVisualClipProgressPercent(
        selectedVisualClip,
        selectedVisualDurationSeconds,
        timelineCursorSeconds,
      );
      const currentOpacity = getVisualKeyframeStateAtProgress(selectedVisualClip, progressPercent).opacityPercent;
      const nextClip = upsertVisualKeyframe(selectedVisualClip, progressPercent, {
        opacityPercent: Math.max(0, Math.min(100, Math.round(currentOpacity + deltaPercent))),
      });

      updateVisualClips(
        visualClips.map((clip) => (clip.id === selectedVisualClip.id ? nextClip : clip)),
        'Nudge opacity keyframe',
      );
      return true;
    }

    if (selectedAudioClip && selectedAudioDurationSeconds) {
      const progressPercent = getAudioClipProgressPercent(
        selectedAudioClip,
        selectedAudioDurationSeconds,
        timelineCursorSeconds,
      );
      const currentVolume = getAudioKeyframeStateAtProgress(selectedAudioClip, progressPercent).volumePercent;
      const nextClip = upsertAudioKeyframe(selectedAudioClip, progressPercent, {
        volumePercent: Math.max(0, Math.min(150, Math.round(currentVolume + deltaPercent))),
      });

      updateAudioClips(
        audioClips.map((clip) => (clip.id === selectedAudioClip.id ? nextClip : clip)),
        'Nudge volume keyframe',
      );
      return true;
    }

    return false;
  }, [
    audioClips,
    selectedAudioClip,
    selectedAudioDurationSeconds,
    selectedVisualClip,
    selectedVisualDurationSeconds,
    timelineCursorSeconds,
    updateAudioClips,
    updateVisualClips,
    visualClips,
  ]);

  useEffect(() => {
    nudgeSelectedClipLevelAtPlayheadRef.current = nudgeSelectedClipLevelAtPlayhead;
  });

  const jumpToAdjacentSelectedKeyframe = useCallback((direction: 'previous' | 'next') => {
    if (selectedVisualClip && selectedVisualDurationSeconds) {
      const currentPercent = getVisualClipProgressPercent(
        selectedVisualClip,
        selectedVisualDurationSeconds,
        timelineCursorSeconds,
      );
      const targetPercent = getAdjacentKeyframePercent(
        getVisualKeyframePercents(selectedVisualClip),
        currentPercent,
        direction,
      );
      const targetSeconds = selectedVisualClip.startMs / 1000 + (targetPercent / 100) * selectedVisualDurationSeconds;

      setTimelineCursorSeconds(Math.max(0, Math.min(displayTimelineSecondsRef.current, targetSeconds)));
      return;
    }

    if (selectedAudioClip && selectedAudioDurationSeconds) {
      const currentPercent = getAudioClipProgressPercent(
        selectedAudioClip,
        selectedAudioDurationSeconds,
        timelineCursorSeconds,
      );
      const targetPercent = getAdjacentKeyframePercent(
        getAudioKeyframePercents(selectedAudioClip),
        currentPercent,
        direction,
      );
      const targetSeconds = selectedAudioClip.offsetMs / 1000 + (targetPercent / 100) * selectedAudioDurationSeconds;

      setTimelineCursorSeconds(Math.max(0, Math.min(displayTimelineSecondsRef.current, targetSeconds)));
    }
  }, [
    selectedAudioClip,
    selectedAudioDurationSeconds,
    selectedVisualClip,
    selectedVisualDurationSeconds,
    setTimelineCursorSeconds,
    timelineCursorSeconds,
  ]);

  const handleNativeMenuCommand = useCallback((command: NativeMenuCommand) => {
    const togglePanelId = VIDEO_PANEL_TOGGLE_COMMANDS[command];
    if (togglePanelId) {
      // Window > Panels toggle: hide a shown panel, restore a hidden one to docked
      // (same contract as the Image/Paper workspaces).
      const panels = useDockablePanelStore.getState();
      const key = panelKey(VIDEO_WORKSPACE_ID, togglePanelId);
      const mode = resolveDockablePanelMode(panels.layouts[key]?.mode, panels.defaults[key]?.mode);
      if (getDockablePanelToggleMode(mode) === 'hidden') {
        panels.hidePanel(VIDEO_WORKSPACE_ID, togglePanelId);
      } else {
        panels.setPanelMode(VIDEO_WORKSPACE_ID, togglePanelId, 'docked');
      }
      return;
    }
    if (command === 'editor:reset-panels') {
      // Full reset (legacy workspace snapshot + dockable layout) — the same behavior the old
      // floating "Reset Video Panels" pill performed before it was removed with the dead top band.
      resetVideoPanelLayout();
      return;
    }
    switch (command) {
      case 'edit:undo':
        undoEditor();
        return;
      case 'edit:redo':
        redoEditor();
        return;
      case 'edit:select-all': {
        const visualIds = visualClips.slice(0, 2_000).map((clip) => clip.id);
        const audioIds = audioClips.slice(0, Math.max(0, 2_000 - visualIds.length)).map((clip) => clip.id);
        setSelectedVisualClipIds(visualIds, visualIds.at(-1));
        setSelectedAudioClipIds(audioIds, audioIds.at(-1));
        return;
      }
      case 'edit:deselect':
        clearTimelineSelection();
        return;
      case 'edit:copy':
        writeTimelineClipboard('copy');
        return;
      case 'edit:cut':
        writeTimelineClipboard('cut');
        return;
      case 'edit:paste':
        pasteTimelineClipboard('overwrite');
        return;
      case 'edit:delete':
        if (selectedStageObjectId && activeComposition) {
          commitActiveCompositionPatch({
            editorStageObjects: stageObjects.filter((object) => object.id !== selectedStageObjectId),
          }, 'Remove stage object');
          setSelectedStageObjectId(undefined);
          return;
        }

        {
          const selectedTimelineIds = new Set([...selectedVisualClipIds, ...selectedAudioClipIds].slice(0, 2_000));
          if (selectedTimelineIds.size === 0 || !activeComposition) return;
          const hasLockedSelection = visualClips.some((clip) => selectedTimelineIds.has(clip.id) && isVisualTrackLocked(clip.trackIndex))
            || audioClips.some((clip) => selectedTimelineIds.has(clip.id) && isAudioTrackLocked(clip.trackIndex));
          if (hasLockedSelection) {
            void showAlertDialog({ title: 'Delete Rejected', message: 'Unlock every selected clip track before deleting the selection.', tone: 'warning' });
            return;
          }
          commitActiveCompositionPatch(
            buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, selectedTimelineIds),
            `Remove ${selectedTimelineIds.size} selected timeline clip${selectedTimelineIds.size === 1 ? '' : 's'}`,
          );
          clearTimelineSelection();
        }
        return;
      case 'timeline:select':
        setTimelineTool('select');
        return;
      case 'timeline:cut':
        if (!cutSelectedVisualClipAtPlayheadRef.current(false)) {
          setTimelineTool('cut');
        }
        return;
      case 'timeline:marquee':
        setTimelineTool('marquee');
        return;
      case 'timeline:ripple':
        setTimelineTool('ripple');
        return;
      case 'timeline:roll':
        setTimelineTool('roll');
        return;
      case 'timeline:slip':
        setTimelineTool('slip');
        return;
      case 'timeline:slide':
        setTimelineTool('slide');
        return;
      case 'timeline:rate-stretch':
        setTimelineTool('rate-stretch');
        return;
      case 'timeline:hand':
        setTimelineTool('hand');
        return;
      case 'timeline:snap':
        setTimelineTool('snap');
        return;
      case 'timeline:play-pause':
        setShuttleRate((current) => toggleShuttlePlay(current));
        return;
      case 'timeline:shuttle-reverse':
        setShuttleRate((current) => stepShuttleRate(current, -1));
        return;
      case 'timeline:shuttle-stop':
        setShuttleRate(0);
        return;
      case 'timeline:shuttle-forward':
        setShuttleRate((current) => stepShuttleRate(current, 1));
        return;
      case 'timeline:mark-in':
        markSourcePointRef.current('in');
        return;
      case 'timeline:mark-out':
        markSourcePointRef.current('out');
        return;
      case 'timeline:clear-in':
        setSourceMarks((current) => current ? { ...current, inSeconds: undefined } : current);
        return;
      case 'timeline:clear-out':
        setSourceMarks((current) => current ? { ...current, outSeconds: undefined } : current);
        return;
      case 'timeline:insert':
        performThreePointEditRef.current('insert');
        return;
      case 'timeline:overwrite':
        performThreePointEditRef.current('overwrite');
        return;
      case 'timeline:lift':
      case 'timeline:extract': {
        const selectedId = selectedVisualClipId ?? selectedAudioClipId;
        if (selectedId) handleProfessionalSourceRecordCommand({
          kind: command === 'timeline:lift' ? 'lift' : 'extract',
          playheadMs: Math.round(timelineCursorSeconds * 1_000),
        });
        return;
      }
      case 'timeline:add-edit':
        cutSelectedVisualClipAtPlayheadRef.current(false);
        if (selectedAudioClipId) splitAudioClipAtSeconds(selectedAudioClipId, timelineCursorSeconds, false);
        return;
      case 'timeline:previous-edit':
      case 'timeline:next-edit':
        handleProfessionalSourceRecordCommand({
          kind: command === 'timeline:previous-edit' ? 'previous-edit' : 'next-edit',
          playheadMs: Math.round(timelineCursorSeconds * 1_000),
        });
        return;
      case 'timeline:track-select-forward':
      case 'timeline:track-select-backward': {
        const primaryVisual = visualClips.find((clip) => clip.id === selectedVisualClipId);
        const primaryAudio = audioClips.find((clip) => clip.id === selectedAudioClipId);
        if (primaryVisual) {
          const ids = visualBlocks
            .filter((block) => block.clip.trackIndex === primaryVisual.trackIndex)
            .filter((block) => command === 'timeline:track-select-forward'
              ? block.endSeconds >= timelineCursorSeconds
              : block.startSeconds <= timelineCursorSeconds)
            .map((block) => block.clip.id)
            .slice(0, 2_000);
          setSelectedVisualClipIds(ids, ids.at(-1));
        } else if (primaryAudio) {
          const ids = audioBlocks
            .filter((block) => block.clip.trackIndex === primaryAudio.trackIndex)
            .filter((block) => command === 'timeline:track-select-forward'
              ? block.endSeconds >= timelineCursorSeconds
              : block.startSeconds <= timelineCursorSeconds)
            .map((block) => block.clip.id)
            .slice(0, 2_000);
          setSelectedAudioClipIds(ids, ids.at(-1));
        }
        return;
      }
      case 'timeline:zoom-selection': {
        const selectedRanges = [
          ...visualBlocks.filter((block) => selectedVisualClipIds.includes(block.clip.id)),
          ...audioBlocks.filter((block) => selectedAudioClipIds.includes(block.clip.id)),
        ];
        if (selectedRanges.length) {
          const inSeconds = Math.min(...selectedRanges.map((block) => block.startSeconds));
          const outSeconds = Math.max(...selectedRanges.map((block) => block.endSeconds));
          const span = Math.max(0.001, outSeconds - inSeconds);
          setTimelineZoomPercent(clampTimelineZoomPercent((displayTimelineSeconds / span) * 100, timelineMaxZoomPercent));
          setTimelineCursorSeconds(inSeconds);
        }
        return;
      }
      case 'timeline:zoom-in-out': {
        const inSeconds = sourceMarks?.inSeconds;
        const outSeconds = sourceMarks?.outSeconds;
        if (inSeconds !== undefined && outSeconds !== undefined && outSeconds > inSeconds) {
          setTimelineZoomPercent(clampTimelineZoomPercent((displayTimelineSeconds / (outSeconds - inSeconds)) * 100, timelineMaxZoomPercent));
          setTimelineCursorSeconds(inSeconds);
        }
        return;
      }
      case 'timeline:zoom-playhead':
        setTimelineZoomPercent((current) => clampTimelineZoomPercent(current * 2, timelineMaxZoomPercent));
        return;
      case 'timeline:previous-zoom':
        setTimelineZoomPercent(100);
        return;
      case 'timeline:trim-nudge-back':
        if (professionalTrimPreview) {
          handleProfessionalTrimCommand({ kind: 'update', deltaFrames: (professionalTrimSummary?.deltaFrames ?? 0) - 1 });
        } else {
          handleProfessionalTrimCommand({ kind: 'begin', mode: 'ripple', deltaFrames: -1 });
        }
        return;
      case 'timeline:trim-nudge-forward':
        if (professionalTrimPreview) {
          handleProfessionalTrimCommand({ kind: 'update', deltaFrames: (professionalTrimSummary?.deltaFrames ?? 0) + 1 });
        } else {
          handleProfessionalTrimCommand({ kind: 'begin', mode: 'ripple', deltaFrames: 1 });
        }
        return;
      case 'timeline:trim-commit':
        handleProfessionalTrimCommand({ kind: 'commit' });
        return;
      case 'timeline:trim-cancel':
        handleProfessionalTrimCommand({ kind: 'cancel' });
        return;
      case 'timeline:add-marker':
        addTimelineMarkerAtPlayheadRef.current();
        return;
      case 'timeline:previous-marker':
      case 'timeline:next-marker': {
        const marker = findAdjacentTimelineMarker(
          timelineMarkers,
          timelineCursorSeconds,
          command === 'timeline:previous-marker' ? 'previous' : 'next',
        );
        if (marker) setTimelineCursorSeconds(marker.seconds);
        return;
      }
      case 'timeline:link':
        mutateSelectedSyncState('link');
        return;
      case 'timeline:unlink':
        mutateSelectedSyncState('unlink');
        return;
      case 'timeline:group':
        mutateSelectedSyncState('group');
        return;
      case 'timeline:ungroup':
        mutateSelectedSyncState('ungroup');
        return;
      case 'timeline:add-keyframe':
        addOrUpdateKeyframeAtPlayhead();
        return;
      case 'timeline:previous-keyframe':
        jumpToAdjacentSelectedKeyframe('previous');
        return;
      case 'timeline:next-keyframe':
        jumpToAdjacentSelectedKeyframe('next');
        return;
      case 'help:keyboard-shortcuts':
        setHelpOpen(true);
        return;
      default:
        return;
    }
  }, [
    activeComposition,
    addOrUpdateKeyframeAtPlayhead,
    audioClips,
    audioBlocks,
    clearTimelineSelection,
    commitActiveCompositionPatch,
    displayTimelineSeconds,
    handleProfessionalSourceRecordCommand,
    handleProfessionalTrimCommand,
    jumpToAdjacentSelectedKeyframe,
    redoEditor,
    professionalTrimPreview,
    professionalTrimSummary,
    selectedAudioClipIds,
    selectedAudioClipId,
    selectedVisualClipIds,
    selectedStageObjectId,
    selectedVisualClipId,
    setSelectedAudioClipId,
    setSelectedStageObjectId,
    setSelectedVisualClipId,
    setHelpOpen,
    setTimelineTool,
    sourceMarks,
    stageObjects,
    timelineCursorSeconds,
    timelineMarkers,
    timelineMaxZoomPercent,
    undoEditor,
    visualBlocks,
    visualClips,
    writeTimelineClipboard,
    pasteTimelineClipboard,
    mutateSelectedSyncState,
  ]);

  useNativeMenuCommand(handleNativeMenuCommand, {
    commands: VIDEO_NATIVE_MENU_COMMANDS,
  });

  useEffect(() => {
    if (!professionalTrimPreview) return;
    const handleTrimKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        handleProfessionalTrimCommand({ kind: 'cancel' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleProfessionalTrimCommand({ kind: 'commit' });
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        handleProfessionalTrimCommand({
          kind: 'update',
          deltaFrames: (professionalTrimSummary?.deltaFrames ?? 0) + (event.key === 'ArrowLeft' ? -1 : 1),
        });
      }
    };
    window.addEventListener('keydown', handleTrimKeyDown);
    return () => window.removeEventListener('keydown', handleTrimKeyDown);
  }, [handleProfessionalTrimCommand, professionalTrimPreview, professionalTrimSummary?.deltaFrames]);

  const updateSelectedVisualKeyframe = (
    keyframeIndex: number,
    patch: Parameters<typeof updateVisualKeyframe>[2],
  ) => {
    if (!selectedVisualClip) {
      return;
    }

    updateVisualClips(
      visualClips.map((clip) =>
        clip.id === selectedVisualClip.id
          ? updateVisualKeyframe(clip, keyframeIndex, patch)
          : clip,
      ),
      'Update visual keyframe',
    );
  };

  const removeSelectedVisualKeyframe = (keyframeIndex: number) => {
    if (!selectedVisualClip) {
      return;
    }

    updateVisualClips(
      visualClips.map((clip) =>
        clip.id === selectedVisualClip.id
          ? removeVisualKeyframe(clip, keyframeIndex)
          : clip,
      ),
      'Remove visual keyframe',
    );
  };

  const updateSelectedAudioKeyframe = (
    keyframeIndex: number,
    patch: Parameters<typeof updateAudioKeyframe>[2],
  ) => {
    if (!selectedAudioClip) {
      return;
    }

    updateAudioClips(
      audioClips.map((clip) =>
        clip.id === selectedAudioClip.id
          ? updateAudioKeyframe(clip, keyframeIndex, patch)
          : clip,
      ),
      'Update volume keyframe',
    );
  };

  const removeSelectedAudioKeyframe = (keyframeIndex: number) => {
    if (!selectedAudioClip) {
      return;
    }

    updateAudioClips(
      audioClips.map((clip) =>
        clip.id === selectedAudioClip.id
          ? removeAudioKeyframe(clip, keyframeIndex)
          : clip,
      ),
      'Remove volume keyframe',
    );
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.key === '[') {
        event.preventDefault();
        jumpToAdjacentSelectedKeyframe('previous');
        return;
      }

      if (event.key === ']') {
        event.preventDefault();
        jumpToAdjacentSelectedKeyframe('next');
        return;
      }

      // Shift+K adds/updates a keyframe. Bare K became the JKL transport STOP (the NLE-standard
      // binding) — without the shift requirement, stopping the shuttle also dropped a keyframe.
      if (event.key.toLowerCase() === 'k' && event.shiftKey) {
        event.preventDefault();
        addOrUpdateKeyframeAtPlayhead();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [addOrUpdateKeyframeAtPlayhead, jumpToAdjacentSelectedKeyframe]);

  const snapTimelineInteractionSeconds = useCallback((seconds: number, shiftKey: boolean) =>
    resolveTimelineSnapSeconds(seconds, {
      // labeled markers snap like snap points do
      snapPoints: [...timelineSnapPoints, ...timelineMarkers.map((marker) => marker.seconds)],
      shiftKey,
      maxSeconds: displayTimelineSeconds,
    }), [displayTimelineSeconds, timelineMarkers, timelineSnapPoints]);

  const commitTimelineSnapPoints = (nextPoints: number[], label = 'Update timeline snap points') => {
    commitActiveCompositionPatch({ editorTimelineSnapPoints: nextPoints }, label);
  };

  const addTimelineMarkerAtPlayhead = () => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorTimelineMarkers: addTimelineMarker(timelineMarkers, timelineCursorSeconds) },
      'Add timeline marker',
    );
  };
  const addTimelineMarkerAtPlayheadRef = useRef(addTimelineMarkerAtPlayhead);
  useEffect(() => {
    addTimelineMarkerAtPlayheadRef.current = addTimelineMarkerAtPlayhead;
  });

  const removeTimelineMarkerById = (markerId: string) => {
    if (!activeComposition) return;
    commitActiveCompositionPatch(
      { editorTimelineMarkers: removeTimelineMarker(timelineMarkers, markerId) },
      'Remove timeline marker',
    );
  };

  const commitRichTimelineMarkers = (markers: readonly VideoRichMarker[], label: string) => {
    commitActiveCompositionPatch({
      editorTimelineMarkers: markers.map(videoRichMarkerToTimelineMarker),
    }, label);
  };

  // Structural clip edits (advanced trim sessions, lift/extract, transcript-applied edits, batch
  // operations, slip) run their owned markers through the same content-anchored transition
  // policy: prune removed clips, shift offsets through head trims, follow moves, and re-own
  // surviving fragments. Markers owned by clips outside the edit are untouched.
  const transitionClipOwnedTimelineMarkers = (
    beforeVisual: readonly EditorVisualClip[],
    beforeAudio: readonly EditorAudioClip[],
    afterVisual: readonly EditorVisualClip[],
    afterAudio: readonly EditorAudioClip[],
  ): TimelineMarker[] => applyClipSetTransitionToTimelineMarkers(
    timelineMarkers,
    buildEditorClipMarkerTransitionDescriptors(beforeVisual, beforeAudio, resolveEditorClipMarkerTiming(beforeVisual, beforeAudio)),
    buildEditorClipMarkerTransitionDescriptors(afterVisual, afterAudio, resolveEditorClipMarkerTiming(afterVisual, afterAudio)),
  );
  const markerPatchFor = (nextMarkers: TimelineMarker[]) => nextMarkers !== timelineMarkers
    ? { editorTimelineMarkers: nextMarkers }
    : {};

  const handleSearchMarkersCommand = (command: SearchMarkersCommand) => {
    if (command.kind === 'add-marker') {
      const now = Date.now();
      commitRichTimelineMarkers(upsertVideoRichMarker(richTimelineMarkers, {
        id: `marker-${globalThis.crypto?.randomUUID?.() ?? now}`,
        name: command.draft.name,
        notes: command.draft.notes,
        kind: command.draft.kind,
        color: command.draft.color,
        target: command.draft.target,
        createdAt: now,
        updatedAt: now,
      }), 'Add rich timeline marker');
      return;
    }
    if (command.kind === 'delete-marker') {
      commitRichTimelineMarkers(removeVideoRichMarker(richTimelineMarkers, command.markerId), 'Remove rich timeline marker');
      return;
    }
    if (command.kind === 'request-export') {
      const sequenceId = activeComposition?.id ?? 'video-sequence';
      downloadProfessionalText(
        command.format === 'json' ? exportVideoRichMarkersJson(sequenceId, richTimelineMarkers) : exportVideoRichMarkersCsv(richTimelineMarkers),
        `video-markers.${command.format}`,
        command.format === 'json' ? 'application/json' : 'text/csv',
      );
      return;
    }
    setMarkerImportFormat(command.format);
    markerImportRef.current?.click();
  };

  const importRichTimelineMarkers = async (file: File) => {
    try {
      const targetSequenceId = activeComposition?.id;
      const text = await readVideoRichMarkerImportFile(file);
      const imported = markerImportFormat === 'json' ? importVideoRichMarkersJson(text) : importVideoRichMarkersCsv(text);
      const review = reviewVideoRichMarkerImport(imported, {
        importedSequenceId: 'sequenceId' in imported && typeof imported.sequenceId === 'string'
          ? imported.sequenceId
          : undefined,
        expectedSequenceId: targetSequenceId,
      });
      const approved = await requestVideoMarkerImportApproval(
        review,
        (message, title) => useConfirmationStore.getState().requestConfirmation(message, title),
      );
      if (!approved) return;
      if (targetSequenceId && useEditorStore.getState().activeCompositionId !== targetSequenceId) {
        await showAlertDialog({
          title: 'Marker Import Canceled',
          message: 'The active sequence changed while marker import was awaiting confirmation. No markers were replaced.',
          tone: 'warning',
        });
        return;
      }
      commitRichTimelineMarkers(imported.markers, `Import ${markerImportFormat.toUpperCase()} markers`);
    } catch (error) {
      await showAlertDialog({ title: 'Marker Import Failed', message: error instanceof Error ? error.message : 'The marker document could not be imported.', tone: 'danger' });
    }
  };

  const addTimelineSnapAtSeconds = (seconds: number, shiftKey: boolean): number => {
    const nextPoints = addTimelineSnapPoint(timelineSnapPoints, seconds, shiftKey, displayTimelineSeconds);
    const snappedSeconds = resolveTimelineSnapSeconds(seconds, {
      snapPoints: nextPoints,
      shiftKey,
      maxSeconds: displayTimelineSeconds,
    });

    commitTimelineSnapPoints(nextPoints, 'Add timeline snap point');
    setTimelineCursorSeconds(snappedSeconds);
    return snappedSeconds;
  };

  const clearTimelineSnapPoints = () => {
    commitTimelineSnapPoints([], 'Clear timeline snap points');
  };

  // nextTrackIndex is set only while a cross-track vertical drag is hovering a different lane
  // (undefined keeps horizontal-only drags working exactly as before). A locked destination track
  // rejects the move via resolveClipTrackIndexPatch, leaving the clip on its current track.
  const moveVisualClip = (clipId: string, nextStartSeconds: number, shiftKey = false, nextTrackIndex?: number) => {
    const snappedStartSeconds = snapTimelineInteractionSeconds(nextStartSeconds, shiftKey);

    updateVisualClips(
      visualClips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              startMs: Math.max(0, Math.round(snappedStartSeconds * 1000)),
              trackIndex: resolveClipTrackIndexPatch(clip.trackIndex, nextTrackIndex, isVisualTrackLocked),
            }
          : clip,
      ),
    );
  };

  const moveAudioClip = (clipId: string, nextStartSeconds: number, shiftKey = false, nextTrackIndex?: number) => {
    const snappedStartSeconds = snapTimelineInteractionSeconds(nextStartSeconds, shiftKey);

    updateAudioClips(
      audioClips.map((clip) =>
        clip.id === clipId
          ? {
              ...clip,
              offsetMs: Math.max(0, Math.round(snappedStartSeconds * 1000)),
              trackIndex: resolveClipTrackIndexPatch(clip.trackIndex, nextTrackIndex, isAudioTrackLocked),
            }
          : clip,
      ),
    );
  };

  const slipVisualClip = (clipId: string, deltaSeconds: number) => {
    const clip = visualClips.find((candidate) => candidate.id === clipId);

    if (!clip || (clip.sourceKind !== 'video' && clip.sourceKind !== 'composition')) {
      return;
    }

    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    const sourceDurationSeconds = sourceItem ? (getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0) : 0;

    if (sourceDurationSeconds <= 0) {
      return;
    }

    const sourceDurationMs = Math.max(250, Math.round(sourceDurationSeconds * 1000));
    const sourceRange = resolveVisualClipSourceRangeMs(clip, sourceDurationSeconds);
    const deltaMs = Math.round(deltaSeconds * 1000 * Math.max(0.25, clip.playbackRate || 1));
    const sourceWindowMs = Math.max(250, sourceRange.durationMs);
    const nextSourceInMs = Math.max(
      0,
      Math.min(sourceDurationMs - sourceWindowMs, sourceRange.sourceInMs + deltaMs),
    );
    const nextSourceOutMs = Math.min(sourceDurationMs, nextSourceInMs + sourceWindowMs);

    const slippedClip: EditorVisualClip = {
      ...clip,
      sourceInMs: nextSourceInMs,
      sourceOutMs: nextSourceOutMs,
      trimStartMs: nextSourceInMs,
      trimEndMs: Math.max(0, sourceDurationMs - nextSourceOutMs),
    };
    // Slip is content-anchored: owned markers follow the source window like the advanced slip
    // session policy instead of resting at their previous timeline position.
    const nextMarkers = transitionClipOwnedTimelineMarkers([clip], [], [slippedClip], []);
    commitActiveCompositionPatch({
      editorVisualClips: visualClips.map((candidate) => (candidate.id === clipId ? slippedClip : candidate)),
      ...markerPatchFor(nextMarkers),
    }, 'Slip visual clip');
  };

  // Alt-drag edge trims RIPPLE: later clips on the lane follow the length change. The lane fires
  // phase 'start' on pointerdown so every move recomputes from this snapshot (nothing compounds).
  const trimRippleBaseRef = useRef<EditorVisualClip[] | null>(null);
  const audioTrimBaseRef = useRef<EditorAudioClip[] | null>(null);

  const trimVisualClipFromEdge = (
    clip: EditorVisualClip,
    edge: TimelineClipEdge,
    deltaSeconds: number,
    shiftKey: boolean,
    options?: { altKey?: boolean; phase?: 'start' | 'move' },
  ) => {
    if (options?.phase === 'start') {
      trimRippleBaseRef.current = visualClips;
      return;
    }
    if (isVisualTrackLocked(clip.trackIndex)) return;
    const baseClips = trimRippleBaseRef.current ?? visualClips;
    const baseClip = baseClips.find((candidate) => candidate.id === clip.id) ?? clip;
    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    const sourceDurationSeconds =
      sourceItem ? getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0 : clip.durationSeconds ?? 4;
    const nextClip = trimVisualClipEdge(baseClip, {
      edge,
      deltaSeconds,
      sourceDurationSeconds: Math.max(0.25, sourceDurationSeconds),
      shiftKey,
    });

    if (!options?.altKey) {
      // Clip markers follow the trim policy: the content anchor keeps its sequence time, the
      // owned offset shifts with a start-edge trim, and out-of-range markers are removed.
      const nextMarkers = applyClipTrimToTimelineMarkers(timelineMarkers, {
        clipId: clip.id,
        previousStartMs: baseClip.startMs,
        nextStartMs: nextClip.startMs,
        contentShiftMs: nextClip.startMs - baseClip.startMs,
        nextDurationMs: Math.round(resolveVisualClipDuration(nextClip, sourceItemByNodeId, durationMap) * 1_000),
      });
      commitActiveCompositionPatch({
        editorVisualClips: baseClips.map((candidate) => (candidate.id === clip.id ? nextClip : candidate)),
        ...(nextMarkers !== timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
      }, 'Trim visual clip edge');
      return;
    }

    // RIPPLE: timeline length of a clip = still duration, or source window / playback rate.
    const lengthMs = (candidate: EditorVisualClip): number => {
      if (candidate.sourceOutMs === undefined && (candidate.sourceKind === 'image' || candidate.sourceKind === 'text' || candidate.sourceKind === 'shape' || candidate.sourceKind === 'comic')) {
        return Math.round((candidate.durationSeconds ?? 4) * 1000);
      }
      const rate = Math.max(0.25, candidate.playbackRate || 1);
      const inMs = candidate.sourceInMs ?? candidate.trimStartMs ?? 0;
      const outMs = candidate.sourceOutMs ?? Math.round(Math.max(0.25, sourceDurationSeconds) * 1000) - (candidate.trimEndMs ?? 0);
      return Math.round(Math.max(40, outMs - inMs) / rate);
    };
    const lengthDeltaMs = lengthMs(nextClip) - lengthMs(baseClip);
    // Ripple keeps the clip's own START anchored on both edges (the lib shifts startMs for
    // start-edge trims to keep the end fixed — ripple wants the opposite).
    const rippledClip = edge === 'start' ? { ...nextClip, startMs: baseClip.startMs } : nextClip;

    const rippledMarkers = applyClipTrimToTimelineMarkers(timelineMarkers, {
      clipId: clip.id,
      previousStartMs: baseClip.startMs,
      nextStartMs: rippledClip.startMs,
      contentShiftMs: nextClip.startMs - baseClip.startMs,
      nextDurationMs: Math.round(resolveVisualClipDuration(nextClip, sourceItemByNodeId, durationMap) * 1_000),
    });
    commitActiveCompositionPatch({
      editorVisualClips: baseClips.map((candidate) => {
        if (candidate.id === clip.id) return rippledClip;
        if (candidate.trackIndex === baseClip.trackIndex && candidate.startMs > baseClip.startMs) {
          return { ...candidate, startMs: Math.max(0, candidate.startMs + lengthDeltaMs) };
        }
        return candidate;
      }),
      // Later clips on the lane shift with the ripple; the central marker reconciliation in the
      // commit updates their owned markers' displayed sequence time in the same patch.
      ...(rippledMarkers !== timelineMarkers ? { editorTimelineMarkers: rippledMarkers } : {}),
    }, 'Ripple trim visual clip edge');
  };

  const trimAudioClipFromEdge = (
    clip: EditorAudioClip,
    edge: TimelineClipEdge,
    deltaSeconds: number,
    shiftKey: boolean,
    options?: { phase?: 'start' | 'move' },
  ) => {
    if (options?.phase === 'start') {
      audioTrimBaseRef.current = audioClips;
      return;
    }
    if (isAudioTrackLocked(clip.trackIndex)) return;
    const baseClips = audioTrimBaseRef.current ?? audioClips;
    const baseClip = baseClips.find((candidate) => candidate.id === clip.id) ?? clip;
    const sourceItem = sourceItemByNodeId.get(baseClip.sourceNodeId);
    const sourceDurationSeconds = getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0;
    if (sourceDurationSeconds <= 0) return;
    const snappedDeltaSeconds = shiftKey ? Math.round(deltaSeconds) : deltaSeconds;
    const nextClip = trimEditorAudioClipEdge(baseClip, edge, snappedDeltaSeconds, sourceDurationSeconds);
    const nextMarkers = applyClipTrimToTimelineMarkers(timelineMarkers, {
      clipId: baseClip.id,
      previousStartMs: baseClip.offsetMs,
      nextStartMs: nextClip.offsetMs,
      contentShiftMs: nextClip.offsetMs - baseClip.offsetMs,
      nextDurationMs: resolveEditorAudioSourceRangeMs(nextClip, sourceDurationSeconds).durationMs,
    });
    commitActiveCompositionPatch({
      editorAudioClips: baseClips.map((candidate) => candidate.id === clip.id ? nextClip : candidate),
      ...(nextMarkers !== timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
    }, 'Trim audio clip edge');
  };

  const fillVisualTimelineGap = (gap: TimelineGap) => {
    updateVisualClips(fillTimelineGap(visualClips, gap), 'Fill timeline gap');
    setSelectedTimelineGap(null);
    setContextMenu(null);
  };

  const startTimelineHandPan = (event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    const container = timelineScrollRef.current;

    if (!container) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startScrollLeft = container.scrollLeft;
    const startScrollTop = container.scrollTop;

    const onMove = (moveEvent: PointerEvent) => {
      container.scrollLeft = startScrollLeft - (moveEvent.clientX - startX);
      container.scrollTop = startScrollTop - (moveEvent.clientY - startY);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startPanelResize = (
    event: React.PointerEvent<HTMLDivElement>,
    panel: 'inspectorWidth' | 'sourceBinWidth',
    invert = false,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = panel === 'inspectorWidth' ? inspectorWidth : sourceBinWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = invert ? startX - moveEvent.clientX : moveEvent.clientX - startX;
      setPanelWidth(panel, startWidth + delta);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMonitorSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const container = event.currentTarget.parentElement;

    if (!container) {
      return;
    }

    const bounds = container.getBoundingClientRect();

    const onMove = (moveEvent: PointerEvent) => {
      const nextPercent = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setMonitorSplitPercent(nextPercent);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startMonitorHeightResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startHeight = monitorSectionHeight;

    const onMove = (moveEvent: PointerEvent) => {
      setMonitorSectionHeight(startHeight + (moveEvent.clientY - startY));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startTimelineTrackResize = (
    event: React.PointerEvent<HTMLElement>,
    trackType: 'visual' | 'audio',
  ) => {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startHeight = trackType === 'visual' ? timelineVisualTrackHeight : timelineAudioTrackHeight;

    const onMove = (moveEvent: PointerEvent) => {
      setTimelineTrackHeight(trackType, resizeTimelineTrackHeight(startHeight, startY, moveEvent.clientY));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const openSourceBinImportPicker = async (
    accept: string,
    linkedKinds?: Array<'video' | 'audio'>,
  ) => {
    if (linkedKinds?.length && onImportMedia) {
      setMediaImportDialog({
        accept,
        kinds: linkedKinds,
        handling: 'link',
        busy: false,
      });
      return;
    }

    if (!importAcceptRef.current) {
      return;
    }

    importAcceptRef.current.accept = accept;
    importAcceptRef.current.value = '';
    importAcceptRef.current.click();
  };

  const confirmMediaImport = async () => {
    if (!mediaImportDialog || mediaImportDialog.busy || !onImportMedia) {
      return;
    }

    const request = mediaImportDialog;
    setMediaImportDialog({ ...request, busy: true });
    const handled = await onImportMedia(request.kinds, request.handling);

    if (handled) {
      setSourceBinSearchQuery('');
      setSourceBinKindFilter('all');
      setSourceBinOriginFilter('ingested');
      setMediaImportDialog(null);
      return;
    }

    setMediaImportDialog(null);
    if (importAcceptRef.current) {
      importAcceptRef.current.accept = request.accept;
      importAcceptRef.current.value = '';
      importAcceptRef.current.click();
    }
  };

  const importFilesForActiveBin = async (files: FileList) => {
    const fileList = Array.from(files);
    const imageFiles = fileList.filter((file) => inferSourceKindFromFile(file.name, file.type) === 'image');
    const captionFiles = fileList.filter((file) => inferSourceKindFromFile(file.name, file.type) === 'subtitle');
    const mediaFiles = fileList.filter((file) => {
      const kind = inferSourceKindFromFile(file.name, file.type);
      return kind !== 'image' && kind !== 'subtitle';
    });

    setSourceBinSearchQuery('');
    setSourceBinOriginFilter('ingested');

    if (mediaFiles.length > 0) {
      await importFiles(mediaFiles);
    }

    if (captionFiles.length > 0) {
      const importedCaptionClips: EditorVisualClip[] = [];

      for (const file of captionFiles) {
        const text = await file.text();
        const cues = parseCaptionText(text, getCaptionFormatFromFileName(file.name));
        const libraryItem = await addAssetItem({
          label: file.name,
          kind: 'subtitle',
          mimeType: file.type || (file.name.toLowerCase().endsWith('.srt') ? 'application/x-subrip' : 'text/vtt'),
          dataUrl: await blobToDataUrl(file),
          isGenerated: false,
        });

        if (activeComposition && cues.length > 0) {
          importedCaptionClips.push(...captionCuesToTextClips(cues, {
            sourceNodeId: libraryItem.id,
            trackIndex: visualTrackCount - 1,
          }));
        }
      }

      if (activeComposition && importedCaptionClips.length > 0) {
        commitActiveCompositionPatch({
          editorVisualClips: [...visualClips, ...importedCaptionClips],
        }, 'Import caption clips');
      }
    }

    if (imageFiles.length === 0) {
      return;
    }

    if (!activeComposition) {
      await importFiles(imageFiles);
      return;
    }

    const importedImageAssets: EditorAsset[] = [];

    for (const file of imageFiles) {
      const libraryItem = await addAssetItem({
        label: file.name,
        kind: 'image',
        mimeType: file.type || 'image/png',
        dataUrl: await blobToDataUrl(file),
        isGenerated: false,
      });

      importedImageAssets.push(createEditorAsset('image', {
        label: libraryItem.label,
        imageSourceId: libraryItem.id,
      }));
    }

    if (importedImageAssets.length > 0) {
      commitActiveCompositionPatch({
        editorAssets: [...importedImageAssets, ...compositionEditorAssets],
      }, 'Import editor image assets');
      setSourceBinTab('editorAssets');
    }
  };

  const importPaperStoryboardPages = async () => {
    if (isImportingPaperStoryboardPages) {
      return;
    }

    if (paperDocument.pages.length === 0) {
      setPaperStoryboardImportStatus('No Paper pages are available.');
      return;
    }

    setIsImportingPaperStoryboardPages(true);
    setPaperStoryboardImportStatus(`Preparing ${paperDocument.pages.length} Paper page${paperDocument.pages.length === 1 ? '' : 's'}...`);

    try {
      // One immutable linked-source snapshot owns this storyboard publication: materialization
      // consumes exactly the pinned revisions, and the same guard re-proves them immediately
      // before the first Source write so a mid-preparation replacement publishes nothing.
      const storyboardSourceGuard = createPaperPlacedDocumentRasterizationGuard(
        paperDocument,
        () => useSourceBinStore.getState().getAllItems(),
      );
      const materializedDocument = await materializePaperDocumentAssetUrls(
        paperDocument,
        storyboardSourceGuard.sourceItems,
      );
      const exact = await buildPaperDocumentExactManagedFontOutput(materializedDocument);
      storyboardSourceGuard();
      const importedItems = await publishPaperStoryboardPageSourcePayloads(exact.document, {
        fontFaceCss: exact.fontFaceCss,
      }, addAssetItem, storyboardSourceGuard);
      const importedItemIds = importedItems.map((item) => item.id);

      setSourceBinSearchQuery('');
      setSourceBinKindFilter('image');
      setSourceBinTab('editorAssets');
      if (importedItemIds[0]) {
        setSelectedSourceItemId(importedItemIds[0]);
      }
      setPaperStoryboardImportStatus(`Ready: ${importedItemIds.length} Paper page${importedItemIds.length === 1 ? '' : 's'} in Video assets.`);
    } catch (error) {
      setPaperStoryboardImportStatus(error instanceof Error ? error.message : 'Could not prepare Paper pages for Video.');
    } finally {
      setIsImportingPaperStoryboardPages(false);
    }
  };

  const sendSourceItemToFlow = (item: SourceBinItem) => {
    const position = getNewFlowNodePosition();
    const type = getFlowNodeTypeForSourceBinItem(item);
    const nodeId = addNode(type, position);
    const libraryItem = libraryItems.find((candidate) => candidate.id === item.id);
    patchNodeData(nodeId, buildFlowNodePatchForSourceBinItem({
      ...item,
      assetId: libraryItem?.assetId,
    }));

    setWorkspaceView('flow');
    setContextMenu(null);
  };

  const autoCaptionSourceItem = async (item: SourceBinItem) => {
    if (!activeComposition || !['audio', 'video', 'composition'].includes(item.kind)) return;
    const position = getNewFlowNodePosition();
    const sourceNodeId = addNode(getFlowNodeTypeForSourceBinItem(item), position);
    const libraryItem = libraryItems.find((candidate) => candidate.id === item.id);
    patchNodeData(sourceNodeId, buildFlowNodePatchForSourceBinItem({
      ...item,
      assetId: libraryItem?.assetId,
    }));
    const transcriptionNodeId = addNode('transcriptionNode', { x: position.x + 380, y: position.y });
    useFlowStore.getState().onConnect({
      source: sourceNodeId,
      sourceHandle: null,
      target: transcriptionNodeId,
      targetHandle: 'media',
    });
    setContextMenu(null);
    patchNodeData(activeComposition.id, {
      statusMessage: `Creating captions for ${item.label}…`,
      error: undefined,
    });

    await runNode(transcriptionNodeId);
    const completedNode = useFlowStore.getState().nodes.find((candidate) => candidate.id === transcriptionNodeId);
    const captionOutput = completedNode?.data.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.vtt];
    const captionItem = captionOutput?.sourceBinItemId
      ? useSourceBinStore.getState().getAllItems().find((candidate) => candidate.id === captionOutput.sourceBinItemId)
      : undefined;

    if (!captionItem) {
      await showAlertDialog({
        title: 'Auto Captions Did Not Complete',
        message: completedNode?.data.error ?? 'No WebVTT caption file was produced.',
        tone: 'warning',
      });
      return;
    }

    await applyCaptionSourceItem(mapLibraryItemToEditorSourceItem(captionItem));
  };

  const cleanDialogueSourceItem = async (item: SourceBinItem) => {
    if (!activeComposition || !['audio', 'video', 'composition'].includes(item.kind)) return;
    const compositionId = activeComposition.id;

    const matchingAudioClips = audioClips.filter((clip) => sourceItemByNodeId.get(clip.sourceNodeId)?.id === item.id);
    const selectedMatchingAudioClip = matchingAudioClips.find((clip) => clip.id === selectedAudioClipId);
    const plannedOriginalAudioClipId = (selectedMatchingAudioClip ?? (matchingAudioClips.length === 1 ? matchingAudioClips[0] : undefined))?.id;
    const matchingVisualClips = visualClips.filter((clip) => sourceItemByNodeId.get(clip.sourceNodeId)?.id === item.id);
    const selectedMatchingVisualClip = matchingVisualClips.find((clip) => clip.id === selectedVisualClipId);
    const plannedOriginalVisualClipId = (selectedMatchingVisualClip ?? (matchingVisualClips.length === 1 ? matchingVisualClips[0] : undefined))?.id;

    const position = getNewFlowNodePosition();
    const sourceNodeId = addNode(getFlowNodeTypeForSourceBinItem(item), position);
    const libraryItem = libraryItems.find((candidate) => candidate.id === item.id);
    patchNodeData(sourceNodeId, buildFlowNodePatchForSourceBinItem({
      ...item,
      assetId: libraryItem?.assetId,
    }));
    const audioProcessNodeId = addNode('audioProcessNode', { x: position.x + 380, y: position.y });
    useFlowStore.getState().onConnect({
      source: sourceNodeId,
      sourceHandle: null,
      target: audioProcessNodeId,
      targetHandle: 'media',
    });
    setContextMenu(null);
    patchNodeData(compositionId, {
      statusMessage: `Cleaning dialogue in ${item.label}…`,
      error: undefined,
    });

    await runNode(audioProcessNodeId);
    const completedNode = useFlowStore.getState().nodes.find((candidate) => candidate.id === audioProcessNodeId);
    const isolatedOutput = completedNode?.data.namedOutputs?.[AUDIO_PROCESS_OUTPUT_HANDLES.isolatedAudio];
    const cleanedLibraryItem = isolatedOutput?.sourceBinItemId
      ? useSourceBinStore.getState().getAllItems().find((candidate) => candidate.id === isolatedOutput.sourceBinItemId)
      : undefined;

    if (!cleanedLibraryItem) {
      await showAlertDialog({
        title: 'Dialogue Cleanup Did Not Complete',
        message: completedNode?.data.error ?? 'No isolated dialogue asset was produced.',
        tone: 'warning',
      });
      return;
    }

    const cleanedItem = mapLibraryItemToEditorSourceItem(cleanedLibraryItem);
    setSelectedSourceItemId(cleanedItem.id);
    setSourceBinTab('media');

    const currentComposition = useFlowStore.getState().nodes.find((node) => (
      node.id === compositionId && node.type === 'composition'
    ));
    const currentAudioClips = currentComposition ? getEditorAudioClips(currentComposition.data) : [];
    const currentVisualClips = currentComposition ? getEditorVisualClips(currentComposition.data) : [];
    const originalAudioClip = plannedOriginalAudioClipId
      ? currentAudioClips.find((clip) => clip.id === plannedOriginalAudioClipId)
      : undefined;
    const originalVisualClip = plannedOriginalVisualClipId
      ? currentVisualClips.find((clip) => clip.id === plannedOriginalVisualClipId)
      : undefined;
    const occurrenceDisappeared = Boolean(
      (plannedOriginalAudioClipId && !originalAudioClip)
      || (plannedOriginalVisualClipId && !originalVisualClip)
    );
    const currentAudioBlocks = buildAudioTimelineBlocks(currentAudioClips, sourceItemByNodeId, durationMap);
    const currentVisualBlocks = buildVisualTimelineBlocks(currentVisualClips, sourceItemByNodeId, durationMap);
    const sourceDurationSeconds = getSourceItemDurationSeconds(item, durationMap)
      ?? (originalAudioClip ? currentAudioBlocks.find((block) => block.clip.id === originalAudioClip.id)?.durationSeconds : undefined)
      ?? (originalVisualClip ? currentVisualBlocks.find((block) => block.clip.id === originalVisualClip.id)?.durationSeconds : undefined)
      ?? 0;
    const originalSourceRange = originalAudioClip
      ? resolveEditorAudioSourceRangeMs(originalAudioClip, sourceDurationSeconds)
      : originalVisualClip
        ? resolveVisualClipSourceRangeMs(originalVisualClip, sourceDurationSeconds)
        : undefined;
    const effectivePlacementDurationSeconds = (originalSourceRange?.durationMs ?? Math.round(sourceDurationSeconds * 1_000)) / 1_000;
    const alignedOffsetMs = originalAudioClip?.offsetMs ?? originalVisualClip?.startMs;
    const currentLockedAudioTracks = normalizeLockedTracks(currentComposition?.data.editorLockedAudioTracks);
    const autoPlacementPossible = !occurrenceDisappeared
      && alignedOffsetMs !== undefined
      && effectivePlacementDurationSeconds > 0
      && (!originalVisualClip || (!originalVisualClip.reversePlayback && Math.abs((originalVisualClip.playbackRate || 1) - 1) < 0.001))
      && !(originalAudioClip && isTrackLocked(currentLockedAudioTracks, originalAudioClip.trackIndex));
    const placementStartSeconds = Math.max(0, alignedOffsetMs ?? 0) / 1_000;
    const placementTrackIndex = autoPlacementPossible
      ? resolveAlignedDialogueTrack({
          trackCount: audioTrackCount,
          lockedTracks: currentLockedAudioTracks,
          originalTrackIndex: originalAudioClip?.trackIndex,
          startSeconds: placementStartSeconds,
          durationSeconds: effectivePlacementDurationSeconds,
          blocks: currentAudioBlocks.map((block) => ({
            trackIndex: block.clip.trackIndex,
            startSeconds: block.startSeconds,
            endSeconds: block.endSeconds,
          })),
        })
      : undefined;

    if (!currentComposition || placementTrackIndex === undefined || alignedOffsetMs === undefined) {
      patchNodeData(compositionId, {
        statusMessage: `Clean dialogue saved as ${cleanedItem.label}. Add it to an open audio lane when ready.`,
      });
      recordActivityTrailWorkspaceEvent('editor', 'Clean dialogue to source library', item.label, 'toolbar');
      return;
    }

    const cleanedClip = createEditorAudioClip(cleanedItem.id, placementTrackIndex, {
      offsetMs: alignedOffsetMs,
      sourceInMs: originalSourceRange?.sourceInMs,
      sourceOutMs: originalSourceRange?.sourceOutMs,
      volumePercent: originalAudioClip?.volumePercent ?? 100,
      volumeAutomationPoints: originalAudioClip?.volumeAutomationPoints,
      volumeKeyframes: originalAudioClip?.volumeKeyframes,
      fadeInSeconds: originalAudioClip?.fadeInSeconds,
      fadeOutSeconds: originalAudioClip?.fadeOutSeconds,
      audioProcessing: originalAudioClip?.audioProcessing,
      loudnessReferenceClipId: originalAudioClip?.id,
      loudnessReferenceSourceNodeId: originalAudioClip?.sourceNodeId ?? originalVisualClip?.sourceNodeId,
      loudnessReferenceSourceInMs: originalSourceRange?.sourceInMs,
      loudnessReferenceSourceOutMs: originalSourceRange?.sourceOutMs,
    });
    commitCompositionPatchById(compositionId, {
      editorAudioClips: [
        ...currentAudioClips.map((clip) => clip.id === originalAudioClip?.id ? { ...clip, enabled: false } : clip),
        cleanedClip,
      ],
    }, 'Clean dialogue and place repaired clip');
    if (useEditorStore.getState().activeCompositionId === compositionId) {
      setSelectedAudioClipId(cleanedClip.id);
      setSelectedVisualClipId(undefined);
    }
    patchNodeData(compositionId, {
      statusMessage: `Clean dialogue saved and placed on A${placementTrackIndex + 1}. The original audio clip is disabled, not deleted.`,
    });
    recordActivityTrailWorkspaceEvent('editor', 'Clean dialogue and place repaired clip', `A${placementTrackIndex + 1}`, 'toolbar');
  };

  const alignCaptionSourceItem = async (mediaItem: SourceBinItem) => {
    if (!activeComposition || !['audio', 'video', 'composition'].includes(mediaItem.kind)) return;
    const compositionId = activeComposition.id;
    const captionItem = alignmentCaptionItemId
      ? sourceItemById.get(alignmentCaptionItemId)
      : undefined;
    if (!captionItem || captionItem.kind !== 'subtitle') {
      await showAlertDialog({
        title: 'Choose An Alignment Script',
        message: 'In Caption Files, mark one saved VTT or SRT file as the alignment script first.',
        tone: 'warning',
      });
      return;
    }

    try {
      const cues = await loadCaptionSourceItem(captionItem);
      const exactText = captionCuesToAlignmentText(cues);
      if (!exactText) throw new Error('The selected caption file does not contain any spoken text.');

      const position = getNewFlowNodePosition();
      const sourceNodeId = addNode(getFlowNodeTypeForSourceBinItem(mediaItem), position);
      const libraryItem = libraryItems.find((candidate) => candidate.id === mediaItem.id);
      patchNodeData(sourceNodeId, buildFlowNodePatchForSourceBinItem({
        ...mediaItem,
        assetId: libraryItem?.assetId,
      }));
      const transcriptionNodeId = addNode('transcriptionNode', { x: position.x + 380, y: position.y });
      patchNodeData(transcriptionNodeId, {
        transcriptionOperation: 'align',
        transcriptionAlignmentText: exactText,
      });
      useFlowStore.getState().onConnect({
        source: sourceNodeId,
        sourceHandle: null,
        target: transcriptionNodeId,
        targetHandle: 'media',
      });
      patchNodeData(compositionId, {
        statusMessage: `Aligning ${captionItem.label} to ${mediaItem.label}…`,
        error: undefined,
      });

      await runNode(transcriptionNodeId);
      const completedNode = useFlowStore.getState().nodes.find((candidate) => candidate.id === transcriptionNodeId);
      const captionOutput = completedNode?.data.namedOutputs?.[TRANSCRIPTION_OUTPUT_HANDLES.vtt];
      const alignedLibraryItem = captionOutput?.sourceBinItemId
        ? useSourceBinStore.getState().getAllItems().find((candidate) => candidate.id === captionOutput.sourceBinItemId)
        : undefined;
      if (!alignedLibraryItem) {
        throw new Error(completedNode?.data.error ?? 'No aligned WebVTT caption file was produced.');
      }

      const alignedItem = mapLibraryItemToEditorSourceItem(alignedLibraryItem);
      await applyCaptionSourceItem(alignedItem);
      setSelectedSourceItemId(alignedItem.id);
      patchNodeData(compositionId, {
        statusMessage: `Aligned captions saved and applied from ${alignedItem.label}.`,
      });
      recordActivityTrailWorkspaceEvent('editor', 'Align captions to media', `${cues.length} source cues`, 'toolbar');
    } catch (error) {
      await showAlertDialog({
        title: 'Caption Alignment Failed',
        message: error instanceof Error ? error.message : 'The captions could not be aligned.',
        tone: 'danger',
      });
    }
  };

  const captureVideoFrameToFlow = async (video: HTMLVideoElement | null, label: string) => {
    if (!video) {
      return;
    }

    const frameBlob = await captureFrameFromVideoElement(video);
    const dataUrl = await blobToDataUrl(frameBlob);
    const libraryItem = await addAssetItem({
      label,
      kind: 'image',
      mimeType: 'image/png',
      dataUrl,
      isGenerated: true,
    });

    setSourceBinOriginFilter('generated');
    sendSourceItemToFlow(mapLibraryItemToEditorSourceItem(libraryItem));
  };

  const exportTimelineClipFrameToSourceBin = async (
    clip: EditorVisualClip,
    edge: TimelineClipFrameEdge,
  ) => {
    setContextMenu(null);

    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);

    if (!sourceItem?.assetUrl || (sourceItem.kind !== 'video' && sourceItem.kind !== 'composition')) {
      await showAlertDialog({
        title: 'Frame Export Unavailable',
        message: 'This timeline clip does not have a video source frame to export.',
        tone: 'warning',
      });
      return;
    }

    const sourceDurationSeconds = getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0;
    const targetTimeSeconds = getTimelineClipFrameExportTimeSeconds(clip, sourceDurationSeconds, edge);

    try {
      const frameBlob = await extractVideoFrameAtTime(sourceItem.assetUrl, targetTimeSeconds);
      const dataUrl = await blobToDataUrl(frameBlob);
      const libraryItem = await addAssetItem({
        label: buildTimelineClipFrameExportLabel(sourceItem.label, edge),
        kind: 'image',
        mimeType: 'image/png',
        dataUrl,
        sourceKey: `timeline-frame:${clip.id}:${edge}:${targetTimeSeconds.toFixed(3)}`,
        originNodeId: clip.sourceNodeId,
        isGenerated: true,
      });

      setSelectedSourceItemId(libraryItem.id);
      setSourceBinOriginFilter('generated');
    } catch (error) {
      await showAlertDialog({
        title: 'Frame Export Failed',
        message: error instanceof Error ? error.message : 'The timeline frame could not be exported.',
        tone: 'danger',
      });
    }
  };

  const commitSelectedImageCropAsAsset = async () => {
    if (!activeComposition || !selectedVisualClip || selectedVisualClip.sourceKind !== 'image') {
      return;
    }

    if (!selectedVisualBackingImageItem?.assetUrl) {
      await showAlertDialog({
        title: 'Crop Unavailable',
        message: 'This image clip does not have a local source image to crop.',
        tone: 'warning',
      });
      return;
    }

    try {
      const croppedDataUrl = await cropImageDataUrl({
        dataUrl: selectedVisualBackingImageItem.assetUrl,
        mimeType: 'image/png',
        cropLeftPercent: selectedVisualClip.cropLeftPercent,
        cropRightPercent: selectedVisualClip.cropRightPercent,
        cropTopPercent: selectedVisualClip.cropTopPercent,
        cropBottomPercent: selectedVisualClip.cropBottomPercent,
      });
      const libraryItem = await addAssetItem({
        label: `${selectedVisualBackingImageItem.label} crop`,
        kind: 'image',
        mimeType: 'image/png',
        dataUrl: croppedDataUrl,
        sourceKey: `image-crop:${selectedVisualBackingImageItem.id}:${selectedVisualClip.cropLeftPercent}:${selectedVisualClip.cropRightPercent}:${selectedVisualClip.cropTopPercent}:${selectedVisualClip.cropBottomPercent}`,
        originNodeId: selectedVisualClip.sourceNodeId,
        isGenerated: true,
      });
      const nextAsset = createEditorAsset('image', {
        label: libraryItem.label,
        imageSourceId: libraryItem.id,
      });

      commitActiveCompositionPatch({
        editorAssets: [nextAsset, ...compositionEditorAssets],
      }, 'Commit cropped image asset');
      setSourceBinTab('editorAssets');
      setSourceBinOriginFilter('generated');
    } catch (error) {
      await showAlertDialog({
        title: 'Image Crop Failed',
        message: error instanceof Error ? error.message : 'The image crop could not be committed.',
        tone: 'danger',
      });
    }
  };

  const generateProfessionalAuthoredAudio = async (input: {
    kind: 'voiceover' | 'range-sfx';
    text: string;
    voiceId?: string;
    languageCode?: string;
    startMs: number;
    endMs?: number;
  }) => {
    if (!activeComposition) return;
    const settings = useSettingsStore.getState();
    const provider: AudioProvider = 'elevenlabs';
    const modelId = settings.defaultModels.audio.elevenlabs;
    const requestId = `video-authored-audio-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
    const audioNode = {
      id: requestId,
      type: 'audioGen',
      position: { x: 0, y: 0 },
      data: {
        mediaMode: 'generate',
        provider,
        modelId,
        voiceId: input.voiceId || settings.providerSettings.elevenlabsVoiceId,
        audioGenerationMode: input.kind === 'voiceover' ? 'speech' : 'soundEffect',
        audioTtsWithTimestamps: input.kind === 'voiceover',
        audioDurationSeconds: input.endMs !== undefined ? Math.max(0.5, Math.min(30, (input.endMs - input.startMs) / 1_000)) : undefined,
      },
    } as AppNode;
    setVoiceoverBusy(true);
    setVoiceoverStatus(input.kind === 'voiceover' ? 'Generating timing-aware voiceover…' : 'Generating sound for the selected range…');
    try {
      const execution = await executeAndRecordProjectUsage({
        node: audioNode,
        workspace: 'editor',
        recordUsage: useProjectUsageStore.getState().recordUsage,
        execute: () => executeNodeRequest(audioNode, { prompt: input.text, config: DEFAULT_EXECUTION_CONFIG }, settings),
      });
      if (typeof execution.result !== 'string' || !execution.result.startsWith('data:')) {
        throw new Error('The provider did not return materialized audio for the timeline.');
      }
      const timing = execution.outputMetadata?.ttsTiming as { durationMs?: number; words?: Array<{ text: string; startMs: number; endMs: number }> } | undefined;
      const requestedDurationMs = input.endMs !== undefined ? input.endMs - input.startMs : undefined;
      const durationMs = Math.max(1, Math.round(timing?.durationMs ?? requestedDurationMs ?? Math.max(1_000, input.text.length * 55)));
      const professional: SourceBinProfessionalMediaState = {
        version: VIDEO_PROFESSIONAL_STATE_VERSION,
        origin: 'generated',
        onlineState: 'online',
        generatedBy: {
          provider,
          operation: input.kind === 'voiceover' ? 'tts' : 'sound-effect',
          modelId,
          requestId,
          parentSourceItemIds: selectedSourceItem ? [selectedSourceItem.id] : [],
          generatedAt: Date.now(),
          ...(timing?.words?.length ? { timing: { words: timing.words.slice(0, 10_000) } } : {}),
        },
      };
      const libraryItem = await addAssetItem({
        label: input.kind === 'voiceover' ? buildNarrationAssetLabel(input.text) : `SFX · ${input.text.slice(0, 48)}`,
        kind: 'audio',
        mimeType: execution.result.startsWith('data:audio/wav') ? 'audio/wav' : 'audio/mpeg',
        dataUrl: execution.result,
        sourceKey: `${input.kind}:${requestId}`,
        originNodeId: selectedSourceItem?.nodeId,
        isGenerated: true,
        professional,
      });
      const nextClip = createEditorAudioClip(libraryItem.id, Math.min(audioTrackCount - 1, input.kind === 'voiceover' ? 0 : 1), {
        offsetMs: Math.max(0, Math.round(input.startMs)),
        sourceInMs: 0,
        sourceOutMs: durationMs,
      });
      updateAudioClips([...audioClips, { ...nextClip, professional: { pan: 0, trackId: `audio:${nextClip.trackIndex}` } }], input.kind === 'voiceover' ? 'Generate timing-aware voiceover' : 'Generate range sound effect');
      setSelectedAudioClipId(nextClip.id);
      setSelectedVisualClipId(undefined);
      if (input.kind === 'voiceover') {
        setVoiceoverParagraphs((current) => [...current, {
          id: requestId,
          revision: 1,
          text: input.text,
          languageCode: input.languageCode ?? 'en',
          voiceId: input.voiceId ?? '',
          originalReferenceIds: selectedSourceItem ? [selectedSourceItem.id] : [],
          lastRequestId: requestId,
        }].slice(-100));
      }
      setVoiceoverStatus(`Added generated ${input.kind === 'voiceover' ? 'voiceover' : 'sound effect'} to A${nextClip.trackIndex + 1}; originals were preserved.`);
      setSourceBinOriginFilter('generated');
    } catch (error) {
      setVoiceoverStatus(error instanceof Error ? error.message : 'Generated audio failed.');
    } finally {
      setVoiceoverBusy(false);
    }
  };

  const generateNarrationForSelectedTextClip = async () => {
    if (!activeComposition || !selectedVisualClip || selectedVisualClip.sourceKind !== 'text') {
      return;
    }

    const narrationText = (
      selectedVisualClip.textContent ??
      selectedVisualSourceItem?.text ??
      selectedVisualEditorAsset?.textDefaults?.text ??
      ''
    ).trim();

    if (!narrationText) {
      await showAlertDialog({
        title: 'Narration Unavailable',
        message: 'This text clip is empty.',
        tone: 'warning',
      });
      return;
    }

    const settings = useSettingsStore.getState();
    const audioProvider = resolveEditorNarrationProvider(settings.apiKeys, settings.providerSettings.backendProxyEnabled);
    const audioNode = {
      id: `editor-narration-${Date.now()}`,
      type: 'audioGen',
      position: { x: 0, y: 0 },
      data: {
        mediaMode: 'generate',
        provider: audioProvider,
        modelId: settings.defaultModels.audio[audioProvider],
        voiceId: settings.providerSettings.elevenlabsVoiceId,
        geminiVoiceName: 'Kore',
        audioGenerationMode: 'speech',
      },
    } as AppNode;

    try {
      const execution = await executeAndRecordProjectUsage({
        node: audioNode,
        workspace: 'editor',
        recordUsage: useProjectUsageStore.getState().recordUsage,
        execute: () => executeNodeRequest(
          audioNode,
          {
            prompt: narrationText,
            config: DEFAULT_EXECUTION_CONFIG,
          },
          settings,
        ),
      });

      if (typeof execution.result !== 'string' || !execution.result.startsWith('data:')) {
        throw new Error('The narration provider returned a remote URL. Import the audio result manually or use a provider/proxy that returns a data URL.');
      }

      const libraryItem = await addAssetItem({
        label: buildNarrationAssetLabel(narrationText),
        kind: 'audio',
        mimeType: execution.result.startsWith('data:audio/wav') ? 'audio/wav' : 'audio/mpeg',
        dataUrl: execution.result,
        sourceKey: `editor-narration:${selectedVisualClip.id}:${narrationText}`,
        originNodeId: selectedVisualClip.sourceNodeId,
        isGenerated: true,
      });
      const nextClip = createEditorAudioClip(libraryItem.id, 0, {
        offsetMs: getAudioTrackEndMs(audioBlocks, 0),
      });

      updateAudioClips([...audioClips, nextClip], 'Generate narration audio');
      setSelectedAudioClipId(nextClip.id);
      setSelectedVisualClipId(undefined);
      setSourceBinTab('media');
      setSourceBinOriginFilter('generated');
    } catch (error) {
      await showAlertDialog({
        title: 'Narration Generation Failed',
        message: error instanceof Error ? error.message : 'Narration generation failed.',
        tone: 'danger',
      });
    }
  };

  const splitVisualClipAtSeconds = useCallback((clipId: string, splitSeconds: number, shiftKey = false) => {
    const clip = visualClips.find((candidate) => candidate.id === clipId);

    if (!clip) {
      return;
    }

    const clipDurationSeconds = resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap);
    const clipStartSeconds = clip.startMs / 1000;
    const clipEndSeconds = clipStartSeconds + clipDurationSeconds;
    const snappedSplitSeconds = snapTimelineInteractionSeconds(splitSeconds, shiftKey);
    const normalizedSplitSeconds = Math.min(Math.max(snappedSplitSeconds, clipStartSeconds + 0.1), clipEndSeconds - 0.1);

    if (normalizedSplitSeconds <= clipStartSeconds || normalizedSplitSeconds >= clipEndSeconds) {
      return;
    }

    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    const sourceDurationSeconds =
      clip.sourceKind === 'video' || clip.sourceKind === 'composition'
        ? sourceItem
          ? getSourceItemDurationSeconds(sourceItem, durationMap) ?? clipDurationSeconds
          : clipDurationSeconds
        : clipDurationSeconds;
    const [leftClip, rightClip] = splitVisualClipNonDestructively(
      clip,
      normalizedSplitSeconds,
      sourceDurationSeconds,
    );
    const rightClipId = createDerivedVisualClipId();
    const nextClips: EditorVisualClip[] = [];

    for (const candidate of visualClips) {
      if (candidate.id !== clipId) {
        nextClips.push(candidate);
        continue;
      }

      nextClips.push(leftClip, { ...rightClip, id: rightClipId });
    }

    // Split deterministically partitions owned markers: strictly-left markers stay on the left
    // clip; markers at or after the split re-own to the right clip with shifted offsets.
    const nextMarkers = applyClipSplitToTimelineMarkers(timelineMarkers, {
      clipId,
      clipStartMs: clip.startMs,
      splitMs: Math.round(normalizedSplitSeconds * 1_000),
      rightClipId,
    });
    commitActiveCompositionPatch({
      editorVisualClips: nextClips,
      ...(nextMarkers !== timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
    }, 'Split visual clip');
    setContextMenu(null);
  }, [
    commitActiveCompositionPatch,
    durationMap,
    snapTimelineInteractionSeconds,
    setContextMenu,
    sourceItemByNodeId,
    timelineMarkers,
    visualClips,
  ]);

  const splitAudioClipAtSeconds = useCallback((clipId: string, splitSeconds: number, shiftKey = false) => {
    const clip = audioClips.find((candidate) => candidate.id === clipId);
    if (!clip || isAudioTrackLocked(clip.trackIndex)) return false;
    const sourceItem = sourceItemByNodeId.get(clip.sourceNodeId);
    const sourceDurationSeconds = getSourceItemDurationSeconds(sourceItem, durationMap) ?? 0;
    if (sourceDurationSeconds <= 0) return false;
    const snappedSplitSeconds = snapTimelineInteractionSeconds(splitSeconds, shiftKey);
    const rightClipId = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const split = splitEditorAudioClipAtTimelineSeconds(
      clip,
      sourceDurationSeconds,
      snappedSplitSeconds,
      (side) => side === 'left' ? clip.id : rightClipId,
    );
    if (!split) return false;
    const [leftClip, rightClip] = split;
    const nextMarkers = applyClipSplitToTimelineMarkers(timelineMarkers, {
      clipId,
      clipStartMs: clip.offsetMs,
      splitMs: Math.round(snappedSplitSeconds * 1_000),
      rightClipId,
    });
    commitActiveCompositionPatch({
      editorAudioClips: audioClips.flatMap((candidate) => candidate.id === clipId ? [leftClip, rightClip] : [candidate]),
      ...(nextMarkers !== timelineMarkers ? { editorTimelineMarkers: nextMarkers } : {}),
    }, 'Split audio clip');
    setSelectedAudioClipId(rightClip.id);
    setContextMenu(null);
    return true;
  }, [audioClips, commitActiveCompositionPatch, durationMap, isAudioTrackLocked, setSelectedAudioClipId, snapTimelineInteractionSeconds, sourceItemByNodeId, timelineMarkers]);

  const matchSelectedAudioSpeechLevel = useCallback(async () => {
    const targetClip = selectedAudioClip;
    const compositionId = activeComposition?.id;
    if (!targetClip || !compositionId || speechLevelMatchState.busy) return;
    const referenceClip = targetClip.loudnessReferenceClipId
      ? audioClips.find((candidate) => candidate.id === targetClip.loudnessReferenceClipId)
      : undefined;
    const referenceSourceNodeId = targetClip.loudnessReferenceSourceNodeId ?? referenceClip?.sourceNodeId;
    const referenceItem = referenceSourceNodeId ? sourceItemByNodeId.get(referenceSourceNodeId) : undefined;
    const targetItem = sourceItemByNodeId.get(targetClip.sourceNodeId);
    if (!referenceSourceNodeId || !referenceItem?.assetUrl || !targetItem?.assetUrl) {
      await showAlertDialog({
        title: 'Speech Level Match Is Unavailable',
        message: 'This clip does not retain an accessible Original/Clean dialogue reference pair.',
        tone: 'warning',
      });
      return;
    }
    const referenceDurationSeconds = getSourceItemDurationSeconds(referenceItem, durationMap)
      ?? ((targetClip.loudnessReferenceSourceOutMs ?? referenceClip?.sourceOutMs ?? 0) / 1_000);
    const targetDurationSeconds = getSourceItemDurationSeconds(targetItem, durationMap)
      ?? ((targetClip.sourceOutMs ?? 0) / 1_000);
    const referenceRange = resolveEditorAudioSourceRangeMs({
      sourceInMs: targetClip.loudnessReferenceSourceInMs ?? referenceClip?.sourceInMs,
      sourceOutMs: targetClip.loudnessReferenceSourceOutMs ?? referenceClip?.sourceOutMs,
    }, referenceDurationSeconds);
    const targetRange = resolveEditorAudioSourceRangeMs(targetClip, targetDurationSeconds);
    setSpeechLevelMatchState({ clipId: targetClip.id, busy: true, message: 'Measuring active speech…' });
    try {
      const measurement = await measureSpeechLevelMatchFromUrls({
        originalUrl: referenceItem.assetUrl,
        cleanUrl: targetItem.assetUrl,
        originalRange: referenceRange,
        cleanRange: targetRange,
      });
      const currentComposition = useFlowStore.getState().nodes.find((candidate) => (
        candidate.id === compositionId && candidate.type === 'composition'
      ));
      const currentAudioClips = currentComposition ? getEditorAudioClips(currentComposition.data) : [];
      if (!currentAudioClips.some((candidate) => candidate.id === targetClip.id)) {
        throw new Error('The cleaned dialogue clip changed or was removed while it was being measured.');
      }
      commitCompositionPatchById(compositionId, {
        editorAudioClips: currentAudioClips.map((candidate) => candidate.id === targetClip.id ? {
        ...candidate,
        measuredMatchGainDb: measurement.gainDb,
        speechLevelMatchMeasurement: {
          ...measurement,
          measuredAt: Date.now(),
          referenceClipId: referenceClip?.id,
          referenceSourceNodeId,
          targetSourceNodeId: targetClip.sourceNodeId,
          referenceSourceInMs: referenceRange.sourceInMs,
          referenceSourceOutMs: referenceRange.sourceOutMs,
          targetSourceInMs: targetRange.sourceInMs,
          targetSourceOutMs: targetRange.sourceOutMs,
        },
        } : candidate),
      }, 'Match cleaned dialogue speech level');
      setSpeechLevelMatchState({
        clipId: targetClip.id,
        busy: false,
        message: `${measurement.gainDb >= 0 ? '+' : ''}${measurement.gainDb.toFixed(2)} dB active-speech match${measurement.peakLimited ? ' (sample-peak limited)' : ''}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Speech level measurement failed.';
      setSpeechLevelMatchState({ clipId: targetClip.id, busy: false, message });
      await showAlertDialog({ title: 'Speech Level Match Could Not Be Applied', message, tone: 'warning' });
    }
  }, [activeComposition?.id, audioClips, commitCompositionPatchById, durationMap, selectedAudioClip, sourceItemByNodeId, speechLevelMatchState.busy]);

  const stopDialogueAudition = useCallback((message?: string) => {
    dialogueAuditionGenerationRef.current += 1;
    dialogueAuditionAbortRef.current?.abort();
    dialogueAuditionAbortRef.current = undefined;
    dialogueAuditionSessionRef.current?.stop();
    dialogueAuditionSessionRef.current = undefined;
    setDialogueAuditionState((current) => ({
      ...current,
      busy: false,
      playing: false,
      summary: undefined,
      message,
    }));
  }, []);

  const auditionSelectedDialogue = useCallback(async (side: DialogueAuditionSide) => {
    const targetClip = selectedAudioClip;
    if (!targetClip) return;
    const existing = dialogueAuditionSessionRef.current;
    if (existing && dialogueAuditionState.clipId === targetClip.id) {
      existing.setSide(side);
      setDialogueAuditionState((current) => ({ ...current, side, message: undefined }));
      return;
    }
    const referenceClip = targetClip.loudnessReferenceClipId
      ? audioClips.find((candidate) => candidate.id === targetClip.loudnessReferenceClipId)
      : undefined;
    const referenceSourceNodeId = targetClip.loudnessReferenceSourceNodeId ?? referenceClip?.sourceNodeId;
    const referenceItem = referenceSourceNodeId ? sourceItemByNodeId.get(referenceSourceNodeId) : undefined;
    const targetItem = sourceItemByNodeId.get(targetClip.sourceNodeId);
    if (!referenceItem?.assetUrl || !targetItem?.assetUrl) {
      await showAlertDialog({
        title: 'Original / Clean Audition Is Unavailable',
        message: 'This clip does not retain an accessible Original/Clean source pair.',
        tone: 'warning',
      });
      return;
    }
    const referenceDurationSeconds = getSourceItemDurationSeconds(referenceItem, durationMap)
      ?? ((targetClip.loudnessReferenceSourceOutMs ?? referenceClip?.sourceOutMs ?? 0) / 1_000);
    const targetDurationSeconds = getSourceItemDurationSeconds(targetItem, durationMap)
      ?? ((targetClip.sourceOutMs ?? 0) / 1_000);
    const originalRange = resolveEditorAudioSourceRangeMs({
      sourceInMs: targetClip.loudnessReferenceSourceInMs ?? referenceClip?.sourceInMs,
      sourceOutMs: targetClip.loudnessReferenceSourceOutMs ?? referenceClip?.sourceOutMs,
    }, referenceDurationSeconds);
    const cleanRange = resolveEditorAudioSourceRangeMs(targetClip, targetDurationSeconds);
    stopDialogueAudition();
    const auditionGeneration = dialogueAuditionGenerationRef.current;
    const abortController = new AbortController();
    dialogueAuditionAbortRef.current = abortController;
    setDialogueAuditionState((current) => ({
      ...current,
      clipId: targetClip.id,
      busy: true,
      playing: false,
      side,
      message: 'Preparing synchronized dry sources and processed preview…',
    }));
    try {
      const session = await startDialogueAudioAudition({
        originalUrl: referenceItem.assetUrl,
        cleanUrl: targetItem.assetUrl,
        originalRange,
        cleanRange,
        cleanMatchGainDb: targetClip.measuredMatchGainDb ?? 0,
        calibrateCleanWithMatch: dialogueAuditionState.calibrateCleanWithMatch,
        processing: targetClip.audioProcessing,
        initialSide: side,
        focusOffsetSeconds: Math.max(0, timelineCursorSeconds - targetClip.offsetMs / 1_000),
        onEnded: () => {
          dialogueAuditionSessionRef.current = undefined;
          setDialogueAuditionState((current) => ({
            ...current,
            busy: false,
            playing: false,
            message: 'Audition ended. Press a mode to restart the one-shot preview.',
          }));
        },
        signal: abortController.signal,
      });
      if (
        dialogueAuditionGenerationRef.current !== auditionGeneration
        || useEditorStore.getState().selectedAudioClipId !== targetClip.id
      ) {
        session.stop();
        setDialogueAuditionState((current) => ({
          ...current,
          busy: false,
          playing: false,
          summary: undefined,
          message: 'Audition preparation was cancelled because the selection or settings changed.',
        }));
        return;
      }
      dialogueAuditionSessionRef.current = session;
      if (dialogueAuditionAbortRef.current === abortController) {
        dialogueAuditionAbortRef.current = undefined;
      }
      setDialogueAuditionState((current) => ({
        ...current,
        clipId: targetClip.id,
        busy: false,
        playing: true,
        side,
        summary: session.summary,
        message: undefined,
      }));
    } catch (error) {
      if (dialogueAuditionAbortRef.current === abortController) {
        dialogueAuditionAbortRef.current = undefined;
      }
      const message = error instanceof Error ? error.message : 'The browser could not prepare this audition.';
      setDialogueAuditionState((current) => ({
        ...current,
        clipId: targetClip.id,
        busy: false,
        playing: false,
        summary: undefined,
        message,
      }));
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        await showAlertDialog({ title: 'Original / Clean Audition Failed', message, tone: 'warning' });
      }
    }
  }, [audioClips, dialogueAuditionState.calibrateCleanWithMatch, dialogueAuditionState.clipId, durationMap, selectedAudioClip, sourceItemByNodeId, stopDialogueAudition, timelineCursorSeconds]);

  const setDialogueAuditionCalibration = useCallback((enabled: boolean) => {
    stopDialogueAudition('Level-match calibration changed. Press an audition mode to restart.');
    setDialogueAuditionState((current) => ({ ...current, calibrateCleanWithMatch: enabled }));
  }, [stopDialogueAudition]);

  const splitSelectedVisualClipAtCursor = (clipId: string) => {
    splitVisualClipAtSeconds(clipId, timelineCursorSeconds);
  };

  const cutSelectedVisualClipAtPlayhead = useCallback((shiftKey = false) => {
    const splitSeconds = snapTimelineInteractionSeconds(timelineCursorSeconds, shiftKey);
    if (selectedAudioClipId) {
      const selectedBlock = audioBlocks.find((block) => block.clip.id === selectedAudioClipId);
      if (
        selectedBlock
        && splitSeconds > selectedBlock.startSeconds
        && splitSeconds < selectedBlock.endSeconds
      ) {
        return splitAudioClipAtSeconds(selectedAudioClipId, splitSeconds, shiftKey);
      }
    }
    const target = getSelectedVisualClipCutTarget({
      clips: visualClips,
      selectedClipId: selectedVisualClipId,
      playheadSeconds: splitSeconds,
      resolveDurationSeconds: (clip) => resolveVisualClipDuration(clip, sourceItemByNodeId, durationMap),
    });

    if (!target) {
      return false;
    }

    splitVisualClipAtSeconds(target.clipId, target.splitSeconds, shiftKey);
    return true;
  }, [
    audioBlocks,
    durationMap,
    selectedAudioClipId,
    selectedVisualClipId,
    sourceItemByNodeId,
    snapTimelineInteractionSeconds,
    splitAudioClipAtSeconds,
    splitVisualClipAtSeconds,
    timelineCursorSeconds,
    visualClips,
  ]);

  useEffect(() => {
    cutSelectedVisualClipAtPlayheadRef.current = cutSelectedVisualClipAtPlayhead;
  }, [cutSelectedVisualClipAtPlayhead]);

  const openVisualClipPropertyCopyDialog = (clip: EditorVisualClip, sourceLabel: string) => {
    setVisualClipPropertyDialog({
      clipId: clip.id,
      sourceLabel,
      selectedProperties: getDefaultVisualClipPropertySelection(),
    });
    setContextMenu(null);
  };

  const toggleVisualClipPropertySelection = (property: VisualClipCopiedProperty) => {
    setVisualClipPropertyDialog((current) => {
      if (!current) {
        return current;
      }

      const selectedProperties = current.selectedProperties.includes(property)
        ? current.selectedProperties.filter((candidate) => candidate !== property)
        : [...current.selectedProperties, property];

      return {
        ...current,
        selectedProperties,
      };
    });
  };

  const copySelectedVisualClipProperties = () => {
    if (!visualClipPropertyDialog || visualClipPropertyDialog.selectedProperties.length === 0) {
      return;
    }

    const clip = visualClips.find((candidate) => candidate.id === visualClipPropertyDialog.clipId);

    if (!clip) {
      setVisualClipPropertyDialog(null);
      return;
    }

    setVisualClipPropertyClipboard(
      copyVisualClipProperties(
        clip,
        visualClipPropertyDialog.selectedProperties,
        visualClipPropertyDialog.sourceLabel,
      ),
    );
    setVisualClipPropertyDialog(null);
  };

  const openVisualClipContextMenu = (id: string, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const clip = visualClips.find((candidate) => candidate.id === id);

    if (!clip) {
      return;
    }

    const item = sourceItemByNodeId.get(clip.sourceNodeId);
    const asset = editorAssetById.get(clip.sourceNodeId);
    const sourceLabel = item?.label ?? asset?.label ?? clip.sourceNodeId;
    const clipboard = visualClipPropertyClipboard;
    const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

    selectVisualClip(clip);

    if (clip.sourceKind === 'text') {
      menuItems.push({
        label: 'Edit Text...',
        action: () => openTextClipEditDialog(clip),
      });
    }

    if (clip.sourceKind === 'video' || clip.sourceKind === 'composition') {
      menuItems.push({
        label: 'Split Clip At Playhead',
        action: () => splitSelectedVisualClipAtCursor(clip.id),
      });
    }

    if (item && (item.kind === 'video' || item.kind === 'composition')) {
      menuItems.push(
        {
          label: 'Export First Frame To Source Bin',
          action: () => void exportTimelineClipFrameToSourceBin(clip, 'first'),
        },
        {
          label: 'Export Last Frame To Source Bin',
          action: () => void exportTimelineClipFrameToSourceBin(clip, 'last'),
        },
      );
    }

    if (item) {
      menuItems.push({
        label: 'Send Source To Flow Workspace',
        action: () => sendSourceItemToFlow(item),
      });
    }

    menuItems.push({
      label: 'Copy Selected Properties...',
      action: () => openVisualClipPropertyCopyDialog(clip, sourceLabel),
    });

    if (clipboard && clipboard.properties.length > 0) {
      const propertySummary = formatVisualClipPropertyList(clipboard.properties);
      const sourceSummary = clipboard.sourceLabel ? ` From ${clipboard.sourceLabel}` : '';

      menuItems.push(
        {
          label: `Paste ${propertySummary}${sourceSummary} To Start Keyframe`,
          action: () => {
            updateVisualClipById(clip.id, pasteVisualClipProperties(clip, clipboard, 'start'));
            setContextMenu(null);
          },
        },
        {
          label: `Paste ${propertySummary}${sourceSummary} To End Keyframe`,
          action: () => {
            updateVisualClipById(clip.id, pasteVisualClipProperties(clip, clipboard, 'end'));
            setContextMenu(null);
          },
        },
      );
    }

    menuItems.push({
      label: 'Remove From Cut',
      tone: 'danger',
      action: () => {
        commitActiveCompositionPatch(
          buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [id]),
          'Update visual clips',
        );
        setContextMenu(null);
      },
    });

    setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
  };

  const openTimelineGapContextMenu = (gap: TimelineGap, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTimelineGap(gap);
    clearTimelineSelection();
    setSelectedSourceItemId(undefined);
    setSelectedStageObjectId(undefined);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: `Fill ${gap.durationSeconds.toFixed(1)}s Gap`,
          action: () => fillVisualTimelineGap(gap),
        },
      ],
    });
  };

  const openEditorAssetContextMenu = (asset: EditorAsset, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

    if (asset.kind === 'text') {
      menuItems.push({
        label: 'Edit Text Asset...',
        action: () => openTextAssetEditDialog(asset),
      });
    }

    for (let trackIndex = 0; trackIndex < visualTrackCount; trackIndex += 1) {
      menuItems.push({
        label: `Place On V${trackIndex + 1}`,
        action: () => {
          placeEditorAssetOnTrack(asset, trackIndex);
          setContextMenu(null);
        },
      });
    }

    setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
  };

  const removeSourceLibraryItem = async (item: SourceBinItem) => {
    const confirmed = await useConfirmationStore.getState().requestConfirmation(
      `Remove "${item.label}" from this project's saved source library? Timeline clips that depend on it will also be removed.`,
      'Remove Asset'
    );

    if (!confirmed) {
      return;
    }

    removeSourceBinItem(item.id);
    removeEditorSourceReferences(item.nodeId);
  };

  const relinkSourceLibraryItem = useCallback(async (item: SourceBinItem) => {
    if (mediaManagementBusy) return;
    setMediaManagementBusy(true);
    setMediaManagementStatus(`Choose the replacement for ${item.label}.`);
    try {
      const result = await relinkVideoMediaItem(item.id);
      if (!workspaceMountedRef.current) return;
      setMediaManagementStatus(result.canceled
        ? 'Relink canceled; the saved media identity was not changed.'
        : `Relinked ${result.item?.label ?? item.label}; the selected original was fingerprinted.`);
    } catch (error) {
      if (!workspaceMountedRef.current) return;
      const message = error instanceof Error ? error.message : 'The selected media could not be relinked.';
      setMediaManagementStatus(message);
      await showAlertDialog({ title: 'Media Relink Failed', message, tone: 'danger' });
    } finally {
      if (workspaceMountedRef.current) setMediaManagementBusy(false);
    }
  }, [mediaManagementBusy]);

  const consolidateUsedVideoMedia = useCallback(async () => {
    if (mediaManagementBusy || consolidatableVideoMediaItemIds.length === 0) return;
    setMediaManagementBusy(true);
    try {
      const confirmed = await useConfirmationStore.getState().requestConfirmation(
        `Copy ${consolidatableVideoMediaItemIds.length} file-backed timeline ${consolidatableVideoMediaItemIds.length === 1 ? 'item' : 'items'} into a folder you choose and retarget the same saved identities? The chosen folder must remain available to this project.`,
        'Consolidate Used Media',
      );
      if (!confirmed || !workspaceMountedRef.current) return;
      setMediaManagementStatus('Choose a folder for verified copies of the used originals.');
      const result = await consolidateVideoMediaItems(consolidatableVideoMediaItemIds);
      if (!workspaceMountedRef.current) return;
      setMediaManagementStatus(result.canceled
        ? 'Consolidation canceled; no Source Library paths were changed.'
        : `Consolidated ${result.items?.length ?? consolidatableVideoMediaItemIds.length} used ${consolidatableVideoMediaItemIds.length === 1 ? 'item' : 'items'} into the chosen folder.`);
    } catch (error) {
      if (!workspaceMountedRef.current) return;
      const message = error instanceof Error ? error.message : 'Used media could not be consolidated.';
      setMediaManagementStatus(message);
      await showAlertDialog({ title: 'Media Consolidation Failed', message, tone: 'danger' });
    } finally {
      if (workspaceMountedRef.current) setMediaManagementBusy(false);
    }
  }, [consolidatableVideoMediaItemIds, mediaManagementBusy]);

  const toggleMediaPoolCollapsed = (kind: SourceBinMediaPoolKind) => {
    setSourceBinMediaPoolCollapsed((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };
  const showMoreMediaPoolItems = (kind: SourceBinMediaPoolKind) => {
    setSourceBinVisibleItemLimits((current) => ({
      ...current,
      [kind]: current[kind] + SOURCE_BIN_PAGE_SIZE,
    }));
  };
  const renderMediaSourcePools = () => {
    const mediaPoolSections: Array<{ kind: SourceBinMediaPoolKind; title: string; icon: ReactNode; items: SourceBinItem[] }> = [
      { kind: 'image', title: 'Image Assets', icon: <ImageIcon size={13} />, items: mediaSourceItemsByPool.image },
      { kind: 'video', title: 'Video Assets', icon: <Film size={13} />, items: mediaSourceItemsByPool.video },
      { kind: 'audio', title: 'Audio Assets', icon: <Music2 size={13} />, items: mediaSourceItemsByPool.audio },
      { kind: 'subtitle', title: 'Caption Files', icon: <Captions size={13} />, items: mediaSourceItemsByPool.subtitle },
    ];

    if (!mediaSourceItems.length || !hasAnyMediaPoolItems) {
      return (
        <EmptyState
          body={timelineSourceItems.length > 0
            ? 'No source-library items match the current search and filter.'
            : undefined}
          title={timelineSourceItems.length > 0 ? 'No matching sources' : 'No saved project assets'}
        />
      );
    }

    return (
      <div className="space-y-2">
        {mediaPoolSections.map((section) => {
          if (section.items.length === 0) return null;
          const visibleItems = section.items.slice(0, sourceBinVisibleItemLimits[section.kind]);
          const remainingItemCount = section.items.length - visibleItems.length;

          return (
            <div className="overflow-hidden rounded-lg border border-gray-700/60 bg-[#111217]/45" key={section.kind}>
              <button
                className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-semibold text-gray-200"
                onClick={() => toggleMediaPoolCollapsed(section.kind)}
                type="button"
              >
                <span className="flex items-center gap-2">
                  {section.icon}
                  {section.title}
                  <span className="text-[11px] text-gray-500">{section.items.length}</span>
                </span>
                {sourceBinMediaPoolCollapsed[section.kind]
                  ? <ChevronRight size={13} />
                  : <ChevronDown size={13} />}
              </button>
              {!sourceBinMediaPoolCollapsed[section.kind] ? (
                <div className="space-y-2 border-t border-gray-700/60 p-2">
                  {visibleItems.map((item) => (
                    <SourceItemCard
                      key={item.id}
                      durationSeconds={getSourceItemDurationSeconds(item, durationMap)}
                      mediaInfo={mediaInfoMap[item.id]}
                      isSelected={item.id === selectedSourceItem?.id}
                      item={item}
                      onAddAudio={(trackIndex) => addAudioClip(item, trackIndex)}
                      onAddVisual={(trackIndex) => addVisualClip(item, trackIndex)}
                      alignmentScriptSelected={item.id === alignmentCaptionItemId}
                      onAlignCaptions={alignmentCaptionItemId ? () => void alignCaptionSourceItem(item) : undefined}
                      onApplyCaptions={() => void applyCaptionSourceItem(item)}
                      onAutoCaptions={() => void autoCaptionSourceItem(item)}
                      onCleanDialogue={() => void cleanDialogueSourceItem(item)}
                      onOpenPreview={() => openSourceBinPreview(item)}
                      onRelink={nativeVideoMediaManagementAvailable ? () => void relinkSourceLibraryItem(item) : undefined}
                      relinkDisabled={mediaManagementBusy}
                      onRemove={() => removeSourceLibraryItem(item)}
                      onSelect={() => selectSourceItem(item.id)}
                      onToggleCollapsed={() => setSourceBinItemCollapsed(item.id, !item.collapsed)}
                      onToggleStarred={() => toggleSourceBinItemStarred(item.id)}
                      onUseAsAlignmentScript={() => setAlignmentCaptionItemId((current) => current === item.id ? undefined : item.id)}
                    />
                  ))}
                  {remainingItemCount > 0 ? (
                    <button
                      className="w-full rounded-lg border border-dashed border-gray-600/70 bg-[#0d1118] px-3 py-2 text-[11px] font-semibold text-gray-300 transition-colors hover:border-cyan-300/40 hover:text-cyan-100"
                      onClick={() => showMoreMediaPoolItems(section.kind)}
                      type="button"
                    >
                      Show next {Math.min(SOURCE_BIN_PAGE_SIZE, remainingItemCount)} · {remainingItemCount} remaining
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSourceBinFilterControls = () => (
    <div className="mt-2 space-y-2" data-video-source-origin-controls="true">
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-gray-700/60 bg-[#090d13] p-1" role="group" aria-label="Filter media by origin">
        {SOURCE_BIN_ORIGIN_FILTER_OPTIONS.map((option) => {
          const count = sourceBinOriginCounts[option.id];
          const active = sourceBinOriginFilter === option.id;

          return (
            <button
              aria-pressed={active}
              className={`min-w-0 rounded-md px-1.5 py-1.5 text-[10px] font-semibold transition-colors ${active
                ? option.id === 'generated'
                  ? 'bg-violet-400/15 text-violet-100 ring-1 ring-violet-300/35'
                  : 'bg-blue-400/15 text-blue-100 ring-1 ring-blue-300/35'
                : 'text-gray-500 hover:bg-white/5 hover:text-gray-200'}`}
              key={option.id}
              onClick={() => {
                setSourceBinOriginFilter(option.id);
                setSourceBinKindFilter('all');
              }}
              title={option.id === 'ingested'
                ? 'Camera originals and files imported by the editor'
                : option.id === 'generated'
                  ? 'AI outputs, renders, extracted frames, narration, and derived media'
                  : 'Show both ingested and generated project media'}
              type="button"
            >
              <span className="truncate">{option.label}</span> <span className="tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        {SOURCE_BIN_KIND_FILTER_OPTIONS.map((option) => {
          const count = sourceBinKindCounts[option.id];
          const isActive = sourceBinKindFilter === option.id;

          if (option.id !== 'all' && count === 0) return null;

          return (
            <button
              className={`${sourceBinFilterButtonClassName} ${isActive
                ? 'border-cyan-300/50 bg-cyan-400/15 text-cyan-50'
                : 'border-gray-700/60 bg-[#0f131b] text-gray-400 hover:border-gray-500 hover:text-white'}`}
              key={option.id}
              onClick={() => setSourceBinKindFilter(option.id)}
              type="button"
            >
              {option.label} {count}
            </button>
          );
        })}
      </div>
      {nativeVideoMediaManagementAvailable ? (
        <div className="rounded-lg border border-gray-700/60 bg-[#0f131b] p-2">
          <button
            className={`${smallEditorButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={mediaManagementBusy || consolidatableVideoMediaItemIds.length === 0}
            onClick={() => void consolidateUsedVideoMedia()}
            title="Copy file-backed media referenced by every project sequence into a folder chosen by the desktop app"
            type="button"
          >
            <Archive size={12} />
            {mediaManagementBusy ? 'Media operation in progress' : `Consolidate Used (${consolidatableVideoMediaItemIds.length})`}
          </button>
          <div className="mt-1 text-[10px] leading-relaxed text-gray-500">
            Only file-backed media referenced by project sequences is copied. Existing timeline identities remain unchanged.
          </div>
          {mediaManagementStatus ? (
            <div aria-live="polite" className="mt-1.5 text-[10px] leading-relaxed text-cyan-100/80">
              {mediaManagementStatus}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const hasVisibleMonitors = sourceMonitorVisible || programMonitorVisible;
  const isCompositionRendering = Boolean(activeComposition?.data.isRunning);
  const compositionRenderStatus = typeof activeComposition?.data.statusMessage === 'string'
    ? activeComposition.data.statusMessage
    : undefined;
  const compositionRenderError = typeof activeComposition?.data.error === 'string'
    ? activeComposition.data.error
    : undefined;
  /**
   * Returns a promise so the durable render queue can await a deliverable instead of duplicating
   * this route. Every existing caller ignores the value and behaves exactly as before.
   */
  const renderActiveComposition = async (): Promise<void> => {
    if (!activeComposition || isCompositionRendering || managedFontGate.status !== 'ready') {
      return;
    }

    const canUseCachedComposition = Boolean(
      activeCompositionCachedResult
      && activeCompositionCachedRenderSignature === currentCompositionRenderCacheSignature,
    );
    const dirtyPlan = buildCurrentRenderDirtyPlan(
      canUseCachedComposition ? renderSegmentSignaturesRef.current : {},
    );
    const cacheAction = resolveVideoRenderCacheAction({
      dirtyPlan,
      cachedResultUrl: activeCompositionCachedResult,
      cacheInvalidationReason: activeCompositionCachedResult && !canUseCachedComposition
        ? 'composition inputs changed'
        : undefined,
    });
    const segmentReusePlan = canUseCachedComposition
      ? buildVideoRenderSegmentReusePlan({
        dirtyPlan,
        cachedArtifacts: activeCompositionSegmentArtifacts,
      })
      : undefined;
    const hasSegmentArtifactManifest = Object.keys(activeCompositionSegmentArtifacts).length > 0;
    const assemblyManifest = segmentReusePlan?.summary && hasSegmentArtifactManifest
      ? buildVideoRenderAssemblyManifest(segmentReusePlan)
      : undefined;
    const renderCacheSummary = cacheAction.kind === 'render'
      && dirtyPlan.dirtySegments.length > 0
      && hasSegmentArtifactManifest
      && segmentReusePlan?.summary
      ? segmentReusePlan.summary
      : cacheAction.summary;

    setIncrementalRenderSummary(renderCacheSummary);

    if (cacheAction.kind === 'reuse-cache') {
      patchNodeData(activeComposition.id, {
        error: undefined,
        statusMessage: cacheAction.summary,
      });
      setProgramMonitorMode('rendered');
      return;
    }

    patchNodeData(activeComposition.id, {
      editorRenderCacheAssemblyManifest: assemblyManifest,
      editorRenderCacheLastAssemblyManifest: undefined,
    });

    await runNode(activeComposition.id).then(() => {
      const latestComposition = useFlowStore
        .getState()
        .nodes
        .find((node) => node.id === activeComposition.id);
      const hasRenderedOutput = typeof latestComposition?.data.result === 'string'
        && latestComposition.data.result.length > 0;

      if (!latestComposition || latestComposition.data.error || !hasRenderedOutput) {
        return;
      }

      renderSegmentSignaturesRef.current = dirtyPlan.segmentSignatures;
      const renderCacheUpdatedAt = new Date().toISOString();
      const assemblyResult = normalizeVideoRenderAssemblyResult(latestComposition.data.resultOutputMetadata?.assemblyResult);
      patchNodeData(activeComposition.id, {
        editorRenderCacheCompositionSignature: currentCompositionRenderCacheSignature,
        editorRenderCacheSegmentSignatures: dirtyPlan.segmentSignatures,
        editorRenderCacheSegmentArtifacts: buildVideoRenderSegmentArtifactsForCompletedRender({
          reusePlan: segmentReusePlan,
          cachedArtifacts: activeCompositionSegmentArtifacts,
          segmentArtifacts: latestComposition.data.resultOutputMetadata?.segmentArtifacts,
          updatedAt: renderCacheUpdatedAt,
        }),
        editorRenderCacheAssemblyManifest: undefined,
        editorRenderCacheLastAssemblyManifest: assemblyManifest,
        editorRenderCacheLastAssemblyResult: assemblyResult,
        editorRenderCacheUpdatedAt: renderCacheUpdatedAt,
      });
      // Keep the live Edit Stage visible while a render is running or if it fails. A successful
      // deliverable (or the cache-reuse branch above) is the only point at which there is a
      // rendered preview worth presenting. This also keeps timeline scrubbing visibly connected
      // to the source media when the renderer reports an error.
      setProgramMonitorMode('rendered');
    });
  };
  /**
   * Produces one queued deliverable. Video outputs go through the composition's own export route —
   * the queue drives the existing renderer rather than adding a second one — while text
   * deliverables are produced in-renderer. Anything else was already planned as blocked, so
   * reaching here with an unknown kind is a real failure rather than something to paper over.
   *
   * Text artifacts are registered in the Source Library instead of being pushed at the browser as
   * downloads: they then persist with the project, and their item id gives recovery something it
   * can actually check.
   */
  const executeRenderQueueOutput = async (
    output: VideoRenderQueueOutput,
  ): Promise<VideoRenderQueueOutputResult> => {
    if (isVideoDeliveryOutput(output)) {
      // renderActiveComposition returns silently when the renderer is busy or its fonts are not
      // registered, which would leave a previous render sitting in `result` for this deliverable to
      // claim. Refusing outright is honest and retryable; adopting a stale file is neither.
      if (isCompositionRendering || managedFontGate.status !== 'ready') {
        throw new Error('The composition renderer was not free when this deliverable started.');
      }
      await renderActiveComposition();
      const rendered = useFlowStore.getState().nodes.find((node) => node.id === activeComposition?.id);
      if (typeof rendered?.data.error === 'string' && rendered.data.error) throw new Error(rendered.data.error);
      const reference = typeof rendered?.data.result === 'string' ? rendered.data.result : '';
      if (!reference) throw new Error('The composition renderer produced no output for this deliverable.');
      // A result only counts as this deliverable when the render cache says it was produced for the
      // cut the job was frozen against. Anything else is a leftover from an earlier render.
      if (rendered?.data.editorRenderCacheCompositionSignature !== currentCompositionRenderCacheSignature) {
        throw new Error('The composition render did not complete for the current cut of this sequence.');
      }
      // The rendered file is owned by the composition render cache; the queue records where it is
      // and never copies, moves, or hashes it.
      return { reference: `${COMPOSITION_RENDER_REFERENCE_PREFIX}${reference}` };
    }

    let data: string;
    let mediaType: string;
    let kind: 'subtitle' | 'document';
    if (output.codec === 'webvtt' || output.container === 'webvtt') {
      const serialized = serializeVideoCaptionDocument(professionalCaptionDocument, 'vtt');
      data = serialized.data;
      mediaType = serialized.mediaType;
      kind = 'subtitle';
    } else if (output.codec === 'structural-qc-v1') {
      const report = buildCurrentStructuralQcReport();
      if (!report.ok) throw new Error(report.reason);
      data = JSON.stringify(report.value, null, 2);
      mediaType = 'application/json';
      kind = 'document';
    } else {
      throw new Error(`No renderer in this build can produce ${output.label} (${output.codec ?? 'unknown codec'}).`);
    }

    const bytes = new TextEncoder().encode(data);
    const item = await addAssetItem({
      kind,
      label: output.fileName,
      mimeType: mediaType,
      dataUrl: `data:${mediaType};base64,${bytesToBase64(bytes)}`,
      isGenerated: true,
      originNodeId: activeComposition?.id,
    });
    return {
      byteSize: bytes.byteLength,
      checksum: await sha256Hex(bytes),
      reference: `${SOURCE_LIBRARY_REFERENCE_PREFIX}${item.id}`,
    };
  };

  /**
   * The runner. One output at a time, always started from the freshly persisted queue, and every
   * outcome written back through the same bounded transitions. The completion guard lives in the
   * queue module rather than here, so a result that arrives after the user cancelled is discarded
   * instead of resurrecting the job.
   */
  useEffect(() => {
    const compositionId = activeComposition?.id;
    if (!compositionId || renderQueueRunRef.current) return;
    if (!reconciledRenderQueuesRef.current.has(compositionId)) return;
    // Recovery is visible but inert until the user says go, so reopening a project never starts a
    // render by itself.
    if (runningRenderQueueCompositionId !== compositionId) return;
    const selection = selectNextVideoRenderQueueWork(professionalWorkflowState.deliveryJobs, {
      currentCompositionSignature: currentCompositionRenderCacheSignature,
    });
    if (!selection) return;
    const queued = professionalWorkflowState.deliveryJobs
      .find((record) => record.id === selection.jobId)?.outputs
      ?.find((candidate) => candidate.id === selection.outputId);
    // A video deliverable shares the composition's single renderer. When that renderer is busy or
    // its fonts are not registered yet, the output simply waits rather than failing.
    if (queued && isVideoDeliveryOutput(queued)
      && (isCompositionRendering || managedFontGate.status !== 'ready')) return;

    const started = mutateRenderQueue(compositionId, (records) => startVideoRenderQueueOutput(records, selection, {
      now: Date.now(),
      currentCompositionSignature: currentCompositionRenderCacheSignature,
    }));
    if (!started?.changed) return;

    const output = started.records
      .find((record) => record.id === selection.jobId)?.outputs
      ?.find((candidate) => candidate.id === selection.outputId);
    const executionLeaseId = output?.executionLeaseId;
    if (!executionLeaseId) return;
    const runKey = `${selection.jobId}:${selection.outputId}:${executionLeaseId}`;
    renderQueueRunRef.current = runKey;

    void (async () => {
      try {
        if (!output) throw new Error('The queued output disappeared before it could be rendered.');
        const result = await executeRenderQueueOutput(output);
        mutateRenderQueue(compositionId, (records) =>
          completeVideoRenderQueueOutput(records, selection, result, { now: Date.now(), id: executionLeaseId }));
      } catch (error: unknown) {
        mutateRenderQueue(compositionId, (records) => failVideoRenderQueueOutput(
          records,
          selection,
          error instanceof Error ? error.message : 'The render failed without a reported reason.',
          { now: Date.now(), id: executionLeaseId },
        ));
      } finally {
        if (renderQueueRunRef.current === runKey) {
          renderQueueRunRef.current = undefined;
          // A cancel/retry can requeue while the old promise is still unwinding. Re-rendering when
          // that old lease releases the slot lets the replacement attempt start without a second
          // user click, while the lease guard above refuses the old callback's outcome.
          setRenderQueueRunEpoch((value) => value + 1);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the runner reacts to queue content, not to every render-scoped helper it closes over.
  }, [
    activeComposition?.id,
    currentCompositionRenderCacheSignature,
    isCompositionRendering,
    managedFontGate.status,
    mutateRenderQueue,
    professionalWorkflowState.deliveryJobs,
    renderQueueRunEpoch,
    runningRenderQueueCompositionId,
  ]);

  const exportTimelineCaptions = (format: 'srt' | 'vtt') => {
    const cues = textClipsToCaptionCues(visualClips);

    if (cues.length === 0) {
      return;
    }

    const mimeType = format === 'srt' ? 'application/x-subrip' : 'text/vtt';
    const body = format === 'srt' ? serializeSrtCaptions(cues) : serializeWebVttCaptions(cues);
    const objectUrl = URL.createObjectURL(new Blob([body], { type: mimeType }));

    void downloadAsset(
      objectUrl,
      buildDownloadFilename(`${EXPORT_BASENAME}-captions`, mimeType, format),
    ).finally(() => window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000));
  };
  const handleTimelineSourceDrop = (
    event: React.DragEvent<HTMLDivElement>,
    trackType: 'visual' | 'audio',
    trackIndex: number,
  ) => {
    const itemId = getDraggedSourceItemId(event.dataTransfer);

    if (!itemId) {
      return;
    }

    const item = sourceItemById.get(itemId);

    if (!item) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (trackType === 'visual') {
      if (canUseSourceItemAsVisual(item)) {
        addVisualClip(item, trackIndex);
      }
      return;
    }

    if (canUseSourceItemAsAudio(item)) {
      addAudioClip(item, trackIndex);
    }
  };

  const resetVideoPanelLayout = () => {
    restoreWorkspaceSnapshot({ workspaceView: 'editor' });
    resetWorkspacePanels(VIDEO_WORKSPACE_ID);
  };

  const videoPanelDefaults = buildVideoDockablePanelDefaults({
    sourceBinVisible,
    sourceMonitorVisible,
    programMonitorVisible,
    inspectorVisible,
    sourceBinWidth,
    inspectorWidth,
    monitorSplitPercent,
    monitorSectionHeight,
  });
  const videoPanelDefaultById = new Map(videoPanelDefaults.map((panel) => [panel.panelId, panel]));
  const withVideoPanelDefault = (
    panelId: keyof typeof VIDEO_PANEL_IDS,
    definition: Omit<DockablePanelDefinition, 'workspaceId' | 'panelId'>,
  ): DockablePanelDefinition => ({
    ...videoPanelDefaultById.get(VIDEO_PANEL_IDS[panelId])!,
    ...definition,
    panelId: VIDEO_PANEL_IDS[panelId],
    workspaceId: VIDEO_WORKSPACE_ID,
  });

  const videoPanels: DockablePanelDefinition[] = [
    withVideoPanelDefault('projectSourceBin', {
      title: 'Project Source Bin',
      allowedDockZones: ['left', 'right', 'center', 'overlay'],
      bodyClassName: 'overflow-hidden p-0',
      content: (
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="border-b border-gray-700/60 px-2 py-2">
            <div className="flex h-7 min-w-0 items-center gap-1" data-video-source-bin-compact-header="true">
              <div className="grid min-w-0 flex-1 grid-cols-2 rounded-md border border-gray-700/60 bg-[#0f131b] p-0.5" role="tablist">
              <button className={sourceBinTab === 'media' ? activeTabClassName : inactiveTabClassName} onClick={() => setSourceBinTab('media')} role="tab" type="button">
                Library
              </button>
              <button className={sourceBinTab === 'editorAssets' ? activeTabClassName : inactiveTabClassName} onClick={() => setSourceBinTab('editorAssets')} role="tab" type="button">
                Design Assets
              </button>
              </div>
              <div
                aria-label={`${sourceBinTab === 'media' ? mediaSourceItems.length : editorAssets.length} items`}
                className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded border border-gray-700/60 bg-[#111217]/60 px-1.5 text-[10px] font-semibold tabular-nums text-gray-300"
                title={`${sourceBinTab === 'media' ? mediaSourceItems.length : editorAssets.length} items`}
              >
                {sourceBinTab === 'media' ? mediaSourceItems.length : editorAssets.length}
              </div>
              {sourceBinTab === 'media' && linkedMediaItemCount > 0 ? (
                <div className="hidden h-6 shrink-0 items-center rounded border border-emerald-300/25 bg-emerald-400/10 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-100 2xl:flex" title="Video and audio linked directly from disk; source files are not duplicated into browser memory.">
                  {linkedMediaItemCount} linked
                </div>
              ) : null}
              {sourceBinTab === 'media' && mediaSourceItems.length > 0 ? (
                <>
                  <button aria-label="Hide media pools" className={miniTrackButtonClassName} onClick={() => setSourceBinMediaPoolCollapsed({ image: true, video: true, audio: true, subtitle: true })} title="Hide media pools" type="button"><ChevronRight size={12} /></button>
                  <button aria-label="Show media pools" className={miniTrackButtonClassName} onClick={() => setSourceBinMediaPoolCollapsed({ image: false, video: false, audio: false, subtitle: false })} title="Show media pools" type="button"><ChevronDown size={12} /></button>
                  <button aria-label="Collapse all source items" className={miniTrackButtonClassName} onClick={() => setAllSourceBinItemsCollapsed(true)} title="Collapse all source items" type="button"><ChevronRight size={12} /></button>
                  <button aria-label="Expand all source items" className={miniTrackButtonClassName} onClick={() => setAllSourceBinItemsCollapsed(false)} title="Expand all source items" type="button"><ChevronDown size={12} /></button>
                </>
              ) : null}
            </div>
            {sourceBinTab === 'media' ? (
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#090d13] px-2 py-1.5 text-gray-300">
                <Search className="shrink-0 text-gray-500" size={13} />
                <input
                  className="min-w-0 flex-1 bg-transparent text-xs text-gray-100 outline-none placeholder:text-gray-600"
                  onChange={(event) => setSourceBinSearchQuery(event.target.value)}
                  placeholder="Search clips, types, or origin"
                  type="search"
                  value={sourceBinSearchQuery}
                />
                {activeProfessionalSmartBin ? (
                  <button aria-label={`Clear smart bin ${activeProfessionalSmartBin.name}`} className="max-w-28 truncate rounded border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100" onClick={() => setActiveProfessionalSmartBinId(undefined)} title={`Smart bin: ${activeProfessionalSmartBin.name}`} type="button">{activeProfessionalSmartBin.name} ×</button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {sourceBinTab === 'media' ? (
                <>
                  <button className={smallEditorButtonClassName} onClick={() => void openSourceBinImportPicker(EDITOR_MEDIA_IMPORT_ACCEPT, ['video', 'audio'])} type="button">
                    <Archive size={12} />
                    Import Media
                  </button>
                  <button className={smallEditorButtonClassName} onClick={() => void openSourceBinImportPicker(EDITOR_VIDEO_IMPORT_ACCEPT, ['video'])} type="button">
                    <Film size={12} />
                    Video
                  </button>
                  <button className={smallEditorButtonClassName} onClick={() => void openSourceBinImportPicker(EDITOR_AUDIO_IMPORT_ACCEPT, ['audio'])} type="button">
                    <Music2 size={12} />
                    Audio
                  </button>
                  <button className={smallEditorButtonClassName} onClick={() => void openSourceBinImportPicker(EDITOR_CAPTION_IMPORT_ACCEPT)} type="button">
                    <Type size={12} />
                    Captions
                  </button>
                </>
              ) : (
                <>
                  <button className={smallEditorButtonClassName} onClick={() => void openSourceBinImportPicker(EDITOR_IMAGE_IMPORT_ACCEPT)} type="button">
                    <ImageIcon size={12} />
                    Image
                  </button>
                  <button className={smallEditorButtonClassName} onClick={() => addEditorAsset('text')} type="button">
                    <Type size={12} />
                    Text
                  </button>
                  <button className={smallEditorButtonClassName} onClick={() => addEditorAsset('shape')} type="button">
                    <Square size={12} />
                    Shape
                  </button>
                  <button
                    className={`${smallEditorButtonClassName} disabled:cursor-wait disabled:opacity-50`}
                    disabled={isImportingPaperStoryboardPages || paperStoryboardPageDescriptors.length === 0}
                    onClick={() => void importPaperStoryboardPages()}
                    type="button"
                  >
                    <BookOpen size={12} />
                    {isImportingPaperStoryboardPages ? 'Preparing' : 'Paper Pages'}
                  </button>
                </>
              )}
              <input
                className="hidden"
                multiple
                onChange={(event) => {
                  if (event.target.files?.length) {
                    void importFilesForActiveBin(event.target.files);
                  }
                }}
                ref={importAcceptRef}
                type="file"
              />
            </div>
            {sourceBinTab === 'editorAssets' && (paperStoryboardPageDescriptors.length > 0 || paperStoryboardImportStatus) ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-indigo-300/15 bg-indigo-400/10 px-2 py-1.5 text-[11px] text-indigo-100">
                <span className="flex min-w-0 items-center gap-1.5">
                  <BookOpen className="shrink-0" size={12} />
                  <span className="truncate">
                    {paperStoryboardExistingItemIds.size} of {paperStoryboardPageDescriptors.length} Paper page{paperStoryboardPageDescriptors.length === 1 ? '' : 's'} available
                  </span>
                </span>
                {paperStoryboardImportStatus ? (
                  <span className="min-w-0 truncate text-indigo-100/75">{paperStoryboardImportStatus}</span>
                ) : null}
              </div>
            ) : null}
            {sourceBinTab === 'media' ? renderSourceBinFilterControls() : null}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
            {sourceBinTab === 'media' ? (
              mediaSourceItems.length > 0 ? (
                renderMediaSourcePools()
              ) : (
                <EmptyState
                  body={timelineSourceItems.length > 0
                    ? 'No source-library items match the current search and filter.'
                    : undefined}
                  title={timelineSourceItems.length > 0 ? 'No matching sources' : 'No saved project assets'}
                />
              )
            ) : editorAssets.length > 0 ? (
              editorAssets.map((asset) => (
                <EditorAssetCard
                  asset={asset}
                  key={asset.id}
                  onOpenContextMenu={(event) => openEditorAssetContextMenu(asset, event)}
                  onPlace={(trackIndex) => placeEditorAssetOnTrack(asset, trackIndex)}
                  previewSourceItem={asset.kind === 'image' && asset.imageSourceId ? sourceItemByNodeId.get(asset.imageSourceId) : undefined}
                />
              ))
            ) : (
              <EmptyState body="Create text and shape assets or import image assets here, then place them on visual tracks like normal clips." title="No editor assets" />
            )}
          </div>
        </div>
      ),
    }),
    withVideoPanelDefault('sourceMonitor', {
      title: 'Source Monitor',
      centerDockPresentation: 'split',
      allowedDockZones: ['top', 'left', 'right', 'center', 'overlay'],
      bodyClassName: 'overflow-hidden p-0',
      content: (
        <div className="h-full min-h-0">
          <SourceMonitorPanel
            item={selectedSourceItem}
            marks={selectedSourceItem && sourceMarks?.itemId === selectedSourceItem.id ? sourceMarks : undefined}
            mediaInfo={selectedSourceItem ? mediaInfoMap[selectedSourceItem.id] : undefined}
            onAddAudio={addAudioClip}
            onAddVisual={addVisualClip}
            onMarkIn={() => markSourcePoint('in')}
            onMarkOut={() => markSourcePoint('out')}
            onInsertEdit={() => performThreePointEdit('insert')}
            onOverwriteEdit={() => performThreePointEdit('overwrite')}
            onOpenContextMenu={(event) => {
              event.preventDefault();
              const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];
              if (selectedSourceItem) {
                menuItems.push({ label: 'Send Source To Flow Workspace', action: () => sendSourceItemToFlow(selectedSourceItem) });
              }
              if (selectedSourceItem && (selectedSourceItem.kind === 'video' || selectedSourceItem.kind === 'composition')) {
                menuItems.push({ label: 'Capture Current Frame To Flow', action: () => void captureVideoFrameToFlow(sourceMonitorVideoRef.current, `${selectedSourceItem.label}-frame`) });
              }
              if (menuItems.length > 0) setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
            }}
            sourceDurationSeconds={getSourceItemDurationSeconds(selectedSourceItem, durationMap)}
            videoRef={sourceMonitorVideoRef}
          />
        </div>
      ),
    }),
    withVideoPanelDefault('programMonitor', {
      title: 'Program Monitor',
      centerDockPresentation: 'split',
      allowedDockZones: ['center', 'top', 'left', 'right', 'overlay'],
      bodyClassName: 'overflow-hidden p-0',
      content: (
        <div className="h-full min-h-0">
          <ProgramMonitorPanel
            activeTool={timelineTool}
            aspectRatio={compositionAspectRatio}
            audioClipCount={audioClips.length}
            canvas={programCanvas}
            errorMessage={compositionRenderError ?? (!videoRuntime.ok
              ? videoRuntime.errors.join(' ')
              : multicamProjection.ok ? undefined : multicamProjection.message)}
            exportReadiness={exportReadiness}
            managedFontGate={managedFontGate}
            incrementalRenderSummary={incrementalRenderSummary}
            isRunning={isCompositionRendering}
            onAddEditorAsset={addEditorAsset}
            onAddComicStageObject={addComicStageObject}
            renderStatusMessage={compositionRenderStatus ?? incrementalRenderSummary}
            renderBackendStatus={renderBackendStatus}
            renderCacheDetailLines={renderCacheDetailLines}
            hasActiveComposition={Boolean(activeComposition)}
            onCreateComposition={handleCreateComposition}
            onCreateStarterSequence={handleCreateStarterSequence}
            onRevealSourceBin={handleRevealSourceBin}
            onExportFcpXml={handleExportFcpXml}
            onAspectRatioChange={(aspectRatio) => updateActiveCompositionSettings({ aspectRatio })}
            onOpenClipContextMenu={openVisualClipContextMenu}
            onOpenContextMenu={(event) => {
              event.preventDefault();
              const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];
              if (previewUrl && !isProgramImageSequenceOutput) {
                const exportPreset = getVideoExportPresetOption(exportPresetPlan.presetId);
                menuItems.push({
                  label: 'Send Program Video To Flow Workspace',
                  action: () => sendSourceItemToFlow({
                    id: `program-${activeComposition?.id ?? 'preview'}`,
                    nodeId: activeComposition?.id ?? `program-${Date.now()}`,
                    kind: 'video',
                    label: activeComposition?.data.modelId ?? 'Program render',
                    assetUrl: previewUrl,
                    mimeType: exportPreset.mimeType,
                  }),
                });
                menuItems.push({ label: 'Capture Current Frame To Flow', action: () => void captureVideoFrameToFlow(programMonitorVideoRef.current, 'program-frame') });
              }
              if (menuItems.length > 0) setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
            }}
            onResolutionChange={(videoResolution) => updateActiveCompositionSettings({ videoResolution })}
            onFrameRateChange={(videoFrameRate) => updateActiveCompositionSettings({ videoFrameRate })}
            onExportPresetPlanChange={(presetId) => updateActiveCompositionSettings({ editorExportPresetPlan: { ...exportPresetPlan, presetId } })}
            onRenderBackendPreferenceChange={(preference) => setProviderSetting('renderBackendPreference', preference)}
            renderBackendPreference={renderBackendPreference}
            hasCaptionCues={textClipsToCaptionCues(visualClips).length > 0}
            onExportCaptions={exportTimelineCaptions}
            onRun={renderActiveComposition}
            onSelectClip={(clipId) => {
              const clip = visualClips.find((candidate) => candidate.id === clipId)
                ?? visualClips.find((candidate) => clipId.startsWith(`${candidate.id}:multicam:`));
              if (clip) selectVisualClip(clip);
            }}
            onSelectStageObject={selectStageObject}
            onSetMonitorMode={setProgramMonitorMode}
            onUpdateClip={updateVisualClipById}
            onUpdateStageObject={updateStageObject}
            previewUrl={previewUrl}
            previewOutputMetadata={previewOutputMetadata}
            playheadSeconds={timelineCursorSeconds}
            selectedClip={selectedVisualClip}
            selectedStageObject={selectedStageObject}
            exportPresetPlan={exportPresetPlan}
            monitorParityNotices={monitorParityNotices}
            parityDiagnostics={parityDiagnostics}
            sequenceSummary={sequenceSummary}
            stageClips={programStageClips}
            stageObjects={stageObjects}
            stageMode={programMonitorMode}
            transportRate={shuttleRate}
            videoRef={programMonitorVideoRef}
            videoResolution={compositionResolution}
            frameRate={compositionFrameRate}
            visualClipCount={visualClips.length}
          />
        </div>
      ),
    }),
    withVideoPanelDefault('timeline', {
      title: 'Timeline',
      allowedDockZones: ['bottom', 'center', 'top', 'overlay'],
      bodyClassName: 'overflow-hidden p-0',
      content: (
        <SequencerTimelinePanel
          activeComposition={activeComposition}
          addAudioVolumeAutomationPoint={addAudioVolumeAutomationPoint}
          addOrUpdateKeyframeAtPlayhead={addOrUpdateKeyframeAtPlayhead}
          addTimelineSnapAtSeconds={addTimelineSnapAtSeconds}
          addVisualOpacityAutomationPoint={addVisualOpacityAutomationPoint}
          audioBlocks={audioBlocks}
          audioClips={audioClips}
          audioTrackCount={audioTrackCount}
          audioTrackVolumes={audioTrackVolumes}
          mutedAudioTracks={mutedAudioTracks}
          soloAudioTracks={soloAudioTracks}
          audioWaveformMap={audioWaveformMap}
          canKeyframeSelectedClip={canKeyframeSelectedClip}
          clearTimelineSelection={clearTimelineSelection}
          clearTimelineSnapPoints={clearTimelineSnapPoints}
          clipEdgePreviewMap={clipEdgePreviewMap}
          compositionFrameRate={compositionFrameRate}
          displayTimelineSeconds={displayTimelineSeconds}
          handleTimelineSourceDrop={handleTimelineSourceDrop}
          jumpToAdjacentSelectedKeyframe={jumpToAdjacentSelectedKeyframe}
          onCutSelectedVisualClipAtPlayhead={cutSelectedVisualClipAtPlayhead}
          onOpenTimelineGapContextMenu={openTimelineGapContextMenu}
          onOpenAudioClipContextMenu={(id, event) => {
            event.preventDefault();
            const item = sourceItemByNodeId.get(audioClips.find((candidate) => candidate.id === id)?.sourceNodeId ?? '');
            const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

            if (item) {
              menuItems.push({ label: 'Send Source To Flow Workspace', action: () => sendSourceItemToFlow(item) });
            }

            // Fades are explicit clip processing so they combine safely with existing keyframes.
            const clipBlock = audioBlocks.find((candidate) => candidate.clip.id === id);
            if (clipBlock && clipBlock.durationSeconds > 0) {
              const canSplitHere = timelineCursorSeconds > clipBlock.startSeconds
                && timelineCursorSeconds < clipBlock.endSeconds
                && Boolean(splitEditorAudioClipAtTimelineSeconds(
                  clipBlock.clip,
                  getSourceItemDurationSeconds(item, durationMap) ?? 0,
                  timelineCursorSeconds,
                  (side) => side,
                ));
              if (canSplitHere) {
                menuItems.push({
                  label: `Split At Playhead (${timelineCursorSeconds.toFixed(2)}s)`,
                  action: () => { splitAudioClipAtSeconds(id, timelineCursorSeconds); },
                });
              }
              const fadeSeconds = Math.min(0.5, clipBlock.durationSeconds / 4);
              const patchFade = (direction: 'in' | 'out') => {
                updateAudioClips(
                  audioClips.map((candidate) =>
                    candidate.id === id
                      ? { ...candidate, [direction === 'in' ? 'fadeInSeconds' : 'fadeOutSeconds']: fadeSeconds }
                      : candidate,
                  ),
                  direction === 'in' ? 'Audio fade in' : 'Audio fade out',
                );
                setContextMenu(null);
              };
              menuItems.push({ label: `Fade In (${fadeSeconds.toFixed(1)}s)`, action: () => patchFade('in') });
              menuItems.push({ label: `Fade Out (${fadeSeconds.toFixed(1)}s)`, action: () => patchFade('out') });

              // Crossfade with the previous overlapping clip on the same lane.
              const previous = audioBlocks
                .filter((candidate) => candidate.clip.trackIndex === clipBlock.clip.trackIndex
                  && candidate.clip.id !== id
                  && candidate.startSeconds < clipBlock.startSeconds)
                .sort((a, b) => b.startSeconds - a.startSeconds)[0];
              const crossfade = previous ? resolveCrossfadePercents(previous, clipBlock) : null;
              if (previous && crossfade) {
                menuItems.push({
                  label: `Crossfade With Previous Clip (${crossfade.overlapSeconds.toFixed(1)}s overlap)`,
                  action: () => {
                    updateAudioClips(
                      audioClips.map((candidate) => {
                        if (candidate.id === previous.clip.id) {
                          return { ...candidate, fadeOutSeconds: crossfade.overlapSeconds };
                        }
                        if (candidate.id === id) {
                          return { ...candidate, fadeInSeconds: crossfade.overlapSeconds };
                        }
                        return candidate;
                      }),
                      'Audio crossfade',
                    );
                    setContextMenu(null);
                  },
                });
              }
            }

            menuItems.push({
              label: 'Remove From Lane',
              tone: 'danger',
              action: () => {
                commitActiveCompositionPatch(
                  buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [id]),
                  'Update audio clips',
                );
                setContextMenu(null);
              },
            });

            setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
          }}
          onOpenVisualClipContextMenu={openVisualClipContextMenu}
          onSelectAudioClip={selectAudioClip}
          onSelectVisualClip={selectVisualClip}
          onSelectManyAudioClips={(ids) => { setSelectedAudioClipIds(ids.slice(0, 2_000), ids.at(-1)); setSelectedVisualClipIds([]); }}
          onSelectManyVisualClips={(ids) => { setSelectedVisualClipIds(ids.slice(0, 2_000), ids.at(-1)); setSelectedAudioClipIds([]); }}
          onSetSelectedSourceItemId={setSelectedSourceItemId}
          onSetSelectedStageObjectId={setSelectedStageObjectId}
          onSetSelectedTimelineGap={setSelectedTimelineGap}
          onSetTimelineCursorSeconds={setTimelineCursorSeconds}
          onSetTimelineTool={setTimelineToolWithActivity}
          onBeginProfessionalTrim={beginProfessionalTrimFromTimeline}
          onSetTimelineZoomPercent={setTimelineZoomPercent}
          onSetTrackHeight={setTimelineTrackHeight}
          onStartTimelineHandPan={startTimelineHandPan}
          onStartTimelineTrackResize={startTimelineTrackResize}
          onUpdateAudioTrackVolume={updateAudioTrackVolume}
          onToggleAudioTrackMute={toggleAudioTrackMute}
          onToggleAudioTrackSolo={toggleAudioTrackSolo}
          removeAudioVolumeAutomationPoint={removeAudioVolumeAutomationPoint}
          removeVisualOpacityAutomationPoint={removeVisualOpacityAutomationPoint}
          timelineRulerTicks={timelineRulerTicks}
          timelineContentWidthPercent={timelineContentWidthPercent}
          timelineViewportRange={timelineViewportRange}
          timelineNavigationModel={timelineNavigationModel}
          timelineNavigationUnavailableReason={timelineNavigationUnavailableReason}
          onTimelineOverviewNavigate={(navigation) => {
            if (navigation.kind === 'seek') {
              setTimelineCursorSeconds(navigation.timeMs / 1_000);
            } else if (navigation.kind === 'viewport') {
              const element = timelineScrollRef.current;
              if (element && timelineNavigationModel) {
                element.scrollLeft = (navigation.range.startMs / timelineNavigationModel.durationMs) * element.scrollWidth;
                updateTimelineViewportRange(element);
              }
            }
          }}
          onTimelineScroll={updateTimelineViewportRange}
          longFormSequence={longFormSequence}
          selectedAudioClip={selectedAudioClip}
          selectedAudioClipIds={selectedAudioClipIds}
          selectedTimelineGap={selectedTimelineGap}
          selectedVisualClip={selectedVisualClip}
          selectedVisualClipIds={selectedVisualClipIds}
          sequenceDurationSeconds={sequenceDurationSeconds}
          shuttleRate={shuttleRate}
          timelineMarkers={timelineMarkers}
          onJumpToMarker={(seconds) => setTimelineCursorSeconds(seconds)}
          onRemoveMarker={removeTimelineMarkerById}
          isVisualTrackLockedProp={isVisualTrackLocked}
          isAudioTrackLockedProp={isAudioTrackLocked}
          onToggleVisualTrackLock={toggleVisualTrackLock}
          onToggleAudioTrackLock={toggleAudioTrackLock}
          isVisualTrackCollapsedProp={isVisualTrackCollapsed}
          isAudioTrackCollapsedProp={isAudioTrackCollapsed}
          onToggleVisualTrackCollapse={toggleVisualTrackCollapse}
          onToggleAudioTrackCollapse={toggleAudioTrackCollapse}
          visualTrackKinds={visualTrackKinds}
          onToggleVisualTrackKind={toggleVisualTrackKind}
          snapTimelineInteractionSeconds={snapTimelineInteractionSeconds}
          timelineAudioTrackHeight={timelineAudioTrackHeight}
          timelineCursorSeconds={timelineCursorSeconds}
          timelineRulerScrollRef={timelineRulerScrollRef}
          timelineScrollRef={timelineScrollRef}
          timelineSnapPoints={timelineSnapPoints}
          timelineTool={timelineTool}
          timelineVisualTrackHeight={timelineVisualTrackHeight}
          timelineZoomPercent={timelineZoomPercent}
          timelineMaxZoomPercent={timelineMaxZoomPercent}
          updateAudioVolumeAutomationPoint={updateAudioVolumeAutomationPoint}
          updateVisualOpacityAutomationPoint={updateVisualOpacityAutomationPoint}
          visualBlocks={visualBlocks}
          visualClips={visualClips}
          visualTrackCount={visualTrackCount}
          visualGapsByTrack={visualGapsByTrack}
          moveAudioClip={moveAudioClip}
          moveVisualClip={moveVisualClip}
          splitVisualClipAtSeconds={splitVisualClipAtSeconds}
          splitAudioClipAtSeconds={splitAudioClipAtSeconds}
          slipVisualClip={slipVisualClip}
          trimAudioClipFromEdge={trimAudioClipFromEdge}
          trimVisualClipFromEdge={trimVisualClipFromEdge}
        />
      ),
    }),
    withVideoPanelDefault('inspector', {
      title: 'Inspector',
      allowedDockZones: ['right', 'left', 'center', 'overlay'],
      content: (
        <InspectorPanel
          audioClip={selectedAudioClip}
          audioClips={audioClips}
          audioTrackCount={audioTrackCount}
          audioTrackVolumes={audioTrackVolumes}
          mutedAudioTracks={mutedAudioTracks}
          soloAudioTracks={soloAudioTracks}
          audioSourceItemsByClipId={new Map(audioClips.map((clip) => [clip.id, sourceItemByNodeId.get(clip.sourceNodeId)]))}
          audioSourceItem={selectedAudioClip ? sourceItemByNodeId.get(selectedAudioClip.sourceNodeId) : undefined}
          audioSourceDurationSeconds={selectedAudioSourceDurationSeconds}
          onSplitAudioClip={() => selectedAudioClip ? splitAudioClipAtSeconds(selectedAudioClip.id, timelineCursorSeconds) : false}
          onMatchAudioSpeechLevel={() => void matchSelectedAudioSpeechLevel()}
          speechLevelMatchBusy={speechLevelMatchState.busy && speechLevelMatchState.clipId === selectedAudioClip?.id}
          speechLevelMatchMessage={speechLevelMatchState.clipId === selectedAudioClip?.id ? speechLevelMatchState.message : undefined}
          dialogueAuditionBusy={dialogueAuditionState.clipId === selectedAudioClip?.id && dialogueAuditionState.busy}
          dialogueAuditionPlaying={dialogueAuditionState.clipId === selectedAudioClip?.id && dialogueAuditionState.playing}
          dialogueAuditionSide={dialogueAuditionState.side}
          dialogueAuditionCalibrated={dialogueAuditionState.calibrateCleanWithMatch}
          dialogueAuditionSummary={dialogueAuditionState.clipId === selectedAudioClip?.id ? dialogueAuditionState.summary : undefined}
          dialogueAuditionMessage={dialogueAuditionState.clipId === selectedAudioClip?.id ? dialogueAuditionState.message : undefined}
          onDialogueAuditionSide={(side) => void auditionSelectedDialogue(side)}
          onStopDialogueAudition={() => stopDialogueAudition('Audition stopped.')}
          onSetDialogueAuditionCalibration={setDialogueAuditionCalibration}
          onMoveAudioToTrack={(trackIndex) => updateSelectedAudioClip({ trackIndex })}
          onMoveVisualToTrack={(trackIndex) => updateSelectedVisualClip({ trackIndex })}
          onEditVisualText={openTextClipEditDialog}
          onRemoveAudioClip={() => {
            if (!selectedAudioClip) return;
            commitActiveCompositionPatch(
              buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [selectedAudioClip.id]),
              'Update audio clips',
            );
            setSelectedAudioClipId(undefined);
          }}
          onRemoveStageObject={() => {
            if (selectedStageObject) removeStageObject(selectedStageObject.id);
          }}
          onRemoveVisualClip={() => {
            if (!selectedVisualClip) return;
            commitActiveCompositionPatch(
              buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [selectedVisualClip.id]),
              'Update visual clips',
            );
            setSelectedVisualClipId(undefined);
          }}
          onSelectSource={() => {
            if (selectedSourceItem) selectSourceItem(selectedSourceItem.id);
          }}
          onUpdateAudioClip={updateSelectedAudioClip}
          onAddOrUpdateKeyframe={addOrUpdateKeyframeAtPlayhead}
          onCommitVisualCropAsImageAsset={() => void commitSelectedImageCropAsAsset()}
          onGenerateNarrationFromText={() => void generateNarrationForSelectedTextClip()}
          onUpdateStageObject={(patch) => {
            if (selectedStageObject) updateStageObject(selectedStageObject.id, patch);
          }}
          onUpdateVisualClip={updateSelectedVisualClip}
          onJumpKeyframe={jumpToAdjacentSelectedKeyframe}
          onRemoveAudioKeyframe={removeSelectedAudioKeyframe}
          onRemoveVisualKeyframe={removeSelectedVisualKeyframe}
          onUpdateAudioKeyframe={updateSelectedAudioKeyframe}
          onUpdateVisualKeyframe={updateSelectedVisualKeyframe}
          selectedStageObject={selectedStageObject}
          selectedSourceItem={selectedSourceItem}
          sequenceDurationSeconds={sequenceDurationSeconds}
          timelineCursorSeconds={timelineCursorSeconds}
          visualEditorAsset={selectedVisualEditorAsset}
          visualClip={selectedVisualClip}
          visualTrackCount={visualTrackCount}
          audioDurationSeconds={selectedAudioDurationSeconds}
          visualDurationSeconds={selectedVisualDurationSeconds}
          visualBackingImageItem={selectedVisualBackingImageItem}
          visualSourceDurationSeconds={selectedVisualSourceDurationSeconds}
          visualSourceItem={selectedVisualSourceItem}
        />
      ),
    }),
    withVideoPanelDefault('premiereParity', {
      title: 'Professional Tools',
      allowedDockZones: ['left', 'right', 'bottom', 'overlay'],
      bodyClassName: 'overflow-hidden p-0',
      content: (
        <ProfessionalVideoToolsPanel
          audioClips={audioClips}
          frameRate={compositionFrameRate}
          playheadMs={Math.round(timelineCursorSeconds * 1_000)}
          onChange={(editorProfessionalState, label) => commitActiveCompositionPatch({ editorProfessionalState }, label)}
          onExportFcpXml={handleExportFcpXml}
          onImportTimelineClips={(editorVisualClips, editorAudioClips, label) => commitActiveCompositionPatch({
            editorVisualClips,
            editorAudioClips,
          }, label)}
          onCreateNestedSequence={(nestedSequence, referenceClip, label) => {
            if (!activeComposition) return;
            const currentState = activeComposition.data.editorProfessionalState ?? createDefaultEditorProfessionalVideoState();
            commitActiveCompositionPatch({
              editorProfessionalState: {
                ...currentState,
                sequences: [...currentState.sequences, nestedSequence],
              },
              editorVisualClips: visualClips.map((clip) => clip.id === referenceClip.id ? referenceClip : clip),
            }, label);
          }}
          onUpdateAudioClip={(clipId, patch, label) => updateAudioClips(
            audioClips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
            label,
          )}
          onUpdateVisualClip={(clipId, patch, label) => updateVisualClips(
            visualClips.map((clip) => clip.id === clipId ? { ...clip, ...patch } : clip),
            label,
          )}
          selectedAudioClip={selectedAudioClip}
          selectedVisualClip={selectedVisualClip}
          mixerRuntimeError={programAudioPlaybackPlan.mixerError}
          sourceItems={timelineSourceItems}
          state={activeComposition?.data.editorProfessionalState}
          visualClips={visualClips}
          workflowToolsProps={{
            state: professionalWorkflowState,
            sourceItems: timelineSourceItems,
            visualClips,
            audioClips,
            selectedClipIds: [...selectedVisualClipIds, ...selectedAudioClipIds],
            selectedSourceItemIds: selectedSourceItem ? [selectedSourceItem.id] : [],
            playheadMs: Math.round(timelineCursorSeconds * 1_000),
            compositionSignature: currentCompositionRenderCacheSignature,
            historyEntries: professionalHistoryEntries,
            canUndo: editorHistory.undoStack.length > 0,
            canRedo: editorHistory.redoStack.length > 0,
            trimSession: professionalTrimSummary,
            mediaLogging: professionalMediaLogging,
            activeSmartBinId: activeProfessionalSmartBinId,
            reviewWorkflow: professionalReviewWorkflow,
            captionDocument: professionalCaptionDocument,
            structuralQcReport: professionalStructuralQcReport,
            renderQueueRunning: runningRenderQueueCompositionId === activeComposition?.id,
            decodedSignalQcReport: professionalWorkflowState.decodedSignalQcReport,
            decodedSignalQcRunning,
            onWorkflowStateChange: handleProfessionalWorkflowStateChange,
            onHistoryCommand: handleProfessionalHistoryCommand,
            onBatchCommand: handleProfessionalBatchCommand,
            onSourceRecordCommand: handleProfessionalSourceRecordCommand,
            onTrimCommand: handleProfessionalTrimCommand,
            onMediaLoggingCommand: (command) => {
              void handleProfessionalMediaLoggingCommand(command).catch((error: unknown) => {
                void showAlertDialog({
                  title: 'Professional Media Command Failed',
                  message: error instanceof Error ? error.message : 'The media command could not be completed.',
                  tone: 'danger',
                });
              });
            },
            onReviewCommand: handleProfessionalReviewCommand,
            onCaptionCommand: (command) => {
              void handleProfessionalCaptionCommand(command).catch((error: unknown) => {
                void showAlertDialog({
                  title: 'Professional Caption Command Failed',
                  message: error instanceof Error ? error.message : 'The caption command could not be completed.',
                  tone: 'danger',
                });
              });
            },
            onQcCommand: handleProfessionalQcCommand,
            onDeliveryCommand: handleProfessionalDeliveryCommand,
          }}
          editorialTools={(
            <div className="h-full min-h-0 space-y-3 overflow-y-auto p-3">
              <section className="rounded-lg border border-cyan-300/20 bg-cyan-400/5 p-3">
                <div className="flex flex-wrap gap-1.5">
                  <button className={smallEditorButtonClassName} onClick={() => setCommandPaletteOpen(true)} type="button">Command palette</button>
                  <button className={smallEditorButtonClassName} disabled={selectedVisualClipIds.length + selectedAudioClipIds.length === 0} onClick={() => writeTimelineClipboard('copy')} type="button">Copy clips</button>
                  <button className={smallEditorButtonClassName} disabled={!timelineClipClipboard} onClick={() => pasteTimelineClipboard('overwrite')} type="button">Overwrite paste</button>
                  <button className={smallEditorButtonClassName} disabled={!timelineClipClipboard} onClick={() => pasteTimelineClipboard('insert')} type="button">Insert paste</button>
                  <button className={smallEditorButtonClassName} disabled={selectedVisualClipIds.length + selectedAudioClipIds.length < 2} onClick={() => mutateSelectedSyncState('link')} type="button">Link</button>
                  <button className={smallEditorButtonClassName} disabled={selectedVisualClipIds.length + selectedAudioClipIds.length < 2} onClick={() => mutateSelectedSyncState('group')} type="button">Sync group</button>
                  <button className={smallEditorButtonClassName} onClick={() => {
                    setVoiceoverSfxDraft((current) => ({
                      ...current,
                      voiceId: current.voiceId || useSettingsStore.getState().providerSettings.elevenlabsVoiceId || '',
                      rangeStartMs: Math.round(timelineCursorSeconds * 1_000),
                      rangeEndMs: Math.round(timelineCursorSeconds * 1_000) + 3_000,
                    }));
                    setVoiceoverSfxOpen(true);
                  }} type="button">Voiceover / SFX…</button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {(['video', 'audio'] as const).map((sourceKind) => {
                    const patch = professionalWorkflowState.editorial.sourcePatches.find((candidate) => candidate.sourceKind === sourceKind);
                    const count = sourceKind === 'video' ? visualTrackCount : audioTrackCount;
                    return (
                      <label className="rounded-md border border-gray-700/70 bg-black/20 p-2 text-[10px] text-gray-400" key={sourceKind}>
                        <span className="flex items-center justify-between gap-2">
                          {sourceKind === 'video' ? 'V source patch' : 'A source patch'}
                          <input checked={patch?.enabled !== false} onChange={(event) => updateEditorialSourcePatch(sourceKind, { enabled: event.target.checked })} type="checkbox" />
                        </span>
                        <select
                          aria-label={`${sourceKind} record target`}
                          className="mt-1 w-full rounded border border-gray-700 bg-[#090e15] px-2 py-1 text-[11px] text-gray-100"
                          onChange={(event) => updateEditorialSourcePatch(sourceKind, { targetTrackId: event.target.value })}
                          value={patch?.targetTrackId ?? `${sourceKind}:0`}
                        >
                          {Array.from({ length: count }, (_, index) => <option key={index} value={`${sourceKind}:${index}`}>{sourceKind === 'video' ? 'V' : 'A'}{index + 1}</option>)}
                        </select>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 rounded-md border border-gray-700/70 bg-black/20 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Sync-lock tracks</div>
                  <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                    {[
                      ...Array.from({ length: visualTrackCount }, (_, index) => ({ id: `video:${index}`, label: `V${index + 1}` })),
                      ...Array.from({ length: audioTrackCount }, (_, index) => ({ id: `audio:${index}`, label: `A${index + 1}` })),
                    ].map((track) => {
                      const syncLocked = professionalWorkflowState.editorial.syncLockedTrackIds.includes(track.id);
                      return (
                        <button
                          aria-pressed={syncLocked}
                          className={`${miniTrackButtonClassName} ${syncLocked ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100' : ''}`}
                          key={track.id}
                          onClick={() => handleProfessionalWorkflowStateChange({
                            ...professionalWorkflowState,
                            editorial: {
                              ...professionalWorkflowState.editorial,
                              syncLockedTrackIds: syncLocked
                                ? professionalWorkflowState.editorial.syncLockedTrackIds.filter((id) => id !== track.id)
                                : [...professionalWorkflowState.editorial.syncLockedTrackIds, track.id].slice(0, 64),
                            },
                          }, `${syncLocked ? 'Disable' : 'Enable'} ${track.label} sync lock`)}
                          type="button"
                        >{track.label}</button>
                      );
                    })}
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-gray-500">Clipboard and open tabs are session-only. Clip edits, links, sync groups, work area, parameter automation, markers, and generated-asset provenance are saved with the project and participate in undo.</p>
              </section>

              {timelineNavigationModel ? (
                <div className="space-y-1.5">
                  <TimelineMinimap
                    model={timelineNavigationModel}
                    playheadMs={timelineCursorSeconds * 1_000}
                    onNavigate={(navigation) => {
                      if (navigation.kind === 'seek') {
                        setTimelineCursorSeconds(navigation.timeMs / 1_000);
                        return;
                      }
                      if (navigation.kind === 'viewport') {
                        const element = timelineScrollRef.current;
                        if (element) element.scrollLeft = (navigation.range.startMs / timelineNavigationModel.durationMs) * element.scrollWidth;
                        updateTimelineViewportRange(element);
                        return;
                      }
                      if (!activeComposition) return;
                      const view = professionalWorkflowState.editorial.sequenceViewStates.find((candidate) => candidate.sequenceId === activeComposition.id);
                      handleProfessionalWorkflowStateChange({
                        ...professionalWorkflowState,
                        editorial: {
                          ...professionalWorkflowState.editorial,
                          sequenceViewStates: [
                            ...professionalWorkflowState.editorial.sequenceViewStates.filter((candidate) => candidate.sequenceId !== activeComposition.id),
                            {
                              sequenceId: activeComposition.id,
                              zoomPercent: timelineZoomPercent,
                              scrollLeftPx: timelineScrollRef.current?.scrollLeft ?? view?.scrollLeftPx ?? 0,
                              workArea: navigation.range ? { inMs: navigation.range.startMs, outMs: navigation.range.endMs, loopEnabled: view?.workArea?.loopEnabled ?? false } : undefined,
                            },
                          ].slice(-128),
                        },
                      }, navigation.range ? 'Set sequence work area' : 'Clear sequence work area');
                    }}
                  />
                  <button
                    className={smallEditorButtonClassName}
                    disabled={sourceMarks?.inSeconds === undefined || sourceMarks?.outSeconds === undefined || sourceMarks.outSeconds <= sourceMarks.inSeconds}
                    onClick={() => {
                      if (!activeComposition || sourceMarks?.inSeconds === undefined || sourceMarks.outSeconds === undefined) return;
                      const current = professionalWorkflowState.editorial.sequenceViewStates.find((view) => view.sequenceId === activeComposition.id);
                      handleProfessionalWorkflowStateChange({
                        ...professionalWorkflowState,
                        editorial: { ...professionalWorkflowState.editorial, sequenceViewStates: [
                          ...professionalWorkflowState.editorial.sequenceViewStates.filter((view) => view.sequenceId !== activeComposition.id),
                          { sequenceId: activeComposition.id, zoomPercent: timelineZoomPercent, scrollLeftPx: timelineScrollRef.current?.scrollLeft ?? current?.scrollLeftPx ?? 0, workArea: { inMs: sourceMarks.inSeconds * 1_000, outMs: sourceMarks.outSeconds * 1_000, loopEnabled: current?.workArea?.loopEnabled ?? false } },
                        ].slice(-128) },
                      }, 'Set work area from marked range');
                    }}
                    type="button"
                  >Set work area from source I/O</button>
                </div>
              ) : timelineNavigationUnavailableReason ? (
                <div className="rounded-md border border-amber-300/25 bg-amber-300/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100">
                  {timelineNavigationUnavailableReason}
                </div>
              ) : null}

              <ProjectNavigatorPanel model={sequenceNavigatorModel} onCommand={handleProjectNavigatorCommand} />
              {timelineSearchTruncationNotice ? (
                <div className="rounded-md border border-amber-300/25 bg-amber-300/5 px-2 py-1.5 text-[10px] leading-4 text-amber-100">
                  {timelineSearchTruncationNotice}
                </div>
              ) : null}
              <SearchMarkersPanel
                index={timelineSearchIndex}
                markers={richTimelineMarkers}
                nativeSyncWarning={markerNativeSyncReadiness?.status === 'unavailable' ? markerNativeSyncReadiness.message : undefined}
                currentTimeMs={timelineCursorSeconds * 1_000}
                activeSequenceId={activeComposition?.id}
                selectedClipId={selectedVisualClipId ?? selectedAudioClipId}
                onMarkerCommand={handleSearchMarkersCommand}
                onNavigate={(navigation) => {
                  if (navigation.kind === 'marker') {
                    setTimelineCursorSeconds(markerTimeMs(navigation.marker) / 1_000);
                    if (navigation.marker.target.kind === 'clip') {
                      const clipId = navigation.marker.target.clipId;
                      const visual = visualClips.find((clip) => clip.id === clipId);
                      const audio = audioClips.find((clip) => clip.id === clipId);
                      if (visual) selectVisualClip(visual); else if (audio) selectAudioClip(audio);
                    }
                    return;
                  }
                  const result = navigation.result.document;
                  if (result.startMs !== undefined && (result.clipId || result.sequenceId === activeComposition?.id)) {
                    setTimelineCursorSeconds(result.startMs / 1_000);
                  }
                  const visual = result.clipId ? visualClips.find((clip) => clip.id === result.clipId) : undefined;
                  const audio = result.clipId ? audioClips.find((clip) => clip.id === result.clipId) : undefined;
                  if (visual) selectVisualClip(visual); else if (audio) selectAudioClip(audio);
                  else if (result.sourceItemId) {
                    const item = timelineSourceItems.find((candidate) => candidate.id === result.sourceItemId || candidate.nodeId === result.sourceItemId);
                    if (item) selectSourceItem(item.id);
                  }
                }}
              />
              <input
                accept={markerImportFormat === 'json' ? '.json,application/json' : '.csv,text/csv'}
                className="hidden"
                ref={markerImportRef}
                type="file"
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRichTimelineMarkers(file); event.currentTarget.value = ''; }}
              />

              <ParameterKeyframeEditor
                tracks={parameterKeyframeTracks}
                selectedTrackId={selectedParameterTrackId}
                currentTimeMs={Math.max(0, Math.round(timelineCursorSeconds * 1_000 - (selectedVisualClip?.startMs ?? selectedAudioClip?.offsetMs ?? 0)))}
                durationMs={Math.max(1, Math.round((selectedVisualDurationSeconds ?? selectedAudioDurationSeconds ?? 0) * 1_000))}
                disabledReason={!selectedVisualClip && !selectedAudioClip ? 'Select a visual or audio clip to automate a numeric parameter.' : undefined}
                onSelectTrack={setSelectedParameterTrackId}
                onAddKeyframe={addParameterKeyframe}
                onChangeKeyframe={changeParameterKeyframe}
                onRemoveKeyframe={removeParameterKeyframe}
              />

              <TranscriptEditingPanel
                wordCount={editableTranscriptWords.length}
                query={transcriptQuery}
                matches={transcriptMatches}
                selectedRangeLabel={selectedTranscriptMatch ? `${selectedTranscriptMatch.text} · ${(selectedTranscriptMatch.startMs / 1_000).toFixed(2)}–${(selectedTranscriptMatch.endMs / 1_000).toFixed(2)}s` : undefined}
                pendingProposal={pendingTranscriptProposal}
                disabledReason={editableTranscriptWords.length === 0 ? 'Select transcribed media, or add a transcript in Text & I/O first.' : undefined}
                searchError={transcriptSearchError}
                previewSummary={transcriptPreviewSummary}
                onQueryChange={(query) => { setTranscriptQuery(query); if (transcriptSearchError) setTranscriptSearchError(undefined); }}
                onSearch={(query) => {
                  const result = searchEditableTranscriptSafely(editableTranscriptWords, query);
                  if (!result.ok) {
                    setTranscriptMatches([]);
                    setTranscriptSearchError(result.message);
                    return;
                  }
                  setTranscriptMatches(result.matches);
                  setTranscriptSearchError(undefined);
                }}
                onSelectMatch={(match) => {
                  setSelectedTranscriptMatch(match);
                  if (sourceMonitorVideoRef.current) sourceMonitorVideoRef.current.currentTime = match.startMs / 1_000;
                  setPendingTranscriptProposal(undefined);
                  setTranscriptPreviewSummary(undefined);
                  setTranscriptSearchError(undefined);
                }}
                onPreviewProposal={previewTranscriptSelection}
                onApplyProposal={applyPendingTranscriptEdit}
                onClearSelection={() => { setSelectedTranscriptMatch(undefined); setPendingTranscriptProposal(undefined); setTranscriptPreviewSummary(undefined); }}
              />

              <CommandPaletteDialog
                open={commandPaletteOpen}
                context="timeline"
                query={commandPaletteQuery}
                onQueryChange={setCommandPaletteQuery}
                onInvoke={(commandId) => {
                  const nativeCommand = VIDEO_COMMAND_NATIVE_ROUTES[commandId];
                  if (nativeCommand) handleNativeMenuCommand(nativeCommand);
                  setCommandPaletteOpen(false);
                }}
                onClose={() => setCommandPaletteOpen(false)}
              />
              <VoiceoverSfxDialog
                open={voiceoverSfxOpen}
                mode={voiceoverSfxMode}
                providers={[{ providerId: 'elevenlabs', modelId: useSettingsStore.getState().defaultModels.audio.elevenlabs, label: 'ElevenLabs' }]}
                selectedProviderId="elevenlabs"
                draft={voiceoverSfxDraft}
                paragraphs={voiceoverParagraphs}
                rightsConfirmed={voiceoverRightsConfirmed}
                billingConfirmed={voiceoverBillingConfirmed}
                busy={voiceoverBusy}
                statusMessage={voiceoverStatus}
                onClose={() => setVoiceoverSfxOpen(false)}
                onModeChange={setVoiceoverSfxMode}
                onProviderChange={() => undefined}
                onDraftChange={(patch) => setVoiceoverSfxDraft((current) => ({ ...current, ...patch }))}
                onRightsConfirmedChange={setVoiceoverRightsConfirmed}
                onBillingConfirmedChange={setVoiceoverBillingConfirmed}
                onGenerateVoiceover={(request) => void generateProfessionalAuthoredAudio({ kind: 'voiceover', text: request.paragraphText, voiceId: request.voiceId, languageCode: request.languageCode, startMs: Math.round(timelineCursorSeconds * 1_000) })}
                onGenerateRangeSfx={(request) => void generateProfessionalAuthoredAudio({ kind: 'range-sfx', text: request.sfxPrompt, startMs: request.rangeStartMs, endMs: request.rangeEndMs })}
                onRegenerateParagraph={(paragraphId) => {
                  const paragraph = voiceoverParagraphs.find((candidate) => candidate.id === paragraphId);
                  if (paragraph) void generateProfessionalAuthoredAudio({ kind: 'voiceover', text: paragraph.text, voiceId: paragraph.voiceId, languageCode: paragraph.languageCode, startMs: Math.round(timelineCursorSeconds * 1_000) });
                }}
              />
            </div>
          )}
        />
      ),
    }),
    withVideoPanelDefault('sequenceSettings', {
      title: 'Sequence',
      allowedDockZones: ['right', 'left', 'top', 'overlay'],
      content: (
        <SequenceSettingsPanel
          aspectRatio={compositionAspectRatio}
          frameRate={compositionFrameRate}
          onAspectRatioChange={(aspectRatio) => updateActiveCompositionSettings({ aspectRatio })}
          onFrameRateChange={(videoFrameRate) => updateActiveCompositionSettings({ videoFrameRate })}
          onResolutionChange={(videoResolution) => updateActiveCompositionSettings({ videoResolution })}
          sequenceSummary={sequenceSummary}
          videoResolution={compositionResolution}
        />
      ),
    }),
    withVideoPanelDefault('exportPreset', {
      title: 'Export',
      allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
      content: (
        <ExportPresetPanel
          exportPresetPlan={exportPresetPlan}
          onRenderBackendPreferenceChange={(preference) => setProviderSetting('renderBackendPreference', preference)}
          renderBackendPreference={renderBackendPreference}
          hasCaptionCues={textClipsToCaptionCues(visualClips).length > 0}
          onExportCaptions={exportTimelineCaptions}
          onExportPresetPlanChange={(presetId) => updateActiveCompositionSettings({ editorExportPresetPlan: { ...exportPresetPlan, presetId } })}
        />
      ),
    }),
    withVideoPanelDefault('diagnostics', {
      title: 'Diagnostics',
      allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
      content: <ParityDiagnosticsPanel diagnostics={parityDiagnostics} />,
    }),
  ];
  const renderLegacyVideoFallback = false;
  const mobilePhoneInterface = useMobilePhoneInterfaceDescriptor();
  const mobileChromeMode = useMobileInterfaceStore((state) => state.chromeMode);
  const workspaceChromePaddingClassName = mobilePhoneInterface.enabled
    ? mobileChromeMode === 'hidden'
      ? mobilePhoneInterface.hiddenTopPaddingClassName
      : mobilePhoneInterface.collapsedTopPaddingClassName
    // Desktop: the shared top bar is in-flow (the workspace mounts below it), so pt-16 here was a
    // 64px dead band trapped under the menu bar — the same dead padding already removed from the
    // Image and Paper workspaces. pt-3 keeps the gutter symmetric with px-3/pb-3.
    : 'pt-3';

  if (managedFontGate.status !== 'ready') {
    return (
      <div
        className={`absolute inset-0 z-30 flex items-center justify-center bg-[#080b12] p-6 ${workspaceChromePaddingClassName}`}
        data-video-managed-font-workspace-gate={managedFontGate.status}
      >
        <div className="max-w-lg rounded-2xl border border-cyan-300/20 bg-[#0f1724] p-6 text-center shadow-2xl">
          <div className="text-base font-semibold text-white">
            {managedFontGate.status === 'loading' ? 'Verifying managed fonts…' : 'Managed font unavailable'}
          </div>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            {managedFontGate.status === 'loading'
              ? 'Video preview, measurement, and export remain gated until every referenced face is registered from verified bytes.'
              : managedFontGate.error}
          </p>
          {managedFontGate.status === 'error' ? (
            <button
              className="mt-4 rounded-lg border border-red-300/30 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-100 hover:bg-red-500/20"
              onClick={managedFontGate.retry}
              type="button"
            >
              Retry managed font registration
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (mobilePhoneInterface.enabled) {
    // Phone: a multi-pane desktop NLE cannot fit. The mobile shell keeps the same live panel
    // contents but makes the focused timeline route immediately available instead of requiring
    // users to dismiss an advisory before they can inspect or edit their project.
    return (
      <>
        <ProgramAudioTransport
          items={programAudioPlaybackItems}
          playing={shuttleRate === 1 && programMonitorMode === 'stage'}
        />
        <div
          className={`absolute inset-0 z-30 bg-[radial-gradient(circle_at_top,#182236_0%,#0b0e14_45%,#06080d_100%)] px-2 pb-2 ${workspaceChromePaddingClassName}`}
        >
          <VideoWorkspaceMobileShell panels={videoPanels} previewPanelId={VIDEO_PANEL_IDS.programMonitor} />
        </div>
      </>
    );
  }

  return (
    <div className={`absolute inset-0 z-30 bg-[radial-gradient(circle_at_top,#182236_0%,#0b0e14_45%,#06080d_100%)] px-3 pb-3 ${workspaceChromePaddingClassName}`}>
      <ProgramAudioTransport
        items={programAudioPlaybackItems}
        playing={shuttleRate === 1 && programMonitorMode === 'stage'}
      />
      {professionalTrimPreview ? (
        <TrimSessionOverlay
          session={professionalTrimPreview.session}
          onUpdate={({ deltaMs }) => {
            const updated = updateVideoTrimToolSession(professionalTrimPreview.session, deltaMs);
            if (updated.ok) setProfessionalTrimPreview({ ...professionalTrimPreview, session: updated.session });
          }}
          onCommit={() => handleProfessionalTrimCommand({ kind: 'commit' })}
          onCancel={() => handleProfessionalTrimCommand({ kind: 'cancel' })}
        />
      ) : null}
      {/* The old floating "Reset Video Panels" pill lived in the (now removed) dead band and would
          cover the Inspector's header; the action lives in Window > Panels > Reset Video Panels. */}
      <DockablePanelHost className="h-full" panels={videoPanels} workspaceId={VIDEO_WORKSPACE_ID}>
        {renderLegacyVideoFallback ? (
        <section className="flex h-full min-h-0 gap-3">
          {sourceBinVisible ? (
            <>
              <aside className={`${panelClassName} flex min-h-0 shrink-0 flex-col overflow-hidden`} style={{ width: sourceBinWidth }}>
                <div className="border-b border-gray-700/60 px-2 py-2">
                  <div className="flex h-7 min-w-0 items-center gap-1" data-video-source-bin-compact-header="legacy">
                  <div className="grid min-w-0 flex-1 grid-cols-2 rounded-md border border-gray-700/60 bg-[#0f131b] p-0.5" role="tablist">
                    <button
                      className={sourceBinTab === 'media' ? activeTabClassName : inactiveTabClassName}
                      onClick={() => setSourceBinTab('media')}
                      role="tab"
                      type="button"
                    >
                      Media
                    </button>
                    <button
                      className={sourceBinTab === 'editorAssets' ? activeTabClassName : inactiveTabClassName}
                      onClick={() => setSourceBinTab('editorAssets')}
                      role="tab"
                      type="button"
                    >
                      Video Assets
                    </button>
                  </div>
                  <div className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded border border-gray-700/60 bg-[#111217]/60 px-1.5 text-[10px] font-semibold tabular-nums text-gray-300">
                    {sourceBinTab === 'media' ? mediaSourceItems.length : editorAssets.length}
                  </div>
                  {sourceBinTab === 'media' && linkedMediaItemCount > 0 ? (
                    <div className="hidden h-6 shrink-0 items-center rounded border border-emerald-300/25 bg-emerald-400/10 px-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-100 2xl:flex" title="Video and audio linked directly from disk; source files are not duplicated into browser memory.">
                      {linkedMediaItemCount} linked
                    </div>
                  ) : null}
                  {sourceBinTab === 'media' && mediaSourceItems.length > 0 ? (
                    <>
                      <button aria-label="Collapse all source items" className={miniTrackButtonClassName} onClick={() => setAllSourceBinItemsCollapsed(true)} title="Collapse all source items" type="button"><ChevronRight size={12} /></button>
                      <button aria-label="Expand all source items" className={miniTrackButtonClassName} onClick={() => setAllSourceBinItemsCollapsed(false)} title="Expand all source items" type="button"><ChevronDown size={12} /></button>
                    </>
                  ) : null}
                  </div>
                  {sourceBinTab === 'media' ? (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700/60 bg-[#090d13] px-2 py-1.5 text-gray-300">
                      <Search className="shrink-0 text-gray-500" size={13} />
                      <input
                        className="min-w-0 flex-1 bg-transparent text-xs text-gray-100 outline-none placeholder:text-gray-600"
                        onChange={(event) => setSourceBinSearchQuery(event.target.value)}
                        placeholder="Search clips, types, or origin"
                        type="search"
                        value={sourceBinSearchQuery}
                      />
                      {activeProfessionalSmartBin ? (
                        <button aria-label={`Clear smart bin ${activeProfessionalSmartBin.name}`} className="max-w-28 truncate rounded border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100" onClick={() => setActiveProfessionalSmartBinId(undefined)} title={`Smart bin: ${activeProfessionalSmartBin.name}`} type="button">{activeProfessionalSmartBin.name} ×</button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sourceBinTab === 'media' ? (
                      <>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => void openSourceBinImportPicker(EDITOR_MEDIA_IMPORT_ACCEPT, ['video', 'audio'])}
                          type="button"
                        >
                          <Archive size={12} />
                          Import Media
                        </button>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => void openSourceBinImportPicker(EDITOR_VIDEO_IMPORT_ACCEPT, ['video'])}
                          type="button"
                        >
                          <Film size={12} />
                          Video
                        </button>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => void openSourceBinImportPicker(EDITOR_AUDIO_IMPORT_ACCEPT, ['audio'])}
                          type="button"
                        >
                          <Music2 size={12} />
                          Audio
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => void openSourceBinImportPicker(EDITOR_IMAGE_IMPORT_ACCEPT)}
                          type="button"
                        >
                          <ImageIcon size={12} />
                          Image
                        </button>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => addEditorAsset('text')}
                          type="button"
                        >
                          <Type size={12} />
                          Text
                        </button>
                        <button
                          className={smallEditorButtonClassName}
                          onClick={() => addEditorAsset('shape')}
                          type="button"
                        >
                          <Square size={12} />
                          Shape
                        </button>
                        <button
                          className={`${smallEditorButtonClassName} disabled:cursor-wait disabled:opacity-50`}
                          disabled={isImportingPaperStoryboardPages || paperStoryboardPageDescriptors.length === 0}
                          onClick={() => void importPaperStoryboardPages()}
                          type="button"
                        >
                          <BookOpen size={12} />
                          {isImportingPaperStoryboardPages ? 'Preparing' : 'Paper Pages'}
                        </button>
                      </>
                    )}
                    <input
                      className="hidden"
                      multiple
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void importFilesForActiveBin(event.target.files);
                        }
                      }}
                      ref={importAcceptRef}
                      type="file"
                    />
                  </div>
                  {sourceBinTab === 'editorAssets' && (paperStoryboardPageDescriptors.length > 0 || paperStoryboardImportStatus) ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-indigo-300/15 bg-indigo-400/10 px-2 py-1.5 text-[11px] text-indigo-100">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <BookOpen className="shrink-0" size={12} />
                        <span className="truncate">
                          {paperStoryboardExistingItemIds.size} of {paperStoryboardPageDescriptors.length} Paper page{paperStoryboardPageDescriptors.length === 1 ? '' : 's'} available
                        </span>
                      </span>
                      {paperStoryboardImportStatus ? (
                        <span className="min-w-0 truncate text-indigo-100/75">{paperStoryboardImportStatus}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {sourceBinTab === 'media' ? renderSourceBinFilterControls() : null}
                </div>
                <VideoPremiereParityPanel />
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {sourceBinTab === 'media' ? (
                    mediaSourceItems.length > 0 ? (
                      renderMediaSourcePools()
                    ) : (
                      <EmptyState
                        title="No saved project assets"
                      />
                    )
                  ) : editorAssets.length > 0 ? (
                    editorAssets.map((asset) => (
                      <EditorAssetCard
                        asset={asset}
                        key={asset.id}
                        onOpenContextMenu={(event) => openEditorAssetContextMenu(asset, event)}
                        onPlace={(trackIndex) => placeEditorAssetOnTrack(asset, trackIndex)}
                        previewSourceItem={
                          asset.kind === 'image' && asset.imageSourceId
                            ? sourceItemByNodeId.get(asset.imageSourceId)
                            : undefined
                        }
                      />
                    ))
                  ) : (
                    <EmptyState
                      body="Create text and shape assets or import image assets here, then place them on visual tracks like normal clips."
                      title="No editor assets"
                    />
                  )}
                </div>
              </aside>
              <ResizeHandle onPointerDown={(event) => startPanelResize(event, 'sourceBinWidth')} />
            </>
          ) : null}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {hasVisibleMonitors ? (
              <div className="min-h-0 shrink-0" style={{ height: monitorSectionHeight }}>
                <div className="flex h-full min-h-0 gap-2">
                  {sourceMonitorVisible ? (
                    <div
                      className={programMonitorVisible ? 'h-full min-w-0 shrink-0' : 'h-full min-w-0 flex-1'}
                      style={programMonitorVisible ? { width: `${monitorSplitPercent}%` } : undefined}
                    >
                      <SourceMonitorPanel
                        item={selectedSourceItem}
                        marks={selectedSourceItem && sourceMarks?.itemId === selectedSourceItem.id ? sourceMarks : undefined}
                        mediaInfo={selectedSourceItem ? mediaInfoMap[selectedSourceItem.id] : undefined}
                        onAddAudio={addAudioClip}
                        onAddVisual={addVisualClip}
                        onMarkIn={() => markSourcePoint('in')}
                        onMarkOut={() => markSourcePoint('out')}
                        onInsertEdit={() => performThreePointEdit('insert')}
                        onOverwriteEdit={() => performThreePointEdit('overwrite')}
                        onOpenContextMenu={(event) => {
                          event.preventDefault();

                          const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

                          if (selectedSourceItem) {
                            menuItems.push({
                              label: 'Send Source To Flow Workspace',
                              action: () => sendSourceItemToFlow(selectedSourceItem),
                            });
                          }

                          if (selectedSourceItem && (selectedSourceItem.kind === 'video' || selectedSourceItem.kind === 'composition')) {
                            menuItems.push({
                              label: 'Capture Current Frame To Flow',
                              action: () => void captureVideoFrameToFlow(sourceMonitorVideoRef.current, `${selectedSourceItem.label}-frame`),
                            });
                          }

                          if (menuItems.length > 0) {
                            setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
                          }
                        }}
                        sourceDurationSeconds={getSourceItemDurationSeconds(selectedSourceItem, durationMap)}
                        videoRef={sourceMonitorVideoRef}
                      />
                    </div>
                  ) : null}

                  {sourceMonitorVisible && programMonitorVisible ? (
                    <ResizeHandle onPointerDown={startMonitorSplitResize} />
                  ) : null}

                  {programMonitorVisible ? (
                    <div className="h-full min-w-0 flex-1">
                      <ProgramMonitorPanel
                        activeTool={timelineTool}
                        aspectRatio={compositionAspectRatio}
                        audioClipCount={audioClips.length}
                        canvas={programCanvas}
                        errorMessage={compositionRenderError ?? (!videoRuntime.ok
                          ? videoRuntime.errors.join(' ')
                          : multicamProjection.ok ? undefined : multicamProjection.message)}
                        exportReadiness={exportReadiness}
                        managedFontGate={managedFontGate}
                        incrementalRenderSummary={incrementalRenderSummary}
                        isRunning={isCompositionRendering}
                        onAddEditorAsset={addEditorAsset}
                        onAddComicStageObject={addComicStageObject}
                        renderStatusMessage={compositionRenderStatus ?? incrementalRenderSummary}
                        renderBackendStatus={renderBackendStatus}
                        renderCacheDetailLines={renderCacheDetailLines}
                        hasActiveComposition={Boolean(activeComposition)}
                        onCreateComposition={handleCreateComposition}
                        onCreateStarterSequence={handleCreateStarterSequence}
                        onRevealSourceBin={handleRevealSourceBin}
                        onExportFcpXml={handleExportFcpXml}
                        onAspectRatioChange={(aspectRatio) =>
                          updateActiveCompositionSettings({ aspectRatio })
                        }
                        onOpenClipContextMenu={openVisualClipContextMenu}
                        onOpenContextMenu={(event) => {
                          event.preventDefault();

                          const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

                          if (previewUrl && !isProgramImageSequenceOutput) {
                            const exportPreset = getVideoExportPresetOption(exportPresetPlan.presetId);
                            menuItems.push({
                              label: 'Send Program Video To Flow Workspace',
                              action: () =>
                                sendSourceItemToFlow({
                                  id: `program-${activeComposition?.id ?? 'preview'}`,
                                  nodeId: activeComposition?.id ?? `program-${Date.now()}`,
                                   kind: 'video',
                                   label: activeComposition?.data.modelId ?? 'Program render',
                                   assetUrl: previewUrl,
                                   mimeType: exportPreset.mimeType,
                                 }),
                            });
                            menuItems.push({
                              label: 'Capture Current Frame To Flow',
                              action: () => void captureVideoFrameToFlow(programMonitorVideoRef.current, 'program-frame'),
                            });
                          }

                          if (menuItems.length > 0) {
                            setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
                          }
                        }}
                        onResolutionChange={(videoResolution) =>
                          updateActiveCompositionSettings({ videoResolution })
                        }
                        onFrameRateChange={(videoFrameRate) =>
                          updateActiveCompositionSettings({ videoFrameRate })
                        }
                        onExportPresetPlanChange={(presetId) =>
                          updateActiveCompositionSettings({
                            editorExportPresetPlan: {
                              ...exportPresetPlan,
                              presetId,
                            },
                          })
                        }
                        hasCaptionCues={textClipsToCaptionCues(visualClips).length > 0}
                        onExportCaptions={exportTimelineCaptions}
                        onRun={renderActiveComposition}
                        onSelectClip={(clipId) => {
                          const clip = visualClips.find((candidate) => candidate.id === clipId)
                            ?? visualClips.find((candidate) => clipId.startsWith(`${candidate.id}:multicam:`));
                          if (clip) {
                            selectVisualClip(clip);
                          }
                        }}
                        onSelectStageObject={selectStageObject}
                        onSetMonitorMode={setProgramMonitorMode}
                        onUpdateClip={updateVisualClipById}
                        onUpdateStageObject={updateStageObject}
                        previewUrl={previewUrl}
                        previewOutputMetadata={previewOutputMetadata}
                        playheadSeconds={timelineCursorSeconds}
                        selectedClip={selectedVisualClip}
                        selectedStageObject={selectedStageObject}
                        exportPresetPlan={exportPresetPlan}
                        monitorParityNotices={monitorParityNotices}
                        parityDiagnostics={parityDiagnostics}
                        sequenceSummary={sequenceSummary}
                        stageClips={programStageClips}
                        stageObjects={stageObjects}
                        stageMode={programMonitorMode}
                        transportRate={shuttleRate}
                        videoRef={programMonitorVideoRef}
                        videoResolution={compositionResolution}
                        frameRate={compositionFrameRate}
                        visualClipCount={visualClips.length}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {hasVisibleMonitors ? (
              <ResizeHandle onPointerDown={startMonitorHeightResize} orientation="horizontal" />
            ) : null}

            <section className={`${panelClassName} min-h-0 min-w-0 flex-1 overflow-hidden`}>
              <div className="border-b border-gray-700/60 px-3 py-2">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-gray-100">
                  <Film size={14} />
                  Sequencer Timeline
                </div>
              </div>
              <div className="border-b border-gray-700/60 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-semibold text-gray-100">Timeline</div>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      Visual clips and audio clips live on independent timed lanes. Use the tool strip for select vs cut, drag clips for rough placement, then use the inspector and program stage for precise timing and framing.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <ToolToggleButton
                      active={timelineTool === 'select'}
                      icon={<MousePointer2 size={12} />}
                      label="Select"
                      onClick={() => setTimelineToolWithActivity('select', 'toolbar')}
                    />
                    <ToolToggleButton
                      active={timelineTool === 'cut'}
                      icon={<Scissors size={12} />}
                      label="Cut"
                      onClick={() => {
                        if (!cutSelectedVisualClipAtPlayhead()) {
                          setTimelineToolWithActivity('cut', 'toolbar');
                        }
                      }}
                    />
                    <ToolToggleButton
                      active={timelineTool === 'slip'}
                      icon={<Film size={12} />}
                      label="Slip"
                      onClick={() => setTimelineToolWithActivity('slip', 'toolbar')}
                    />
                    <ToolToggleButton
                      active={timelineTool === 'hand'}
                      icon={<Archive size={12} />}
                      label="Hand"
                      onClick={() => setTimelineToolWithActivity('hand', 'toolbar')}
                    />
                    <ToolToggleButton
                      active={timelineTool === 'snap'}
                      icon={<Plus size={12} />}
                      label="Snap"
                      onClick={() => setTimelineToolWithActivity('snap', 'toolbar')}
                    />
                    <button
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-700/60 bg-[#111217]/70 px-3 py-1 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!canKeyframeSelectedClip}
                      onClick={() => jumpToAdjacentSelectedKeyframe('previous')}
                      title="Jump to previous keyframe ([)"
                      type="button"
                    >
                      <ChevronLeft size={12} />
                      Key
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!canKeyframeSelectedClip}
                      onClick={addOrUpdateKeyframeAtPlayhead}
                      title="Add or update a keyframe at the playhead (Shift+K)"
                      type="button"
                    >
                      <Diamond size={12} />
                      Add Key
                    </button>
                    <button
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-700/60 bg-[#111217]/70 px-3 py-1 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!canKeyframeSelectedClip}
                      onClick={() => jumpToAdjacentSelectedKeyframe('next')}
                      title="Jump to next keyframe (])"
                      type="button"
                    >
                      Key
                      <ChevronRight size={12} />
                    </button>
                    {timelineSnapPoints.length > 0 ? (
                      <button
                        className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white"
                        onClick={clearTimelineSnapPoints}
                        type="button"
                      >
                        Clear {timelineSnapPoints.length} snap{timelineSnapPoints.length === 1 ? '' : 's'}
                      </button>
                    ) : null}
                    <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
                      <span>Zoom</span>
                      <input
                        className="w-28"
                        max={timelineMaxZoomPercent}
                        min={100}
                        onChange={(event) => setTimelineZoomPercent(Number(event.target.value))}
                        step={50}
                        type="range"
                        value={timelineZoomPercent}
                      />
                      <span>{timelineZoomPercent}%</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
                      <span>V H</span>
                      <input
                        className="w-20"
                        max={180}
                        min={60}
                        onChange={(event) => setTimelineTrackHeight('visual', Number(event.target.value))}
                        step={4}
                        type="range"
                        value={timelineVisualTrackHeight}
                      />
                      <span>{timelineVisualTrackHeight}</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
                      <span>A H</span>
                      <input
                        className="w-20"
                        max={180}
                        min={44}
                        onChange={(event) => setTimelineTrackHeight('audio', Number(event.target.value))}
                        step={4}
                        type="range"
                        value={timelineAudioTrackHeight}
                      />
                      <span>{timelineAudioTrackHeight}</span>
                    </label>
                    <button
                      className="rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                      onClick={() => {
                        setTimelineZoomPercent(100);
                        setTimelineTrackHeight('visual', 84);
                        setTimelineTrackHeight('audio', 64);
                        timelineScrollRef.current?.scrollTo({ left: 0 });
                      }}
                      type="button"
                    >
                      Zoom To Fit
                    </button>
                    <div className="rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
                      {sequenceDurationSeconds > 0 ? formatEditorTimecode(sequenceDurationSeconds, compositionFrameRate) : 'No clips yet'}
                    </div>
                    <div className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1 font-mono text-xs font-semibold tabular-nums text-cyan-100">
                      {formatEditorTimecode(timelineCursorSeconds, compositionFrameRate)}
                    </div>
                    {longFormSequence ? (
                      <div className="rounded-full border border-emerald-300/35 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                        Long-form
                      </div>
                    ) : null}
                    <div
                      className={`rounded-full border px-3 py-1 font-mono text-xs ${shuttleRate === 0 ? 'border-gray-700/60 bg-[#111217]/45 text-gray-500' : 'border-emerald-300/45 bg-emerald-400/10 text-emerald-200'}`}
                      data-video-transport-rate={shuttleRate}
                      title="J/K/L shuttle · Space play/pause · Home/End to sequence bounds"
                    >
                      {shuttleRate === 0 ? '⏸ JKL' : shuttleRate > 0 ? `▶ ${shuttleRate}×` : `◀ ${Math.abs(shuttleRate)}×`}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
                <div className="border-b border-gray-700/60 px-2.5 py-2">
                  <div
                    className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    onScroll={(event) => {
                      if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                      updateTimelineViewportRange(timelineScrollRef.current);
                    }}
                    ref={timelineRulerScrollRef}
                  >
                    <div className="grid min-w-full grid-cols-[96px_minmax(0,1fr)] gap-2" style={{ width: `${timelineContentWidthPercent}%` }}>
                      <div />
                      <div className="relative h-8 overflow-hidden rounded-md border border-gray-700/60 bg-[#203847]">
                        <button
                          className="absolute inset-0 z-10 h-full w-full cursor-pointer bg-transparent"
                          onClick={(event) => {
                            if (timelineTool === 'hand') {
                              return;
                            }
                            const bounds = event.currentTarget.getBoundingClientRect();
                            const ratio = (event.clientX - bounds.left) / bounds.width;
                            const timelineSeconds = Math.max(0, Math.min(displayTimelineSeconds, ratio * displayTimelineSeconds));

                            if (timelineTool === 'snap') {
                              addTimelineSnapAtSeconds(timelineSeconds, event.shiftKey);
                              return;
                            }

                            setTimelineCursorSeconds(snapTimelineInteractionSeconds(timelineSeconds, event.shiftKey));
                          }}
                          onPointerDown={(event) => {
                            if (timelineTool === 'hand') {
                              startTimelineHandPan(event);
                            }
                          }}
                          type="button"
                        />
                        {timelineRulerTicks.map((second) => (
                          <div
                            key={second}
                            className="absolute bottom-0 top-0 border-l border-gray-700/50"
                            style={{ left: `${(second / displayTimelineSeconds) * 100}%` }}
                          >
                            <span className="absolute left-1 top-0.5 font-mono text-[9px] tabular-nums text-gray-400">{formatTimelineRulerLabel(second, displayTimelineSeconds)}</span>
                          </div>
                        ))}
                        {timelineSnapPoints.map((snapSecond) => (
                          <div
                            key={`snap-${snapSecond}`}
                            className="pointer-events-none absolute bottom-0 top-0 z-20 border-l-2 border-cyan-200/80"
                            style={{ left: `${(snapSecond / displayTimelineSeconds) * 100}%` }}
                          >
                            <span className="absolute left-1 top-4 rounded bg-cyan-950/80 px-1 text-[9px] font-semibold text-cyan-100">
                              {snapSecond.toFixed(snapSecond % 1 === 0 ? 0 : 1)}s
                            </span>
                          </div>
                        ))}
                        {timelineMarkers.map((marker) => (
                          <TimelineMarkerFlag
                            displayTimelineSeconds={displayTimelineSeconds}
                            key={marker.id}
                            marker={marker}
                            onJump={setTimelineCursorSeconds}
                            onRemove={removeTimelineMarkerById}
                          />
                        ))}
                        <div
                          className="absolute bottom-0 top-0 z-20 w-px bg-red-400/90"
                          style={{ left: `${(timelineCursorSeconds / displayTimelineSeconds) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="min-h-0 overflow-auto px-2.5 py-2"
                  onScroll={(event) => {
                    if (timelineRulerScrollRef.current) timelineRulerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                    updateTimelineViewportRange(event.currentTarget);
                  }}
                  ref={timelineScrollRef}
                >
                  {activeComposition ? (
                    <div className="min-w-full space-y-1.5" data-timeline-lanes-root="true" style={{ width: `${timelineContentWidthPercent}%` }}>
                      {Array.from({ length: visualTrackCount }, (_, trackIndex) => (
                        <TimelineLane
                          key={`visual-${trackIndex}`}
                          blocks={visualBlocksByTrack[trackIndex]
                            .map((block) => ({
                              id: block.clip.id,
                              label: visualBlockLabel(block.clip, block.item?.label),
                              secondaryLabel: `${block.startSeconds.toFixed(1)}s -> ${block.endSeconds.toFixed(1)}s`,
                              startSeconds: block.startSeconds,
                              durationSeconds: block.durationSeconds,
                              kind: block.item?.kind ?? block.clip.sourceKind,
                              trimClip: block.clip,
                              selected: selectedVisualClipIdSet.has(block.clip.id),
                              opacityPercent: block.clip.opacityPercent,
                              opacityAutomationPoints: block.clip.keyframes?.length
                                ? visualKeyframesToOpacityAutomation(block.clip)
                                : normalizeAutomationPoints(
                                    block.clip.opacityAutomationPoints,
                                    block.clip.opacityPercent,
                                  ),
                              keyframePercents: getVisualKeyframePercents(block.clip),
                            }))}
                          emptyMessage="Add image, video, composition, or text items from the source bin into this video lane."
                          automationLabel="Opacity"
                          gaps={visualGapsByTrack[trackIndex] ?? []}
                          selectedGapId={selectedTimelineGap?.id}
                          onOpenGapContextMenu={openTimelineGapContextMenu}
                          onSelectGap={(gap) => {
                            setSelectedTimelineGap(gap);
                            clearTimelineSelection();
                            setSelectedSourceItemId(undefined);
                            setSelectedStageObjectId(undefined);
                          }}
                          onAddAutomationPoint={addVisualOpacityAutomationPoint}
                          onCutBlock={splitVisualClipAtSeconds}
                          onSlipBlock={slipVisualClip}
                          onTrimBlockEdge={trimVisualClipFromEdge}
                          onOpenContextMenu={openVisualClipContextMenu}
                          onMoveBlock={moveVisualClip}
                          onDropSourceItem={(event) => handleTimelineSourceDrop(event, 'visual', trackIndex)}
                          onRemoveAutomationPoint={removeVisualOpacityAutomationPoint}
                          onResizeLane={(event) => startTimelineTrackResize(event, 'visual')}
                          onStartHandPan={startTimelineHandPan}
                          onSetPlayhead={setTimelineCursorSeconds}
                          playheadSeconds={timelineCursorSeconds}
                          snapPoints={timelineSnapPoints}
                          laneHeight={timelineVisualTrackHeight}
                          toolMode={timelineTool}
                          onUpdateAutomationPoint={updateVisualOpacityAutomationPoint}
                          previewById={clipEdgePreviewMap}
                          onSelect={(id, modifiers) => {
                            const clip = visualClips.find((candidate) => candidate.id === id);
                            if (clip) {
                              selectVisualClip(clip, modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
                            }
                          }}
                          timelineSeconds={displayTimelineSeconds}
                          visibleRange={timelineViewportRange}
                          locked={isVisualTrackLocked(trackIndex)}
                          onToggleLock={() => toggleVisualTrackLock(trackIndex)}
                          collapsed={isVisualTrackCollapsed(trackIndex)}
                          onToggleCollapse={() => toggleVisualTrackCollapse(trackIndex)}
                          trackLabel={`V${trackIndex + 1}`}
                        />
                      ))}

                      {Array.from({ length: audioTrackCount }, (_, trackIndex) => (
                        <TimelineLane
                          key={trackIndex}
                          blocks={audioBlocksByTrack[trackIndex]
                            .map((block) => ({
                              id: block.clip.id,
                              label: block.item?.label ?? block.clip.sourceNodeId,
                              secondaryLabel: `${block.startSeconds.toFixed(1)}s -> ${block.endSeconds.toFixed(1)}s`,
                              startSeconds: block.startSeconds,
                              durationSeconds: block.durationSeconds,
                              kind: block.item?.kind ?? ('audio' as const),
                              trimAudioClip: block.clip,
                              selected: selectedAudioClipIdSet.has(block.clip.id),
                              muted: !block.clip.enabled,
                              opacityAutomationPoints: block.clip.volumeKeyframes?.length
                                ? audioKeyframesToVolumeAutomation(block.clip)
                                : normalizeAutomationPoints(
                                    block.clip.volumeAutomationPoints,
                                    100,
                                  ),
                              keyframePercents: getAudioKeyframePercents(block.clip),
                            }))}
                          emptyMessage="Add audio clips or video-with-audio clips from the source bin into this lane."
                          automationLabel="Volume"
                          onAddAutomationPoint={addAudioVolumeAutomationPoint}
                          onCutBlock={splitAudioClipAtSeconds}
                          onTrimAudioBlockEdge={trimAudioClipFromEdge}
                          onOpenContextMenu={(id, event) => {
                            event.preventDefault();
                            const item = sourceItemByNodeId.get(audioClips.find((candidate) => candidate.id === id)?.sourceNodeId ?? '');
                            const menuItems: Array<{ label: string; action: () => void; tone?: 'danger' | 'default' }> = [];

                            if (item) {
                              menuItems.push({
                                label: 'Send Source To Flow Workspace',
                                action: () => sendSourceItemToFlow(item),
                              });
                            }

                            const clipBlock = audioBlocks.find((candidate) => candidate.clip.id === id);
                            if (
                              clipBlock
                              && timelineCursorSeconds > clipBlock.startSeconds
                              && timelineCursorSeconds < clipBlock.endSeconds
                              && splitEditorAudioClipAtTimelineSeconds(
                                clipBlock.clip,
                                getSourceItemDurationSeconds(item, durationMap) ?? 0,
                                timelineCursorSeconds,
                                (side) => side,
                              )
                            ) {
                              menuItems.push({
                                label: `Split At Playhead (${timelineCursorSeconds.toFixed(2)}s)`,
                                action: () => { splitAudioClipAtSeconds(id, timelineCursorSeconds); },
                              });
                            }

                            menuItems.push({
                              label: 'Remove From Lane',
                              tone: 'danger',
                              action: () => {
                                commitActiveCompositionPatch(
                                  buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [id]),
                                  'Update audio clips',
                                );
                                setContextMenu(null);
                              },
                            });

                            setContextMenu({ x: event.clientX, y: event.clientY, items: menuItems });
                          }}
                          onMoveBlock={moveAudioClip}
                          onDropSourceItem={(event) => handleTimelineSourceDrop(event, 'audio', trackIndex)}
                          onRemoveAutomationPoint={removeAudioVolumeAutomationPoint}
                          onResizeLane={(event) => startTimelineTrackResize(event, 'audio')}
                          onStartHandPan={startTimelineHandPan}
                          onSetPlayhead={setTimelineCursorSeconds}
                          playheadSeconds={timelineCursorSeconds}
                          snapPoints={timelineSnapPoints}
                          laneHeight={timelineAudioTrackHeight}
                          trackVolumePercent={audioTrackVolumes[trackIndex] ?? 100}
                          toolMode={timelineTool}
                          onTrackVolumeChange={(volumePercent) => updateAudioTrackVolume(trackIndex, volumePercent)}
                          onUpdateAutomationPoint={updateAudioVolumeAutomationPoint}
                          waveformById={audioWaveformMap}
                          onSelect={(id, modifiers) => {
                            const clip = audioClips.find((candidate) => candidate.id === id);
                            if (clip) {
                              selectAudioClip(clip, modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
                            }
                          }}
                          timelineSeconds={displayTimelineSeconds}
                          visibleRange={timelineViewportRange}
                          locked={isAudioTrackLocked(trackIndex)}
                          onToggleLock={() => toggleAudioTrackLock(trackIndex)}
                          collapsed={isAudioTrackCollapsed(trackIndex)}
                          onToggleCollapse={() => toggleAudioTrackCollapse(trackIndex)}
                          trackLabel={`A${trackIndex + 1}`}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      title="No composition selected"
                    />
                  )}
                </div>
              </div>
            </section>
          </section>

          {inspectorVisible ? (
            <>
              <ResizeHandle onPointerDown={(event) => startPanelResize(event, 'inspectorWidth', true)} />
              <div style={{ width: inspectorWidth }} className="h-full min-h-0 shrink-0">
                <InspectorPanel
                  audioClip={selectedAudioClip}
                  audioClips={audioClips}
                  audioTrackVolumes={audioTrackVolumes}
                  mutedAudioTracks={mutedAudioTracks}
                  soloAudioTracks={soloAudioTracks}
                  audioSourceItemsByClipId={new Map(audioClips.map((clip) => [clip.id, sourceItemByNodeId.get(clip.sourceNodeId)]))}
                  audioSourceItem={selectedAudioClip ? sourceItemByNodeId.get(selectedAudioClip.sourceNodeId) : undefined}
                  audioSourceDurationSeconds={selectedAudioSourceDurationSeconds}
                  onSplitAudioClip={() => selectedAudioClip ? splitAudioClipAtSeconds(selectedAudioClip.id, timelineCursorSeconds) : false}
                  onMatchAudioSpeechLevel={() => void matchSelectedAudioSpeechLevel()}
                  speechLevelMatchBusy={speechLevelMatchState.busy && speechLevelMatchState.clipId === selectedAudioClip?.id}
                  speechLevelMatchMessage={speechLevelMatchState.clipId === selectedAudioClip?.id ? speechLevelMatchState.message : undefined}
                  dialogueAuditionBusy={dialogueAuditionState.clipId === selectedAudioClip?.id && dialogueAuditionState.busy}
                  dialogueAuditionPlaying={dialogueAuditionState.clipId === selectedAudioClip?.id && dialogueAuditionState.playing}
                  dialogueAuditionSide={dialogueAuditionState.side}
                  dialogueAuditionCalibrated={dialogueAuditionState.calibrateCleanWithMatch}
                  dialogueAuditionSummary={dialogueAuditionState.clipId === selectedAudioClip?.id ? dialogueAuditionState.summary : undefined}
                  dialogueAuditionMessage={dialogueAuditionState.clipId === selectedAudioClip?.id ? dialogueAuditionState.message : undefined}
                  onDialogueAuditionSide={(side) => void auditionSelectedDialogue(side)}
                  onStopDialogueAudition={() => stopDialogueAudition('Audition stopped.')}
                  onSetDialogueAuditionCalibration={setDialogueAuditionCalibration}
                  onMoveAudioToTrack={(trackIndex) => updateSelectedAudioClip({ trackIndex })}
                  onMoveVisualToTrack={(trackIndex) => updateSelectedVisualClip({ trackIndex })}
                  onEditVisualText={openTextClipEditDialog}
                  onRemoveAudioClip={() => {
                    if (!selectedAudioClip) {
                      return;
                    }

                    commitActiveCompositionPatch(
                      buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [selectedAudioClip.id]),
                      'Update audio clips',
                    );
                    setSelectedAudioClipId(undefined);
                  }}
                  onRemoveStageObject={() => {
                    if (selectedStageObject) {
                      removeStageObject(selectedStageObject.id);
                    }
                  }}
                  onRemoveVisualClip={() => {
                    if (!selectedVisualClip) {
                      return;
                    }

                    commitActiveCompositionPatch(
                      buildTimelineClipRemovalPatch({ visualClips, audioClips, timelineMarkers }, [selectedVisualClip.id]),
                      'Update visual clips',
                    );
                    setSelectedVisualClipId(undefined);
                  }}
                  onSelectSource={() => {
                    if (!selectedSourceItem) {
                      return;
                    }

                    selectSourceItem(selectedSourceItem.id);
                  }}
                  onUpdateAudioClip={updateSelectedAudioClip}
                  onAddOrUpdateKeyframe={addOrUpdateKeyframeAtPlayhead}
                  onCommitVisualCropAsImageAsset={() => void commitSelectedImageCropAsAsset()}
                  onGenerateNarrationFromText={() => void generateNarrationForSelectedTextClip()}
                  onUpdateStageObject={(patch) => {
                    if (selectedStageObject) {
                      updateStageObject(selectedStageObject.id, patch);
                    }
                  }}
                  onUpdateVisualClip={updateSelectedVisualClip}
                  onJumpKeyframe={jumpToAdjacentSelectedKeyframe}
                  onRemoveAudioKeyframe={removeSelectedAudioKeyframe}
                  onRemoveVisualKeyframe={removeSelectedVisualKeyframe}
                  onUpdateAudioKeyframe={updateSelectedAudioKeyframe}
                  onUpdateVisualKeyframe={updateSelectedVisualKeyframe}
                  selectedStageObject={selectedStageObject}
                  selectedSourceItem={selectedSourceItem}
                  sequenceDurationSeconds={sequenceDurationSeconds}
                  timelineCursorSeconds={timelineCursorSeconds}
                  visualEditorAsset={selectedVisualEditorAsset}
                  visualClip={selectedVisualClip}
                  audioDurationSeconds={selectedAudioDurationSeconds}
                  visualDurationSeconds={selectedVisualDurationSeconds}
                  visualBackingImageItem={selectedVisualBackingImageItem}
                  visualSourceDurationSeconds={selectedVisualSourceDurationSeconds}
                  visualSourceItem={selectedVisualSourceItem}
                />
              </div>
            </>
          ) : null}
        </section>
        ) : null}
      </DockablePanelHost>
        {isHelpOpen ? <EditorHelpModal onClose={() => setHelpOpen(false)} /> : null}
        {mediaImportDialog ? (
          <MediaImportDialog
            busy={mediaImportDialog.busy}
            canCopy={canCopyImportedMedia}
            handling={mediaImportDialog.handling}
            kinds={mediaImportDialog.kinds}
            onCancel={() => setMediaImportDialog(null)}
            onConfirm={() => void confirmMediaImport()}
            onHandlingChange={(handling) => setMediaImportDialog((current) => current ? { ...current, handling } : current)}
          />
        ) : null}
        {visualClipPropertyDialog ? (
          <VisualClipPropertyCopyDialog
            onCancel={() => setVisualClipPropertyDialog(null)}
            onCopy={copySelectedVisualClipProperties}
            onToggleProperty={toggleVisualClipPropertySelection}
            selectedProperties={visualClipPropertyDialog.selectedProperties}
            sourceLabel={visualClipPropertyDialog.sourceLabel}
          />
        ) : null}
        {textEditDialog ? (
          <TextEditDialog
            draft={textEditDialog.draft}
            onCancel={() => setTextEditDialog(null)}
            onChange={updateTextEditDraft}
            onSave={saveTextEditDialog}
            title={textEditDialog.title}
          />
        ) : null}
        {contextMenu ? (
          <SharedContextMenu
            ariaLabel="Editor context menu"
            items={contextMenu.items.map((item, index) => ({
              ...item,
              id: item.id ?? `${index}-${item.label}`,
            }))}
            onClose={() => setContextMenu(null)}
            title="Editor Actions"
            x={contextMenu.x}
            y={contextMenu.y}
          />
        ) : null}
        {sourceBinPreview ? (
          <MediaPreviewModal
            kind={sourceBinPreview.kind}
            label={sourceBinPreview.label}
            onClose={() => setSourceBinPreview(null)}
            src={sourceBinPreview.src}
          />
        ) : null}
    </div>
  );
}

function groupTimelineBlocksByTrack<T extends { clip: { trackIndex: number } }>(
  blocks: readonly T[],
  trackCount: number,
): T[][] {
  const groups = Array.from({ length: Math.max(0, trackCount) }, () => [] as T[]);
  for (const block of blocks) {
    if (Number.isInteger(block.clip.trackIndex) && block.clip.trackIndex >= 0 && block.clip.trackIndex < groups.length) {
      groups[block.clip.trackIndex].push(block);
    }
  }
  return groups;
}

interface SequencerTimelinePanelProps {
  activeComposition?: AppNode;
  addAudioVolumeAutomationPoint: (clipId: string, point: TimelineAutomationPoint) => void;
  addOrUpdateKeyframeAtPlayhead: () => void;
  addTimelineSnapAtSeconds: (seconds: number, shiftKey: boolean) => number;
  addVisualOpacityAutomationPoint: (clipId: string, point: TimelineAutomationPoint) => void;
  audioBlocks: ReturnType<typeof buildAudioTimelineBlocks>;
  audioClips: EditorAudioClip[];
  audioTrackCount: number;
  audioTrackVolumes: number[];
  mutedAudioTracks: number[];
  soloAudioTracks: number[];
  audioWaveformMap: Record<string, number[]>;
  canKeyframeSelectedClip: boolean;
  clearTimelineSelection: () => void;
  clearTimelineSnapPoints: () => void;
  clipEdgePreviewMap: Record<string, TimelineClipEdgePreview>;
  compositionFrameRate: number;
  displayTimelineSeconds: number;
  handleTimelineSourceDrop: (event: React.DragEvent<HTMLDivElement>, trackType: 'visual' | 'audio', trackIndex: number) => void;
  jumpToAdjacentSelectedKeyframe: (direction: 'previous' | 'next') => void;
  moveAudioClip: (id: string, nextStartSeconds: number, shiftKey: boolean, nextTrackIndex?: number) => void;
  moveVisualClip: (id: string, nextStartSeconds: number, shiftKey: boolean, nextTrackIndex?: number) => void;
  onCutSelectedVisualClipAtPlayhead: () => boolean;
  onOpenAudioClipContextMenu: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  onOpenTimelineGapContextMenu: (gap: TimelineGap, event: React.MouseEvent<HTMLElement>) => void;
  onOpenVisualClipContextMenu: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  onSelectAudioClip: (clip: EditorAudioClip, additive?: boolean) => void;
  onSelectVisualClip: (clip: EditorVisualClip, additive?: boolean) => void;
  onSelectManyAudioClips: (clipIds: string[]) => void;
  onSelectManyVisualClips: (clipIds: string[]) => void;
  onSetSelectedSourceItemId: (itemId?: string) => void;
  onSetSelectedStageObjectId: (objectId?: string) => void;
  onSetSelectedTimelineGap: (gap: TimelineGap | null) => void;
  onSetTimelineCursorSeconds: (seconds: number) => void;
  onSetTimelineTool: (tool: TimelineTool) => void;
  onBeginProfessionalTrim: (clipId: string, mode: Extract<TimelineTool, 'ripple' | 'roll' | 'slip' | 'slide'>, edge?: TimelineClipEdge) => void;
  onSetTimelineZoomPercent: (percent: number) => void;
  onSetTrackHeight: (trackType: 'visual' | 'audio', height: number) => void;
  onStartTimelineHandPan: (event: React.PointerEvent<HTMLElement>) => void;
  onStartTimelineTrackResize: (event: React.PointerEvent<HTMLElement>, trackType: 'visual' | 'audio') => void;
  onUpdateAudioTrackVolume: (trackIndex: number, volumePercent: number) => void;
  onToggleAudioTrackMute: (trackIndex: number) => void;
  onToggleAudioTrackSolo: (trackIndex: number) => void;
  removeAudioVolumeAutomationPoint: (clipId: string, pointIndex: number) => void;
  removeVisualOpacityAutomationPoint: (clipId: string, pointIndex: number) => void;
  timelineRulerTicks: number[];
  timelineContentWidthPercent: number;
  timelineViewportRange?: TimelineViewportRange;
  timelineNavigationModel?: VideoTimelineNavigationModel;
  timelineNavigationUnavailableReason?: string;
  onTimelineOverviewNavigate: (navigation: TimelineMinimapNavigation) => void;
  onTimelineScroll: (element: HTMLDivElement | null) => void;
  longFormSequence: boolean;
  selectedAudioClip?: EditorAudioClip;
  selectedAudioClipIds: readonly string[];
  selectedTimelineGap: TimelineGap | null;
  selectedVisualClip?: EditorVisualClip;
  selectedVisualClipIds: readonly string[];
  sequenceDurationSeconds: number;
  shuttleRate: number;
  timelineMarkers: TimelineMarker[];
  onJumpToMarker: (seconds: number) => void;
  onRemoveMarker: (markerId: string) => void;
  isVisualTrackLockedProp: (trackIndex: number) => boolean;
  isAudioTrackLockedProp: (trackIndex: number) => boolean;
  onToggleVisualTrackLock: (trackIndex: number) => void;
  onToggleAudioTrackLock: (trackIndex: number) => void;
  isVisualTrackCollapsedProp: (trackIndex: number) => boolean;
  isAudioTrackCollapsedProp: (trackIndex: number) => boolean;
  onToggleVisualTrackCollapse: (trackIndex: number) => void;
  onToggleAudioTrackCollapse: (trackIndex: number) => void;
  visualTrackKinds: EditorVisualTrackKind[];
  onToggleVisualTrackKind: (trackIndex: number) => void;
  snapTimelineInteractionSeconds: (seconds: number, shiftKey: boolean) => number;
  splitVisualClipAtSeconds: (id: string, splitSeconds: number, shiftKey: boolean) => void;
  splitAudioClipAtSeconds: (id: string, splitSeconds: number, shiftKey: boolean) => boolean;
  slipVisualClip: (id: string, deltaSeconds: number) => void;
  timelineAudioTrackHeight: number;
  timelineCursorSeconds: number;
  timelineRulerScrollRef: RefObject<HTMLDivElement | null>;
  timelineScrollRef: RefObject<HTMLDivElement | null>;
  timelineSnapPoints: number[];
  timelineTool: TimelineTool;
  timelineVisualTrackHeight: number;
  timelineZoomPercent: number;
  timelineMaxZoomPercent: number;
  trimVisualClipFromEdge: (clip: EditorVisualClip, edge: TimelineClipEdge, deltaSeconds: number, shiftKey: boolean) => void;
  trimAudioClipFromEdge: (clip: EditorAudioClip, edge: TimelineClipEdge, deltaSeconds: number, shiftKey: boolean, options?: { phase?: 'start' | 'move' }) => void;
  updateAudioVolumeAutomationPoint: (clipId: string, pointIndex: number, point: TimelineAutomationPoint) => void;
  updateVisualOpacityAutomationPoint: (clipId: string, pointIndex: number, point: TimelineAutomationPoint) => void;
  visualBlocks: ReturnType<typeof buildVisualTimelineBlocks>;
  visualClips: EditorVisualClip[];
  visualTrackCount: number;
  visualGapsByTrack: Required<TimelineGap>[][];
}

function SequencerTimelinePanel({
  activeComposition,
  addAudioVolumeAutomationPoint,
  addOrUpdateKeyframeAtPlayhead,
  addTimelineSnapAtSeconds,
  addVisualOpacityAutomationPoint,
  audioBlocks,
  audioClips,
  audioTrackCount,
  audioTrackVolumes,
  mutedAudioTracks,
  soloAudioTracks,
  audioWaveformMap,
  canKeyframeSelectedClip,
  clearTimelineSelection,
  clearTimelineSnapPoints,
  clipEdgePreviewMap,
  compositionFrameRate,
  displayTimelineSeconds,
  handleTimelineSourceDrop,
  jumpToAdjacentSelectedKeyframe,
  moveAudioClip,
  moveVisualClip,
  onCutSelectedVisualClipAtPlayhead,
  onOpenAudioClipContextMenu,
  onOpenTimelineGapContextMenu,
  onOpenVisualClipContextMenu,
  onSelectAudioClip,
  onSelectVisualClip,
  onSelectManyAudioClips,
  onSelectManyVisualClips,
  onSetSelectedSourceItemId,
  onSetSelectedStageObjectId,
  onSetSelectedTimelineGap,
  onSetTimelineCursorSeconds,
  onSetTimelineTool,
  onBeginProfessionalTrim,
  onSetTimelineZoomPercent,
  onSetTrackHeight,
  onStartTimelineHandPan,
  onStartTimelineTrackResize,
  onUpdateAudioTrackVolume,
  onToggleAudioTrackMute,
  onToggleAudioTrackSolo,
  removeAudioVolumeAutomationPoint,
  removeVisualOpacityAutomationPoint,
  timelineRulerTicks,
  timelineContentWidthPercent,
  timelineViewportRange,
  timelineNavigationModel,
  timelineNavigationUnavailableReason,
  onTimelineOverviewNavigate,
  onTimelineScroll,
  longFormSequence,
  selectedAudioClipIds,
  selectedTimelineGap,
  selectedVisualClipIds,
  sequenceDurationSeconds,
  shuttleRate,
  timelineMarkers,
  onJumpToMarker,
  onRemoveMarker,
  isVisualTrackLockedProp,
  isAudioTrackLockedProp,
  onToggleVisualTrackLock,
  onToggleAudioTrackLock,
  isVisualTrackCollapsedProp,
  isAudioTrackCollapsedProp,
  onToggleVisualTrackCollapse,
  onToggleAudioTrackCollapse,
  visualTrackKinds,
  onToggleVisualTrackKind,
  snapTimelineInteractionSeconds,
  splitVisualClipAtSeconds,
  splitAudioClipAtSeconds,
  slipVisualClip,
  timelineAudioTrackHeight,
  timelineCursorSeconds,
  timelineRulerScrollRef,
  timelineScrollRef,
  timelineSnapPoints,
  timelineTool,
  timelineVisualTrackHeight,
  timelineZoomPercent,
  timelineMaxZoomPercent,
  trimVisualClipFromEdge,
  trimAudioClipFromEdge,
  updateAudioVolumeAutomationPoint,
  updateVisualOpacityAutomationPoint,
  visualBlocks,
  visualClips,
  visualTrackCount,
  visualGapsByTrack,
}: SequencerTimelinePanelProps) {
  const selectedVisualClipIdSet = useMemo(() => new Set(selectedVisualClipIds), [selectedVisualClipIds]);
  const selectedAudioClipIdSet = useMemo(() => new Set(selectedAudioClipIds), [selectedAudioClipIds]);
  const visualBlocksByTrack = useMemo(
    () => groupTimelineBlocksByTrack(visualBlocks, visualTrackCount),
    [visualBlocks, visualTrackCount],
  );
  const audioBlocksByTrack = useMemo(
    () => groupTimelineBlocksByTrack(audioBlocks, audioTrackCount),
    [audioBlocks, audioTrackCount],
  );
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#131821]">
      <div className="border-b border-gray-700/60 px-3 py-2">
        <div
          className="flex items-center justify-end gap-3"
          title="Select, cut, slip, and position clips on independent visual and audio lanes. Use the Inspector for exact values."
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ToolToggleButton active={timelineTool === 'select'} icon={<MousePointer2 size={12} />} label="Select" onClick={() => onSetTimelineTool('select')} />
            <ToolToggleButton
              active={timelineTool === 'cut'}
              icon={<Scissors size={12} />}
              label="Cut"
              onClick={() => {
                if (!onCutSelectedVisualClipAtPlayhead()) onSetTimelineTool('cut');
              }}
            />
            <ToolToggleButton active={timelineTool === 'marquee'} icon={<Square size={12} />} label="Marquee" onClick={() => onSetTimelineTool('marquee')} />
            <ToolToggleButton active={timelineTool === 'range'} icon={<Square size={12} />} label="Range" onClick={() => onSetTimelineTool('range')} />
            <ToolToggleButton active={timelineTool === 'ripple'} icon={<ChevronRight size={12} />} label="Ripple" onClick={() => onSetTimelineTool('ripple')} />
            <ToolToggleButton active={timelineTool === 'roll'} icon={<Scissors size={12} />} label="Roll" onClick={() => onSetTimelineTool('roll')} />
            <ToolToggleButton active={timelineTool === 'slip'} icon={<Film size={12} />} label="Slip" onClick={() => onSetTimelineTool('slip')} />
            <ToolToggleButton active={timelineTool === 'slide'} icon={<Film size={12} />} label="Slide" onClick={() => onSetTimelineTool('slide')} />
            <ToolToggleButton active={timelineTool === 'rate-stretch'} icon={<ChevronRight size={12} />} label="Rate" onClick={() => onSetTimelineTool('rate-stretch')} />
            <ToolToggleButton active={timelineTool === 'hand'} icon={<Archive size={12} />} label="Hand" onClick={() => onSetTimelineTool('hand')} />
            <ToolToggleButton active={timelineTool === 'snap'} icon={<Plus size={12} />} label="Snap" onClick={() => onSetTimelineTool('snap')} />
            <button className="inline-flex items-center gap-1.5 rounded-full border border-gray-700/60 bg-[#111217]/70 px-3 py-1 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!canKeyframeSelectedClip} onClick={() => jumpToAdjacentSelectedKeyframe('previous')} title="Jump to previous keyframe ([)" type="button">
              <ChevronLeft size={12} />
              Key
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!canKeyframeSelectedClip} onClick={addOrUpdateKeyframeAtPlayhead} title="Add or update a keyframe at the playhead (Shift+K)" type="button">
              <Diamond size={12} />
              Add Key
            </button>
            <button className="inline-flex items-center gap-1.5 rounded-full border border-gray-700/60 bg-[#111217]/70 px-3 py-1 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={!canKeyframeSelectedClip} onClick={() => jumpToAdjacentSelectedKeyframe('next')} title="Jump to next keyframe (])" type="button">
              Key
              <ChevronRight size={12} />
            </button>
            {timelineSnapPoints.length > 0 ? (
              <button className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white" onClick={clearTimelineSnapPoints} type="button">
                Clear {timelineSnapPoints.length} snap{timelineSnapPoints.length === 1 ? '' : 's'}
              </button>
            ) : null}
            <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
              <span>Zoom</span>
              <input className="w-28" max={timelineMaxZoomPercent} min={100} onChange={(event) => onSetTimelineZoomPercent(Number(event.target.value))} step={50} type="range" value={timelineZoomPercent} />
              <span>{timelineZoomPercent}%</span>
            </label>
            <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
              <span>V H</span>
              <input className="w-20" max={180} min={60} onChange={(event) => onSetTrackHeight('visual', Number(event.target.value))} step={4} type="range" value={timelineVisualTrackHeight} />
              <span>{timelineVisualTrackHeight}</span>
            </label>
            <label className="flex items-center gap-2 rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
              <span>A H</span>
              <input className="w-20" max={180} min={44} onChange={(event) => onSetTrackHeight('audio', Number(event.target.value))} step={4} type="range" value={timelineAudioTrackHeight} />
              <span>{timelineAudioTrackHeight}</span>
            </label>
            <button
              className="rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
              onClick={() => {
                onSetTimelineZoomPercent(100);
                onSetTrackHeight('visual', 84);
                onSetTrackHeight('audio', 64);
                timelineScrollRef.current?.scrollTo({ left: 0 });
              }}
              type="button"
            >
              Zoom To Fit
            </button>
            <div className="rounded-full border border-gray-700/60 bg-[#111217]/45 px-3 py-1 text-xs text-gray-300">
              {sequenceDurationSeconds > 0 ? formatEditorTimecode(sequenceDurationSeconds, compositionFrameRate) : 'No clips yet'}
            </div>
            <div className="rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1 font-mono text-xs font-semibold tabular-nums text-cyan-100">
              {formatEditorTimecode(timelineCursorSeconds, compositionFrameRate)}
            </div>
            {longFormSequence ? (
              <div className="rounded-full border border-emerald-300/35 bg-emerald-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">
                Long-form
              </div>
            ) : null}
            <div
              className={`rounded-full border px-3 py-1 font-mono text-xs ${shuttleRate === 0 ? 'border-gray-700/60 bg-[#111217]/45 text-gray-500' : 'border-emerald-300/45 bg-emerald-400/10 text-emerald-200'}`}
              data-video-transport-rate={shuttleRate}
              title="J/K/L shuttle · Space play/pause · Home/End to sequence bounds"
            >
              {shuttleRate === 0 ? '⏸ JKL' : shuttleRate > 0 ? `▶ ${shuttleRate}×` : `◀ ${Math.abs(shuttleRate)}×`}
            </div>
          </div>
        </div>
      </div>

      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <div className="border-b border-gray-700/60 px-2.5 py-2">
          {timelineNavigationModel ? (
            <div className="mb-2 ml-[104px]">
              <TimelineMinimap model={timelineNavigationModel} playheadMs={timelineCursorSeconds * 1_000} onNavigate={onTimelineOverviewNavigate} />
            </div>
          ) : timelineNavigationUnavailableReason ? (
            <div className="mb-2 ml-[104px] rounded-md border border-amber-300/25 bg-amber-300/5 px-2 py-1 text-[10px] text-amber-100">
              {timelineNavigationUnavailableReason}
            </div>
          ) : null}
          <div
            className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(event) => {
              if (timelineScrollRef.current) timelineScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
              onTimelineScroll(timelineScrollRef.current);
            }}
            ref={timelineRulerScrollRef}
          >
            <div className="grid min-w-full grid-cols-[96px_minmax(0,1fr)] gap-2" style={{ width: `${timelineContentWidthPercent}%` }}>
              <div />
              <div className="relative h-8 overflow-hidden rounded-md border border-gray-700/60 bg-[#203847]">
                <button
                  className="absolute inset-0 z-10 h-full w-full cursor-pointer bg-transparent"
                  onClick={(event) => {
                    if (timelineTool === 'hand') return;
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const ratio = (event.clientX - bounds.left) / bounds.width;
                    const timelineSeconds = Math.max(0, Math.min(displayTimelineSeconds, ratio * displayTimelineSeconds));
                    if (timelineTool === 'snap') {
                      addTimelineSnapAtSeconds(timelineSeconds, event.shiftKey);
                      return;
                    }
                    onSetTimelineCursorSeconds(snapTimelineInteractionSeconds(timelineSeconds, event.shiftKey));
                  }}
                  onPointerDown={(event) => {
                    if (timelineTool === 'hand') onStartTimelineHandPan(event);
                  }}
                  type="button"
                />
                {timelineRulerTicks.map((second) => (
                  <div key={second} className="absolute bottom-0 top-0 border-l border-gray-700/50" style={{ left: `${(second / displayTimelineSeconds) * 100}%` }}>
                    <span className="absolute left-1 top-0.5 font-mono text-[9px] tabular-nums text-gray-400">{formatTimelineRulerLabel(second, displayTimelineSeconds)}</span>
                  </div>
                ))}
                {timelineSnapPoints.map((snapSecond) => (
                  <div key={`snap-${snapSecond}`} className="pointer-events-none absolute bottom-0 top-0 z-20 border-l-2 border-cyan-200/80" style={{ left: `${(snapSecond / displayTimelineSeconds) * 100}%` }}>
                    <span className="absolute left-1 top-4 rounded bg-cyan-950/80 px-1 text-[9px] font-semibold text-cyan-100">
                      {snapSecond.toFixed(snapSecond % 1 === 0 ? 0 : 1)}s
                    </span>
                  </div>
                ))}
                {timelineMarkers.map((marker) => (
                  <TimelineMarkerFlag
                    displayTimelineSeconds={displayTimelineSeconds}
                    key={marker.id}
                    marker={marker}
                    onJump={onJumpToMarker}
                    onRemove={onRemoveMarker}
                  />
                ))}
                <div className="absolute bottom-0 top-0 z-20 w-px bg-red-400/90" style={{ left: `${(timelineCursorSeconds / displayTimelineSeconds) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div
          className="min-h-0 overflow-auto px-2.5 py-2"
          onScroll={(event) => {
            if (timelineRulerScrollRef.current) timelineRulerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
            onTimelineScroll(event.currentTarget);
          }}
          ref={timelineScrollRef}
        >
          {activeComposition ? (
            <div className="min-w-full space-y-1.5" data-timeline-lanes-root="true" style={{ width: `${timelineContentWidthPercent}%` }}>
              {Array.from({ length: visualTrackCount }, (_, trackIndex) => (
                <TimelineLane
                  key={`visual-${trackIndex}`}
                  automationLabel="Opacity"
                  laneTrackIndex={trackIndex}
                  laneTrackKind="visual"
                  overlayKind={visualTrackKinds[trackIndex]}
                  onToggleOverlayKind={() => onToggleVisualTrackKind(trackIndex)}
                  blocks={visualBlocksByTrack[trackIndex]
                    .filter((block) => timelineRangeIntersects(block.startSeconds, block.durationSeconds, timelineViewportRange))
                    .map((block) => ({
                    id: block.clip.id,
                    label: visualBlockLabel(block.clip, block.item?.label),
                    secondaryLabel: `${block.startSeconds.toFixed(1)}s -> ${block.endSeconds.toFixed(1)}s`,
                    startSeconds: block.startSeconds,
                    durationSeconds: block.durationSeconds,
                    kind: block.item?.kind ?? block.clip.sourceKind,
                    trimClip: block.clip,
                    selected: selectedVisualClipIdSet.has(block.clip.id),
                    opacityPercent: block.clip.opacityPercent,
                    opacityAutomationPoints: block.clip.keyframes?.length ? visualKeyframesToOpacityAutomation(block.clip) : normalizeAutomationPoints(block.clip.opacityAutomationPoints, block.clip.opacityPercent),
                    keyframePercents: getVisualKeyframePercents(block.clip),
                  }))}
                  emptyMessage="Add image, video, composition, or text items from the source bin into this video lane."
                  gaps={visualGapsByTrack[trackIndex] ?? []}
                  laneHeight={timelineVisualTrackHeight}
                  onAddAutomationPoint={addVisualOpacityAutomationPoint}
                  onCutBlock={splitVisualClipAtSeconds}
                  onDropSourceItem={(event) => handleTimelineSourceDrop(event, 'visual', trackIndex)}
                  onMoveBlock={moveVisualClip}
                  onOpenContextMenu={onOpenVisualClipContextMenu}
                  onOpenGapContextMenu={onOpenTimelineGapContextMenu}
                  onRemoveAutomationPoint={removeVisualOpacityAutomationPoint}
                  onResizeLane={(event) => onStartTimelineTrackResize(event, 'visual')}
                  onSelect={(id, modifiers) => {
                    const clip = visualClips.find((candidate) => candidate.id === id);
                    if (clip) onSelectVisualClip(clip, modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
                  }}
                  onSelectMany={onSelectManyVisualClips}
                  onSelectGap={(gap) => {
                    onSetSelectedTimelineGap(gap);
                    clearTimelineSelection();
                    onSetSelectedSourceItemId(undefined);
                    onSetSelectedStageObjectId(undefined);
                  }}
                  onSetPlayhead={onSetTimelineCursorSeconds}
                  onSlipBlock={slipVisualClip}
                  onBeginProfessionalTrim={onBeginProfessionalTrim}
                  onStartHandPan={onStartTimelineHandPan}
                  onTrimBlockEdge={trimVisualClipFromEdge}
                  onUpdateAutomationPoint={updateVisualOpacityAutomationPoint}
                  playheadSeconds={timelineCursorSeconds}
                  previewById={clipEdgePreviewMap}
                  selectedGapId={selectedTimelineGap?.id}
                  snapPoints={timelineSnapPoints}
                  timelineSeconds={displayTimelineSeconds}
                  toolMode={timelineTool}
                  visibleRange={timelineViewportRange}
                  locked={isVisualTrackLockedProp(trackIndex)}
                  onToggleLock={() => onToggleVisualTrackLock(trackIndex)}
                  collapsed={isVisualTrackCollapsedProp(trackIndex)}
                  onToggleCollapse={() => onToggleVisualTrackCollapse(trackIndex)}
                  trackLabel={`V${trackIndex + 1}`}
                />
              ))}

              {Array.from({ length: audioTrackCount }, (_, trackIndex) => (
                <TimelineLane
                  key={trackIndex}
                  automationLabel="Volume"
                  laneTrackIndex={trackIndex}
                  laneTrackKind="audio"
                  blocks={audioBlocksByTrack[trackIndex]
                    .filter((block) => timelineRangeIntersects(block.startSeconds, block.durationSeconds, timelineViewportRange))
                    .map((block) => ({
                    id: block.clip.id,
                    label: block.item?.label ?? block.clip.sourceNodeId,
                    secondaryLabel: `${block.startSeconds.toFixed(1)}s -> ${block.endSeconds.toFixed(1)}s`,
                    startSeconds: block.startSeconds,
                    durationSeconds: block.durationSeconds,
                    kind: block.item?.kind ?? ('audio' as const),
                    trimAudioClip: block.clip,
                    selected: selectedAudioClipIdSet.has(block.clip.id),
                    muted: !block.clip.enabled || !isAudioTrackAudible(trackIndex, mutedAudioTracks, soloAudioTracks),
                    opacityAutomationPoints: block.clip.volumeKeyframes?.length ? audioKeyframesToVolumeAutomation(block.clip) : normalizeAutomationPoints(block.clip.volumeAutomationPoints, 100),
                    keyframePercents: getAudioKeyframePercents(block.clip),
                  }))}
                  emptyMessage="Add audio clips or video-with-audio clips from the source bin into this lane."
                  laneHeight={timelineAudioTrackHeight}
                  onAddAutomationPoint={addAudioVolumeAutomationPoint}
                  onCutBlock={splitAudioClipAtSeconds}
                  onTrimAudioBlockEdge={trimAudioClipFromEdge}
                  onDropSourceItem={(event) => handleTimelineSourceDrop(event, 'audio', trackIndex)}
                  onMoveBlock={moveAudioClip}
                  onOpenContextMenu={onOpenAudioClipContextMenu}
                  onRemoveAutomationPoint={removeAudioVolumeAutomationPoint}
                  onResizeLane={(event) => onStartTimelineTrackResize(event, 'audio')}
                  onSelect={(id, modifiers) => {
                    const clip = audioClips.find((candidate) => candidate.id === id);
                    if (clip) onSelectAudioClip(clip, modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey);
                  }}
                  onSelectMany={onSelectManyAudioClips}
                  onSetPlayhead={onSetTimelineCursorSeconds}
                  onBeginProfessionalTrim={onBeginProfessionalTrim}
                  onStartHandPan={onStartTimelineHandPan}
                  onTrackVolumeChange={(volumePercent) => onUpdateAudioTrackVolume(trackIndex, volumePercent)}
                  trackMuted={mutedAudioTracks.includes(trackIndex)}
                  trackSoloed={soloAudioTracks.includes(trackIndex)}
                  onToggleTrackMute={() => onToggleAudioTrackMute(trackIndex)}
                  onToggleTrackSolo={() => onToggleAudioTrackSolo(trackIndex)}
                  onUpdateAutomationPoint={updateAudioVolumeAutomationPoint}
                  playheadSeconds={timelineCursorSeconds}
                  snapPoints={timelineSnapPoints}
                  timelineSeconds={displayTimelineSeconds}
                  toolMode={timelineTool}
                  visibleRange={timelineViewportRange}
                  locked={isAudioTrackLockedProp(trackIndex)}
                  onToggleLock={() => onToggleAudioTrackLock(trackIndex)}
                  collapsed={isAudioTrackCollapsedProp(trackIndex)}
                  onToggleCollapse={() => onToggleAudioTrackCollapse(trackIndex)}
                  trackLabel={`A${trackIndex + 1}`}
                  trackVolumePercent={audioTrackVolumes[trackIndex] ?? 100}
                  waveformById={audioWaveformMap}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No composition selected" />
          )}
        </div>
      </div>
    </section>
  );
}

function SourceMonitorPanel({
  item,
  marks,
  mediaInfo,
  sourceDurationSeconds,
  onAddVisual,
  onAddAudio,
  onMarkIn,
  onMarkOut,
  onInsertEdit,
  onOverwriteEdit,
  onOpenContextMenu,
  videoRef,
}: {
  item?: SourceBinItem;
  marks?: { inSeconds?: number; outSeconds?: number };
  mediaInfo?: SourceMediaInfo;
  sourceDurationSeconds?: number;
  onAddVisual: (item: SourceBinItem, trackIndex: number) => void;
  onAddAudio: (item: SourceBinItem, trackIndex: number) => void;
  onMarkIn: () => void;
  onMarkOut: () => void;
  onInsertEdit: () => void;
  onOverwriteEdit: () => void;
  onOpenContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  return (
    <section className={`${panelClassName} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 p-2.5">
        {item ? (
          <>
            <div className="h-full min-h-0" onContextMenu={onOpenContextMenu}>
              <MonitorSurface item={item} mediaInfo={mediaInfo} variant="source" videoRef={videoRef} />
            </div>
            <div className="rounded-lg border border-gray-700/60 bg-[#111217]/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-white">{item.label}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-500">
                    <span>{item.kind}</span>
                    <span className={resolveSourceBinItemOrigin(item) === 'generated' ? 'text-violet-300' : 'text-blue-300'}>
                      {resolveSourceBinItemOrigin(item)}
                    </span>
                    {sourceDurationSeconds ? <span>{sourceDurationSeconds.toFixed(1)}s</span> : null}
                    {mediaInfo?.width && mediaInfo.height ? <span>{Math.round(mediaInfo.width)}×{Math.round(mediaInfo.height)}</span> : null}
                    {item.mimeType ? <span>{item.mimeType}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canUseSourceItemAsVisual(item) ? (
                    <div className="inline-flex items-stretch gap-1" data-source-monitor-three-point>
                      <button
                        className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-[#161c26] hover:text-white"
                        onClick={onMarkIn}
                        title="Mark In at the source playhead (I)"
                        type="button"
                      >
                        ⟨I{marks?.inSeconds !== undefined ? ` ${marks.inSeconds.toFixed(1)}s` : ''}
                      </button>
                      <button
                        className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-2 py-1 text-[11px] font-semibold text-gray-200 hover:bg-[#161c26] hover:text-white"
                        onClick={onMarkOut}
                        title="Mark Out at the source playhead (O)"
                        type="button"
                      >
                        O⟩{marks?.outSeconds !== undefined ? ` ${marks.outSeconds.toFixed(1)}s` : ''}
                      </button>
                      <button
                        className="rounded-lg border border-cyan-300/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:border-cyan-200/70 hover:text-white"
                        onClick={onInsertEdit}
                        title="Insert marked range at the timeline playhead on V1, rippling later clips right (,)"
                        type="button"
                      >
                        Insert
                      </button>
                      <button
                        className="rounded-lg border border-amber-300/40 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:border-amber-200/70 hover:text-white"
                        onClick={onOverwriteEdit}
                        title="Overwrite the timeline range at the playhead on V1 with the marked range (.)"
                        type="button"
                      >
                        Overwrite
                      </button>
                    </div>
                  ) : null}
                  {canUseSourceItemAsVisual(item) ? (
                    <TrackAddControl
                      icon={Film}
                      noun="Video"
                      onAdd={(trackIndex) => onAddVisual(item, trackIndex)}
                      trackCount={VISUAL_TRACK_COUNT}
                    />
                  ) : null}

                  {canUseSourceItemAsAudio(item) ? (
                    <TrackAddControl
                      icon={Music2}
                      noun="Audio"
                      onAdd={(trackIndex) => onAddAudio(item, trackIndex)}
                      trackCount={AUDIO_TRACK_COUNT}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            title="No source selected"
          />
        )}
      </div>
    </section>
  );
}

export function ProgramMonitorPanel({
  stageMode,
  previewUrl,
  previewOutputMetadata,
  playheadSeconds,
  aspectRatio,
  videoResolution,
  frameRate,
  canvas,
  sequenceSummary,
  exportPresetPlan,
  exportReadiness,
  managedFontGate = { status: 'ready', retry: () => {} },
  renderBackendStatus,
  monitorParityNotices,
  parityDiagnostics,
  stageClips,
  stageObjects,
  selectedClip,
  selectedStageObject,
  activeTool,
  visualClipCount,
  audioClipCount,
  onRun,
  onAddEditorAsset,
  onAddComicStageObject = () => {},
  onSelectClip,
  onSelectStageObject,
  onUpdateClip,
  onUpdateStageObject,
  onSetMonitorMode,
  onAspectRatioChange,
  onResolutionChange,
  onFrameRateChange,
  onExportPresetPlanChange,
  onRenderBackendPreferenceChange = () => {},
  renderBackendPreference = 'auto',
  hasCaptionCues,
  onExportCaptions,
  onOpenClipContextMenu,
  onOpenContextMenu,
  videoRef,
  incrementalRenderSummary,
  renderCacheDetailLines = [],
  isRunning,
  renderStatusMessage,
  errorMessage,
  hasActiveComposition = true,
  onCreateComposition,
  onCreateStarterSequence,
  onRevealSourceBin,
  onExportFcpXml,
  initialSidebarTab,
  transportRate = 0,
}: {
  stageMode: 'stage' | 'rendered';
  previewUrl?: string;
  previewOutputMetadata?: Record<string, unknown>;
  playheadSeconds: number;
  aspectRatio: AspectRatio;
  videoResolution: VideoResolution;
  frameRate: number;
  canvas: { width: number; height: number };
  sequenceSummary: ReturnType<typeof buildVideoSequenceSummary>;
  exportPresetPlan: VideoExportPresetPlanData;
  exportReadiness: VideoExportReadinessSummary;
  managedFontGate?: ManagedFontRegistrationGateState;
  renderBackendStatus: VideoRenderBackendSummary;
  monitorParityNotices: string[];
  parityDiagnostics: ReturnType<typeof buildVideoParityDiagnostics>;
  stageClips: ProgramStageClip[];
  stageObjects: EditorStageObject[];
  selectedClip?: EditorVisualClip;
  selectedStageObject?: EditorStageObject;
  activeTool: TimelineTool;
  visualClipCount: number;
  audioClipCount: number;
  onRun: () => void;
  onAddEditorAsset: (kind: EditorAssetKind) => void;
  onAddComicStageObject?: (kind: 'speech-bubble' | 'thought-bubble' | 'caption') => void;
  onSelectClip: (clipId: string) => void;
  onSelectStageObject: (objectId: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<EditorVisualClip>) => void;
  onUpdateStageObject: (objectId: string, patch: Partial<EditorStageObject>) => void;
  onSetMonitorMode: (mode: 'stage' | 'rendered') => void;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  onResolutionChange: (videoResolution: VideoResolution) => void;
  onFrameRateChange: (frameRate: number) => void;
  onExportPresetPlanChange: (presetId: VideoExportPresetPlanId) => void;
  onRenderBackendPreferenceChange?: (preference: RenderBackendPreference) => void;
  renderBackendPreference?: RenderBackendPreference;
  hasCaptionCues: boolean;
  onExportCaptions: (format: 'srt' | 'vtt') => void;
  onOpenClipContextMenu: (clipId: string, event: React.MouseEvent<HTMLElement>) => void;
  onOpenContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  incrementalRenderSummary?: string;
  renderCacheDetailLines?: string[];
  isRunning?: boolean;
  renderStatusMessage?: string;
  errorMessage?: string;
  hasActiveComposition?: boolean;
  onCreateComposition?: () => void;
  onCreateStarterSequence?: () => void;
  onRevealSourceBin?: () => void;
  /** Export the active sequence as FCP7 XML for Premiere (scoped interop, task #33). */
  onExportFcpXml?: () => void;
  /** Starting sidebar tab; defaults to Tools (static render paths and tests can pin Info/Output). */
  initialSidebarTab?: 'tools' | 'info' | 'output';
  /** Sequence transport rate. One means real-time media playback; other shuttle rates stay seek-driven. */
  transportRate?: number;
}) {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  // Owner-requested tabbed sidebar: Tools (program-stage editing incl. motion comics),
  // Info (specs/status/cache), Output (delivery settings). Render stays pinned below all tabs.
  const [sidebarTab, setSidebarTab] = useState<'tools' | 'info' | 'output'>(initialSidebarTab ?? 'tools');
  const imageSequenceFrameCount = getImageSequenceFrameCount(previewOutputMetadata);
  const isImageSequenceOutput = Boolean(imageSequenceFrameCount !== undefined);
  const renderedPreviewDescriptor = buildRenderedPreviewDescriptor({
    previewUrl,
    previewOutputMetadata,
    isRunning,
    renderStatusMessage,
    errorMessage,
    isImageSequenceOutput,
  });
  const renderBlockedReason = managedFontGate.status === 'loading'
    ? 'Managed font faces are still being verified and registered.'
    : managedFontGate.status === 'error'
      ? managedFontGate.error
      : exportReadiness.tone === 'error'
        ? exportReadiness.detail
        : undefined;
  const renderedPreviewPlaceholderState: 'waiting' | 'error' | 'empty' | 'idle' = isRunning
    ? 'waiting'
    : errorMessage
      ? 'error'
      : renderStatusMessage
        ? 'empty'
        : 'idle';
  const showFloatingRenderOverlay = stageMode !== 'rendered' || Boolean(previewUrl);
  const selectedStageClip = selectedClip
    ? stageClips.find((stageClip) => stageClip.clip.id === selectedClip.id)
    : undefined;

  const selectedKeyframeState = selectedClip
    ? resolveClipFitState(
        selectedClip,
        selectedStageClip ? getStageClipProgress(selectedStageClip) * 100 : 0,
      )
    : undefined;

  const updateStageClipAtProgress = (
    stageClip: ProgramStageClip,
    patch: Partial<EditorVisualClip>,
  ) => {
    onUpdateClip(
      stageClip.clip.id,
      applyVisualClipPatchAtProgress(stageClip.clip, getStageClipProgress(stageClip) * 100, patch),
    );
  };

  const adjustSelectedClip = (patch: Partial<EditorVisualClip>) => {
    if (!selectedClip) {
      return;
    }

    const selectedStageClip = stageClips.find((stageClip) => stageClip.clip.id === selectedClip.id);

    if (selectedStageClip) {
      updateStageClipAtProgress(selectedStageClip, patch);
    } else {
      onUpdateClip(selectedClip.id, patch);
    }
  };

  const nudgeSelectedClip = (deltaX: number, deltaY: number) => {
    if (!selectedClip) {
      return;
    }

    const selectedStageClip = stageClips.find((stageClip) => stageClip.clip.id === selectedClip.id);
    const currentState = selectedStageClip
      ? getVisualKeyframeStateAtProgress(selectedClip, getStageClipProgress(selectedStageClip) * 100)
      : getVisualKeyframeStateAtProgress(selectedClip, 0);

    adjustSelectedClip({
      positionX: currentState.positionX + deltaX,
      positionY: currentState.positionY + deltaY,
    });
  };

  const adjustSelectedStageObject = (patch: Partial<EditorStageObject>) => {
    if (!selectedStageObject) {
      return;
    }

    onUpdateStageObject(selectedStageObject.id, patch);
  };

  const nudgeSelectedStageObject = (deltaX: number, deltaY: number) => {
    if (!selectedStageObject) {
      return;
    }

    adjustSelectedStageObject({
      x: selectedStageObject.x + deltaX,
      y: selectedStageObject.y + deltaY,
    });
  };

  const handleSaveVideo = async () => {
    if (!previewUrl) {
      return;
    }

    const preset = getVideoExportPresetOption(exportPresetPlan.presetId);
    const extension = isImageSequenceOutput ? 'zip' : preset.extension;
    const mimeType = isImageSequenceOutput ? 'application/zip' : preset.mimeType;
    await downloadAsset(previewUrl, buildDownloadFilename(`${EXPORT_BASENAME}-program`, mimeType, extension));
  };

  useEffect(() => {
    if (stageMode !== 'rendered' || !previewUrl || isImageSequenceOutput) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const playing = transportRate === 1;
    const synchronize = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : Number.POSITIVE_INFINITY;
      const targetTimeSeconds = Math.max(0, Math.min(playheadSeconds, duration));
      video.playbackRate = Math.max(0.25, Math.min(8, transportRate || 1));

      if (shouldCorrectProgramMediaTime(video.currentTime, targetTimeSeconds, playing)) {
        video.currentTime = targetTimeSeconds;
      }

      if (playing) {
        if (video.paused) void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };

    if (video.readyState >= 1) synchronize();
    video.addEventListener('loadedmetadata', synchronize);

    return () => video.removeEventListener('loadedmetadata', synchronize);
  }, [isImageSequenceOutput, playheadSeconds, previewUrl, stageMode, transportRate, videoRef]);

  return (
    <section className={`${panelClassName} flex h-full min-h-0 flex-col overflow-hidden`}>
      {/* COMPACT TOP BAR */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-700/60 bg-[#12161f] px-3 py-1.5 min-h-[44px]">
        <div className="flex items-center gap-3">
          {hasActiveComposition && (
            <div className="inline-flex overflow-hidden rounded-lg border border-gray-700/60 bg-[#0f131b]">
              <button
                className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  stageMode === 'stage' ? 'bg-blue-500/20 text-blue-100' : 'text-gray-300 hover:text-white'
                }`}
                onClick={() => onSetMonitorMode('stage')}
                type="button"
              >
                Edit Stage
              </button>
              <button
                className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  stageMode === 'rendered'
                    ? 'bg-blue-500/20 text-blue-100'
                    : 'text-gray-300 hover:text-white'
                }`}
                data-video-rendered-preview-tab="true"
                onClick={() => onSetMonitorMode('rendered')}
                type="button"
              >
                Rendered Preview
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!hasActiveComposition ? (
            onCreateComposition && (
              <button
                onClick={onCreateComposition}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 text-[11px] font-semibold transition-colors"
                type="button"
              >
                <Plus size={11} />
                Create Composition
              </button>
            )
          ) : (
            <>
              {onCreateComposition && (
                <button
                  onClick={onCreateComposition}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-700/60 bg-[#0f131b] hover:border-gray-500 text-gray-300 hover:text-white px-2 py-1 text-[11px] font-semibold transition-colors"
                  title="Create a new video composition node"
                  type="button"
                >
                  <Plus size={11} />
                  New Comp
                </button>
              )}
              <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-2.5 py-1 text-[11px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                type="button"
              >
                {isSidebarOpen ? 'Hide Controls' : 'Show Controls'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* MAIN CONTENT LAYOUT (STAGE & SIDEBAR SIDE-BY-SIDE) */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden bg-[#0a0d14]">
        {/* PREVIEW STAGE AREA */}
        <div className="relative flex min-h-0 flex-1 flex-col p-2.5 bg-black overflow-hidden justify-center">
          {!hasActiveComposition ? (
            <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center select-none bg-[#0a0d14]">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gray-800 bg-[#0f131b] text-gray-400 shadow-lg">
                <Film size={24} />
              </div>
              <h3 className="text-sm font-semibold text-white">No Active Composition</h3>
              <div className="mt-5 flex flex-col items-center gap-2">
                {(onCreateStarterSequence ?? onCreateComposition) && (
                  <button
                    onClick={onCreateStarterSequence ?? onCreateComposition}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-all"
                    type="button"
                  >
                    <Plus size={14} />
                    Create 1080p sequence
                  </button>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {onCreateComposition && (
                    <button
                      onClick={onCreateComposition}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                      type="button"
                    >
                      <Plus size={12} />
                      Blank composition
                    </button>
                  )}
                  {onRevealSourceBin && (
                    <button
                      onClick={onRevealSourceBin}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                      type="button"
                    >
                      <Archive size={12} />
                      Add media from the Source Library
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : managedFontGate.status !== 'ready' ? (
            <div
              className="flex h-full w-full flex-col items-center justify-center bg-[#0a0d14] p-6 text-center"
              data-video-managed-font-gate={managedFontGate.status}
            >
              <div className="text-sm font-semibold text-white">
                {managedFontGate.status === 'loading' ? 'Verifying managed fonts…' : 'Managed font unavailable'}
              </div>
              <p className="mt-2 max-w-md text-xs leading-5 text-gray-400">
                {managedFontGate.status === 'loading'
                  ? 'Exact Video text stays hidden until every referenced face is registered from verified bytes.'
                  : managedFontGate.error}
              </p>
              {managedFontGate.status === 'error' ? (
                <button
                  className="mt-4 rounded-lg border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/20"
                  data-video-managed-font-retry="true"
                  onClick={managedFontGate.retry}
                  type="button"
                >
                  Retry managed font registration
                </button>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col h-full w-full min-h-0 justify-center">
              {stageMode === 'rendered' && monitorParityNotices.length > 0 ? (
                <div className="mb-2 shrink-0 space-y-1.5">
                  {monitorParityNotices.map((notice) => (
                    <div
                      className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] leading-relaxed text-amber-100"
                      key={notice}
                    >
                      {notice}
                    </div>
                  ))}
                </div>
              ) : null}
              {stageMode === 'rendered' ? (
                <RenderedPreviewDescriptorStrip descriptor={renderedPreviewDescriptor} />
              ) : null}
              {stageMode === 'rendered' && previewUrl && isImageSequenceOutput ? (
                <div
                  className="min-h-0 flex flex-1 items-center justify-center"
                  data-video-rendered-preview-state="archive"
                  onContextMenu={onOpenContextMenu}
                >
                  <div className="max-w-md rounded-2xl border border-purple-300/25 bg-[#0f131b] p-5 text-center shadow-2xl shadow-black/30">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-300/30 bg-purple-500/15 text-purple-100">
                      <Archive size={20} />
                    </div>
                    <div className="mt-3 text-sm font-semibold text-white">Image Sequence Archive Ready</div>
                    <div className="mt-1 text-xs leading-5 text-gray-400">
                      {imageSequenceFrameCount} frame{imageSequenceFrameCount === 1 ? '' : 's'} exported as {getVideoExportPresetOption(exportPresetPlan.presetId).extension.toUpperCase()} plus manifest.json. Audio is ignored for image sequence exports.
                    </div>
                    <button
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-gray-200"
                      onClick={() => void handleSaveVideo()}
                      type="button"
                    >
                      <Archive size={12} />
                      Save ZIP Archive
                    </button>
                  </div>
                </div>
              ) : stageMode === 'rendered' && previewUrl ? (
                <div
                  className="min-h-0 flex-1"
                  data-video-rendered-preview-state="ready"
                  onContextMenu={onOpenContextMenu}
                >
                  <MonitorStageFrame aspectRatioValue={getAspectRatioValue(aspectRatio)}>
                    <video
                      key={previewUrl}
                      className="absolute inset-0 h-full w-full object-contain"
                      controls
                      data-video-rendered-preview="true"
                      data-video-rendered-preview-playhead={playheadSeconds}
                      preload="metadata"
                      ref={videoRef}
                      src={previewUrl}
                    />
                  </MonitorStageFrame>
                </div>
              ) : stageMode === 'rendered' ? (
                <RenderedPreviewStatusPanel
                  errorMessage={errorMessage}
                  renderStatusMessage={renderStatusMessage}
                  state={renderedPreviewPlaceholderState}
                />
              ) : (
                <div className="min-h-0 flex-1" data-program-stage-shell>
                  <ProgramStage
                    activeTool={activeTool}
                    aspectRatioValue={getAspectRatioValue(aspectRatio)}
                    canvas={canvas}
                    onOpenContextMenu={onOpenContextMenu}
                    onOpenClipContextMenu={onOpenClipContextMenu}
                    onSelectClip={onSelectClip}
                    onSelectStageObject={onSelectStageObject}
                    onUpdateClip={onUpdateClip}
                    onUpdateStageObject={onUpdateStageObject}
                    selectedClip={selectedClip}
                    selectedStageObject={selectedStageObject}
                    stageClips={stageClips}
                    stageObjects={stageObjects}
                    transportRate={transportRate}
                  />
                </div>
              )}
            </div>
          )}

          {isRunning && showFloatingRenderOverlay ? (
            <div className="pointer-events-none absolute inset-2.5 z-30 flex items-start justify-end">
              <div className="min-w-64 rounded-lg border border-amber-400/40 bg-[#120f08]/92 px-3 py-2 text-amber-50 shadow-[0_0_28px_rgba(251,191,36,0.18)] backdrop-blur">
                <div className="flex items-center gap-2">
                  <div className="flex items-end gap-1">
                    <span className="h-2 w-1 animate-pulse rounded-full bg-amber-300 [animation-delay:0ms]" />
                    <span className="h-3 w-1 animate-pulse rounded-full bg-amber-200 [animation-delay:120ms]" />
                    <span className="h-4 w-1 animate-pulse rounded-full bg-amber-100 [animation-delay:240ms]" />
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100/90">
                    Render In Progress
                  </div>
                </div>
                <div className="mt-1 text-xs text-amber-50/85">
                  {renderStatusMessage ?? 'Sloom Studio is rendering the current composition.'}
                </div>
              </div>
            </div>
          ) : null}
          {!isRunning && errorMessage && showFloatingRenderOverlay ? (
            <div className="pointer-events-none absolute inset-2.5 z-30 flex items-start justify-end">
              <div className="max-w-md rounded-lg border border-red-400/45 bg-[#1b0d0f]/92 px-3 py-2 text-red-50 shadow-[0_0_28px_rgba(248,113,113,0.18)] backdrop-blur">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-100/90">
                  Render Failed
                </div>
                <div className="mt-1 text-xs leading-5 text-red-50/85">{errorMessage}</div>
              </div>
            </div>
          ) : null}
        </div>

        {/* CONTROLS & INFO SIDEBAR */}
        {hasActiveComposition && isSidebarOpen && (
          <div className="w-[300px] shrink-0 border-l border-gray-700/60 bg-[#0d1017] flex flex-col min-h-0 overflow-y-auto p-4 gap-4 scrollbar-thin">
            <div>
              <div className="text-[12px] font-bold text-gray-100 uppercase tracking-wider">Sequence Info</div>
              <div className="mt-1 text-[11px] text-gray-400 leading-normal">
                Configure properties and monitor export specs of the active composition.
              </div>
            </div>

            {/* Tab strip: grouped tool sets (owner request — motion comics live under Tools) */}
            <div className="flex gap-1 rounded-lg border border-gray-800 bg-[#0a0d13] p-1" role="tablist">
              {([
                ['tools', 'Tools'],
                ['info', 'Info'],
                ['output', 'Output'],
              ] as const).map(([tabId, label]) => (
                <button
                  key={tabId}
                  aria-selected={sidebarTab === tabId}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                    sidebarTab === tabId
                      ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/30'
                      : 'border border-transparent text-gray-500 hover:text-gray-200'
                  }`}
                  data-video-sidebar-tab={tabId}
                  onClick={() => setSidebarTab(tabId)}
                  role="tab"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Spec Row Grid */}
            {sidebarTab === 'info' && (
            <div className="rounded-lg border border-gray-800 bg-[#12161f]/50 p-3 flex flex-col gap-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Composition Specs</div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center text-[11px] text-gray-400">
                  <span>Canvas:</span>
                  <span className="font-semibold text-gray-200">{sequenceSummary.frameShapeLabel} · {sequenceSummary.sizeLabel}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-gray-400">
                  <span>Timebase:</span>
                  <span className="font-semibold text-gray-200">{sequenceSummary.frameRateLabel}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-gray-400">
                  <span>Length:</span>
                  <span className="font-semibold text-gray-200">{sequenceSummary.durationLabel}</span>
                </div>
                <div className="flex justify-between items-center text-[11px] text-gray-400">
                  <span>Tracks:</span>
                  <span className="font-semibold text-gray-200">V:{visualClipCount} · A:{audioClipCount}</span>
                </div>
              </div>
            </div>
            )}

            {sidebarTab === 'info' ? (
              <DecodedFrameScopesPanel
                key={buildDecodedFrameScopesPanelKey({
                  isImageSequenceOutput,
                  isRenderedPreview: stageMode === 'rendered',
                  previewIdentity: previewUrl,
                })}
                hasPlayablePreview={Boolean(previewUrl)}
                isImageSequenceOutput={isImageSequenceOutput}
                isRenderedPreview={stageMode === 'rendered'}
                videoRef={videoRef}
              />
            ) : null}

            {/* PROGRAM TOOLS (MOVED TO SIDEBAR) */}
            {sidebarTab === 'tools' && stageMode !== 'stage' && (
              <div className="rounded-lg border border-gray-800 bg-[#12161f]/50 p-3 text-[11px] leading-relaxed text-gray-400">
                Switch the Program Monitor to <span className="font-semibold text-gray-200">Stage</span> mode to
                add and edit text, shapes, and motion-comic bubbles or captions.
              </div>
            )}
            {sidebarTab === 'tools' && stageMode === 'stage' && (
              <div className="rounded-lg border border-cyan-500/20 bg-[#101520] p-3 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-gray-800 pb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-400">Program Tools</div>
                  {selectedClip && <div className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-medium text-blue-300">Clip Selected</div>}
                  {selectedStageObject && <div className="rounded bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-medium text-purple-300">Object Selected</div>}
                  {!selectedClip && !selectedStageObject && <div className="text-[9px] font-medium text-gray-500">No Selection</div>}
                </div>

                {/* Add Elements Section */}
                <div className="flex flex-col gap-1.5">
                  <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Add Elements</div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2.5 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
                      onClick={() => onAddEditorAsset('text')}
                      type="button"
                    >
                      <Type size={12} />
                      Text
                    </button>
                    <button
                      className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2.5 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
                      onClick={() => onAddEditorAsset('shape')}
                      type="button"
                    >
                      <Square size={12} />
                      Rect
                    </button>
                  </div>
                  <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Motion Comic</div>
                  <div className="flex gap-2">
                    <button
                      className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-cyan-400/60 hover:text-white transition-colors"
                      onClick={() => onAddComicStageObject('speech-bubble')}
                      title="Add a speech bubble to the program stage"
                      type="button"
                    >
                      💬 Speech
                    </button>
                    <button
                      className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-cyan-400/60 hover:text-white transition-colors"
                      onClick={() => onAddComicStageObject('thought-bubble')}
                      title="Add a thought bubble to the program stage"
                      type="button"
                    >
                      ☁ Thought
                    </button>
                    <button
                      className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-cyan-400/60 hover:text-white transition-colors"
                      onClick={() => onAddComicStageObject('caption')}
                      title="Add a caption box to the program stage"
                      type="button"
                    >
                      ▭ Caption
                    </button>
                  </div>
                </div>

                {/* Selected Clip Tools */}
                {selectedClip && (
                  <div className="flex flex-col gap-3 border-t border-gray-800 pt-2.5">
                    <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Clip Fit & Align</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                          (selectedKeyframeState?.fitMode ?? selectedClip.fitMode) === 'contain'
                            ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                            : 'border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white'
                        }`}
                        onClick={() => adjustSelectedClip({ fitMode: 'contain' })}
                        type="button"
                      >
                        Contain
                      </button>
                      <button
                        className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                          (selectedKeyframeState?.fitMode ?? selectedClip.fitMode) === 'cover'
                            ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                            : 'border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white'
                        }`}
                        onClick={() => adjustSelectedClip({ fitMode: 'cover' })}
                        type="button"
                      >
                        Cover
                      </button>
                      <button
                        className={`px-2 py-1 text-[11px] font-semibold rounded border transition-colors ${
                          (selectedKeyframeState?.fitMode ?? selectedClip.fitMode) === 'stretch'
                            ? 'border-blue-400/50 bg-blue-500/20 text-blue-100'
                            : 'border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white'
                        }`}
                        onClick={() => adjustSelectedClip({ fitMode: 'stretch' })}
                        type="button"
                      >
                        Stretch
                      </button>
                      <button
                        className="px-2 py-1 text-[11px] font-semibold rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ positionX: 0, positionY: 0 })}
                        type="button"
                      >
                        Center
                      </button>
                    </div>

                    <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Clip Transform</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ scalePercent: Math.max(10, (selectedKeyframeState?.scalePercent ?? selectedClip.scalePercent) - 10) })}
                        type="button"
                      >
                        Scale -10%
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ scalePercent: Math.min(500, (selectedKeyframeState?.scalePercent ?? selectedClip.scalePercent) + 10) })}
                        type="button"
                      >
                        Scale +10%
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ rotationDeg: (selectedKeyframeState?.rotationDeg ?? selectedClip.rotationDeg) - 15 })}
                        type="button"
                      >
                        Rotate -15°
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ rotationDeg: (selectedKeyframeState?.rotationDeg ?? selectedClip.rotationDeg) + 15 })}
                        type="button"
                      >
                        Rotate +15°
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ opacityPercent: Math.max(0, (selectedKeyframeState?.opacityPercent ?? selectedClip.opacityPercent) - 10) })}
                        type="button"
                      >
                        Opacity -10%
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedClip({ opacityPercent: Math.min(100, (selectedKeyframeState?.opacityPercent ?? selectedClip.opacityPercent) + 10) })}
                        type="button"
                      >
                        Opacity +10%
                      </button>
                    </div>

                    <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Clip Position Nudge</div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedClip(-32, 0)}
                        type="button"
                        title="Nudge Left"
                      >
                        <ChevronLeft size={14} />
                        Left
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedClip(32, 0)}
                        type="button"
                        title="Nudge Right"
                      >
                        <ChevronRight size={14} />
                        Right
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedClip(0, -32)}
                        type="button"
                        title="Nudge Up"
                      >
                        <ChevronUp size={14} />
                        Up
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedClip(0, 32)}
                        type="button"
                        title="Nudge Down"
                      >
                        <ChevronDown size={14} />
                        Down
                      </button>
                    </div>

                    <button
                      className="mt-1 w-full px-2.5 py-1.5 text-[11px] font-semibold rounded border border-gray-700/60 bg-[#1b1c24]/80 hover:bg-gray-800 text-gray-300 hover:text-white transition-colors"
                      onClick={() =>
                        onUpdateClip(selectedClip.id, ensureVisualClipHasKeyframes({
                          ...selectedClip,
                          fitMode: 'contain',
                          scalePercent: 100,
                          endScalePercent: 100,
                          scaleMotionEnabled: false,
                          positionX: 0,
                          positionY: 0,
                          endPositionX: 0,
                          endPositionY: 0,
                          motionEnabled: false,
                          rotationDeg: 0,
                          rotationMotionEnabled: false,
                          endRotationDeg: 0,
                          opacityPercent: 100,
                          opacityAutomationPoints: undefined,
                          keyframes: undefined,
                          flipHorizontal: false,
                          flipVertical: false,
                        }))
                      }
                      type="button"
                    >
                      Reset Clip Properties
                    </button>
                  </div>
                )}

                {/* Selected Stage Object Tools */}
                {selectedStageObject && (
                  <div className="flex flex-col gap-3 border-t border-gray-800 pt-2.5">
                    <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Object Transform</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedStageObject({ rotationDeg: selectedStageObject.rotationDeg - 15 })}
                        type="button"
                      >
                        Rotate -15°
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedStageObject({ rotationDeg: selectedStageObject.rotationDeg + 15 })}
                        type="button"
                      >
                        Rotate +15°
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedStageObject({ opacityPercent: Math.max(0, selectedStageObject.opacityPercent - 10) })}
                        type="button"
                      >
                        Opacity -10%
                      </button>
                      <button
                        className="px-2 py-1.5 text-[11px] font-medium rounded border border-gray-700/60 bg-[#131722] text-gray-200 hover:border-gray-500 hover:text-white transition-colors"
                        onClick={() => adjustSelectedStageObject({ opacityPercent: Math.min(100, selectedStageObject.opacityPercent + 10) })}
                        type="button"
                      >
                        Opacity +10%
                      </button>
                    </div>

                    <div className={PROGRAM_TOOLS_SECTION_LABEL_CLASS}>Object Position Nudge</div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedStageObject(-32, 0)}
                        type="button"
                        title="Object Nudge Left"
                      >
                        <ChevronLeft size={14} />
                        Left
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedStageObject(32, 0)}
                        type="button"
                        title="Object Nudge Right"
                      >
                        <ChevronRight size={14} />
                        Right
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedStageObject(0, -32)}
                        type="button"
                        title="Object Nudge Up"
                      >
                        <ChevronUp size={14} />
                        Up
                      </button>
                      <button
                        className="flex-1 rounded-lg border border-gray-700/60 bg-[#131722] px-2 py-1.5 text-xs font-semibold text-gray-200 hover:border-gray-500 hover:text-white flex items-center justify-center gap-1 transition-colors"
                        onClick={() => nudgeSelectedStageObject(0, 32)}
                        type="button"
                        title="Object Nudge Down"
                      >
                        <ChevronDown size={14} />
                        Down
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Section: Quick Controls */}
            {sidebarTab === 'output' && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Settings</div>
              <ProgramMonitorQuickControls
                aspectRatio={aspectRatio}
                exportPresetPlan={exportPresetPlan}
                frameRate={frameRate}
                hasCaptionCues={hasCaptionCues}
                onAspectRatioChange={onAspectRatioChange}
                onExportCaptions={onExportCaptions}
                onExportPresetPlanChange={onExportPresetPlanChange}
                onRenderBackendPreferenceChange={onRenderBackendPreferenceChange}
                onFrameRateChange={onFrameRateChange}
                onResolutionChange={onResolutionChange}
                parityDiagnostics={parityDiagnostics}
                renderBackendPreference={renderBackendPreference}
                videoResolution={videoResolution}
              />
              {onExportFcpXml ? (
                <button
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                  data-video-export-fcpxml="true"
                  onClick={onExportFcpXml}
                  title="Export the sequence as FCP7 XML — Premiere imports it via File > Import"
                  type="button"
                >
                  Export Premiere XML (FCP7)
                </button>
              ) : null}
            </div>
            )}

            {/* Section: Status */}
            {sidebarTab === 'info' && (
            <div className="flex flex-col gap-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Status</div>
              <div className="flex flex-col gap-2">
                <VideoExportReadinessPill summary={exportReadiness} />
                <VideoRenderBackendPill summary={renderBackendStatus} />
              </div>

              {incrementalRenderSummary && (
                <div className="mt-1 p-2 rounded border border-amber-500/20 bg-amber-500/5 text-[11px] text-amber-200/90 leading-normal">
                  <span className="font-semibold text-amber-300">Render cache:</span> {incrementalRenderSummary}
                </div>
              )}
            </div>
            )}

            {/* Section: Cache Manifest Details */}
            {sidebarTab === 'info' && renderCacheDetailLines.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Cache Manifest Details</div>
                <div
                  className="flex flex-col gap-1 rounded-md border border-cyan-300/20 bg-cyan-500/10 px-2.5 py-2 text-[11px] leading-4 text-cyan-50/90"
                  data-video-render-cache-details="true"
                >
                  {renderCacheDetailLines.slice(0, 4).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                  {renderCacheDetailLines.length > 4 ? (
                    <div className="text-cyan-100/65">
                      {renderCacheDetailLines.length - 4} more span{renderCacheDetailLines.length - 4 === 1 ? '' : 's'} in this render plan.
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Section: Bottom Actions */}
            <div className="mt-auto flex flex-col gap-2 pt-2 border-t border-gray-800">
              {previewUrl && (
                <button
                  className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                  onClick={() => void handleSaveVideo()}
                  type="button"
                >
                  <Archive size={12} />
                  {isImageSequenceOutput ? 'Save ZIP' : 'Save Video'}
                </button>
              )}
              <button
                className={`w-full inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors ${
                  isRunning
                    ? 'bg-amber-400 text-black shadow-[0_0_18px_rgba(251,191,36,0.35)]'
                    : renderBlockedReason
                      ? 'cursor-not-allowed bg-gray-700 text-gray-400'
                    : 'bg-white text-black hover:bg-gray-200'
                }`}
                data-video-render-button="true"
                disabled={Boolean(renderBlockedReason)}
                onClick={onRun}
                title={renderBlockedReason}
                type="button"
              >
                <Play size={12} fill="currentColor" />
                {isRunning ? 'Rendering…' : 'Render'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function getImageSequenceFrameCount(metadata: Record<string, unknown> | undefined): number | undefined {
  if (!metadata || metadata.imageSequence !== true) {
    return undefined;
  }

  return typeof metadata.frameCount === 'number' && Number.isFinite(metadata.frameCount)
    ? metadata.frameCount
    : undefined;
}

type RenderedPreviewDescriptorStatus = 'idle' | 'rendering' | 'completed' | 'failed' | 'unsupported';

interface RenderedPreviewDescriptor {
  status: RenderedPreviewDescriptorStatus;
  title: string;
  detail: string;
  metadata: string[];
}

function buildRenderedPreviewDescriptor({
  previewUrl,
  previewOutputMetadata,
  isRunning,
  renderStatusMessage,
  errorMessage,
  isImageSequenceOutput,
}: {
  previewUrl?: string;
  previewOutputMetadata?: Record<string, unknown>;
  isRunning?: boolean;
  renderStatusMessage?: string;
  errorMessage?: string;
  isImageSequenceOutput: boolean;
}): RenderedPreviewDescriptor {
  const fileName = getPreviewMetadataString(previewOutputMetadata, ['fileName', 'outputFileName', 'name', 'label']);
  const mimeType = getPreviewMetadataString(previewOutputMetadata, ['mimeType', 'outputMimeType']);
  const frameCount = getPreviewMetadataNumber(previewOutputMetadata, ['frameCount']);
  const previewSupportLabel = getBrowserPreviewSupportLabel(fileName, mimeType);
  const metadata: string[] = [];

  if (fileName) {
    metadata.push(fileName);
  }
  if (mimeType) {
    metadata.push(mimeType);
  }
  if (typeof frameCount === 'number') {
    metadata.push(`${frameCount} frame${frameCount === 1 ? '' : 's'}`);
  }
  if (previewUrl?.startsWith('blob:')) {
    metadata.push('Blob URL ready');
  }

  if (isRunning) {
    return {
      status: 'rendering',
      title: 'Rendering preview',
      detail: renderStatusMessage?.trim() || 'Sloom Studio is rendering the current composition.',
      metadata,
    };
  }

  if (errorMessage?.trim()) {
    return {
      status: 'failed',
      title: 'Render failed',
      detail: errorMessage.trim(),
      metadata,
    };
  }

  if (previewUrl) {
    return {
      status: 'completed',
      title: isImageSequenceOutput ? 'Render complete' : 'Preview ready',
      detail: isImageSequenceOutput
        ? (renderStatusMessage?.trim() || 'Rendered output is available as an image-sequence archive.')
        : (renderStatusMessage?.trim() || 'Playable rendered preview is ready in the Program Monitor.'),
      metadata,
    };
  }

  if (renderStatusMessage?.trim() || previewOutputMetadata) {
    return {
      status: 'unsupported',
      title: 'Preview unavailable',
      detail: renderStatusMessage?.trim()
        || previewSupportLabel
        || 'The last render completed without a browser-playable preview asset.',
      metadata: previewSupportLabel ? [...metadata, previewSupportLabel] : metadata,
    };
  }

  return {
    status: 'idle',
    title: 'Ready to render',
    detail: 'Run Render to build a playable Program Monitor preview for this composition.',
    metadata,
  };
}

function getPreviewMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function getPreviewMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!metadata) {
    return undefined;
  }

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return undefined;
}

function VideoPremiereParityPanel() {
  const highPriorityRows = getHighPriorityVideoParityRows();
  const rows = VIDEO_PREMIERE_PARITY_ROWS;

  return (
    <div className="border-b border-gray-700/60 bg-[#0f131b]/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200/90">
            Export Readiness
          </div>
          <div className="mt-0.5 text-[11px] text-gray-500">Prioritized for Flow/Image/Paper-generated media.</div>
        </div>
        <div className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100">
          {highPriorityRows.length} high
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {rows.map((row) => (
          <div className="rounded-lg border border-gray-700/60 bg-[#111217]/65 p-2" key={row.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-gray-100">{row.area}</div>
              <div className="flex items-center gap-1">
                <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${videoParityStatusClassName(row.status)}`}>
                  {row.status}
                </span>
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100">
                  {row.priority}
                </span>
              </div>
            </div>
            <div className="mt-1 grid gap-1 text-[10px] leading-4 text-gray-400 md:grid-cols-2">
              <div><span className="text-gray-500">Premiere:</span> {row.premiere}</div>
              <div><span className="text-gray-500">Sloom Studio:</span> {row.signalLoom}</div>
            </div>
            <div className="mt-1 text-[10px] leading-4 text-cyan-100/85">{row.workflowImpact}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function videoParityStatusClassName(status: 'done' | 'partial' | 'gap'): string {
  switch (status) {
    case 'done':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
    case 'partial':
      return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
    case 'gap':
      return 'border-red-400/30 bg-red-500/10 text-red-100';
  }
}

function RenderedPreviewStatusPanel({
  state,
  renderStatusMessage,
  errorMessage,
}: {
  state: 'waiting' | 'error' | 'empty' | 'idle';
  renderStatusMessage?: string;
  errorMessage?: string;
}) {
  const title = state === 'waiting'
    ? 'Rendering preview'
    : state === 'error'
      ? 'Rendered preview unavailable'
      : state === 'empty'
        ? 'Rendered preview unavailable'
        : 'No rendered preview yet';
  const detail = state === 'waiting'
    ? (renderStatusMessage?.trim() || 'Sloom Studio is rendering the current composition.')
    : state === 'error'
      ? (errorMessage?.trim() || 'The last render did not produce a playable preview asset.')
      : state === 'empty'
        ? (renderStatusMessage?.trim() || 'The last render completed without a playable preview asset.')
        : 'Run Render to build a playable Program Monitor preview for this composition.';
  const toneClassName = state === 'error'
    ? 'border-red-400/30 bg-red-500/10 text-red-50'
    : state === 'waiting'
      ? 'border-amber-300/30 bg-amber-500/10 text-amber-50'
      : 'border-gray-700/60 bg-[#0f131b] text-gray-100';
  const iconClassName = state === 'error'
    ? 'border-red-300/30 bg-red-500/15 text-red-100'
    : state === 'waiting'
      ? 'border-amber-300/30 bg-amber-500/15 text-amber-100'
      : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';

  return (
    <div className="flex h-full min-h-0 items-center justify-center" data-video-rendered-preview-state={state}>
      <div className={`max-w-md rounded-2xl border p-5 text-center shadow-2xl shadow-black/30 ${toneClassName}`}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border ${iconClassName}`}>
          <Film size={20} />
        </div>
        <div className="mt-3 text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs leading-5 opacity-85">{detail}</div>
      </div>
    </div>
  );
}

function RenderedPreviewDescriptorStrip({ descriptor }: { descriptor: RenderedPreviewDescriptor }) {
  const statusClassName = descriptor.status === 'completed'
    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-50'
    : descriptor.status === 'rendering'
      ? 'border-amber-300/30 bg-amber-500/10 text-amber-50'
      : descriptor.status === 'failed'
        ? 'border-red-400/30 bg-red-500/10 text-red-50'
        : descriptor.status === 'unsupported'
          ? 'border-purple-300/30 bg-purple-500/10 text-purple-50'
          : 'border-gray-700/60 bg-[#0f131b] text-gray-100';
  const badgeClassName = descriptor.status === 'completed'
    ? 'border-emerald-300/30 bg-emerald-500/15 text-emerald-100'
    : descriptor.status === 'rendering'
      ? 'border-amber-300/30 bg-amber-500/15 text-amber-100'
      : descriptor.status === 'failed'
        ? 'border-red-300/30 bg-red-500/15 text-red-100'
        : descriptor.status === 'unsupported'
          ? 'border-purple-300/30 bg-purple-500/15 text-purple-100'
          : 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';

  return (
    <div
      className={`mb-2 shrink-0 rounded-lg border px-3 py-2 ${statusClassName}`}
      data-video-render-preview-status={descriptor.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-85">
            {descriptor.title}
          </div>
          <div className="mt-1 text-xs leading-5 opacity-90">{descriptor.detail}</div>
        </div>
        <div className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeClassName}`}>
          {descriptor.status}
        </div>
      </div>
      {descriptor.metadata.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {descriptor.metadata.map((item) => (
            <span
              className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[10px] leading-4 opacity-90"
              key={item}
            >
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProgramMonitorQuickControls({
  aspectRatio,
  videoResolution,
  frameRate,
  exportPresetPlan,
  hasCaptionCues,
  parityDiagnostics,
  onAspectRatioChange,
  onResolutionChange,
  onFrameRateChange,
  onExportCaptions,
  onExportPresetPlanChange,
  onRenderBackendPreferenceChange,
  renderBackendPreference,
}: {
  aspectRatio: AspectRatio;
  videoResolution: VideoResolution;
  frameRate: number;
  exportPresetPlan: VideoExportPresetPlanData;
  hasCaptionCues: boolean;
  parityDiagnostics: ReturnType<typeof buildVideoParityDiagnostics>;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  onResolutionChange: (videoResolution: VideoResolution) => void;
  onFrameRateChange: (frameRate: number) => void;
  onExportCaptions: (format: 'srt' | 'vtt') => void;
  onExportPresetPlanChange: (presetId: VideoExportPresetPlanId) => void;
  onRenderBackendPreferenceChange: (preference: RenderBackendPreference) => void;
  renderBackendPreference: RenderBackendPreference;
}) {
  const selectedPreset = getVideoExportPresetOption(exportPresetPlan.presetId);
  const attentionCount = parityDiagnostics.filter((diagnostic) => diagnostic.severity === 'attention').length;

  return (
    <div className="flex flex-col w-full gap-3 rounded-lg border border-gray-800 bg-[#0f131b]/40 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1 text-[10px] text-gray-500">
          <span>Frame</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onAspectRatioChange(event.target.value as AspectRatio)}
            value={aspectRatio}
          >
            <option value="16:9">Landscape</option>
            <option value="9:16">Vertical</option>
            <option value="1:1">Square</option>
          </select>
        </label>
        <label className="block space-y-1 text-[10px] text-gray-500">
          <span>Size</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onResolutionChange(event.target.value as VideoResolution)}
            value={videoResolution}
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4k">4k</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1 text-[10px] text-gray-500">
          <span>FPS</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onFrameRateChange(Number(event.target.value))}
            value={frameRate}
          >
            <option value={24}>24</option>
            <option value={25}>25</option>
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>

        <div className="block space-y-1 text-[10px] text-gray-500">
          <span>Verify Diagnostics</span>
          <details className="relative w-full">
            <summary className="cursor-pointer list-none rounded-md border border-amber-300/25 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold text-amber-100 text-center">
              {attentionCount > 0 ? `${attentionCount} Attention` : 'All Pass'}
            </summary>
            <div className="absolute right-0 top-7 z-50 max-h-52 w-64 overflow-y-auto rounded-lg border border-amber-300/25 bg-[#111217] p-2 shadow-xl">
              {parityDiagnostics.map((diagnostic) => (
                <div
                  className={`mb-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-4 ${
                    diagnostic.severity === 'attention'
                      ? 'border-amber-300/25 bg-amber-950/35 text-amber-50/90'
                      : 'border-emerald-300/25 bg-emerald-950/25 text-emerald-50/90'
                  }`}
                  key={diagnostic.id}
                >
                  <div className="font-semibold">{diagnostic.title}</div>
                  <div className="mt-0.5 opacity-85">{diagnostic.detail}</div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>

      <label className="block w-full space-y-1 text-[10px] text-purple-100/70">
        <span>Export Codec & Profile</span>
        <select
          className="w-full rounded-md border border-purple-300/25 bg-[#111217] px-2 py-1 text-[11px] font-medium text-gray-100 outline-none"
          onChange={(event) => onExportPresetPlanChange(event.target.value as VideoExportPresetPlanId)}
          value={exportPresetPlan.presetId}
        >
          {VIDEO_EXPORT_PRESET_OPTIONS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}{preset.capabilities.browser ? '' : ' (native required)'}
            </option>
          ))}
        </select>
      </label>

      <label className="block w-full space-y-1 text-[10px] text-cyan-100/70">
        <span>Render target (capability probe)</span>
        <select
          aria-label="Render target"
          className="w-full rounded-md border border-cyan-300/25 bg-[#111217] px-2 py-1 text-[11px] font-medium text-gray-100 outline-none"
          onChange={(event) => onRenderBackendPreferenceChange(event.target.value as RenderBackendPreference)}
          value={renderBackendPreference}
        >
          <option value="auto">Auto · detected hardware → CPU → browser</option>
          <option value="browser">Browser FFmpeg · software</option>
          <option value="native-cpu">Native CPU · software</option>
          <option value="native-amd-vaapi">AMD VAAPI · probe required</option>
          <option value="native-nvidia-nvenc">NVIDIA NVENC · probe required</option>
          <option value="native-intel-qsv">Intel Quick Sync · probe required</option>
        </select>
      </label>

      <div className="text-[10px] leading-4 text-cyan-50/75">
        {selectedPreset.preservesAlpha
          ? 'Alpha-capable: browser or native CPU VP9 preserves transparency; hardware H.264 paths refuse before render.'
          : 'Opaque output: hardware choices are used only after the local renderer proves the selected encoder.'}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-gray-800/60 pt-2">
        <span className="text-[10px] text-gray-500">Export Captions:</span>
        <div className="flex gap-1.5">
          <button
            className="rounded-md border border-purple-300/25 bg-[#111217] px-2 py-0.5 text-[10px] font-semibold text-purple-50 disabled:cursor-not-allowed disabled:opacity-45 hover:border-purple-300/40"
            disabled={!hasCaptionCues}
            onClick={() => onExportCaptions('srt')}
            type="button"
          >
            SRT
          </button>
          <button
            className="rounded-md border border-purple-300/25 bg-[#111217] px-2 py-0.5 text-[10px] font-semibold text-purple-50 disabled:cursor-not-allowed disabled:opacity-45 hover:border-purple-300/40"
            disabled={!hasCaptionCues}
            onClick={() => onExportCaptions('vtt')}
            type="button"
          >
            VTT
          </button>
        </div>
      </div>

      <div className="truncate text-[9px] text-gray-500 leading-tight">
        {selectedPreset.container} · .{selectedPreset.extension} · {selectedPreset.codec}
      </div>
    </div>
  );
}

function SequenceSettingsPanel({
  aspectRatio,
  videoResolution,
  frameRate,
  sequenceSummary,
  onAspectRatioChange,
  onResolutionChange,
  onFrameRateChange,
}: {
  aspectRatio: AspectRatio;
  videoResolution: VideoResolution;
  frameRate: number;
  sequenceSummary: ReturnType<typeof buildVideoSequenceSummary>;
  onAspectRatioChange: (aspectRatio: AspectRatio) => void;
  onResolutionChange: (videoResolution: VideoResolution) => void;
  onFrameRateChange: (frameRate: number) => void;
}) {
  return (
    <div className="rounded-lg border border-gray-700/60 bg-[#0f131b] p-2">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">Sequence Settings</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        <label className="block space-y-1 text-[10px] text-gray-500">
          <span>Frame shape</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1.5 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onAspectRatioChange(event.target.value as AspectRatio)}
            value={aspectRatio}
          >
            <option value="16:9">Landscape 16:9</option>
            <option value="9:16">Vertical 9:16</option>
            <option value="1:1">Square 1:1</option>
          </select>
        </label>
        <label className="block space-y-1 text-[10px] text-gray-500">
          <span>Frame size</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1.5 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onResolutionChange(event.target.value as VideoResolution)}
            value={videoResolution}
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
            <option value="4k">4k</option>
          </select>
        </label>
        <label className="block space-y-1 text-[10px] text-gray-500 sm:col-span-2">
          <span>Frame rate</span>
          <select
            className="w-full rounded-md border border-gray-700/60 bg-[#111217] px-2 py-1.5 text-[11px] font-medium text-gray-200 outline-none"
            onChange={(event) => onFrameRateChange(Number(event.target.value))}
            value={frameRate}
          >
            <option value={23.976}>23.976 fps</option>
            <option value={24}>24 fps</option>
            <option value={25}>25 fps</option>
            <option value={29.97}>29.97 fps</option>
            <option value={30}>30 fps</option>
            <option value={50}>50 fps</option>
            <option value={59.94}>59.94 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
      </div>
      <div className="mt-1.5 text-[10px] leading-4 text-gray-400">
        {sequenceSummary.sizeLabel} · {sequenceSummary.frameRateLabel} · {sequenceSummary.durationLabel}
      </div>
    </div>
  );
}

function ExportPresetPanel({
  exportPresetPlan,
  onRenderBackendPreferenceChange,
  renderBackendPreference,
  hasCaptionCues,
  onExportCaptions,
  onExportPresetPlanChange,
}: {
  exportPresetPlan: VideoExportPresetPlanData;
  onRenderBackendPreferenceChange: (preference: RenderBackendPreference) => void;
  renderBackendPreference: RenderBackendPreference;
  hasCaptionCues: boolean;
  onExportCaptions: (format: 'srt' | 'vtt') => void;
  onExportPresetPlanChange: (presetId: VideoExportPresetPlanId) => void;
}) {
  const selectedPreset = getVideoExportPresetOption(exportPresetPlan.presetId);

  return (
    <div className="rounded-lg border border-purple-400/25 bg-purple-500/10 p-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-100">Export Preset</div>
        <span className="rounded-full border border-purple-300/30 bg-purple-200/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-purple-100">
          {selectedPreset.capabilities.browser
            ? (renderBackendPreference === 'auto' ? 'Browser active' : renderBackendPreference.replace('native-', ''))
            : 'Native required'}
        </span>
      </div>
      <label className="block space-y-1 text-[10px] text-purple-100/70">
        <span>Delivery preset</span>
        <select
          className="w-full rounded-md border border-purple-300/25 bg-[#111217] px-2 py-1.5 text-[11px] font-medium text-gray-100 outline-none"
          onChange={(event) => onExportPresetPlanChange(event.target.value as VideoExportPresetPlanId)}
          value={exportPresetPlan.presetId}
        >
          {VIDEO_EXPORT_PRESET_OPTIONS.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}{preset.capabilities.browser ? '' : ' (native required)'}</option>
          ))}
        </select>
      </label>
      <label className="mt-2 block space-y-1 text-[10px] text-cyan-100/70">
        <span>Render target (capability probe)</span>
        <select
          aria-label="Export render target"
          className="w-full rounded-md border border-cyan-300/25 bg-[#111217] px-2 py-1.5 text-[11px] font-medium text-gray-100 outline-none"
          onChange={(event) => onRenderBackendPreferenceChange(event.target.value as RenderBackendPreference)}
          value={renderBackendPreference}
        >
          <option value="auto">Auto · detected hardware → CPU → browser</option>
          <option value="browser">Browser FFmpeg · software</option>
          <option value="native-cpu">Native CPU · software</option>
          <option value="native-amd-vaapi">AMD VAAPI · probe required</option>
          <option value="native-nvidia-nvenc">NVIDIA NVENC · probe required</option>
          <option value="native-intel-qsv">Intel Quick Sync · probe required</option>
        </select>
      </label>
      <div className="mt-1.5 text-[10px] leading-4 text-purple-50/80">
        {selectedPreset.container} .{selectedPreset.extension} · {selectedPreset.codec}
        {selectedPreset.crf ? ` · CRF ${selectedPreset.crf}` : ''}
        {selectedPreset.bitrate ? ` · ${selectedPreset.bitrate}` : ''}. {selectedPreset.caveat}
      </div>
      <div className="mt-1.5 text-[10px] leading-4 text-cyan-50/75">
        {selectedPreset.preservesAlpha
          ? 'Alpha is preserved in browser/native CPU VP9; selected hardware targets refuse rather than dropping transparency.'
          : 'Hardware execution remains capability-probed and falls back only when the selected policy allows it.'}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          className="rounded-md border border-purple-300/25 bg-[#111217] px-2 py-1 text-[10px] font-semibold text-purple-50 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!hasCaptionCues}
          onClick={() => onExportCaptions('srt')}
          type="button"
        >
          Export SRT
        </button>
        <button
          className="rounded-md border border-purple-300/25 bg-[#111217] px-2 py-1 text-[10px] font-semibold text-purple-50 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!hasCaptionCues}
          onClick={() => onExportCaptions('vtt')}
          type="button"
        >
          Export VTT
        </button>
      </div>
    </div>
  );
}

function ParityDiagnosticsPanel({
  diagnostics,
}: {
  diagnostics: ReturnType<typeof buildVideoParityDiagnostics>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const attentionCount = diagnostics.filter((diagnostic) => diagnostic.severity === 'attention').length;

  return (
    <div className="rounded-lg border border-amber-400/25 bg-amber-500/10 p-2">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setIsOpen((value) => !value)}
        type="button"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">Export Verification</span>
        <span className="rounded-full border border-amber-300/30 bg-amber-200/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-100">
          {attentionCount > 0 ? `${attentionCount} attention` : 'Pass'}
        </span>
      </button>
      {isOpen ? (
        <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
          {diagnostics.map((diagnostic) => (
            <div
              className={`rounded-md border px-2 py-1.5 text-[10px] leading-4 ${
                diagnostic.severity === 'attention'
                  ? 'border-amber-300/25 bg-amber-950/35 text-amber-50/90'
                  : 'border-emerald-300/25 bg-emerald-950/25 text-emerald-50/90'
              }`}
              key={diagnostic.id}
            >
              <div className="font-semibold">{diagnostic.title}</div>
              <div className="mt-0.5 opacity-85">{diagnostic.detail}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProgramStage({
  stageClips,
  stageObjects,
  selectedClip,
  selectedStageObject,
  canvas,
  aspectRatioValue,
  activeTool,
  onSelectClip,
  onSelectStageObject,
  onUpdateClip,
  onUpdateStageObject,
  onOpenClipContextMenu,
  onOpenContextMenu,
  transportRate,
}: {
  stageClips: ProgramStageClip[];
  stageObjects: EditorStageObject[];
  selectedClip?: EditorVisualClip;
  selectedStageObject?: EditorStageObject;
  canvas: { width: number; height: number };
  aspectRatioValue: number;
  activeTool: TimelineTool;
  onSelectClip: (clipId: string) => void;
  onSelectStageObject: (objectId: string) => void;
  onUpdateClip: (clipId: string, patch: Partial<EditorVisualClip>) => void;
  onUpdateStageObject: (objectId: string, patch: Partial<EditorStageObject>) => void;
  onOpenClipContextMenu: (clipId: string, event: React.MouseEvent<HTMLElement>) => void;
  onOpenContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  transportRate: number;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageViewportSize, setStageViewportSize] = useState<{ width: number; height: number }>({
    width: canvas.width,
    height: canvas.height,
  });


  const startMoveDrag = (event: React.PointerEvent<HTMLButtonElement>, stageClip: ProgramStageClip) => {
    if (event.button !== 0 || activeTool !== 'select' || !stageRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { clip } = stageClip;
    onSelectClip(clip.id);

    const stageBounds = stageRef.current.getBoundingClientRect();
    const stageScale = stageBounds.width / canvas.width;
    const startX = event.clientX;
    const startY = event.clientY;
    const progressPercent = getStageClipProgress(stageClip) * 100;
    const startState = getVisualKeyframeStateAtProgress(clip, progressPercent);
    const startPositionX = startState.positionX;
    const startPositionY = startState.positionY;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / stageScale;
      const deltaY = (moveEvent.clientY - startY) / stageScale;
      onUpdateClip(clip.id, applyVisualClipPatchAtProgress(clip, progressPercent, {
        positionX: Math.round(startPositionX + deltaX),
        positionY: Math.round(startPositionY + deltaY),
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startScaleDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    stageClip: ProgramStageClip,
    frameElement: HTMLDivElement,
  ) => {
    if (activeTool !== 'select') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { clip } = stageClip;
    onSelectClip(clip.id);

    const frameBounds = frameElement.getBoundingClientRect();
    const centerX = frameBounds.left + frameBounds.width / 2;
    const centerY = frameBounds.top + frameBounds.height / 2;
    const progressPercent = getStageClipProgress(stageClip) * 100;
    const startScale = getVisualKeyframeStateAtProgress(clip, progressPercent).scalePercent;
    const startDistance = Math.max(16, Math.hypot(event.clientX - centerX, event.clientY - centerY));

    const onMove = (moveEvent: PointerEvent) => {
      const nextDistance = Math.max(16, Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY));
      onUpdateClip(clip.id, applyVisualClipPatchAtProgress(clip, progressPercent, {
        scalePercent: Math.max(10, Math.min(500, Math.round(startScale * (nextDistance / startDistance)))),
      }));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startRotationDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    stageClip: ProgramStageClip,
    frameElement: HTMLDivElement,
  ) => {
    if (activeTool !== 'select') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { clip } = stageClip;
    onSelectClip(clip.id);

    const frameBounds = frameElement.getBoundingClientRect();
    const centerX = frameBounds.left + frameBounds.width / 2;
    const centerY = frameBounds.top + frameBounds.height / 2;
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    const progressPercent = getStageClipProgress(stageClip) * 100;
    const startRotation = getVisualKeyframeStateAtProgress(clip, progressPercent).rotationDeg;

    const onMove = (moveEvent: PointerEvent) => {
      const nextAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
      const deltaDegrees = ((nextAngle - startAngle) * 180) / Math.PI;
      onUpdateClip(
        clip.id,
        applyVisualClipPatchAtProgress(clip, progressPercent, { rotationDeg: Math.round(startRotation + deltaDegrees) }),
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /**
   * Drags the comic bubble's TAIL TIP. Writes `comicTailTip{X,Y}Percent` as a KEYFRAME at the
   * current playhead (via applyVisualClipPatchAtProgress, same path as move/scale/rotate), so the
   * tail tip animates independently of the bubble body. The tip percent is derived from the pointer
   * position relative to the clip frame (inverse-rotated when the clip is rotated).
   */
  const startTailTipDrag = (event: React.PointerEvent<HTMLButtonElement>, stageClip: ProgramStageClip) => {
    if (event.button !== 0 || activeTool !== 'select' || !stageRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const { clip } = stageClip;
    onSelectClip(clip.id);

    const stageBounds = stageRef.current.getBoundingClientRect();
    const stageScale = stageBounds.width / canvas.width;
    const layout = getStageClipLayout(stageClip, canvas);
    const centerX = stageBounds.left + (layout.left + layout.width / 2) * stageScale;
    const centerY = stageBounds.top + (layout.top + layout.height / 2) * stageScale;
    const frameWidthPx = Math.max(1, layout.width * stageScale);
    const frameHeightPx = Math.max(1, layout.height * stageScale);
    const rotationRad = (layout.rotationDeg * Math.PI) / 180;
    const cos = Math.cos(-rotationRad);
    const sin = Math.sin(-rotationRad);
    const progressPercent = getStageClipProgress(stageClip) * 100;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - centerX;
      const deltaY = moveEvent.clientY - centerY;
      // Undo the frame rotation so the offset is in the bubble's own (unrotated) frame.
      const localX = deltaX * cos - deltaY * sin;
      const localY = deltaX * sin + deltaY * cos;
      const { tipXPercent, tipYPercent } = comicTailFrameFractionToTipPercent(
        localX / frameWidthPx,
        localY / frameHeightPx,
      );
      onUpdateClip(
        clip.id,
        applyVisualClipPatchAtProgress(clip, progressPercent, {
          comicTailTipXPercent: Math.round(tipXPercent * 10) / 10,
          comicTailTipYPercent: Math.round(tipYPercent * 10) / 10,
        }),
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startStageObjectMoveDrag = (
    event: React.PointerEvent<HTMLElement>,
    object: EditorStageObject,
  ) => {
    if (event.button !== 0 || activeTool !== 'select' || !stageRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectStageObject(object.id);

    const stageBounds = stageRef.current.getBoundingClientRect();
    const stageScale = stageBounds.width / canvas.width;
    const startX = event.clientX;
    const startY = event.clientY;
    const startObjectX = object.x;
    const startObjectY = object.y;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaX = (moveEvent.clientX - startX) / stageScale;
      const deltaY = (moveEvent.clientY - startY) / stageScale;
      onUpdateStageObject(object.id, {
        x: Math.round(startObjectX + deltaX),
        y: Math.round(startObjectY + deltaY),
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startStageObjectResizeDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    object: EditorStageObject,
  ) => {
    if (activeTool !== 'select' || !stageRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectStageObject(object.id);

    const stageBounds = stageRef.current.getBoundingClientRect();
    const stageScale = stageBounds.width / canvas.width;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = object.width;
    const startHeight = object.height;

    const onMove = (moveEvent: PointerEvent) => {
      onUpdateStageObject(object.id, {
        width: Math.max(24, Math.round(startWidth + (moveEvent.clientX - startX) / stageScale)),
        height: Math.max(24, Math.round(startHeight + (moveEvent.clientY - startY) / stageScale)),
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startStageObjectRotationDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    object: EditorStageObject,
    frameElement: HTMLDivElement,
  ) => {
    if (activeTool !== 'select') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelectStageObject(object.id);

    const frameBounds = frameElement.getBoundingClientRect();
    const centerX = frameBounds.left + frameBounds.width / 2;
    const centerY = frameBounds.top + frameBounds.height / 2;
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
    const startRotation = object.rotationDeg;

    const onMove = (moveEvent: PointerEvent) => {
      const nextAngle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
      const deltaDegrees = ((nextAngle - startAngle) * 180) / Math.PI;
      onUpdateStageObject(object.id, { rotationDeg: Math.round(startRotation + deltaDegrees) });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const update = () => {
      setStageViewportSize({
        width: Math.max(1, Math.round(stage.clientWidth)),
        height: Math.max(1, Math.round(stage.clientHeight)),
      });
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(stage);

    return () => {
      resizeObserver.disconnect();
    };
  }, [canvas.height, canvas.width]);

  const stageScale = Math.max(
    0.0001,
    Math.min(
      stageViewportSize.width / Math.max(1, canvas.width),
      stageViewportSize.height / Math.max(1, canvas.height),
    ),
  );

  return (
    <div className="h-full min-h-0">
      <MonitorStageFrame aspectRatioValue={aspectRatioValue}>
        <div
          className="absolute inset-0 overflow-hidden bg-black"
          data-video-program-stage="true"
          onContextMenu={onOpenContextMenu}
          ref={stageRef}
        >
          {stageClips.length > 0
            ? (
            stageClips.map((stageClip) => {
              const isRuntimeAdjustment = stageClip.clip.professional?.adjustmentLayer === true
                || (stageClip.clip as EditorVisualClip & { runtimeRole?: 'media' | 'adjustment' }).runtimeRole === 'adjustment';
              if (isRuntimeAdjustment) {
                const filter = buildClipEffectDescriptorForClip(stageClip.clip).cssFilter;
                return (
                  <div
                    aria-label="Adjustment layer applied to lower tracks"
                    className="absolute inset-0 pointer-events-none"
                    data-video-runtime-adjustment="true"
                    key={stageClip.clip.id}
                    style={{
                      zIndex: stageClip.clip.trackIndex * 2 + 1,
                      backgroundColor: 'rgba(0, 0, 0, 0.001)',
                      backdropFilter: filter || 'none',
                      WebkitBackdropFilter: filter || 'none',
                    }}
                  />
                );
              }
              const layout = getStageClipLayout(stageClip, canvas);
              const isSelected = selectedClip?.id === stageClip.clip.id;

              return (
                <div
                  key={stageClip.clip.id}
                  className="absolute"
                  style={{
                    left: `${layout.left * stageScale}px`,
                    top: `${layout.top * stageScale}px`,
                    width: `${layout.width * stageScale}px`,
                    height: `${layout.height * stageScale}px`,
                    zIndex: (stageClip.clip.trackIndex + 1) * 2,
                  }}
                >
                  <div
                    className="absolute inset-0"
                    style={{
                      opacity: Math.max(0, Math.min(1, layout.opacityPercent / 100)),
                      transform: `rotate(${layout.rotationDeg}deg) scaleX(${layout.flipHorizontal ? -1 : 1}) scaleY(${layout.flipVertical ? -1 : 1})`,
                      transformOrigin: 'center center',
                    }}
                  >
                    <button
                      className={`absolute inset-0 border text-left transition-colors ${
                        stageClip.clip.sourceKind === 'text'
                          ? `overflow-visible rounded-none bg-transparent ${
                              isSelected ? 'border-blue-300/90' : 'border-transparent'
                            }`
                          : `overflow-hidden rounded-lg ${
                              isSelected
                                ? 'border-blue-300/90 shadow-[0_0_0_1px_rgba(96,165,250,0.4)]'
                                : 'border-gray-700/40 hover:border-blue-300/50'
                            }`
                      } ${activeTool === 'select' ? 'cursor-move' : 'cursor-pointer'}`}
                      onClick={() => onSelectClip(stageClip.clip.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onSelectClip(stageClip.clip.id);
                        onOpenClipContextMenu(stageClip.clip.id, event);
                      }}
                      onPointerDown={(event) => startMoveDrag(event, stageClip)}
                      type="button"
                    >
                      <ProgramStageMedia
                        canvas={canvas}
                        clip={stageClip}
                        stageScale={stageScale}
                        transportRate={transportRate}
                      />
                    </button>

                    {isSelected && activeTool === 'select' ? (
                      <div className="absolute inset-0" data-clip-frame>
                        <div className={`pointer-events-none absolute inset-0 border border-blue-300/90 ${stageClip.clip.sourceKind === 'text' ? 'rounded-none' : 'rounded-lg'}`} />
                        <button
                          className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-slate-900/85 text-[10px] font-bold text-cyan-100 shadow cursor-move"
                          onPointerDown={(event) => startMoveDrag(event, stageClip)}
                          title="Move clip"
                          type="button"
                        >
                          +
                        </button>
                        <button
                          className="absolute -right-2 -top-2 h-4 w-4 rounded-full border border-white/70 bg-blue-400 shadow"
                          onPointerDown={(event) => {
                            const frameElement = event.currentTarget.parentElement as HTMLDivElement | null;
                            if (frameElement) {
                              startRotationDrag(event, stageClip, frameElement);
                            }
                          }}
                          title="Rotate clip"
                          type="button"
                        />
                        <button
                          className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-white/70 bg-cyan-300 shadow"
                          onPointerDown={(event) => {
                            const frameElement = event.currentTarget.parentElement as HTMLDivElement | null;
                            if (frameElement) {
                              startScaleDrag(event, stageClip, frameElement);
                            }
                          }}
                          title="Resize / scale clip"
                          type="button"
                        />
                        {stageClip.clip.sourceKind === 'comic' && stageClip.clip.comicKind !== 'caption'
                          ? (() => {
                              const tail = getVisualKeyframeStateAtProgress(
                                stageClip.clip,
                                getStageClipProgress(stageClip) * 100,
                              );
                              const tipCss = comicTailTipToFrameCssPercent(
                                tail.tailTipXPercent ?? COMIC_TAIL_DEFAULT_TIP_X_PERCENT,
                                tail.tailTipYPercent ?? COMIC_TAIL_DEFAULT_TIP_Y_PERCENT,
                              );
                              return (
                                <button
                                  className="absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200 bg-amber-400/90 shadow"
                                  onPointerDown={(event) => startTailTipDrag(event, stageClip)}
                                  style={{ left: `${tipCss.leftPercent}%`, top: `${tipCss.topPercent}%` }}
                                  title="Drag speech tail tip (keyframes at the playhead)"
                                  type="button"
                                />
                              );
                            })()
                          : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
              )
            : null}
          {stageObjects.map((object) => {
            const isSelected = selectedStageObject?.id === object.id;
            const layout = buildStageObjectLayoutDescriptor(object);

            return (
              <div
                key={object.id}
                className="absolute"
                style={{
                  left: `${layout.left * stageScale}px`,
                  top: `${layout.top * stageScale}px`,
                  width: `${layout.width * stageScale}px`,
                  height: `${layout.height * stageScale}px`,
                  opacity: Math.max(0, Math.min(1, layout.opacityPercent / 100)),
                  transform: `rotate(${layout.rotationDeg}deg)`,
                  transformOrigin: 'center center',
                  mixBlendMode: mapStageObjectBlendModeToCss(object.blendMode),
                }}
              >
                <button
                  className={`absolute inset-0 overflow-hidden rounded-sm border text-left transition-colors ${
                    isSelected
                      ? 'border-amber-200/90 shadow-[0_0_0_1px_rgba(253,230,138,0.5)]'
                      : 'border-transparent hover:border-amber-200/40'
                  } ${activeTool === 'select' ? 'cursor-move' : 'cursor-pointer'}`}
                  onClick={() => onSelectStageObject(object.id)}
                  onPointerDown={(event) => startStageObjectMoveDrag(event, object)}
                  type="button"
                >
                  <ProgramStageObjectPreview object={object} />
                </button>

                {isSelected && activeTool === 'select' ? (
                  <div className="absolute inset-0">
                    <div className="pointer-events-none absolute inset-0 rounded-sm border border-amber-200/90" />
                    <button
                      className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-slate-900/85 text-[10px] font-bold text-amber-100 shadow cursor-move"
                      onPointerDown={(event) => startStageObjectMoveDrag(event, object)}
                      title="Move object"
                      type="button"
                    >
                      +
                    </button>
                    <button
                      className="absolute -right-2 -top-2 h-4 w-4 rounded-full border border-white/70 bg-amber-400 shadow"
                      onPointerDown={(event) => {
                        const frameElement = event.currentTarget.parentElement as HTMLDivElement | null;
                        if (frameElement) {
                          startStageObjectRotationDrag(event, object, frameElement);
                        }
                      }}
                      title="Rotate object"
                      type="button"
                    />
                    <button
                      className="absolute -bottom-2 -right-2 h-4 w-4 rounded-full border border-white/70 bg-cyan-300 shadow"
                      onPointerDown={(event) => startStageObjectResizeDrag(event, object)}
                      title="Resize object"
                      type="button"
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
          {stageClips.length === 0 && stageObjects.length === 0 ? (
            <div className="flex h-full items-center justify-center px-10 text-center text-sm text-gray-500">
              Add clips to the timeline to build the program. The program stage uses the current playhead and canvas settings so you can position, scale, and rotate clips before rendering.
            </div>
          ) : null}
        </div>
      </MonitorStageFrame>
    </div>
  );
}

function ProgramStageMedia({
  canvas,
  clip,
  stageScale,
  transportRate,
}: {
  canvas: { width: number; height: number };
  clip: ProgramStageClip;
  stageScale: number;
  transportRate: number;
}) {
  const effectDescriptor = buildClipEffectDescriptorForClip(clip.clip, clip.localTimeSeconds * 1_000);
  const layout = getStageClipLayout(clip, canvas);
  const crop = layout.crop;
  const filter = effectDescriptor.cssFilter;
  const outline = effectDescriptor.cssOutline;
  const maskClipPath = effectDescriptor.maskExecution.status === 'ready'
    ? buildVideoMaskCssClipPath(effectDescriptor.maskExecution)
    : undefined;
  const maskOpacity = effectDescriptor.maskExecution.status === 'ready'
    ? effectDescriptor.maskExecution.model.shapes[0]?.opacity
    : undefined;
  const stabilizationTransform = effectDescriptor.stabilizationExecution.status === 'ready'
    ? `translate(${effectDescriptor.stabilizationExecution.offsetX! * 100}%, ${effectDescriptor.stabilizationExecution.offsetY! * 100}%) scale(${effectDescriptor.stabilizationExecution.scale}) `
    : '';
  const outlineShadow = outline
    ? `inset 0 0 0 ${Math.max(1, Math.round(outline.widthPx * stageScale))}px ${hexToRgba(outline.color, outline.opacityPercent / 100)}`
    : undefined;
  const cropFrameStyle: CSSProperties = {
    left: `${crop.frameLeftPercent}%`,
    right: `${crop.frameRightPercent}%`,
    top: `${crop.frameTopPercent}%`,
    bottom: `${crop.frameBottomPercent}%`,
  };
  const cropContentStyle: CSSProperties = {
    filter: filter || undefined,
    transform: `${stabilizationTransform}translate(${crop.contentTranslateXPercent}%, ${crop.contentTranslateYPercent}%) rotate(${crop.cropRotationDeg}deg)`,
    transformOrigin: 'center center',
  };
  const mediaClassName =
    clip.clip.fitMode === 'stretch' ? 'h-full w-full object-fill' : 'h-full w-full object-cover';
  const textDefaults = clip.asset?.textDefaults;
  const shapeDefaults = clip.asset?.shapeDefaults;
  let content: ReactNode;
  const isTextClip = clip.clip.sourceKind === 'text';

  if (clip.item?.kind === 'image' && clip.item.assetUrl) {
    content = effectDescriptor.chromaKey?.enabled
      ? (
        <ChromaKeyPreviewMedia
          chromaKey={effectDescriptor.chromaKey}
          className={mediaClassName}
          kind="image"
          label={clip.item.label}
          sourceHeight={clip.sourceHeight}
          sourceWidth={clip.sourceWidth}
          src={clip.item.assetUrl}
        />
      )
      : isGifAssetReference(clip.item.assetUrl, clip.item.mimeType)
      ? (
        <GifStagePreview
          className={mediaClassName}
          label={clip.item.label}
          localTimeSeconds={clip.localTimeSeconds}
          src={clip.item.assetUrl}
        />
      )
      : <img alt={clip.item.label} className={mediaClassName} src={clip.item.assetUrl} />;
  } else if ((clip.item?.kind === 'video' || clip.item?.kind === 'composition') && clip.item.assetUrl) {
    content = effectDescriptor.chromaKey?.enabled
      ? (
        <ChromaKeyPreviewMedia
          chromaKey={effectDescriptor.chromaKey}
          className={mediaClassName}
          currentTimeSeconds={clip.sourceTimeSeconds}
          kind="video"
          label={clip.item.label}
          sourceHeight={clip.sourceHeight}
          sourceWidth={clip.sourceWidth}
          src={clip.item.assetUrl}
        />
      )
      : (
        <StageVideoAsset
          className={mediaClassName}
          currentTimeSeconds={clip.sourceTimeSeconds}
          playbackRate={clip.clip.playbackRate}
          playing={transportRate === 1 && !clip.clip.reversePlayback}
          src={clip.item.assetUrl}
        />
      );
  } else if (clip.clip.sourceKind === 'shape') {
    const shape = layout.shape;
    content = (
      <div className="relative h-full w-full bg-transparent">
        <div
          className="absolute"
          style={{
            backgroundColor: shape?.fillColor ?? clip.clip.shapeFillColor ?? shapeDefaults?.fillColor ?? '#0ea5e9',
            borderColor: shape?.borderColor ?? clip.clip.shapeBorderColor ?? shapeDefaults?.borderColor ?? '#f8fafc',
            borderRadius: shape?.cornerRadius ?? clip.clip.shapeCornerRadius ?? shapeDefaults?.cornerRadius ?? 18,
            borderStyle: 'solid',
            borderWidth: shape?.borderWidth ?? clip.clip.shapeBorderWidth ?? shapeDefaults?.borderWidth ?? 2,
            height: `${100 - 2 * (shape?.insetPercent ?? 10)}%`,
            left: `${shape?.insetPercent ?? 10}%`,
            top: `${shape?.insetPercent ?? 10}%`,
            width: `${100 - 2 * (shape?.insetPercent ?? 10)}%`,
          }}
        />
      </div>
    );
  } else if (clip.clip.sourceKind === 'comic') {
    content = <ComicClipStagePreview clip={clip.clip} progressPercent={getStageClipProgress(clip) * 100} />;
  } else if (isTextClip) {
    const text = layout.text;
    const fontSizePx = (text?.fontSizePx ?? Math.max(8, clip.clip.textSizePx || textDefaults?.fontSizePx || 64)) * (layout.scalePercent / 100) * stageScale;
    const safeFontSizePx = Math.max(8, fontSizePx);
    const textColor = text?.color ?? clip.clip.textColor ?? textDefaults?.color ?? '#f3f4f6';
    const textFontFamily = text?.fontFamily ?? clip.clip.textFontFamily ?? textDefaults?.fontFamily ?? 'Inter, system-ui, sans-serif';
    const textString = clip.clip.textContent ?? textDefaults?.text ?? clip.item?.text ?? 'Text';
    const typography = clip.clip.textTypography;

    content = (
      <div className="flex h-full w-full items-center justify-center bg-transparent text-center">
        {typography?.arcPercent ? (
          <ArcTextPreview
            color={textColor}
            fontFamily={textFontFamily}
            fontSizePx={safeFontSizePx}
            text={textString}
            typography={typography}
          />
        ) : (
          <div
            className="inline-block whitespace-pre font-semibold leading-tight"
            style={{
              color: textColor,
              fontFamily: formatFontFamily(typography?.managedFace
                ? bundledFontFaceRuntimeFamilyName(typography.managedFace)
                : textFontFamily),
              fontSize: `${safeFontSizePx}px`,
              fontStretch: typography?.managedFace ? `${typography.managedFace.stretchPercent}%` : undefined,
              fontStyle: typography?.managedFace ? bundledFontFaceStyleDescriptor(typography.managedFace) : undefined,
              fontVariationSettings: typography?.managedFace ? bundledFontFaceVariationSettingsCss(typography.managedFace) : undefined,
              lineHeight: TEXT_LINE_HEIGHT,
              ...getTextTypographyStyle(typography, text?.effect ?? clip.clip.textEffect ?? textDefaults?.textEffect ?? 'none'),
            }}
          >
            {textString}
          </div>
        )}
      </div>
    );
  } else {
    content = (
      <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#1f2937_0%,#0f172a_42%,#020617_100%)] p-6 text-center">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-cyan-200/70">
            {clip.clip.sourceKind === 'text' ? 'Text Overlay' : clip.item?.kind ?? 'Clip'}
          </div>
          <div
            className="mt-3 text-balance font-semibold text-white"
            style={{
              color: clip.clip.textColor || textDefaults?.color,
              fontFamily: formatFontFamily(clip.clip.textTypography?.managedFace
                ? bundledFontFaceRuntimeFamilyName(clip.clip.textTypography.managedFace)
                : clip.clip.textFontFamily || textDefaults?.fontFamily || 'Inter, system-ui, sans-serif'),
              fontSize: `${Math.max(16, (clip.clip.textSizePx || textDefaults?.fontSizePx || 64) / 3)}px`,
            }}
          >
            {clip.clip.textContent ?? textDefaults?.text ?? clip.item?.text ?? 'Text clip'}
          </div>
        </div>
      </div>
    );
  }

  if (effectDescriptor.stabilizationExecution.status === 'unsupported' || effectDescriptor.maskExecution.status === 'unsupported') {
    const reason = effectDescriptor.stabilizationExecution.status === 'unsupported'
      ? effectDescriptor.stabilizationExecution.reason
      : effectDescriptor.maskExecution.status === 'unsupported'
        ? effectDescriptor.maskExecution.reason
        : 'Video effect is unavailable.';
    content = <div className="flex h-full w-full items-center justify-center bg-slate-950 p-4 text-center text-[11px] text-amber-100">{reason}</div>;
  }

  return (
    <div
      className={`absolute inset-0 ${isTextClip ? 'overflow-visible bg-transparent' : 'bg-black'}`}
      data-video-mask-execution={effectDescriptor.maskExecution.status}
      style={{
        filter: isTextClip && filter ? filter : undefined,
        mixBlendMode: effectDescriptor.cssBlendMode,
      }}
    >
      {isTextClip ? content : (
        <div className="absolute overflow-hidden" style={cropFrameStyle}>
        <div className="h-full w-full" style={{ ...cropContentStyle, clipPath: maskClipPath, opacity: maskOpacity }}>
          {content}
        </div>
        {outlineShadow ? (
          <div
            className="pointer-events-none absolute inset-0"
            style={{ boxShadow: outlineShadow }}
          />
        ) : null}
      </div>
      )}
    </div>
  );
}

/**
 * Program Monitor preview for an image clip whose source is a GIF. A browser `<img>` free-runs a
 * GIF on wall-clock time -- it ignores the timeline playhead entirely, so it shows the wrong frame
 * whenever the sequence is paused, scrubbed, or the clip is trimmed/time-offset, and it can't be
 * captured frame-accurately. This decodes the GIF once (`decodeGifFrames`) and repaints a canvas
 * with whichever frame `selectGifFrameIndexAtTime` says corresponds to `localTimeSeconds` -- the
 * same "elapsed time since this clip started on the timeline" clock `getStageClipProgress` already
 * uses, and the same clock the FFmpeg export loops the GIF against (see `buildVisualClipInputArgs`
 * in mediaComposition.ts), so preview and export agree on what the GIF looks like at any given
 * playhead position. Works for static (single-frame) GIFs too -- they simply always resolve to
 * frame 0, matching the previous `<img>` behavior.
 */
function GifStagePreview({
  className,
  label,
  localTimeSeconds,
  src,
}: {
  className: string;
  label: string;
  localTimeSeconds: number;
  src: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [decoded, setDecoded] = useState<GifDecodeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDecoded(null);

    fetch(src)
      .then((response) => response.blob())
      .then((blob) => decodeGifFrames(blob))
      .then((result) => {
        if (!cancelled) {
          setDecoded(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecoded(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context || !decoded || decoded.frames.length === 0) {
      return;
    }

    const frameIndex = selectGifFrameIndexAtTime(decoded.frames, Math.max(0, localTimeSeconds) * 1000);
    const frame = decoded.frames[frameIndex];

    canvas.width = decoded.width;
    canvas.height = decoded.height;
    context.clearRect(0, 0, decoded.width, decoded.height);

    if (typeof ImageData !== 'undefined' && frame.bitmap instanceof ImageData) {
      context.putImageData(frame.bitmap, 0, 0);
    } else {
      context.drawImage(frame.bitmap as CanvasImageSource, 0, 0, decoded.width, decoded.height);
    }
  }, [decoded, localTimeSeconds]);

  return (
    <canvas
      aria-label={label}
      className={className}
      ref={canvasRef}
    />
  );
}

function ProgramStageObjectPreview({ object }: { object: EditorStageObject }) {
  if (object.kind === 'text') {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-hidden">
        <div
          className="w-full whitespace-pre-wrap text-center font-semibold leading-tight"
          style={{
            color: object.color,
            fontFamily: formatFontFamily(object.managedFace
              ? bundledFontFaceRuntimeFamilyName(object.managedFace)
              : object.fontFamily),
            fontSize: `${object.fontSizePx}px`,
            fontStretch: object.managedFace ? `${object.managedFace.stretchPercent}%` : undefined,
            fontStyle: object.fontStyle,
            fontWeight: object.fontWeight,
          }}
        >
          {object.text}
        </div>
      </div>
    );
  }

  if (object.kind !== 'rectangle') {
    return <ComicStageObjectPreview object={object} />;
  }

  return (
    <div
      className="h-full w-full"
      style={{
        backgroundColor: object.fillColor,
        borderColor: object.borderColor,
        borderRadius: `${object.cornerRadius}px`,
        borderStyle: object.borderWidth > 0 ? 'solid' : 'none',
        borderWidth: `${object.borderWidth}px`,
      }}
    />
  );
}

/**
 * Edit-stage preview for a motion-comic CLIP: renders the exact export card (renderComicCard)
 * as the stage content, so the interactive stage matches the encode pixel-for-pixel. The tail tip +
 * funnel are resolved at the current playhead progress so a keyframed tail animates live and
 * INDEPENDENTLY of the bubble body (the body's pos/scale/rotation is applied by the stage layout).
 */
function ComicClipStagePreview({ clip, progressPercent }: { clip: EditorVisualClip; progressPercent: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const tailState = getVisualKeyframeStateAtProgress(clip, progressPercent);
  const tipXPercent = tailState.tailTipXPercent;
  const tipYPercent = tailState.tailTipYPercent;
  const curvePercent = tailState.tailCurvePercent;

  useEffect(() => {
    let cancelled = false;
    void renderComicCard(clip, { tipXPercent, tipYPercent, curvePercent }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [clip, tipXPercent, tipYPercent, curvePercent]);

  return src
    ? <img alt={clip.textContent ?? 'Motion comic'} className="h-full w-full object-contain" src={src} />
    : <div className="h-full w-full bg-transparent" />;
}

/**
 * Edit-stage preview for motion-comic objects. Draws with the SAME canvas painter the export
 * render uses (drawComicStageObject), so the stage is pixel-truthful to the encode.
 */
function ComicStageObjectPreview({ object }: { object: Extract<EditorStageObject, { kind: 'speech-bubble' | 'thought-bubble' | 'caption' }> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The bezier tail can poke ~0.6× the smaller body half-extent beyond the body, so pad for that
  // as well as the legacy polar length so the tail is never clipped in the preview canvas.
  const pad = Math.ceil(
    Math.max(object.tailLengthPx, Math.min(object.width, object.height) * 0.65) + object.strokeWidthPx + 8,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = object.width + pad * 2;
    canvas.height = object.height + pad * 2;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width / 2, canvas.height / 2);
    drawComicStageObject(context, object);
    context.restore();
  }, [object, pad]);

  return (
    <canvas
      className="pointer-events-none absolute"
      ref={canvasRef}
      style={{ left: -pad, top: -pad, width: object.width + pad * 2, height: object.height + pad * 2 }}
    />
  );
}

function mapStageObjectBlendModeToCss(mode: EditorStageBlendMode): React.CSSProperties['mixBlendMode'] {
  switch (mode) {
    case 'color-dodge':
      return 'color-dodge';
    case 'color-burn':
      return 'color-burn';
    case 'screen':
    case 'multiply':
    case 'overlay':
    case 'lighten':
    case 'darken':
      return mode;
    case 'normal':
      return 'normal';
  }
}

function getTextPreviewEffectStyle(effect: TextClipEffect): CSSProperties {
  if (effect === 'shadow') {
    return { textShadow: '0 6px 20px rgba(0,0,0,0.65)' };
  }

  if (effect === 'glow') {
    return { textShadow: '0 0 18px rgba(255,255,255,0.65), 0 0 36px rgba(96,165,250,0.45)' };
  }

  if (effect === 'outline') {
    return {
      WebkitTextStroke: '1px rgba(0,0,0,0.75)',
      textShadow: '0 2px 6px rgba(0,0,0,0.5)',
    };
  }

  return {};
}

/**
 * Full Paper-grade typography CSS for a text/comic clip's live preview: starts from the legacy
 * per-clip `TextClipEffect` look (so clips created before `textTypography` existed render
 * unchanged), then layers explicit `textTypography` fields on top. Arc is handled separately by
 * `ArcTextPreview` (CSS can't bend a text run along a curve) — this function is only used for the
 * straight-line render path.
 */
function getTextTypographyStyle(
  typography: EditorTextTypography | undefined,
  legacyEffect: TextClipEffect,
): CSSProperties {
  const style: CSSProperties = { ...getTextPreviewEffectStyle(legacyEffect) };

  if (typography?.fontWeight !== undefined) {
    style.fontWeight = typography.fontWeight;
  }
  if (typography?.fontStyle) {
    style.fontStyle = typography.fontStyle;
  }
  if (typography?.fontKerning) {
    style.fontKerning = typography.fontKerning;
  }
  if (typography?.lineHeightPercent !== undefined) {
    style.lineHeight = typography.lineHeightPercent / 100;
  }
  if (typography?.letterSpacingPx !== undefined) {
    style.letterSpacing = `${typography.letterSpacingPx}px`;
  }
  if (typography?.textAlign) {
    style.textAlign = typography.textAlign;
  }
  if ((typography?.strokeWidthPx ?? 0) > 0) {
    style.WebkitTextStroke = `${typography?.strokeWidthPx}px ${typography?.strokeColor ?? '#000000'}`;
  }
  if ((typography?.shadowBlurPx ?? 0) > 0 || (typography?.shadowOffsetXPx ?? 0) !== 0 || (typography?.shadowOffsetYPx ?? 0) !== 0) {
    style.textShadow = `${typography?.shadowOffsetXPx ?? 0}px ${typography?.shadowOffsetYPx ?? 0}px ${Math.max(0, typography?.shadowBlurPx ?? 0)}px ${typography?.shadowColor ?? 'rgba(0,0,0,0.6)'}`;
  }

  return style;
}

/**
 * Lazily-created shared measurer for the LIVE preview's arc-text glyph placement — mirrors
 * `mediaComposition.ts`'s `getVideoTextMeasurer()`, kept as a separate instance since this module
 * can't import a canvas context across the preview/export boundary (nor should it: this one only
 * ever runs in the browser/Electron renderer, same as the export path, just a different call site).
 */
let sharedVideoTextMeasurer: ReturnType<typeof createVideoTextCanvasMeasurer> | undefined;

function getSharedVideoTextMeasurer(): ReturnType<typeof createVideoTextCanvasMeasurer> {
  sharedVideoTextMeasurer ??= createVideoTextCanvasMeasurer();
  return sharedVideoTextMeasurer;
}

/**
 * Live-preview render for arc/curved text (`textTypography.arcPercent`): CSS can't bend a text run
 * along a curve, so each character is measured and placed individually via `computeArcTextGlyphs` —
 * the SAME pure geometry `mediaComposition.ts`'s canvas export uses, so the curve the user drags in
 * the inspector matches the exported frame.
 */
function ArcTextPreview({
  color,
  fontFamily,
  fontSizePx,
  text,
  typography,
}: {
  color: string;
  fontFamily: string;
  fontSizePx: number;
  text: string;
  typography: EditorTextTypography;
}) {
  const measurer = getSharedVideoTextMeasurer();
  const fontWeight = typography.fontWeight ?? 600;
  const fontStyle = typography.fontStyle ?? 'normal';
  const letterSpacingPx = typography.letterSpacingPx ?? 0;
  const font = {
    fontFamily: typography.managedFace
      ? bundledFontFaceRuntimeFamilyName(typography.managedFace)
      : fontFamily,
    fontSizePx,
    fontWeight,
    fontStyle,
    fontStretchPercent: typography.managedFace?.stretchPercent ?? 100,
    fontKerning: typography.fontKerning ?? 'auto',
    letterSpacingPx,
  };
  const naturalWidthPx = Math.max(1, measurer(text, font));
  const glyphs = computeArcTextGlyphs(text, naturalWidthPx, typography.arcPercent, (char) => measurer(char, font) + letterSpacingPx);
  const glyphStyle = getTextTypographyStyle(typography, 'none');
  const heightPx = fontSizePx * 2;

  return (
    <div className="relative" style={{ width: naturalWidthPx, height: heightPx }}>
      {glyphs.map((glyph, index) => (
        <span
          className="absolute whitespace-pre"
          key={index}
          style={{
            color,
            fontFamily: formatFontFamily(typography.managedFace
              ? bundledFontFaceRuntimeFamilyName(typography.managedFace)
              : fontFamily),
            fontSize: `${fontSizePx}px`,
            fontStyle,
            fontStretch: typography.managedFace ? `${typography.managedFace.stretchPercent}%` : undefined,
            fontKerning: typography.fontKerning ?? 'auto',
            fontWeight,
            left: naturalWidthPx / 2 + glyph.xPx,
            top: heightPx / 2 + glyph.yPx,
            textShadow: glyphStyle.textShadow,
            transform: `translate(-50%, -50%) rotate(${glyph.rotationDeg}deg)`,
            WebkitTextStroke: glyphStyle.WebkitTextStroke,
          }}
        >
          {glyph.char}
        </span>
      ))}
    </div>
  );
}

/**
 * The Paper-grade typography controls shared by the text- and comic-clip inspectors: weight, style,
 * arc/curve, and stroke/shadow — the fields `EditorTextTypography` carries beyond line-height/
 * letter-spacing/align (which each inspector already has its own controls for, since comic bubbles
 * had those first). All writes merge into the clip's `textTypography` via the caller's
 * `updateTypography` (see `updateTextTypography` in the Inspector component), never overwriting
 * fields this section doesn't own.
 */
function TypographyAdvancedControls({
  typography,
  updateTypography,
}: {
  typography: EditorTextTypography | undefined;
  updateTypography: (patch: Partial<EditorTextTypography>) => void;
}) {
  const fontWeight = typography?.fontWeight ?? 600;
  const fontStyle = typography?.fontStyle ?? 'normal';
  const fontKerning = typography?.fontKerning ?? 'auto';
  const strokeWidthPx = typography?.strokeWidthPx ?? 0;
  const shadowBlurPx = typography?.shadowBlurPx ?? 0;
  const arcPercent = typography?.arcPercent ?? 0;

  return (
    <div className="space-y-3 rounded-lg border border-gray-700/60 bg-[#0f131b]/50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">Typography</div>
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Weight"
          max={900}
          min={100}
          onChange={(value) => updateTypography({
            fontWeight: Math.max(100, Math.min(900, Math.round(value / 100) * 100)),
            managedFace: undefined,
            managedFaceIssue: undefined,
          })}
          step={100}
          value={fontWeight}
        />
        <div className="flex items-end gap-2">
          {(['normal', 'italic'] as const).map((style) => (
            <button
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${fontStyle === style ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100' : 'border-gray-700/60 text-gray-400 hover:text-gray-200'}`}
              key={style}
              onClick={() => updateTypography({ fontStyle: style, managedFace: undefined, managedFaceIssue: undefined })}
              type="button"
            >
              {style === 'normal' ? 'Normal' : 'Italic'}
            </button>
          ))}
        </div>
        <label className="block space-y-2 text-xs text-gray-400">
          <span>Kerning</span>
          <select
            className="w-full rounded-lg border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-xs text-gray-200 outline-none"
            onChange={(event) => updateTypography({ fontKerning: event.target.value as NonNullable<EditorTextTypography['fontKerning']> })}
            value={fontKerning}
          >
            <option value="auto">Auto</option>
            <option value="normal">Metrics</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <RangeControl
        label="Curve (arc)"
        max={100}
        min={-100}
        onChange={(value) => updateTypography({ arcPercent: Math.round(value) })}
        value={arcPercent}
        valueLabel={arcPercent === 0 ? 'straight' : `${arcPercent}`}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Stroke width"
          max={20}
          min={0}
          onChange={(value) => updateTypography({ strokeWidthPx: Math.max(0, Math.round(value)) })}
          step={1}
          value={strokeWidthPx}
        />
        <label className="block space-y-2 text-xs text-gray-400">
          <span>Stroke color</span>
          <AdvancedColorPicker
            className="h-10 w-full"
            buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
            label="Text stroke color"
            onChange={(strokeColor) => updateTypography({ strokeColor })}
            value={typography?.strokeColor ?? '#000000'}
          />
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField
          label="Shadow blur"
          max={60}
          min={0}
          onChange={(value) => updateTypography({ shadowBlurPx: Math.max(0, Math.round(value)) })}
          step={1}
          value={shadowBlurPx}
        />
        <label className="block space-y-2 text-xs text-gray-400">
          <span>Shadow color</span>
          <AdvancedColorPicker
            className="h-10 w-full"
            buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
            label="Text shadow color"
            onChange={(shadowColor) => updateTypography({ shadowColor })}
            value={typography?.shadowColor ?? '#000000'}
          />
        </label>
        <NumberField
          label="Shadow offset X"
          max={40}
          min={-40}
          onChange={(value) => updateTypography({ shadowOffsetXPx: Math.round(value) })}
          step={1}
          value={typography?.shadowOffsetXPx ?? 0}
        />
        <NumberField
          label="Shadow offset Y"
          max={40}
          min={-40}
          onChange={(value) => updateTypography({ shadowOffsetYPx: Math.round(value) })}
          step={1}
          value={typography?.shadowOffsetYPx ?? 0}
        />
      </div>
    </div>
  );
}

function ChromaKeyPreviewMedia({
  chromaKey,
  className,
  currentTimeSeconds,
  kind,
  label,
  sourceHeight,
  sourceWidth,
  src,
}: {
  chromaKey: EditorClipChromaKeySettings;
  className: string;
  currentTimeSeconds?: number;
  kind: 'image' | 'video';
  label: string;
  sourceHeight?: number;
  sourceWidth?: number;
  src: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const fallbackWidth = Math.max(1, Math.round(sourceWidth || 1));
  const fallbackHeight = Math.max(1, Math.round(sourceHeight || 1));

  const draw = useCallback((media: CanvasImageSource, naturalWidth: number, naturalHeight: number) => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    try {
      const width = Math.max(1, Math.round(naturalWidth || sourceWidth || 1));
      const height = Math.max(1, Math.round(naturalHeight || sourceHeight || 1));
      const context = canvasElement.getContext('2d', { willReadFrequently: true });

      if (!context) {
        setErrorMessage('Canvas unavailable');
        return;
      }

      canvasElement.width = width;
      canvasElement.height = height;
      context.clearRect(0, 0, width, height);
      context.drawImage(media, 0, 0, width, height);
      const imageData = context.getImageData(0, 0, width, height);
      applyChromaKeyToImageData(imageData, chromaKey);
      context.putImageData(imageData, 0, 0);
      setErrorMessage(undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Preview unavailable');
    }
  }, [chromaKey, sourceHeight, sourceWidth]);

  useEffect(() => {
    if (kind !== 'image') {
      return;
    }

    const image = imageRef.current;
    if (!image) {
      return;
    }

    const paintImage = () => draw(image, image.naturalWidth, image.naturalHeight);
    const handleError = () => setErrorMessage('Image could not be loaded for keyed preview.');

    if (image.complete && image.naturalWidth > 0) {
      paintImage();
    }

    image.addEventListener('load', paintImage);
    image.addEventListener('error', handleError);

    return () => {
      image.removeEventListener('load', paintImage);
      image.removeEventListener('error', handleError);
    };
  }, [draw, kind, src]);

  useEffect(() => {
    if (kind !== 'video') {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const paintVideo = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        draw(video, video.videoWidth, video.videoHeight);
      }
    };
    const seekToCurrentFrame = () => {
      const nextTime = Math.max(0, currentTimeSeconds ?? 0);
      if (Math.abs(video.currentTime - nextTime) > 0.01) {
        video.currentTime = nextTime;
      } else {
        paintVideo();
      }
      video.pause();
    };
    const handleError = () => setErrorMessage('Video frame could not be loaded for keyed preview.');

    if (video.readyState >= 1) {
      seekToCurrentFrame();
    }

    video.addEventListener('loadedmetadata', seekToCurrentFrame);
    video.addEventListener('loadeddata', paintVideo);
    video.addEventListener('seeked', paintVideo);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', seekToCurrentFrame);
      video.removeEventListener('loadeddata', paintVideo);
      video.removeEventListener('seeked', paintVideo);
      video.removeEventListener('error', handleError);
    };
  }, [currentTimeSeconds, draw, kind, src]);

  return (
    <>
      <canvas
        aria-label={`Chroma keyed preview for ${label}`}
        className={className}
        data-chroma-key-preview
        height={fallbackHeight}
        ref={canvasRef}
        style={{ background: 'transparent' }}
        width={fallbackWidth}
      />
      {kind === 'image' ? (
        <img alt="" className="hidden" ref={imageRef} src={src} />
      ) : (
        <video className="hidden" muted playsInline preload="metadata" ref={videoRef} src={src} />
      )}
      {errorMessage ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 px-3 text-center text-[10px] font-semibold text-amber-100"
          data-chroma-key-preview-error
        >
          {errorMessage}
        </div>
      ) : null}
    </>
  );
}

function StageVideoAsset({
  src,
  currentTimeSeconds,
  className,
  playbackRate,
  playing,
}: {
  src: string;
  currentTimeSeconds?: number;
  className: string;
  playbackRate: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;

    if (!video || currentTimeSeconds == null || Number.isNaN(currentTimeSeconds)) {
      return;
    }

    const synchronize = () => {
      const targetTimeSeconds = Math.max(0, currentTimeSeconds);
      video.playbackRate = Math.max(0.25, Math.min(8, playbackRate || 1));

      if (shouldCorrectProgramMediaTime(video.currentTime, targetTimeSeconds, playing)) {
        video.currentTime = targetTimeSeconds;
      }

      if (playing) {
        if (video.paused) {
          void video.play().catch(() => undefined);
        }
      } else {
        video.pause();
      }
    };

    if (video.readyState >= 1) {
      synchronize();
    }

    const handleLoadedMetadata = () => synchronize();
    video.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [currentTimeSeconds, playbackRate, playing, src]);

  useEffect(() => () => {
    ref.current?.pause();
  }, []);

  return (
    <video
      className={className}
      data-video-program-realtime={playing ? 'playing' : 'paused'}
      muted
      playsInline
      preload="auto"
      ref={ref}
      src={src}
    />
  );
}

function ProgramAudioTransport({
  items,
  playing,
}: {
  items: ProgramAudioPlaybackItem[];
  playing: boolean;
}) {
  return (
    <div aria-hidden="true" className="hidden" data-video-program-audio-transport={playing ? 'playing' : 'paused'}>
      {items.map((item) => (
        <ProgramAudioAsset item={item} key={item.id} playing={playing} />
      ))}
    </div>
  );
}

interface ProgramAudioGraph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
  panner?: StereoPannerNode;
  connected: boolean;
}

// Browser policies cap concurrent AudioContexts much lower than the 64 active
// timeline clips the bounded mixer permits. Share one context and remember the
// element's one legal MediaElementAudioSourceNode across React remounts.
let programAudioContext: AudioContext | undefined;
const programAudioGraphs = new WeakMap<HTMLAudioElement, ProgramAudioGraph>();

function connectProgramAudioGraph(graph: ProgramAudioGraph): void {
  if (graph.connected) return;
  graph.source.connect(graph.gain);
  if (graph.panner) {
    graph.gain.connect(graph.panner);
    graph.panner.connect(graph.context.destination);
  } else {
    graph.gain.connect(graph.context.destination);
  }
  graph.connected = true;
}

function disconnectProgramAudioGraph(graph: ProgramAudioGraph): void {
  if (!graph.connected) return;
  graph.source.disconnect();
  graph.gain.disconnect();
  graph.panner?.disconnect();
  graph.connected = false;
}

function acquireProgramAudioGraph(audio: HTMLAudioElement): ProgramAudioGraph | undefined {
  const existing = programAudioGraphs.get(audio);
  if (existing && existing.context.state !== 'closed') {
    connectProgramAudioGraph(existing);
    return existing;
  }
  const AudioContextConstructor = typeof window === 'undefined'
    ? undefined
    : window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) return undefined;
  programAudioContext ??= new AudioContextConstructor();
  const source = programAudioContext.createMediaElementSource(audio);
  const gain = programAudioContext.createGain();
  const panner = typeof programAudioContext.createStereoPanner === 'function'
    ? programAudioContext.createStereoPanner()
    : undefined;
  const graph: ProgramAudioGraph = { context: programAudioContext, source, gain, panner, connected: false };
  programAudioGraphs.set(audio, graph);
  connectProgramAudioGraph(graph);
  return graph;
}

function ProgramAudioAsset({
  item,
  playing,
}: {
  item: ProgramAudioPlaybackItem;
  playing: boolean;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const graphRef = useRef<ProgramAudioGraph | null>(null);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    try {
      graphRef.current = acquireProgramAudioGraph(audio) ?? null;
    } catch {
      // Browsers that cannot bind a media element to Web Audio retain the
      // established HTMLMediaElement gain-only preview. Export remains exact.
      graphRef.current = null;
    }
    return () => {
      const graph = graphRef.current;
      graphRef.current = null;
      if (!graph) return;
      disconnectProgramAudioGraph(graph);
    };
  }, []);

  useEffect(() => {
    const audio = ref.current;
    if (!audio) {
      return;
    }

    const synchronize = () => {
      const graph = graphRef.current;
      if (graph) {
        graph.gain.gain.value = item.gain;
        if (graph.panner) graph.panner.pan.value = item.pan;
        audio.volume = 1;
      } else {
        audio.volume = Math.max(0, Math.min(1, item.volume));
      }

      if (shouldCorrectProgramMediaTime(audio.currentTime, item.sourceTimeSeconds, playing)) {
        audio.currentTime = item.sourceTimeSeconds;
      }

      if (playing) {
        if (graph) void graph.context.resume().catch(() => undefined);
        if (audio.paused) {
          void audio.play().catch(() => undefined);
        }
      } else {
        audio.pause();
      }
    };

    if (audio.readyState >= 1) {
      synchronize();
    }

    const handleLoadedMetadata = () => synchronize();
    audio.addEventListener('loadedmetadata', handleLoadedMetadata, { once: true });

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [item.gain, item.pan, item.sourceTimeSeconds, item.volume, playing]);

  useEffect(() => () => {
    ref.current?.pause();
  }, []);

  return <audio data-video-program-audio-pan={item.pan} preload="auto" ref={ref} src={item.src} />;
}

function StageObjectInspector({
  object,
  onUpdate,
  onRemove,
}: {
  object: EditorStageObject;
  onUpdate: (patch: Partial<EditorStageObject>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-4">
      <InspectorHeader
        eyebrow="Selected Stage Object"
        title={object.kind === 'text' ? object.text || 'Text' : 'Rectangle'}
      />
      <InfoStack
        rows={[
          ['Kind', object.kind],
          ['Position', `${object.x}, ${object.y}`],
          ['Size', `${object.width} x ${object.height}`],
          ['Blend', object.blendMode],
        ]}
      />
      {object.kind === 'text' ? (
        <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Text</span>
            <textarea
              className="min-h-24 w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
              onChange={(event) => onUpdate({ text: event.target.value } as Partial<EditorStageObject>)}
              value={object.text}
            />
          </label>
          <BundledFontBrowser
            onSelect={(family, face) => onUpdate({
              fontFamily: family.family,
              fontWeight: face.weight,
              fontStyle: face.style,
              managedFace: createBundledFontFaceReference(family, face),
              managedFaceIssue: undefined,
            } as Partial<EditorStageObject>)}
            style={object.fontStyle ?? 'normal'}
            value={object.fontFamily}
            weight={object.fontWeight ?? 400}
          />
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Font family</span>
            <input
              className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
              onChange={(event) => onUpdate({ fontFamily: event.target.value, managedFace: undefined, managedFaceIssue: undefined } as Partial<EditorStageObject>)}
              type="text"
              value={object.fontFamily}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Font size"
              max={320}
              min={8}
              onChange={(value) => onUpdate({ fontSizePx: Math.max(8, Math.round(value)) } as Partial<EditorStageObject>)}
              step={1}
              value={object.fontSizePx}
            />
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Color</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Stage object text color"
                onChange={(color) => onUpdate({ color } as Partial<EditorStageObject>)}
                value={object.color}
              />
            </label>
          </div>
        </div>
      ) : object.kind === 'rectangle' ? (
        <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Fill</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Stage object fill color"
                onChange={(fillColor) => onUpdate({ fillColor } as Partial<EditorStageObject>)}
                value={object.fillColor}
              />
            </label>
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Border</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Stage object border color"
                onChange={(borderColor) => onUpdate({ borderColor } as Partial<EditorStageObject>)}
                value={object.borderColor}
              />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Border width"
              max={80}
              min={0}
              onChange={(value) => onUpdate({ borderWidth: Math.max(0, Math.round(value)) } as Partial<EditorStageObject>)}
              step={1}
              value={object.borderWidth}
            />
            <NumberField
              label="Corner radius"
              max={300}
              min={0}
              onChange={(value) => onUpdate({ cornerRadius: Math.max(0, Math.round(value)) } as Partial<EditorStageObject>)}
              step={1}
              value={object.cornerRadius}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            {object.kind === 'caption' ? 'Caption' : object.kind === 'thought-bubble' ? 'Thought Bubble' : 'Speech Bubble'} · Motion Comic
          </div>
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Text</span>
            <textarea
              className="h-20 w-full resize-none rounded-xl border border-gray-700/60 bg-[#0f131b] p-2 text-sm text-gray-100"
              onChange={(event) => onUpdate({ text: event.target.value } as Partial<EditorStageObject>)}
              value={object.text}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Fill</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Bubble fill color"
                onChange={(fillColor) => onUpdate({ fillColor } as Partial<EditorStageObject>)}
                value={object.fillColor}
              />
            </label>
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Outline</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Bubble outline color"
                onChange={(strokeColor) => onUpdate({ strokeColor } as Partial<EditorStageObject>)}
                value={object.strokeColor}
              />
            </label>
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Text color</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Bubble text color"
                onChange={(textColor) => onUpdate({ textColor } as Partial<EditorStageObject>)}
                value={object.textColor}
              />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Font size"
              max={400}
              min={8}
              onChange={(value) => onUpdate({ fontSizePx: Math.max(8, Math.round(value)) } as Partial<EditorStageObject>)}
              step={1}
              value={object.fontSizePx}
            />
            <NumberField
              label="Outline width"
              max={40}
              min={0}
              onChange={(value) => onUpdate({ strokeWidthPx: Math.max(0, Math.round(value)) } as Partial<EditorStageObject>)}
              step={1}
              value={object.strokeWidthPx}
            />
            <NumberField
              label="Line height %"
              max={240}
              min={80}
              onChange={(value) => onUpdate({ lineHeightPercent: Math.max(80, Math.min(240, Math.round(value))) } as Partial<EditorStageObject>)}
              step={5}
              value={object.lineHeightPercent}
            />
            <NumberField
              label="Letter spacing"
              max={24}
              min={-4}
              onChange={(value) => onUpdate({ letterSpacingPx: Math.max(-4, Math.min(24, Math.round(value))) } as Partial<EditorStageObject>)}
              step={1}
              value={object.letterSpacingPx}
            />
          </div>
          {object.kind !== 'caption' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <NumberField
                label="Tail angle°"
                max={360}
                min={0}
                onChange={(value) => onUpdate({ tailAngleDeg: Math.round(value) } as Partial<EditorStageObject>)}
                step={5}
                value={object.tailAngleDeg}
              />
              <NumberField
                label="Tail length"
                max={600}
                min={0}
                onChange={(value) => onUpdate({ tailLengthPx: Math.max(0, Math.round(value)) } as Partial<EditorStageObject>)}
                step={5}
                value={object.tailLengthPx}
              />
            </div>
          ) : null}
          <div className="flex gap-2">
            {(['left', 'center', 'right'] as const).map((align) => (
              <button
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${object.textAlign === align ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100' : 'border-gray-700/60 text-gray-400 hover:text-gray-200'}`}
                key={align}
                onClick={() => onUpdate({ textAlign: align } as Partial<EditorStageObject>)}
                type="button"
              >
                {align === 'left' ? 'Left' : align === 'center' ? 'Center' : 'Right'}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <NumberField label="X" onChange={(value) => onUpdate({ x: Math.round(value) })} step={1} value={object.x} />
        <NumberField label="Y" onChange={(value) => onUpdate({ y: Math.round(value) })} step={1} value={object.y} />
        <NumberField
          label="Width"
          min={8}
          onChange={(value) => onUpdate({ width: Math.max(8, Math.round(value)) })}
          step={1}
          value={object.width}
        />
        <NumberField
          label="Height"
          min={8}
          onChange={(value) => onUpdate({ height: Math.max(8, Math.round(value)) })}
          step={1}
          value={object.height}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <RangeControl
          label="Opacity"
          max={100}
          min={0}
          onChange={(value) => onUpdate({ opacityPercent: Math.round(value) })}
          value={object.opacityPercent}
          valueLabel={`${object.opacityPercent}%`}
        />
        <NumberField
          label="Rotation"
          max={360}
          min={-360}
          onChange={(value) => onUpdate({ rotationDeg: Math.round(value) })}
          step={1}
          value={object.rotationDeg}
        />
      </div>
      <label className="block space-y-2 text-xs text-gray-400">
        <span>Blend / filter effect</span>
        <select
          className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
          onChange={(event) => onUpdate({ blendMode: event.target.value as EditorStageBlendMode })}
          value={object.blendMode}
        >
          {getStageObjectBlendModes().map((mode) => (
            <option key={mode} value={mode}>
              {formatStageBlendModeLabel(mode)}
            </option>
          ))}
        </select>
      </label>
      <button
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/15"
        onClick={onRemove}
        type="button"
      >
        <Trash2 size={14} />
        Remove Object
      </button>
    </div>
  );
}

function formatStageBlendModeLabel(mode: EditorStageBlendMode): string {
  return mode
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : 'ffffff';
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function normalizeVideoExportPresetPlan(value: unknown): VideoExportPresetPlanData {
  if (value && typeof value === 'object' && 'presetId' in value) {
    const presetId = (value as { presetId?: unknown }).presetId;

    if (VIDEO_EXPORT_PRESET_OPTIONS.some((preset) => preset.id === presetId)) {
      const notes = (value as { notes?: unknown }).notes;

      return {
        presetId: presetId as VideoExportPresetPlanId,
        notes: typeof notes === 'string' ? notes : undefined,
      };
    }
  }

  return { presetId: VIDEO_EXPORT_PRESET_OPTIONS[0].id as VideoExportPresetPlanId };
}

function createClipFilter(kind: EditorClipFilterKind): EditorClipFilter {
  return {
    id: `filter-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    amount:
      kind === 'grayscale' || kind === 'sepia' || kind === 'invert'
        ? 100
        : kind === 'blur'
          ? 12
          : kind === 'hue-rotate'
            ? 30
            : 0,
    enabled: true,
  };
}

function formatClipFilterKind(kind: EditorClipFilterKind): string {
  return kind
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function getClipFilterAmountRange(kind: EditorClipFilterKind): { min: number; max: number } {
  if (kind === 'hue-rotate') {
    return { min: -180, max: 180 };
  }

  if (kind === 'blur' || kind === 'grayscale' || kind === 'sepia' || kind === 'invert') {
    return { min: 0, max: 100 };
  }

  return { min: -100, max: 100 };
}

function buildTextDraftFromAsset(asset: EditorAsset): TextEditDraft {
  return normalizeTextEditDraft({
    text: asset.textDefaults?.text ?? 'Text',
    fontFamily: asset.textDefaults?.fontFamily ?? 'Inter, system-ui, sans-serif',
    fontWeight: asset.textDefaults?.fontWeight ?? 400,
    fontStyle: asset.textDefaults?.fontStyle ?? 'normal',
    managedFace: asset.textDefaults?.managedFace,
    managedFaceIssue: asset.textDefaults?.managedFaceIssue,
    fontSizePx: asset.textDefaults?.fontSizePx ?? 72,
    color: asset.textDefaults?.color ?? '#f8fafc',
    textEffect: asset.textDefaults?.textEffect ?? 'shadow',
  });
}

function buildTextDraftFromClip(
  clip: EditorVisualClip,
  asset?: EditorAsset,
  sourceItem?: SourceBinItem,
): TextEditDraft {
  return normalizeTextEditDraft({
    text: clip.textContent ?? sourceItem?.text ?? asset?.textDefaults?.text ?? 'Text',
    fontFamily: clip.textFontFamily || asset?.textDefaults?.fontFamily || 'Inter, system-ui, sans-serif',
    fontWeight: clip.textTypography?.fontWeight ?? asset?.textDefaults?.fontWeight ?? 400,
    fontStyle: clip.textTypography?.fontStyle ?? asset?.textDefaults?.fontStyle ?? 'normal',
    managedFace: clip.textTypography?.managedFace ?? asset?.textDefaults?.managedFace,
    managedFaceIssue: clip.textTypography?.managedFaceIssue ?? asset?.textDefaults?.managedFaceIssue,
    fontSizePx: clip.textSizePx || asset?.textDefaults?.fontSizePx || 72,
    color: clip.textColor || asset?.textDefaults?.color || '#f8fafc',
    textEffect: clip.textEffect || asset?.textDefaults?.textEffect || 'shadow',
  });
}

function normalizeTextEditDraft(draft: TextEditDraft): TextEditDraft {
  return {
    text: draft.text,
    fontFamily: draft.fontFamily.trim() || 'Inter, system-ui, sans-serif',
    fontWeight: typeof draft.fontWeight === 'number' && Number.isFinite(draft.fontWeight) ? draft.fontWeight : 400,
    fontStyle: draft.fontStyle === 'italic' || draft.fontStyle === 'oblique' ? draft.fontStyle : 'normal',
    managedFace: draft.managedFace,
    managedFaceIssue: draft.managedFaceIssue,
    fontSizePx: Math.max(8, Math.min(320, Math.round(draft.fontSizePx))),
    color: /^#[0-9a-f]{6}$/i.test(draft.color) ? draft.color : '#f8fafc',
    textEffect: draft.textEffect,
  };
}

function buildTextAssetLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, 48) : 'Text';
}

function buildNarrationAssetLabel(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return `Narration - ${trimmed ? trimmed.slice(0, 40) : 'Text'}`;
}

function resolveEditorNarrationProvider(
  apiKeys: { gemini: string; elevenlabs: string; huggingface: string },
  backendProxyEnabled: boolean,
): AudioProvider {
  if (backendProxyEnabled) {
    return 'gemini';
  }

  if (apiKeys.elevenlabs.trim()) {
    return 'elevenlabs';
  }

  if (apiKeys.gemini.trim()) {
    return 'gemini';
  }

  if (apiKeys.huggingface.trim()) {
    return 'huggingface';
  }

  return 'elevenlabs';
}

export function InspectorPanel({
  visualClip,
  visualBackingImageItem,
  visualEditorAsset,
  visualSourceItem,
  visualSourceDurationSeconds,
  visualDurationSeconds,
  audioDurationSeconds,
  audioSourceDurationSeconds,
  timelineCursorSeconds,
  sequenceDurationSeconds,
  selectedSourceItem,
  selectedStageObject,
  audioClip,
  audioClips = [],
  audioTrackCount = AUDIO_TRACK_COUNT,
  audioTrackVolumes,
  mutedAudioTracks = [],
  soloAudioTracks = [],
  audioSourceItemsByClipId,
  audioSourceItem,
  visualTrackCount = VISUAL_TRACK_COUNT,
  onUpdateVisualClip,
  onUpdateVisualKeyframe,
  onRemoveVisualKeyframe,
  onMoveVisualToTrack,
  onRemoveVisualClip,
  onUpdateAudioClip,
  onUpdateAudioKeyframe,
  onRemoveAudioKeyframe,
  onUpdateStageObject,
  onMoveAudioToTrack,
  onEditVisualText,
  onRemoveAudioClip,
  onSplitAudioClip,
  onMatchAudioSpeechLevel,
  speechLevelMatchBusy,
  speechLevelMatchMessage,
  dialogueAuditionBusy,
  dialogueAuditionPlaying,
  dialogueAuditionSide,
  dialogueAuditionCalibrated,
  dialogueAuditionSummary,
  dialogueAuditionMessage,
  onDialogueAuditionSide,
  onStopDialogueAudition,
  onSetDialogueAuditionCalibration,
  onRemoveStageObject,
  onSelectSource,
  onAddOrUpdateKeyframe,
  onCommitVisualCropAsImageAsset,
  onGenerateNarrationFromText,
  onJumpKeyframe,
}: {
  visualClip?: EditorVisualClip;
  visualBackingImageItem?: SourceBinItem;
  visualEditorAsset?: EditorAsset;
  visualSourceItem?: SourceBinItem;
  visualSourceDurationSeconds?: number;
  visualDurationSeconds?: number;
  audioDurationSeconds?: number;
  audioSourceDurationSeconds?: number;
  timelineCursorSeconds: number;
  sequenceDurationSeconds: number;
  selectedSourceItem?: SourceBinItem;
  selectedStageObject?: EditorStageObject;
  audioClip?: EditorAudioClip;
  audioClips?: EditorAudioClip[];
  audioTrackCount?: number;
  audioTrackVolumes: number[];
  mutedAudioTracks?: number[];
  soloAudioTracks?: number[];
  audioSourceItemsByClipId?: ReadonlyMap<string, SourceBinItem | undefined>;
  audioSourceItem?: SourceBinItem;
  visualTrackCount?: number;
  onUpdateVisualClip: (patch: Partial<EditorVisualClip>) => void;
  onUpdateVisualKeyframe: (keyframeIndex: number, patch: Parameters<typeof updateVisualKeyframe>[2]) => void;
  onRemoveVisualKeyframe: (keyframeIndex: number) => void;
  onMoveVisualToTrack: (trackIndex: number) => void;
  onRemoveVisualClip: () => void;
  onUpdateAudioClip: (patch: Partial<EditorAudioClip>) => void;
  onUpdateAudioKeyframe: (keyframeIndex: number, patch: Parameters<typeof updateAudioKeyframe>[2]) => void;
  onRemoveAudioKeyframe: (keyframeIndex: number) => void;
  onUpdateStageObject: (patch: Partial<EditorStageObject>) => void;
  onMoveAudioToTrack: (trackIndex: number) => void;
  onEditVisualText: (clip: EditorVisualClip) => void;
  onRemoveAudioClip: () => void;
  onSplitAudioClip: () => boolean;
  onMatchAudioSpeechLevel: () => void;
  speechLevelMatchBusy?: boolean;
  speechLevelMatchMessage?: string;
  dialogueAuditionBusy?: boolean;
  dialogueAuditionPlaying?: boolean;
  dialogueAuditionSide?: DialogueAuditionSide;
  dialogueAuditionCalibrated?: boolean;
  dialogueAuditionSummary?: DialogueAuditionSummary;
  dialogueAuditionMessage?: string;
  onDialogueAuditionSide?: (side: DialogueAuditionSide) => void;
  onStopDialogueAudition?: () => void;
  onSetDialogueAuditionCalibration?: (enabled: boolean) => void;
  onRemoveStageObject: () => void;
  onSelectSource: () => void;
  onAddOrUpdateKeyframe: () => void;
  onCommitVisualCropAsImageAsset: () => void;
  onGenerateNarrationFromText: () => void;
  onJumpKeyframe: (direction: 'previous' | 'next') => void;
}) {
  const [clipEffectPresetId, setClipEffectPresetId] = useState<ClipEffectPresetId>('balanced');
  const visualCrop = visualClip
    ? normalizeClipCrop({
        cropLeftPercent: visualClip.cropLeftPercent,
        cropRightPercent: visualClip.cropRightPercent,
        cropTopPercent: visualClip.cropTopPercent,
        cropBottomPercent: visualClip.cropBottomPercent,
        cropPanXPercent: visualClip.cropPanXPercent,
        cropPanYPercent: visualClip.cropPanYPercent,
        cropRotationDeg: visualClip.cropRotationDeg,
      })
    : undefined;
  const visualProgressPercent = visualClip && visualDurationSeconds
    ? getVisualClipProgressPercent(visualClip, visualDurationSeconds, timelineCursorSeconds)
    : 0;
  const visualCurrentState = visualClip
    ? resolveClipFitState(visualClip, visualProgressPercent)
    : undefined;
  const audioSourceRange = audioClip && audioSourceDurationSeconds
    ? resolveEditorAudioSourceRangeMs(audioClip, audioSourceDurationSeconds)
    : undefined;
  const audioProcessing = normalizeEditorAudioProcessingSettings(audioClip?.audioProcessing);
  const audioDucking = normalizeEditorAudioDuckingSettings(audioClip?.audioDucking);
  const updateAudioProcessing = (patch: Partial<typeof audioProcessing>) => {
    onUpdateAudioClip({
      audioProcessing: normalizeEditorAudioProcessingSettings({ ...audioProcessing, ...patch }),
    });
  };
  const updateAudioDucking = (patch: Partial<typeof audioDucking>) => {
    onUpdateAudioClip({
      audioDucking: normalizeEditorAudioDuckingSettings({ ...audioDucking, ...patch }),
    });
  };
  const duckingControlClips = audioClips.filter((clip) => (
    clip.id !== audioClip?.id
    && clip.enabled
    && isAudioTrackAudible(clip.trackIndex, mutedAudioTracks, soloAudioTracks)
  ));
  const audioCanSplitAtPlayhead = Boolean(
    audioClip
    && audioSourceDurationSeconds
    && splitEditorAudioClipAtTimelineSeconds(
      audioClip,
      audioSourceDurationSeconds,
      timelineCursorSeconds,
      (side) => side,
    ),
  );
  const chromaKey = visualClip ? normalizeClipChromaKey(visualClip.chromaKey) : undefined;
  const stroke = visualClip ? normalizeClipStroke(visualClip.stroke) : undefined;
  const updateVisualCrop = (patch: Partial<NonNullable<typeof visualCrop>>) => {
    if (!visualCrop) {
      return;
    }

    onUpdateVisualClip(normalizeClipCrop({ ...visualCrop, ...patch }));
  };
  const addVisualFilter = (kind: EditorClipFilterKind) => {
    const nextFilter = createClipFilter(kind);
    onUpdateVisualClip({
      filterStack: [...(visualClip?.filterStack ?? []), nextFilter],
    });
  };
  const updateVisualFilter = (filterId: string, patch: Partial<EditorClipFilter>) => {
    if (!visualClip) {
      return;
    }

    onUpdateVisualClip({
      filterStack: visualClip.filterStack.map((filter) =>
        filter.id === filterId ? { ...filter, ...patch } : filter,
      ),
    });
  };
  const removeVisualFilter = (filterId: string) => {
    if (!visualClip) {
      return;
    }

    onUpdateVisualClip({
      filterStack: visualClip.filterStack.filter((filter) => filter.id !== filterId),
    });
  };
  const updateChromaKey = (patch: Partial<NonNullable<typeof chromaKey>>) => {
    if (!chromaKey) {
      return;
    }

    onUpdateVisualClip({
      chromaKey: normalizeClipChromaKey({ ...chromaKey, ...patch }),
    });
  };
  const updateStroke = (patch: Partial<NonNullable<typeof stroke>>) => {
    if (!stroke) {
      return;
    }

    onUpdateVisualClip({
      stroke: normalizeClipStroke({ ...stroke, ...patch }),
    });
  };
  /** Merges a patch into the selected clip's Paper-grade typography (weight/style/leading/tracking/
   *  align/stroke/shadow/arc), shared by the text- and comic-clip inspectors. `onUpdateVisualClip`
   *  does a SHALLOW merge (`{...clip, ...patch}`), so `textTypography` must be spread here rather
   *  than passed as a bare patch, or unrelated fields already set on it would be dropped. */
  const updateTextTypography = (patch: Partial<EditorTextTypography>) => {
    if (!visualClip) {
      return;
    }

    onUpdateVisualClip({
      textTypography: { ...visualClip.textTypography, ...patch },
    });
  };

  return (
    <aside className={`${panelClassName} flex h-full min-h-0 flex-col overflow-hidden`}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-8">
        {selectedStageObject ? (
          <StageObjectInspector
            object={selectedStageObject}
            onRemove={onRemoveStageObject}
            onUpdate={onUpdateStageObject}
          />
        ) : visualClip ? (
          <div className="space-y-4">
            <InspectorHeader
              eyebrow="Selected Visual Clip"
              title={visualSourceItem?.label ?? visualEditorAsset?.label ?? visualClip.sourceNodeId}
            />
            <InfoStack
              rows={[
                ['Source kind', visualClip.sourceKind],
                ['Track', `Video ${visualClip.trackIndex + 1}`],
                ['Start', `${(visualClip.startMs / 1000).toFixed(2)}s`],
                ['Duration', `${(visualDurationSeconds ?? 0).toFixed(1)}s`],
                ['Sequence type', 'Track-timed'],
              ]}
            />
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Video track</span>
              <select
                className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                onChange={(event) => onMoveVisualToTrack(Number(event.target.value))}
                value={visualClip.trackIndex}
              >
                {Array.from({ length: visualTrackCount }, (_, index) => (
                  <option key={index} value={index}>
                    Video {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Start time"
              max={3600}
              min={0}
              onChange={(value) => onUpdateVisualClip({ startMs: Math.max(0, Math.round(value * 1000)) })}
              step={0.1}
              value={visualClip.startMs / 1000}
            />
            {(visualClip.sourceKind === 'image' || visualClip.sourceKind === 'text' || visualClip.sourceKind === 'shape' || visualClip.sourceKind === 'comic') ? (
              <NumberField
                label="Clip duration"
                max={120}
                min={0.25}
                onChange={(value) => onUpdateVisualClip({ durationSeconds: Math.max(0.25, value) })}
                step={0.25}
                value={visualDurationSeconds ?? 4}
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <NumberField
                  label="Trim start"
                  max={Math.max(0, visualSourceDurationSeconds ?? 120)}
                  min={0}
                  onChange={(value) => {
                    const trimStartMs = Math.max(0, Math.round(value * 1000));
                    onUpdateVisualClip({ trimStartMs, sourceInMs: trimStartMs });
                  }}
                  step={0.1}
                  value={visualClip.trimStartMs / 1000}
                />
                <NumberField
                  label="Trim end"
                  max={Math.max(0, visualSourceDurationSeconds ?? 120)}
                  min={0}
                  onChange={(value) => {
                    const trimEndMs = Math.max(0, Math.round(value * 1000));
                    const sourceDurationMs = Math.max(0, Math.round((visualSourceDurationSeconds ?? 0) * 1000));
                    onUpdateVisualClip({
                      trimEndMs,
                      sourceOutMs: sourceDurationMs > 0 ? Math.max(0, sourceDurationMs - trimEndMs) : undefined,
                    });
                  }}
                  step={0.1}
                  value={visualClip.trimEndMs / 1000}
                />
              </div>
            )}
            <NumberField
              label="Playback speed"
              max={4}
              min={0.25}
              onChange={(value) => onUpdateVisualClip({ playbackRate: Math.max(0.25, value) })}
              step={0.05}
              value={visualClip.playbackRate}
            />
            {(visualClip.sourceKind === 'video' || visualClip.sourceKind === 'composition') ? (
              <label className="flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/35 px-3 py-2 text-sm text-gray-300">
                <input
                  checked={visualClip.reversePlayback}
                  onChange={(event) => onUpdateVisualClip({ reversePlayback: event.target.checked })}
                  type="checkbox"
                />
                Reverse Playback
              </label>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-2 text-xs text-gray-400">
                <span>Fit mode</span>
                <select
                  className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                  onChange={(event) => onUpdateVisualClip({ fitMode: event.target.value as EditorVisualClip['fitMode'] })}
                  value={visualCurrentState?.fitMode ?? visualClip.fitMode}
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover / Crop</option>
                  <option value="stretch">Stretch To Canvas</option>
                </select>
              </label>
              <NumberField
                label="Zoom"
                max={300}
                min={10}
                onChange={(value) => onUpdateVisualClip({ scalePercent: Math.max(10, Math.round(value)) })}
                step={1}
                value={visualCurrentState?.scalePercent ?? visualClip.scalePercent}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <RangeControl
                label="Opacity"
                max={100}
                min={0}
                onChange={(value) => onUpdateVisualClip({ opacityPercent: Math.round(value) })}
                value={visualCurrentState?.opacityPercent ?? visualClip.opacityPercent}
                valueLabel={`${Math.round(visualCurrentState?.opacityPercent ?? visualClip.opacityPercent)}%`}
              />
              <NumberField
                label="Rotation"
                max={360}
                min={-360}
                onChange={(value) => onUpdateVisualClip({ rotationDeg: Math.round(value) })}
                step={1}
                value={visualCurrentState?.rotationDeg ?? visualClip.rotationDeg}
              />
            </div>
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
              Transform and opacity controls edit the selected clip keyframe at the playhead. Start and End keyframes exist by default.
            </div>
            <VisualKeyframeInspector
              clip={visualClip}
              durationSeconds={visualDurationSeconds ?? 0}
              onAddOrUpdateKeyframe={onAddOrUpdateKeyframe}
              onJumpKeyframe={onJumpKeyframe}
              onRemoveKeyframe={onRemoveVisualKeyframe}
              onUpdateKeyframe={onUpdateVisualKeyframe}
              timelineCursorSeconds={timelineCursorSeconds}
            />
            {visualCrop ? (
              <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Crop Boundary</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Left"
                    max={95}
                    min={0}
                    onChange={(value) => updateVisualCrop({ cropLeftPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropLeftPercent}
                  />
                  <NumberField
                    label="Right"
                    max={95}
                    min={0}
                    onChange={(value) => updateVisualCrop({ cropRightPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropRightPercent}
                  />
                  <NumberField
                    label="Top"
                    max={95}
                    min={0}
                    onChange={(value) => updateVisualCrop({ cropTopPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropTopPercent}
                  />
                  <NumberField
                    label="Bottom"
                    max={95}
                    min={0}
                    onChange={(value) => updateVisualCrop({ cropBottomPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropBottomPercent}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Pan X"
                    max={100}
                    min={-100}
                    onChange={(value) => updateVisualCrop({ cropPanXPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropPanXPercent}
                  />
                  <NumberField
                    label="Pan Y"
                    max={100}
                    min={-100}
                    onChange={(value) => updateVisualCrop({ cropPanYPercent: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropPanYPercent}
                  />
                  <NumberField
                    label="Crop rotation"
                    max={360}
                    min={-360}
                    onChange={(value) => updateVisualCrop({ cropRotationDeg: Math.round(value) })}
                    step={1}
                    value={visualCrop.cropRotationDeg}
                  />
                </div>
                {visualClip.sourceKind === 'image' ? (
                  <button
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-500/15 disabled:cursor-not-allowed disabled:border-gray-700/60 disabled:bg-[#0f131b] disabled:text-gray-500"
                    disabled={!visualBackingImageItem?.assetUrl}
                    onClick={onCommitVisualCropAsImageAsset}
                    type="button"
                  >
                    Commit Crop As New Image Asset
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="space-y-3 rounded-xl border border-violet-300/20 bg-violet-400/5 p-3" data-video-professional-effects="true">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-100/85">Effects, Compositing &amp; Keying</div>
                <p className="mt-1 text-[11px] leading-5 text-gray-400">
                  Higher video tracks composite above lower tracks. Use opacity or blend mode for layered work, then key a green/blue screen or build a non-destructive filter stack. Preview and export share the same clip settings.
                </p>
              </div>
              <div className="rounded-lg border border-gray-700/60 bg-[#0d1118] p-2.5">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Quick starting point</div>
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    aria-label="Clip effect preset"
                    className="min-w-0 rounded-lg border border-gray-700/60 bg-[#0f131b] px-2.5 py-2 text-xs text-gray-100 outline-none"
                    onChange={(event) => setClipEffectPresetId(event.target.value as ClipEffectPresetId)}
                    value={clipEffectPresetId}
                  >
                    {EDITOR_CLIP_EFFECT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                  </select>
                  <button
                    className="rounded-lg border border-violet-300/30 bg-violet-400/10 px-3 py-2 text-xs font-semibold text-violet-100 hover:border-violet-200/60 hover:bg-violet-400/15"
                    onClick={() => onUpdateVisualClip(buildClipEffectPresetPatch(clipEffectPresetId))}
                    type="button"
                  >
                    Apply preset
                  </button>
                </div>
                <div className="mt-1.5 text-[10px] leading-4 text-gray-500">
                  {EDITOR_CLIP_EFFECT_PRESETS.find((preset) => preset.id === clipEffectPresetId)?.description}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">Add filter</div>
                <div className="flex flex-wrap gap-1.5">
                  {EDITOR_CLIP_FILTER_KINDS.map((kind) => (
                    <button
                      className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-2 py-1 text-[10px] font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
                      key={kind}
                      onClick={() => addVisualFilter(kind)}
                      type="button"
                    >
                      {formatClipFilterKind(kind)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block space-y-2 text-xs text-gray-400">
                <span>Blend mode</span>
                <select
                  className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                  onChange={(event) => onUpdateVisualClip({ blendMode: event.target.value as EditorStageBlendMode })}
                  value={visualClip.blendMode ?? 'normal'}
                >
                  {getClipBlendModes().map((mode) => (
                    <option key={mode} value={mode}>
                      {formatStageBlendModeLabel(mode)}
                    </option>
                  ))}
                </select>
              </label>
              {chromaKey ? (
                <div className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-500/10 p-3">
                  <label className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-100">
                    <span>Chroma Key</span>
                    <input
                      checked={chromaKey.enabled}
                      onChange={(event) => updateChromaKey({ enabled: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block space-y-2 text-xs text-gray-400">
                      <span>Key color</span>
                      <AdvancedColorPicker
                        className="h-10 w-full"
                        buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                        label="Chroma key color"
                        onChange={(color) => updateChromaKey({ color })}
                        value={chromaKey.color}
                      />
                    </label>
                    <RangeControl
                      label="Similarity"
                      max={100}
                      min={0}
                      onChange={(value) => updateChromaKey({ similarityPercent: Math.round(value) })}
                      value={chromaKey.similarityPercent}
                      valueLabel={`${chromaKey.similarityPercent}%`}
                    />
                    <RangeControl
                      label="Edge blend"
                      max={100}
                      min={0}
                      onChange={(value) => updateChromaKey({ blendPercent: Math.round(value) })}
                      value={chromaKey.blendPercent}
                      valueLabel={`${chromaKey.blendPercent}%`}
                    />
                  </div>
                </div>
              ) : null}
              {stroke ? (
                <div className="space-y-3 rounded-lg border border-sky-400/20 bg-sky-500/10 p-3">
                  <label className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">
                    <span>Clip Stroke</span>
                    <input
                      checked={stroke.enabled}
                      onChange={(event) => updateStroke({ enabled: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block space-y-2 text-xs text-gray-400">
                      <span>Stroke color</span>
                      <AdvancedColorPicker
                        className="h-10 w-full"
                        buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                        label="Clip stroke color"
                        onChange={(color) => updateStroke({ color })}
                        value={stroke.color}
                      />
                    </label>
                    <RangeControl
                      label="Stroke width"
                      max={80}
                      min={0}
                      onChange={(value) => updateStroke({ widthPx: Math.round(value) })}
                      value={stroke.widthPx}
                      valueLabel={`${stroke.widthPx}px`}
                    />
                    <RangeControl
                      label="Stroke opacity"
                      max={100}
                      min={0}
                      onChange={(value) => updateStroke({ opacityPercent: Math.round(value) })}
                      value={stroke.opacityPercent}
                      valueLabel={`${stroke.opacityPercent}%`}
                    />
                  </div>
                </div>
              ) : null}
              {visualClip.filterStack.length > 0 ? (
                <div className="space-y-2">
                  {visualClip.filterStack.map((filter) => (
                    <div className="rounded-lg border border-gray-700/60 bg-[#0f131b] p-2" key={filter.id}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-200">
                          <input
                            checked={filter.enabled}
                            onChange={(event) => updateVisualFilter(filter.id, { enabled: event.target.checked })}
                            type="checkbox"
                          />
                          {formatClipFilterKind(filter.kind)}
                        </label>
                        <button
                          className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-100 transition-colors hover:border-red-400/60"
                          onClick={() => removeVisualFilter(filter.id)}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                      <RangeControl
                        label="Amount"
                        max={getClipFilterAmountRange(filter.kind).max}
                        min={getClipFilterAmountRange(filter.kind).min}
                        onChange={(value) => updateVisualFilter(filter.id, { amount: Math.round(value) })}
                        value={filter.amount}
                        valueLabel={`${filter.amount}`}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-gray-500">No filters on this clip.</div>
              )}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/35 px-3 py-2 text-sm text-gray-300">
                <input
                  checked={visualClip.flipHorizontal}
                  onChange={(event) => onUpdateVisualClip({ flipHorizontal: event.target.checked })}
                  type="checkbox"
                />
                Flip Horizontal
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/35 px-3 py-2 text-sm text-gray-300">
                <input
                  checked={visualClip.flipVertical}
                  onChange={(event) => onUpdateVisualClip({ flipVertical: event.target.checked })}
                  type="checkbox"
                />
                Flip Vertical
              </label>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <NumberField
                label="Position X"
                max={2000}
                min={-2000}
                onChange={(value) => onUpdateVisualClip({ positionX: Math.round(value) })}
                step={1}
                value={visualCurrentState?.positionX ?? visualClip.positionX}
              />
              <NumberField
                label="Position Y"
                max={2000}
                min={-2000}
                onChange={(value) => onUpdateVisualClip({ positionY: Math.round(value) })}
                step={1}
                value={visualCurrentState?.positionY ?? visualClip.positionY}
              />
            </div>
            {visualClip.sourceKind === 'comic' ? (
              <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
                  {visualClip.comicKind === 'caption' ? 'Caption' : visualClip.comicKind === 'thought-bubble' ? 'Thought Bubble' : 'Speech Bubble'} · Motion Comic
                </div>
                <label className="block space-y-2 text-xs text-gray-400">
                  <span>Text</span>
                  <textarea
                    className="h-20 w-full resize-none rounded-xl border border-gray-700/60 bg-[#0f131b] p-2 text-sm text-gray-100"
                    onChange={(event) => onUpdateVisualClip({ textContent: event.target.value })}
                    value={visualClip.textContent ?? ''}
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Fill</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Bubble fill color"
                      onChange={(shapeFillColor) => onUpdateVisualClip({ shapeFillColor })}
                      value={visualClip.shapeFillColor ?? '#ffffff'}
                    />
                  </label>
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Outline</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Bubble outline color"
                      onChange={(shapeBorderColor) => onUpdateVisualClip({ shapeBorderColor })}
                      value={visualClip.shapeBorderColor ?? '#181b20'}
                    />
                  </label>
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Text color</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Bubble text color"
                      onChange={(textColor) => onUpdateVisualClip({ textColor })}
                      value={visualClip.textColor}
                    />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Font size"
                    max={400}
                    min={8}
                    onChange={(value) => onUpdateVisualClip({ textSizePx: Math.max(8, Math.round(value)) })}
                    step={1}
                    value={visualClip.textSizePx}
                  />
                  <NumberField
                    label="Outline width"
                    max={40}
                    min={0}
                    onChange={(value) => onUpdateVisualClip({ shapeBorderWidth: Math.max(0, Math.round(value)) })}
                    step={1}
                    value={visualClip.shapeBorderWidth ?? 6}
                  />
                  <NumberField
                    label="Line height %"
                    max={240}
                    min={80}
                    onChange={(value) => updateTextTypography({ lineHeightPercent: Math.max(80, Math.min(240, Math.round(value))) })}
                    step={5}
                    value={visualClip.textTypography?.lineHeightPercent ?? visualClip.comicLineHeightPercent ?? 120}
                  />
                  <NumberField
                    label="Letter spacing"
                    max={24}
                    min={-4}
                    onChange={(value) => updateTextTypography({ letterSpacingPx: Math.max(-4, Math.min(24, Math.round(value))) })}
                    step={1}
                    value={visualClip.textTypography?.letterSpacingPx ?? visualClip.comicLetterSpacingPx ?? 0}
                  />
                </div>
                {visualClip.comicKind !== 'caption'
                  ? (() => {
                      const tipXPercent = Math.round(
                        visualCurrentState?.tailTipXPercent ?? visualClip.comicTailTipXPercent ?? COMIC_TAIL_DEFAULT_TIP_X_PERCENT,
                      );
                      const tipYPercent = Math.round(
                        visualCurrentState?.tailTipYPercent ?? visualClip.comicTailTipYPercent ?? COMIC_TAIL_DEFAULT_TIP_Y_PERCENT,
                      );
                      const curvePercent = Math.round(
                        visualCurrentState?.tailCurvePercent ?? visualClip.comicTailCurvePercent ?? 50,
                      );
                      const keyframeCount = visualClip.keyframes?.length ?? 0;
                      const curveLabel =
                        curvePercent === 50 ? 'straight' : curvePercent > 50 ? 'bows ▶' : 'bows ◀';
                      return (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/70">
                              Tail &amp; Funnel
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                keyframeCount > 0
                                  ? 'border-amber-300/50 bg-amber-500/10 text-amber-100'
                                  : 'border-gray-700/60 text-gray-400'
                              }`}
                              title="The tail tip and funnel curvature keyframe at the current playhead, independently of the bubble body."
                            >
                              <span aria-hidden>◆</span>
                              {keyframeCount > 0 ? `${keyframeCount} keyframes` : 'Static tail'}
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug text-gray-500">
                            Drag the amber handle on the stage to move the tail tip — it and the funnel curvature
                            animate separately from the bubble body.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            <NumberField
                              label="Tail tip X %"
                              max={160}
                              min={-60}
                              onChange={(value) => onUpdateVisualClip({ comicTailTipXPercent: Math.round(value) })}
                              step={1}
                              value={tipXPercent}
                            />
                            <NumberField
                              label="Tail tip Y %"
                              max={160}
                              min={-60}
                              onChange={(value) => onUpdateVisualClip({ comicTailTipYPercent: Math.round(value) })}
                              step={1}
                              value={tipYPercent}
                            />
                          </div>
                          <RangeControl
                            label="Funnel curvature"
                            max={100}
                            min={0}
                            onChange={(value) => onUpdateVisualClip({ comicTailCurvePercent: Math.round(value) })}
                            value={curvePercent}
                            valueLabel={`${curvePercent} · ${curveLabel}`}
                          />
                        </div>
                      );
                    })()
                  : null}
                <div className="flex gap-2">
                  {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${(visualClip.textTypography?.textAlign ?? visualClip.comicTextAlign ?? 'center') === align ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100' : 'border-gray-700/60 text-gray-400 hover:text-gray-200'}`}
                      key={align}
                      onClick={() => updateTextTypography({ textAlign: align })}
                      type="button"
                    >
                      {align === 'left' ? 'Left' : align === 'center' ? 'Center' : align === 'right' ? 'Right' : 'Justify'}
                    </button>
                  ))}
                </div>
                <TypographyAdvancedControls typography={visualClip.textTypography} updateTypography={updateTextTypography} />
              </div>
            ) : null}
            {visualClip.sourceKind === 'text' ? (
              <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Text</div>
                  <button
                    className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-2.5 py-1.5 text-[11px] font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
                    onClick={() => onEditVisualText(visualClip)}
                    type="button"
                  >
                    Edit Text
                  </button>
                </div>
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-300/60 hover:bg-cyan-500/15"
                  onClick={onGenerateNarrationFromText}
                  type="button"
                >
                  Generate Narration Audio From Text
                </button>
                <label className="block space-y-2 text-xs text-gray-400">
                  <span>Text</span>
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                    onChange={(event) => onUpdateVisualClip({ textContent: event.target.value })}
                    value={visualClip.textContent ?? visualSourceItem?.text ?? visualEditorAsset?.textDefaults?.text ?? ''}
                  />
                </label>
                <label className="block space-y-2 text-xs text-gray-400">
                  <span>Font family</span>
                  <input
                    className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                    onChange={(event) => onUpdateVisualClip({
                      textFontFamily: event.target.value,
                      textTypography: { ...visualClip.textTypography, managedFace: undefined, managedFaceIssue: undefined },
                    })}
                    type="text"
                    value={visualClip.textFontFamily}
                  />
                </label>
                <BundledFontBrowser
                  onSelect={(family, face) => onUpdateVisualClip({
                    textFontFamily: family.family,
                    textTypography: {
                      ...visualClip.textTypography,
                      fontWeight: face.weight,
                      fontStyle: face.style,
                      managedFace: createBundledFontFaceReference(family, face),
                      managedFaceIssue: undefined,
                    },
                  })}
                  style={visualClip.textTypography?.fontStyle ?? 'normal'}
                  value={visualClip.textFontFamily}
                  weight={visualClip.textTypography?.fontWeight ?? 400}
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Font size"
                    max={256}
                    min={12}
                    onChange={(value) => onUpdateVisualClip({ textSizePx: Math.max(12, Math.round(value)) })}
                    step={1}
                    value={visualClip.textSizePx}
                  />
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Text color</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Visual clip text color"
                      onChange={(textColor) => onUpdateVisualClip({ textColor })}
                      value={visualClip.textColor}
                    />
                  </label>
                </div>
                <label className="block space-y-2 text-xs text-gray-400">
                  <span>Text effect</span>
                  <select
                    className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                    onChange={(event) => onUpdateVisualClip({ textEffect: event.target.value as EditorVisualClip['textEffect'] })}
                    value={visualClip.textEffect}
                  >
                    <option value="none">None</option>
                    <option value="shadow">Shadow</option>
                    <option value="glow">Glow</option>
                    <option value="outline">Outline</option>
                  </select>
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Line height %"
                    max={240}
                    min={80}
                    onChange={(value) => updateTextTypography({ lineHeightPercent: Math.max(80, Math.min(240, Math.round(value))) })}
                    step={5}
                    value={visualClip.textTypography?.lineHeightPercent ?? 112}
                  />
                  <NumberField
                    label="Letter spacing"
                    max={24}
                    min={-4}
                    onChange={(value) => updateTextTypography({ letterSpacingPx: Math.max(-4, Math.min(24, Math.round(value))) })}
                    step={1}
                    value={visualClip.textTypography?.letterSpacingPx ?? 0}
                  />
                </div>
                <div className="flex gap-2">
                  {(['left', 'center', 'right', 'justify'] as const).map((align) => (
                    <button
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${(visualClip.textTypography?.textAlign ?? 'center') === align ? 'border-cyan-300/50 bg-cyan-500/10 text-cyan-100' : 'border-gray-700/60 text-gray-400 hover:text-gray-200'}`}
                      key={align}
                      onClick={() => updateTextTypography({ textAlign: align })}
                      type="button"
                    >
                      {align === 'left' ? 'Left' : align === 'center' ? 'Center' : align === 'right' ? 'Right' : 'Justify'}
                    </button>
                  ))}
                </div>
                <TypographyAdvancedControls typography={visualClip.textTypography} updateTypography={updateTextTypography} />
              </div>
            ) : null}
            {visualClip.sourceKind === 'shape' ? (
              <div className="space-y-3 rounded-xl border border-gray-700/60 bg-[#111217]/35 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Shape</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Fill</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Visual clip shape fill color"
                      onChange={(shapeFillColor) => onUpdateVisualClip({ shapeFillColor })}
                      value={visualClip.shapeFillColor ?? '#0ea5e9'}
                    />
                  </label>
                  <label className="block space-y-2 text-xs text-gray-400">
                    <span>Border</span>
                    <AdvancedColorPicker
                      className="h-11 w-full"
                      buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                      label="Visual clip shape border color"
                      onChange={(shapeBorderColor) => onUpdateVisualClip({ shapeBorderColor })}
                      value={visualClip.shapeBorderColor ?? '#f8fafc'}
                    />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <NumberField
                    label="Border width"
                    max={80}
                    min={0}
                    onChange={(value) => onUpdateVisualClip({ shapeBorderWidth: Math.max(0, Math.round(value)) })}
                    step={1}
                    value={visualClip.shapeBorderWidth ?? 2}
                  />
                  <NumberField
                    label="Corner radius"
                    max={300}
                    min={0}
                    onChange={(value) => onUpdateVisualClip({ shapeCornerRadius: Math.max(0, Math.round(value)) })}
                    step={1}
                    value={visualClip.shapeCornerRadius ?? 18}
                  />
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-2 text-xs text-gray-400">
                <span>Transition in</span>
                <select
                  className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                  onChange={(event) => onUpdateVisualClip({ transitionIn: event.target.value as EditorVisualClip['transitionIn'] })}
                  value={visualClip.transitionIn}
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="slide-left">Slide left</option>
                  <option value="slide-right">Slide right</option>
                  <option value="slide-up">Slide up</option>
                  <option value="slide-down">Slide down</option>
                </select>
              </label>
              <label className="block space-y-2 text-xs text-gray-400">
                <span>Transition out</span>
                <select
                  className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                  onChange={(event) => onUpdateVisualClip({ transitionOut: event.target.value as EditorVisualClip['transitionOut'] })}
                  value={visualClip.transitionOut}
                >
                  <option value="none">None</option>
                  <option value="fade">Fade</option>
                  <option value="slide-left">Slide left</option>
                  <option value="slide-right">Slide right</option>
                  <option value="slide-up">Slide up</option>
                  <option value="slide-down">Slide down</option>
                </select>
              </label>
            </div>
            <NumberField
              label="Transition duration"
              max={5}
              min={0}
              onChange={(value) => onUpdateVisualClip({ transitionDurationMs: Math.max(0, Math.round(value * 1000)) })}
              step={0.1}
              value={visualClip.transitionDurationMs / 1000}
            />
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/15"
              onClick={onRemoveVisualClip}
              type="button"
            >
              <Trash2 size={14} />
              Remove From Cut
            </button>
          </div>
        ) : audioClip ? (
          <div className="space-y-4">
            <InspectorHeader
              eyebrow="Selected Audio Clip"
              title={audioSourceItem?.label ?? audioClip.sourceNodeId}
            />
            <InfoStack
              rows={[
                ['Lane', `Audio ${audioClip.trackIndex + 1}`],
                ['Start', `${(audioClip.offsetMs / 1000).toFixed(2)}s`],
                ['Source range', audioSourceRange ? `${(audioSourceRange.sourceInMs / 1_000).toFixed(2)}–${(audioSourceRange.sourceOutMs / 1_000).toFixed(2)}s` : 'Unknown'],
                ['Clip duration', `${(audioDurationSeconds ?? 0).toFixed(2)}s`],
                ['Track volume', formatAudioPercentWithDecibels(audioTrackVolumes[audioClip.trackIndex] ?? 100)],
                ['Speech match', audioClip.measuredMatchGainDb !== undefined ? `${audioClip.measuredMatchGainDb >= 0 ? '+' : ''}${audioClip.measuredMatchGainDb.toFixed(2)} dB` : 'Not measured'],
                ['Enabled', audioClip.enabled ? 'Yes' : 'No'],
              ]}
            />
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Track</span>
              <select
                className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                onChange={(event) => onMoveAudioToTrack(Number(event.target.value))}
                value={audioClip.trackIndex}
              >
                {Array.from({ length: audioTrackCount }, (_, index) => (
                  <option key={index} value={index}>
                    Audio {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Start time"
              max={3600}
              min={0}
              onChange={(value) => onUpdateAudioClip({ offsetMs: Math.max(0, Math.round(value * 1000)) })}
              step={0.1}
              value={audioClip.offsetMs / 1000}
            />
            {audioSourceRange && audioSourceDurationSeconds ? (
              <div className="grid grid-cols-2 gap-2">
                <NumberField
                  label="Source in"
                  max={Math.max(0, (audioSourceRange.sourceOutMs - 10) / 1_000)}
                  min={0}
                  onChange={(value) => onUpdateAudioClip(trimEditorAudioClipEdge(
                    audioClip,
                    'start',
                    value - audioSourceRange.sourceInMs / 1_000,
                    audioSourceDurationSeconds,
                  ))}
                  step={0.01}
                  value={audioSourceRange.sourceInMs / 1_000}
                />
                <NumberField
                  label="Source out"
                  max={audioSourceDurationSeconds}
                  min={(audioSourceRange.sourceInMs + 10) / 1_000}
                  onChange={(value) => onUpdateAudioClip(trimEditorAudioClipEdge(
                    audioClip,
                    'end',
                    value - audioSourceRange.sourceOutMs / 1_000,
                    audioSourceDurationSeconds,
                  ))}
                  step={0.01}
                  value={audioSourceRange.sourceOutMs / 1_000}
                />
              </div>
            ) : null}
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/55 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-cyan-300/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!audioCanSplitAtPlayhead}
              onClick={onSplitAudioClip}
              title={audioCanSplitAtPlayhead ? 'Split the source range and volume envelope at the playhead' : 'Place the playhead inside the clip and outside its active fades'}
              type="button"
            >
              <Scissors size={14} />
              Split At Playhead
            </button>
            <RangeControl
              label="Clip volume"
              max={150}
              min={0}
              onChange={(value) => onUpdateAudioClip({ volumePercent: value })}
              value={audioClip.volumePercent}
              valueLabel={formatAudioPercentWithDecibels(audioClip.volumePercent)}
            />
            {audioClip.loudnessReferenceSourceNodeId || audioClip.loudnessReferenceClipId ? (
              <div className="space-y-2 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                <div className="text-xs font-semibold text-cyan-100">Original / Clean Dialogue</div>
                <label className="flex items-center gap-2 text-[11px] text-gray-300">
                  <input
                    checked={dialogueAuditionCalibrated ?? true}
                    disabled={audioClip.measuredMatchGainDb === undefined}
                    onChange={(event) => onSetDialogueAuditionCalibration?.(event.target.checked)}
                    type="checkbox"
                  />
                  Calibrate Clean dry with measured match{audioClip.measuredMatchGainDb !== undefined ? ` (${audioClip.measuredMatchGainDb >= 0 ? '+' : ''}${audioClip.measuredMatchGainDb.toFixed(2)} dB)` : ' (measure first)'}
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    ['original-dry', 'Original · dry'],
                    ['clean-dry', 'Clean · dry'],
                    ['clean-processed', 'Processed · approx.'],
                  ] as const).map(([side, label]) => (
                    <button
                      className={`rounded-lg border px-2 py-2 text-[10px] font-semibold transition-colors ${
                        dialogueAuditionPlaying && dialogueAuditionSide === side
                          ? 'border-cyan-200 bg-cyan-400/20 text-white'
                          : 'border-gray-700/70 bg-[#0f131b] text-gray-300 hover:border-cyan-400/50 hover:text-white'
                      }`}
                      disabled={dialogueAuditionBusy || !onDialogueAuditionSide}
                      key={side}
                      onClick={() => onDialogueAuditionSide?.(side)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {dialogueAuditionPlaying ? (
                  <button
                    className="w-full rounded-lg border border-gray-700/60 bg-[#111217]/60 px-2 py-1.5 text-[10px] font-semibold text-gray-300 hover:text-white"
                    onClick={onStopDialogueAudition}
                    type="button"
                  >
                    Stop one-shot audition
                  </button>
                ) : null}
                <p className="text-[10px] leading-4 text-gray-500">
                  Original and Clean dry are synchronized from one common source window. Clean processed is a browser approximation of saved clip processors; rendered output is authoritative and timeline volume, fades, track summing, and encoding are not auditioned here.
                </p>
                {dialogueAuditionBusy ? <div className="text-[11px] text-cyan-100">Preparing up to 30 seconds around the playhead…</div> : null}
                {dialogueAuditionMessage ? <div className="text-[11px] text-gray-300">{dialogueAuditionMessage}</div> : null}
                {dialogueAuditionSummary ? (
                  <div className="text-[10px] leading-4 text-gray-500">
                    Original dry {dialogueAuditionSummary.originalRmsDbfs.toFixed(1)} dBFS RMS · Clean dry {dialogueAuditionSummary.cleanDryRmsDbfs.toFixed(1)} dBFS RMS · Audition sample peak {dialogueAuditionSummary.cleanOutputSamplePeakDbfs.toFixed(1)} dBFS · {dialogueAuditionSummary.durationSeconds.toFixed(1)}s
                  </div>
                ) : null}
                <p className="text-[11px] leading-5 text-gray-400">
                  Measures active speech only, averages channel energy, clamps correction to ±12 dB, and limits the automatic correction against a −3 dBFS sample-peak ceiling. Later creative volume/keyframes remain yours. This is not LUFS normalization.
                </p>
                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-300/60 disabled:cursor-wait disabled:opacity-50"
                  disabled={speechLevelMatchBusy}
                  onClick={onMatchAudioSpeechLevel}
                  type="button"
                >
                  <Music2 size={14} />
                  {speechLevelMatchBusy ? 'Measuring Speech…' : 'Match Speech Level'}
                </button>
                {speechLevelMatchMessage ? <div className="text-[11px] text-gray-300">{speechLevelMatchMessage}</div> : null}
                {audioClip.speechLevelMatchMeasurement ? (
                  <div className="text-[10px] leading-4 text-gray-500">
                    Original {audioClip.speechLevelMatchMeasurement.originalActiveRmsDbfs.toFixed(1)} dBFS · Clean {audioClip.speechLevelMatchMeasurement.cleanActiveRmsDbfs.toFixed(1)} dBFS · {audioClip.speechLevelMatchMeasurement.activeDurationSeconds.toFixed(2)}s active
                  </div>
                ) : null}
                {audioClip.measuredMatchGainDb !== undefined ? (
                  <button
                    className="text-[11px] font-semibold text-gray-400 underline decoration-gray-600 underline-offset-2 hover:text-white"
                    onClick={() => onUpdateAudioClip({ measuredMatchGainDb: undefined, speechLevelMatchMeasurement: undefined })}
                    type="button"
                  >
                    Clear measured correction
                  </button>
                ) : null}
              </div>
            ) : null}
            <details className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3" open>
              <summary className="cursor-pointer text-xs font-semibold text-violet-100">Clip Audio Processing</summary>
              <div className="mt-3 space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-700/60 bg-[#0f131b]/70 px-3 py-2 text-xs text-gray-200">
                  <span>
                    <span className="block font-semibold">Processing enabled</span>
                    <span className="mt-0.5 block text-[10px] font-normal text-gray-500">Bypass leaves trim, speech match, creative volume, fades, mute, and solo active.</span>
                  </span>
                  <input checked={audioProcessing.processingEnabled} onChange={(event) => updateAudioProcessing({ processingEnabled: event.target.checked })} type="checkbox" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-2 py-2 text-[10px] font-semibold text-violet-100 hover:border-violet-300/60"
                    onClick={() => onUpdateAudioClip({ audioProcessing: { ...RECOMMENDED_DIALOGUE_AUDIO_PROCESSING } })}
                    type="button"
                  >
                    Dialogue preset
                  </button>
                  <button
                    className="rounded-lg border border-gray-700/60 bg-[#0f131b] px-2 py-2 text-[10px] font-semibold text-gray-300 hover:text-white"
                    onClick={() => onUpdateAudioClip({ audioProcessing: { ...DEFAULT_EDITOR_AUDIO_PROCESSING } })}
                    type="button"
                  >
                    Reset / bypass all
                  </button>
                </div>

                <AudioProcessorSection
                  checked={audioProcessing.highPassEnabled}
                  label="High-pass filter"
                  onToggle={(checked) => updateAudioProcessing({ highPassEnabled: checked })}
                >
                  <NumberField label="Cutoff" max={400} min={20} onChange={(value) => updateAudioProcessing({ highPassHz: value })} step={1} value={audioProcessing.highPassHz} />
                </AudioProcessorSection>
                <AudioProcessorSection
                  checked={audioProcessing.lowPassEnabled}
                  label="Low-pass filter"
                  onToggle={(checked) => updateAudioProcessing({ lowPassEnabled: checked })}
                >
                  <NumberField label="Cutoff" max={20_000} min={1_000} onChange={(value) => updateAudioProcessing({ lowPassHz: value })} step={100} value={audioProcessing.lowPassHz} />
                </AudioProcessorSection>
                <AudioProcessorSection
                  checked={audioProcessing.gateEnabled}
                  description="A linked downward expander; the range limits reduction instead of forcing hard silence."
                  label="Gate / downward expander"
                  onToggle={(checked) => updateAudioProcessing({ gateEnabled: checked })}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Threshold dBFS" max={-10} min={-70} onChange={(value) => updateAudioProcessing({ gateThresholdDbfs: value })} step={1} value={audioProcessing.gateThresholdDbfs} />
                    <NumberField label="Max reduction dB" max={0} min={-80} onChange={(value) => updateAudioProcessing({ gateRangeDb: value })} step={1} value={audioProcessing.gateRangeDb} />
                    <NumberField label="Ratio" max={20} min={1} onChange={(value) => updateAudioProcessing({ gateRatio: value })} step={0.5} value={audioProcessing.gateRatio} />
                    <NumberField label="Attack ms" max={200} min={0.1} onChange={(value) => updateAudioProcessing({ gateAttackMs: value })} step={1} value={audioProcessing.gateAttackMs} />
                    <NumberField label="Release ms" max={2_000} min={10} onChange={(value) => updateAudioProcessing({ gateReleaseMs: value })} step={10} value={audioProcessing.gateReleaseMs} />
                  </div>
                </AudioProcessorSection>
                <AudioProcessorSection
                  checked={audioProcessing.compressorEnabled}
                  label="Compressor"
                  onToggle={(checked) => updateAudioProcessing({ compressorEnabled: checked })}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Threshold dBFS" max={0} min={-50} onChange={(value) => updateAudioProcessing({ compressorThresholdDbfs: value })} step={1} value={audioProcessing.compressorThresholdDbfs} />
                    <NumberField label="Ratio" max={20} min={1} onChange={(value) => updateAudioProcessing({ compressorRatio: value })} step={0.5} value={audioProcessing.compressorRatio} />
                    <NumberField label="Attack ms" max={200} min={0.1} onChange={(value) => updateAudioProcessing({ compressorAttackMs: value })} step={1} value={audioProcessing.compressorAttackMs} />
                    <NumberField label="Release ms" max={2_000} min={10} onChange={(value) => updateAudioProcessing({ compressorReleaseMs: value })} step={10} value={audioProcessing.compressorReleaseMs} />
                    <NumberField label="Makeup dB" max={12} min={0} onChange={(value) => updateAudioProcessing({ compressorMakeupGainDb: value })} step={0.5} value={audioProcessing.compressorMakeupGainDb} />
                  </div>
                </AudioProcessorSection>
                <AudioProcessorSection
                  checked={audioProcessing.limiterEnabled}
                  description="Limits this clip before tracks are summed; it is not a final-mix or broadcast loudness limiter."
                  label="Clip limiter"
                  onToggle={(checked) => updateAudioProcessing({ limiterEnabled: checked })}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField label="Ceiling dBFS" max={-0.1} min={-12} onChange={(value) => updateAudioProcessing({ limiterCeilingDbfs: value })} step={0.1} value={audioProcessing.limiterCeilingDbfs} />
                    <NumberField label="Release ms" max={1_000} min={10} onChange={(value) => updateAudioProcessing({ limiterReleaseMs: value })} step={10} value={audioProcessing.limiterReleaseMs} />
                  </div>
                </AudioProcessorSection>
                <p className="text-[10px] leading-4 text-gray-500">
                  Export uses the authoritative FFmpeg processor chain. Clean processed audition uses comparable browser DSP, but detector, lookahead, gate, and limiter behavior are not sample-identical. The clip limiter cannot prevent later track summing or lossy encoding overshoot.
                </p>
              </div>
            </details>
            <details className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3" open={audioDucking.enabled}>
              <summary className="cursor-pointer text-xs font-semibold text-amber-100">Auto-ducking</summary>
              <div className="mt-3 space-y-3">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-gray-700/60 bg-[#0f131b]/70 px-3 py-2 text-xs text-gray-200">
                  <span>
                    <span className="block font-semibold">Lower this clip from a control clip</span>
                    <span className="mt-0.5 block text-[10px] font-normal text-gray-500">A bounded native side-chain envelope lowers dialogue/music deterministically.</span>
                  </span>
                  <input checked={audioDucking.enabled} onChange={(event) => updateAudioDucking({ enabled: event.target.checked })} type="checkbox" />
                </label>
                <label className="block space-y-2 text-xs text-gray-400">
                  <span>Control clip</span>
                  <select
                    className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
                    onChange={(event) => updateAudioDucking({ controlClipId: event.target.value || undefined })}
                    value={audioDucking.controlClipId ?? ''}
                  >
                    <option value="">Select a control clip</option>
                    {duckingControlClips.map((clip) => (
                      <option key={clip.id} value={clip.id}>
                        {audioSourceItemsByClipId?.get(clip.id)?.label ?? `Audio track ${clip.trackIndex + 1}`} · A{clip.trackIndex + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Depth %" max={100} min={0} onChange={(value) => updateAudioDucking({ depthPercent: value })} step={1} value={audioDucking.depthPercent} />
                  <NumberField label="Threshold dBFS" max={-10} min={-60} onChange={(value) => updateAudioDucking({ thresholdDbfs: value })} step={1} value={audioDucking.thresholdDbfs} />
                  <NumberField label="Attack ms" max={200} min={1} onChange={(value) => updateAudioDucking({ attackMs: value })} step={1} value={audioDucking.attackMs} />
                  <NumberField label="Release ms" max={2_000} min={10} onChange={(value) => updateAudioDucking({ releaseMs: value })} step={10} value={audioDucking.releaseMs} />
                </div>
                <button
                  className="w-full rounded-lg border border-gray-700/60 bg-[#0f131b] px-2 py-2 text-[10px] font-semibold text-gray-300 hover:text-white"
                  onClick={() => onUpdateAudioClip({ audioDucking: { ...DEFAULT_EDITOR_AUDIO_DUCKING } })}
                  type="button"
                >
                  Reset auto-ducking
                </button>
                <p className="text-[10px] leading-4 text-gray-500">
                  Native FFmpeg render/export is authoritative. Browser composition refuses enabled auto-ducking instead of silently dropping the control signal; missing, disabled, deleted, or self-referenced controls fail closed. Thresholds are bounded to FFmpeg's executable −60 to −10 dBFS range. Timeline and monitor preview stay un-ducked; only the native render applies the control signal. This is bounded side-chain attenuation, not loudness mastering.
                </p>
              </div>
            </details>
            <div className="grid grid-cols-2 gap-2">
              <NumberField
                label="Fade in"
                max={Math.min(5, (audioDurationSeconds ?? 0) / 2)}
                min={0}
                onChange={(value) => onUpdateAudioClip({
                  fadeInSeconds: clampAudioFadeSeconds(value, audioDurationSeconds ?? 0),
                })}
                step={0.01}
                value={audioClip.fadeInSeconds ?? 0}
              />
              <NumberField
                label="Fade out"
                max={Math.min(5, (audioDurationSeconds ?? 0) / 2)}
                min={0}
                onChange={(value) => onUpdateAudioClip({
                  fadeOutSeconds: clampAudioFadeSeconds(value, audioDurationSeconds ?? 0),
                })}
                step={0.01}
                value={audioClip.fadeOutSeconds ?? 0}
              />
            </div>
            {audioClip.volumeAutomationPoints?.length ? (
              <button
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-300/60"
                onClick={() => onUpdateAudioClip({ volumeAutomationPoints: undefined })}
                type="button"
              >
                Reset Volume Automation
              </button>
            ) : null}
            <AudioKeyframeInspector
              clip={audioClip}
              durationSeconds={audioDurationSeconds ?? 0}
              onAddOrUpdateKeyframe={onAddOrUpdateKeyframe}
              onJumpKeyframe={onJumpKeyframe}
              onRemoveKeyframe={onRemoveAudioKeyframe}
              onUpdateKeyframe={onUpdateAudioKeyframe}
              timelineCursorSeconds={timelineCursorSeconds}
            />
            <label className="flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#111217]/35 px-3 py-2 text-sm text-gray-300">
              <input
                checked={audioClip.enabled}
                onChange={(event) => onUpdateAudioClip({ enabled: event.target.checked })}
                type="checkbox"
              />
              Enabled In Render
            </label>
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/15"
              onClick={onRemoveAudioClip}
              type="button"
            >
              <Trash2 size={14} />
              Remove From Lane
            </button>
          </div>
        ) : selectedSourceItem ? (
          <div className="space-y-4">
            <InspectorHeader eyebrow="Selected Source" title={selectedSourceItem.label} />
            <InfoStack
              rows={[
                ['Kind', selectedSourceItem.kind],
                ['Asset id', selectedSourceItem.nodeId],
                ['Sequence length', sequenceDurationSeconds > 0 ? `${sequenceDurationSeconds.toFixed(1)}s` : '0.0s'],
              ]}
            />
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
              onClick={onSelectSource}
              type="button"
            >
              <Archive size={14} />
              Keep Focused In Source Monitor
            </button>
          </div>
        ) : (
          <EmptyState
            title="Nothing selected"
          />
        )}
      </div>
    </aside>
  );
}

export interface TrackMenuOption {
  trackIndex: number;
  label: string;
}

export function buildTrackMenuOptions(trackCount: number, noun: string): TrackMenuOption[] {
  return Array.from({ length: Math.max(0, trackCount) }, (_, trackIndex) => ({
    trackIndex,
    label: `${noun} ${trackIndex + 1}`,
  }));
}

/**
 * UX review F05 — replaces the cryptic V1–V4 / A1–A2 clip buttons with a primary "+Add"
 * (drops onto the first track) plus a labelled track menu for picking a specific lane.
 * The menu is a native <details> disclosure so it renders for tests and stays keyboard
 * accessible.
 */
export function TrackAddControl({
  icon: Icon,
  noun,
  trackCount,
  onAdd,
  compact = false,
}: {
  icon: ComponentType<{ size?: number }>;
  noun: string;
  trackCount: number;
  onAdd: (trackIndex: number) => void;
  compact?: boolean;
}) {
  const options = buildTrackMenuOptions(trackCount, noun);
  if (options.length === 0) {
    return null;
  }

  const primary = options[0];
  const hasTrackMenu = options.length > 1;
  const buttonPadding = compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-[11px]';

  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-gray-700/60 bg-[#0f131b]">
      <button
        className={`inline-flex items-center gap-1 font-semibold text-gray-200 transition-colors hover:bg-[#161c26] hover:text-white ${buttonPadding}`}
        onClick={(event) => {
          event.stopPropagation();
          onAdd(primary.trackIndex);
        }}
        title={`Add to ${primary.label}`}
        type="button"
      >
        <Icon size={12} />
        <Plus size={11} />
        <span>Add {noun}</span>
      </button>
      {hasTrackMenu ? (
        <details className="relative border-l border-gray-700/60">
          <summary
            aria-label={`Choose ${noun} track`}
            className={`flex cursor-pointer list-none items-center justify-center text-gray-300 transition-colors hover:bg-[#161c26] hover:text-white [&::-webkit-details-marker]:hidden ${
              compact ? 'px-1.5 py-1' : 'px-2 py-1.5'
            }`}
            onClick={(event) => event.stopPropagation()}
            title={`Choose ${noun} track`}
          >
            <ChevronDown size={12} />
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-36 rounded-lg border border-gray-700/60 bg-[#0d0f15] p-1 shadow-2xl">
            <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-500">
              {noun} tracks
            </div>
            {options.map((option) => (
              <button
                key={option.trackIndex}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-gray-200 transition-colors hover:bg-[#1a212d] hover:text-white"
                onClick={(event) => {
                  event.stopPropagation();
                  onAdd(option.trackIndex);
                  event.currentTarget.closest('details')?.removeAttribute('open');
                }}
                type="button"
              >
                <Icon size={11} />
                {option.label}
              </button>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function SourceItemCard({
  item,
  durationSeconds,
  mediaInfo,
  isSelected,
  onSelect,
  onAddVisual,
  onAddAudio,
  alignmentScriptSelected,
  onAlignCaptions,
  onApplyCaptions,
  onAutoCaptions,
  onCleanDialogue,
  onOpenPreview,
  onRelink,
  relinkDisabled = false,
  onToggleCollapsed,
  onToggleStarred,
  onUseAsAlignmentScript,
  onRemove,
}: {
  item: SourceBinItem;
  durationSeconds?: number;
  mediaInfo?: SourceMediaInfo;
  isSelected: boolean;
  onSelect: () => void;
  onAddVisual: (trackIndex: number) => void;
  onAddAudio: (trackIndex: number) => void;
  alignmentScriptSelected?: boolean;
  onAlignCaptions?: () => void;
  onApplyCaptions?: () => void;
  onAutoCaptions?: () => void;
  onCleanDialogue?: () => void;
  onOpenPreview: () => void;
  onRelink?: () => void;
  relinkDisabled?: boolean;
  onToggleCollapsed: () => void;
  onToggleStarred: () => void;
  onUseAsAlignmentScript?: () => void;
  onRemove: () => void;
}) {
  const isCollapsed = Boolean(item.collapsed);
  const isStarred = Boolean(item.starred);
  const previewSupportLabel = getBrowserPreviewSupportLabel(item.label, item.mimeType);
  const origin = resolveSourceBinItemOrigin(item);
  const storageLabel = item.nativeFilePath
    ? item.scratchFileName ? 'Project copy' : 'Linked original'
    : item.durability === 'session-only'
      ? 'Session media'
      : item.durability === 'recovery-inline'
        ? 'Embedded recovery'
        : undefined;
  const dimensionsLabel = mediaInfo?.width && mediaInfo.height
    ? `${Math.round(mediaInfo.width)}×${Math.round(mediaInfo.height)}`
    : undefined;

  return (
    <div
      className={`w-full cursor-grab rounded-lg border p-2.5 text-left transition-colors active:cursor-grabbing ${
        isSelected
          ? 'border-blue-400/60 bg-blue-500/10'
          : 'border-gray-700/60 bg-[#111217]/35 hover:border-gray-500 hover:bg-[#161c26]'
      }`}
      draggable
      style={{ contentVisibility: 'auto', containIntrinsicSize: '0 184px' }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-flow-source-bin-item', JSON.stringify({ itemId: item.id }));
      }}
    >
      <div className="flex items-start gap-2">
        <button
          className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-700/60 bg-[#0d0f15] text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapsed();
          }}
          title={isCollapsed ? 'Expand item' : 'Collapse item'}
          type="button"
        >
          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <button
          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors ${
            isStarred
              ? 'border-amber-300/40 bg-amber-400/15 text-amber-200'
              : 'border-gray-700/60 bg-[#0d0f15] text-gray-400 hover:border-gray-500 hover:text-white'
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleStarred();
          }}
          title={isStarred ? 'Unstar item' : 'Star item'}
          type="button"
        >
          <Star fill={isStarred ? 'currentColor' : 'none'} size={13} />
        </button>
        {!isCollapsed ? (
        <button className="shrink-0 text-left" onClick={onOpenPreview} type="button">
          <div className="overflow-hidden rounded-md border border-gray-700/60 bg-[#0d0f15]">
            <MiniPreview item={item} />
          </div>
        </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <button className="w-full text-left" onClick={onSelect} type="button">
            <div className="flex min-w-0 items-center gap-1.5">
              {isStarred ? <Star className="shrink-0 text-amber-200" fill="currentColor" size={11} /> : null}
              <span className="truncate text-[13px] font-medium text-gray-100">{item.label}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.14em] text-gray-500">{item.kind}</span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] ${origin === 'generated'
                  ? 'border-violet-300/25 bg-violet-400/10 text-violet-100'
                  : 'border-blue-300/25 bg-blue-400/10 text-blue-100'}`}
                data-source-origin={origin}
              >
                {origin}
              </span>
              {storageLabel ? (
                <span className="rounded border border-emerald-300/20 bg-emerald-400/5 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-100/85">
                  {storageLabel}
                </span>
              ) : null}
              {item.professional?.proxy?.status === 'ready' ? (
                <span className="rounded border border-cyan-300/20 bg-cyan-400/5 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-100/85">
                  Proxy ready
                </span>
              ) : null}
              {item.professional?.onlineState === 'offline' || item.professional?.onlineState === 'stale' ? (
                <span className="rounded border border-amber-300/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-100">
                  {item.professional.onlineState}
                </span>
              ) : null}
            </div>
            {item.envelopeLabel ? (
              <div className="mt-1 truncate text-[11px] font-medium text-cyan-100/80">{item.envelopeLabel}</div>
            ) : null}
            {!isCollapsed && previewSupportLabel ? <div className="mt-1 text-[10px] text-amber-200/80">{previewSupportLabel}</div> : null}
            {!isCollapsed && (durationSeconds || dimensionsLabel || item.mimeType) ? (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] tabular-nums text-gray-400">
                {durationSeconds ? <span>{formatTimelineRulerLabel(durationSeconds, durationSeconds)}</span> : null}
                {dimensionsLabel ? <span>{dimensionsLabel}</span> : null}
                {item.mimeType ? <span className="max-w-full truncate">{item.mimeType.replace(/^(video|audio|image)\//, '')}</span> : null}
              </div>
            ) : null}
          </button>
        </div>
        <button
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-500/25 bg-red-500/10 text-red-100 transition-colors hover:border-red-400/60 hover:bg-red-500/20"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          type="button"
        >
          <Trash2 size={12} />
        </button>
          </div>

      {!isCollapsed ? (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {canUseSourceItemAsVisual(item) ? (
          <TrackAddControl compact icon={Film} noun="Video" onAdd={onAddVisual} trackCount={VISUAL_TRACK_COUNT} />
        ) : null}

        {canUseSourceItemAsAudio(item) ? (
          <TrackAddControl compact icon={Music2} noun="Audio" onAdd={onAddAudio} trackCount={AUDIO_TRACK_COUNT} />
        ) : null}

        {item.kind === 'subtitle' && onApplyCaptions ? (
          <button className={smallEditorButtonClassName} onClick={onApplyCaptions} type="button">
            <Captions size={12} /> Apply To Timeline
          </button>
        ) : null}

        {item.kind === 'subtitle' && onUseAsAlignmentScript ? (
          <button
            aria-pressed={alignmentScriptSelected}
            className={`${smallEditorButtonClassName} ${alignmentScriptSelected ? 'border-cyan-300/60 bg-cyan-300/10 text-cyan-100' : ''}`}
            onClick={onUseAsAlignmentScript}
            type="button"
          >
            <Captions size={12} /> {alignmentScriptSelected ? 'Alignment Script ✓' : 'Use As Alignment Script'}
          </button>
        ) : null}

        {(item.kind === 'audio' || item.kind === 'video' || item.kind === 'composition') && onAutoCaptions ? (
          <button className={smallEditorButtonClassName} onClick={onAutoCaptions} type="button">
            <Captions size={12} /> Auto Captions
          </button>
        ) : null}

        {(item.kind === 'audio' || item.kind === 'video' || item.kind === 'composition') && onCleanDialogue ? (
          <button className={smallEditorButtonClassName} onClick={onCleanDialogue} title="Create a new voice-isolated full-length audio asset" type="button">
            <Music2 size={12} /> Clean Dialogue
          </button>
        ) : null}

        {(item.kind === 'audio' || item.kind === 'video' || item.kind === 'composition') && onAlignCaptions ? (
          <button className={smallEditorButtonClassName} onClick={onAlignCaptions} title="Retiming uses the marked caption file as the exact spoken script" type="button">
            <Captions size={12} /> Align Captions
          </button>
        ) : null}

        {(item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' || item.kind === 'composition') && onRelink ? (
          <button
            className={`${smallEditorButtonClassName} disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={relinkDisabled}
            onClick={onRelink}
            title="Choose a replacement; an existing saved fingerprint must match"
            type="button"
          >
            <Search size={12} /> Relink…
          </button>
        ) : null}
      </div>
      ) : null}
    </div>
  );
}

function EditorAssetCard({
  asset,
  onOpenContextMenu,
  onPlace,
  previewSourceItem,
}: {
  asset: EditorAsset;
  onOpenContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onPlace: (trackIndex: number) => void;
  previewSourceItem?: SourceBinItem;
}) {
  const draggableSourceItem = previewSourceItem && canUseSourceItemAsVisual(previewSourceItem)
    ? previewSourceItem
    : undefined;

  return (
    <article
      className={`rounded-xl border border-gray-700/60 bg-[#111217]/70 p-2.5 ${
        draggableSourceItem ? 'cursor-grab active:cursor-grabbing' : ''
      }`}
      draggable={Boolean(draggableSourceItem)}
      onDragStart={(event) => {
        if (!draggableSourceItem) {
          return;
        }

        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('application/x-flow-source-bin-item', JSON.stringify({ itemId: draggableSourceItem.id }));
      }}
      onContextMenu={onOpenContextMenu}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-700/60 bg-[#0f131b] text-cyan-200">
          {asset.kind === 'text' ? (
            <div
              className="max-w-full truncate px-1 text-center font-semibold"
              style={{
                color: asset.textDefaults?.color ?? '#f8fafc',
                fontFamily: formatFontFamily(asset.textDefaults?.managedFace
                  ? bundledFontFaceRuntimeFamilyName(asset.textDefaults.managedFace)
                  : asset.textDefaults?.fontFamily ?? 'Inter, system-ui, sans-serif'),
                fontSize: `${Math.max(10, Math.min(18, (asset.textDefaults?.fontSizePx ?? 72) / 5))}px`,
                fontStyle: asset.textDefaults?.fontStyle,
                fontStretch: asset.textDefaults?.managedFace ? `${asset.textDefaults.managedFace.stretchPercent}%` : undefined,
                fontWeight: asset.textDefaults?.fontWeight,
                ...getTextPreviewEffectStyle(asset.textDefaults?.textEffect ?? 'shadow'),
              }}
            >
              {asset.textDefaults?.text || 'Text'}
            </div>
          ) : asset.kind === 'shape' ? (
            <div
              className="h-7 w-10"
              style={{
                backgroundColor: asset.shapeDefaults?.fillColor ?? '#0ea5e9',
                borderColor: asset.shapeDefaults?.borderColor ?? '#f8fafc',
                borderRadius: asset.shapeDefaults?.cornerRadius ?? 8,
                borderStyle: 'solid',
                borderWidth: Math.min(4, asset.shapeDefaults?.borderWidth ?? 2),
              }}
            />
          ) : previewSourceItem?.assetUrl ? (
            <img alt={asset.label} className="h-full w-full object-cover" src={previewSourceItem.assetUrl} />
          ) : (
            <ImageIcon size={18} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-100">{asset.label}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-500">{asset.kind}</div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {Array.from({ length: VISUAL_TRACK_COUNT }, (_, trackIndex) => (
          <button
            className={miniTrackButtonClassName}
            key={trackIndex}
            onClick={() => onPlace(trackIndex)}
            type="button"
          >
            V{trackIndex + 1}
          </button>
        ))}
      </div>
    </article>
  );
}

// Cross-track vertical drag (Phase 2D): collects the viewport rects of every sibling lane of the
// same kind (visual/audio) as `anchor`, tagged with each lane's own track index — the DOM-glue half
// of the pure hit-test in editorTimelineTrackDrag.ts. Queried once per drag-start rather than on
// every pointermove (lane positions don't change mid-drag).
function collectTimelineLaneRects(anchor: Element, trackKind: 'visual' | 'audio'): TimelineLaneRect[] {
  const root = anchor.closest('[data-timeline-lanes-root="true"]');

  if (!root) {
    return [];
  }

  return Array.from(root.querySelectorAll<HTMLElement>(`[data-timeline-track-kind="${trackKind}"]`)).flatMap((el) => {
    const trackIndex = Number(el.dataset.timelineTrackIndex);

    if (!Number.isInteger(trackIndex)) {
      return [];
    }

    const rect = el.getBoundingClientRect();
    return [{ trackIndex, top: rect.top, bottom: rect.bottom }];
  });
}

function TimelineLane({
  trackLabel,
  locked = false,
  onToggleLock,
  collapsed = false,
  onToggleCollapse,
  timelineSeconds,
  blocks,
  emptyMessage,
  onSelect,
  onSelectMany,
  onMoveBlock,
  onCutBlock,
  onSlipBlock,
  onBeginProfessionalTrim,
  onTrimBlockEdge,
  onTrimAudioBlockEdge,
  onAddAutomationPoint,
  onUpdateAutomationPoint,
  onRemoveAutomationPoint,
  automationLabel,
  gaps = [],
  selectedGapId,
  onSelectGap,
  onOpenGapContextMenu,
  onSetPlayhead,
  playheadSeconds,
  snapPoints = [],
  onOpenContextMenu,
  toolMode,
  onStartHandPan,
  onDropSourceItem,
  onResizeLane,
  laneHeight,
  trackVolumePercent,
  onTrackVolumeChange,
  trackMuted = false,
  trackSoloed = false,
  onToggleTrackMute,
  onToggleTrackSolo,
  previewById,
  waveformById,
  laneTrackIndex,
  laneTrackKind,
  overlayKind,
  onToggleOverlayKind,
  visibleRange,
}: {
  trackLabel: string;
  locked?: boolean;
  onToggleLock?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  timelineSeconds: number;
  blocks: Array<{
    id: string;
    label: string;
    secondaryLabel: string;
    startSeconds: number;
    durationSeconds: number;
    kind: TimelineBlockKind;
    trimClip?: EditorVisualClip;
    trimAudioClip?: EditorAudioClip;
    selected: boolean;
    muted?: boolean;
    opacityPercent?: number;
    opacityAutomationPoints?: TimelineAutomationPoint[];
    keyframePercents?: number[];
  }>;
  emptyMessage: string;
  onSelect: (id: string, modifiers: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  onSelectMany?: (ids: string[]) => void;
  onMoveBlock?: (id: string, nextStartSeconds: number, shiftKey: boolean, nextTrackIndex?: number) => void;
  onCutBlock?: (id: string, splitSeconds: number, shiftKey: boolean) => void;
  onSlipBlock?: (id: string, deltaSeconds: number) => void;
  onBeginProfessionalTrim?: (clipId: string, mode: Extract<TimelineTool, 'ripple' | 'roll' | 'slip' | 'slide'>, edge?: TimelineClipEdge) => void;
  onTrimBlockEdge?: (
    clip: EditorVisualClip,
    edge: TimelineClipEdge,
    deltaSeconds: number,
    shiftKey: boolean,
    options?: { altKey?: boolean; phase?: 'start' | 'move' },
  ) => void;
  onTrimAudioBlockEdge?: (
    clip: EditorAudioClip,
    edge: TimelineClipEdge,
    deltaSeconds: number,
    shiftKey: boolean,
    options?: { phase?: 'start' | 'move' },
  ) => void;
  onAddAutomationPoint?: (id: string, point: TimelineAutomationPoint) => void;
  onUpdateAutomationPoint?: (id: string, pointIndex: number, point: TimelineAutomationPoint) => void;
  onRemoveAutomationPoint?: (id: string, pointIndex: number) => void;
  automationLabel?: string;
  gaps?: Required<TimelineGap>[];
  selectedGapId?: string;
  onSelectGap?: (gap: Required<TimelineGap>) => void;
  onOpenGapContextMenu?: (gap: Required<TimelineGap>, event: React.MouseEvent<HTMLElement>) => void;
  onSetPlayhead: (seconds: number) => void;
  playheadSeconds: number;
  snapPoints?: number[];
  onOpenContextMenu: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  toolMode: TimelineTool;
  onStartHandPan: (event: React.PointerEvent<HTMLElement>) => void;
  onDropSourceItem?: (event: React.DragEvent<HTMLDivElement>) => void;
  onResizeLane?: (event: React.PointerEvent<HTMLElement>) => void;
  laneHeight: number;
  trackVolumePercent?: number;
  onTrackVolumeChange?: (volumePercent: number) => void;
  trackMuted?: boolean;
  trackSoloed?: boolean;
  onToggleTrackMute?: () => void;
  onToggleTrackSolo?: () => void;
  previewById?: Record<string, TimelineClipEdgePreview>;
  waveformById?: Record<string, number[]>;
  // Cross-track vertical drag (Phase 2D): this lane's own track index/kind, tagged onto the DOM so
  // a dragged block can hit-test sibling lanes of the same kind. Optional — a lane rendered without
  // these (e.g. a legacy/unwired call site) simply keeps horizontal-only dragging.
  laneTrackIndex?: number;
  laneTrackKind?: 'visual' | 'audio';
  // Overlay track kind (visual lanes only): renders a distinct label/tint and a toggle control.
  overlayKind?: EditorVisualTrackKind;
  onToggleOverlayKind?: () => void;
  visibleRange?: TimelineViewportRange;
}) {
  const [selectionDrag, setSelectionDrag] = useState<{ startSeconds: number; endSeconds: number }>();
  // Drawer-style minimize (owner request): a collapsed lane renders as a thin strip regardless
  // of the persisted laneHeight, so it can still be "kinda seen" without the full detail view.
  const collapsedLaneHeight = 14;
  const effectiveLaneHeight = collapsed ? collapsedLaneHeight : laneHeight;
  const laneInset = Math.max(3, Math.round(laneHeight * 0.08));
  // Give the automation band the clip's full vertical room (owner feedback: the old 42%/46px cap
  // left only the top half draggable). 8px bottom margin keeps a 0% point inside the clip.
  const automationHeight = Math.max(24, laneHeight - Math.max(5, laneInset) - 8);
  const laneSizeStyle: CSSProperties = {
    height: effectiveLaneHeight,
    minHeight: effectiveLaneHeight,
  };
  const snapLaneSeconds = (seconds: number, shiftKey: boolean) =>
    resolveTimelineSnapSeconds(seconds, {
      snapPoints,
      shiftKey,
      maxSeconds: timelineSeconds,
    });
  const visibleBlocks = blocks.filter((block) => (
    block.selected || timelineRangeIntersects(block.startSeconds, block.durationSeconds, visibleRange)
  ));
  const visibleGaps = gaps.filter((gap) => (
    gap.id === selectedGapId || timelineRangeIntersects(gap.startSeconds, gap.durationSeconds, visibleRange)
  ));
  const startEdgeTrim = (
    event: React.PointerEvent<HTMLElement>,
    block: {
      id: string;
      startSeconds: number;
      durationSeconds: number;
      trimClip?: EditorVisualClip;
      trimAudioClip?: EditorAudioClip;
    },
    edge: TimelineClipEdge,
  ) => {
    const trimCallback = block.trimClip ? onTrimBlockEdge : onTrimAudioBlockEdge;
    const trimClip = block.trimClip ?? block.trimAudioClip;
    if (!trimCallback || !trimClip || !isPrimaryTimelinePointerButton(event.button)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onSelect(block.id, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });

    if ((toolMode === 'ripple' || toolMode === 'roll') && onBeginProfessionalTrim) {
      onBeginProfessionalTrim(block.id, toolMode, edge);
      return;
    }

    const laneRect = (event.currentTarget.closest('[data-timeline-lane-body="true"]') as HTMLElement | null)
      ?.getBoundingClientRect();

    if (!laneRect) {
      return;
    }

    const startClientX = event.clientX;
    // phase 'start' lets the workspace snapshot the lane for Alt-drag RIPPLE trims (stateless per move).
    if (block.trimClip && onTrimBlockEdge) {
      onTrimBlockEdge(block.trimClip, edge, 0, event.shiftKey, { altKey: event.altKey, phase: 'start' });
    } else if (block.trimAudioClip && onTrimAudioBlockEdge) {
      onTrimAudioBlockEdge(block.trimAudioClip, edge, 0, event.shiftKey, { phase: 'start' });
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaSeconds = ((moveEvent.clientX - startClientX) / laneRect.width) * timelineSeconds;
      if (block.trimClip && onTrimBlockEdge) {
        onTrimBlockEdge(block.trimClip, edge, deltaSeconds, moveEvent.shiftKey, { altKey: moveEvent.altKey, phase: 'move' });
      } else if (block.trimAudioClip && onTrimAudioBlockEdge) {
        onTrimAudioBlockEdge(block.trimAudioClip, edge, deltaSeconds, moveEvent.shiftKey, { phase: 'move' });
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div className="group/lane relative grid grid-cols-[96px_minmax(0,1fr)] gap-2" style={laneSizeStyle}>
      <div
        className={`overflow-hidden rounded-lg border ${overlayKind === 'overlay' ? 'border-fuchsia-400/40' : 'border-gray-700/60'} bg-[#0f131b] ${collapsed ? 'flex items-center px-2 py-0' : 'px-2.5 py-2'}`}
        style={laneSizeStyle}
      >
        <div className="flex items-center gap-1.5">
          <span className={`text-[13px] font-semibold ${overlayKind === 'overlay' ? 'text-fuchsia-200' : 'text-gray-100'}`}>
            {trackLabel}{overlayKind === 'overlay' && !collapsed ? ' · Overlay' : ''}
          </span>
          {!collapsed && onToggleLock ? (
            <button
              aria-label={locked ? `Unlock ${trackLabel}` : `Lock ${trackLabel}`}
              className={`rounded px-1 text-[11px] leading-none transition-colors ${locked ? 'text-amber-300' : 'text-gray-600 hover:text-gray-300'}`}
              onClick={(event) => { event.stopPropagation(); onToggleLock(); }}
              title={locked ? 'Unlock track (edits re-enabled)' : 'Lock track (blocks every edit on this lane)'}
              type="button"
            >
              {locked ? '🔒' : '🔓'}
            </button>
          ) : null}
          {onToggleCollapse ? (
            <button
              aria-label={collapsed ? `Expand ${trackLabel}` : `Collapse ${trackLabel}`}
              className="rounded px-1 text-[11px] leading-none text-gray-500 transition-colors hover:text-gray-200"
              onClick={(event) => { event.stopPropagation(); onToggleCollapse(); }}
              title={collapsed ? `Expand ${trackLabel} (show full lane)` : `Collapse ${trackLabel} (minimize to a thin strip)`}
              type="button"
            >
              {collapsed ? '▸' : '▾'}
            </button>
          ) : null}
          {!collapsed && onToggleTrackMute ? (
            <button
              aria-label={`${trackMuted ? 'Unmute' : 'Mute'} ${trackLabel}`}
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${trackMuted ? 'border-rose-300/60 bg-rose-300/15 text-rose-100' : 'border-gray-700 text-gray-500 hover:text-gray-200'}`}
              onClick={(event) => { event.stopPropagation(); onToggleTrackMute(); }}
              title="Mute track"
              type="button"
            >
              M
            </button>
          ) : null}
          {!collapsed && onToggleTrackSolo ? (
            <button
              aria-label={`${trackSoloed ? 'Unsolo' : 'Solo'} ${trackLabel}`}
              className={`rounded border px-1.5 py-0.5 text-[9px] font-bold transition-colors ${trackSoloed ? 'border-amber-300/60 bg-amber-300/15 text-amber-100' : 'border-gray-700 text-gray-500 hover:text-gray-200'}`}
              onClick={(event) => { event.stopPropagation(); onToggleTrackSolo(); }}
              title="Solo track"
              type="button"
            >
              S
            </button>
          ) : null}
          {!collapsed && onToggleOverlayKind ? (
            <button
              aria-label={overlayKind === 'overlay' ? `Make ${trackLabel} a standard track` : `Make ${trackLabel} an overlay track`}
              className={`rounded px-1 text-[11px] leading-none transition-colors ${overlayKind === 'overlay' ? 'text-fuchsia-300' : 'text-gray-600 hover:text-gray-300'}`}
              onClick={(event) => { event.stopPropagation(); onToggleOverlayKind(); }}
              title={overlayKind === 'overlay' ? 'Overlay track (text/comic clips composite on top) — click to make standard' : 'Mark as overlay track (dedicated to text/comic clips)'}
              type="button"
            >
              {overlayKind === 'overlay' ? '◆' : '◇'}
            </button>
          ) : null}
        </div>
        {!collapsed ? (
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-gray-500">
            {blocks.length} clip{blocks.length === 1 ? '' : 's'}
          </div>
        ) : null}
        {!collapsed && typeof trackVolumePercent === 'number' && onTrackVolumeChange ? (
          <label className="mt-2 block space-y-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/80">
            <span>Track {formatAudioPercentWithDecibels(trackVolumePercent)}</span>
            <input
              className="w-full accent-cyan-300"
              max={100}
              min={0}
              onChange={(event) => onTrackVolumeChange(Number(event.target.value))}
              step={1}
              type="range"
              value={trackVolumePercent}
            />
          </label>
        ) : null}
      </div>
      <div
        data-timeline-lane-body="true"
        data-timeline-lane-locked={locked ? 'true' : undefined}
        data-timeline-lane-collapsed={collapsed ? 'true' : undefined}
        data-timeline-track-index={laneTrackIndex}
        data-timeline-track-kind={laneTrackKind}
        className={`relative overflow-hidden rounded-lg border ${overlayKind === 'overlay' ? 'border-fuchsia-400/40' : 'border-gray-700/60'} bg-[#0f131b] ${locked ? 'pointer-events-none opacity-55 saturate-50' : ''} ${collapsed ? 'pointer-events-none' : ''} data-[timeline-drag-target=true]:ring-2 data-[timeline-drag-target=true]:ring-cyan-300/70`}
        onDragOver={(event) => {
          if (!onDropSourceItem || !event.dataTransfer.types.includes('application/x-flow-source-bin-item')) {
            return;
          }

          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => onDropSourceItem?.(event)}
        onClick={(event) => {
          if (toolMode === 'hand') {
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - bounds.left) / bounds.width;
          const nextSeconds = Math.max(0, Math.min(timelineSeconds, ratio * timelineSeconds));
          onSetPlayhead(snapLaneSeconds(nextSeconds, event.shiftKey));
        }}
        onPointerDown={(event) => {
          if (toolMode === 'hand') {
            onStartHandPan(event);
            return;
          }
          if ((toolMode === 'marquee' || toolMode === 'range') && onSelectMany && isPrimaryTimelinePointerButton(event.button)) {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            const toSeconds = (clientX: number) => Math.max(0, Math.min(timelineSeconds, ((clientX - bounds.left) / bounds.width) * timelineSeconds));
            const startSeconds = toSeconds(event.clientX);
            setSelectionDrag({ startSeconds, endSeconds: startSeconds });
            const onMove = (moveEvent: PointerEvent) => setSelectionDrag({ startSeconds, endSeconds: toSeconds(moveEvent.clientX) });
            const onUp = (upEvent: PointerEvent) => {
              const endSeconds = toSeconds(upEvent.clientX);
              const rangeStart = Math.min(startSeconds, endSeconds);
              const rangeEnd = Math.max(startSeconds, endSeconds);
              onSelectMany(blocks.filter((block) => rangesOverlap(block.startSeconds, block.startSeconds + block.durationSeconds, rangeStart, rangeEnd)).map((block) => block.id));
              setSelectionDrag(undefined);
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }
        }}
        style={laneSizeStyle}
      >
        {selectionDrag ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-40 border border-cyan-200/80 bg-cyan-300/15"
            style={{
              left: `${(Math.min(selectionDrag.startSeconds, selectionDrag.endSeconds) / timelineSeconds) * 100}%`,
              width: `${(Math.abs(selectionDrag.endSeconds - selectionDrag.startSeconds) / timelineSeconds) * 100}%`,
            }}
          />
        ) : null}
        {snapPoints.map((snapSecond) => (
          <div
            key={`lane-snap-${snapSecond}`}
            className="pointer-events-none absolute bottom-0 top-0 z-[1] border-l border-cyan-200/20"
            style={{ left: `${(snapSecond / timelineSeconds) * 100}%` }}
          />
        ))}
        <div
          className="absolute bottom-0 top-0 z-10 w-px bg-red-400/90"
          style={{ left: `${(playheadSeconds / timelineSeconds) * 100}%` }}
        />
        {!collapsed && visibleGaps.map((gap) => {
          const isSelectedGap = gap.id === selectedGapId;

          return (
            <button
              className={`absolute z-10 flex items-center justify-center rounded-md border border-dashed px-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                isSelectedGap
                  ? 'border-amber-200/80 bg-amber-300/15 text-amber-100'
                  : 'border-amber-400/25 bg-amber-400/5 text-amber-100/60 hover:border-amber-200/60 hover:text-amber-100'
              }`}
              key={gap.id}
              onClick={(event) => {
                event.stopPropagation();
                onSelectGap?.(gap);
              }}
              onContextMenu={(event) => onOpenGapContextMenu?.(gap, event)}
              style={{
                left: `${(gap.startSeconds / timelineSeconds) * 100}%`,
                width: `max(${(gap.durationSeconds / timelineSeconds) * 100}%, 3px)`,
                top: laneInset,
                height: Math.max(28, laneHeight - laneInset * 2),
              }}
              type="button"
            >
              Gap {gap.durationSeconds.toFixed(1)}s
            </button>
          );
        })}
        {collapsed ? (
          visibleBlocks.map((block) => (
            // Collapsed drawer view: no waveform/label/automation, just a slim positioned bar
            // so there's still a hint that "something is there" without the full detail view.
            <div
              className={`absolute rounded-sm ${
                block.muted
                  ? 'bg-gray-500/50'
                  : block.selected
                    ? 'bg-blue-300/80'
                    : 'bg-cyan-400/60'
              }`}
              key={block.id}
              style={{
                left: `${(block.startSeconds / timelineSeconds) * 100}%`,
                width: `max(${(block.durationSeconds / timelineSeconds) * 100}%, 3px)`,
                top: 2,
                bottom: 2,
              }}
              title={block.label}
            />
          ))
        ) : blocks.length > 0 ? (
          visibleBlocks.map((block) => {
            const automationPoints = block.opacityAutomationPoints ?? [];
            const keyframePercents = block.keyframePercents ?? [];

            return (
              <div
                key={block.id}
                className={`absolute overflow-hidden rounded-md border text-left transition-colors ${
                  block.selected
                    ? 'border-blue-300 bg-blue-500/20 shadow-[0_0_0_1px_rgba(96,165,250,0.4)]'
                    : block.muted
                      ? 'border-gray-700/60 bg-gray-700/35 text-gray-300'
                      : 'border-blue-500/20 bg-gradient-to-br from-blue-500/18 to-cyan-500/12 text-gray-100 hover:border-blue-300/60'
                }`}
                onPointerDown={(event) => {
                  if (!isPrimaryTimelinePointerButton(event.button)) {
                    return;
                  }

                  onSelect(block.id, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });

                  const target = event.target as HTMLElement;
                  const laneRect = (event.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();

                  if (!laneRect) {
                    return;
                  }

                  const ratio = (event.clientX - laneRect.left) / laneRect.width;
                  const rawPointerSeconds = Math.max(0, Math.min(timelineSeconds, ratio * timelineSeconds));
                  const pointerSeconds = snapLaneSeconds(rawPointerSeconds, event.shiftKey);
                  if (toolMode !== 'cut') {
                    onSetPlayhead(pointerSeconds);
                  }

                  if (
                    target.closest('[data-automation-surface="true"]') ||
                    target.closest('[data-automation-point="true"]')
                  ) {
                    return;
                  }

                  if (toolMode === 'cut' && onCutBlock) {
                    event.preventDefault();
                    event.stopPropagation();
                    onCutBlock(block.id, pointerSeconds, event.shiftKey);
                    return;
                  }

                  if (toolMode === 'hand') {
                    onStartHandPan(event);
                    return;
                  }

                  if ((toolMode === 'slip' || toolMode === 'slide') && onBeginProfessionalTrim) {
                    event.preventDefault();
                    event.stopPropagation();
                    onBeginProfessionalTrim(block.id, toolMode);
                    return;
                  }

                  if (toolMode === 'slip' && onSlipBlock) {
                    event.preventDefault();
                    event.stopPropagation();

                    let lastClientX = event.clientX;

                    const onPointerMove = (moveEvent: PointerEvent) => {
                      const deltaSeconds = ((moveEvent.clientX - lastClientX) / laneRect.width) * timelineSeconds;
                      lastClientX = moveEvent.clientX;
                      onSlipBlock(block.id, deltaSeconds);
                    };

                    const onPointerUp = () => {
                      window.removeEventListener('pointermove', onPointerMove);
                      window.removeEventListener('pointerup', onPointerUp);
                    };

                    window.addEventListener('pointermove', onPointerMove);
                    window.addEventListener('pointerup', onPointerUp);
                    return;
                  }

                  if (!onMoveBlock) {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();

                  const startClientX = event.clientX;
                  const startSeconds = block.startSeconds;
                  // Cross-track drag: cache sibling lane rects (of the same kind) once at drag
                  // start — lane positions don't move mid-drag, so there's no need to re-query on
                  // every pointermove. A lane rendered without laneTrackKind (e.g. an unwired call
                  // site) gets an empty list here, which keeps the drag horizontal-only exactly as
                  // before (dropTrackIndex resolves to null → onMoveBlock's 4th arg stays undefined).
                  const dragLanesRoot = laneTrackKind
                    ? event.currentTarget.closest('[data-timeline-lanes-root="true"]')
                    : null;
                  const laneRects = laneTrackKind ? collectTimelineLaneRects(event.currentTarget, laneTrackKind) : [];
                  let highlightedLaneEl: HTMLElement | null = null;

                  const onPointerMove = (moveEvent: PointerEvent) => {
                    const deltaSeconds = ((moveEvent.clientX - startClientX) / laneRect.width) * timelineSeconds;
                    const dropTrackIndex = laneRects.length > 0
                      ? resolveTimelineDropTrackIndex(moveEvent.clientY, laneRects)
                      : null;

                    // Subtle visual cue: ring-highlight whichever lane the pointer is currently
                    // hovering (the clip itself already jumps lanes live via onMoveBlock's commit).
                    if (dragLanesRoot && laneTrackKind) {
                      const nextLaneEl = dropTrackIndex !== null
                        ? dragLanesRoot.querySelector<HTMLElement>(
                            `[data-timeline-track-kind="${laneTrackKind}"][data-timeline-track-index="${dropTrackIndex}"]`,
                          )
                        : null;

                      if (highlightedLaneEl && highlightedLaneEl !== nextLaneEl) {
                        highlightedLaneEl.removeAttribute('data-timeline-drag-target');
                      }
                      if (nextLaneEl) {
                        nextLaneEl.setAttribute('data-timeline-drag-target', 'true');
                      }
                      highlightedLaneEl = nextLaneEl;
                    }

                    onMoveBlock(block.id, Math.max(0, startSeconds + deltaSeconds), moveEvent.shiftKey, dropTrackIndex ?? undefined);
                  };

                  const onPointerUp = () => {
                    highlightedLaneEl?.removeAttribute('data-timeline-drag-target');
                    window.removeEventListener('pointermove', onPointerMove);
                    window.removeEventListener('pointerup', onPointerUp);
                  };

                  window.addEventListener('pointermove', onPointerMove);
                  window.addEventListener('pointerup', onPointerUp);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(block.id, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });
                  onOpenContextMenu(block.id, event);
                }}
                style={{
                  left: `${(block.startSeconds / timelineSeconds) * 100}%`,
                  width: `max(${(block.durationSeconds / timelineSeconds) * 100}%, ${block.selected ? '12px' : '3px'})`,
                  top: laneInset,
                  height: Math.max(28, laneHeight - laneInset * 2),
                }}
              >
                {previewById?.[block.id] ? (
                  <TimelineClipPreviewBackdrop preview={previewById[block.id]} />
                ) : null}

                {(block.trimClip && onTrimBlockEdge) || (block.trimAudioClip && onTrimAudioBlockEdge) ? (
                  <>
                    <button
                      aria-label={`Trim start of ${block.label}`}
                      className="absolute bottom-1 top-1 left-0 z-30 w-2 cursor-ew-resize rounded-l bg-white/0 transition-colors hover:bg-cyan-200/45"
                      onPointerDown={(event) => startEdgeTrim(event, block, 'start')}
                      title={block.trimAudioClip ? 'Drag to trim or extend the audio source start. Shift for 1s intervals.' : 'Drag to trim or extend clip start. Alt-drag to RIPPLE (later clips follow). Shift for 1s intervals.'}
                      type="button"
                    />
                    <button
                      aria-label={`Trim end of ${block.label}`}
                      className="absolute bottom-1 top-1 right-0 z-30 w-2 cursor-ew-resize rounded-r bg-white/0 transition-colors hover:bg-cyan-200/45"
                      onPointerDown={(event) => startEdgeTrim(event, block, 'end')}
                      title={block.trimAudioClip ? 'Drag to trim or extend the audio source end. Shift for 1s intervals.' : 'Drag to trim or extend clip end. Alt-drag to RIPPLE (later clips follow). Shift for 1s intervals.'}
                      type="button"
                    />
                  </>
                ) : null}

                {waveformById?.[block.id]?.length ? (
                  <div className="absolute inset-x-2 inset-y-2 z-0">
                    <TimelineWaveform
                      muted={Boolean(block.muted)}
                      peaks={waveformById[block.id]}
                      selected={block.selected}
                    />
                  </div>
                ) : waveformById?.[block.id] ? (
                  <div className="pointer-events-none absolute inset-x-2 top-2 z-0 flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-300/45">
                    <span className="h-px flex-1 border-t border-dashed border-slate-300/20" />
                    Waveform unavailable
                    <span className="h-px flex-1 border-t border-dashed border-slate-300/20" />
                  </div>
                ) : null}

                {automationPoints.length > 0 ? (
                  <div
                    className="pointer-events-none absolute inset-x-2 overflow-visible"
                    style={{ top: Math.max(5, laneInset), height: automationHeight }}
                  >
                    <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
                      <polyline
                        fill="none"
                        points={automationPoints.map((point) => `${point.timePercent},${100 - point.valuePercent}`).join(' ')}
                        stroke={block.selected ? 'rgba(165, 243, 252, 0.95)' : 'rgba(125, 211, 252, 0.75)'}
                        strokeWidth="2.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  </div>
                ) : null}

                {keyframePercents.length > 0 ? (
                  <div className="pointer-events-none absolute inset-x-2 top-2 z-20">
                    {keyframePercents.map((timePercent) => (
                      <span
                        className={`absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 border ${
                          block.selected
                            ? 'border-cyan-100 bg-cyan-300'
                            : 'border-cyan-200/50 bg-cyan-400/35'
                        }`}
                        key={`${block.id}-keyframe-${timePercent}`}
                        style={{ left: `${timePercent}%` }}
                        title={`Keyframe ${timePercent.toFixed(1)}%`}
                      />
                    ))}
                  </div>
                ) : null}

                {block.selected && automationPoints.length > 0 && onUpdateAutomationPoint ? (
                  <div
                    className="absolute inset-x-2 z-10 cursor-crosshair rounded-md border border-cyan-200/0 bg-cyan-200/0 transition-colors hover:border-cyan-200/20 hover:bg-cyan-200/5"
                    data-automation-surface="true"
                    title={`Double-click to add a ${automationLabel?.toLowerCase() ?? 'automation'} point, then drag points to shape fades.`}
                    style={{ top: Math.max(5, laneInset), height: automationHeight }}
                    onDoubleClick={(event) => {
                      if (!onAddAutomationPoint) {
                        return;
                      }

                      const target = event.target as HTMLElement;
                      if (target.closest('[data-automation-point="true"]')) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      onAddAutomationPoint(block.id, buildTimelineOpacityPoint(bounds, event.clientX, event.clientY));
                    }}
                  >
                    {automationLabel ? (
                      <div className="pointer-events-none absolute right-0 top-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/80">
                        {automationLabel}
                      </div>
                    ) : null}
                    {automationPoints.map((point, index) => (
                      <button
                        key={`${block.id}-automation-${index}`}
                        className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border shadow active:cursor-grabbing ${
                          index === 0 || index === automationPoints.length - 1
                            ? 'border-white/80 bg-cyan-200'
                            : 'border-white/80 bg-blue-300'
                        }`}
                        data-automation-point="true"
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();

                          if (!onRemoveAutomationPoint || index === 0 || index === automationPoints.length - 1) {
                            return;
                          }

                          onRemoveAutomationPoint(block.id, index);
                        }}
                        onPointerDown={(event) => {
                          if (!isPrimaryTimelinePointerButton(event.button)) {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          onSelect(block.id, { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey });

                          const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
                          const handle = event.currentTarget;

                          if (!bounds) {
                            return;
                          }

                          try {
                            handle.setPointerCapture(event.pointerId);
                          } catch {
                            // Pointer capture is a usability enhancement; window listeners still keep the drag working.
                          }

                          const onPointerMove = (moveEvent: PointerEvent) => {
                            const nextPoint = buildTimelineOpacityPoint(bounds, moveEvent.clientX, moveEvent.clientY);
                            onUpdateAutomationPoint(block.id, index, {
                              timePercent:
                                index === 0
                                  ? 0
                                  : index === automationPoints.length - 1
                                    ? 100
                                    : nextPoint.timePercent,
                              valuePercent: nextPoint.valuePercent,
                            });
                          };

                          const onPointerUp = () => {
                            try {
                              handle.releasePointerCapture(event.pointerId);
                            } catch {
                              // Ignore browsers that already released pointer capture.
                            }
                            window.removeEventListener('pointermove', onPointerMove);
                            window.removeEventListener('pointerup', onPointerUp);
                          };

                          window.addEventListener('pointermove', onPointerMove);
                          window.addEventListener('pointerup', onPointerUp);
                        }}
                        style={{
                          left: `${point.timePercent}%`,
                          top: `${100 - point.valuePercent}%`,
                        }}
                        title={`${Math.round(point.valuePercent)}%`}
                        type="button"
                      />
                    ))}
                  </div>
                ) : null}

                <div className="pointer-events-none absolute inset-x-2 bottom-1.5 z-20 rounded bg-[#09101a]/55 px-1.5 py-1 backdrop-blur-[1px]">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                    {getSourceItemIcon(block.kind)}
                    <span className="truncate">{block.label}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-gray-300">{block.secondaryLabel}</div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex h-full items-center px-4 text-sm text-gray-500">{emptyMessage}</div>
        )}
      </div>
      {onResizeLane && !collapsed ? (
        <button
          aria-label={`Resize ${trackLabel} track height`}
          className="absolute -bottom-1 left-0 right-0 z-30 h-2 cursor-row-resize rounded-full bg-transparent transition-colors hover:bg-blue-400/35 focus-visible:bg-blue-400/45 focus-visible:outline-none"
          onPointerDown={onResizeLane}
          title={`Drag to vertically resize ${trackLabel}`}
          type="button"
        />
      ) : null}
    </div>
  );
}

function TimelineClipPreviewBackdrop({ preview }: { preview: TimelineClipEdgePreview }) {
  return (
    <div className="absolute inset-0 z-0">
      {preview.start ? (
        <div className="absolute inset-y-0 left-0 w-[24%] overflow-hidden border-r border-black/30">
          <img alt="" className="h-full w-full object-cover opacity-85" src={preview.start} />
        </div>
      ) : null}
      {preview.end ? (
        <div className="absolute inset-y-0 right-0 w-[24%] overflow-hidden border-l border-black/30">
          <img alt="" className="h-full w-full object-cover opacity-85" src={preview.end} />
        </div>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-[#08111d]/45 via-[#0c1522]/25 to-[#08111d]/45" />
    </div>
  );
}

function TimelineWaveform({
  peaks,
  selected,
  muted,
}: {
  peaks: number[];
  selected: boolean;
  muted: boolean;
}) {
  return (
    <div className="flex h-full items-center gap-px">
      {peaks.map((peak, index) => (
        <div
          key={`${index}-${peak}`}
          className={`flex-1 rounded-full ${
            muted
              ? 'bg-gray-400/30'
              : selected
                ? 'bg-cyan-100/80'
                : 'bg-cyan-200/55'
          }`}
          style={{ height: `${Math.max(8, peak * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function MediaImportDialog({
  busy,
  canCopy,
  handling,
  kinds,
  onCancel,
  onConfirm,
  onHandlingChange,
}: {
  busy: boolean;
  canCopy: boolean;
  handling: VideoMediaImportHandling;
  kinds: Array<'video' | 'audio'>;
  onCancel: () => void;
  onConfirm: () => void;
  onHandlingChange: (handling: VideoMediaImportHandling) => void;
}) {
  const mediaLabel = kinds.length > 1 ? 'video and audio' : kinds[0];

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 180, y: 80, width: 660, height: 580 }}
      dialogId="video-import-media"
      minSize={{ width: 460, height: 480 }}
      onClose={onCancel}
      open
      title="Import Media"
      workspaceId={VIDEO_WORKSPACE_ID}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#141821]">
        <div className="border-b border-gray-700/60 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">Project media</div>
          <div className="mt-1 text-lg font-semibold text-white">Import {mediaLabel} clips</div>
          <p className="mt-2 text-xs leading-5 text-gray-400">
            Choose how Sloom should keep the originals. Either choice creates Ingested clips in the Project Source Bin; generated outputs stay in their own library view.
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5" role="radiogroup" aria-label="Media storage mode">
          <button
            aria-checked={handling === 'link'}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${handling === 'link' ? 'border-emerald-300/55 bg-emerald-400/10' : 'border-gray-700/60 bg-[#0f131b] hover:border-gray-500'}`}
            onClick={() => onHandlingChange('link')}
            role="radio"
            type="button"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-white">Link to originals</span>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100">Recommended</span>
            </div>
            <div className="mt-1.5 text-xs leading-5 text-gray-400">
              Keeps feature-length camera files in place for fast, zero-copy editing. Moving or renaming an original later will require relinking it.
            </div>
          </button>
          <button
            aria-checked={handling === 'copy-to-scratch'}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${handling === 'copy-to-scratch' ? 'border-cyan-300/55 bg-cyan-400/10' : 'border-gray-700/60 bg-[#0f131b] hover:border-gray-500'} disabled:cursor-not-allowed disabled:opacity-45`}
            disabled={!canCopy}
            onClick={() => onHandlingChange('copy-to-scratch')}
            role="radio"
            type="button"
          >
            <div className="text-sm font-semibold text-white">Copy into project media</div>
            <div className="mt-1.5 text-xs leading-5 text-gray-400">
              Duplicates the selected files into this project&apos;s scratch media folder for a self-contained handoff. This uses additional disk space.
            </div>
            {!canCopy ? <div className="mt-2 text-[11px] font-medium text-amber-200">Save the project or choose a scratch folder before using project copies.</div> : null}
          </button>
          <div className="rounded-xl border border-blue-300/15 bg-blue-400/5 px-3 py-2 text-[11px] leading-5 text-blue-100/75">
            Imported clips are labeled <b className="text-blue-100">Ingested</b>. Sloom renders, AI outputs, extracted frames, narration, and other derived media are labeled <b className="text-violet-100">Generated</b> and can be filtered independently.
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-700/60 bg-[#111217]/45 px-5 py-4">
          <button className="rounded-lg border border-gray-700/60 px-3 py-2 text-xs font-semibold text-gray-200 hover:border-gray-500" disabled={busy} onClick={onCancel} type="button">Cancel</button>
          <button className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60" disabled={busy} onClick={onConfirm} type="button">
            {busy ? 'Opening…' : 'Choose files…'}
          </button>
        </div>
      </div>
    </DockableDialog>
  );
}

function TextEditDialog({
  title,
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  title: string;
  draft: TextEditDraft;
  onChange: (patch: Partial<TextEditDraft>) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <DockableDialog
      defaultFloatingRect={{ x: 180, y: 96, width: 680, height: 620 }}
      dialogId="video-text-edit"
      minSize={{ width: 420, height: 360 }}
      onClose={onCancel}
      open
      title="Text Tool"
      workspaceId={VIDEO_WORKSPACE_ID}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#141821]">
        <div className="border-b border-gray-700/60 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
            Text Tool
          </div>
          <div className="mt-1 text-lg font-semibold text-white">{title}</div>
        </div>
        <div className="max-h-[58vh] space-y-4 overflow-y-auto px-5 py-5">
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Text</span>
            <textarea
              className="min-h-36 w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
              onChange={(event) => onChange({ text: event.target.value })}
              value={draft.text}
            />
          </label>
          <BundledFontBrowser
            onSelect={(family, face) => onChange({
              fontFamily: family.family,
              fontWeight: face.weight,
              fontStyle: face.style,
              managedFace: createBundledFontFaceReference(family, face),
              managedFaceIssue: undefined,
            })}
            style={draft.fontStyle}
            value={draft.fontFamily}
            weight={draft.fontWeight}
          />
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Font family</span>
            <input
              className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
              onChange={(event) => onChange({ fontFamily: event.target.value, managedFace: undefined, managedFaceIssue: undefined })}
              type="text"
              value={draft.fontFamily}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <NumberField
              label="Initial font size"
              max={320}
              min={8}
              onChange={(value) => onChange({ fontSizePx: Math.max(8, Math.round(value)) })}
              step={1}
              value={draft.fontSizePx}
            />
            <label className="block space-y-2 text-xs text-gray-400">
              <span>Color</span>
              <AdvancedColorPicker
                className="h-11 w-full"
                buttonClassName="rounded-xl border border-gray-700/60 bg-[#0f131b]"
                label="Editor asset text color"
                onChange={(color) => onChange({ color })}
                value={draft.color}
              />
            </label>
          </div>
          <label className="block space-y-2 text-xs text-gray-400">
            <span>Text effect</span>
            <select
              className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
              onChange={(event) => onChange({ textEffect: event.target.value as TextClipEffect })}
              value={draft.textEffect}
            >
              <option value="none">None</option>
              <option value="shadow">Shadow</option>
              <option value="glow">Glow</option>
              <option value="outline">Outline</option>
            </select>
          </label>
          <div className="rounded-xl border border-gray-700/60 bg-[#0f131b] p-5">
            <div
              className="whitespace-pre-wrap break-words text-center font-semibold leading-tight"
              style={{
                color: draft.color,
                fontFamily: formatFontFamily(draft.managedFace
                  ? bundledFontFaceRuntimeFamilyName(draft.managedFace)
                  : draft.fontFamily),
                fontSize: `${Math.max(8, Math.min(96, draft.fontSizePx))}px`,
                fontStyle: draft.fontStyle,
                fontStretch: draft.managedFace ? `${draft.managedFace.stretchPercent}%` : undefined,
                fontWeight: draft.fontWeight,
                ...getTextPreviewEffectStyle(draft.textEffect),
              }}
            >
              {draft.text || 'Text'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-700/60 bg-[#111217]/45 px-5 py-4">
          <button
            className="rounded-lg border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-100"
            onClick={onSave}
            type="button"
          >
            Save Text
          </button>
        </div>
      </div>
    </DockableDialog>
  );
}

function MonitorSurface({
  item,
  mediaInfo,
  variant,
  videoRef,
}: {
  item: SourceBinItem;
  mediaInfo?: SourceMediaInfo;
  variant: 'source' | 'mini';
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const previewClassName = variant === 'source' ? 'absolute inset-0 h-full w-full object-contain' : 'aspect-video h-16 w-24 object-cover';
  const aspectRatioValue = resolveSourceAspectRatio(item, mediaInfo);
  const previewSupportLabel = getBrowserPreviewSupportLabel(item.label, item.mimeType);

  if (item.kind === 'image') {
    return variant === 'source'
      ? (
          <MonitorStageFrame aspectRatioValue={aspectRatioValue}>
            <img alt={item.label} className={previewClassName} src={item.assetUrl} />
          </MonitorStageFrame>
        )
      : <img alt={item.label} className={previewClassName} src={item.assetUrl} />;
  }

  if (item.kind === 'video' || item.kind === 'composition') {
    return variant === 'source'
      ? (
          <MonitorStageFrame aspectRatioValue={aspectRatioValue}>
            <video className={previewClassName} controls ref={videoRef} src={item.assetUrl} />
            {previewSupportLabel?.startsWith('Imported') ? <UnsupportedPreviewBadge label={previewSupportLabel} /> : null}
          </MonitorStageFrame>
        )
      : <video className={previewClassName} muted src={item.assetUrl} />;
  }

  if (item.kind === 'audio') {
    return variant === 'source' ? (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-4 rounded-xl border border-gray-700/60 bg-[#0f131b] p-6">
        <div className="rounded-full border border-gray-700/60 bg-[#161c26] p-4 text-cyan-200">
          <Music2 size={28} />
        </div>
        {item.assetUrl ? <audio className="w-full" controls src={item.assetUrl} /> : null}
        {previewSupportLabel?.startsWith('Imported') ? <div className="text-xs text-amber-100/80">{previewSupportLabel}</div> : null}
      </div>
    ) : (
      <div className="flex h-16 w-24 items-center justify-center bg-[#0f131b] text-cyan-200">
        <Music2 size={18} />
      </div>
    );
  }

  if (item.kind === 'subtitle') {
    return variant === 'source' ? (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-3 rounded-xl border border-gray-700/60 bg-[#0f131b] p-6 text-center">
        <Captions className="text-cyan-200" size={30} />
        <div className="text-sm font-medium text-gray-100">{item.label}</div>
        <div className="text-xs text-gray-500">Timed captions · apply from the Source Bin</div>
      </div>
    ) : (
      <div className="flex h-16 w-24 items-center justify-center bg-[#0f131b] text-cyan-200">
        <Captions size={18} />
      </div>
    );
  }

  return variant === 'source' ? (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-xl border border-gray-700/60 bg-[#0f131b] p-6">
      <div className="max-w-sm text-center text-white">
        <div className="mb-3 inline-flex rounded-full border border-gray-700/60 bg-[#161c26] p-3 text-cyan-200">
          <Type size={24} />
        </div>
        <div className="text-base font-medium leading-7">{item.text}</div>
      </div>
    </div>
  ) : (
    <div className="flex h-16 w-24 items-center justify-center bg-[#0f131b] text-cyan-200">
      <Type size={18} />
    </div>
  );
}

function UnsupportedPreviewBadge({ label }: { label: string }) {
  return (
    <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-amber-300/25 bg-amber-950/80 px-3 py-2 text-xs text-amber-50 shadow-xl">
      {label}
    </div>
  );
}

function MiniPreview({ item }: { item: SourceBinItem }) {
  return <MonitorSurface item={item} variant="mini" />;
}

function VideoExportReadinessPill({ summary }: { summary: VideoExportReadinessSummary }) {
  return (
    <div
      className={`rounded-full border px-3 py-1 text-[11px] ${videoExportReadinessToneClass(summary.tone)}`}
      data-video-export-readiness="true"
      data-video-export-readiness-tone={summary.tone}
      title={summary.detail}
    >
      <span className="opacity-75">Export</span> <span className="font-semibold">{summary.label}</span>
    </div>
  );
}

function VideoRenderBackendPill({ summary }: { summary: VideoRenderBackendSummary }) {
  return (
    <div
      className={`rounded-full border px-3 py-1 text-[11px] ${videoRenderBackendToneClass(summary.tone)}`}
      data-video-render-backend="true"
      data-video-render-backend-tone={summary.tone}
      title={summary.detail}
    >
      <span className="opacity-75">Backend</span> <span className="font-semibold">{summary.label}</span>
    </div>
  );
}

function videoRenderBackendToneClass(tone: VideoRenderBackendTone): string {
  if (tone === 'gpu') return 'border-lime-300/25 bg-lime-500/10 text-lime-100';
  if (tone === 'native') return 'border-sky-300/25 bg-sky-500/10 text-sky-100';
  return 'border-gray-500/40 bg-gray-800/70 text-gray-200';
}

function videoExportReadinessToneClass(tone: VideoExportReadinessTone): string {
  if (tone === 'error') return 'border-rose-300/35 bg-rose-500/15 text-rose-100';
  if (tone === 'warning') return 'border-amber-300/35 bg-amber-500/15 text-amber-100';
  if (tone === 'info') return 'border-cyan-300/25 bg-cyan-500/10 text-cyan-100';
  return 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100';
}

function ToolToggleButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? 'border-blue-400/40 bg-blue-500/15 text-blue-100'
          : 'border-gray-700/60 bg-[#111217]/50 text-gray-300 hover:border-gray-500 hover:text-white'
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function MonitorStageFrame({
  aspectRatioValue,
  children,
}: {
  aspectRatioValue: number;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const update = () => {
      const availableWidth = Math.max(0, container.clientWidth - 12);
      const availableHeight = Math.max(0, container.clientHeight - 12);

      if (availableWidth === 0 || availableHeight === 0) {
        return;
      }

      let width = availableWidth;
      let height = width / aspectRatioValue;

      if (height > availableHeight) {
        height = availableHeight;
        width = height * aspectRatioValue;
      }

      setStageSize((current) => {
        const next = {
          width: Math.round(width),
          height: Math.round(height),
        };

        return current.width === next.width && current.height === next.height ? current : next;
      });
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [aspectRatioValue]);

  return (
    <div
      className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden rounded-lg border border-gray-700/60 bg-black p-1.5 shadow-inner"
      ref={containerRef}
    >
      <div
        className="relative shrink-0 overflow-hidden rounded-lg bg-black"
        style={{
          width: stageSize.width > 0 ? `${stageSize.width}px` : '100%',
          height: stageSize.height > 0 ? `${stageSize.height}px` : 'auto',
          aspectRatio: stageSize.width > 0 && stageSize.height > 0 ? undefined : `${aspectRatioValue}`,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ResizeHandle({
  onPointerDown,
  orientation = 'vertical',
}: {
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  orientation?: 'vertical' | 'horizontal';
}) {
  return (
    <div
      className={
        orientation === 'horizontal'
          ? 'group relative hidden h-2 w-full shrink-0 cursor-row-resize md:block'
          : 'group relative hidden w-2 shrink-0 cursor-col-resize md:block'
      }
      onPointerDown={onPointerDown}
      role="separator"
    >
      {orientation === 'horizontal' ? (
        <>
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gray-700/70 transition-colors group-hover:bg-blue-400/80" />
          <div className="absolute inset-x-1 bottom-0 top-0 rounded-full border border-transparent bg-transparent group-hover:border-blue-400/30 group-hover:bg-blue-500/10" />
        </>
      ) : (
        <>
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-700/70 transition-colors group-hover:bg-blue-400/80" />
          <div className="absolute inset-y-1 left-0 right-0 rounded-full border border-transparent bg-transparent group-hover:border-blue-400/30 group-hover:bg-blue-500/10" />
        </>
      )}
    </div>
  );
}

function VisualKeyframeInspector({
  clip,
  durationSeconds,
  timelineCursorSeconds,
  onAddOrUpdateKeyframe,
  onJumpKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
}: {
  clip: EditorVisualClip;
  durationSeconds: number;
  timelineCursorSeconds: number;
  onAddOrUpdateKeyframe: () => void;
  onJumpKeyframe: (direction: 'previous' | 'next') => void;
  onUpdateKeyframe: (keyframeIndex: number, patch: Parameters<typeof updateVisualKeyframe>[2]) => void;
  onRemoveKeyframe: (keyframeIndex: number) => void;
}) {
  const keyframes = normalizeVisualKeyframes(clip);
  const currentPercent = getVisualClipProgressPercent(clip, durationSeconds, timelineCursorSeconds);

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/20 bg-[#111217]/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Keyframes</div>
          <div className="mt-1 text-[11px] text-gray-500">Playhead {currentPercent.toFixed(1)}%</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className={miniTrackButtonClassName}
            onClick={() => onJumpKeyframe('previous')}
            title="Previous keyframe"
            type="button"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white"
            onClick={onAddOrUpdateKeyframe}
            title="Add or update keyframe"
            type="button"
          >
            <Diamond size={11} />
            Add
          </button>
          <button
            className={miniTrackButtonClassName}
            onClick={() => onJumpKeyframe('next')}
            title="Next keyframe"
            type="button"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {keyframes.map((keyframe, index) => {
          const isEndpoint = index === 0 || index === keyframes.length - 1;
          const isCurrent = Math.abs(keyframe.timePercent - currentPercent) < 0.25;

          return (
            <div
              className={`space-y-3 rounded-lg border p-2 ${
                isCurrent
                  ? 'border-cyan-200/70 bg-cyan-400/10'
                  : 'border-gray-700/60 bg-[#0f131b]'
              }`}
              key={`${clip.id}-visual-keyframe-${keyframe.timePercent}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-200">
                  <span className="h-2.5 w-2.5 rotate-45 border border-cyan-100 bg-cyan-300" />
                  {isEndpoint ? (index === 0 ? 'Start' : 'End') : `${keyframe.timePercent.toFixed(1)}%`}
                </div>
                {!isEndpoint ? (
                  <button
                    className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-100 transition-colors hover:border-red-400/60"
                    onClick={() => onRemoveKeyframe(index)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <NumberField
                  label="Position X"
                  max={2000}
                  min={-2000}
                  onChange={(value) => onUpdateKeyframe(index, { positionX: Math.round(value) })}
                  step={1}
                  value={keyframe.positionX}
                />
                <NumberField
                  label="Position Y"
                  max={2000}
                  min={-2000}
                  onChange={(value) => onUpdateKeyframe(index, { positionY: Math.round(value) })}
                  step={1}
                  value={keyframe.positionY}
                />
                <NumberField
                  label="Scale"
                  max={500}
                  min={10}
                  onChange={(value) => onUpdateKeyframe(index, { scalePercent: Math.max(10, Math.round(value)) })}
                  step={1}
                  value={keyframe.scalePercent}
                />
                <NumberField
                  label="Rotation"
                  max={720}
                  min={-720}
                  onChange={(value) => onUpdateKeyframe(index, { rotationDeg: Math.round(value) })}
                  step={1}
                  value={keyframe.rotationDeg}
                />
              </div>
              <RangeControl
                label="Opacity"
                max={100}
                min={0}
                onChange={(value) => onUpdateKeyframe(index, { opacityPercent: Math.round(value) })}
                value={keyframe.opacityPercent}
                valueLabel={`${Math.round(keyframe.opacityPercent)}%`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AudioKeyframeInspector({
  clip,
  durationSeconds,
  timelineCursorSeconds,
  onAddOrUpdateKeyframe,
  onJumpKeyframe,
  onUpdateKeyframe,
  onRemoveKeyframe,
}: {
  clip: EditorAudioClip;
  durationSeconds: number;
  timelineCursorSeconds: number;
  onAddOrUpdateKeyframe: () => void;
  onJumpKeyframe: (direction: 'previous' | 'next') => void;
  onUpdateKeyframe: (keyframeIndex: number, patch: Parameters<typeof updateAudioKeyframe>[2]) => void;
  onRemoveKeyframe: (keyframeIndex: number) => void;
}) {
  const keyframes = normalizeAudioKeyframes(clip);
  const currentPercent = getAudioClipProgressPercent(clip, durationSeconds, timelineCursorSeconds);

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/20 bg-[#111217]/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Volume Keyframes</div>
          <div className="mt-1 text-[11px] text-gray-500">Playhead {currentPercent.toFixed(1)}%</div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            className={miniTrackButtonClassName}
            onClick={() => onJumpKeyframe('previous')}
            title="Previous keyframe"
            type="button"
          >
            <ChevronLeft size={12} />
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold text-cyan-100 transition-colors hover:border-cyan-200/70 hover:text-white"
            onClick={onAddOrUpdateKeyframe}
            title="Add or update keyframe"
            type="button"
          >
            <Diamond size={11} />
            Add
          </button>
          <button
            className={miniTrackButtonClassName}
            onClick={() => onJumpKeyframe('next')}
            title="Next keyframe"
            type="button"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
      <div className="space-y-2">
        {keyframes.map((keyframe, index) => {
          const isEndpoint = index === 0 || index === keyframes.length - 1;
          const isCurrent = Math.abs(keyframe.timePercent - currentPercent) < 0.25;

          return (
            <div
              className={`space-y-3 rounded-lg border p-2 ${
                isCurrent
                  ? 'border-cyan-200/70 bg-cyan-400/10'
                  : 'border-gray-700/60 bg-[#0f131b]'
              }`}
              key={`${clip.id}-audio-keyframe-${keyframe.timePercent}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-200">
                  <span className="h-2.5 w-2.5 rotate-45 border border-cyan-100 bg-cyan-300" />
                  {isEndpoint ? (index === 0 ? 'Start' : 'End') : `${keyframe.timePercent.toFixed(1)}%`}
                </div>
                {!isEndpoint ? (
                  <button
                    className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-100 transition-colors hover:border-red-400/60"
                    onClick={() => onRemoveKeyframe(index)}
                    type="button"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <RangeControl
                label="Volume"
                max={150}
                min={0}
                onChange={(value) => onUpdateKeyframe(index, { volumePercent: Math.round(value) })}
                value={keyframe.volumePercent}
                valueLabel={`${Math.round(keyframe.volumePercent)}%`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InspectorHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-blue-200/80">{eyebrow}</div>
      <div className="mt-2 text-lg font-semibold text-white">{title}</div>
    </div>
  );
}

function InfoStack({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="space-y-2 rounded-xl border border-gray-700/60 bg-[#111217]/40 p-3">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3 text-sm">
          <span className="text-gray-400">{label}</span>
          <span className="text-right font-medium text-gray-100">{value}</span>
        </div>
      ))}
    </div>
  );
}

function VisualClipPropertyCopyDialog({
  sourceLabel,
  selectedProperties,
  onToggleProperty,
  onCopy,
  onCancel,
}: {
  sourceLabel: string;
  selectedProperties: VisualClipCopiedProperty[];
  onToggleProperty: (property: VisualClipCopiedProperty) => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const selectedCount = selectedProperties.length;

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 220, y: 112, width: 560, height: 520 }}
      dialogId="video-visual-copy-properties"
      minSize={{ width: 380, height: 320 }}
      onClose={onCancel}
      open
      title="Clip Property Clipboard"
      workspaceId={VIDEO_WORKSPACE_ID}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#141821]">
        <div className="border-b border-gray-700/60 px-5 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/80">
            Clip Property Clipboard
          </div>
          <div className="mt-1 text-lg font-semibold text-white">Copy Selected Properties</div>
          <div className="mt-1 text-sm text-gray-400">
            Choose which transform properties to copy from <span className="text-gray-100">{sourceLabel}</span>.
          </div>
        </div>
        <div className="space-y-3 px-5 py-5">
          {VISUAL_CLIP_PROPERTY_OPTIONS.map((option) => {
            const checked = selectedProperties.includes(option.key);

            return (
              <label
                key={option.key}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                  checked
                    ? 'border-cyan-300/50 bg-cyan-500/12'
                    : 'border-gray-700/60 bg-[#111217]/45 hover:border-gray-500'
                }`}
              >
                <input
                  checked={checked}
                  className="mt-1"
                  onChange={() => onToggleProperty(option.key)}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-semibold text-gray-100">{option.label}</span>
                  <span className="mt-1 block text-xs text-gray-400">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-700/60 bg-[#111217]/45 px-5 py-4">
          <div className="text-xs text-gray-400">
            {selectedCount} propert{selectedCount === 1 ? 'y' : 'ies'} selected.
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-lg border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-lg bg-cyan-200 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-100 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-400"
              disabled={selectedCount === 0}
              onClick={onCopy}
              type="button"
            >
              Copy Properties
            </button>
          </div>
        </div>
      </div>
    </DockableDialog>
  );
}

function EditorHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <DockableDialog
      defaultFloatingRect={{ x: 160, y: 92, width: 760, height: 600 }}
      dialogId="video-help"
      minSize={{ width: 420, height: 320 }}
      onClose={onClose}
      open
      title="Editor Hotkeys and Usage"
      workspaceId={VIDEO_WORKSPACE_ID}
    >
      <div className="h-full min-h-0 overflow-y-auto bg-[#141821]">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-700/60 bg-[#141821] px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-200/80">Help</div>
            <div className="mt-1 text-lg font-semibold text-white">Editor Hotkeys and Usage</div>
          </div>
          <button
            className="rounded-lg border border-gray-700/60 bg-[#111217]/60 px-3 py-2 text-xs font-semibold text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="space-y-6 px-5 py-5 text-sm text-gray-300">
          <section>
            <div className="mb-2 text-sm font-semibold text-white">Hotkeys</div>
            <div className="grid gap-2 md:grid-cols-2">
              {[
                ['Left / Right', 'Scrub the playhead by 0.1s'],
                ['Shift + Left / Right', 'Scrub the playhead by 1.0s'],
                ['Ctrl/Cmd + Z', 'Undo the last editor timeline or program-stage edit'],
                ['Ctrl/Cmd + Shift + Z', 'Redo the last undone editor edit'],
                ['Ctrl + Y', 'Redo the last undone editor edit'],
                ['Space', 'Play / pause the timeline (always resumes forward)'],
                ['J / K / L', 'Shuttle: reverse / stop / forward — tap J or L again for 2x, 4x, 8x'],
                ['Home / End', 'Jump the playhead to the start or end of the sequence'],
                ['I / O', 'Mark in / out on the Source Monitor at its playhead'],
                [', (comma)', 'Insert the marked source range at the playhead on V1 (ripples later clips right)'],
                ['. (period)', 'Overwrite the timeline range at the playhead on V1 with the marked source range'],
                ['Q / W', "Ripple-trim the selected clip's in / out edge to the playhead"],
                ['E', "Roll the nearest cut on the selected clip's lane to the playhead"],
                ['V', 'Select tool'],
                ['C', 'Cut the selected visual or audio clip at the playhead, or enter cut mode if no valid clip is selected'],
                ['S', 'Slip tool'],
                ['H', 'Hand pan tool'],
                ['Shift + K', 'Add or update a keyframe on the selected clip at the playhead'],
                ['Ctrl/Cmd + Alt + Up / Down', 'Nudge opacity (visual) or volume (audio) at the playhead by 5% — adds a keyframe there if none exists; add Shift for 1% steps'],
                ...VIDEO_TIMELINE_MARKER_HELP_HOTKEYS,
                ['[ / ]', 'Jump to the previous or next keyframe on the selected clip'],
                ['Delete / Backspace', 'Remove the selected clip'],
                ['Shift + / or F1', 'Open or close this help panel'],
                ['Esc', 'Close help or context menus'],
              ].map(([shortcut, description]) => (
                <div key={shortcut} className="rounded-xl border border-gray-700/60 bg-[#111217]/45 px-3 py-2">
                  <div className="font-semibold text-gray-100">{shortcut}</div>
                  <div className="mt-1 text-xs text-gray-400">{description}</div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="mb-2 text-sm font-semibold text-white">Program Monitor Tips</div>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>Click a timeline clip to select its layer in the program monitor.</li>
              <li>Drag the clip body or the center handle to reposition it on the canvas.</li>
              <li>Use the on-canvas toolbar for fit mode, centering, scale, rotation, and opacity adjustments.</li>
              <li>`Contain` preserves the whole source, `Cover` crops to fill, and `Stretch` forces the source to the full render canvas.</li>
              <li>Selected visual clips use keyframes for position, scale, rotation, and opacity animation.</li>
              <li>Text clips render as their own invisible text-sized layer; select the clip to show the transform handles.</li>
            </ul>
          </section>
          <section>
            <div className="mb-2 text-sm font-semibold text-white">Timeline Tips</div>
            <ul className="space-y-2 text-sm text-gray-300">
              <li>`Select` moves clips in time.</li>
              <li>`Cut` splits visual or audio clips at the pointer/playhead while preserving source ranges and level envelopes.</li>
              <li>`Slip` shifts the source content inside a timed clip without moving the clip on the timeline.</li>
              <li>`Hand` drags the sequencer viewport when you are zoomed in.</li>
              <li>Use the diamond buttons above the timeline or press `Shift+K` to keyframe the selected clip at the playhead.</li>
              <li>With a clip selected, `Ctrl+Alt+Up/Down` nudges its opacity (or an audio clip's volume) right at the playhead — creating a keyframe there if the playhead isn't on one.</li>
              <li>Volume and opacity lines follow clip keyframes, and keyframe markers are shown inside timeline clips.</li>
              <li>Hold `Shift` while scrubbing, cutting, snapping, or dragging trim edges to use whole-second steps.</li>
              <li>Drag audio edges for source-aware audio trims. Hold `Alt` while dragging a visual clip edge to RIPPLE the trim — later visual clips on the lane follow.</li>
            </ul>
          </section>
        </div>
      </div>
    </DockableDialog>
  );
}

function RangeControl({
  label,
  min,
  max,
  step,
  value,
  valueLabel,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  valueLabel: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2 text-xs text-gray-400">
      <div className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="font-medium text-gray-200">{valueLabel}</span>
      </div>
      <input
        className="w-full"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  );
}

function AudioProcessorSection({
  checked,
  label,
  description,
  onToggle,
  children,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onToggle: (checked: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-lg border p-3 ${checked ? 'border-violet-400/30 bg-violet-500/5' : 'border-gray-700/50 bg-[#0f131b]/45'}`}>
      <label className="flex items-start justify-between gap-3 text-xs text-gray-200">
        <span>
          <span className="block font-semibold">{label}</span>
          {description ? <span className="mt-1 block text-[10px] font-normal leading-4 text-gray-500">{description}</span> : null}
        </span>
        <input checked={checked} onChange={(event) => onToggle(event.target.checked)} type="checkbox" />
      </label>
      <div className={`mt-3 ${checked ? '' : 'opacity-55'}`}>{children}</div>
    </section>
  );
}

function NumberField({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2 text-xs text-gray-400">
      <span>{label}</span>
      <input
        className="w-full rounded-xl border border-gray-700/60 bg-[#0f131b] px-3 py-2 text-sm text-gray-100 outline-none"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={Number.isFinite(value) ? value : 0}
      />
    </label>
  );
}

function buildProfessionalMediaLoggingState(
  sourceItems: readonly SourceBinItem[],
  state: EditorProfessionalWorkflowState,
): VideoMediaLoggingState {
  return {
    records: sourceItems.slice(0, 10_000).map((source) => createVideoMediaLogRecord(source.id, {
      fileName: source.label,
      sourceFingerprint: source.professional?.sourceFingerprint,
      scene: source.professional?.logging?.scene,
      shot: source.professional?.logging?.shot,
      take: source.professional?.logging?.take,
      reel: source.professional?.logging?.reel,
      camera: source.professional?.logging?.camera,
      recordedOn: source.professional?.logging?.recordedAt,
      notes: source.professional?.logging?.notes,
      labelColor: source.professional?.logging?.colorLabel,
      tags: source.professional?.tags ?? [],
      rating: source.professional?.rating ?? 0,
      status: source.professional?.logging?.status === 'selected'
        ? 'select'
        : source.professional?.logging?.status === 'approved'
          ? 'approved'
        : source.professional?.logging?.status === 'rejected'
          ? 'reject'
          : source.professional?.logging?.status === 'alternate' ? 'hold' : 'unreviewed',
      subclips: source.professional?.subclip ? [{
        id: source.id,
        name: source.label,
        sourceInMs: source.professional.subclip.sourceInMs,
        sourceOutMs: source.professional.subclip.sourceOutMs,
        tags: source.professional.tags ?? [],
      }] : [],
    })),
    smartBins: state.smartBins.slice(0, 100).map((bin) => parseVideoSmartBinQuery(bin.id, bin.name, bin.query)),
  };
}

function buildProfessionalReviewWorkflow(
  compositionId: string,
  compositionSignature: string,
  state: EditorProfessionalWorkflowState,
): VideoReviewWorkflow {
  const workflow = createVideoReviewWorkflow(compositionId, compositionSignature);
  const latestApproval = [...state.reviewApprovals].sort((left, right) => right.createdAt - left.createdAt)[0];
  return {
    ...workflow,
    annotations: state.reviewAnnotations.map((annotation) => ({
      id: annotation.id,
      target: annotation.target === 'sequence-range' && annotation.endMs !== undefined
        ? { kind: 'range' as const, startMs: annotation.startMs, endMs: annotation.endMs }
        : annotation.target === 'visual-clip' || annotation.target === 'audio-clip'
          ? { kind: 'clip' as const, clipId: annotation.clipId ?? 'unlinked-clip', timeMs: annotation.startMs }
          : { kind: 'point' as const, timeMs: annotation.startMs },
      author: annotation.author,
      body: annotation.text,
      status: annotation.status === 'resolved' ? 'resolved' as const : 'open' as const,
      assignee: annotation.assignee,
      priority: annotation.priority === 'blocking' ? 'urgent' as const : annotation.priority,
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
      replies: annotation.replies.map((reply) => ({
        id: reply.id,
        author: reply.author,
        body: reply.text,
        createdAt: reply.createdAt,
        updatedAt: reply.createdAt,
      })),
    })),
    approval: latestApproval ? {
      status: latestApproval.status,
      reviewer: latestApproval.reviewer,
      note: latestApproval.note,
      decidedAt: latestApproval.createdAt,
      compositionSignature: latestApproval.compositionSignature,
    } : { status: 'unreviewed' },
  };
}

function buildProfessionalCaptionDocument(state: EditorProfessionalWorkflowState): VideoCaptionDocument {
  const track = state.captionTracks[0];
  return createVideoCaptionDocument({
    id: track?.id ?? 'primary-captions',
    language: track?.language,
    defaultStyle: track ? {
      fontFamily: track.style.fontFamily,
      fontSizePx: track.style.fontSizePx,
      color: track.style.textColor,
      backgroundOpacityPercent: track.style.backgroundOpacityPercent,
    } : undefined,
    cues: track?.cues.map((cue) => ({
      id: cue.id,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      language: track.language,
      speaker: cue.speaker,
      position: cue.position ? {
        xPercent: 50,
        yPercent: cue.position === 'top' ? 10 : cue.position === 'center' ? 50 : 90,
        anchor: cue.position === 'top' ? 'top' : cue.position === 'center' ? 'middle' : 'bottom',
      } : undefined,
    })) ?? [],
  });
}

/**
 * Video deliverables are the ones the composition renderer itself produces; everything else in a
 * delivery profile is a text artifact this renderer builds directly.
 */
/**
 * Editor history snapshots clone the whole professional workflow slice, which includes the durable
 * render queue. Restoring one unchanged would rewind delivered outputs back into pending work and
 * the runner would re-render them. Reconciliation cannot undo that damage afterwards — a rewound
 * `succeeded` is indistinguishable from an output that never ran — so the live queue has to be
 * carried across the restore here, at the only point where both versions are in hand.
 */
export function buildEditorHistoryRestorePatch(
  patch: Partial<NodeData>,
  liveDeliveryJobs: readonly VideoRenderQueueRecord[],
): Partial<NodeData> {
  return {
    ...patch,
    editorProfessionalWorkflowState: {
      ...sanitizeEditorProfessionalWorkflowState(patch.editorProfessionalWorkflowState),
      deliveryJobs: [...liveDeliveryJobs],
    },
  };
}

/**
 * What the durable render queue can actually execute — not what the renderers can do in general.
 *
 * A video deliverable is produced by re-running the composition, which takes its format from the
 * sequence's own export preset, so exactly one video format can be honestly delivered: the one the
 * sequence is currently set to. Declaring that preset as a capability lets a mismatched target plan
 * as blocked naming the preset it needs, instead of rendering this format and labelling it as that
 * one. Switching the preset per output is not an option: the preset is part of the render cache
 * signature, so changing it would mark every queued job as planned against an earlier cut.
 */
export function buildVideoDeliveryQueueHost({ nativeAvailable, activeExportPresetId }: {
  nativeAvailable: boolean;
  activeExportPresetId: string | undefined;
}): VideoDeliveryPlanningEnvironment {
  const activePreset = videoCompositionPresetCapability(activeExportPresetId);
  return {
    native: { available: nativeAvailable, capabilities: nativeAvailable ? [activePreset] : [] },
    browser: { available: true, capabilities: ['export:captions-vtt', 'export:structural-qc-json', activePreset] },
  };
}

const SOURCE_LIBRARY_REFERENCE_PREFIX = 'source-library:';
const COMPOSITION_RENDER_REFERENCE_PREFIX = 'composition-render:';

function isVideoDeliveryOutput(output: VideoRenderQueueOutput): boolean {
  return output.codec !== 'webvtt' && output.container !== 'webvtt' && output.codec !== 'structural-qc-v1';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large QC report cannot blow the argument limit of String.fromCharCode.
  for (let index = 0; index < bytes.length; index += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8_192));
  }
  return btoa(binary);
}

/**
 * Real checksum of a real produced artifact. When WebCrypto is unavailable the deliverable is still
 * recorded, just without a checksum — an absent checksum is honest, a fabricated one is not.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return undefined;
  try {
    const digest = await subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

function downloadProfessionalText(data: string, fileName: string, mediaType: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mediaType }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return endA > startB && startA < endB;
}

function parseProfessionalTrackIndex(trackId: string | undefined, kind: 'video' | 'audio', trackCount = 64): number | undefined {
  if (!trackId) return undefined;
  const normalized = trackId.trim().toLowerCase();
  const direct = normalized.match(new RegExp(`^${kind}[:_-](\\d+)$`, 'u'));
  const lane = normalized.match(kind === 'video' ? /^v(\d+)$/u : /^a(\d+)$/u);
  const parsed = direct ? Number(direct[1]) : lane ? Number(lane[1]) - 1 : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 && parsed < Math.max(0, trackCount) ? parsed : undefined;
}

function overwriteAudioTrackRange(
  blocks: ReturnType<typeof buildAudioTimelineBlocks>,
  clips: readonly EditorAudioClip[],
  trackIndex: number,
  rangeStartMs: number,
  durationMs: number,
): EditorAudioClip[] {
  const rangeEndMs = rangeStartMs + durationMs;
  const blockById = new Map(blocks.map((block) => [block.clip.id, block]));
  return clips.flatMap((clip) => {
    const block = blockById.get(clip.id);
    if (!block || clip.trackIndex !== trackIndex) return [{ ...clip }];
    const startMs = Math.round(block.startSeconds * 1_000);
    const endMs = Math.round(block.endSeconds * 1_000);
    if (!rangesOverlap(startMs, endMs, rangeStartMs, rangeEndMs)) return [{ ...clip }];
    const sourceInMs = clip.sourceInMs ?? 0;
    if (startMs >= rangeStartMs && endMs <= rangeEndMs) return [];
    if (startMs < rangeStartMs && endMs > rangeEndMs) {
      return [
        { ...clip, sourceOutMs: sourceInMs + (rangeStartMs - startMs) },
        { ...clip, id: `${clip.id}-overwrite-tail-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, offsetMs: rangeEndMs, sourceInMs: sourceInMs + (rangeEndMs - startMs) },
      ];
    }
    if (startMs < rangeStartMs) return [{ ...clip, sourceOutMs: sourceInMs + (rangeStartMs - startMs) }];
    return [{ ...clip, offsetMs: rangeEndMs, sourceInMs: sourceInMs + (rangeEndMs - startMs) }];
  });
}

function insertAudioTrackRange(
  blocks: ReturnType<typeof buildAudioTimelineBlocks>,
  clips: readonly EditorAudioClip[],
  trackIndex: number,
  playheadMs: number,
  durationMs: number,
): EditorAudioClip[] {
  const blockById = new Map(blocks.map((block) => [block.clip.id, block]));
  return clips.flatMap((clip) => {
    const block = blockById.get(clip.id);
    if (!block || clip.trackIndex !== trackIndex) return [{ ...clip }];
    const startMs = Math.round(block.startSeconds * 1_000);
    const endMs = Math.round(block.endSeconds * 1_000);
    if (startMs >= playheadMs) return [{ ...clip, offsetMs: clip.offsetMs + durationMs }];
    if (startMs < playheadMs && endMs > playheadMs) {
      const sourceInMs = clip.sourceInMs ?? 0;
      return [
        { ...clip, sourceOutMs: sourceInMs + (playheadMs - startMs) },
        { ...clip, id: `${clip.id}-insert-tail-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, offsetMs: playheadMs + durationMs, sourceInMs: sourceInMs + (playheadMs - startMs) },
      ];
    }
    return [{ ...clip }];
  });
}

function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-700/60 bg-[#111217]/35 p-4">
      <div className="text-sm font-medium text-gray-100">{title}</div>
      {body ? <div className="mt-2 text-[13px] leading-6 text-gray-400">{body}</div> : null}
    </div>
  );
}
