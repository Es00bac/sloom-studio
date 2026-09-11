import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collectExactPaperManagedFaces,
  paperManagedFontFamilyAlias,
  paperFontStyleFromCss,
  paperManagedFontFamilyForLivePaint,
  requestedExactPaperManagedFace,
  requestedExactPaperManagedFacesForTypographyPatch,
} from '../../../lib/paperExactManagedFonts';
import {
  AlertTriangle,
  Barcode,
  BookOpen,
  Captions,
  ChevronDown,
  ChevronUp,
  Circle,
  Cloud,
  Copy,
  ClipboardPaste,
  Download,
  FileJson,
  FilePlus2,
  FlipHorizontal,
  FlipVertical,
  Frame,
  Hand,
  Hexagon,
  Image as ImageIcon,
  Loader2,
  LockKeyhole,
  Maximize2,
  MessageCircle,
  Minus,
  MousePointer2,
  Move,
  Palette,
  Paintbrush,
  PanelBottomOpen,
  PanelLeftOpen,
  Pentagon,
  Pipette,
  Plus,
  PanelRightOpen,
  Printer,
  RotateCw,
  Ruler,
  Scissors,
  ShieldCheck,
  Slice,
  Sparkles,
  Triangle,
  Type,
  Undo2,
  Redo2,
  Waypoints,
  X,
} from 'lucide-react';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import { useEditorStore } from '../../../store/editorStore';
import { useDockablePanelStore } from '../../../store/dockablePanelStore';
import {
  capturePaperWorkspaceAuthorization,
  capturePaperInspectorStoreAuthority,
  isPaperInspectorStoreAuthorityCurrent,
  replacePaperImportedFontFace,
  usePaperStore,
} from '../../../store/paperStore';
import { ensurePaperImportedFontRegistered, PaperFontImportControl, useRegisterImportedFonts } from './PaperFontImport';
import { PaperIccProfileManager, type PaperIccProfileManagerChange } from './PaperIccProfileManager';
import { PaperManagedTextLayer } from './PaperManagedTextLayer';
import { PaperBundledFontFaceBrowser, PaperBundledFontPicker } from './PaperBundledFontPicker';
import type { BundledFontSelectionAuthority } from '../../../components/Common/BundledFontBrowser';
import { PaperDocumentTabs } from './PaperDocumentTabs';
import {
  resolvePaperFrameSelectionMode,
  shouldReplacePaperFrameSelectionForContextMenu,
  shouldTogglePaperFrameSelectionOnModifiedClick,
} from './paperFrameSelection';
import { PaperBubbleChainControls } from './PaperBubbleChainControls';
import { PaperBubbleConnectorControls } from './PaperBubbleConnectorControls';
import { PaperBubbleConnectorsOverlay } from './PaperBubbleConnectorsOverlay';
import { PaperPagesPanel } from './PaperPagesPanel';
import { PaperLayersPanel } from './PaperLayersPanel';
import { PaperReviewCommentsPanel } from './PaperReviewCommentsPanel';
import { PaperStoryEditorPanel } from './PaperStoryEditorPanel';
import { PaperPrintMarksControls } from './PaperPrintMarksControls';
import { PaperDataMergeSection } from './PaperDataMergeSection';
import { PaperAnchoredObjectsSection } from './PaperAnchoredObjectsSection';
import { PaperAuthoredNotesSection } from './PaperAuthoredNotesSection';
import {
  createPaperHaneBlankImageDataUrl,
  PaperHaneBlankImageDialog,
  type PaperHaneBlankImageSpec,
} from './PaperHaneBlankImageDialog';
import {
  PaperShortcutHelpPanel,
  type PaperShortcutHelpPanelLabels,
} from './PaperShortcutHelpPanel';
import { resolvePaperViewportFitZoom, type PaperViewportFitMode } from './paperViewportFit';
import { resolvePaperSmartGuideCandidates, resolvePaperSmartGuideSnap, type PaperSmartGuideLine } from './paperSmartGuides';
import { paperFrameLayerIsLocked } from '../../../lib/paperLayers';
import { buildPaperPrintSheetPlan, paperPrintMarksEnabled } from '../../../lib/paperPrintMarks';
import { resolvePaperBaselineLeadingPt, resolvePaperBaselineTopInsetMm } from '../../../lib/paperBaselineGrid';
import {
  buildPaperBubbleConnectorSegments,
  getPaperBubbleChainFrames,
  getPaperCompoundBubbleFrameIds,
  paperBubbleConnectorHandlePatch,
  type PaperBubbleConnectorHandle,
  type PaperBubbleConnectorSegment,
} from '../../../lib/paperBubbleChains';
import {
  PaperWritingAssistantPanel,
  type PaperWritingProviderOption,
} from '../writing/PaperWritingAssistantPanel';
import {
  createPaperWritingSourceSnapshot,
  isPaperWritingSourceOwnedByRuntimeDocument,
  type PaperWritingPreview,
} from '../writing/paperWritingAssistant';
import {
  createNativeCliPaperWritingTextExecutor,
  createPaperWritingTextExecutor,
  createFlowPaperWritingTextExecutor,
  generatePaperWritingPreview,
} from '../writing/paperWritingAssistantService';
import { PaperAssistedLayoutPanel } from '../assistedLayout/PaperAssistedLayoutPanel';
import { PaperLiveLayoutAgentPanel } from '../liveLayoutAgent/PaperLiveLayoutAgentPanel';
import {
  usePaperLiveLayoutAgentSession,
  type PaperLiveLayoutAgentStartRequest,
} from '../liveLayoutAgent/paperLiveLayoutAgentSession';
import {
  generatePaperAssistedLayoutPreview,
  type PaperAssistedLayoutPreview,
} from '../assistedLayout/paperAssistedLayoutService';
import { buildPaperDocumentExactManagedFontOutput, materializePaperDocumentAssetUrls, paperAssetRepository } from '../assets/PaperAssetRuntime';
import { useSettingsStore } from '../../../store/settingsStore';
import {
  materializeSourceBinItemDataUrl,
  useSourceBinStore,
} from '../../../store/sourceBinStore';
import { useFlowStore } from '../../../store/flowStore';
import { useFlowWorkspaceStore } from '../../../store/flowWorkspaceStore';
import { useProjectUsageStore } from '../../../store/projectUsageStore';
import { recordActivityTrailWorkspaceEvent } from '../../../store/activityTrailStore';
import { showAlertDialog } from '../../../store/alertDialogStore';
import { resolveSourceNodeId } from '../../../lib/virtualNodes';
import { setAndroidInterceptVolumeKeys } from '../../../lib/androidSystemUi';
import { AdvancedColorPicker } from '../../../components/Common/AdvancedColorPicker';
import { CompactToolbarMenu, type CompactToolbarMenuItem } from '../../../components/Common/CompactToolbarMenu';
import { FlowSourceBinSidebar } from '../../../components/Layout/FlowSourceBinSidebar';
import { ComicSfxDesigner } from '../../../components/Paper/ComicSfxDesigner';
import { panelKey } from '../../../lib/dockablePanel';
import { isHaneProviderSourceItem } from '../../../lib/haneLinkProviderContract';
import {
  startHaneLinkedEdit,
  stopHaneLinkedEdit,
  useHaneLinkedEditStore,
} from '../../../lib/haneLinkedEdit';
import {
  exportPaperDocumentToPrintHtml,
  computeEffectivePaperFrame,
  effectiveRtlBinding,
  DEFAULT_PAPER_BACKGROUND,
  paperDocumentBackgroundCss,
  paperPixelsFromMm,
  PAPER_PAGE_PRESETS,
  PAPER_SAFE_SANS,
  resolvePaperPageFramesForCanvas,
  resolvePaperPageInheritedGuides,
} from '../../../lib/paperDocument';
import {
  applyPaperGrepStylesToRichText,
  PAPER_GREP_STYLE_LIMITS,
  validatePaperGrepPattern,
} from '../../../lib/paperGrepStyles';
import {
  createPaperCrossReferenceToken,
  createPaperPageReferenceToken,
} from '../../../lib/paperPublicationReferences';
import { normalizePaperTrackChanges } from '../../../lib/paperTrackChanges';

function newGrepRuleId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `grep-${prefix}-${random}`;
}
import {
  buildPaperBarcodeGeometry,
  paperBarcodePhysicalSizeStatus,
  paperBarcodeSymbolSizeMm,
  PAPER_EAN13_NOMINAL,
  resolvePaperBarcodeValue,
  sanitizePaperBarcodeInput,
} from '../../../lib/paperBarcode';
import {
  imageSourceToDataUrl,
  publishRasterizedPaperPageSourcePayload,
  publishRasterizedPaperPagesSourcePayloads,
} from '../../../lib/paperPageFlattenExport';
import { buildPaperBookletProofHtmlExportRequest, buildPaperBookletProofPdfExportRequest, buildPaperReaderSpreadHtmlExportRequest, buildPaperReaderSpreadPdfExportRequest } from '../../../lib/paperPdfExport';
import { buildPaperPackageExport } from '../../../lib/paperPackageExport';
import { createPaperLinkedSourceIdentityGuard } from '../../../lib/paperPlacedDocumentRasterization';
import {
  paperEmphasisMarkToCss,
  paperInlineTextUsesBrowserNativeLayout,
  tokenizePaperInlineText,
} from '../../../lib/paperJapaneseText';
import { useI18n } from '../../../lib/useI18n';
import { translate, type MessageKey } from '../../../lib/i18n';
import {
  buildPaperKdpExportPlan,
  buildPaperKdpImageArchiveExport,
  getKdpSpinePageThicknessMm,
  KDP_MIN_SPINE_TEXT_PAGES,
  type PaperKdpInteriorType,
  type PaperKdpPaperType,
} from '../../../lib/paperKdpExport';
import {
  buildPaperCbzRasterExport,
  exportPaperStoryText,
  importTextDocumentIntoPaper,
  inferPaperDocumentImportFormat,
  parsePaperDocumentImportFile,
} from '../../../lib/paperDocumentFormats';
import { buildPaperIdmlPackage } from '../../../lib/paperIdmlExport';
import {
  PAPER_FRAME_CONTEXT_ACTIONS,
  PAPER_PAGE_CONTEXT_ACTIONS,
  paperActionLabel,
  paperActionGroupLabel,
  type PaperFrameContextActionId,
  type PaperPageContextActionId,
} from '../../../lib/paperUsabilityActions';
import { getPaperDtpParityPriorities } from '../../../lib/paperDtpParity';
import {
  analyzePaperPreflight,
  collectPaperLinkedAssets,
  summarizePaperPreflightStatus,
  summarizePreflightForExport,
  type PaperLinkedAssetInfo,
  type PaperPreflightIssue,
  type PaperPreflightReport,
  type PaperPreflightStatusSummary,
  type PaperPreflightStatusTone,
} from '../../../lib/paperPreflight';
import { PAPER_OUTPUT_INTENT_PROFILES, isPdfXProductionTarget } from '../../../lib/paperPrintProduction';
import { isCommercialPrintProductionTarget, requestCommercialExportUnlock, requestTiltmarkBrushUnlock } from '../../../lib/licenseGates';
import { canFrameBeAiFixed, collectFrameFixSiblingCandidates } from '../../../lib/paperFrameFix';
import { PaperFrameFixDialog } from './PaperFrameFixDialog';
import { PaperSoftProofModal } from './PaperSoftProofModal';
import { resolveEditorBackdrop } from './editorContrast';
import { computeFitToTextFrameHeightMm, isFrameContentOverset } from './frameOverflow';
import {
  buildPaperManagedPrintUpscaledFramePatch,
  buildPaperPrintUpscaledFramePatch,
  buildPaperPrintUpscaleUsageTelemetry,
  collectPaperPrintUpscaleFrameJobs,
  describePaperPrintUpscaleBusyProvider,
  estimatePaperPrintUpscaleCostUsd,
  formatPaperPrintUpscaleProgress,
  isPaperFramePrintReady,
  isPaperPrintUpscaledSourceItem,
  resolvePaperPrintUpscalePlan,
  resolvePaperPrintUpscaleTarget,
  shouldUseVertexImagenPrintUpscale,
  upscalePaperImageForPrint,
  type PaperPrintUpscaleBusyProvider,
  type PaperPrintAndroidAcceleratorUpscaleRequest,
  type PaperPrintAndroidNativeUpscaleRequest,
  type PaperPrintLocalAiUpscaleRequest,
  type PaperPrintUpscaleTarget,
  type PaperPrintVertexUpscaleRequest,
} from '../../../lib/paperImageUpscale';
import {
  createPaperStabilityUpscaleCoordinator,
  runPaperStabilityUpscale,
  type PaperImagePlacementRequirement,
  type RunPaperStabilityUpscaleInput,
} from '../../../lib/paperStabilityUpscale';
import { resolvePaperStabilitySource } from '../../../lib/paperStabilitySource';
import {
  isLocalCpuUpscalerConfigured,
  runLocalCpuUpscaler,
} from '../../../lib/localCpuUpscaler';
import { buildLivePaperSpreadLayout, buildPaperSpreads, type LivePaperSpreadSlot, type PaperSpread } from '../../../lib/paperSpreads';
import {
  buildPaperSpreadVirtualWindow,
  type PaperSpreadVirtualMetric,
} from '../../../lib/paperWorkspaceVirtualization';
import { buildPaperBubblePath, resolveBubbleRadii, resolveBubbleTailCurveHandle } from '../../../lib/paperBubblePaths';
import { DEFAULT_PAPER_COLUMN_GUTTER_MM, resolvePaperColumnGutterMm } from '../../../lib/paperColumns';
import { computePaperThreadSlices } from '../../../lib/paperThreadFlow';
import { createPaperCanvasMeasurer } from '../../../lib/paperCanvasMeasurer';
import { resolveFrameWrapSpacers, type PaperWrapSpacer } from '../../../lib/paperTextWrap';
import { collectEffectiveRichEditorSelectionTypographies, createRichEditorBase, richTextToEditorHtml, serializeRichEditor } from '../../../lib/paperRichTextDom';
import {
  ensureRichTextForTransform,
  flattenPaperRichText,
  applyTypographyPatchToRichText,
  changedRichTypographyPatch,
  resolveRichEditorCommit,
  type RichTypographyPatch,
} from './richTextTransforms';
import {
  applyTypographyPatchToDomSelection,
  applyTypographyToDomSelection,
  FACE_SELECTING_TYPOGRAPHY_KEYS,
  registerPaperRichEditorSession,
  resolvePaperRichEditorTypographyUpdate,
  type PaperRichEditorCommitAuthority,
  type PaperRichEditorCommitContext,
  runPaperRichEditorCommand,
  type PaperRichEditorSession,
} from './paperRichEditorSession';
import { findPaperMatches, type PaperFindOptions } from '../../../lib/paperFindChange';
import { resolvePaperFramesTextTemplates } from '../../../lib/paperTextVariables';
import { isPaperRichParagraphFragment } from '../../../lib/paperRichText';
import { buildPaperTextArcPath } from '../../../lib/paperTextPath';
import {
  addPaperTableColumn,
  addPaperTableRow,
  clearPaperTableFills,
  createPaperTable,
  removePaperTableColumn,
  removePaperTableRow,
  setPaperTableBandFill,
  setPaperTableCell,
  setPaperTableHeaderFill,
} from '../../../lib/paperTables';
import { PAPER_BUBBLE_PRESETS } from '../../../lib/paperBubblePresets';
import type { PaperAlignEdge, PaperDistributeAxis } from '../../../lib/paperAlignDistribute';
import { PAPER_DEFAULT_SWATCHES } from '../../../lib/paperSwatchCatalog';
import { cmykToRgb, parseHexColor, resolveSwatchCssColor, rgbToCmyk, rgbToCss, totalInkPercent } from '../../../lib/paperSwatches';
import { PRINT_SAFE_PALETTES, findPrintSafePalette, paletteToPaperSwatches } from '../../../lib/printSafePalettes';
import {
  estimateGenerativeFillCostUsd,
  type GenerativeFillProvider,
} from '../../../lib/imageEditorAi';
import { shouldBypassConfirmations } from '../../../lib/automationBypass';
import {
  replaceAuthorizedPaperDocument,
  requestPaperDocumentReplacement,
} from '../../../lib/paperLossPrevention';
import { useConfirmationStore } from '../../../store/confirmationStore';
import { useTextInputDialogStore } from '../../../store/textInputDialogStore';
import {
  appendPaperTextEffectTransform,
  buildPaperTextPaintEffectStyle,
} from '../../../lib/paperTextEffects';
import {
  buildPaperComicSfxDecalFrameUpdate,
  getPaperComicSfxPreset,
  PAPER_COMIC_SFX_PRESET_IDS,
  paperComicSfxDesignToDataUrl,
  type PaperComicSfxDesign,
  type PaperComicSfxPresetId,
} from '../../../lib/paperComicSfx';
import {
  buildPaperFrameAssetFromSourceItem,
  hasPaperAssetReference,
  resolvePaperFrameAssetUrl,
} from '../../../lib/paperAssetReferences';
import { usePaperAssetUrl } from '../assets/usePaperAssetUrl';
import {
  preparePaperImageQuickEdit,
  resolvePaperImageQuickEditTarget,
} from '../../../lib/paperImageQuickEdit';
import {
  buildPaperPageImageImportPlan,
  hasPaperPageImageFileDrag,
} from '../../../lib/paperPageDropImports';
import {
  PAPER_CANVAS_BLEED_Z,
  PAPER_CANVAS_CUT_Z,
  PAPER_CANVAS_GUIDE_Z,
  buildPaperCanvasFrameLayers,
  resolvePaperCanvasFrameOpacity,
} from '../../../lib/paperCanvasStacking';
import {
  buildPaperFrameDragGeometry,
  buildPaperFrameCreateGeometry,
  buildPaperImageRenderStyle,
  clientPointToPaperPoint,
  movePaperFrameByDelta,
  panPaperFrameImageCropByDelta,
  PAPER_SCREEN_PX_PER_MM as PX_PER_MM,
  paperGuideOrientationFromRuler,
  paperRulerMarkerSpacingMm,
  resolvePaperImageNaturalSizePatch,
  rotatePaperFrameImageTowardPointer,
  resolvePaperWheelZoom,
  resolvePaperTextBox,
  resolvePaperPolygonPointClick,
  resizePaperFrameFromHandle,
  rotatePaperFrameTowardPointer,
  scalePaperFrameImageTowardPointer,
  snapPaperGuidePositionToRulerMarker,
  snapPaperPointToGridAndGuides,
  type PaperGuideOrientation,
  type PaperPoint,
  type PaperResizeHandle,
} from '../../../lib/paperLayoutTools';
import {
  getSignalLoomNativeBridge,
  type NativeCliAgentCapability,
  type NativeMenuCommand,
} from '../../../lib/nativeApp';
import {
  buildFlowNodePatchForSourceBinItem,
  getFlowNodeTypeForSourceBinItem,
} from '../../../lib/sourceBinFlowBridge';
import { buildPaperFrameFlowSourceCommand } from '../../../lib/paperFrameFlowBridge';
import { postWorkspaceWindowCommand } from '../../../lib/workspaceWindowCommands';
import {
  buildVertexImagenUpscaleRequestBody,
  dataUrlToVertexInlineImage,
  VERTEX_IMAGEN_UPSCALE_MODEL_ID,
} from '../../../lib/vertexImageRequests';
import { PAPER_PRINT_UPSCALE_METHOD_OPTIONS, PROVIDER_LABELS } from '../../../lib/providerCatalog';
import { getVertexProjectConfig, isVertexProjectConfigured } from '../../../lib/vertexProviderSettings';
import {
  getAndroidAcceleratorStatus,
  isAndroidAcceleratorConfigured,
  resolveAndroidUpscalerAvailability,
  runAndroidAcceleratorUpscaleWithRetry,
} from '../../../lib/androidAccelerator';
import {
  isAndroidNativeImageUpscalerAvailable,
  runAndroidNativeImageUpscale,
} from '../../../lib/androidNativeImageUpscaler';
import { useNativeMenuCommand } from '../../../shared/native/useNativeMenuCommand';
import { useMobileInterfaceStore } from '../../../store/mobileInterfaceStore';
import { useMobilePhoneInterfaceDescriptor } from '../../../lib/mobilePhoneInterface';
import { useTouchNavigationStore } from '../../../store/touchNavigationStore';
import {
  resolvePaperTouchPinchZoom,
  shouldRoutePaperPointerToTouchNavigation,
  usePaperTouchNavigationAvailabilityDescriptor,
  type PaperTouchNavigationSettings,
} from '../../../lib/paperTouchNavigation';
import { getSharedSourceBinCanvasOffsetPx } from '../../../lib/sharedWorkspacePanelDefaults';
import { clampContextMenuPosition, getContextMenuMaxHeight } from '../../../lib/sharedContextMenu';
import { openLinkedImageDocumentFromItem } from '../../../lib/imageLinkedEdit';
import { observePaperTopbarSlot } from '../../../lib/paperTopbarSlot';
import {
  createImageDocumentFromSourceItem,
  createSourceBackedImageDocumentShell,
} from '../../../components/ImageEditor/ImageSourceDocument';
import { DockablePanelHost, type DockablePanelDefinition } from '../../../components/DockablePanel';
import {
  createPaperDockablePanelDefaults,
  getPaperDockableCanvasOffsetClassName,
  PAPER_DOCKABLE_PANEL_IDS,
  PAPER_DOCKABLE_WORKSPACE_ID,
  PAPER_TILTMARK_PHYSICAL_PANEL_IDS,
} from '../../../components/Paper/paperDockablePanels';
import {
  getPaperPanelToggleMode,
  isPaperPanelShown,
  resolvePaperPanelMode,
} from './PaperWorkspaceUtils';
import {
  beginGuideDragFromRuler,
  bubbleHandlePatch,
  buildPaperEyedropperFrameColorPatch,
  clamp,
  clientPointToPageMm,
  clipPathForFrame,
  cssColorToPickerValue,
  deletePaperFrameVertexPatch,
  downloadBlob,
  downloadText,
  createPaperDocumentRasterizationGuardWithCurrentSources,
  exportPaperPdfDocument,
  exportPaperPdfxAndSave,
  exportPaperTaggedPdfAndSave,
  exportPaperEpubAndSave,
  exportPaperKdpPdfAndSave,
  exportPaperWebcomicImages,
  fileToDataUrl,
  frameFillCss,
  frameKindForTool,
  frameKindLabel,
  getDraggedSourceItemId,
  gradientVector,
  isEditableKeyboardTarget,
  insertPaperFrameVertexPatch,
  materializePaperRasterOutputDocument,
  movePaperTextBoxPatch,
  movePaperFrameVertexPatch,
  pagePresetLabel,
  paperFrameContentPaddingPx,
  paperTextBoxReactStyle,
  resolvePaperEyedropperFrameColor,
  resizePaperTextBoxPatch,
  rotatePaperTextBoxTowardPointer,
  safeFileName,
  shapeKindForTool,
  shapeLabel,
  shapeStrokeWidthPx,
  shouldShowPaperVertexHandles,
  svgFillForFrame,
  svgGradientId,
  toolLabel,
  verticesForEditableFrame,
  verticesForShapeKind,
  type PaperBubbleHandle,
  type PaperExportOutcome,
} from '../../../components/Paper/PaperWorkspaceUtils';
import { PAPER_TOOL_DEFINITIONS } from './paperToolRegistry';
import {
  TiltmarkCareDock,
  TiltmarkMaterialDock,
  TiltmarkSmartPaletteDock,
  TiltmarkSupplyDock,
} from '../../../components/ImageEditor/tiltmark/TiltmarkPhysicalMediaDocks';
import { initializeTiltmarkRuntime } from '../../../components/ImageEditor/tiltmark/TiltmarkRuntime';
import {
  isPaperTiltmarkPaintFrame,
  PaperTiltmarkCanvasLayer,
} from './PaperTiltmarkCanvasLayer';
import { PaperHaneStrokePreviewCanvas } from './PaperHaneStrokePreviewCanvas';
import { PaperObjectLibraryDialog } from './PaperObjectLibraryDialog';
import type {
  ApiKeys,
  PaperPrintUpscaleMethod,
  ProviderSettings,
} from '../../../types/flow';
import type {
  PaperBubbleConnectorStyle,
  PaperDocument,
  PaperEmphasisMark,
  PaperFrame,
  PaperFrameKind,
  PaperFramePatch,
  PaperImportedFont,
  PaperGuide,
  PaperManagedFontStyle,
  PaperLineBreak,
  PaperManagedFontFace,
  PaperNumericStyle,
  PaperPage,
  PaperPagePreset,
  PaperParagraphBorderEdge,
  PaperRichParagraph,
  PaperTextAlignLast,
  PaperTextOrientation,
  PaperTextRun,
  PaperTypography,
  PaperTextWrapMode,
  PaperTool,
} from '../../../types/paper';
import type { SourceBinLibraryItem } from '../../../store/sourceBinStore';

// Exact CSS pt->px ratio (96 CSS px per inch / 72pt per inch) — what a browser applies when it resolves a
// native `pt` CSS unit itself (as the print/export HTML in src/lib/paperDocument.ts's renderPrintFrame does,
// via `font-size: Npt` / `line-height: Npt`). This file used to hand-round that to a bare 1.333 literal at
// every pt->px call site (fontSize, lineHeight, border padding, run overrides): a real but tiny (~0.025%)
// drift from the print path's math, found while investigating why workspace text measurement can differ from
// print (see the metric-drift note in the commit that introduced this constant). Replaces every prior 1.333.
const PT_TO_PX = 96 / 72;
const PAPER_PASTEBOARD_PADDING_PX = 160;
const PAPER_PAGE_OVERLAY_Z = PAPER_CANVAS_BLEED_Z;
const PAPER_GUIDE_OVERLAY_Z = PAPER_CANVAS_GUIDE_Z;
const PAPER_CUT_OVERLAY_Z = PAPER_CANVAS_CUT_Z;
const PAPER_TOOLS_PALETTE_STORAGE_KEY = 'signal-loom-paper-tools-palette-position';
const PAPER_TOOLS_PALETTE_DEFAULT_POSITION: PaperToolsPalettePosition = { x: 368, y: 112 };
const PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN = 8;
const PAPER_DOCUMENT_TABS_HEIGHT_PX = 36;
const PAPER_TOOLBAR_POINTER_CLICK_SUPPRESSION_MS = 700;
const DEFAULT_PAPER_PRINT_UPSCALE_PROMPT = 'Preserve the original comic page artwork, composition, characters, line art, colors, readable lettering, panel layout, lighting, and perspective while improving print-resolution detail and clean edges. Do not add, remove, crop, or rearrange content.';
const PAPER_NATIVE_MENU_COMMAND_PREFIXES = ['paper:', 'edit:'] as const;
const PAPER_IMAGE_QUICK_EDIT_PROVIDERS: Array<{ value: GenerativeFillProvider; label: string }> = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'stability', label: 'Stability' },
  { value: 'bfl', label: 'BFL FLUX.2' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'localOpen', label: 'Local/Open' },
  { value: 'generic', label: 'Generic HTTP' },
];
const PAPER_FONT_OPTIONS = [
  { label: 'Sans', value: PAPER_SAFE_SANS },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Comic Sans MS', value: '"Comic Sans MS", "Comic Sans", cursive' },
  { label: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  // Japanese families for 縦組 / manga lettering. Gothic (角ゴシック) is the body/UI sans; Mincho (明朝) the serif
  // for prose. The stacks prefer OS-bundled JP faces, then the Noto CJK JP webfonts, then a generic fallback.
  { label: '明朝 Mincho (JP serif)', value: "'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif CJK JP', 'Noto Serif JP', 'MS Mincho', serif" },
  { label: 'ゴシック Gothic (JP sans)', value: "'Hiragino Kaku Gothic ProN', 'Yu Gothic', YuGothic, 'Noto Sans CJK JP', 'Noto Sans JP', Meiryo, 'MS Gothic', sans-serif" },
  { label: '丸ゴシック Maru Gothic (rounded)', value: "'Hiragino Maru Gothic ProN', 'Rounded Mplus 1c', 'Zen Maru Gothic', 'M PLUS Rounded 1c', 'Yu Gothic', sans-serif" },
] as const;
const PAPER_FONT_WEIGHTS = ['300', '400', '500', '600', '700', '800', '900'] as const;
const DEFAULT_PAPER_WEBCOMIC_EXPORT_SETTINGS: PaperWebcomicExportSettings = {
  format: 'png',
  outputWidthPx: 1600,
  outputDpi: 144,
  quality: 0.9,
  includeBleed: false,
};
const PAPER_KDP_EXPORT_SETTINGS_STORAGE_KEY = 'signal-loom-paper-kdp-export-settings';
const DEFAULT_PAPER_KDP_EXPORT_SETTINGS: PaperKdpExportSettings = {
  dpi: 300,
  interiorType: 'premium-color',
  paperType: 'white',
  spineFillColor: '#ffffff',
  directoryName: '',
  allowPreflightErrors: false,
};

function isPaperStabilityUpscaleProvider(
  provider: PaperPrintUpscaleBusyProvider,
): provider is 'stability-fast' | 'stability-conservative' {
  return provider === 'stability-fast' || provider === 'stability-conservative';
}

function buildPaperStabilityPlacementRequirement(
  document: Pick<PaperDocument, 'page'>,
  frame: Pick<PaperFrame, 'widthMm' | 'heightMm'>,
  target: PaperPrintUpscaleTarget,
): PaperImagePlacementRequirement {
  const placedWidthIn = Math.max(0.01, frame.widthMm / 25.4);
  const placedHeightIn = Math.max(0.01, frame.heightMm / 25.4);
  const requiredPpi = Math.max(300, Math.round(document.page.dpi));
  return {
    placedWidthIn,
    placedHeightIn,
    requiredPpi,
    requiredPixels: {
      width: Math.max(target.targetWidthPx, Math.ceil(placedWidthIn * requiredPpi)),
      height: Math.max(target.targetHeightPx, Math.ceil(placedHeightIn * requiredPpi)),
    },
  };
}

function resolvePaperEyedropperBackgroundColor(background: PaperDocument['background']): string {
  if (background.type === 'solid') return background.color;
  return background.fromColor;
}

type PaperInteraction =
  | {
      kind: 'create';
      pageId: string;
      frameKind: PaperFrameKind;
      shapeKind?: PaperFrame['shapeKind'];
      start: PaperPoint;
      current: PaperPoint;
    }
  | {
      kind: 'move';
      pageId: string;
      frameIds: string[];
      start: PaperPoint;
      frameStarts: PaperFrame[];
    }
  | {
      kind: 'image-crop-pan';
      pageId: string;
      frameId: string;
      start: PaperPoint;
      frameStart: PaperFrame;
    }
  | {
      kind: 'image-crop-scale';
      pageId: string;
      frameId: string;
      frameStart: PaperFrame;
    }
  | {
      kind: 'image-crop-rotate';
      pageId: string;
      frameId: string;
      frameStart: PaperFrame;
    }
  | {
      kind: 'frame-vertex';
      pageId: string;
      frameId: string;
      vertexIndex: number;
    }
  | {
      kind: 'resize';
      pageId: string;
      frameId: string;
      handle: PaperResizeHandle;
      start: PaperPoint;
      frameStart: PaperFrame;
    }
  | {
      kind: 'rotate';
      pageId: string;
      frameId: string;
      frameStart: PaperFrame;
    }
  | {
      kind: 'bubble-handle';
      pageId: string;
      frameId: string;
      handle: PaperBubbleHandle;
    }
  | {
      kind: 'bubble-connector-handle';
      pageId: string;
      fromFrameId: string;
      toFrameId: string;
      handle: PaperBubbleConnectorHandle;
    }
  | {
      kind: 'bubble-text-move';
      pageId: string;
      frameId: string;
      start: PaperPoint;
      frameStart: PaperFrame;
    }
  | {
      kind: 'bubble-text-resize';
      pageId: string;
      frameId: string;
      handle: PaperResizeHandle;
      start: PaperPoint;
      frameStart: PaperFrame;
    }
  | {
      kind: 'bubble-text-rotate';
      pageId: string;
      frameId: string;
      frameStart: PaperFrame;
    }
  | {
      kind: 'gutterKnife';
      pageId: string;
      start: PaperPoint;
      current: PaperPoint;
    }
  | {
      kind: 'guide';
      pageId: string;
      guideId: string;
      orientation: PaperGuideOrientation;
    };

type PaperInteractionModifiers = {
  shiftKey?: boolean;
};

type PaperPrintUpscaleBusyState = {
  title: string;
  detail: string;
  provider: PaperPrintUpscaleBusyProvider;
  current?: number;
  total?: number;
};

type PaperExportNoticeState = Omit<PaperExportOutcome, 'state'> & {
  state: PaperExportOutcome['state'] | 'busy';
};

type PaperWebcomicExportSettings = {
  format: 'png' | 'jpeg';
  outputWidthPx: number;
  outputDpi: number;
  quality: number;
  includeBleed: boolean;
};

type PaperKdpExportSettings = {
  dpi: number;
  interiorType: PaperKdpInteriorType;
  paperType: PaperKdpPaperType;
  spineWidthMm?: number;
  spineFillColor: string;
  directoryName: string;
  allowPreflightErrors: boolean;
};

type PaperToolsPalettePosition = {
  x: number;
  y: number;
};

type PaperContextMenuState = {
  x: number;
  y: number;
  pageId: string;
  frameId?: string;
  point: PaperPoint;
};

type PaperTouchNavigationPoint = {
  clientX: number;
  clientY: number;
};

type PaperTouchNavigationPinchState = {
  startDistance: number;
  startZoom: number;
  anchorX: number;
  anchorY: number;
  viewportX: number;
  viewportY: number;
  lastStatusZoom: number;
};

const PAPER_TOOLBAR_SFX_PRESETS: readonly PaperComicSfxPresetId[] = PAPER_COMIC_SFX_PRESET_IDS;

function paperTouchNavigationDistance(a: PaperTouchNavigationPoint, b: PaperTouchNavigationPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function paperTouchNavigationCenter(points: PaperTouchNavigationPoint[]): PaperTouchNavigationPoint {
  const total = points.reduce(
    (sum, point) => ({ clientX: sum.clientX + point.clientX, clientY: sum.clientY + point.clientY }),
    { clientX: 0, clientY: 0 },
  );
  return {
    clientX: total.clientX / Math.max(1, points.length),
    clientY: total.clientY / Math.max(1, points.length),
  };
}

export function PaperWorkspace() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  const [paperToolsCollapsed, setPaperToolsCollapsed] = useState(false);
  const workspacePanRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const touchNavigationPointersRef = useRef<Map<number, PaperTouchNavigationPoint>>(new Map());
  const touchNavigationPinchRef = useRef<PaperTouchNavigationPinchState | null>(null);
  const document = usePaperStore((s) => s.document);
  const activeDocumentId = usePaperStore((s) => s.activeDocumentId);
  const activeDocumentInstanceId = usePaperStore((s) => s.documentInstanceIds[s.activeDocumentId]);
  // Register the document's imported fonts as live browser faces so the editor renders them.
  const managedFontRegistration = useRegisterImportedFonts(document.importedFonts);
  const selectedPageId = usePaperStore((s) => s.selectedPageId);
  const selectedFrameId = usePaperStore((s) => s.selectedFrameId);
  const selectedFrameIds = usePaperStore((s) => s.selectedFrameIds);
  const tool = usePaperStore((s) => s.tool);
  const zoom = usePaperStore((s) => s.zoom);
  const createNewDocument = usePaperStore((s) => s.createNewDocument);
  const exportDocumentJson = usePaperStore((s) => s.exportDocumentJson);
  const updateDocumentSetup = usePaperStore((s) => s.updateDocumentSetup);
  const updatePaperPublicationReferences = usePaperStore((s) => s.updatePaperPublicationReferences);
  const updatePaperTrackChanges = usePaperStore((s) => s.updatePaperTrackChanges);
  const decidePaperTrackChange = usePaperStore((s) => s.decidePaperTrackChange);
  const updateStyleAutomation = usePaperStore((s) => s.updateStyleAutomation);
  const setTool = usePaperStore((s) => s.setTool);
  const setZoom = usePaperStore((s) => s.setZoom);
  const selectPage = usePaperStore((s) => s.selectPage);
  const selectFrame = usePaperStore((s) => s.selectFrame);
  const selectFrameWithMode = usePaperStore((s) => s.selectFrameWithMode);
  const selectAllFramesOnSelectedPage = usePaperStore((s) => s.selectAllFramesOnSelectedPage);
  const deselectFrames = usePaperStore((s) => s.deselectFrames);
  const invertFrameSelectionOnSelectedPage = usePaperStore((s) => s.invertFrameSelectionOnSelectedPage);
  const undo = usePaperStore((s) => s.undo);
  const redo = usePaperStore((s) => s.redo);
  const copySelection = usePaperStore((s) => s.copySelection);
  const cutSelection = usePaperStore((s) => s.cutSelection);
  const pasteSelection = usePaperStore((s) => s.pasteSelection);
  const styleClipboard = usePaperStore((s) => s.styleClipboard);
  const copySelectedFrameStyle = usePaperStore((s) => s.copySelectedFrameStyle);
  const pasteFrameStyleToSelection = usePaperStore((s) => s.pasteFrameStyleToSelection);
  const deleteSelection = usePaperStore((s) => s.deleteSelection);
  const addPage = usePaperStore((s) => s.addPage);
  const duplicatePage = usePaperStore((s) => s.duplicatePage);
  const deletePage = usePaperStore((s) => s.deletePage);
  const addFrame = usePaperStore((s) => s.addFrame);
  const addFrameToPage = usePaperStore((s) => s.addFrameToPage);
  const addLayer = usePaperStore((s) => s.addLayer);
  const renameLayer = usePaperStore((s) => s.renameLayer);
  const moveLayer = usePaperStore((s) => s.moveLayer);
  const setLayerVisibility = usePaperStore((s) => s.setLayerVisibility);
  const setLayerPrintability = usePaperStore((s) => s.setLayerPrintability);
  const setLayerLocked = usePaperStore((s) => s.setLayerLocked);
  const assignSelectionToLayer = usePaperStore((s) => s.assignSelectionToLayer);
  const addReviewComment = usePaperStore((s) => s.addReviewComment);
  const addReviewReply = usePaperStore((s) => s.addReviewReply);
  const setReviewCommentResolved = usePaperStore((s) => s.setReviewCommentResolved);
  const deleteReviewComment = usePaperStore((s) => s.deleteReviewComment);
  const addPolygonShapeToPage = usePaperStore((s) => s.addPolygonShapeToPage);
  const splitPanelFrames = usePaperStore((s) => s.splitPanelFrames);
  const updateFrame = usePaperStore((s) => s.updateFrame);
  const updateSelectedFrame = usePaperStore((s) => s.updateSelectedFrame);
  const addParentPage = usePaperStore((s) => s.addParentPage);
  const assignParentPage = usePaperStore((s) => s.assignParentPage);
  const addFrameToParentPage = usePaperStore((s) => s.addFrameToParentPage);
  const detachInheritedFrame = usePaperStore((s) => s.detachInheritedFrame);
  const redefineSelectedStyle = usePaperStore((s) => s.redefineSelectedStyle);
  const clearSelectedStyleLinks = usePaperStore((s) => s.clearSelectedStyleLinks);
  const clearSelectedStyleOverrides = usePaperStore((s) => s.clearSelectedStyleOverrides);
  const threadSelectedFrames = usePaperStore((s) => s.threadSelectedFrames);
  const unthreadSelectedFrames = usePaperStore((s) => s.unthreadSelectedFrames);
  const alignSelectedFrames = usePaperStore((s) => s.alignSelectedFrames);
  const distributeSelectedFrames = usePaperStore((s) => s.distributeSelectedFrames);
  const chainSelectedBubbles = usePaperStore((s) => s.chainSelectedBubbles);
  const chainSelectedBubbleWith = usePaperStore((s) => s.chainSelectedBubbleWith);
  const moveSelectedBubbleInChain = usePaperStore((s) => s.moveSelectedBubbleInChain);
  const unchainBubble = usePaperStore((s) => s.unchainBubble);
  const unchainSelectedBubbles = usePaperStore((s) => s.unchainSelectedBubbles);
  const addPaperSwatch = usePaperStore((s) => s.addPaperSwatch);
  const removePaperSwatch = usePaperStore((s) => s.removePaperSwatch);
  const replaceAllInPaperText = usePaperStore((s) => s.replaceAllInPaperText);
  const addComicSfx = usePaperStore((s) => s.addComicSfx);
  const placeSourceAssetAt = usePaperStore((s) => s.placeSourceAssetAt);
  const [frameFixTarget, setFrameFixTarget] = useState<{ pageId: string; frameId: string } | null>(null);
  const runFrameContextAction = usePaperStore((s) => s.runFrameContextAction);
  const runPageContextAction = usePaperStore((s) => s.runPageContextAction);
  const nudgeSelectedFrame = usePaperStore((s) => s.nudgeSelectedFrame);
  const addGuideToPage = usePaperStore((s) => s.addGuideToPage);
  const updateGuide = usePaperStore((s) => s.updateGuide);
  const toggleViewOption = usePaperStore((s) => s.toggleViewOption);
  const setViewOption = usePaperStore((s) => s.setViewOption);
  const openImageDocument = useImageEditorStore((s) => s.openDocument);
  const setImageBrushSettings = useImageEditorStore((s) => s.setBrushSettings);
  const setWorkspaceView = useEditorStore((s) => s.setWorkspaceView);
  const setSelectedSourceItemId = useEditorStore((s) => s.setSelectedSourceItemId);
  const setSourceBinTab = useEditorStore((s) => s.setSourceBinTab);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const defaultModels = useSettingsStore((s) => s.defaultModels);
  const providerSettings = useSettingsStore((s) => s.providerSettings);
  const tiltmarkLicensed = useSettingsStore((s) => s.license.licensed);
  const keyboardShortcuts = useSettingsStore((s) => s.keyboardShortcuts);
  const locale = useSettingsStore((s) => s.locale);
  const setProviderSetting = useSettingsStore((s) => s.setProviderSetting);
  const panelLayouts = useDockablePanelStore((s) => s.layouts);
  const setPanelMode = useDockablePanelStore((s) => s.setPanelMode);
  const hidePanel = useDockablePanelStore((s) => s.hidePanel);
  const resetWorkspacePanels = useDockablePanelStore((s) => s.resetWorkspacePanels);
  const paperDockableDefaults = useMemo(() => createPaperDockablePanelDefaults(), []);
  const paperDockableDefaultModeById = useMemo(
    () => new Map(paperDockableDefaults.map((panel) => [panel.panelId, panel.mode ?? 'docked'])),
    [paperDockableDefaults],
  );
  const sourceBins = useSourceBinStore((s) => s.bins);
  const addSourceAssetItem = useSourceBinStore((s) => s.addAssetItem);
  const setSourceSidebarOpen = useSourceBinStore((s) => s.setSidebarOpen);
  const sourceItems = useMemo(
    () => sourceBins.flatMap((bin) => bin.items),
    [sourceBins],
  );
  const haneLinkedEdit = useHaneLinkedEditStore();
  const preflightReport = useMemo(
    () => analyzePaperPreflight(document, sourceItems),
    [document, sourceItems],
  );
  const preflightStatus = useMemo(
    () => summarizePaperPreflightStatus(preflightReport),
    [preflightReport],
  );
  const [status, setStatus] = useState<string>('Paper workspace ready.');
  const [exportNotice, setExportNotice] = useState<PaperExportNoticeState | null>(null);
  const [printUpscaleBusy, setPrintUpscaleBusy] = useState<PaperPrintUpscaleBusyState | null>(null);
  const [interaction, setInteraction] = useState<PaperInteraction | null>(null);
  const [smartGuides, setSmartGuides] = useState<Array<PaperSmartGuideLine & { pageId: string }>>([]);
  const interactionRef = useRef<PaperInteraction | null>(null);
  const [contextMenu, setContextMenu] = useState<PaperContextMenuState | null>(null);
  const [quickEditTarget, setQuickEditTarget] = useState<{ pageId: string; frameId: string } | null>(null);
  const [printUpscaleTarget, setPrintUpscaleTarget] = useState<{ pageId: string; frameId: string } | null>(null);
  const [haneBlankTarget, setHaneBlankTarget] = useState<{ pageId: string; frameId: string } | null>(null);
  const [haneBlankBusy, setHaneBlankBusy] = useState(false);
  const [comicSfxDesigner, setComicSfxDesigner] = useState<{
    presetId: PaperComicSfxPresetId;
    pageId?: string;
    point?: PaperPoint;
    frameId?: string;
    initialDesign?: PaperComicSfxDesign;
  } | null>(null);
  const [webcomicExportOpen, setWebcomicExportOpen] = useState(false);
  const [webcomicExportSettings, setWebcomicExportSettings] = useState<PaperWebcomicExportSettings>(DEFAULT_PAPER_WEBCOMIC_EXPORT_SETTINGS);
  const [kdpExportOpen, setKdpExportOpen] = useState(false);
  const [kdpExportSettings, setKdpExportSettings] = useState<PaperKdpExportSettings>(() => loadPaperKdpExportSettings());
  const [softProofOpen, setSoftProofOpen] = useState(false);
  const [objectLibraryOpen, setObjectLibraryOpen] = useState(false);
  const applyManagedIccProfileChange = useCallback((change: PaperIccProfileManagerChange) => {
    const selected = change.profiles.find((profile) => profile.id === change.selectedProfileAssetId);
    const exactCondition = (change.outputConditionId ?? selected?.outputConditionId ?? '').trim();
    const currentIntent = PAPER_OUTPUT_INTENT_PROFILES[document.printProduction.outputIntentProfileId];
    const currentCondition = document.printProduction.outputIntentProfileId === 'custom'
      ? document.printProduction.customOutputIntentName.trim()
      : currentIntent.printingCondition ?? '';
    updateDocumentSetup({
      managedIccProfiles: change.profiles,
      printProduction: {
        outputIntentProfileAssetId: change.selectedProfileAssetId,
        ...(exactCondition && exactCondition !== currentCondition ? {
          outputIntentProfileId: 'custom',
          customOutputIntentName: exactCondition,
        } : {}),
      },
    });
  }, [document.printProduction, updateDocumentSetup]);
  const [polygonPoints, setPolygonPoints] = useState<Array<PaperPoint & { pageId: string }>>([]);
  const [modifierState, setModifierState] = useState({ ctrlKey: false, metaKey: false });
  // On Android, holding Volume Down acts as a Ctrl-equivalent modifier for frame reshaping (handle
  // grabbing / dragging sides / adding points). Tracked separately because the forwarded synthetic
  // volume key events don't carry a real ctrlKey flag. See the volume-key effect + MainActivity.
  const [volumeCtrlHeld, setVolumeCtrlHeld] = useState(false);
  const [paperViewport, setPaperViewport] = useState({ scrollTop: 0, viewportHeight: 1200 });
  const [paperToolsVisible, setPaperToolsVisible] = useState(true);
  const [paperToolsPosition, setPaperToolsPosition] = useState<PaperToolsPalettePosition>(() => loadPaperToolsPalettePosition());
  const mobilePhoneInterface = useMobilePhoneInterfaceDescriptor();
  const mobileChromeMode = useMobileInterfaceStore((state) => state.chromeMode);
  const activeEdgeDrawer = useMobileInterfaceStore((state) => state.activeEdgeDrawer);
  const setActiveEdgeDrawer = useMobileInterfaceStore((state) => state.setActiveEdgeDrawer);
  const toggleEdgeDrawer = useMobileInterfaceStore((state) => state.toggleEdgeDrawer);
  const paperTouchNavigation = useTouchNavigationStore((state) => state.paper);
  const setPaperTouchNavigationEnabled = useTouchNavigationStore((state) => state.setPaperTouchNavigationEnabled);
  const setPaperTouchNavigationGesture = useTouchNavigationStore((state) => state.setPaperTouchNavigationGesture);
  const paperTouchNavigationAvailability = usePaperTouchNavigationAvailabilityDescriptor();
  const workspaceChromeHidden = mobilePhoneInterface.enabled && mobileChromeMode === 'hidden';
  const workspaceChromePaddingClassName = workspaceChromeHidden
    ? mobilePhoneInterface.hiddenTopPaddingClassName
    : mobilePhoneInterface.enabled
      ? mobilePhoneInterface.collapsedTopPaddingClassName
    // Desktop: the shared top bar is in-flow (the workspace sits below it already) and Paper portals
    // its controls up into that bar, so this used to add a 64px empty band under it — same dead
    // padding that was removed from the Image editor. No top padding needed.
    : 'pt-0';
  const showWorkspaceChrome = !workspaceChromeHidden;
  const usePaperPhoneShell = mobilePhoneInterface.enabled;
  const activePaperEdgeDrawer: PaperMobileEdgeDrawerId | null =
    activeEdgeDrawer === 'source' || activeEdgeDrawer === 'panels' || activeEdgeDrawer === 'assets'
      ? activeEdgeDrawer
      : null;
  const paperFloatingToolsTopInsetPx = mobilePhoneInterface.enabled
    ? mobilePhoneInterface.topbarHeightPx + PAPER_DOCUMENT_TABS_HEIGHT_PX + PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN
    : PAPER_TOOLS_PALETTE_DEFAULT_POSITION.y + PAPER_DOCUMENT_TABS_HEIGHT_PX;
  // Same small margin on both sides so the tools palette can be dragged all the way to the
  // left edge, past the source-bin drawer handle (it already moves past the right panels
  // handle). The left handle no longer blocks palette movement.
  const paperFloatingToolsLeftInsetPx = PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN;
  const paperTouchNavigationAvailable = paperTouchNavigationAvailability.available;
  const paperTouchNavigationActive =
    paperTouchNavigationAvailable &&
    paperTouchNavigation.enabled &&
    (paperTouchNavigation.oneFingerPan || paperTouchNavigation.pinchZoom);
  const [touchNavigationPanelOpen, setTouchNavigationPanelOpen] = useState(false);

  const showPaperExportProgress = useCallback((message: string, targetKind: PaperExportOutcome['targetKind']) => {
    setStatus(message);
    setExportNotice({ message, state: 'busy', targetKind });
  }, []);
  const finishPaperExportNotice = useCallback((outcome: PaperExportOutcome) => {
    setStatus(outcome.message);
    setExportNotice(outcome);
  }, []);

  const materializePaperOutputDocument = useCallback(async (
    sourceDocument: PaperDocument,
    rasterizationGuard?: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>,
  ): Promise<PaperDocument | undefined> => {
    try {
      return rasterizationGuard
        ? await materializePaperRasterOutputDocument(sourceDocument, rasterizationGuard)
        : await materializePaperDocumentAssetUrls(sourceDocument, sourceItems);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'A Paper asset could not be resolved.';
      setStatus(`Export blocked: ${message}`);
      return undefined;
    }
  }, [sourceItems]);

  const selectedPage = document.pages.find((page) => page.id === selectedPageId) ?? document.pages[0];
  const selectedFrame = selectedPage?.frames.find((frame) => frame.id === selectedFrameId) ?? null;
  const writingSource = useMemo(() => {
    if (!activeDocumentInstanceId) return null;
    if (!selectedPage || !selectedFrame || !isPaperInlineTextFrame(selectedFrame) || selectedFrame.inherited) {
      return createPaperWritingSourceSnapshot({
        workspaceDocumentId: activeDocumentId,
        documentInstanceId: activeDocumentInstanceId,
        documentId: document.id,
        sourceKind: 'plain-text',
        sourceRevision: document.updatedAt,
        targetEditable: false,
        text: '',
      });
    }
    return createPaperWritingSourceSnapshot({
      workspaceDocumentId: activeDocumentId,
      documentInstanceId: activeDocumentInstanceId,
      documentId: document.id,
      pageId: selectedPage.id,
      frameId: selectedFrame.id,
      sourceKind: selectedFrame.richText?.length ? 'rich-text' : 'plain-text',
      sourceRevision: document.updatedAt,
      targetEditable: !selectedFrame.locked && !paperFrameLayerIsLocked(document, selectedFrame),
      text: selectedFrame.text ?? '',
    });
  }, [activeDocumentId, activeDocumentInstanceId, document, selectedFrame, selectedPage]);
  const writingRuntimeSettings = useMemo(() => ({
    apiKeys,
    defaultModels,
    providerSettings,
  }), [apiKeys, defaultModels, providerSettings]);
  const [nativeCliAgentCapabilities, setNativeCliAgentCapabilities] = useState<NativeCliAgentCapability[]>([]);
  const paperNativeBridge = getSignalLoomNativeBridge();
  useEffect(() => {
    let active = true;
    if (!paperNativeBridge?.nativeCliAgentCapabilities) {
      return () => { active = false; };
    }
    void paperNativeBridge.nativeCliAgentCapabilities()
      .then((result) => {
        if (active) setNativeCliAgentCapabilities(result.agents);
      })
      .catch(() => {
        if (active) setNativeCliAgentCapabilities([]);
      });
    return () => { active = false; };
  }, [paperNativeBridge]);
  const writingExecutor = useMemo(() => {
    const flowExecutor = createFlowPaperWritingTextExecutor(writingRuntimeSettings);
    const nativeExecutor = paperNativeBridge?.runNativeCliAgent
      ? createNativeCliPaperWritingTextExecutor(paperNativeBridge)
      : undefined;
    return createPaperWritingTextExecutor(flowExecutor, nativeExecutor);
  }, [paperNativeBridge, writingRuntimeSettings]);
  const writingProviderOptions = useMemo<PaperWritingProviderOption[]>(() => {
    const proxied = providerSettings.backendProxyEnabled && Boolean(providerSettings.backendProxyBaseUrl.trim());
    return [
      {
        provider: 'gemini',
        label: PROVIDER_LABELS.gemini,
        modelId: defaultModels.text.gemini,
        available: proxied || Boolean(apiKeys.gemini.trim()) || isVertexProjectConfigured(providerSettings),
        unavailableReason: 'Configure a Gemini API key, Vertex project, or backend proxy.',
      },
      {
        provider: 'openai',
        label: PROVIDER_LABELS.openai,
        modelId: defaultModels.text.openai,
        available: proxied || Boolean(apiKeys.openai.trim()) || Boolean(providerSettings.openaiBaseUrl.trim()),
        unavailableReason: 'Configure an OpenAI key, compatible endpoint, or backend proxy.',
      },
      {
        provider: 'huggingface',
        label: PROVIDER_LABELS.huggingface,
        modelId: defaultModels.text.huggingface,
        available: proxied || Boolean(apiKeys.huggingface.trim()),
        unavailableReason: 'Configure a Hugging Face token or backend proxy.',
      },
      ...nativeCliAgentCapabilities.map((capability): PaperWritingProviderOption => ({
        provider: `native-cli:${capability.id}`,
        label: `${capability.label} · existing CLI sign-in`,
        available: capability.available && Boolean(paperNativeBridge?.runNativeCliAgent),
        unavailableReason: `${capability.label} is not installed or executable in the desktop app environment.`,
      })),
    ];
  }, [apiKeys.gemini, apiKeys.huggingface, apiKeys.openai, defaultModels.text.gemini, defaultModels.text.huggingface, defaultModels.text.openai, nativeCliAgentCapabilities, paperNativeBridge?.runNativeCliAgent, providerSettings]);
  const writingProviderConfigurationKey = useMemo(() => writingProviderOptions
    .map((option) => `${option.provider}:${option.modelId ?? ''}:${option.available ? '1' : '0'}`)
    .join('|'), [writingProviderOptions]);
  const shortcutHelpLabels = useMemo<PaperShortcutHelpPanelLabels | undefined>(() => locale === 'ja'
    ? {
        title: 'Paper ショートカット',
        description: 'コマンドのショートカットはキーボード設定に従います。キャンバスとテキスト編集の操作は状況に応じて利用できます。',
        searchLabel: 'Paper ショートカットを検索',
        searchPlaceholder: 'コマンド、キー、グループを検索',
        noResults: '一致する Paper ショートカットはありません。',
        count: (value) => `${value}件のショートカット`,
        canvasGroup: 'キャンバス',
        textEditingGroup: 'テキスト編集',
      }
    : undefined, [locale]);
  const generateWritingPreview = useCallback(async (
    request: Parameters<typeof generatePaperWritingPreview>[0],
    signal: AbortSignal,
  ) => {
    setStatus(`Generating ${request.action} preview with ${request.provider}…`);
    const preview = await generatePaperWritingPreview(request, writingExecutor, {
      signal,
      onStatus: (message) => setStatus(`Writing assistant: ${message}`),
    });
    if (preview.usage) {
      useProjectUsageStore.getState().recordUsage({
        workspace: 'paper',
        operation: `writing-assistant:${request.action}`,
        usage: preview.usage,
      });
    }
    setStatus(`Generated a ${request.action} preview. Review it before applying.`);
    return preview;
  }, [writingExecutor]);
  const generateAssistedLayoutPreview = useCallback(async (
    request: Parameters<typeof generatePaperAssistedLayoutPreview>[0],
    signal: AbortSignal,
  ) => {
    setStatus(`Generating an assisted layout preview with ${request.provider}…`);
    const preview = await generatePaperAssistedLayoutPreview(request, writingExecutor, {
      signal,
      onStatus: (message) => setStatus(`Assisted layout: ${message}`),
    });
    if (preview.usage) {
      useProjectUsageStore.getState().recordUsage({
        workspace: 'paper',
        operation: 'assisted-layout',
        usage: preview.usage,
      });
    }
    setStatus(`Generated a ${preview.summary.pages}-page layout proposal. Review it before opening.`);
    return preview;
  }, [writingExecutor]);
  const openAssistedLayoutAsNewDocument = useCallback((
    generatedDocument: PaperAssistedLayoutPreview['document'],
    preview: PaperAssistedLayoutPreview,
  ) => {
    const documentId = usePaperStore.getState().addGeneratedDocument(generatedDocument, {
      authorization: capturePaperWorkspaceAuthorization(),
    });
    if (!documentId) {
      setStatus('Assisted layout was not opened because the Paper workspace changed. Review the proposal and try again.');
      return;
    }
    setStatus(`Opened the ${preview.summary.pages}-page assisted layout as a separate editable document.`);
  }, []);
  const startLiveLayoutAgent = useCallback((request: PaperLiveLayoutAgentStartRequest) => {
    usePaperLiveLayoutAgentSession.getState().start(request, {
      executor: writingExecutor,
      getDocument: () => usePaperStore.getState().document,
      mutateDocument: (mutate) => usePaperStore.getState().mutatePaperDocumentForLiveAgent(mutate),
      listSourceItems: () => useSourceBinStore.getState().getAllItems(),
      onUsage: (usage) => {
        useProjectUsageStore.getState().recordUsage({
          workspace: 'paper',
          operation: 'live-layout-agent',
          usage,
        });
      },
    });
    setStatus(`Live layout agent started with ${request.provider}${request.modelId ? ` · ${request.modelId}` : ''}. Its edits appear live and are undoable.`);
  }, [writingExecutor]);
  const applyWritingPreview = useCallback((text: string, preview: PaperWritingPreview) => {
    const state = usePaperStore.getState();
    const currentDocumentInstanceId = state.documentInstanceIds[state.activeDocumentId];
    if (!currentDocumentInstanceId || !isPaperWritingSourceOwnedByRuntimeDocument(preview.source, {
      workspaceDocumentId: state.activeDocumentId,
      documentInstanceId: currentDocumentInstanceId,
    })) {
      setStatus('Writing preview not applied: it belongs to another Paper tab or a closed document instance.');
      return;
    }
    const page = preview.source.pageId
      ? state.document.pages.find((candidate) => candidate.id === preview.source.pageId)
      : undefined;
    const frame = preview.source.frameId
      ? page?.frames.find((candidate) => candidate.id === preview.source.frameId)
      : undefined;
    if (!page || !frame || !isPaperInlineTextFrame(frame) || frame.inherited || frame.locked || frame.richText?.length) {
      setStatus('Writing preview not applied: the original plain-text frame is no longer editable.');
      return;
    }
    const currentSource = createPaperWritingSourceSnapshot({
      workspaceDocumentId: state.activeDocumentId,
      documentInstanceId: currentDocumentInstanceId,
      documentId: state.document.id,
      pageId: page.id,
      frameId: frame.id,
      sourceKind: 'plain-text',
      sourceRevision: state.document.updatedAt,
      targetEditable: !frame.locked && !paperFrameLayerIsLocked(state.document, frame),
      text: frame.text ?? '',
    });
    if (currentSource.fingerprint !== preview.source.fingerprint) {
      setStatus('Writing preview not applied: the source changed while you were reviewing it.');
      return;
    }
    state.updateFrame(page.id, frame.id, { text });
    setStatus('Applied the reviewed writing preview in one undoable edit.');
  }, []);
  const setActiveInteraction = useCallback((nextInteraction: PaperInteraction | null) => {
    interactionRef.current = nextInteraction;
    setInteraction(nextInteraction);
  }, []);
  const selectedBubbleCount = useMemo(() => {
    if (!selectedPage) return 0;
    const selectedIds = new Set(selectedFrameIds.length ? selectedFrameIds : selectedFrameId ? [selectedFrameId] : []);
    return selectedPage.frames.filter((frame) =>
      selectedIds.has(frame.id) && (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble')
    ).length;
  }, [selectedFrameId, selectedFrameIds, selectedPage]);
  const bubbleChainActionsDisabled = useMemo(() => {
    if (!selectedPage) return true;
    const selectedIds = new Set(selectedFrameIds.length ? selectedFrameIds : selectedFrameId ? [selectedFrameId] : []);
    const selectedBubbles = selectedPage.frames.filter((frame) =>
      selectedIds.has(frame.id) && (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble')
    );
    const completeMembers = new Map(selectedBubbles.map((frame) => [frame.id, frame]));
    for (const frame of selectedBubbles) {
      if (!frame.bubbleChainId) continue;
      for (const member of getPaperBubbleChainFrames(selectedPage.frames, frame.bubbleChainId)) {
        completeMembers.set(member.id, member);
      }
    }
    return [...completeMembers.values()].some((frame) => (
      Boolean(frame.inherited || frame.locked) || paperFrameLayerIsLocked(document, frame)
    ));
  }, [document, selectedFrameId, selectedFrameIds, selectedPage]);
  const selectedTextFrameCount = useMemo(() => {
    if (!selectedPage) return 0;
    const selectedIds = new Set(selectedFrameIds.length ? selectedFrameIds : selectedFrameId ? [selectedFrameId] : []);
    return selectedPage.frames.filter((frame) => selectedIds.has(frame.id) && frame.kind === 'text').length;
  }, [selectedFrameId, selectedFrameIds, selectedPage]);
  const selectedFrameCount = useMemo(() => {
    if (!selectedPage) return 0;
    const selectedIds = new Set(selectedFrameIds.length ? selectedFrameIds : selectedFrameId ? [selectedFrameId] : []);
    return selectedPage.frames.filter((frame) => selectedIds.has(frame.id) && !frame.inherited).length;
  }, [selectedFrameId, selectedFrameIds, selectedPage]);
  const resolveFrameImageNaturalSize = useCallback((pageId: string, frame: PaperFrame, naturalWidth: number, naturalHeight: number) => {
    if (frame.inherited) return;
    const patch = resolvePaperImageNaturalSizePatch(frame, naturalWidth, naturalHeight);
    if (patch) {
      updateFrame(pageId, frame.id, patch);
    }
  }, [updateFrame]);
  const isPanelVisible = useCallback((panelId: string, options?: { treatCollapsedAsShown?: boolean }) => {
    const layout = panelLayouts[panelKey(PAPER_DOCKABLE_WORKSPACE_ID, panelId)];
    const mode = resolvePaperPanelMode(layout?.mode, paperDockableDefaultModeById.get(panelId));
    return isPaperPanelShown(mode, options);
  }, [panelLayouts, paperDockableDefaultModeById]);
  const togglePanelVisibility = useCallback((panelId: string, options?: { restoreMode?: 'docked' | 'floating'; treatCollapsedAsShown?: boolean }) => {
    const layout = panelLayouts[panelKey(PAPER_DOCKABLE_WORKSPACE_ID, panelId)];
    const nextMode = getPaperPanelToggleMode(
      resolvePaperPanelMode(layout?.mode, paperDockableDefaultModeById.get(panelId)),
      options,
    );
    if (nextMode === 'hidden') {
      hidePanel(PAPER_DOCKABLE_WORKSPACE_ID, panelId);
    } else {
      setPanelMode(PAPER_DOCKABLE_WORKSPACE_ID, panelId, nextMode);
    }
  }, [hidePanel, panelLayouts, paperDockableDefaultModeById, setPanelMode]);
  const togglePaperToolsPalette = useCallback(() => {
    const nextVisible = !paperToolsVisible;
    setPaperToolsVisible(nextVisible);
    setStatus(nextVisible ? 'Opened Paper Tools palette.' : 'Closed Paper Tools palette.');
  }, [paperToolsVisible]);
  const togglePaperTouchNavigation = useCallback(() => {
    const nextEnabled = !paperTouchNavigation.enabled;
    setPaperTouchNavigationEnabled(nextEnabled);
    setStatus(nextEnabled
      ? 'Finger touch navigation enabled; pen and mouse still edit Paper elements.'
      : 'Finger touch editing restored for Paper.');
  }, [paperTouchNavigation.enabled, setPaperTouchNavigationEnabled]);
  const togglePaperTouchNavigationGesture = useCallback((gesture: 'oneFingerPan' | 'pinchZoom') => {
    const nextEnabled = !paperTouchNavigation[gesture];
    setPaperTouchNavigationGesture(gesture, nextEnabled);
    setStatus(`${gesture === 'oneFingerPan' ? 'One-finger pan' : 'Pinch zoom'} ${nextEnabled ? 'enabled' : 'disabled'} for Paper touch navigation.`);
  }, [paperTouchNavigation, setPaperTouchNavigationGesture]);
  const handlePaperEyedropperPointer = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (tool !== 'eyedropper' || event.button !== 0) return false;
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (!eventTarget) return false;

    const frameId = eventTarget.closest<HTMLElement>('[data-paper-frame-id]')?.dataset.paperFrameId;
    let sampledColor: string | null = null;
    let sampleLabel = 'Paper page';

    if (frameId) {
      for (const page of document.pages) {
        const frame = page.frames.find((candidate) => candidate.id === frameId);
        if (!frame) continue;
        sampledColor = resolvePaperEyedropperFrameColor(frame);
        sampleLabel = frame.label;
        break;
      }
    }

    if (!sampledColor) {
      sampledColor = resolvePaperEyedropperBackgroundColor(document.background);
    }

    event.preventDefault();
    event.stopPropagation();

    if (selectedFrame && !selectedFrame.locked && !selectedFrame.inherited) {
      updateSelectedFrame(buildPaperEyedropperFrameColorPatch(selectedFrame, sampledColor));
      setStatus(`Sampled ${sampledColor} from ${sampleLabel} and applied it to ${selectedFrame.label}.`);
    } else {
      setImageBrushSettings({ color: sampledColor, presetId: undefined });
      setStatus(`Sampled ${sampledColor} from ${sampleLabel}.`);
    }

    return true;
  }, [document.background, document.pages, selectedFrame, setImageBrushSettings, tool, updateSelectedFrame]);
  const sharedSourceBinCanvasOffsetClassName = getPaperDockableCanvasOffsetClassName(
    panelLayouts[panelKey(PAPER_DOCKABLE_WORKSPACE_ID, 'source-bin')],
  );
  const sharedSourceBinCanvasOffsetPx = getSharedSourceBinCanvasOffsetPx(
    panelLayouts[panelKey(PAPER_DOCKABLE_WORKSPACE_ID, 'source-bin')],
  );
  const paperSpreads = useMemo(
    () => buildPaperSpreads(document.pages, {
      enabled: document.view.showSpreads,
      startOnRight: document.view.startOnRight,
      rtlBinding: effectiveRtlBinding(document),
    }),
    [document, document.pages, document.view.showSpreads, document.view.startOnRight, document.view.rtlBinding],
  );
  const activeVirtualPageIds = useMemo(
    () => [selectedPageId, interaction?.pageId].filter((pageId): pageId is string => Boolean(pageId)),
    [interaction?.pageId, selectedPageId],
  );
  const spreadVirtualMetrics = useMemo(
    () => buildPaperSpreadVirtualWindow({
      spreads: paperSpreads,
      pageWidthMm: document.page.widthMm,
      pageHeightMm: document.page.heightMm,
      pxPerMm: PX_PER_MM,
      zoom,
      pasteboardPaddingPx: PAPER_PASTEBOARD_PADDING_PX,
      rulerHeightPx: document.view.showRulers ? 25 : 0,
      gapPx: 40,
      viewportTopPx: paperViewport.scrollTop,
      viewportHeightPx: paperViewport.viewportHeight,
      overscanPx: 1400,
      activePageIds: activeVirtualPageIds,
    }),
    [
      activeVirtualPageIds,
      document.page.heightMm,
      document.page.widthMm,
      document.view.showRulers,
      paperSpreads,
      paperViewport.scrollTop,
      paperViewport.viewportHeight,
      zoom,
    ],
  );
  const spreadVirtualMetricById = useMemo(
    () => new Map(spreadVirtualMetrics.map((metric) => [metric.id, metric])),
    [spreadVirtualMetrics],
  );
  const vertexEditModifierActive = modifierState.ctrlKey || modifierState.metaKey || volumeCtrlHeld;

  const updatePaperViewportFromElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const nextViewport = {
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight || 1200,
    };
    setPaperViewport((current) => (
      current.scrollTop === nextViewport.scrollTop && current.viewportHeight === nextViewport.viewportHeight
        ? current
        : nextViewport
    ));
  }, []);

  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return undefined;

    updatePaperViewportFromElement(element);

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => updatePaperViewportFromElement(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [updatePaperViewportFromElement]);

  useEffect(() => {
    persistPaperKdpExportSettings(kdpExportSettings);
  }, [kdpExportSettings]);

  useEffect(() => {
    persistPaperToolsPalettePosition(paperToolsPosition);
  }, [paperToolsPosition]);
  useEffect(() => {
    setPaperToolsPosition((current) => {
      const next = clampPaperToolsPalettePosition(current, undefined, {
        leftInsetPx: paperFloatingToolsLeftInsetPx,
        topInsetPx: paperFloatingToolsTopInsetPx,
      });
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [mobileChromeMode, mobilePhoneInterface.enabled, paperFloatingToolsLeftInsetPx, paperFloatingToolsTopInsetPx]);

  useEffect(() => {
    const documentRef = globalThis.document;
    if (!documentRef) {
      return undefined;
    }

    return observePaperTopbarSlot(documentRef, setTopbarSlot);
  }, []);

  const selectPaperTarget = useCallback((target: { pageNumber?: number; frameId?: string }) => {
    const targetPage = target.pageNumber
      ? document.pages.find((page) => page.pageNumber === target.pageNumber)
      : target.frameId
        ? document.pages.find((page) => page.frames.some((frame) => frame.id === target.frameId))
        : undefined;
    const page = targetPage ?? selectedPage ?? document.pages[0];
    if (!page) return;
    selectPage(page.id);
    selectFrame(target.frameId && page.frames.some((frame) => frame.id === target.frameId) ? target.frameId : null);
    setStatus(target.frameId ? `Selected frame on page ${page.pageNumber}.` : `Selected page ${page.pageNumber}.`);
  }, [document.pages, selectFrame, selectPage, selectedPage]);

  const confirmPreflightBeforeExport = useCallback(async (label: string, options: { rasterTarget?: boolean } = {}): Promise<boolean> => {
    if (options.rasterTarget) {
      const capabilityBlocker = preflightReport.issues.find((issue) => issue.code === 'paper-placed-document-rasterization-unsupported');
      if (capabilityBlocker) {
        setStatus(`Blocked ${label}: ${capabilityBlocker.detail}`);
        return false;
      }
    }
    const summary = summarizePreflightForExport(preflightReport);
    if (!summary) return true;
    const proceed = await useConfirmationStore.getState().requestConfirmation(
      `${summary}\n\nContinue ${label}?`,
      'Preflight Warnings'
    );
    setStatus(proceed ? `Continuing ${label} despite preflight issues.` : `Canceled ${label}; fix preflight issues or run export again to override.`);
    return proceed;
  }, [preflightReport]);

  const showPreflightFromTopbar = useCallback(() => {
    const preflightPanelId = PAPER_DOCKABLE_PANEL_IDS.preflight;
    if (isPanelVisible(preflightPanelId, { treatCollapsedAsShown: false })) {
      togglePanelVisibility(preflightPanelId, { treatCollapsedAsShown: false });
      setStatus('Closed Preflight panel.');
      return;
    }

    setPanelMode(PAPER_DOCKABLE_WORKSPACE_ID, preflightPanelId, 'docked');
    const firstIssue = preflightReport.issues[0];
    if (firstIssue) {
      selectPaperTarget({ pageNumber: firstIssue.pageNumber, frameId: firstIssue.frameId });
      setStatus(`Opened Preflight and selected first issue: ${firstIssue.title}.`);
      return;
    }
    setStatus('Opened Preflight. No Paper preflight issues detected.');
  }, [isPanelVisible, preflightReport.issues, selectPaperTarget, setPanelMode, togglePanelVisibility]);

  useEffect(() => {
    const updateModifiers = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase();
      // Android forwards held Volume Down as synthetic keydown/keyup (no real ctrlKey on the event) —
      // treat it as the Ctrl-equivalent reshape modifier for the duration of the hold.
      if (key === 'volumedown' || key === 'audiovolumedown') {
        setVolumeCtrlHeld(event.type === 'keydown');
        return;
      }
      setModifierState((current) => {
        const next = { ctrlKey: event.ctrlKey, metaKey: event.metaKey };
        return current.ctrlKey === next.ctrlKey && current.metaKey === next.metaKey ? current : next;
      });
    };
    const resetModifiers = () => {
      setModifierState({ ctrlKey: false, metaKey: false });
      setVolumeCtrlHeld(false);
    };

    window.addEventListener('keydown', updateModifiers);
    window.addEventListener('keyup', updateModifiers);
    window.addEventListener('blur', resetModifiers);
    return () => {
      window.removeEventListener('keydown', updateModifiers);
      window.removeEventListener('keyup', updateModifiers);
      window.removeEventListener('blur', resetModifiers);
    };
  }, []);

  // On Android, capture the hardware volume keys while the Paper workspace is open so Volume Down can
  // act as the Ctrl-equivalent reshape modifier (MainActivity forwards them as synthetic key events).
  // No-op off native; released on unmount so volume keys return to normal elsewhere.
  useEffect(() => {
    void setAndroidInterceptVolumeKeys(true);
    return () => {
      void setAndroidInterceptVolumeKeys(false);
    };
  }, []);

  const finishPolygonShape = useCallback(() => {
    if (polygonPoints.length < 3) return;
    const pageId = polygonPoints[0].pageId;
    if (!polygonPoints.every((point) => point.pageId === pageId)) return;
    const frameId = addPolygonShapeToPage(pageId, polygonPoints.map((point) => ({
      xMm: point.xMm,
      yMm: point.yMm,
    })));
    if (frameId) {
      setStatus(`Created polygon shape with ${polygonPoints.length} vertices.`);
    }
    setPolygonPoints([]);
  }, [addPolygonShapeToPage, polygonPoints]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectAllFramesOnSelectedPage();
        setStatus('Selected all frames on the current page.');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
          setStatus('Redid the last Paper edit.');
        } else {
          undo();
          setStatus('Undid the last Paper edit.');
        }
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        setStatus('Redid the last Paper edit.');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelection();
        setStatus('Copied selected Paper frame(s).');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'x') {
        event.preventDefault();
        cutSelection();
        setStatus('Cut selected Paper frame(s).');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteSelection();
        setStatus('Pasted Paper frame(s).');
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        setStatus('Deleted selected Paper frame(s).');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        deselectFrames();
        setStatus('Deselected Paper frames.');
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        invertFrameSelectionOnSelectedPage();
        setStatus('Inverted the current page frame selection.');
        return;
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
        setPolygonPoints([]);
        return;
      }

      if (event.key === 'Enter' && polygonPoints.length >= 3) {
        event.preventDefault();
        finishPolygonShape();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        if (event.shiftKey) {
          setTool('image');
          setStatus('Image frame tool active. Drag on the page to create a frame.');
        } else {
          setTool('eyedropper');
          setStatus('Eyedropper tool active. Click a Paper frame or page to sample color.');
        }
        return;
      }

      if (!selectedFrameId || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        return;
      }

      event.preventDefault();
      const step = event.shiftKey ? 10 : event.altKey ? 0.25 : 1;
      const deltaXMm = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const deltaYMm = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      nudgeSelectedFrame(deltaXMm, deltaYMm);
      setStatus(`Nudged selected frame ${step} mm.`);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [copySelection, cutSelection, deleteSelection, deselectFrames, finishPolygonShape, invertFrameSelectionOnSelectedPage, nudgeSelectedFrame, pasteSelection, polygonPoints.length, redo, selectAllFramesOnSelectedPage, selectedFrameId, setTool, undo]);

  const runMenuCommand = useCallback(async (command: NativeMenuCommand) => {
    switch (command) {
      case 'edit:undo':
        undo();
        setStatus('Undid the last Paper edit.');
        return;
      case 'edit:redo':
        redo();
        setStatus('Redid the last Paper edit.');
        return;
      case 'edit:copy':
        copySelection();
        setStatus('Copied selected Paper frame(s).');
        return;
      case 'edit:cut':
        cutSelection();
        setStatus('Cut selected Paper frame(s).');
        return;
      case 'edit:paste':
        pasteSelection();
        setStatus('Pasted Paper frame(s).');
        return;
      case 'edit:delete':
        deleteSelection();
        setStatus('Deleted selected Paper frame(s).');
        return;
      case 'edit:select-all':
        selectAllFramesOnSelectedPage();
        setStatus('Selected all frames on the current page.');
        return;
      case 'edit:deselect':
        deselectFrames();
        setStatus('Deselected Paper frames.');
        return;
      case 'edit:invert-selection':
        invertFrameSelectionOnSelectedPage();
        setStatus('Inverted the current page frame selection.');
        return;
      case 'paper:tool-select':
        setTool('select');
        setStatus('Select tool active.');
        return;
      case 'paper:tool-hand':
        setTool('hand');
        setStatus('Hand tool active.');
        return;
      case 'paper:tool-text':
        setTool('text');
        setStatus('Text frame tool active.');
        return;
      case 'paper:tool-image':
        setTool('image');
        setStatus('Image frame tool active.');
        return;
      case 'paper:tool-eyedropper':
        setTool('eyedropper');
        setStatus('Eyedropper tool active.');
        return;
      case 'paper:new-document': {
        const title = await useTextInputDialogStore.getState().requestTextInput({
          title: 'New Paper Document',
          message: 'Name the Paper document before creating a blank layout.',
          label: 'Document title',
          initialValue: 'Untitled Paper Layout',
          placeholder: 'Untitled Paper Layout',
          confirmLabel: 'Create',
        });
        if (title === null) {
          setStatus('New Paper document cancelled.');
          return;
        }
        createNewDocument({ title: title.trim() || 'Untitled Paper Layout' });
        setStatus('Created a new Paper document.');
        return;
      }
      case 'paper:add-page':
        addPage();
        setStatus('Added a page.');
        return;
      case 'paper:export-pdf':
        // Plain browser-PDF stays free; a PDF/X standard or CMYK press intent is commercial.
        if (isCommercialPrintProductionTarget(document.printProduction)
          && !(await requestCommercialExportUnlock('PDF/X and CMYK print production'))) return;
        if (await confirmPreflightBeforeExport('PDF export', { rasterTarget: true })) {
          if (isPdfXProductionTarget(document.printProduction)) {
            // Strict PDF/X consumes the original content-addressed document and freezes it before validation.
            void exportPaperPdfxAndSave(document, setStatus);
          } else {
            let rasterizationGuard: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>;
            try {
              rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : 'PDF export is unavailable.');
              return;
            }
            const outputDocument = await materializePaperOutputDocument(document, rasterizationGuard);
            if (!outputDocument) return;
            void exportPaperPdfDocument(
              outputDocument,
              (message) => showPaperExportProgress(message, 'file'),
              undefined,
              {
                rasterPreset: providerSettings.paperPdfRasterPreset,
                rasterizationGuard,
              },
            ).then(finishPaperExportNotice);
          }
        }
        return;
      case 'paper:export-accessible-pdf':
        void exportPaperTaggedPdfAndSave(document, setStatus);
        return;
      case 'paper:export-epub':
        if (await confirmPreflightBeforeExport('reflowable EPUB export', { rasterTarget: true })) {
          void exportPaperEpubAndSave(document, setStatus);
        }
        return;
      case 'paper:export-kdp-assets':
        if (!(await requestCommercialExportUnlock('KDP export'))) return;
        setKdpExportOpen(true);
        setStatus('Configuring KDP comic asset export.');
        return;
      case 'paper:export-kdp-pdf':
        if (!(await requestCommercialExportUnlock('KDP print PDF'))) return;
        if (await confirmPreflightBeforeExport('KDP print PDF export', { rasterTarget: true })) {
          void exportPaperKdpPdfAndSave(document, setStatus);
        }
        return;
      case 'paper:export-reader-spreads-pdf':
        if (isCommercialPrintProductionTarget(document.printProduction)
          && !(await requestCommercialExportUnlock('PDF/X and CMYK print production'))) return;
        if (await confirmPreflightBeforeExport('reader-spreads PDF export')) {
          const outputDocument = await materializePaperOutputDocument(document);
          if (!outputDocument) return;
          void exportPaperPdfDocument(
            outputDocument,
            (message) => showPaperExportProgress(message, 'file'),
            buildPaperReaderSpreadPdfExportRequest(outputDocument),
          ).then(finishPaperExportNotice);
        }
        return;
      case 'paper:export-booklet-proof-pdf':
        if (isCommercialPrintProductionTarget(document.printProduction)
          && !(await requestCommercialExportUnlock('PDF/X and CMYK print production'))) return;
        if (await confirmPreflightBeforeExport('booklet proof PDF export')) {
          const outputDocument = await materializePaperOutputDocument(document);
          if (!outputDocument) return;
          void exportPaperPdfDocument(
            outputDocument,
            (message) => showPaperExportProgress(message, 'file'),
            buildPaperBookletProofPdfExportRequest(outputDocument),
          ).then(finishPaperExportNotice);
        }
        return;
      case 'paper:export-webcomic-images':
        setWebcomicExportOpen(true);
        setStatus('Configuring webcomic page image export.');
        return;
      case 'paper:export-html':
        if (!await confirmPreflightBeforeExport('print HTML export')) return;
        {
          const outputDocument = await materializePaperOutputDocument(document);
          if (!outputDocument) return;
          downloadText(`${safeFileName(outputDocument.title)}-print.html`, exportPaperDocumentToPrintHtml(outputDocument), 'text/html');
        }
        setStatus('Downloaded print HTML.');
        return;
      case 'paper:export-reader-spreads-html': {
        if (!await confirmPreflightBeforeExport('reader-spreads HTML export')) return;
        const outputDocument = await materializePaperOutputDocument(document);
        if (!outputDocument) return;
        const request = buildPaperReaderSpreadHtmlExportRequest(outputDocument);
        downloadText(request.fileName, request.html, 'text/html');
        setStatus('Downloaded reader-spreads HTML. Page-based PDF and print export remain unchanged.');
        return;
      }
      case 'paper:export-booklet-proof-html': {
        if (!await confirmPreflightBeforeExport('booklet proof HTML export')) return;
        const outputDocument = await materializePaperOutputDocument(document);
        if (!outputDocument) return;
        const request = buildPaperBookletProofHtmlExportRequest(outputDocument);
        downloadText(request.fileName, request.html, 'text/html');
        setStatus('Downloaded imposed booklet proof HTML. Page-based PDF remains unchanged by default.');
        return;
      }
      case 'paper:package-print': {
        if (isCommercialPrintProductionTarget(document.printProduction)
          && !(await requestCommercialExportUnlock('CMYK/spot print-production packaging'))) return;
        if (!await confirmPreflightBeforeExport('package for print')) return;
        try {
          // Pin every linked source revision for the whole build, then prove the pinned set is
          // still current immediately before the durable download.
          const packageGuard = createPaperLinkedSourceIdentityGuard(
            document,
            () => useSourceBinStore.getState().getAllItems(),
          );
          const pack = await buildPaperPackageExport(document, [...packageGuard.sourceItems]);
          packageGuard();
          downloadBlob(pack.fileName, pack.blob);
          setStatus(`Downloaded Paper print package with ${pack.manifest.packagedAssets.length} embedded asset files, ${pack.manifest.linkedAssets.length} linked asset records${pack.entries.length ? `, and ${pack.entries.length} ZIP entries` : ''}.`);
        } catch (error) {
          setStatus(`Print packaging failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
        return;
      }
      case 'paper:export-idml':
        if (!(await requestCommercialExportUnlock('Adobe IDML export'))) return;
        if (await confirmPreflightBeforeExport('IDML export')) {
          try {
            const idmlBytes = buildPaperIdmlPackage(document);
            downloadBlob(`${safeFileName(document.title)}.idml`, new Blob([new Uint8Array(idmlBytes)], { type: 'application/vnd.adobe.indesign-idml-package' }));
            setStatus('Exported real Adobe IDML (.idml) — open in InDesign or Affinity Publisher. Images export as placeholder frames (relink on open).');
          } catch (error) {
            setStatus(`IDML export failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          }
        }
        return;
      case 'paper:soft-proof':
        setSoftProofOpen(true);
        return;
      case 'paper:export-stories-txt':
      case 'paper:export-stories-html':
      case 'paper:export-stories-rtf':
      case 'paper:export-stories-docx': {
        const format = command.replace('paper:export-stories-', '') as 'txt' | 'html' | 'rtf' | 'docx';
        const storyExport = exportPaperStoryText(document, format);
        downloadBlob(storyExport.fileName, storyExport.blob);
        setStatus(`Downloaded Paper story text as ${format.toUpperCase()}.`);
        return;
      }
      case 'paper:export-cbz': {
        if (!await confirmPreflightBeforeExport('raster CBZ export', { rasterTarget: true })) return;
        let rasterizationGuard: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>;
        try {
          rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'CBZ export is unavailable.';
          setStatus(`CBZ export failed: ${message}`);
          void showAlertDialog({ title: 'CBZ Export Failed', message, tone: 'danger' });
          return;
        }
        const outputDocument = await materializePaperOutputDocument(document, rasterizationGuard);
        if (!outputDocument) return;
        const exact = await buildPaperDocumentExactManagedFontOutput(outputDocument);
        rasterizationGuard();
        setStatus(`Rasterizing ${outputDocument.pages.length} Paper page${outputDocument.pages.length === 1 ? '' : 's'} for CBZ export...`);
        void buildPaperCbzRasterExport(exact.document, {
          fontFaceCss: exact.fontFaceCss,
          onPageRasterized: ({ pageNumber, pageIndex, pageCount }) => {
            setStatus(`Rasterized page ${pageNumber} (${pageIndex + 1}/${pageCount}) for CBZ export...`);
          },
        })
          .then((cbz) => {
            rasterizationGuard();
            downloadBlob(cbz.fileName, cbz.blob);
            setStatus(`Downloaded raster CBZ with ${outputDocument.pages.length} PNG page${outputDocument.pages.length === 1 ? '' : 's'} plus metadata.`);
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : 'Paper CBZ export failed while rasterizing pages.';
            setStatus(`CBZ export failed: ${message}`);
            void showAlertDialog({
              title: 'CBZ Export Failed',
              message,
              tone: 'danger',
            });
          });
        return;
      }
      case 'paper:export-json':
        downloadText(`${safeFileName(document.title)}.sloom-paper.json`, exportDocumentJson(), 'application/json');
        setStatus('Downloaded Paper JSON.');
        return;
      case 'paper:import-json':
        fileInputRef.current?.click();
        return;
      case 'paper:add-text-frame':
        addFrame('text');
        setStatus('Added a text frame.');
        return;
      case 'paper:add-image-frame':
        addFrame('image');
        setStatus('Added an image frame.');
        return;
      case 'paper:add-speech-bubble':
        addFrame('speechBubble');
        setStatus('Added a speech bubble.');
        return;
      case 'paper:add-thought-bubble':
        addFrame('thoughtBubble');
        setStatus('Added a thought bubble.');
        return;
      case 'paper:add-caption':
        addFrame('caption');
        setStatus('Added a caption.');
        return;
      case 'paper:toggle-rulers':
        toggleViewOption('showRulers');
        return;
      case 'paper:toggle-guides':
        toggleViewOption('showGuides');
        return;
      case 'paper:toggle-grid':
        toggleViewOption('showGrid');
        return;
      case 'paper:toggle-snap-to-guides':
        setStatus(`Paper snap to guides ${document.view.snapToGuides ? 'disabled' : 'enabled'}.`);
        toggleViewOption('snapToGuides');
        return;
      case 'paper:toggle-snap-to-grid':
        setStatus(`Paper snap to grid ${document.view.snapToGrid ? 'disabled' : 'enabled'}.`);
        toggleViewOption('snapToGrid');
        return;
      case 'paper:toggle-spreads':
        toggleViewOption('showSpreads');
        setStatus('Toggled facing-page spreads.');
        return;
      case 'paper:toggle-start-on-right':
        toggleViewOption('startOnRight');
        setStatus('Toggled start-on-right spread pairing.');
        return;
      case 'paper:toggle-binding-direction': {
        // Flip the EFFECTIVE binding (which may be auto-derived from vertical text) and pin it explicitly.
        const nextRtl = !effectiveRtlBinding(document);
        setViewOption('rtlBinding', nextRtl);
        const bindingLocale = useSettingsStore.getState().locale;
        setStatus(translate(nextRtl ? 'paper.jp.binding.setRtl' : 'paper.jp.binding.setLtr', bindingLocale));
        return;
      }
      case 'paper:toggle-tools-panel':
        togglePaperToolsPalette();
        return;
      case 'paper:toggle-document-strip-panel':
        setStatus('Document / Export is pinned to the top of the Paper workspace.');
        return;
      case 'paper:toggle-inspector-panel':
        togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.inspector);
        setStatus('Toggled the Inspector panel.');
        return;
      case 'paper:toggle-preflight-panel':
        togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.preflight, { treatCollapsedAsShown: false });
        setStatus('Toggled the Preflight panel.');
        return;
      case 'paper:toggle-linked-assets-panel':
        togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.linkedAssets);
        setStatus('Toggled the Linked Assets panel.');
        return;
      case 'paper:toggle-dtp-parity-panel':
        togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.dtpParity);
        setStatus('Toggled the print production panel.');
        return;
      case 'paper:reset-panels':
        resetWorkspacePanels(PAPER_DOCKABLE_WORKSPACE_ID);
        setStatus('Reset Paper panels to the default layout.');
        return;
      default:
        return;
    }
  }, [
    addFrame,
    addPage,
    copySelection,
    createNewDocument,
    cutSelection,
    deleteSelection,
    confirmPreflightBeforeExport,
    deselectFrames,
    document,
    exportDocumentJson,
    finishPaperExportNotice,
    invertFrameSelectionOnSelectedPage,
    selectAllFramesOnSelectedPage,
    pasteSelection,
    providerSettings.paperPdfRasterPreset,
    redo,
    sourceItems,
    materializePaperOutputDocument,
    resetWorkspacePanels,
    setTool,
    showPaperExportProgress,
    togglePaperToolsPalette,
    togglePanelVisibility,
    toggleViewOption,
    undo,
  ]);

  useNativeMenuCommand(runMenuCommand, {
    prefixes: PAPER_NATIVE_MENU_COMMAND_PREFIXES,
  });

  const addFrameForTool = useCallback((nextTool: PaperTool) => {
    setTool(nextTool);
    setStatus(`${toolLabel(nextTool)} tool active. Drag on the page to create a frame.`);
    recordActivityTrailWorkspaceEvent('paper', 'Select Paper frame tool', toolLabel(nextTool), 'toolbar');
  }, [setTool]);

  const setPaperToolFromToolbar = useCallback((nextTool: PaperTool) => {
    if (nextTool === 'tiltmark') {
      void (async () => {
        if (!await requestTiltmarkBrushUnlock()) return;
        try {
          await initializeTiltmarkRuntime({
            licensed: useSettingsStore.getState().license.licensed,
          });
          setImageBrushSettings({ brushEngine: 'tiltmark' });
          setTool('tiltmark');
          setStatus('Tiltmark physical-media paint tool active.');
          recordActivityTrailWorkspaceEvent('paper', 'Select Paper tool', 'Tiltmark paint', 'toolbar');
        } catch (error) {
          setStatus(error instanceof Error ? error.message : String(error));
        }
      })();
      return;
    }
    setTool(nextTool);
    setStatus(`${toolLabel(nextTool)} tool active.`);
    recordActivityTrailWorkspaceEvent('paper', 'Select Paper tool', toolLabel(nextTool), 'toolbar');
  }, [setImageBrushSettings, setTool]);

  useEffect(() => {
    if (tool !== 'tiltmark') return;
    if (!tiltmarkLicensed) {
      setTool('select');
      return;
    }
    setImageBrushSettings({ brushEngine: 'tiltmark' });
    void initializeTiltmarkRuntime({ licensed: true }).catch((error) => {
      setStatus(error instanceof Error ? error.message : String(error));
      setTool('select');
    });
  }, [setImageBrushSettings, setTool, tiltmarkLicensed, tool]);

  useEffect(() => {
    for (const panelId of PAPER_TILTMARK_PHYSICAL_PANEL_IDS) {
      setPanelMode(
        PAPER_DOCKABLE_WORKSPACE_ID,
        panelId,
        tool === 'tiltmark' ? 'floating' : 'hidden',
      );
    }
  }, [setPanelMode, tool]);

  const snapPointForPage = useCallback((pageId: string, point: PaperPoint): PaperPoint => {
    if (!document.view.snapToGrid && !document.view.snapToGuides) return point;
    const page = document.pages.find((candidate) => candidate.id === pageId);
    if (!page) return point;
    return snapPaperPointToGridAndGuides(point, {
      grid: document.layout.grid,
      guides: [
        ...resolvePaperPageInheritedGuides(document, page),
        ...page.guides,
      ],
      snapToGrid: document.view.snapToGrid,
      snapToGuides: document.view.snapToGuides,
    });
  }, [document]);

  const beginCreateFrame = useCallback((pageId: string, point: PaperPoint, frameKind: PaperFrameKind, shapeKind?: PaperFrame['shapeKind']) => {
    const start = snapPointForPage(pageId, point);
    selectPage(pageId);
    setActiveInteraction({
      kind: 'create',
      pageId,
      frameKind,
      shapeKind,
      start,
      current: start,
    });
  }, [selectPage, setActiveInteraction, snapPointForPage]);

  const beginGutterKnife = useCallback((pageId: string, point: PaperPoint) => {
    selectPage(pageId);
    selectFrame(null);
    setActiveInteraction({
      kind: 'gutterKnife',
      pageId,
      start: point,
      current: point,
    });
  }, [selectFrame, selectPage, setActiveInteraction]);

  const beginWorkspacePan = useCallback((event: React.PointerEvent<HTMLElement>, options?: { force?: boolean }) => {
    if (!options?.force && (tool !== 'hand' || event.button !== 0)) return false;
    event.preventDefault();
    event.stopPropagation();
    workspacePanRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail if the browser has already canceled the touch stream.
    }
    event.currentTarget.style.cursor = 'grabbing';
    return true;
  }, [tool]);

  const updateWorkspacePan = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pan = workspacePanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    return true;
  }, []);

  const finishWorkspacePan = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pan = workspacePanRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return false;
    workspacePanRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer can already be released by the browser after cancellation.
    }
    event.currentTarget.style.cursor = tool === 'hand' ? 'grab' : '';
    return true;
  }, [tool]);

  const beginPaperTouchNavigation = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!shouldRoutePaperPointerToTouchNavigation({
      available: paperTouchNavigationAvailable,
      pointerType: event.pointerType,
      settings: paperTouchNavigation,
    })) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);

    const scrollContainer = event.currentTarget;
    const pointers = touchNavigationPointersRef.current;
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    try {
      scrollContainer.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail when Android cancels a gesture during orientation or app focus changes.
    }

    const activePoints = Array.from(pointers.values()).slice(0, 2);
    if (activePoints.length >= 2 && paperTouchNavigation.pinchZoom) {
      const center = paperTouchNavigationCenter(activePoints);
      const rect = scrollContainer.getBoundingClientRect();
      const viewportX = center.clientX - rect.left;
      const viewportY = center.clientY - rect.top;
      touchNavigationPinchRef.current = {
        startDistance: paperTouchNavigationDistance(activePoints[0], activePoints[1]),
        startZoom: zoom,
        anchorX: scrollContainer.scrollLeft + viewportX,
        anchorY: scrollContainer.scrollTop + viewportY,
        viewportX,
        viewportY,
        lastStatusZoom: zoom,
      };
      workspacePanRef.current = null;
      scrollContainer.style.cursor = 'grabbing';
      return true;
    }

    touchNavigationPinchRef.current = null;
    if (paperTouchNavigation.oneFingerPan) {
      beginWorkspacePan(event, { force: true });
    }
    return true;
  }, [beginWorkspacePan, paperTouchNavigation, paperTouchNavigationAvailable, zoom]);

  const updatePaperTouchNavigation = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pointers = touchNavigationPointersRef.current;
    if (!pointers.has(event.pointerId)) return false;

    event.preventDefault();
    event.stopPropagation();
    pointers.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });

    const activePoints = Array.from(pointers.values()).slice(0, 2);
    const pinch = touchNavigationPinchRef.current;
    if (activePoints.length >= 2 && pinch && paperTouchNavigation.pinchZoom) {
      const scrollContainer = event.currentTarget;
      const nextZoom = resolvePaperTouchPinchZoom({
        startDistance: pinch.startDistance,
        currentDistance: paperTouchNavigationDistance(activePoints[0], activePoints[1]),
        startZoom: pinch.startZoom,
        minZoom: 0.1,
        maxZoom: 4,
      });
      const zoomRatio = nextZoom / Math.max(0.001, pinch.startZoom);

      setZoom(nextZoom);
      if (Math.abs(nextZoom - pinch.lastStatusZoom) >= 0.05) {
        pinch.lastStatusZoom = nextZoom;
        setStatus(`Paper touch zoom ${Math.round(nextZoom * 100)}%.`);
      }
      window.requestAnimationFrame(() => {
        scrollContainer.scrollLeft = pinch.anchorX * zoomRatio - pinch.viewportX;
        scrollContainer.scrollTop = pinch.anchorY * zoomRatio - pinch.viewportY;
      });
      return true;
    }

    if (paperTouchNavigation.oneFingerPan) {
      return updateWorkspacePan(event);
    }

    return true;
  }, [paperTouchNavigation.oneFingerPan, paperTouchNavigation.pinchZoom, setZoom, updateWorkspacePan]);

  const finishPaperTouchNavigation = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const pointers = touchNavigationPointersRef.current;
    if (!pointers.has(event.pointerId)) return false;

    event.preventDefault();
    event.stopPropagation();
    pointers.delete(event.pointerId);
    touchNavigationPinchRef.current = null;
    workspacePanRef.current = null;

    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    const remaining = Array.from(pointers.entries())[0];
    if (remaining && paperTouchNavigation.oneFingerPan) {
      const [pointerId, point] = remaining;
      workspacePanRef.current = {
        pointerId,
        startX: point.clientX,
        startY: point.clientY,
        scrollLeft: event.currentTarget.scrollLeft,
        scrollTop: event.currentTarget.scrollTop,
      };
      event.currentTarget.style.cursor = 'grabbing';
    } else if (pointers.size === 0) {
      event.currentTarget.style.cursor = tool === 'hand' ? 'grab' : '';
    }

    return true;
  }, [paperTouchNavigation.oneFingerPan, tool]);

  const handleWorkspaceWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    const nextZoom = resolvePaperWheelZoom({
      currentZoom: zoom,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    if (nextZoom === null || nextZoom === zoom) return;

    event.preventDefault();
    event.stopPropagation();
    const scrollContainer = event.currentTarget;
    const rect = scrollContainer.getBoundingClientRect();
    const viewportX = event.clientX - rect.left;
    const viewportY = event.clientY - rect.top;
    const anchorX = scrollContainer.scrollLeft + viewportX;
    const anchorY = scrollContainer.scrollTop + viewportY;
    const zoomRatio = nextZoom / Math.max(0.001, zoom);

    setZoom(nextZoom);
    setStatus(`Paper zoom ${Math.round(nextZoom * 100)}%.`);
    window.requestAnimationFrame(() => {
      scrollContainer.scrollLeft = anchorX * zoomRatio - viewportX;
      scrollContainer.scrollTop = anchorY * zoomRatio - viewportY;
    });
  }, [setZoom, zoom]);

  const selectFrameFromPointer = useCallback((
    frameId: string | null,
    event?: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => {
    selectFrameWithMode(frameId, resolvePaperFrameSelectionMode(event));
  }, [selectFrameWithMode]);

  const beginMoveFrame = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    if (selectedPageId !== pageId) {
      selectPage(pageId);
    }
    const page = document.pages.find((candidate) => candidate.id === pageId);
    const selectedGroupIds = selectedPageId === pageId && selectedFrameIds.includes(frame.id) && selectedFrameIds.length > 1
      ? selectedFrameIds
      : [frame.id];
    const frameStarts = page?.frames.filter((candidate) => selectedGroupIds.includes(candidate.id) && !candidate.locked) ?? [frame];
    selectFrameWithMode(frame.id, selectedGroupIds.length > 1 ? 'add' : 'replace');
    setTool('select');
    setActiveInteraction({
      kind: 'move',
      pageId,
      frameIds: frameStarts.map((candidate) => candidate.id),
      start: point,
      frameStarts,
    });
  }, [document.pages, selectFrameWithMode, selectPage, selectedFrameIds, selectedPageId, setActiveInteraction, setTool]);

  const beginImageCropPan = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    if (selectedPageId !== pageId) {
      selectPage(pageId);
    }
    selectFrameWithMode(frame.id, 'replace');
    setTool('select');
    setActiveInteraction({
      kind: 'image-crop-pan',
      pageId,
      frameId: frame.id,
      start: point,
      frameStart: frame,
    });
  }, [selectFrameWithMode, selectPage, selectedPageId, setActiveInteraction, setTool]);

  const beginImageCropScale = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'image-crop-scale',
      pageId,
      frameId: frame.id,
      frameStart: frame,
    });
    updateFrame(pageId, frame.id, scalePaperFrameImageTowardPointer(frame, point));
  }, [selectFrame, selectPage, setActiveInteraction, setTool, updateFrame]);

  const beginImageCropRotate = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'image-crop-rotate',
      pageId,
      frameId: frame.id,
      frameStart: frame,
    });
    updateFrame(pageId, frame.id, rotatePaperFrameImageTowardPointer(frame, point));
  }, [selectFrame, selectPage, setActiveInteraction, setTool, updateFrame]);

  const beginFrameVertexMove = useCallback((pageId: string, frame: PaperFrame, vertexIndex: number) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'frame-vertex',
      pageId,
      frameId: frame.id,
      vertexIndex,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginFrameVertexInsert = useCallback((pageId: string, frame: PaperFrame, edgeIndex: number, point: PaperPoint, snapToBorder = false) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    const insertedVertexIndex = edgeIndex + 1;
    updateFrame(pageId, frame.id, insertPaperFrameVertexPatch(frame, edgeIndex, point, { snapToBorder }));
    setActiveInteraction({
      kind: 'frame-vertex',
      pageId,
      frameId: frame.id,
      vertexIndex: insertedVertexIndex,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool, updateFrame]);

  const deleteFrameVertex = useCallback((pageId: string, frame: PaperFrame, vertexIndex: number) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    updateFrame(pageId, frame.id, deletePaperFrameVertexPatch(frame, vertexIndex));
  }, [selectFrame, selectPage, updateFrame]);

  const toggleFrameImageFlip = useCallback((pageId: string, frame: PaperFrame, axis: 'x' | 'y') => {
    if (frame.locked) return;
    updateFrame(pageId, frame.id, axis === 'x'
      ? { imageFlipX: !frame.imageFlipX }
      : { imageFlipY: !frame.imageFlipY });
  }, [updateFrame]);

  const beginResizeFrame = useCallback((
    pageId: string,
    frame: PaperFrame,
    handle: PaperResizeHandle,
    point: PaperPoint,
  ) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'resize',
      pageId,
      frameId: frame.id,
      handle,
      start: point,
      frameStart: frame,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginRotateFrame = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'rotate',
      pageId,
      frameId: frame.id,
      frameStart: frame,
    });
    updateFrame(pageId, frame.id, { rotationDeg: rotatePaperFrameTowardPointer(frame, point) });
  }, [selectFrame, selectPage, setActiveInteraction, setTool, updateFrame]);

  const beginBubbleHandle = useCallback((pageId: string, frame: PaperFrame, handle: PaperBubbleHandle) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'bubble-handle',
      pageId,
      frameId: frame.id,
      handle,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginBubbleConnectorHandle = useCallback((
    pageId: string,
    segment: PaperBubbleConnectorSegment,
    handle: PaperBubbleConnectorHandle,
  ) => {
    const page = document.pages.find((candidate) => candidate.id === pageId);
    const toFrame = page?.frames.find((candidate) => candidate.id === segment.toFrameId);
    if (!toFrame || toFrame.locked || toFrame.inherited || paperFrameLayerIsLocked(document, toFrame)) return;
    selectPage(pageId);
    selectFrame(toFrame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'bubble-connector-handle',
      pageId,
      fromFrameId: segment.fromFrameId,
      toFrameId: segment.toFrameId,
      handle,
    });
  }, [document, selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginBubbleTextMove = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'bubble-text-move',
      pageId,
      frameId: frame.id,
      start: point,
      frameStart: frame,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginBubbleTextResize = useCallback((
    pageId: string,
    frame: PaperFrame,
    handle: PaperResizeHandle,
    point: PaperPoint,
  ) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'bubble-text-resize',
      pageId,
      frameId: frame.id,
      handle,
      start: point,
      frameStart: frame,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const beginBubbleTextRotate = useCallback((pageId: string, frame: PaperFrame, point: PaperPoint) => {
    if (frame.locked) return;
    selectPage(pageId);
    selectFrame(frame.id);
    setTool('select');
    setActiveInteraction({
      kind: 'bubble-text-rotate',
      pageId,
      frameId: frame.id,
      frameStart: frame,
    });
    updateFrame(pageId, frame.id, rotatePaperTextBoxTowardPointer(frame, point));
  }, [selectFrame, selectPage, setActiveInteraction, setTool, updateFrame]);

  const commitFrameText = useCallback((pageId: string, frameId: string, text: string, richText?: PaperRichParagraph[]) => {
    // A rich-text commit patches richText (createPaperFrame re-syncs the flattened `text`); a plain-text
    // commit patches `text` (which clears any stale rich runs — see patchPaperFrame).
    updateFrame(pageId, frameId, richText ? { richText } : { text });
    setStatus('Updated frame text.');
  }, [updateFrame]);

  const beginGuideMove = useCallback((
    pageId: string,
    guideId: string,
    orientation: PaperGuideOrientation,
  ) => {
    selectPage(pageId);
    selectFrame(null);
    setTool('select');
    setActiveInteraction({
      kind: 'guide',
      pageId,
      guideId,
      orientation,
    });
  }, [selectFrame, selectPage, setActiveInteraction, setTool]);

  const updateInteraction = useCallback((point: PaperPoint, modifiers: PaperInteractionModifiers = {}) => {
    const activeInteraction = interactionRef.current ?? interaction;
    if (!activeInteraction) return;
    if (activeInteraction.kind === 'create') {
      setActiveInteraction({ ...activeInteraction, current: snapPointForPage(activeInteraction.pageId, point) });
      return;
    }
    if (activeInteraction.kind === 'gutterKnife') {
      setActiveInteraction({ ...activeInteraction, current: point });
      return;
    }

    if (activeInteraction.kind === 'move') {
      let delta = {
        deltaXMm: point.xMm - activeInteraction.start.xMm,
        deltaYMm: point.yMm - activeInteraction.start.yMm,
      };
      const anchorFrame = activeInteraction.frameStarts[0];
      if (anchorFrame) {
        const movedAnchor = movePaperFrameByDelta(anchorFrame, delta);
        const snappedAnchor = snapPointForPage(activeInteraction.pageId, {
          xMm: movedAnchor.xMm,
          yMm: movedAnchor.yMm,
        });
        delta = {
          deltaXMm: snappedAnchor.xMm - anchorFrame.xMm,
          deltaYMm: snappedAnchor.yMm - anchorFrame.yMm,
        };
        if (document.view.snapToGuides) {
          const page = document.pages.find((candidate) => candidate.id === activeInteraction.pageId);
          if (page) {
            const staticallySnappedX = Math.abs(snappedAnchor.xMm - movedAnchor.xMm) > 0.0001;
            const staticallySnappedY = Math.abs(snappedAnchor.yMm - movedAnchor.yMm) > 0.0001;
            const alignedAnchor = movePaperFrameByDelta(anchorFrame, delta);
            const movingIds = new Set(activeInteraction.frameIds);
            const smart = resolvePaperSmartGuideSnap({
              moving: { id: anchorFrame.id, ...alignedAnchor },
              // Match the editor paint projection: hidden-layer frames cannot attract a snap,
              // while visible inherited parent items remain useful alignment targets.
              candidates: resolvePaperSmartGuideCandidates(document, page, movingIds),
              pageWidthMm: document.page.widthMm,
              pageHeightMm: document.page.heightMm,
              marginsMm: document.layout.marginsMm,
              toleranceMm: 6 / Math.max(0.01, PX_PER_MM * zoom),
            });
            delta = {
              deltaXMm: delta.deltaXMm + (staticallySnappedX ? 0 : smart.deltaXMm),
              deltaYMm: delta.deltaYMm + (staticallySnappedY ? 0 : smart.deltaYMm),
            };
            setSmartGuides(smart.guides
              .filter((guide) => guide.orientation === 'vertical' ? !staticallySnappedX : !staticallySnappedY)
              .map((guide) => ({ ...guide, pageId: activeInteraction.pageId })));
          }
        } else {
          setSmartGuides([]);
        }
      }
      activeInteraction.frameStarts.forEach((frameStart) => {
        updateFrame(activeInteraction.pageId, frameStart.id, movePaperFrameByDelta(frameStart, delta));
      });
    } else if (activeInteraction.kind === 'image-crop-pan') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, panPaperFrameImageCropByDelta(activeInteraction.frameStart, {
        deltaXMm: point.xMm - activeInteraction.start.xMm,
        deltaYMm: point.yMm - activeInteraction.start.yMm,
      }));
    } else if (activeInteraction.kind === 'image-crop-scale') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, scalePaperFrameImageTowardPointer(activeInteraction.frameStart, point));
    } else if (activeInteraction.kind === 'image-crop-rotate') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, rotatePaperFrameImageTowardPointer(activeInteraction.frameStart, point));
    } else if (activeInteraction.kind === 'frame-vertex') {
      const page = document.pages.find((candidate) => candidate.id === activeInteraction.pageId);
      const frame = page?.frames.find((candidate) => candidate.id === activeInteraction.frameId);
      if (!frame) return;
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, movePaperFrameVertexPatch(frame, activeInteraction.vertexIndex, point, {
        snapToBorder: Boolean(modifiers.shiftKey),
      }));
    } else if (activeInteraction.kind === 'resize') {
      const resizePoint = snapPointForPage(activeInteraction.pageId, point);
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, resizePaperFrameFromHandle(activeInteraction.frameStart, activeInteraction.handle, {
        deltaXMm: resizePoint.xMm - activeInteraction.start.xMm,
        deltaYMm: resizePoint.yMm - activeInteraction.start.yMm,
      }, undefined, undefined, {
        lockAspectRatio: Boolean(modifiers.shiftKey),
      }));
    } else if (activeInteraction.kind === 'rotate') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, {
        rotationDeg: rotatePaperFrameTowardPointer(activeInteraction.frameStart, point),
      });
    } else if (activeInteraction.kind === 'bubble-handle') {
      const page = document.pages.find((candidate) => candidate.id === activeInteraction.pageId);
      const frame = page?.frames.find((candidate) => candidate.id === activeInteraction.frameId);
      if (!frame) return;
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, bubbleHandlePatch(frame, activeInteraction.handle, point));
    } else if (activeInteraction.kind === 'bubble-connector-handle') {
      const page = document.pages.find((candidate) => candidate.id === activeInteraction.pageId);
      if (!page) return;
      const canvasFrames = resolvePaperPageFramesForCanvas(document, page);
      const segment = buildPaperBubbleConnectorSegments(canvasFrames).find((candidate) => (
        candidate.fromFrameId === activeInteraction.fromFrameId
        && candidate.toFrameId === activeInteraction.toFrameId
      ));
      const fromFrame = canvasFrames.find((candidate) => candidate.id === activeInteraction.fromFrameId);
      const toFrame = page.frames.find((candidate) => candidate.id === activeInteraction.toFrameId);
      if (!segment || !fromFrame || !toFrame || toFrame.locked || paperFrameLayerIsLocked(document, toFrame)) return;
      updateFrame(
        activeInteraction.pageId,
        toFrame.id,
        paperBubbleConnectorHandlePatch(segment, fromFrame, toFrame, activeInteraction.handle, point),
      );
    } else if (activeInteraction.kind === 'bubble-text-move') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, movePaperTextBoxPatch(
        activeInteraction.frameStart,
        activeInteraction.start,
        point,
      ));
    } else if (activeInteraction.kind === 'bubble-text-resize') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, resizePaperTextBoxPatch(
        activeInteraction.frameStart,
        activeInteraction.handle,
        activeInteraction.start,
        point,
      ));
    } else if (activeInteraction.kind === 'bubble-text-rotate') {
      updateFrame(activeInteraction.pageId, activeInteraction.frameId, rotatePaperTextBoxTowardPointer(activeInteraction.frameStart, point));
    } else if (activeInteraction.kind === 'guide') {
      const page = document.pages.find((candidate) => candidate.id === activeInteraction.pageId);
      if (!page) return;
      const guide = page.guides.find((candidate) => candidate.id === activeInteraction.guideId);
      if (!guide) return;
      updateGuide(activeInteraction.pageId, activeInteraction.guideId, {
        positionMm: snapPaperGuidePositionToRulerMarker(
          activeInteraction.orientation === 'vertical' ? point.xMm : point.yMm,
          activeInteraction.orientation === 'vertical' ? document.page.widthMm : document.page.heightMm,
          document.layout.grid,
          Boolean(modifiers.shiftKey),
        ),
      });
    }
  }, [document, interaction, setActiveInteraction, snapPointForPage, updateFrame, updateGuide, zoom]);

  const finishInteraction = useCallback(() => {
    const activeInteraction = interactionRef.current ?? interaction;
    if (activeInteraction?.kind === 'create') {
      const geometry = buildPaperFrameCreateGeometry(activeInteraction.start, activeInteraction.current);
      const shapePatch = activeInteraction.frameKind === 'shape'
        ? {
            shapeKind: activeInteraction.shapeKind,
            vertices: verticesForShapeKind(activeInteraction.shapeKind),
            label: shapeLabel(activeInteraction.shapeKind) ?? undefined,
          }
        : {};
      addFrameToPage(activeInteraction.pageId, activeInteraction.frameKind, {
        ...geometry,
        ...shapePatch,
      });
      setStatus(`Created ${frameKindLabel(activeInteraction.frameKind)}.`);
    } else if (activeInteraction?.kind === 'gutterKnife') {
      splitPanelFrames(activeInteraction.pageId, activeInteraction.start, activeInteraction.current);
      setStatus('Clipped panel frames with gutter knife.');
    } else if (activeInteraction) {
      setStatus('Updated frame geometry.');
    }
    setSmartGuides([]);
    setActiveInteraction(null);
  }, [addFrameToPage, splitPanelFrames, interaction, setActiveInteraction]);

  const handleImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (inferPaperDocumentImportFormat(file.name, file.type) === 'pdf') {
        const item = await addSourceAssetItem({
          label: file.name,
          kind: 'document',
          mimeType: file.type || 'application/pdf',
          dataUrl: await fileToDataUrl(file),
          sourceKey: `paper-document:${file.name}:${file.size}:${file.lastModified}`,
        });
        placeSourceAssetAt({
          item,
          pageId: selectedPage?.id ?? document.pages[0]?.id,
          point: selectedPage ? { xMm: document.layout.marginsMm.left, yMm: document.layout.marginsMm.top } : undefined,
        });
        setSourceSidebarOpen(true);
        setStatus(`Placed PDF/document "${file.name}" as a linked frame with Source Library metadata.`);
        return;
      }
      const imported = await parsePaperDocumentImportFile(file);
      const isTextImport = 'blocks' in imported;
      const nextDocument = isTextImport ? await importTextDocumentIntoPaper(imported) : imported;
      const replacementAuthorization = await requestPaperDocumentReplacement(activeDocumentId, file.name);
      if (!replacementAuthorization) {
        setStatus(`Canceled importing "${file.name}".`);
        return;
      }
      if (!replaceAuthorizedPaperDocument(replacementAuthorization, nextDocument)) {
        setStatus(`Canceled importing "${file.name}" because the Paper workspace changed.`);
        return;
      }
      // Report what actually came in — tables and images are real frames now, not text.
      const importedFrames = nextDocument.pages.flatMap((page) => page.frames);
      const tableCount = importedFrames.filter((frame) => frame.table).length;
      const imageCount = importedFrames.filter((frame) => frame.kind === 'image').length;
      const textCount = importedFrames.length - tableCount - imageCount;
      const breakdown = [
        `${textCount} text frame${textCount === 1 ? '' : 's'}`,
        ...(tableCount ? [`${tableCount} table${tableCount === 1 ? '' : 's'}`] : []),
        ...(imageCount ? [`${imageCount} image${imageCount === 1 ? '' : 's'}`] : []),
      ].join(', ');
      setStatus(`Imported "${file.name}" — ${breakdown} across ${nextDocument.pages.length} page${nextDocument.pages.length === 1 ? '' : 's'}.`);
      // Be honest about anything the source held that Paper's model can't reproduce exactly.
      const limitations = isTextImport ? imported.limitations : undefined;
      if (limitations && limitations.length) {
        void showAlertDialog({
          title: 'Imported with notes',
          message: `"${file.name}" imported. A few things Paper couldn't reproduce exactly:\n\n• ${limitations.join('\n• ')}`,
          tone: 'info',
        });
      }
    } catch (error) {
      void showAlertDialog({
        title: 'Paper Import Failed',
        message: error instanceof Error ? error.message : 'The Paper document could not be imported.',
        tone: 'danger',
      });
    }
  };

  const handleDropPaperPageImageImportFiles = async (
    event: React.DragEvent,
    pageId = selectedPageId,
    point?: PaperPoint,
    frameId?: string,
  ): Promise<boolean> => {
    if (!hasPaperPageImageFileDrag(event.dataTransfer)) {
      return false;
    }

    const plan = buildPaperPageImageImportPlan({
      document,
      existingItems: sourceItems,
      files: event.dataTransfer.files,
      pageId,
      point: frameId ? undefined : point,
    });

    if (!plan.items.length) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    setStatus(`Importing ${plan.items.length} image${plan.items.length === 1 ? '' : 's'} into ${plan.envelopeLabel}...`);

    try {
      for (const planItem of plan.items) {
        const item = await addSourceAssetItem({
          label: planItem.label,
          kind: planItem.kind,
          mimeType: planItem.mimeType,
          dataUrl: await fileToDataUrl(planItem.file),
          sourceKey: planItem.sourceKey,
          envelopeId: planItem.envelopeId,
          envelopeLabel: planItem.envelopeLabel,
          envelopeIndex: planItem.envelopeIndex,
          envelopeCollapsed: planItem.envelopeCollapsed,
        });
        placeSourceAssetAt({
          item,
          pageId: plan.pageId,
          targetFrameId: frameId,
          point: frameId ? undefined : planItem.placementPoint,
        });
      }
      setSourceSidebarOpen(true);
      recordActivityTrailWorkspaceEvent('paper', 'Import OS image files', plan.envelopeLabel, 'system');
      setStatus(`Imported ${plan.items.length} image${plan.items.length === 1 ? '' : 's'} into ${plan.envelopeLabel}.`);
      return true;
    } catch (error) {
      setStatus('Paper image import failed.');
      void showAlertDialog({
        title: 'Paper Image Import Failed',
        message: error instanceof Error ? error.message : 'The dropped image could not be imported into Paper.',
        tone: 'danger',
      });
      return true;
    }
  };

  const handleDropSourceItem = (
    event: React.DragEvent,
    frameId?: string,
    pageId = selectedPageId,
    point?: PaperPoint,
  ) => {
    const itemId = getDraggedSourceItemId(event.dataTransfer);
    if (!itemId) return;
    const item = sourceItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    placeSourceAssetAt({ item, pageId, targetFrameId: frameId, point });
    setStatus(frameId
      ? `Placed "${item.label}" into the selected frame.`
      : `Placed "${item.label}" on the page.`);
  };

  const openPaperFrameImageInImageWorkspace = useCallback((
    pageId: string,
    frameId: string | undefined,
    frame: PaperFrame | undefined,
  ) => {
    const sourceItemId = frame?.asset?.sourceBinItemId;
    const sourceItem = sourceItems.find((item) => item.id === sourceItemId);
    if (!sourceItem || sourceItem.kind !== 'image') return;
    // Linked edit: the Image document remembers this frame, so closing its tab (or
    // "Save & Return") flattens the edit and places it straight back here.
    const linkedEdit = frameId
      ? { kind: 'paper-frame' as const, pageId, frameId, sourceLabel: sourceItem.label }
      : undefined;
    setStatus(`Opening "${sourceItem.label}" in the Image workspace...`);
    const bridge = getSignalLoomNativeBridge();
    if (bridge?.openWorkspaceWindow) {
      // Multi-window: the Image WINDOW owns its own store — the document must be
      // built there. Open/focus the window first, then post the command (same
      // ordering as sendPaperFrameSourceToFlow). An ImageDocument itself can't
      // ride the channel (OffscreenCanvas bitmaps aren't cloneable).
      void bridge.openWorkspaceWindow('image').then(() => {
        window.setTimeout(() => postWorkspaceWindowCommand({
          type: 'image-open-linked-document',
          item: sourceItem,
          linkedEdit,
          targetWorkspace: 'image',
        }), 250);
      });
      setStatus(`Opened "${sourceItem.label}" in the Image workspace.`);
      return;
    }
    void (async () => {
      try {
        await openLinkedImageDocumentFromItem(sourceItem, linkedEdit);
        setStatus(`Opened "${sourceItem.label}" as an editable image document.`);
      } finally {
        setWorkspaceView('image');
      }
    })();
  }, [setWorkspaceView, sourceItems]);

  const openPaperFrameImageInHane = useCallback(async (
    pageId: string,
    frameId: string,
    frame: PaperFrame | undefined,
  ) => {
    if (!frame || frame.kind !== 'image') {
      setStatus('Select an image frame before opening it in Hane Mobile.');
      return;
    }
    const activeTarget = useHaneLinkedEditStore.getState().target;
    if (activeTarget?.pageId === pageId && activeTarget.frameId === frameId) {
      try {
        await stopHaneLinkedEdit();
        setStatus(`Saved the final Hane canvas into Paper and stopped live editing for "${frame.label}".`);
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'The final Hane canvas could not be saved into Paper.';
        setStatus(message);
        void showAlertDialog({
          title: 'Could Not Finish Hane Live Edit',
          message,
          tone: 'warning',
        });
      }
      return;
    }

    const sourceItemId = frame.asset?.sourceBinItemId;
    const sourceItem = sourceItems.find((item) => item.id === sourceItemId);
    if (!sourceItem || sourceItem.kind !== 'image') {
      setHaneBlankTarget({ pageId, frameId });
      setStatus('Choose the dimensions for the blank image to open in Hane.');
      return;
    }

    setStatus(`Preparing "${sourceItem.label}" for Hane Mobile…`);
    try {
      let linkedItem = sourceItem;
      if (isHaneProviderSourceItem(sourceItem)) {
        const dataUrl = await materializeSourceBinItemDataUrl(sourceItem);
        if (!dataUrl) throw new Error('The Hane source image bytes are not available on this device.');
        linkedItem = await addSourceAssetItem({
          label: `${sourceItem.label} — Paper linked`,
          kind: 'image',
          mimeType: sourceItem.mimeType || 'image/png',
          dataUrl,
          pixelWidth: sourceItem.pixelWidth,
          pixelHeight: sourceItem.pixelHeight,
          sourceKey: `paper-hane-linked:${document.id}:${pageId}:${frameId}`,
          originWorkspaceId: document.id,
        });
        placeSourceAssetAt({ item: linkedItem, pageId, targetFrameId: frameId });
      }
      await startHaneLinkedEdit({
        paperDocumentId: activeDocumentId,
        pageId,
        frameId,
        sourceItem: linkedItem,
      });
      setStatus(
        `Live editing "${linkedItem.label}" in Hane. Paper stays open and receives flattened updates automatically.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The image could not be opened in Hane.';
      setStatus(message);
      void showAlertDialog({
        title: 'Could Not Open in Hane Mobile',
        message,
        tone: 'warning',
      });
    }
  }, [
    activeDocumentId,
    addSourceAssetItem,
    document.id,
    placeSourceAssetAt,
    sourceItems,
  ]);

  const createBlankPaperFrameImageInHane = useCallback(async (
    spec: PaperHaneBlankImageSpec,
  ) => {
    const target = haneBlankTarget;
    if (!target || haneBlankBusy) return;
    const frame = document.pages
      .find((page) => page.id === target.pageId)
      ?.frames.find((candidate) => candidate.id === target.frameId);
    if (!frame || frame.kind !== 'image') {
      setHaneBlankTarget(null);
      setStatus('The selected blank image frame is no longer available.');
      return;
    }
    setHaneBlankBusy(true);
    setStatus(`Creating ${spec.widthPx} × ${spec.heightPx} image for Hane…`);
    try {
      const dataUrl = createPaperHaneBlankImageDataUrl(spec, document.background);
      const item = await addSourceAssetItem({
        label: spec.label,
        kind: 'image',
        mimeType: 'image/png',
        dataUrl,
        pixelWidth: spec.widthPx,
        pixelHeight: spec.heightPx,
        sourceKey: `paper-hane-blank:${document.id}:${target.pageId}:${target.frameId}`,
        originWorkspaceId: document.id,
      });
      placeSourceAssetAt({
        item,
        pageId: target.pageId,
        targetFrameId: target.frameId,
      });
      await startHaneLinkedEdit({
        paperDocumentId: activeDocumentId,
        pageId: target.pageId,
        frameId: target.frameId,
        sourceItem: item,
      });
      setHaneBlankTarget(null);
      setStatus(
        `Created "${item.label}" and opened it in Hane. Paper will refresh this frame as you draw.`,
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'The blank image could not be opened in Hane.';
      setStatus(message);
      void showAlertDialog({
        title: 'Could Not Open in Hane Mobile',
        message,
        tone: 'warning',
      });
    } finally {
      setHaneBlankBusy(false);
    }
  }, [
    activeDocumentId,
    addSourceAssetItem,
    document,
    haneBlankBusy,
    haneBlankTarget,
    placeSourceAssetAt,
  ]);

  const runPaperImageQuickEdit = useCallback(async ({
    abortSignal,
    frameId,
    pageId,
    prompt,
    provider,
  }: {
    abortSignal?: AbortSignal;
    frameId: string;
    pageId: string;
    prompt: string;
    provider: GenerativeFillProvider;
  }) => {
    setStatus('Preparing Paper image quick edit...');
    const prepared = await preparePaperImageQuickEdit({
      abortSignal,
      document,
      frameId,
      pageId,
      prompt,
      provider,
      sourceItems,
    });
    setStatus(`Saving edited image from ${prepared.modelUsed} to the Source Library...`);
    const item = await addSourceAssetItem(prepared.sourceItem);
    placeSourceAssetAt({ item, pageId, targetFrameId: frameId });
    const cost = prepared.approximateCostUsd === undefined
      ? ''
      : ` Approximate provider cost: $${prepared.approximateCostUsd.toFixed(3)}.`;
    setStatus(`Applied Paper quick edit with ${prepared.modelUsed}.${cost}`);
  }, [addSourceAssetItem, document, placeSourceAssetAt, sourceItems]);

  const sendPaperFrameSourceToVideo = useCallback((frame: PaperFrame | undefined) => {
    const sourceItemId = frame?.asset?.sourceBinItemId;
    if (!sourceItemId) return;
    setSelectedSourceItemId(sourceItemId);
    setSourceBinTab('editorAssets');
    const bridge = getSignalLoomNativeBridge();
    if (bridge?.openWorkspaceWindow) {
      void bridge.openWorkspaceWindow('editor');
    } else {
    setWorkspaceView('editor');
    }
    setStatus('Selected the frame asset in the Video workspace source list.');
  }, [setSelectedSourceItemId, setSourceBinTab, setWorkspaceView]);

  const sendPaperFrameSourceToFlow = useCallback((frame: PaperFrame | undefined) => {
    const activeFlowWorkspaceId = useFlowWorkspaceStore.getState().activeWorkspaceId;
    const activeFlowSourceBinId = useEditorStore.getState().activeFlowSourceBinId;
    const command = buildPaperFrameFlowSourceCommand(frame, sourceItems, activeFlowWorkspaceId, activeFlowSourceBinId);
    if (!command) {
      setStatus('Select an image frame backed by a source-library image before sending it to Flow.');
      return;
    }

    const bridge = getSignalLoomNativeBridge();
    if (bridge?.openWorkspaceWindow) {
      void bridge.openWorkspaceWindow('flow').then(() => {
        window.setTimeout(() => postWorkspaceWindowCommand(command), 250);
      });
      setContextMenu(null);
      setStatus(`Sent "${command.item.label}" to the Flow workspace as a source image node.`);
    } else {
      const flowStore = useFlowStore.getState();
      const type = getFlowNodeTypeForSourceBinItem(command.item);
      const rightMostX = flowStore.nodes.reduce((max, node) => Math.max(max, node.position.x), -360);
      const nodeId = flowStore.addNode(type, {
        x: rightMostX + 360,
        y: 0,
      });
      flowStore.patchNodeData(nodeId, buildFlowNodePatchForSourceBinItem(command.item));
      setWorkspaceView('flow');
      setContextMenu(null);
      setStatus(`Sent "${command.item.label}" to the Flow workspace as a source image node.`);
    }
  }, [setWorkspaceView, sourceItems]);

  const sendPaperGeneratedMediaPromptToFlow = useCallback((frame: PaperFrame | undefined) => {
    const prompt = frame?.generatedMediaPrompt?.trim();
    if (!frame || !prompt) {
      setStatus('Select an Assisted Layout image placeholder with a generated-media brief.');
      return;
    }
    const label = `${frame.label || 'Paper image'} generation`;
    const targetFlowWorkspaceId = useFlowWorkspaceStore.getState().activeWorkspaceId;
    const bridge = getSignalLoomNativeBridge();
    if (bridge?.openWorkspaceWindow) {
      void bridge.openWorkspaceWindow('flow').then(() => {
        window.setTimeout(() => postWorkspaceWindowCommand({
          type: 'flow-create-generation-node',
          prompt,
          label,
          targetWorkspace: 'flow',
          targetFlowWorkspaceId,
        }), 250);
      });
    } else {
      const flowStore = useFlowStore.getState();
      const rightMostX = flowStore.nodes.reduce((max, node) => Math.max(max, node.position.x), -360);
      flowStore.addNode('imageGen', { x: rightMostX + 360, y: 0 }, {
        mediaMode: 'generate',
        prompt,
        customTitle: label,
      });
      setWorkspaceView('flow');
    }
    setStatus(`Created a Flow image-generation node for "${frame.label || 'Paper image'}". Run it when you are ready to incur provider usage.`);
  }, [setWorkspaceView]);

  const locatePaperFrameSourceInFlow = useCallback((frame: PaperFrame | undefined) => {
    const sourceBinItemId = frame?.asset?.sourceBinItemId;
    if (!sourceBinItemId) {
      setStatus('This frame does not contain a source-library asset.');
      return;
    }

    const sourceItem = sourceItems.find((item) => item.id === sourceBinItemId);
    if (!sourceItem || !sourceItem.originNodeId) {
      setStatus('This asset was imported manually or is not linked to any generator node.');
      return;
    }

    const baseNodeId = resolveSourceNodeId(sourceItem.originNodeId);
    if (!baseNodeId) {
      setStatus('The generator node for this asset is not available.');
      return;
    }

    const bridge = getSignalLoomNativeBridge();
    if (bridge?.openWorkspaceWindow) {
      void bridge.openWorkspaceWindow('flow');
    } else {
      setWorkspaceView('flow');
    }

    setTimeout(() => {
      useFlowStore.getState().centerOnNode(baseNodeId);
    }, 120);

    setContextMenu(null);
    setStatus(`Locating generator node "${baseNodeId}" on Flow canvas…`);
  }, [sourceItems, setWorkspaceView]);

  const runStabilityPaperPrintUpscale = useCallback(async (
    request: Omit<RunPaperStabilityUpscaleInput, 'apiKey' | 'repository'>,
  ) => {
    const apiKey = useSettingsStore.getState().apiKeys.stability?.trim();
    if (!apiKey) {
      throw new Error('Stability AI API key is not configured. Add it in Settings > Providers before using Stability print upscaling.');
    }
    return runPaperStabilityUpscale({
      ...request,
      apiKey,
      repository: paperAssetRepository,
    });
  }, []);

  const runAndroidPaperPrintUpscale = useCallback(async (request: PaperPrintAndroidAcceleratorUpscaleRequest) => {
    const result = await runAndroidAcceleratorUpscaleWithRetry({
      baseUrl: providerSettings.androidAcceleratorBaseUrl ?? '',
      authToken: providerSettings.androidAcceleratorAuthToken,
      sourceDataUrl: request.sourceDataUrl,
      targetWidthPx: request.targetWidthPx,
      targetHeightPx: request.targetHeightPx,
      upscalerId: providerSettings.androidAcceleratorDefaultUpscaler ?? 'upscaler_realistic',
      outputFormat: 'png',
    }, {
      maxAttempts: 3,
      delayMs: 1500,
      onRetry: ({ nextAttempt, maxAttempts, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        setStatus(`Retrying Android accelerator print upscale (${nextAttempt}/${maxAttempts}) after: ${message}`);
      },
    });

    return {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
    };
  }, [
    providerSettings.androidAcceleratorAuthToken,
    providerSettings.androidAcceleratorBaseUrl,
    providerSettings.androidAcceleratorDefaultUpscaler,
  ]);

  const runAndroidNativePaperPrintUpscale = useCallback(async (request: PaperPrintAndroidNativeUpscaleRequest) => {
    const result = await runAndroidNativeImageUpscale({
      sourceDataUrl: request.sourceDataUrl,
      targetWidthPx: request.targetWidthPx,
      targetHeightPx: request.targetHeightPx,
      outputFormat: 'png',
    });

    return {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
    };
  }, []);

  const runLocalAiPaperPrintUpscale = useCallback(async (request: PaperPrintLocalAiUpscaleRequest) => {
    const result = await runLocalCpuUpscaler({
      baseUrl: providerSettings.localAiCpuEndpointUrl ?? '',
      authHeader: providerSettings.localAiCpuAuthHeader,
      sourceDataUrl: request.sourceDataUrl,
      targetWidthPx: request.targetWidthPx,
      targetHeightPx: request.targetHeightPx,
      model: providerSettings.localAiCpuModel,
      outputFormat: 'png',
    });

    return {
      dataUrl: result.dataUrl,
      mimeType: result.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
    };
  }, [
    providerSettings.localAiCpuAuthHeader,
    providerSettings.localAiCpuEndpointUrl,
    providerSettings.localAiCpuModel,
  ]);

  const upscalePaperFrameImageForPrint = useCallback((pageId: string, frame: PaperFrame | undefined, options: {
    method?: PaperPrintUpscaleMethod;
    stabilityCreativity?: number;
    stabilityPrompt?: string;
  } = {}) => {
    const sourceItem = frame?.asset?.sourceBinItemId
      ? useSourceBinStore.getState().getAllItems().find((item) => item.id === frame.asset?.sourceBinItemId)
      : undefined;
    if (!frame?.asset || frame.asset.kind !== 'image') {
      setStatus('Select an image frame with a placed image before upscaling.');
      return;
    }

    setContextMenu(null);
    const busyStartedAt = Date.now();
    const busyTitle = `Upscaling "${frame.asset.label}" for print`;
    const method = options.method ?? providerSettings.paperPrintUpscaleMethod;
    const bridge = getSignalLoomNativeBridge();
    const generateVertexImage = bridge?.generateVertexImage;
    const vertexConfig = getVertexProjectConfig(providerSettings);
    const vertexAvailable = providerSettings.geminiCredentialMode === 'vertex-adc'
      && Boolean(vertexConfig.projectId)
      && Boolean(generateVertexImage);
    const canUseVertexUpscale = shouldUseVertexImagenPrintUpscale(
      method,
      vertexAvailable,
    );
    const sourceWidthPx = frame.asset.pixelWidth ?? sourceItem?.pixelWidth;
    const sourceHeightPx = frame.asset.pixelHeight ?? sourceItem?.pixelHeight;
    const hasSourceDimensions = typeof sourceWidthPx === 'number' && sourceWidthPx > 0
      && typeof sourceHeightPx === 'number' && sourceHeightPx > 0;
    const strictPrintDocument = document.page.dpi >= 300
      ? document
      : { ...document, page: { ...document.page, dpi: 300 } };
    const stabilityPlan = hasSourceDimensions
      ? resolvePaperPrintUpscalePlan({
          method,
          target: resolvePaperPrintUpscaleTarget(strictPrintDocument, frame, {
            widthPx: sourceWidthPx!,
            heightPx: sourceHeightPx!,
          }),
          stabilityAvailable: Boolean(apiKeys.stability?.trim()),
          vertexAvailable,
          androidAcceleratorAvailable: isAndroidAcceleratorConfigured(providerSettings),
          androidNativeAvailable: isAndroidNativeImageUpscalerAvailable(),
          localAiAvailable: isLocalCpuUpscalerConfigured(providerSettings),
        })
      : undefined;
    if (stabilityPlan && isPaperStabilityUpscaleProvider(stabilityPlan.provider)) {
      if (!stabilityPlan.canRun) {
        setStatus(stabilityPlan.unavailableReason ?? 'The selected Stability print upscaler is not configured.');
        return;
      }
      const target = resolvePaperPrintUpscaleTarget(strictPrintDocument, frame, {
        widthPx: sourceWidthPx!,
        heightPx: sourceHeightPx!,
      });
      if (!target.needsUpscale) {
        updateFrame(pageId, frame.id, {
          asset: {
            ...frame.asset,
            pixelWidth: sourceWidthPx,
            pixelHeight: sourceHeightPx,
          },
        });
        setStatus(`"${frame.asset.label}" already meets the strict ${strictPrintDocument.page.dpi} PPI print requirement.`);
        return;
      }
      const mode = stabilityPlan.provider === 'stability-fast' ? 'fast' : 'conservative';
      setPrintUpscaleBusy({
        title: busyTitle,
        detail: formatPaperPrintUpscaleProgress({
          current: 1,
          total: 1,
          label: frame.asset.label,
          provider: stabilityPlan.provider,
          targetWidthPx: target.targetWidthPx,
          targetHeightPx: target.targetHeightPx,
          dpi: document.page.dpi,
        }),
        provider: stabilityPlan.provider,
        current: 1,
        total: 1,
      });
      setStatus(`Submitting "${frame.asset.label}" to ${describePaperPrintUpscaleBusyProvider(stabilityPlan.provider)} for measured print resolution...`);
      void (async () => {
        const source = await resolvePaperStabilitySource({
          asset: frame.asset!,
          sourceItem,
          repository: paperAssetRepository,
        });
        const result = await runStabilityPaperPrintUpscale({
          source: source.source,
          sourceDimensions: source.sourceDimensions,
          placement: buildPaperStabilityPlacementRequirement(strictPrintDocument, frame!, target),
          options: {
            mode,
            ...(mode === 'conservative' ? {
              prompt: options.stabilityPrompt?.trim() || DEFAULT_PAPER_PRINT_UPSCALE_PROMPT,
              creativity: options.stabilityCreativity ?? 0.35,
            } : {}),
          },
        });
        updateFrame(pageId, frame!.id, buildPaperManagedPrintUpscaledFramePatch(frame!, result));
        useProjectUsageStore.getState().recordUsage({
          nodeId: `paper:${pageId}:${frame!.id}`,
          workspace: 'paper',
          operation: 'print-upscale',
          usage: buildPaperPrintUpscaleUsageTelemetry({
            provider: stabilityPlan.provider,
            estimatedCostUsd: result.estimatedCostUsd,
            notes: [
              `Stability ${mode} returned ${result.providerWidthPx} x ${result.providerHeightPx}px for "${frame!.asset!.label}".`,
              `${result.effectivePpi} effective PPI measured at placement; ${result.printReady ? 'meets' : 'does not meet'} the ${result.requiredPpi} PPI requirement.`,
            ],
          }),
        });
        const readiness = result.printReady
          ? `meets ${result.requiredPpi} PPI`
          : `is ${result.effectivePpi} effective PPI, below the ${result.requiredPpi} PPI print requirement`;
        setStatus(`Stability ${mode} returned ${result.providerWidthPx} x ${result.providerHeightPx}px for "${frame!.asset!.label}"; it ${readiness}.`);
      })().catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Could not upscale the selected Paper image with Stability.');
      }).finally(() => {
        clearPaperPrintUpscaleBusyAfterMinimum(setPrintUpscaleBusy, busyStartedAt);
      });
      return;
    }
    if (!stabilityPlan && (method === 'stability-fast' || method === 'stability-conservative')) {
      setStatus('Stability print upscale requires known image pixel dimensions. Reimport the image so Paper can measure it before spending provider credit.');
      return;
    }
    const sourceUrl = resolvePaperFrameAssetUrl(frame.asset, sourceItem);
    if (!sourceUrl) {
      setStatus('The selected image does not have readable source bytes for this print upscaler.');
      return;
    }
    const androidBaseUpscale = isAndroidAcceleratorConfigured(providerSettings)
      ? runAndroidPaperPrintUpscale
      : undefined;
    const androidNativeBaseUpscale = !androidBaseUpscale && isAndroidNativeImageUpscalerAvailable()
      ? runAndroidNativePaperPrintUpscale
      : undefined;
    const localAiBaseUpscale = isLocalCpuUpscalerConfigured(providerSettings)
      ? runLocalAiPaperPrintUpscale
      : undefined;
    const androidAcceleratorUpscale = androidBaseUpscale
      ? async (request: PaperPrintAndroidAcceleratorUpscaleRequest) => {
        setPrintUpscaleBusy({
          title: busyTitle,
          detail: formatPaperPrintUpscaleProgress({
            current: 1,
            total: 1,
            label: frame.asset!.label,
            provider: 'android-accelerator',
            targetWidthPx: request.targetWidthPx,
            targetHeightPx: request.targetHeightPx,
            dpi: document.page.dpi,
          }),
          provider: 'android-accelerator',
          current: 1,
          total: 1,
        });
        setStatus(`Submitting "${frame.asset!.label}" to the Android accelerator for ${request.targetWidthPx} x ${request.targetHeightPx}px @ ${document.page.dpi} DPI...`);
        return androidBaseUpscale(request);
      }
      : undefined;
    const androidNativeUpscale = androidNativeBaseUpscale
      ? async (request: PaperPrintAndroidNativeUpscaleRequest) => {
        setPrintUpscaleBusy({
          title: busyTitle,
          detail: formatPaperPrintUpscaleProgress({
            current: 1,
            total: 1,
            label: frame.asset!.label,
            provider: 'android-native',
            targetWidthPx: request.targetWidthPx,
            targetHeightPx: request.targetHeightPx,
            dpi: document.page.dpi,
          }),
          provider: 'android-native',
          current: 1,
          total: 1,
        });
        setStatus(`Upscaling "${frame.asset!.label}" inside the Android app for ${request.targetWidthPx} x ${request.targetHeightPx}px @ ${document.page.dpi} DPI...`);
        return androidNativeBaseUpscale(request);
      }
      : undefined;
    const localAiUpscale = localAiBaseUpscale
      ? async (request: PaperPrintLocalAiUpscaleRequest) => {
        setPrintUpscaleBusy({
          title: busyTitle,
          detail: formatPaperPrintUpscaleProgress({
            current: 1,
            total: 1,
            label: frame.asset!.label,
            provider: 'local-ai-cpu',
            targetWidthPx: request.targetWidthPx,
            targetHeightPx: request.targetHeightPx,
            dpi: document.page.dpi,
          }),
          provider: 'local-ai-cpu',
          current: 1,
          total: 1,
        });
        setStatus(`Submitting "${frame.asset!.label}" to the local Vulkan AI upscaler for ${request.targetWidthPx} x ${request.targetHeightPx}px @ ${document.page.dpi} DPI...`);
        return localAiBaseUpscale(request);
      }
      : undefined;
    setPrintUpscaleBusy({
      title: busyTitle,
      detail: describePaperPrintUpscaleBusyProvider('preparing'),
      provider: 'preparing',
    });
    setStatus(`Upscaling "${frame.asset.label}" for ${document.page.dpi} DPI print placement...`);
    void (async () => {
      const sourceDataUrl = await imageSourceToDataUrl(sourceUrl);
      const vertexUpscale = canUseVertexUpscale && generateVertexImage
        ? async (request: PaperPrintVertexUpscaleRequest) => {
          const detail = describePaperPrintUpscaleBusyProvider('vertex-imagen', request.upscaleFactor);
          setPrintUpscaleBusy({
            title: busyTitle,
            detail: `${detail} -> ${request.targetWidthPx} x ${request.targetHeightPx}px @ ${document.page.dpi} DPI`,
            provider: 'vertex-imagen',
            current: 1,
            total: 1,
          });
          setStatus(`Upscaling "${frame.asset!.label}" with Vertex Imagen ${request.upscaleFactor}...`);
          const vertexResult = await generateVertexImage({
            projectId: vertexConfig.projectId,
            location: vertexConfig.location,
            auth: vertexConfig.auth,
            modelId: VERTEX_IMAGEN_UPSCALE_MODEL_ID,
            route: 'imagen-predict',
            body: buildVertexImagenUpscaleRequestBody({
              image: dataUrlToVertexInlineImage(request.sourceDataUrl, request.sourceMimeType),
              outputMimeType: 'image/png',
              upscaleFactor: request.upscaleFactor,
            }),
          });

          if (vertexResult.error) {
            throw new Error(vertexResult.error);
          }

          if (!vertexResult.result) {
            throw new Error('Vertex Imagen returned no upscaled image data.');
          }

          return {
            dataUrl: vertexResult.result,
            mimeType: vertexResult.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
          };
        }
        : undefined;
      const result = await upscalePaperImageForPrint({
        document,
        frame,
        method,
        src: sourceDataUrl,
        onProviderResolved: (provider, upscaleFactor) => {
          setPrintUpscaleBusy({
            title: busyTitle,
            detail: describePaperPrintUpscaleBusyProvider(provider, upscaleFactor),
            provider,
          });
        },
        localAiUpscale,
        androidAcceleratorUpscale,
        androidNativeUpscale,
        vertexUpscale,
      });

      const currentWidth = frame.asset?.pixelWidth ?? result.sourceWidthPx;
      const currentHeight = frame.asset?.pixelHeight ?? result.sourceHeightPx;
      if (!result.needsUpscale) {
        updateFrame(pageId, frame.id, {
          asset: {
            ...frame.asset!,
            pixelWidth: currentWidth,
            pixelHeight: currentHeight,
          },
        });
        setStatus(`"${frame.asset!.label}" already meets the current ${document.page.dpi} DPI frame requirement.`);
        return;
      }

      const label = `${frame.asset!.label} print ${result.targetWidthPx}x${result.targetHeightPx}`;
      const item = await addSourceAssetItem({
        label,
        kind: 'image',
        mimeType: result.mimeType,
        dataUrl: result.dataUrl,
        pixelWidth: result.targetWidthPx,
        pixelHeight: result.targetHeightPx,
        sourceKey: `paper-print-upscale:${frame.asset!.sourceBinItemId}:${document.page.dpi}:${result.targetWidthPx}x${result.targetHeightPx}:${Date.now()}`,
        originNodeId: 'paper-print-upscale',
      });

      updateFrame(pageId, frame.id, {
        ...buildPaperPrintUpscaledFramePatch(frame, item, result),
      });
      useProjectUsageStore.getState().recordUsage({
        nodeId: `paper:${pageId}:${frame.id}`,
        workspace: 'paper',
        operation: 'print-upscale',
        usage: buildPaperPrintUpscaleUsageTelemetry({
          provider: result.provider,
          estimatedCostUsd: result.estimatedCostUsd,
          notes: [`Paper print upscale for "${frame.asset!.label}" to ${result.targetWidthPx} x ${result.targetHeightPx}px.`],
        }),
      });
      setSourceSidebarOpen(true);
      const providerLabel = result.provider === 'vertex-imagen'
        ? `with Vertex Imagen ${result.upscaleFactor}`
        : result.provider === 'android-accelerator'
          ? 'with Android accelerator plus exact local DPI fit'
          : result.provider === 'local-ai-cpu'
            ? 'with local Vulkan AI plus exact local DPI fit'
            : 'with local browser scaling';
      const costLabel = result.estimatedCostUsd === undefined || result.estimatedCostUsd <= 0
        ? ''
        : ` Estimated provider cost: $${result.estimatedCostUsd.toFixed(2)}.`;
      setStatus(`Upscaled "${frame.asset!.label}" to ${result.targetWidthPx} x ${result.targetHeightPx}px ${providerLabel} for ${document.page.dpi} DPI print placement.${costLabel}`);
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not upscale the selected Paper image.');
    }).finally(() => {
      clearPaperPrintUpscaleBusyAfterMinimum(setPrintUpscaleBusy, busyStartedAt);
    });
  }, [
    addSourceAssetItem,
    apiKeys.stability,
    document,
    providerSettings,
    runAndroidPaperPrintUpscale,
    runAndroidNativePaperPrintUpscale,
    runLocalAiPaperPrintUpscale,
    runStabilityPaperPrintUpscale,
    setSourceSidebarOpen,
    updateFrame,
  ]);

const finalizePaperPrintUpscaleAndPackage = useCallback(async () => {
    setContextMenu(null);
    const busyStartedAt = Date.now();
    const initialSourceItems = useSourceBinStore.getState().getAllItems();
    const initialSourceItemsById = new Map(initialSourceItems.map((item) => [item.id, item]));
    let repairedInvalidUpscaleCount = 0;

    for (const page of usePaperStore.getState().document.pages) {
      for (const frame of page.frames) {
        const frameAsset = frame.asset;
        if (!frameAsset || !hasPaperAssetReference(frameAsset) || frameAsset.kind !== 'image') continue;
        const sourceBinItemId = frameAsset.sourceBinItemId;
        if (!sourceBinItemId) continue;

        const upscaledSourceItem = initialSourceItemsById.get(sourceBinItemId);
        if (!upscaledSourceItem || !isPaperPrintUpscaledSourceItem(upscaledSourceItem)) continue;

        const originalSourceItemId = parsePaperPrintUpscaleSourceItemId(upscaledSourceItem.sourceKey);
        if (!originalSourceItemId) continue;

        const originalSourceItem = initialSourceItemsById.get(originalSourceItemId);
        if (!originalSourceItem || !originalSourceItem.assetUrl) continue;

        if (!isPaperPrintUpscaledImageAspectMatch({
          upscaledWidthPx: frameAsset.pixelWidth,
          upscaledHeightPx: frameAsset.pixelHeight,
          sourceWidthPx: originalSourceItem.pixelWidth,
          sourceHeightPx: originalSourceItem.pixelHeight,
        })) {
          updateFrame(page.id, frame.id, {
            asset: {
              ...buildPaperFrameAssetFromSourceItem(originalSourceItem),
            },
          });
          repairedInvalidUpscaleCount += 1;
        }
      }
    }

    const liveDocument = usePaperStore.getState().document;
    const liveSourceItems = useSourceBinStore.getState().getAllItems();
    const jobs = collectPaperPrintUpscaleFrameJobs(liveDocument, liveSourceItems);
    const total = jobs.length;
    const method = providerSettings.paperPrintUpscaleMethod;
    const localAiConfigured = isLocalCpuUpscalerConfigured(providerSettings);
    const androidNativeConfigured = !isAndroidAcceleratorConfigured(providerSettings) && isAndroidNativeImageUpscalerAvailable();
    const estimatedBatchCost = method === 'auto'
      ? isAndroidAcceleratorConfigured(providerSettings)
        ? 0
        : androidNativeConfigured
          ? estimatePaperPrintUpscaleCostUsd('android-native', total)
          : localAiConfigured
            ? estimatePaperPrintUpscaleCostUsd('local-ai-cpu', total)
            : apiKeys.stability?.trim()
              ? estimatePaperPrintUpscaleCostUsd('stability-fast', total)
              : estimatePaperPrintUpscaleCostUsd(method, total)
      : estimatePaperPrintUpscaleCostUsd(method, total);
    if (estimatedBatchCost && estimatedBatchCost > 0) {
      const accepted = shouldBypassConfirmations() || await useConfirmationStore.getState().requestConfirmation(
        `Print finalization may upscale ${total} image frame${total === 1 ? '' : 's'} with an estimated provider cost of $${estimatedBatchCost.toFixed(2)}. Continue?`,
        'Print Finalization'
      );
      if (!accepted) {
        setStatus('Canceled print finalization before any cloud upscaling spend.');
        return;
      }
    }

    const repairedMessage = repairedInvalidUpscaleCount > 0
      ? ` ${repairedInvalidUpscaleCount} print-upscale replacement${repairedInvalidUpscaleCount === 1 ? '' : 's'} were removed for aspect ratio mismatch and will be regenerated in this run.`
      : '';
    setPrintUpscaleBusy({
      title: 'Finalizing print assets',
      detail: total
        ? `Preparing 0/${total} image frames for ${document.page.dpi} DPI output`
        : `All image frames already satisfy the current ${document.page.dpi} DPI print target`,
      provider: 'preparing',
      current: total ? 0 : undefined,
      total: total || undefined,
    });
    setStatus(total
      ? `Finalizing ${total} Paper image frame${total === 1 ? '' : 's'} for print...${repairedMessage}`
      : `No Paper image frames need print upscaling; all placed images meet the current ${document.page.dpi} DPI target.${repairedMessage ? ` ${repairedMessage}` : ''} Packaging current print assets...`);

    void (async () => {
      let upscaledCount = 0;
      let failedCount = 0;
      const failedFrames: string[] = [];
      let skippedCount = 0;
      let alreadyReadyCount = 0;
      const stabilityCoordinator = createPaperStabilityUpscaleCoordinator();
      const shouldUseAndroidInAuto = method === 'auto' && isAndroidAcceleratorConfigured(providerSettings);
      const shouldCheckAndroidForFinalize = total > 0
        && (method === 'android-accelerator' || shouldUseAndroidInAuto)
        && isAndroidAcceleratorConfigured(providerSettings);

      if (shouldCheckAndroidForFinalize) {
        const upscalerId = providerSettings.androidAcceleratorDefaultUpscaler?.trim() || 'upscaler_realistic';
        setStatus(`Checking Android accelerator readiness for ${total} finalize upscales (${providerSettings.androidAcceleratorBaseUrl ?? 'port'})...`);
        const status = await getAndroidAcceleratorStatus({
          baseUrl: providerSettings.androidAcceleratorBaseUrl ?? '',
          authToken: providerSettings.androidAcceleratorAuthToken,
        });
        const availability = resolveAndroidUpscalerAvailability(status, upscalerId);
        if (!availability.available) {
          throw new Error(availability.reason ?? 'Android accelerator is not ready.');
        }
      }

      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const liveDocument = usePaperStore.getState().document;
        const livePage = liveDocument.pages.find((page) => page.id === job.pageId);
        const liveFrame = livePage?.frames.find((frame) => frame.id === job.frameId);
        const wait = (delayMs: number) => new Promise<void>((resolve) => {
          window.setTimeout(resolve, delayMs);
        });
        const runPrintUpscaleWithRetry = async <T,>(
          frameLabel: string,
          action: () => Promise<T>,
        ): Promise<T> => {
          let lastError: unknown;
          const retryMaxAttempts = 3;
          const retryDelayMs = 1200;

          for (let attempt = 1; attempt <= retryMaxAttempts; attempt += 1) {
            try {
              return await action();
            } catch (error) {
              lastError = error;
              if (attempt >= retryMaxAttempts) {
                break;
              }

              const message = error instanceof Error ? error.message : 'Could not process this image for print.';
              const progress = formatPaperPrintUpscaleProgress({
                current: index + 1,
                total,
                label: frameLabel,
                provider: 'preparing',
                dpi: liveDocument.page.dpi,
              });
              setPrintUpscaleBusy({
                title: 'Finalizing print assets',
                detail: `${progress} (retry ${attempt + 1}/${retryMaxAttempts} after error: ${message})`,
                provider: 'preparing',
                current: index + 1,
                total,
              });
              setStatus(`Retrying "${frameLabel}" during print finalization (${attempt + 1}/${retryMaxAttempts}) after: ${message}`);
              await wait(retryDelayMs);
            }
          }

          throw lastError instanceof Error
            ? lastError
            : new Error(`Could not finalize "${frameLabel}" for print after ${retryMaxAttempts} attempts.`);
        };

        const frameAsset = liveFrame?.asset;
        if (!liveFrame || !frameAsset || !hasPaperAssetReference(frameAsset) || frameAsset.kind !== 'image') {
          skippedCount += 1;
          continue;
        }

        const liveSourceItems = useSourceBinStore.getState().getAllItems();
        const sourceItem = liveSourceItems.find((item) => item.id === frameAsset.sourceBinItemId);
        if (isPaperFramePrintReady(liveDocument, liveFrame, sourceItem)) {
          alreadyReadyCount += 1;
          updateFrame(job.pageId, liveFrame.id, {
            asset: {
              ...frameAsset,
              pixelWidth: frameAsset.pixelWidth ?? sourceItem?.pixelWidth,
              pixelHeight: frameAsset.pixelHeight ?? sourceItem?.pixelHeight,
            },
          });
          continue;
        }

        try {
          const progressPrefix = `${index + 1}/${total}`;
          const sourceWidthPx = frameAsset.pixelWidth ?? sourceItem?.pixelWidth;
          const sourceHeightPx = frameAsset.pixelHeight ?? sourceItem?.pixelHeight;
          const hasSourceDimensions = typeof sourceWidthPx === 'number' && sourceWidthPx > 0
            && typeof sourceHeightPx === 'number' && sourceHeightPx > 0;
          const strictPrintDocument = liveDocument.page.dpi >= 300
            ? liveDocument
            : { ...liveDocument, page: { ...liveDocument.page, dpi: 300 } };
          const stabilityPlan = hasSourceDimensions
            ? resolvePaperPrintUpscalePlan({
                method,
                target: resolvePaperPrintUpscaleTarget(strictPrintDocument, liveFrame, {
                  widthPx: sourceWidthPx!,
                  heightPx: sourceHeightPx!,
                }),
                stabilityAvailable: Boolean(apiKeys.stability?.trim()),
                vertexAvailable: providerSettings.geminiCredentialMode === 'vertex-adc'
                  && Boolean(getVertexProjectConfig(providerSettings).projectId)
                  && Boolean(getSignalLoomNativeBridge()?.generateVertexImage),
                androidAcceleratorAvailable: isAndroidAcceleratorConfigured(providerSettings),
                androidNativeAvailable: isAndroidNativeImageUpscalerAvailable(),
                localAiAvailable: localAiConfigured,
              })
            : undefined;
          if (stabilityPlan && isPaperStabilityUpscaleProvider(stabilityPlan.provider)) {
            if (!stabilityPlan.canRun) {
              throw new Error(stabilityPlan.unavailableReason ?? 'The selected Stability print upscaler is not configured.');
            }
            const target = resolvePaperPrintUpscaleTarget(strictPrintDocument, liveFrame, {
              widthPx: sourceWidthPx!,
              heightPx: sourceHeightPx!,
            });
            if (!target.needsUpscale) {
              alreadyReadyCount += 1;
              updateFrame(job.pageId, liveFrame.id, {
                asset: {
                  ...frameAsset,
                  pixelWidth: sourceWidthPx,
                  pixelHeight: sourceHeightPx,
                },
              });
              continue;
            }
            const mode = stabilityPlan.provider === 'stability-fast' ? 'fast' : 'conservative';
            setPrintUpscaleBusy({
              title: 'Finalizing print assets',
              detail: formatPaperPrintUpscaleProgress({
                current: index + 1,
                total,
                label: frameAsset.label,
                provider: stabilityPlan.provider,
                targetWidthPx: target.targetWidthPx,
                targetHeightPx: target.targetHeightPx,
                dpi: strictPrintDocument.page.dpi,
              }),
              provider: stabilityPlan.provider,
              current: index + 1,
              total,
            });
            setStatus(`Submitting "${frameAsset.label}" to ${describePaperPrintUpscaleBusyProvider(stabilityPlan.provider)} for measured print resolution (${progressPrefix})...`);
            const result = await runPrintUpscaleWithRetry(frameAsset.label, async () => {
              const source = await resolvePaperStabilitySource({
                asset: frameAsset,
                sourceItem,
                repository: paperAssetRepository,
              });
              return stabilityCoordinator.run({
                apiKey: useSettingsStore.getState().apiKeys.stability?.trim() ?? '',
                source: source.source,
                sourceDimensions: source.sourceDimensions,
                placement: buildPaperStabilityPlacementRequirement(strictPrintDocument, liveFrame, target),
                options: {
                  mode,
                  ...(mode === 'conservative' ? {
                    prompt: DEFAULT_PAPER_PRINT_UPSCALE_PROMPT,
                    creativity: 0.35,
                  } : {}),
                },
                repository: paperAssetRepository,
              });
            });
            updateFrame(job.pageId, liveFrame.id, buildPaperManagedPrintUpscaledFramePatch(liveFrame, result));
            useProjectUsageStore.getState().recordUsage({
              nodeId: `paper:${job.pageId}:${liveFrame.id}`,
              workspace: 'paper',
              operation: 'print-upscale',
              usage: buildPaperPrintUpscaleUsageTelemetry({
                provider: stabilityPlan.provider,
                estimatedCostUsd: result.estimatedCostUsd,
                notes: [
                  `Stability ${mode} returned ${result.providerWidthPx} x ${result.providerHeightPx}px for "${frameAsset.label}".`,
                  `${result.effectivePpi} effective PPI measured at placement; ${result.printReady ? 'meets' : 'does not meet'} the ${result.requiredPpi} PPI requirement.`,
                ],
              }),
            });
            upscaledCount += 1;
            const readiness = result.printReady
              ? `meets ${result.requiredPpi} PPI`
              : `is ${result.effectivePpi} effective PPI, below the ${result.requiredPpi} PPI print requirement`;
            setStatus(`Stability ${mode} returned ${result.providerWidthPx} x ${result.providerHeightPx}px for "${frameAsset.label}"; it ${readiness} (${progressPrefix}).`);
            continue;
          }
          if (!stabilityPlan && (method === 'stability-fast' || method === 'stability-conservative')) {
            throw new Error(`"${frameAsset.label}" needs known pixel dimensions before Stability can plan a paid print upscale.`);
          }
          const bridge = getSignalLoomNativeBridge();
          const generateVertexImage = bridge?.generateVertexImage;
          const vertexConfig = getVertexProjectConfig(providerSettings);
          const vertexAvailable = providerSettings.geminiCredentialMode === 'vertex-adc'
            && Boolean(vertexConfig.projectId)
            && Boolean(generateVertexImage);
          const canUseVertexUpscale = shouldUseVertexImagenPrintUpscale(
            method,
            vertexAvailable,
          );
          const androidAcceleratorUpscale = isAndroidAcceleratorConfigured(providerSettings)
            ? runAndroidPaperPrintUpscale
            : undefined;
          const androidNativeUpscale = !androidAcceleratorUpscale && isAndroidNativeImageUpscalerAvailable()
            ? runAndroidNativePaperPrintUpscale
            : undefined;
          const localAiUpscale = localAiConfigured
            ? runLocalAiPaperPrintUpscale
            : undefined;
          setPrintUpscaleBusy({
            title: 'Finalizing print assets',
            detail: formatPaperPrintUpscaleProgress({
              current: index + 1,
              total,
              label: frameAsset.label,
              provider: 'preparing',
              dpi: liveDocument.page.dpi,
            }),
            provider: 'preparing',
            current: index + 1,
            total,
          });
          setStatus(`Checking "${frameAsset.label}" for ${liveDocument.page.dpi} DPI print upscale (${progressPrefix})...`);

          const result = await runPrintUpscaleWithRetry(frameAsset.label, async () => {
            const sourceUrl = resolvePaperFrameAssetUrl(frameAsset, sourceItem);
            if (!sourceUrl) {
              throw new Error(`Missing source URL for "${frameAsset.label}".`);
            }
            const sourceDataUrl = await imageSourceToDataUrl(sourceUrl);
            const vertexUpscale = canUseVertexUpscale && generateVertexImage
              ? async (request: PaperPrintVertexUpscaleRequest) => {
                const detail = formatPaperPrintUpscaleProgress({
                  current: index + 1,
                  total,
                  label: frameAsset.label,
                  provider: 'vertex-imagen',
                  upscaleFactor: request.upscaleFactor,
                  targetWidthPx: request.targetWidthPx,
                  targetHeightPx: request.targetHeightPx,
                  dpi: liveDocument.page.dpi,
                });
                setPrintUpscaleBusy({
                  title: 'Finalizing print assets',
                  detail,
                  provider: 'vertex-imagen',
                  current: index + 1,
                  total,
                });
                setStatus(`Upscaling "${frameAsset.label}" with Vertex Imagen ${request.upscaleFactor} to ${request.targetWidthPx} x ${request.targetHeightPx}px for ${liveDocument.page.dpi} DPI output (${progressPrefix})...`);
                const vertexResult = await generateVertexImage({
                  projectId: vertexConfig.projectId,
                  location: vertexConfig.location,
                  auth: vertexConfig.auth,
                  modelId: VERTEX_IMAGEN_UPSCALE_MODEL_ID,
                  route: 'imagen-predict',
                  body: buildVertexImagenUpscaleRequestBody({
                    image: dataUrlToVertexInlineImage(request.sourceDataUrl, request.sourceMimeType),
                    outputMimeType: 'image/png',
                    upscaleFactor: request.upscaleFactor,
                  }),
                });

                if (vertexResult.error) {
                  throw new Error(vertexResult.error);
                }

                if (!vertexResult.result) {
                  throw new Error('Vertex Imagen returned no upscaled image data.');
                }

                return {
                  dataUrl: vertexResult.result,
                  mimeType: vertexResult.mimeType === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
                };
              }
              : undefined;
            const androidBaseUpscale = androidAcceleratorUpscale;
            const progressAndroidUpscale = androidBaseUpscale
              ? async (request: PaperPrintAndroidAcceleratorUpscaleRequest) => {
                setPrintUpscaleBusy({
                  title: 'Finalizing print assets',
                  detail: formatPaperPrintUpscaleProgress({
                    current: index + 1,
                    total,
                    label: frameAsset.label,
                    provider: 'android-accelerator',
                    targetWidthPx: request.targetWidthPx,
                    targetHeightPx: request.targetHeightPx,
                    dpi: liveDocument.page.dpi,
                  }),
                  provider: 'android-accelerator',
                  current: index + 1,
                  total,
                });
                setStatus(`Submitting "${frameAsset.label}" to the Android accelerator for ${request.targetWidthPx} x ${request.targetHeightPx}px @ ${liveDocument.page.dpi} DPI (${progressPrefix})...`);
                return androidBaseUpscale(request);
              }
              : undefined;
            const androidNativeBaseUpscale = androidNativeUpscale;
            const progressAndroidNativeUpscale = androidNativeBaseUpscale
              ? async (request: PaperPrintAndroidNativeUpscaleRequest) => {
                setPrintUpscaleBusy({
                  title: 'Finalizing print assets',
                  detail: formatPaperPrintUpscaleProgress({
                    current: index + 1,
                    total,
                    label: frameAsset.label,
                    provider: 'android-native',
                    targetWidthPx: request.targetWidthPx,
                    targetHeightPx: request.targetHeightPx,
                    dpi: liveDocument.page.dpi,
                  }),
                  provider: 'android-native',
                  current: index + 1,
                  total,
                });
                setStatus(`Upscaling "${frameAsset.label}" inside the Android app to ${request.targetWidthPx} x ${request.targetHeightPx}px for ${liveDocument.page.dpi} DPI output (${progressPrefix})...`);
                return androidNativeBaseUpscale(request);
              }
              : undefined;
            const result = await upscalePaperImageForPrint({
              document: liveDocument,
              frame: liveFrame,
              method,
              src: sourceDataUrl,
              onProviderResolved: (provider, upscaleFactor) => {
                setPrintUpscaleBusy({
                  title: 'Finalizing print assets',
                  detail: formatPaperPrintUpscaleProgress({
                    current: index + 1,
                    total,
                    label: frameAsset.label,
                    provider,
                    upscaleFactor,
                    dpi: liveDocument.page.dpi,
                  }),
                  provider,
                  current: index + 1,
                  total,
                });
              },
              localAiUpscale,
              androidAcceleratorUpscale: progressAndroidUpscale,
              androidNativeUpscale: progressAndroidNativeUpscale,
              vertexUpscale,
            });
            return result;
          });

          if (!result.needsUpscale) {
            alreadyReadyCount += 1;
            updateFrame(job.pageId, liveFrame.id, {
              asset: {
                ...frameAsset,
                pixelWidth: frameAsset.pixelWidth ?? result.sourceWidthPx,
                pixelHeight: frameAsset.pixelHeight ?? result.sourceHeightPx,
              },
            });
            continue;
          }

          const label = `${frameAsset.label} print ${result.targetWidthPx}x${result.targetHeightPx}`;
          const item = await addSourceAssetItem({
            label,
            kind: 'image',
            mimeType: result.mimeType,
            dataUrl: result.dataUrl,
            pixelWidth: result.targetWidthPx,
            pixelHeight: result.targetHeightPx,
            sourceKey: `paper-print-upscale:${frameAsset.sourceBinItemId}:${liveDocument.page.dpi}:${result.targetWidthPx}x${result.targetHeightPx}:${Date.now()}`,
            originNodeId: 'paper-print-upscale',
          });

          updateFrame(job.pageId, liveFrame.id, {
            ...buildPaperPrintUpscaledFramePatch(liveFrame, item, result),
          });
          useProjectUsageStore.getState().recordUsage({
            nodeId: `paper:${job.pageId}:${liveFrame.id}`,
            workspace: 'paper',
            operation: 'print-upscale',
            usage: buildPaperPrintUpscaleUsageTelemetry({
              provider: result.provider,
              estimatedCostUsd: result.estimatedCostUsd,
              notes: [`Paper print upscale for "${frameAsset.label}" to ${result.targetWidthPx} x ${result.targetHeightPx}px.`],
            }),
          });
          upscaledCount += 1;
        } catch (error) {
          failedCount += 1;
          const frameLabel = frameAsset.label;
          const message = error instanceof Error ? error.message : 'Could not upscale this image.';
          failedFrames.push(`${frameLabel}: ${message}`);
          setStatus(`Failed "${frameLabel}" (${index + 1}/${total}) during print finalize: ${message}`);
        }
      }

      const latestDocument = usePaperStore.getState().document;
      // The package must contain one pinned revision of every linked source: build from the
      // frozen snapshot and re-assert it right before the durable download.
      const finalizePackageGuard = createPaperLinkedSourceIdentityGuard(
        latestDocument,
        () => useSourceBinStore.getState().getAllItems(),
      );
      const pack = await buildPaperPackageExport(latestDocument, [...finalizePackageGuard.sourceItems]);
      finalizePackageGuard();
      downloadBlob(pack.fileName, pack.blob);
      setSourceSidebarOpen(true);
      const failureText = failedCount > 0
        ? `${failedCount} failed${failedFrames.length > 0 ? ` (${failedFrames.slice(0, 3).join('; ')}${failedFrames.length > 3 ? '; ...' : ''})` : ''}`
        : '0 failed';
      setStatus(`Finalized print assets: ${upscaledCount} upscaled, ${alreadyReadyCount} already sufficient, ${skippedCount} skipped because they were already print-upscaled, ${failureText}. Downloaded ${pack.fileName}.`);
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not finalize Paper images for print.');
    }).finally(() => {
      clearPaperPrintUpscaleBusyAfterMinimum(setPrintUpscaleBusy, busyStartedAt);
    });
  }, [
    addSourceAssetItem,
    apiKeys.stability,
    document,
    providerSettings,
    runAndroidPaperPrintUpscale,
    runAndroidNativePaperPrintUpscale,
    runLocalAiPaperPrintUpscale,
    setSourceSidebarOpen,
    updateFrame,
  ]);

  const exportPaperPageToSourceLibrary = useCallback(async (
    pageId: string,
    options: {
      envelopeId?: string;
      envelopeLabel?: string;
      envelopeIndex?: number;
    } = {},
    existingRasterizationGuard?: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>,
  ): Promise<SourceBinLibraryItem> => {
    // Complete-document capability preflight must happen before source/repository asset reads or
    // the first Source item write, so a PDF on page two cannot leak page one.
    const rasterizationGuard = existingRasterizationGuard
      ?? createPaperDocumentRasterizationGuardWithCurrentSources(document, [pageId]);
    const outputDocument = await materializePaperRasterOutputDocument(document, rasterizationGuard);
    const exact = await buildPaperDocumentExactManagedFontOutput(outputDocument);
    rasterizationGuard();
    const item = await publishRasterizedPaperPageSourcePayload(exact.document, pageId, {
      ...options,
      resolveImageSrc: (src) => imageSourceToDataUrl(src),
      fontFaceCss: exact.fontFaceCss,
    }, addSourceAssetItem, rasterizationGuard);
    setSourceSidebarOpen(true);
    return item;
  }, [addSourceAssetItem, document, setSourceSidebarOpen]);

  const sendPaperPageToSourceLibraryById = useCallback((pageId: string) => {
    const page = document.pages.find((candidate) => candidate.id === pageId);
    if (!page) return;
    setStatus(`Flattening page ${page.pageNumber} to the Source Library...`);
    void exportPaperPageToSourceLibrary(pageId)
      .then((item) => setStatus(`Exported "${item.label}" to the Source Library — ready in Image, Video, and Flow.`))
      .catch((error) => {
        setStatus(error instanceof Error ? error.message : 'Could not export the flattened page.');
      });
  }, [document.pages, exportPaperPageToSourceLibrary]);

  const exportSelectedPageToSourceLibrary = useCallback(() => {
    if (!selectedPage) return;
    sendPaperPageToSourceLibraryById(selectedPage.id);
  }, [selectedPage, sendPaperPageToSourceLibraryById]);

  const exportAllPagesToSourceEnvelope = useCallback(() => {
    void (async () => {
      const label = await useTextInputDialogStore.getState().requestTextInput({
        title: 'Export Paper Pages Envelope',
        message: 'Name the Source Library envelope that will contain flattened Paper pages.',
        label: 'Envelope name',
        initialValue: `${document.title} flattened pages`,
        placeholder: `${document.title} flattened pages`,
        confirmLabel: 'Export',
      });
      if (label === null) return;
      const envelopeLabel = label.trim() || `${document.title} flattened pages`;
      const envelopeId = `paper-envelope-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
      const rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
      setStatus(`Flattening ${document.pages.length} page${document.pages.length === 1 ? '' : 's'} into "${envelopeLabel}"...`);
      const outputDocument = await materializePaperRasterOutputDocument(document, rasterizationGuard);
      const exact = await buildPaperDocumentExactManagedFontOutput(outputDocument);
      rasterizationGuard();
      await publishRasterizedPaperPagesSourcePayloads(
        exact.document,
        document.pages.map((page, envelopeIndex) => ({
          pageId: page.id,
          options: {
            envelopeId,
            envelopeLabel,
            envelopeIndex,
            resolveImageSrc: (src: string) => imageSourceToDataUrl(src),
            fontFaceCss: exact.fontFaceCss,
          },
        })),
        addSourceAssetItem,
        rasterizationGuard,
      );
      setSourceSidebarOpen(true);
      setStatus(`Exported ${document.pages.length} flattened page${document.pages.length === 1 ? '' : 's'} into "${envelopeLabel}".`);
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not export flattened pages into the envelope.');
    });
  }, [addSourceAssetItem, document, setSourceSidebarOpen]);

  const runWebcomicImageExport = useCallback(async (settings: PaperWebcomicExportSettings) => {
    let rasterizationGuard: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>;
    try {
      rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Paper page image export is unavailable.';
      setStatus(message);
      await showAlertDialog({ title: 'Page Image Export Blocked', message, tone: 'danger' });
      return;
    }
    if (!await confirmPreflightBeforeExport('webcomic page image export', { rasterTarget: true })) return;
    const outputDocument = await materializePaperOutputDocument(document, rasterizationGuard);
    if (!outputDocument) return;
    setWebcomicExportSettings(settings);
    setWebcomicExportOpen(false);
    const outcome = await exportPaperWebcomicImages(outputDocument, (message) => {
      showPaperExportProgress(message, 'directory');
    }, {
      format: settings.format,
      includeBleed: settings.includeBleed,
      outputWidthPx: settings.outputWidthPx,
      outputDpi: settings.outputDpi,
      quality: settings.quality,
      rasterizationGuard,
    });
    finishPaperExportNotice(outcome);
    if (outcome.state === 'error') {
      void showAlertDialog({
        title: 'Page Image Export Failed',
        message: outcome.message,
        tone: 'danger',
      });
    }
  }, [
    confirmPreflightBeforeExport,
    document,
    finishPaperExportNotice,
    materializePaperOutputDocument,
    showPaperExportProgress,
  ]);

  const runKdpImageExport = useCallback(async (settings: PaperKdpExportSettings) => {
    let rasterizationGuard: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>;
    try {
      rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(document);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KDP raster export is unavailable.';
      setStatus(message);
      await showAlertDialog({ title: 'KDP Export Blocked', message, tone: 'danger' });
      return;
    }
    const pendingUpscales = collectPaperPrintUpscaleFrameJobs(document, sourceItems);
    if (pendingUpscales.length > 0) {
      const message = `Run Finalize Print before KDP export. ${pendingUpscales.length} image frame${pendingUpscales.length === 1 ? '' : 's'} still need print-resolution replacement.`;
      setStatus(message);
      await showAlertDialog({
        title: 'KDP Export Blocked',
        message,
        tone: 'warning',
      });
      return;
    }

    const normalizedSettings = normalizePaperKdpExportSettings(settings, document);
    const plan = buildPaperKdpExportPlan(document, normalizedSettings);
    const blockingWarnings = plan.warnings.filter((warning) => warning.severity === 'error');
    if (blockingWarnings.length > 0 && !normalizedSettings.allowPreflightErrors) {
      const message = blockingWarnings.map((warning) => warning.message).join('\n\n');
      setStatus('KDP export blocked by preflight warnings.');
      await showAlertDialog({
        title: 'KDP Export Blocked',
        message,
        tone: 'warning',
      });
      return;
    }
    if (!await confirmPreflightBeforeExport('KDP image asset export', { rasterTarget: true })) return;

    setKdpExportSettings(normalizedSettings);
    setKdpExportOpen(false);
    setStatus(`Building KDP asset package: ${plan.interiorPageCount} interior page image${plan.interiorPageCount === 1 ? '' : 's'} plus cover wrap...`);
    const outputDocument = await materializePaperOutputDocument(document, rasterizationGuard);
    if (!outputDocument) return;
    const exact = await buildPaperDocumentExactManagedFontOutput(outputDocument);
    rasterizationGuard();
    void buildPaperKdpImageArchiveExport(exact.document, {
      directoryName: normalizedSettings.directoryName,
      dpi: normalizedSettings.dpi,
      interiorType: normalizedSettings.interiorType,
      paperType: normalizedSettings.paperType,
      resolveImageSrc: (src) => imageSourceToDataUrl(src),
      fontFaceCss: exact.fontFaceCss,
      spineFillColor: normalizedSettings.spineFillColor,
      spineWidthMm: normalizedSettings.spineWidthMm,
      onPageRasterized: ({ pageNumber, pageIndex, pageCount, role }) => {
        setStatus(`Rasterized source page ${pageNumber} (${pageIndex + 1}/${pageCount}) for KDP ${role.replaceAll('-', ' ')}...`);
      },
    })
      .then((archive) => {
        rasterizationGuard();
        downloadBlob(archive.fileName, archive.blob);
        const warningCount = archive.plan.warnings.length;
        setStatus(`Downloaded ${archive.fileName} with ${archive.entries.length} KDP files${warningCount ? ` and ${warningCount} preflight note${warningCount === 1 ? '' : 's'}` : ''}.`);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : 'KDP export failed while rasterizing pages.';
        setStatus(`KDP export failed: ${message}`);
        void showAlertDialog({
          title: 'KDP Export Failed',
          message,
          tone: 'danger',
        });
      });
  }, [confirmPreflightBeforeExport, document, materializePaperOutputDocument, sourceItems]);

  const exportSelectedPageToImageWorkspace = useCallback(() => {
    if (!selectedPage) return;
    setStatus(`Flattening page ${selectedPage.pageNumber} for the Image workspace...`);
    void (async () => {
      const item = await exportPaperPageToSourceLibrary(selectedPage.id);
      const bridge = getSignalLoomNativeBridge();
      if (bridge?.openWorkspaceWindow) {
        // Multi-window desktop: the Image WINDOW owns its own store, so writing the
        // built ImageDocument into THIS window's store is invisible there. Open/focus
        // the window first, then post the command (same ordering as
        // openPaperFrameImageInImageWorkspace / sendPaperFrameSourceToFlow). This is
        // NOT a linked edit (no `linkedEdit`) — the flattened page opens as a plain,
        // standalone document; the receiver rebuilds it from the source item since an
        // ImageDocument's OffscreenCanvas bitmaps can't ride the BroadcastChannel.
        await bridge.openWorkspaceWindow('image');
        window.setTimeout(() => postWorkspaceWindowCommand({
          type: 'image-open-linked-document',
          item,
          targetWorkspace: 'image',
        }), 250);
        setStatus(`Opened "${item.label}" as an editable flattened page in Image.`);
        return;
      }
      try {
        openImageDocument(await createImageDocumentFromSourceItem(item));
        setStatus(`Opened "${item.label}" as an editable flattened page in Image.`);
      } catch (error) {
        openImageDocument(createSourceBackedImageDocumentShell(item));
        setStatus(error instanceof Error
          ? `Opened "${item.label}" as a linked image shell; bitmap load failed: ${error.message}`
          : `Opened "${item.label}" as a linked image shell; bitmap load failed.`);
      } finally {
        setWorkspaceView('image');
      }
    })().catch((error) => {
      setStatus(error instanceof Error ? error.message : 'Could not open the flattened page in Image.');
    });
  }, [exportPaperPageToSourceLibrary, openImageDocument, selectedPage, setWorkspaceView]);

  const applyFrameMenuAction = (pageId: string, frameId: string, actionId: PaperFrameContextActionId) => {
    runFrameContextAction(pageId, frameId, actionId);
    setContextMenu(null);
    setStatus(PAPER_FRAME_CONTEXT_ACTIONS.find((action) => action.id === actionId)?.label ?? 'Updated frame.');
  };

  // Grows a clipping text/caption frame to fit its measured content (the "Fit Frame to Text" context-menu
  // action). Reads the live-DOM content box PaperFrameView tags with data-paper-frame-content-box for this
  // exact frame — `window.document` (the browser DOM), not `document` (this component's PaperDocument model,
  // shadowed in this scope) — converts it to mm, then routes the resulting heightMm patch through the same
  // updateFrame store action every other frame edit uses, so undo/history conventions hold like any other edit.
  const fitFrameToTextAction = (pageId: string, frameId: string) => {
    const page = document.pages.find((candidate) => candidate.id === pageId);
    const frame = page?.frames.find((candidate) => candidate.id === frameId);
    setContextMenu(null);
    if (!frame) return;
    const contentBoxEl = typeof window === 'undefined'
      ? null
      : window.document.querySelector(`[data-paper-frame-id="${frameId}"] [data-paper-frame-content-box="true"]`);
    if (!(contentBoxEl instanceof HTMLElement)) {
      setStatus("Could not measure this frame's text to fit it — try again once the page has rendered.");
      return;
    }
    const contentBoxHeightMm = contentBoxEl.scrollHeight / (PX_PER_MM * zoom);
    const newHeightMm = computeFitToTextFrameHeightMm({
      contentBoxHeightMm,
      textBoxHeightPercent: resolvePaperTextBox(frame).heightPercent,
      currentHeightMm: frame.heightMm,
    });
    if (newHeightMm <= frame.heightMm) {
      setStatus('This frame already fits its text.');
      return;
    }
    updateFrame(pageId, frameId, { heightMm: newHeightMm });
    setStatus('Grew the frame to fit its text.');
  };

  const applyPageMenuAction = (
    pageId: string,
    actionId: PaperPageContextActionId,
    point: PaperPoint,
    sourceItem?: SourceBinLibraryItem,
  ) => {
    runPageContextAction(pageId, actionId, { point, sourceItem });
    setContextMenu(null);
    setStatus(sourceItem
      ? `Placed "${sourceItem.label}" on the page.`
      : PAPER_PAGE_CONTEXT_ACTIONS.find((action) => action.id === actionId)?.label ?? 'Updated page.');
  };

  const copyActiveFrameStyle = useCallback(() => {
    const copied = copySelectedFrameStyle();
    setStatus(copied ? 'Copied selected frame style.' : 'Select a Paper frame before copying style.');
  }, [copySelectedFrameStyle]);

  const pasteCopiedFrameStyle = useCallback(() => {
    const count = pasteFrameStyleToSelection();
    if (count > 0) {
      setStatus(`Pasted style to ${count} selected frame${count === 1 ? '' : 's'}.`);
      return;
    }
    setStatus(styleClipboard ? 'Selected frames already match the copied style.' : 'No copied Paper style is available.');
  }, [pasteFrameStyleToSelection, styleClipboard]);

  const insertObjectLibraryItem = useCallback((kind: PaperFrameKind, patch: PaperFramePatch) => {
    const frameId = addFrameToPage(selectedPageId, kind, patch);
    if (!frameId) {
      setStatus('Could not insert the snippet on the selected page.');
      return;
    }
    setStatus('Inserted the reusable object on the selected page.');
  }, [addFrameToPage, selectedPageId]);

  const openComicSfxDesigner = useCallback((presetId: PaperComicSfxPresetId, pageId?: string, point?: PaperPoint) => {
    const preset = getPaperComicSfxPreset(presetId);
    setContextMenu(null);
    setComicSfxDesigner({ presetId, pageId, point });
    setStatus(`Designing ${preset.label} comic sound effect.`);
  }, []);

  const openComicSfxFrameDesigner = useCallback((pageId: string, frame: PaperFrame | undefined) => {
    if (!frame?.comicSfxDesign) {
      setStatus('Select a comic sound-effect decal before editing it.');
      return;
    }

    setContextMenu(null);
    setComicSfxDesigner({
      presetId: frame.comicSfxDesign.presetId,
      pageId,
      frameId: frame.id,
      initialDesign: frame.comicSfxDesign,
    });
    setStatus(`Editing ${frame.comicSfxDesign.text} comic sound-effect decal.`);
  }, []);

  const placeComicSfxDesign = useCallback((design: PaperComicSfxDesign) => {
    const target = comicSfxDesigner;
    if (!target) return;
    if (target.frameId && target.pageId) {
      const page = usePaperStore.getState().document.pages.find((candidate) => candidate.id === target.pageId);
      const frame = page?.frames.find((candidate) => candidate.id === target.frameId);
      if (!frame) {
        setComicSfxDesigner(null);
        setStatus('Could not update the comic sound-effect decal because the frame no longer exists.');
        return;
      }
      updateFrame(target.pageId, target.frameId, buildPaperComicSfxDecalFrameUpdate(frame, design));
      setComicSfxDesigner(null);
      setStatus(`Updated ${design.text} comic sound-effect decal.`);
      return;
    }
    const primaryFrameId = addComicSfx(design.presetId, {
      pageId: target.pageId,
      point: target.point,
      design,
    });
    setComicSfxDesigner(null);
    setStatus(primaryFrameId ? `Placed ${design.text} comic sound effect.` : 'Could not place comic sound effect on the current page.');
  }, [addComicSfx, comicSfxDesigner, updateFrame]);

  const revealPaperPage = useCallback((pageId: string, mode: PaperViewportFitMode = 'page') => {
    window.requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const pageElement = Array.from(container.querySelectorAll<HTMLElement>('[data-paper-page-id]'))
        .find((element) => element.dataset.paperPageId === pageId);
      const target = mode === 'spread'
        ? pageElement?.closest<HTMLElement>('[data-paper-spread-view="true"]') ?? pageElement
        : pageElement;
      target?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
  }, []);

  const selectPageFromPagesPanel = useCallback((pageId: string) => {
    selectPage(pageId);
    revealPaperPage(pageId);
    setStatus(`Selected page ${document.pages.find((page) => page.id === pageId)?.pageNumber ?? ''}.`);
  }, [document.pages, revealPaperPage, selectPage]);

  const fitPaperViewport = useCallback((mode: PaperViewportFitMode) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const selectedSpread = paperSpreads.find((spread) => spread.slots.some((slot) => slot.page?.id === selectedPageId));
    const spreadPageCount = mode === 'spread'
      ? Math.max(1, selectedSpread?.slots.filter((slot) => Boolean(slot.page)).length ?? 1)
      : 1;
    const nextZoom = resolvePaperViewportFitZoom({
      mode,
      viewportWidthPx: container.clientWidth,
      viewportHeightPx: container.clientHeight,
      pageWidthMm: document.page.widthMm,
      pageHeightMm: document.page.heightMm,
      spreadPageCount,
      paddingPx: document.view.showRulers ? 96 : 72,
    });
    setZoom(nextZoom);
    setStatus(`${mode === 'spread' ? 'Spread' : 'Page'} fitted at ${Math.round(nextZoom * 100)}%.`);
    revealPaperPage(selectedPageId, mode);
  }, [document.page.heightMm, document.page.widthMm, document.view.showRulers, paperSpreads, revealPaperPage, selectedPageId, setZoom]);

  const addPageFromPagesPanel = useCallback(() => {
    addPage();
    const pageId = usePaperStore.getState().selectedPageId;
    revealPaperPage(pageId);
    setStatus('Added and selected a new page.');
  }, [addPage, revealPaperPage]);

  const duplicatePageFromPagesPanel = useCallback(() => {
    duplicatePage();
    const pageId = usePaperStore.getState().selectedPageId;
    revealPaperPage(pageId);
    setStatus('Duplicated and selected the page.');
  }, [duplicatePage, revealPaperPage]);

  const dockablePanels = useMemo<DockablePanelDefinition[]>(() => {
    const withDefault = (panelId: string) => paperDockableDefaults.find((panel) => panel.panelId === panelId)!;

    return [
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.pages),
        title: t('paper.pages.title'),
        allowedDockZones: ['left', 'right', 'overlay'],
        content: (
          <PaperPagesPanel
            document={document}
            onAddPage={addPageFromPagesPanel}
            onDuplicatePage={duplicatePageFromPagesPanel}
            onFitPage={() => fitPaperViewport('page')}
            onFitSpread={() => fitPaperViewport('spread')}
            onSelectPage={selectPageFromPagesPanel}
            selectedPageId={selectedPageId}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.layers),
        title: t('paper.layers.title'),
        allowedDockZones: ['left', 'right', 'overlay'],
        content: (
          <PaperLayersPanel
            document={document}
            onAddLayer={() => {
              const layerId = addLayer();
              setStatus(layerId ? 'Added a new Paper layer.' : 'The layer could not be added.');
            }}
            onAssignSelectionToLayer={(layerId) => {
              const before = usePaperStore.getState().document;
              assignSelectionToLayer(layerId);
              const changed = usePaperStore.getState().document !== before;
              setStatus(changed
                ? 'Moved editable selected objects to the layer.'
                : 'No editable selected objects needed to move.');
            }}
            onMoveLayer={moveLayer}
            onRenameLayer={renameLayer}
            onSelectFrame={(frameId, additive) => selectFrameWithMode(frameId, additive ? 'toggle' : 'replace')}
            onSetLayerLocked={setLayerLocked}
            onSetLayerPrintability={setLayerPrintability}
            onSetLayerVisibility={setLayerVisibility}
            onStackFrame={(frameId, action) => {
              if (!selectedPage) return;
              runFrameContextAction(selectedPage.id, frameId, action);
            }}
            onToggleFrameLock={(frame) => {
              if (!selectedPage) return;
              runFrameContextAction(selectedPage.id, frame.id, frame.locked ? 'unlock-frame' : 'lock-frame');
            }}
            page={selectedPage}
            selectedFrameIds={selectedFrameIds}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.storyEditor),
        title: t('paper.story.title'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperStoryEditorPanel
            document={document}
            onApplyStory={(pageId, frameId, text, removeRichFormatting) => {
              updateFrame(pageId, frameId, {
                text,
                ...(removeRichFormatting ? { richText: undefined } : {}),
              });
              setStatus(removeRichFormatting
                ? 'Applied the story as plain text; rich inline formatting was removed.'
                : 'Applied the story. The previous text remains available through Undo.');
            }}
            onRevealFrame={(pageId, frameId) => {
              const page = document.pages.find((candidate) => candidate.id === pageId);
              selectPaperTarget({ pageNumber: page?.pageNumber, frameId });
              revealPaperPage(pageId);
            }}
            selectedFrameId={selectedFrame?.id}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.writingAssistant),
        title: t('paper.panels.writingAssistant'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperWritingAssistantPanel
            key={`writing:${writingSource?.workspaceDocumentId ?? 'unavailable'}:${writingSource?.documentInstanceId ?? 'unavailable'}:${writingSource?.documentId ?? ''}:${writingSource?.pageId ?? ''}:${writingSource?.frameId ?? ''}:${writingSource?.sourceRevision ?? ''}:${locale}:${writingProviderConfigurationKey}`}
            locale={locale}
            onApplyPlainText={applyWritingPreview}
            onCopyPlainText={async (text) => {
              try {
                await navigator.clipboard.writeText(text);
                setStatus('Copied the writing preview to the clipboard.');
              } catch {
                setStatus('Could not copy the writing preview. Select the preview text and copy it manually.');
              }
            }}
            onGeneratePreview={generateWritingPreview}
            onOpenProviderSettings={() => useSettingsStore.getState().openSettings('providers')}
            providers={writingProviderOptions}
            source={writingSource}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.assistedLayout),
        title: t('paper.panels.assistedLayout'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperAssistedLayoutPanel
            key={`layout:${locale}:${writingProviderConfigurationKey}`}
            locale={locale}
            onGeneratePreview={generateAssistedLayoutPreview}
            onOpenAsNewDocument={openAssistedLayoutAsNewDocument}
            onOpenProviderSettings={() => useSettingsStore.getState().openSettings('providers')}
            providers={writingProviderOptions}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.liveLayoutAgent),
        title: t('paper.panels.liveLayoutAgent'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperLiveLayoutAgentPanel
            key={`live-agent:${writingProviderConfigurationKey}`}
            onOpenProviderSettings={() => useSettingsStore.getState().openSettings('providers')}
            onStart={startLiveLayoutAgent}
            providers={writingProviderOptions}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp),
        title: t('paper.panels.shortcuts'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperShortcutHelpPanel
            labels={shortcutHelpLabels}
            locale={locale}
            shortcuts={keyboardShortcuts}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.inspector),
        title: t('paper.panels.inspector'),
        allowedDockZones: ['right', 'left', 'overlay'],
        content: (
          <PaperInspector
            document={document}
            documentTitle={document.title}
            frame={selectedFrame}
            onDeletePage={deletePage}
            onUpdateDocumentSetup={updateDocumentSetup}
            onUpdatePublicationReferences={updatePaperPublicationReferences}
            onUpdatePaperTrackChanges={updatePaperTrackChanges}
            onDecidePaperTrackChange={decidePaperTrackChange}
            onUpdateStyleAutomation={updateStyleAutomation}
            onUpdateFrame={updateSelectedFrame}
            onExportDerivedPdf={(derivedDocument) => {
              void (async () => {
                if (isCommercialPrintProductionTarget(derivedDocument.printProduction)
                  && !(await requestCommercialExportUnlock('PDF/X and CMYK print production'))) return;
                if (!await confirmPreflightBeforeExport('Data merge PDF export', { rasterTarget: true })) return;
                if (isPdfXProductionTarget(derivedDocument.printProduction)) {
                  await exportPaperPdfxAndSave(derivedDocument, setStatus);
                  return;
                }
                let rasterizationGuard: ReturnType<typeof createPaperDocumentRasterizationGuardWithCurrentSources>;
                try {
                  rasterizationGuard = createPaperDocumentRasterizationGuardWithCurrentSources(derivedDocument);
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : 'Derived PDF export is unavailable.');
                  return;
                }
                const outputDocument = await materializePaperOutputDocument(derivedDocument, rasterizationGuard);
                if (!outputDocument) return;
                await exportPaperPdfDocument(
                  outputDocument,
                  (message) => showPaperExportProgress(message, 'file'),
                  undefined,
                  {
                    rasterPreset: providerSettings.paperPdfRasterPreset,
                    rasterizationGuard,
                  },
                ).then(finishPaperExportNotice);
              })();
            }}
            onUpdateBubbleConnectorGeometry={(ownerFrameId, geometry) => {
              if (!selectedPage) return;
              updateFrame(selectedPage.id, ownerFrameId, { bubbleConnectorGeometry: geometry });
            }}
            onChainBubbleWith={(targetFrameId) => {
              const before = usePaperStore.getState().document;
              chainSelectedBubbleWith(targetFrameId, 'bridge');
              setStatus(usePaperStore.getState().document !== before
                ? 'Joined the selected bubble to a same-speaker bridge.'
                : 'Could not join the bubbles. Unlock every member of both chains first.');
            }}
            onMoveBubbleInChain={(direction) => {
              const before = usePaperStore.getState().document;
              moveSelectedBubbleInChain(direction);
              setStatus(usePaperStore.getState().document !== before
                ? `Moved the selected bubble ${direction} in the chain reading order.`
                : 'Could not reorder the chain. Unlock every member first.');
            }}
            onUnchainBubble={() => {
              if (!selectedFrame) return;
              const before = usePaperStore.getState().document;
              unchainBubble(selectedFrame.id);
              setStatus(usePaperStore.getState().document !== before
                ? 'Removed the selected bubble from its chain.'
                : 'Could not edit the chain. Unlock every member first.');
            }}
            onAddSwatch={addPaperSwatch}
            onRemoveSwatch={removePaperSwatch}
            onToggleViewOption={toggleViewOption}
            onAddParentPage={() => {
              void (async () => {
                const name = await useTextInputDialogStore.getState().requestTextInput({
                  title: 'New Parent Page',
                  message: 'Name the reusable parent page.',
                  label: 'Parent page name',
                  initialValue: 'A-Parent',
                  placeholder: 'A-Parent',
                  confirmLabel: 'Create',
                });
                if (name === null) return;
                const parentId = addParentPage(name.trim() || 'A-Parent');
              if (parentId) setStatus('Created a parent page.');
              })();
            }}
            onAddSelectedFrameToParent={(parentPageId) => {
              if (!selectedFrame) return;
              addFrameToParentPage(parentPageId, selectedFrame.kind, { ...selectedFrame, id: undefined, parentPageId: undefined, parentFrameId: undefined, inherited: false, locked: true });
              setStatus('Added selected frame to parent page.');
            }}
            onAssignParentPage={(parentPageId) => {
              if (!selectedPage) return;
              assignParentPage(selectedPage.id, parentPageId || undefined);
              setStatus(parentPageId ? 'Applied parent page to current page.' : 'Cleared parent page from current page.');
            }}
            onClearStyleLinks={clearSelectedStyleLinks}
            onClearStyleOverrides={clearSelectedStyleOverrides}
            onCopyStyle={copyActiveFrameStyle}
            onEditComicSfxFrame={() => selectedPage && openComicSfxFrameDesigner(selectedPage.id, selectedFrame ?? undefined)}
            onSendGeneratedMediaToFlow={() => sendPaperGeneratedMediaPromptToFlow(selectedFrame ?? undefined)}
            onPasteStyle={pasteCopiedFrameStyle}
            onRedefineStyle={redefineSelectedStyle}
            canPasteStyle={Boolean(styleClipboard)}
            pageCount={document.pages.length}
            selectedPageNumber={selectedPage?.pageNumber ?? 1}
            status={status}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.preflight),
        title: 'Preflight',
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: <PaperPreflightPanel onSelectPreflightIssue={(issue) => selectPaperTarget({ pageNumber: issue.pageNumber, frameId: issue.frameId })} preflight={preflightReport} />,
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.linkedAssets),
        title: 'Linked Assets',
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: <PaperLinkedAssetsPanel document={document} onSelectLinkedAsset={(asset) => selectPaperTarget({ pageNumber: asset.pageNumber, frameId: asset.frameId })} sourceItems={sourceItems} />,
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.reviewComments),
        title: t('paper.reviewComments.title'),
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperReviewCommentsPanel
            document={document}
            onAddComment={addReviewComment}
            onAddReply={addReviewReply}
            onDeleteComment={(commentId) => {
              deleteReviewComment(commentId);
              setStatus('Deleted the review comment thread.');
            }}
            onSetResolved={(commentId, resolved) => {
              setReviewCommentResolved(commentId, resolved);
              setStatus(resolved ? 'Marked the review thread resolved.' : 'Reopened the review thread.');
            }}
            selectedPageId={selectedPageId}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.dtpParity),
        title: 'Print Production',
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperDtpParityPanel
            onRunParityAction={(target) => {
              if (target === 'spreads') {
                if (!document.view.showSpreads) toggleViewOption('showSpreads');
                setStatus('Showing facing-page spreads with gutter labels.');
                return;
              }
              if (target === 'linked-assets') {
                const first = collectPaperLinkedAssets(document, sourceItems)[0];
                if (first) selectPaperTarget({ pageNumber: first.pageNumber, frameId: first.frameId });
                setStatus(first ? 'Selected the first linked asset frame.' : 'No linked Paper image assets found.');
                return;
              }
              const first = preflightReport.issues[0];
              if (first) selectPaperTarget({ pageNumber: first.pageNumber, frameId: first.frameId });
              setStatus(first ? 'Selected the first preflight issue target.' : 'No Paper preflight issues detected.');
            }}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.findChange),
        title: 'Find / Change',
        allowedDockZones: ['right', 'left', 'bottom', 'overlay'],
        content: (
          <PaperFindChangePanel
            document={document}
            onReplaceAll={(query, replacement, options) => replaceAllInPaperText(query, replacement, options)}
            onSelectMatch={(target) => selectPaperTarget(target)}
          />
        ),
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.tiltmarkMaterial),
        title: 'Tiltmark Material',
        content: <TiltmarkMaterialDock />,
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.tiltmarkPalette),
        title: 'Tiltmark Smart Palette',
        content: <TiltmarkSmartPaletteDock />,
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.tiltmarkCare),
        title: 'Tiltmark Brush Care',
        content: <TiltmarkCareDock />,
      },
      {
        ...withDefault(PAPER_DOCKABLE_PANEL_IDS.tiltmarkSupply),
        title: 'Tiltmark Implement Supply',
        content: <TiltmarkSupplyDock />,
      },
    ];
  }, [addFrameToParentPage, addLayer, addPageFromPagesPanel, addParentPage, addReviewComment, addReviewReply, applyWritingPreview, assignParentPage, assignSelectionToLayer, chainSelectedBubbleWith, clearSelectedStyleLinks, clearSelectedStyleOverrides, copyActiveFrameStyle, deletePage, deleteReviewComment, document, duplicatePageFromPagesPanel, fitPaperViewport, generateAssistedLayoutPreview, generateWritingPreview, keyboardShortcuts, locale, moveLayer, moveSelectedBubbleInChain, openAssistedLayoutAsNewDocument, startLiveLayoutAgent, openComicSfxFrameDesigner, paperDockableDefaults, pasteCopiedFrameStyle, preflightReport, redefineSelectedStyle, renameLayer, replaceAllInPaperText, revealPaperPage, runFrameContextAction, runMenuCommand, selectFrameWithMode, selectPageFromPagesPanel, selectPaperTarget, selectedFrame, selectedFrameIds, selectedPage, selectedPageId, sendPaperGeneratedMediaPromptToFlow, setLayerLocked, setLayerPrintability, setLayerVisibility, setReviewCommentResolved, shortcutHelpLabels, sourceItems, status, styleClipboard, t, toggleViewOption, unchainBubble, updateDocumentSetup, updateFrame, updateSelectedFrame, writingProviderConfigurationKey, writingProviderOptions, writingSource]);
  const paperMobileRightPanels = useMemo<PaperMobileDrawerPanel[]>(() =>
    dockablePanels
      .filter((panel) => (
        panel.panelId !== PAPER_DOCKABLE_PANEL_IDS.linkedAssets
        && !PAPER_TILTMARK_PHYSICAL_PANEL_IDS.includes(
          panel.panelId as (typeof PAPER_TILTMARK_PHYSICAL_PANEL_IDS)[number],
        )
      ))
      .map((panel) => ({
        id: panel.panelId,
        title: panel.title,
        content: panel.content,
        defaultOpen: panel.panelId === PAPER_DOCKABLE_PANEL_IDS.inspector,
      })),
    [dockablePanels],
  );
  const paperMobileAssetsDrawer = useMemo(
    () => dockablePanels.find((panel) => panel.panelId === PAPER_DOCKABLE_PANEL_IDS.linkedAssets)?.content ?? null,
    [dockablePanels],
  );
  const visibleDockablePanels = showWorkspaceChrome && !usePaperPhoneShell ? dockablePanels : [];
  const effectiveSharedSourceBinCanvasOffsetClassName = showWorkspaceChrome && !usePaperPhoneShell ? sharedSourceBinCanvasOffsetClassName : '';
  const effectiveSharedSourceBinCanvasOffsetPx = showWorkspaceChrome && !usePaperPhoneShell ? sharedSourceBinCanvasOffsetPx : 0;

  const runPaperTopStripCommand = useCallback((command: NativeMenuCommand) => {
    recordActivityTrailWorkspaceEvent('paper', 'Run Paper top-strip command', command, 'toolbar');
    void runMenuCommand(command);
  }, [runMenuCommand]);

  const addPageFromTopStrip = useCallback(() => {
    addPage();
    revealPaperPage(usePaperStore.getState().selectedPageId);
    recordActivityTrailWorkspaceEvent('paper', 'Add Paper page', undefined, 'toolbar');
  }, [addPage, revealPaperPage]);

  const duplicatePageFromTopStrip = useCallback(() => {
    duplicatePage();
    revealPaperPage(usePaperStore.getState().selectedPageId);
    recordActivityTrailWorkspaceEvent('paper', 'Duplicate Paper page', undefined, 'toolbar');
  }, [duplicatePage, revealPaperPage]);

  const togglePaperViewOptionFromTopStrip = useCallback((option: Parameters<typeof toggleViewOption>[0], label: string) => {
    toggleViewOption(option);
    recordActivityTrailWorkspaceEvent('paper', 'Toggle Paper view option', label, 'toolbar');
  }, [toggleViewOption]);

  const togglePaperSnapFromTopStrip = useCallback((option: 'snapToGuides' | 'snapToGrid', label: string) => {
    const nextActive = option === 'snapToGuides' ? !document.view.snapToGuides : !document.view.snapToGrid;
    toggleViewOption(option);
    setStatus(`Paper ${label.toLowerCase()} ${nextActive ? 'enabled' : 'disabled'}.`);
    recordActivityTrailWorkspaceEvent('paper', 'Toggle Paper snap', label, 'toolbar');
  }, [document.view.snapToGrid, document.view.snapToGuides, setStatus, toggleViewOption]);

  const runPaperWorkspaceActionFromTopStrip = useCallback((label: string, action: () => void) => {
    recordActivityTrailWorkspaceEvent('paper', label, undefined, 'toolbar');
    action();
  }, []);

  return (
    <div
      className={`signal-loom-themed absolute inset-0 z-30 flex flex-col ${workspaceChromePaddingClassName}`}
      data-paper-page-count={document.pages.length}
      data-paper-title={document.title}
      data-signal-loom-paper-workspace="true"
    >
      {managedFontRegistration.blocked.length > 0 ? (
        <div aria-live="assertive" className="border-b border-rose-300/35 bg-rose-950/90 px-3 py-2 text-xs text-rose-100" data-paper-managed-font-blocked="true">
          Exact managed typography is blocked — no fallback face will be painted. {managedFontRegistration.blocked.map((entry) => entry.message).join(' ')}
        </div>
      ) : null}
      <input
        accept=".json,.sloom-paper.json,.sloom-idml.json,.idml,.txt,.md,.markdown,.rtf,.html,.htm,.docx,.pdf,application/json,text/plain,text/markdown,application/rtf,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.adobe.indesign-idml-package,application/vnd.signal-loom.paper-idml+json"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void handleImportFile(file);
        }}
        ref={fileInputRef}
        type="file"
      />
      {topbarSlot && showWorkspaceChrome ? createPortal(
        <PaperTopStrip
          docTitle={document.title}
          onAddPage={addPageFromTopStrip}
          onDuplicatePage={duplicatePageFromTopStrip}
          onExportPdf={() => runPaperTopStripCommand('paper:export-pdf')}
          onExportAccessiblePdf={() => runPaperTopStripCommand('paper:export-accessible-pdf')}
          onExportEpub={() => runPaperTopStripCommand('paper:export-epub')}
          onExportKdpAssets={() => runPaperTopStripCommand('paper:export-kdp-assets')}
          onExportKdpPdf={() => runPaperTopStripCommand('paper:export-kdp-pdf')}
          onOpenSoftProof={() => runPaperTopStripCommand('paper:soft-proof')}
          onExportReaderSpreadsPdf={() => runPaperTopStripCommand('paper:export-reader-spreads-pdf')}
          onExportBookletProofPdf={() => runPaperTopStripCommand('paper:export-booklet-proof-pdf')}
          onExportWebcomicImages={() => runPaperTopStripCommand('paper:export-webcomic-images')}
          onPackagePrint={() => runPaperTopStripCommand('paper:package-print')}
          onExportPageToImage={() => runPaperWorkspaceActionFromTopStrip('Open Paper page in Image', exportSelectedPageToImageWorkspace)}
          onExportPageToSource={() => runPaperWorkspaceActionFromTopStrip('Export Paper page to Source Library', exportSelectedPageToSourceLibrary)}
          onExportPagesToEnvelope={() => runPaperWorkspaceActionFromTopStrip('Export Paper pages to Source envelope', exportAllPagesToSourceEnvelope)}
          onExportJson={() => runPaperTopStripCommand('paper:export-json')}
          onFinalizePrintUpscale={() => runPaperWorkspaceActionFromTopStrip('Finalize Paper print upscale', finalizePaperPrintUpscaleAndPackage)}
          onExportIdml={() => runPaperTopStripCommand('paper:export-idml')}
          onExportStoriesTxt={() => runPaperTopStripCommand('paper:export-stories-txt')}
          onExportStoriesHtml={() => runPaperTopStripCommand('paper:export-stories-html')}
          onExportStoriesRtf={() => runPaperTopStripCommand('paper:export-stories-rtf')}
          onExportStoriesDocx={() => runPaperTopStripCommand('paper:export-stories-docx')}
          onExportCbz={() => runPaperTopStripCommand('paper:export-cbz')}
          onImportJson={() => runPaperTopStripCommand('paper:import-json')}
          onNew={() => runPaperTopStripCommand('paper:new-document')}
          onShowPreflight={showPreflightFromTopbar}
          showPreflight={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.preflight, { treatCollapsedAsShown: false })}
          onShowFindChange={() => runPaperWorkspaceActionFromTopStrip('Toggle Find / Change panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.findChange))}
          showFindChange={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.findChange, { treatCollapsedAsShown: false })}
          onToggleGrid={() => togglePaperViewOptionFromTopStrip('showGrid', 'Grid')}
          onToggleGuides={() => togglePaperViewOptionFromTopStrip('showGuides', 'Guides')}
          onToggleTextBaselines={() => togglePaperViewOptionFromTopStrip('showTextBaselines', 'Text baselines')}
          onToggleFrameEdges={() => togglePaperViewOptionFromTopStrip('showFrameEdges', 'Frame edges')}
          onToggleSnapToGrid={() => togglePaperSnapFromTopStrip('snapToGrid', 'snap to grid')}
          onToggleSnapToGuides={() => togglePaperSnapFromTopStrip('snapToGuides', 'snap to guides')}
          onToggleInspector={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Inspector panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.inspector))}
          onToggleRulers={() => togglePaperViewOptionFromTopStrip('showRulers', 'Rulers')}
          onToggleSpreads={() => runPaperTopStripCommand('paper:toggle-spreads')}
          onToggleStartOnRight={() => runPaperTopStripCommand('paper:toggle-start-on-right')}
          onToggleRtlBinding={() => runPaperTopStripCommand('paper:toggle-binding-direction')}
          onToggleToolbar={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Tools palette', togglePaperToolsPalette)}
          onTogglePages={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Pages panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.pages))}
          onToggleLayers={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Layers panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.layers))}
          onToggleStoryEditor={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Story Editor panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.storyEditor))}
          onToggleWritingAssistant={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Writing Assistant panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.writingAssistant))}
          onToggleAssistedLayout={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Assisted Layout panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.assistedLayout))}
          onToggleLiveLayoutAgent={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Live Layout Agent panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.liveLayoutAgent))}
          onToggleShortcutHelp={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Keyboard Shortcuts panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp))}
          onToggleLinkedAssets={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Linked Assets panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.linkedAssets))}
          onTogglePrintProduction={() => runPaperWorkspaceActionFromTopStrip('Toggle Paper Print Production panel', () => togglePanelVisibility(PAPER_DOCKABLE_PANEL_IDS.dtpParity))}
          onFitPage={() => fitPaperViewport('page')}
          onFitSpread={() => fitPaperViewport('spread')}
          onZoomActual={() => setZoom(1)}
          onZoomIn={() => setZoom(zoom + 0.1)}
          onZoomOut={() => setZoom(zoom - 0.1)}
          placement="titlebar"
          preflightStatus={preflightStatus}
          showInspector={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.inspector)}
          showGrid={document.view.showGrid}
          showGuides={document.view.showGuides}
          showTextBaselines={document.view.showTextBaselines}
          showFrameEdges={document.view.showFrameEdges}
          showRulers={document.view.showRulers}
          showSpreads={document.view.showSpreads}
          snapToGrid={document.view.snapToGrid}
          snapToGuides={document.view.snapToGuides}
          startOnRight={document.view.startOnRight}
          rtlBinding={effectiveRtlBinding(document)}
          showToolbar={paperToolsVisible}
          showPages={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.pages, { treatCollapsedAsShown: false })}
          showLayers={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.layers, { treatCollapsedAsShown: false })}
          showStoryEditor={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.storyEditor, { treatCollapsedAsShown: false })}
          showWritingAssistant={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.writingAssistant, { treatCollapsedAsShown: false })}
          showAssistedLayout={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.assistedLayout, { treatCollapsedAsShown: false })}
          showLiveLayoutAgent={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.liveLayoutAgent, { treatCollapsedAsShown: false })}
          showShortcutHelp={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.shortcutsHelp, { treatCollapsedAsShown: false })}
          showLinkedAssets={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.linkedAssets, { treatCollapsedAsShown: false })}
          showPrintProduction={isPanelVisible(PAPER_DOCKABLE_PANEL_IDS.dtpParity, { treatCollapsedAsShown: false })}
          zoom={zoom}
        />,
        topbarSlot,
      ) : null}
      <PaperFloatingToolsPalette
        collapsed={paperToolsCollapsed}
        leftInsetPx={paperFloatingToolsLeftInsetPx}
        onPositionChange={setPaperToolsPosition}
        onToggleCollapsed={() => setPaperToolsCollapsed(!paperToolsCollapsed)}
        position={paperToolsPosition}
        topInsetPx={paperFloatingToolsTopInsetPx}
        visible={paperToolsVisible || (mobilePhoneInterface.enabled && mobileChromeMode !== 'expanded')}
      >
        <PaperToolbar
          activeTool={tool}
          canPasteStyle={Boolean(styleClipboard)}
          collapsed={paperToolsCollapsed}
          colorPickersDisabled={!selectedFrame || selectedFrame.locked || Boolean(selectedFrame.inherited)}
          fillColor={selectedFrame?.fillColor ?? '#ffffff'}
          onAddFrame={addFrameForTool}
          onAddComicSfx={(presetId) => openComicSfxDesigner(presetId)}
          onCopy={() => runMenuCommand('edit:copy')}
          onCopyStyle={copyActiveFrameStyle}
          onCut={() => runMenuCommand('edit:cut')}
          onFillColorChange={(color) => updateSelectedFrame({ fillColor: color, fillGradient: undefined })}
          onPaste={() => runMenuCommand('edit:paste')}
          onPasteStyle={pasteCopiedFrameStyle}
          onOpenObjectLibrary={() => setObjectLibraryOpen(true)}
          onRedo={() => runMenuCommand('edit:redo')}
          onSetTool={setPaperToolFromToolbar}
          onStrokeColorChange={(color) => updateSelectedFrame({ strokeColor: color })}
          onUndo={() => runMenuCommand('edit:undo')}
          strokeColor={selectedFrame?.strokeColor ?? '#111827'}
        />
      </PaperFloatingToolsPalette>
      {objectLibraryOpen ? (
        <PaperObjectLibraryDialog
          onClose={() => setObjectLibraryOpen(false)}
          onInsert={insertObjectLibraryItem}
          selectedFrame={selectedFrame}
        />
      ) : null}
      <PaperTouchNavigationControl
        available={paperTouchNavigationAvailable}
        onToggleEnabled={togglePaperTouchNavigation}
        onToggleGesture={togglePaperTouchNavigationGesture}
        onTogglePanel={() => setTouchNavigationPanelOpen((open) => !open)}
        panelOpen={touchNavigationPanelOpen}
        settings={paperTouchNavigation}
      />
      {showWorkspaceChrome ? (
        <div
          className="shrink-0 transition-[margin] duration-200"
          style={{ marginLeft: effectiveSharedSourceBinCanvasOffsetPx }}
        >
          <PaperDocumentTabs />
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <PaperWorkspaceViewportHost
          activeEdgeDrawer={activePaperEdgeDrawer}
          assetsDrawer={paperMobileAssetsDrawer}
          className={`theme-surface min-w-0 flex-1 transition-[margin] duration-200 ${effectiveSharedSourceBinCanvasOffsetClassName}`}
          mobileTopbarHeightPx={mobilePhoneInterface.topbarHeightPx}
          onCloseEdgeDrawer={() => setActiveEdgeDrawer(null)}
          onToggleEdgeDrawer={toggleEdgeDrawer}
          panels={visibleDockablePanels}
          rightPanels={paperMobileRightPanels}
          sourceDrawer={<FlowSourceBinSidebar dockable embeddedDrawer workspaceId="paper" />}
          style={{ marginLeft: effectiveSharedSourceBinCanvasOffsetPx }}
          mobileChromeVisible={showWorkspaceChrome}
          usePhoneShell={usePaperPhoneShell}
          workspaceId={PAPER_DOCKABLE_WORKSPACE_ID}
        >
          <main
            className={`theme-surface h-full min-w-0 overflow-auto ${tool === 'hand' ? 'cursor-grab' : tool === 'eyedropper' ? 'cursor-crosshair' : ''}`}
            data-paper-scroll-container="true"
            data-paper-touch-navigation-active={paperTouchNavigationActive ? 'true' : 'false'}
            data-paper-touch-navigation-available={paperTouchNavigationAvailable ? 'true' : 'false'}
            ref={scrollContainerRef}
            style={{ touchAction: paperTouchNavigationActive ? 'none' : undefined }}
            onPointerCancelCapture={(event) => {
              if (finishPaperTouchNavigation(event)) return;
              finishWorkspacePan(event);
            }}
            onPointerDown={(event) => {
              if (event.currentTarget === event.target) {
                deselectFrames();
                setContextMenu(null);
              }
            }}
            onPointerDownCapture={(event) => {
              if (beginPaperTouchNavigation(event)) return;
              if (handlePaperEyedropperPointer(event)) return;
              beginWorkspacePan(event);
            }}
            onPointerMoveCapture={(event) => {
              if (updatePaperTouchNavigation(event)) return;
              updateWorkspacePan(event);
            }}
            onPointerUpCapture={(event) => {
              if (finishPaperTouchNavigation(event)) return;
              finishWorkspacePan(event);
            }}
            onScroll={(event) => updatePaperViewportFromElement(event.currentTarget)}
            onWheel={handleWorkspaceWheel}
            onDragOver={(event) => {
              if (
                event.dataTransfer.types.includes('application/x-flow-source-bin-item') ||
                hasPaperPageImageFileDrag(event.dataTransfer)
              ) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'copy';
              }
            }}
            onDrop={handleDropSourceItem}
          >
          <div className="flex min-h-full justify-start p-10">
            <div className="mx-auto space-y-10">
              {paperSpreads.map((spread) => {
                const virtualMetric = spreadVirtualMetricById.get(spread.id);
                if (virtualMetric && !virtualMetric.visible) {
                  return <PaperVirtualSpreadPlaceholder key={spread.id} metric={virtualMetric} />;
                }

                return document.view.showSpreads && spread.slots.length > 1 ? (
                  <PaperConnectedSpreadView
                    doc={document}
                    interaction={interaction}
                    key={spread.id}
                    onAddGuideToPage={addGuideToPage}
                    onBeginBubbleConnectorHandle={beginBubbleConnectorHandle}
                    onBeginBubbleHandle={beginBubbleHandle}
                    onBeginBubbleTextMove={beginBubbleTextMove}
                    onBeginBubbleTextResize={beginBubbleTextResize}
                    onBeginBubbleTextRotate={beginBubbleTextRotate}
                    onBeginCreate={beginCreateFrame}
                    onBeginGutterKnife={beginGutterKnife}
                    onBeginGuideMove={beginGuideMove}
                    onBeginImageCropPan={beginImageCropPan}
                    onBeginImageCropRotate={beginImageCropRotate}
                    onBeginImageCropScale={beginImageCropScale}
                    onBeginFrameVertexMove={beginFrameVertexMove}
                    onBeginFrameVertexInsert={beginFrameVertexInsert}
                    onDeleteFrameVertex={deleteFrameVertex}
                    onToggleImageFlip={toggleFrameImageFlip}
                    onBeginMove={beginMoveFrame}
                    onBeginResize={beginResizeFrame}
                    onBeginRotate={beginRotateFrame}
                    onDetachInheritedFrame={(pageId, frameId) => {
                      detachInheritedFrame(pageId, frameId);
                      setStatus('Detached inherited parent item as an editable page override.');
                    }}
                    onDropSourceItem={handleDropSourceItem}
                    onDropPaperPageImageImportFiles={handleDropPaperPageImageImportFiles}
                    onFinishInteraction={finishInteraction}
                    onInteractionMove={updateInteraction}
                    onOpenFrameMenu={(pageId, frameId, point, screen) => setContextMenu({
                      x: screen.x,
                      y: screen.y,
                      pageId,
                      frameId,
                      point,
                    })}
                    onOpenPageMenu={(pageId, point, screen) => setContextMenu({
                      x: screen.x,
                      y: screen.y,
                      pageId,
                      point,
                    })}
                    onPolygonPoint={(pageId, point) => {
                      if (tool !== 'shape') return;
                      selectPage(pageId);
                      selectFrame(null);
                      const pagePoints = polygonPoints
                        .filter((candidate) => candidate.pageId === pageId)
                        .map((candidate) => ({ xMm: candidate.xMm, yMm: candidate.yMm }));
                      const next = resolvePaperPolygonPointClick(pagePoints, point);

                      if (next.kind === 'close') {
                        const frameId = addPolygonShapeToPage(pageId, next.points);
                        if (frameId) {
                          setStatus(`Closed polygon shape with ${next.points.length} vertices.`);
                        }
                        setPolygonPoints((points) => points.filter((candidate) => candidate.pageId !== pageId));
                        return;
                      }

                      setPolygonPoints((points) => [
                        ...points.filter((candidate) => candidate.pageId !== pageId),
                        ...next.points.map((paperPoint) => ({ ...paperPoint, pageId })),
                      ]);
                      setStatus('Added polygon vertex. Click an existing vertex or press Enter after at least three points.');
                    }}
                    onResolveFrameImageNaturalSize={resolveFrameImageNaturalSize}
                    onSelectFrame={selectFrameFromPointer}
                    onSelectPage={selectPage}
                    onCommitFrameText={commitFrameText}
                    onUpdateGuide={updateGuide}
                    polygonPoints={polygonPoints}
                    selectedFrameId={selectedFrameId}
                    selectedFrameIds={selectedFrameIds}
                    selectedPageId={selectedPageId}
                    smartGuides={smartGuides}
                    spread={spread}
                    tool={tool}
                    vertexEditModifierActive={vertexEditModifierActive}
                    zoom={zoom}
                  />
                ) : (
                  <div className="flex items-start justify-center gap-3" data-paper-spread-view="true" key={spread.id}>
                    {spread.slots.map((slot) => (
                      <div className="flex items-start gap-0" key={`${spread.id}-${slot.side}`}>
                        {slot.page ? (
                          <PaperPageView
                            doc={document}
                            interaction={interaction}
                            isSelected={slot.page.id === selectedPageId}
                            onBeginCreate={beginCreateFrame}
                            onBeginGutterKnife={beginGutterKnife}
                            onBeginMove={beginMoveFrame}
                            onBeginResize={beginResizeFrame}
                            onBeginRotate={beginRotateFrame}
                            onBeginBubbleConnectorHandle={beginBubbleConnectorHandle}
                            onBeginBubbleHandle={beginBubbleHandle}
                            onBeginBubbleTextMove={beginBubbleTextMove}
                            onBeginBubbleTextResize={beginBubbleTextResize}
                            onBeginBubbleTextRotate={beginBubbleTextRotate}
                            onBeginGuideMove={beginGuideMove}
                            onBeginImageCropPan={beginImageCropPan}
                            onBeginImageCropRotate={beginImageCropRotate}
                            onBeginImageCropScale={beginImageCropScale}
                            onBeginFrameVertexMove={beginFrameVertexMove}
                            onBeginFrameVertexInsert={beginFrameVertexInsert}
                            onDeleteFrameVertex={deleteFrameVertex}
                            onToggleImageFlip={toggleFrameImageFlip}
                            onDropSourceItem={handleDropSourceItem}
                            onDropPaperPageImageImportFiles={handleDropPaperPageImageImportFiles}
                            onFinishInteraction={finishInteraction}
                            onAddGuideToPage={addGuideToPage}
                            onInteractionMove={updateInteraction}
                            onOpenFrameMenu={(frameId, point, screen) => setContextMenu({
                              x: screen.x,
                              y: screen.y,
                              pageId: slot.page?.id ?? '',
                              frameId,
                              point,
                            })}
                            onOpenPageMenu={(point, screen) => setContextMenu({
                              x: screen.x,
                              y: screen.y,
                              pageId: slot.page?.id ?? '',
                              point,
                            })}
                            onPolygonPoint={(point) => {
                              if (tool !== 'shape' || !slot.page) return;
                              selectPage(slot.page.id);
                              selectFrame(null);
                              const pagePoints = polygonPoints
                                .filter((candidate) => candidate.pageId === slot.page?.id)
                                .map((candidate) => ({ xMm: candidate.xMm, yMm: candidate.yMm }));
                              const next = resolvePaperPolygonPointClick(pagePoints, point);

                              if (next.kind === 'close') {
                                const frameId = addPolygonShapeToPage(slot.page.id, next.points);
                                if (frameId) {
                                  setStatus(`Closed polygon shape with ${next.points.length} vertices.`);
                                }
                                setPolygonPoints((points) => points.filter((candidate) => candidate.pageId !== slot.page?.id));
                                return;
                              }

                              setPolygonPoints((points) => [
                                ...points.filter((candidate) => candidate.pageId !== slot.page?.id),
                                ...next.points.map((paperPoint) => ({ ...paperPoint, pageId: slot.page?.id ?? '' })),
                              ]);
                              setStatus('Added polygon vertex. Click an existing vertex or press Enter after at least three points.');
                            }}
                            onResolveFrameImageNaturalSize={resolveFrameImageNaturalSize}
                            onSelectFrame={selectFrameFromPointer}
                            onSelectPage={() => slot.page && selectPage(slot.page.id)}
                            onCommitFrameText={commitFrameText}
                            onDetachInheritedFrame={(frameId) => {
                              if (!slot.page) return;
                              detachInheritedFrame(slot.page.id, frameId);
                              setStatus('Detached inherited parent item as an editable page override.');
                            }}
                            onUpdateGuide={updateGuide}
                            page={slot.page}
                            pageSideLabel={slot.label}
                            polygonPoints={polygonPoints.filter((point) => point.pageId === slot.page?.id)}
                            selectedFrameId={selectedFrameId}
                            selectedFrameIds={selectedFrameIds}
                            smartGuides={smartGuides}
                            tool={tool}
                            vertexEditModifierActive={vertexEditModifierActive}
                            zoom={zoom}
                          />
                        ) : (
                          <PaperBlankSpreadSlot doc={document} label={slot.label} zoom={zoom} />
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          </main>
        </PaperWorkspaceViewportHost>
      </div>
      {exportNotice ? (
        <PaperExportStatusNotice
          notice={exportNotice}
          onDismiss={() => setExportNotice(null)}
        />
      ) : null}
      {printUpscaleBusy ? (
        <PaperPrintUpscaleBusyIndicator job={printUpscaleBusy} />
      ) : null}
      {frameFixTarget ? (() => {
        const fixPage = document.pages.find((page) => page.id === frameFixTarget.pageId);
        const fixFrame = fixPage?.frames.find((frame) => frame.id === frameFixTarget.frameId);
        const fixSourceItem = sourceItems.find((item) => item.id === fixFrame?.asset?.sourceBinItemId);
        const fixImageUrl = resolvePaperFrameAssetUrl(fixFrame?.asset, fixSourceItem);
        if (!fixPage || !canFrameBeAiFixed(fixFrame) || !fixImageUrl) {
          return null;
        }
        return (
          <PaperFrameFixDialog
            frameLabel={fixFrame!.label || 'Image frame'}
            frameImageUrl={fixImageUrl}
            siblings={collectFrameFixSiblingCandidates(fixPage, frameFixTarget.frameId, sourceItems)}
            onApply={(resultDataUrl) => {
              void (async () => {
                const item = await addSourceAssetItem({
                  label: `${fixFrame!.label || 'Frame'} — AI fix`,
                  kind: 'image',
                  mimeType: 'image/png',
                  dataUrl: resultDataUrl,
                });
                placeSourceAssetAt({
                  item,
                  pageId: frameFixTarget.pageId,
                  targetFrameId: frameFixTarget.frameId,
                });
                setFrameFixTarget(null);
                setStatus('Applied the AI frame fix; the previous art stays in undo history.');
              })();
            }}
            onClose={() => setFrameFixTarget(null)}
          />
        );
      })() : null}
      {contextMenu ? (
        <PaperContextMenu
          bubbleChainActionsDisabled={bubbleChainActionsDisabled}
          context={contextMenu}
          frame={contextMenu.frameId
            ? document.pages.find((page) => page.id === contextMenu.pageId)?.frames.find((frame) => frame.id === contextMenu.frameId)
            : undefined}
          onApplyFrameAction={applyFrameMenuAction}
          onApplyPageAction={applyPageMenuAction}
          hasStyleClipboard={Boolean(styleClipboard)}
          onAddComicSfx={(presetId, pageId, point) => openComicSfxDesigner(presetId, pageId, point)}
          onClose={() => setContextMenu(null)}
          onChainSelectedBubbles={(style) => {
            const before = usePaperStore.getState().document;
            chainSelectedBubbles(style);
            setContextMenu(null);
            if (usePaperStore.getState().document === before) {
              setStatus('Could not link the bubbles. Select at least two unlocked, non-parent bubbles.');
              return;
            }
            setStatus(
              style === 'bridge'
                ? 'Merged the selected bubbles as one speaker.'
                : 'Linked the selected speech/thought bubbles.',
            );
          }}
          onCopyFrameStyle={() => {
            copyActiveFrameStyle();
            setContextMenu(null);
          }}
          onEditComicSfxFrame={openComicSfxFrameDesigner}
          onOpenImageFrame={openPaperFrameImageInImageWorkspace}
          onOpenImageFrameInHane={(pageId, frameId, frame) => {
            setContextMenu(null);
            void openPaperFrameImageInHane(pageId, frameId, frame);
          }}
          haneLinkedEditTarget={haneLinkedEdit.target}
          onQuickEditImageFrame={(pageId, frameId) => {
            setQuickEditTarget({ pageId, frameId });
            setContextMenu(null);
          }}
          onAiFixImageFrame={(pageId, frameId) => {
            setFrameFixTarget({ pageId, frameId });
            setContextMenu(null);
          }}
          onUpscaleFrameForPrint={(pageId, frame) => {
            if (!frame?.id) {
              setStatus('Select an image frame with a placed image before upscaling.');
              setContextMenu(null);
              return;
            }
            setPrintUpscaleTarget({ pageId, frameId: frame.id });
            setContextMenu(null);
          }}
          onFitFrameToText={(pageId, frameId) => {
            fitFrameToTextAction(pageId, frameId);
          }}
          onPlaceSourceInFrame={(pageId, frameId, item) => {
            placeSourceAssetAt({ item, pageId, targetFrameId: frameId });
            setContextMenu(null);
            setStatus(`Placed "${item.label}" into the frame.`);
          }}
          onPasteFrameStyle={() => {
            pasteCopiedFrameStyle();
            setContextMenu(null);
          }}
          onSendFrameSourceToVideo={sendPaperFrameSourceToVideo}
          onSendFrameSourceToFlow={sendPaperFrameSourceToFlow}
          onLocateFrameSourceInFlow={locatePaperFrameSourceInFlow}
          onSendPageToSourceLibrary={(pageId) => {
            setContextMenu(null);
            sendPaperPageToSourceLibraryById(pageId);
          }}
          onSendAllPagesToSourceLibrary={() => {
            setContextMenu(null);
            exportAllPagesToSourceEnvelope();
          }}
          onUnchainSelectedBubbles={() => {
            const before = usePaperStore.getState().document;
            unchainSelectedBubbles();
            setContextMenu(null);
            setStatus(usePaperStore.getState().document !== before
              ? 'Removed bubble chain links from selected bubbles.'
              : 'Could not edit the chain. Unlock every selected chain member first.');
          }}
          onThreadSelectedFrames={() => {
            threadSelectedFrames();
            setContextMenu(null);
            setStatus('Threaded the selected text frames — copy now flows between them.');
          }}
          onUnthreadSelectedFrames={() => {
            unthreadSelectedFrames();
            setContextMenu(null);
            setStatus('Removed text threading from the selected frames.');
          }}
          onAlignSelectedFrames={(edge) => {
            alignSelectedFrames(edge);
            setContextMenu(null);
            setStatus('Aligned the selected frames.');
          }}
          onDistributeSelectedFrames={(axis) => {
            distributeSelectedFrames(axis);
            setContextMenu(null);
            setStatus('Distributed the selected frames.');
          }}
          selectedBubbleCount={selectedBubbleCount}
          selectedTextFrameCount={selectedTextFrameCount}
          selectedFrameCount={selectedFrameCount}
          sourceItems={sourceItems}
        />
      ) : null}
      {haneBlankTarget ? (() => {
        const frame = document.pages
          .find((page) => page.id === haneBlankTarget.pageId)
          ?.frames.find((candidate) => candidate.id === haneBlankTarget.frameId);
        return frame?.kind === 'image' ? (
          <PaperHaneBlankImageDialog
            busy={haneBlankBusy}
            documentDpi={document.page.dpi}
            frame={frame}
            onCancel={() => {
              if (!haneBlankBusy) setHaneBlankTarget(null);
            }}
            onCreate={(spec) => void createBlankPaperFrameImageInHane(spec)}
          />
        ) : null;
      })() : null}
      {quickEditTarget ? (
        <PaperImageQuickEditDialog
          document={document}
          onClose={() => setQuickEditTarget(null)}
          onRun={runPaperImageQuickEdit}
          sourceItems={sourceItems}
          target={quickEditTarget}
        />
      ) : null}
      {printUpscaleTarget ? (
        <PaperPrintUpscaleDialog
          apiKeys={apiKeys}
          document={document}
          onClose={() => setPrintUpscaleTarget(null)}
          onMethodChange={(method) => setProviderSetting('paperPrintUpscaleMethod', method)}
          onRun={async (input) => {
            const page = document.pages.find((candidate) => candidate.id === input.pageId);
            const frame = page?.frames.find((candidate) => candidate.id === input.frameId);
            upscalePaperFrameImageForPrint(input.pageId, frame, {
              method: input.method,
              stabilityCreativity: input.stabilityCreativity,
              stabilityPrompt: input.stabilityPrompt,
            });
            setPrintUpscaleTarget(null);
          }}
          providerSettings={providerSettings}
          sourceItems={sourceItems}
          target={printUpscaleTarget}
        />
      ) : null}
      {comicSfxDesigner ? (
        <ComicSfxDesigner
          initialDesign={comicSfxDesigner.initialDesign}
          initialPresetId={comicSfxDesigner.presetId}
          onClose={() => setComicSfxDesigner(null)}
          onPlace={placeComicSfxDesign}
        />
      ) : null}
      {webcomicExportOpen ? (
        <PaperWebcomicExportDialog
          document={document}
          initialSettings={webcomicExportSettings}
          onClose={() => setWebcomicExportOpen(false)}
          onExport={runWebcomicImageExport}
        />
      ) : null}
      {kdpExportOpen ? (
        <PaperKdpExportDialog
          document={document}
          initialSettings={kdpExportSettings}
          onClose={() => setKdpExportOpen(false)}
          onExport={runKdpImageExport}
          pendingPrintUpscaleCount={collectPaperPrintUpscaleFrameJobs(document, sourceItems).length}
        />
      ) : null}
      {softProofOpen ? (
        <PaperSoftProofModal
          document={document}
          onClose={() => setSoftProofOpen(false)}
          onConfigureProfile={applyManagedIccProfileChange}
          pageId={selectedPage.id}
        />
      ) : null}
    </div>
  );
}

function clearPaperPrintUpscaleBusyAfterMinimum(
  setPrintUpscaleBusy: (state: PaperPrintUpscaleBusyState | null) => void,
  startedAt: number,
) {
  const remainingMs = Math.max(0, 650 - (Date.now() - startedAt));
  window.setTimeout(() => setPrintUpscaleBusy(null), remainingMs);
}

const PAPER_PRINT_UPSCALED_ASPECT_RATIO_TOLERANCE = 0.0008;

function parsePaperPrintUpscaleSourceItemId(sourceKey: string | undefined): string | undefined {
  if (!sourceKey?.startsWith('paper-print-upscale:')) {
    return undefined;
  }

  const sourceKeyBody = sourceKey.slice('paper-print-upscale:'.length);
  const sourceItemIdEnd = sourceKeyBody.indexOf(':');
  if (sourceItemIdEnd <= 0) {
    return undefined;
  }

  return sourceKeyBody.slice(0, sourceItemIdEnd);
}

function isPositivePixelDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPaperPrintUpscaledImageAspectMatch(input: {
  upscaledWidthPx: unknown;
  upscaledHeightPx: unknown;
  sourceWidthPx: unknown;
  sourceHeightPx: unknown;
}): boolean {
  if (
    !isPositivePixelDimension(input.upscaledWidthPx)
    || !isPositivePixelDimension(input.upscaledHeightPx)
    || !isPositivePixelDimension(input.sourceWidthPx)
    || !isPositivePixelDimension(input.sourceHeightPx)
  ) {
    return true;
  }

  const upscaledAspect = input.upscaledWidthPx / input.upscaledHeightPx;
  const sourceAspect = input.sourceWidthPx / input.sourceHeightPx;
  const relativeDelta = Math.abs(upscaledAspect - sourceAspect) / Math.max(upscaledAspect, sourceAspect);
  return relativeDelta <= PAPER_PRINT_UPSCALED_ASPECT_RATIO_TOLERANCE;
}

function loadPaperKdpExportSettings(): PaperKdpExportSettings {
  try {
    const raw = globalThis.localStorage?.getItem(PAPER_KDP_EXPORT_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_PAPER_KDP_EXPORT_SETTINGS;
    return normalizePaperKdpExportSettings({
      ...DEFAULT_PAPER_KDP_EXPORT_SETTINGS,
      ...JSON.parse(raw),
    });
  } catch {
    return DEFAULT_PAPER_KDP_EXPORT_SETTINGS;
  }
}

function persistPaperKdpExportSettings(settings: PaperKdpExportSettings): void {
  try {
    globalThis.localStorage?.setItem(PAPER_KDP_EXPORT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Persistence is a convenience; export must still work when storage is unavailable.
  }
}

function defaultPaperToolsPalettePosition(): PaperToolsPalettePosition {
  // On narrow viewports the centered artboard fills the width, so the roomy desktop default (x:368)
  // lands on the page itself. Anchor flush-left there (in the ruler/margin gutter) so it doesn't
  // cover the artboard; keep the desktop position where there's pasteboard to the left.
  if (typeof window !== 'undefined' && window.innerWidth < 1024) {
    return { x: PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN, y: 96 };
  }
  return PAPER_TOOLS_PALETTE_DEFAULT_POSITION;
}

function loadPaperToolsPalettePosition(): PaperToolsPalettePosition {
  const fallback = defaultPaperToolsPalettePosition();
  try {
    const raw = globalThis.localStorage?.getItem(PAPER_TOOLS_PALETTE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return clampPaperToolsPalettePosition({
      x: typeof parsed?.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : fallback.x,
      y: typeof parsed?.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : fallback.y,
    });
  } catch {
    return fallback;
  }
}

function persistPaperToolsPalettePosition(position: PaperToolsPalettePosition): void {
  try {
    globalThis.localStorage?.setItem(PAPER_TOOLS_PALETTE_STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Palette position is non-critical UI state.
  }
}

function clampPaperToolsPalettePosition(
  position: PaperToolsPalettePosition,
  size: { width: number; height: number } = { width: 96, height: 560 },
  options: { leftInsetPx?: number; rightInsetPx?: number; topInsetPx?: number } = {},
): PaperToolsPalettePosition {
  if (typeof window === 'undefined') {
    return {
      x: Math.round(position.x),
      y: Math.round(position.y),
    };
  }

  const margin = PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN;
  const minX = Math.max(margin, Math.round(options.leftInsetPx ?? margin));
  const rightInset = Math.max(margin, Math.round(options.rightInsetPx ?? margin));
  const minY = Math.max(margin, Math.round(options.topInsetPx ?? margin));
  const width = Math.max(1, Math.round(size.width));
  const height = Math.max(1, Math.round(size.height));
  const maxX = Math.max(minX, window.innerWidth - width - rightInset);
  const maxY = Math.max(minY, window.innerHeight - height - margin);
  return {
    x: clamp(Math.round(position.x), minX, maxX),
    y: clamp(Math.round(position.y), minY, maxY),
  };
}

function normalizePaperKdpExportSettings(
  settings: Partial<PaperKdpExportSettings>,
  document?: Pick<PaperDocument, 'page'>,
): PaperKdpExportSettings {
  const dpi = typeof settings.dpi === 'number' && Number.isFinite(settings.dpi)
    ? Math.max(72, Math.round(settings.dpi))
    : document?.page.dpi ?? DEFAULT_PAPER_KDP_EXPORT_SETTINGS.dpi;
  const interiorType: PaperKdpInteriorType = settings.interiorType === 'black-and-white' || settings.interiorType === 'standard-color'
    ? settings.interiorType
    : 'premium-color';
  const paperType: PaperKdpPaperType = settings.paperType === 'cream' ? 'cream' : 'white';
  const spineWidthMm = typeof settings.spineWidthMm === 'number' && Number.isFinite(settings.spineWidthMm) && settings.spineWidthMm > 0
    ? Number(settings.spineWidthMm.toFixed(4))
    : undefined;
  const spineFillColor = typeof settings.spineFillColor === 'string' && /^#[0-9a-f]{6}$/i.test(settings.spineFillColor)
    ? settings.spineFillColor
    : DEFAULT_PAPER_KDP_EXPORT_SETTINGS.spineFillColor;

  return {
    dpi,
    interiorType,
    paperType,
    spineWidthMm,
    spineFillColor,
    directoryName: typeof settings.directoryName === 'string' ? settings.directoryName : '',
    allowPreflightErrors: Boolean(settings.allowPreflightErrors),
  };
}

function PaperExportStatusNotice({
  notice,
  onDismiss,
}: {
  notice: PaperExportNoticeState;
  onDismiss: () => void;
}) {
  const nativeBridge = getSignalLoomNativeBridge();
  const openTarget = () => {
    if (!notice.path || !nativeBridge?.openPath) return;
    void nativeBridge.openPath(notice.path);
  };
  const tone = notice.state === 'error'
    ? 'border-rose-300/45 bg-rose-950/95 text-rose-50'
    : notice.state === 'canceled'
      ? 'border-slate-500/60 bg-slate-950/95 text-slate-100'
      : notice.state === 'success'
        ? 'border-emerald-300/40 bg-emerald-950/95 text-emerald-50'
        : 'border-cyan-300/40 bg-[#071522]/95 text-cyan-50';

  return (
    <div
      aria-live="polite"
      className={`absolute right-6 top-20 z-[95] w-[min(32rem,calc(100vw-3rem))] rounded-lg border px-4 py-3 shadow-2xl backdrop-blur ${tone}`}
      data-paper-export-status="true"
      role="status"
    >
      <div className="flex items-start gap-3">
        {notice.state === 'busy' ? <Loader2 className="mt-0.5 shrink-0 animate-spin" size={19} /> : null}
        {notice.state === 'success' ? <ShieldCheck className="mt-0.5 shrink-0" size={19} /> : null}
        {notice.state === 'error' ? <AlertTriangle className="mt-0.5 shrink-0" size={19} /> : null}
        {notice.state === 'canceled' ? <X className="mt-0.5 shrink-0" size={19} /> : null}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em]">
            {notice.state === 'busy'
              ? 'Exporting'
              : notice.state === 'success'
                ? 'Export complete'
                : notice.state === 'error'
                  ? 'Export failed'
                  : 'Export canceled'}
          </div>
          <div className="mt-1 break-words text-sm leading-5 text-current/85">{notice.message}</div>
          {notice.path ? (
            <div className="mt-2 break-all rounded bg-black/20 px-2.5 py-2 font-mono text-[11px] leading-4 text-current/75">
              {notice.path}
            </div>
          ) : null}
          {notice.path && nativeBridge?.openPath ? (
            <button
              className="mt-3 inline-flex items-center gap-2 rounded border border-current/25 bg-white/10 px-3 py-1.5 text-xs font-semibold transition hover:bg-white/20"
              onClick={openTarget}
              type="button"
            >
              <Download size={14} />
              {notice.targetKind === 'directory' ? 'Open folder' : 'Open PDF'}
            </button>
          ) : null}
        </div>
        {notice.state !== 'busy' ? (
          <button
            aria-label="Dismiss export status"
            className="rounded p-1 text-current/60 transition hover:bg-white/10 hover:text-current"
            onClick={onDismiss}
            type="button"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaperPrintUpscaleBusyIndicator({ job }: { job: PaperPrintUpscaleBusyState }) {
  const cloud = job.provider === 'vertex-imagen'
    || job.provider === 'stability-fast'
    || job.provider === 'stability-conservative';
  const hasProgress = typeof job.current === 'number'
    && typeof job.total === 'number'
    && job.total > 0;
  const progressPercent = hasProgress
    ? Math.max(0, Math.min(100, (job.current! / job.total!) * 100))
    : 0;

  return (
    <div
      aria-live="polite"
      className={`absolute right-6 top-20 z-[90] flex max-w-[min(28rem,calc(100vw-3rem))] items-start gap-3 rounded-md border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
        cloud
          ? 'border-sky-300/45 bg-sky-950/90 text-sky-50'
          : 'border-cyan-300/30 bg-[#08111d]/90 text-cyan-50'
      }`}
      role="status"
    >
      <Loader2 className="shrink-0 animate-spin" size={18} />
      <div className="min-w-0">
        <div className="truncate font-semibold">{job.title}</div>
        <div className={cloud ? 'break-words text-xs text-sky-100/75' : 'break-words text-xs text-cyan-100/60'}>
          {job.detail}
        </div>
        {hasProgress ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={cloud ? 'h-full rounded-full bg-sky-300' : 'h-full rounded-full bg-cyan-300'}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaperPrintUpscaleDialog({
  apiKeys,
  document,
  onClose,
  onMethodChange,
  onRun,
  providerSettings,
  sourceItems,
  target,
}: {
  apiKeys: ApiKeys;
  document: PaperDocument;
  onClose: () => void;
  onMethodChange: (method: PaperPrintUpscaleMethod) => void;
  onRun: (input: {
    frameId: string;
    method: PaperPrintUpscaleMethod;
    pageId: string;
    stabilityCreativity?: number;
    stabilityPrompt?: string;
  }) => void;
  providerSettings: ProviderSettings;
  sourceItems: SourceBinLibraryItem[];
  target: { pageId: string; frameId: string };
}) {
  const [method, setMethod] = useState<PaperPrintUpscaleMethod>(providerSettings.paperPrintUpscaleMethod);
  const [prompt, setPrompt] = useState(DEFAULT_PAPER_PRINT_UPSCALE_PROMPT);
  const [creativity, setCreativity] = useState(0.35);
  const [error, setError] = useState<string | null>(null);
  const androidUpscalerId = providerSettings.androidAcceleratorDefaultUpscaler?.trim() || 'upscaler_realistic';
  const [androidAvailability, setAndroidAvailability] = useState<{
    available?: boolean;
    key: string;
    reason?: string;
  }>({ key: '' });
  const frame = document.pages
    .find((page) => page.id === target.pageId)
    ?.frames.find((candidate) => candidate.id === target.frameId);
  const sourceItem = sourceItems.find((item) => item.id === frame?.asset?.sourceBinItemId);
  const sourceUrl = usePaperAssetUrl(frame?.asset, sourceItem);
  const sourceWidthPx = frame?.asset?.pixelWidth ?? sourceItem?.pixelWidth ?? 1;
  const sourceHeightPx = frame?.asset?.pixelHeight ?? sourceItem?.pixelHeight ?? 1;
  const vertexConfig = getVertexProjectConfig(providerSettings);
  const vertexAvailable = providerSettings.geminiCredentialMode === 'vertex-adc'
    && Boolean(vertexConfig.projectId)
    && Boolean(getSignalLoomNativeBridge()?.generateVertexImage);
  const androidConfigured = isAndroidAcceleratorConfigured(providerSettings);
  const shouldCheckAndroid = androidConfigured && (method === 'auto' || method === 'android-accelerator');
  const androidCheckKey = shouldCheckAndroid
    ? [
        providerSettings.androidAcceleratorBaseUrl ?? '',
        providerSettings.androidAcceleratorAuthToken ?? '',
        androidUpscalerId,
      ].join('\n')
    : '';
  useEffect(() => {
    if (!androidCheckKey) {
      return undefined;
    }

    let cancelled = false;
    void getAndroidAcceleratorStatus({
      baseUrl: providerSettings.androidAcceleratorBaseUrl ?? '',
      authToken: providerSettings.androidAcceleratorAuthToken,
    }).then((status) => {
      if (cancelled) return;
      const availability = resolveAndroidUpscalerAvailability(status, androidUpscalerId);
      setAndroidAvailability({
        available: availability.available,
        key: androidCheckKey,
        reason: availability.reason,
      });
    }).catch((caught) => {
      if (cancelled) return;
      const detail = caught instanceof Error && caught.message
        ? ` ${caught.message}`
        : '';
      setAndroidAvailability({
        available: false,
        key: androidCheckKey,
        reason: `Android accelerator is not reachable. Confirm the phone server is running, both devices are on the same LAN, and the pairing token matches.${detail}`,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    androidCheckKey,
    androidConfigured,
    androidUpscalerId,
    method,
    providerSettings.androidAcceleratorAuthToken,
    providerSettings.androidAcceleratorBaseUrl,
    shouldCheckAndroid,
  ]);
  const strictPrintDocument = document.page.dpi >= 300
    ? document
    : { ...document, page: { ...document.page, dpi: 300 } };
  const targetPlan = frame
    ? resolvePaperPrintUpscaleTarget(strictPrintDocument, frame, {
        widthPx: sourceWidthPx,
        heightPx: sourceHeightPx,
      })
    : undefined;
  const plan = targetPlan
    ? resolvePaperPrintUpscalePlan({
        method,
        target: targetPlan,
        stabilityAvailable: Boolean(apiKeys.stability?.trim()),
        vertexAvailable,
        androidAcceleratorAvailable: androidConfigured,
        localAiAvailable: isLocalCpuUpscalerConfigured(providerSettings),
      })
    : undefined;
  const checkingAndroidProvider = Boolean(plan?.provider === 'android-accelerator' && androidCheckKey && androidAvailability.key !== androidCheckKey);
  const androidUnavailableReason = plan?.provider === 'android-accelerator' && androidAvailability.available === false
    ? androidAvailability.reason ?? 'Android accelerator is not ready.'
    : undefined;
  const submitDisabled = !plan?.canRun || checkingAndroidProvider || Boolean(androidUnavailableReason);
  const sourceMegapixels = (sourceWidthPx * sourceHeightPx) / 1_000_000;
  const targetMegapixels = targetPlan ? (targetPlan.targetWidthPx * targetPlan.targetHeightPx) / 1_000_000 : 0;
  const costLabel = plan?.estimatedCostUsd === undefined
    ? plan?.costLabel ?? 'unknown'
    : plan.estimatedCostUsd <= 0
      ? 'Free'
      : `$${plan.estimatedCostUsd.toFixed(2)}`;

  const changeMethod = (value: string) => {
    const nextMethod = value as PaperPrintUpscaleMethod;
    setMethod(nextMethod);
    onMethodChange(nextMethod);
    setError(null);
  };

  const submit = async () => {
    if (!frame?.asset || !plan) {
      setError('The selected image frame is no longer available.');
      return;
    }
    if (!plan.canRun) {
      setError(plan.unavailableReason ?? 'The selected print upscaler is not configured.');
      return;
    }
    if (checkingAndroidProvider) {
      return;
    }
    if (androidUnavailableReason) {
      setError(androidUnavailableReason);
      return;
    }
    if (plan.estimatedCostUsd && plan.estimatedCostUsd > 0) {
      const accepted = shouldBypassConfirmations() || await useConfirmationStore.getState().requestConfirmation(
        `Upscale this image with ${describePaperPrintUpscaleBusyProvider(plan.provider)} for an estimated $${plan.estimatedCostUsd.toFixed(2)}?`,
        'Print Upscale'
      );
      if (!accepted) return;
    }
    onRun({
      frameId: target.frameId,
      method,
      pageId: target.pageId,
      stabilityCreativity: method === 'stability-conservative' ? creativity : undefined,
      stabilityPrompt: prompt.trim() || DEFAULT_PAPER_PRINT_UPSCALE_PROMPT,
    });
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl rounded-md border border-cyan-300/20 bg-[#0b121d] p-4 text-cyan-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-300/10 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Maximize2 size={16} />
              Print Image Upscale
            </div>
            <div className="mt-1 truncate text-xs text-cyan-100/45">
              {frame?.asset?.label ?? 'Selected image'} · {strictPrintDocument.page.dpi} PPI print target
            </div>
          </div>
          <button
            className="rounded p-1 text-cyan-100/45 hover:bg-cyan-400/10 hover:text-white"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {frame?.asset && targetPlan && plan ? (
          <div className="mt-4 grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="overflow-hidden rounded border border-cyan-300/10 bg-slate-950">
                {sourceUrl ? (
                  <img
                    alt={frame.asset.label}
                    className="h-40 w-full object-contain"
                    src={sourceUrl}
                  />
                ) : null}
              </div>
              <div className="rounded border border-cyan-300/10 bg-[#10131b] p-3 text-[11px] leading-5 text-cyan-100/65">
                <div>Source: {sourceWidthPx} x {sourceHeightPx}px ({sourceMegapixels.toFixed(2)} MP)</div>
                <div>Target: {targetPlan.targetWidthPx} x {targetPlan.targetHeightPx}px ({targetMegapixels.toFixed(2)} MP)</div>
                <div>Scale: {targetPlan.scaleFactor.toFixed(2)}x{targetPlan.capped ? ' (capped)' : ''}</div>
              </div>
            </div>

            <div className="space-y-3">
              <Field label="Upscaling method">
                <select
                  className="paper-input"
                  onChange={(event) => changeMethod(event.target.value)}
                  value={method}
                >
                  {PAPER_PRINT_UPSCALE_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Provider</div>
                  <div className="mt-1 text-xs text-cyan-50">{describePaperPrintUpscaleBusyProvider(plan.provider)}</div>
                </div>
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Estimate</div>
                  <div className="mt-1 text-xs text-cyan-50">{costLabel}</div>
                </div>
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Output</div>
                  <div className="mt-1 text-xs text-cyan-50">
                    {isPaperStabilityUpscaleProvider(plan.provider)
                      ? 'Provider-reported pixels'
                      : plan.usesLocalFinalFit
                        ? 'Exact local DPI fit'
                        : 'Provider/local output'}
                  </div>
                </div>
              </div>

              {method === 'stability-conservative' ? (
                <>
                  <Field label="Conservative prompt">
                    <textarea
                      className="paper-input min-h-24 resize-y"
                      onChange={(event) => setPrompt(event.target.value)}
                      value={prompt}
                    />
                  </Field>
                  <Field label={`Creativity ${creativity.toFixed(2)}`}>
                    <input
                      className="w-full accent-cyan-300"
                      max={0.5}
                      min={0.2}
                      onChange={(event) => setCreativity(Number(event.target.value))}
                      step={0.01}
                      type="range"
                      value={creativity}
                    />
                  </Field>
                </>
              ) : null}

              {!plan.canRun || error || androidUnavailableReason ? (
                <>
                  <div className="rounded border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {error ?? androidUnavailableReason ?? plan.unavailableReason}
                  </div>
                  {!plan.canRun ? (
                    <div className="rounded border border-cyan-300/15 bg-cyan-300/5 px-3 py-2 text-xs leading-5 text-cyan-100/70">
                      To upscale locally, run a compatible external local AI endpoint yourself and paste its URL
                      and token under Settings → Providers, or use the Android accelerator.
                    </div>
                  ) : null}
                </>
              ) : checkingAndroidProvider ? (
                <div className="rounded border border-cyan-300/10 bg-cyan-300/5 px-3 py-2 text-xs leading-5 text-cyan-100/70">
                  Checking Android accelerator readiness before sending this image to the phone...
                </div>
              ) : (
                <div className="rounded border border-cyan-300/10 bg-cyan-300/5 px-3 py-2 text-xs leading-5 text-cyan-100/60">
                  {plan.notes.join(' ')}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                  onClick={onClose}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
                  disabled={submitDisabled}
                  onClick={submit}
                  type="button"
                >
                  <Maximize2 size={14} />
                  Upscale and Replace Frame
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            The selected Paper image frame is no longer available.
          </div>
        )}
      </div>
    </div>
  );
}

function PaperImageQuickEditDialog({
  document,
  onClose,
  onRun,
  sourceItems,
  target,
}: {
  document: PaperDocument;
  onClose: () => void;
  onRun: (input: {
    abortSignal?: AbortSignal;
    frameId: string;
    pageId: string;
    prompt: string;
    provider: GenerativeFillProvider;
  }) => Promise<void>;
  sourceItems: SourceBinLibraryItem[];
  target: { pageId: string; frameId: string };
}) {
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<GenerativeFillProvider>('gemini');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const targetInfo = useMemo(() => {
    try {
      return { value: resolvePaperImageQuickEditTarget({ document, pageId: target.pageId, frameId: target.frameId, sourceItems }) };
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : 'This Paper image cannot be quick-edited.' };
    }
  }, [document, sourceItems, target.frameId, target.pageId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const defaultModels = useSettingsStore(s => s.defaultModels.image);
  const defaultModel = provider !== 'generic' ? defaultModels[provider] : undefined;
  const estimate = estimateGenerativeFillCostUsd(provider, defaultModel, undefined, prompt.trim());
  const estimateLabel = provider === 'localOpen' || provider === 'generic'
    ? 'provider-defined'
    : `~$${estimate.toFixed(3)}`;

  const submit = async () => {
    if (!prompt.trim() || running || !targetInfo.value) return;
    const currentEstimate = estimateGenerativeFillCostUsd(provider, defaultModel, undefined, prompt.trim());
    if (currentEstimate > 0.5 && !(shouldBypassConfirmations() || await useConfirmationStore.getState().requestConfirmation(
      `This edit is estimated at $${currentEstimate.toFixed(3)}. Continue?`,
      'Budget Confirmation'
    ))) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      await onRun({
        abortSignal: controller.signal,
        frameId: target.frameId,
        pageId: target.pageId,
        prompt: prompt.trim(),
        provider,
      });
      onClose();
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'Paper image quick edit failed.');
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    if (!running) onClose();
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-md border border-cyan-300/20 bg-[#0b121d] p-4 text-cyan-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-300/10 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Sparkles size={16} />
              Paper Image Quick Edit
            </div>
            <div className="mt-1 truncate text-xs text-cyan-100/45">
              {targetInfo.value?.sourceItem.label ?? targetInfo.error}
            </div>
          </div>
          <button
            className="rounded p-1 text-cyan-100/45 hover:bg-cyan-400/10 hover:text-white"
            disabled={running}
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        {targetInfo.value ? (
          <div className="mt-4 grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="overflow-hidden rounded border border-cyan-300/10 bg-slate-950">
              <img
                alt={targetInfo.value.sourceItem.label}
                className="h-36 w-full object-contain"
                src={targetInfo.value.sourceUrl}
              />
            </div>
            <div className="space-y-3">
              <Field label="Edit">
                <textarea
                  autoFocus
                  className="paper-input min-h-24 resize-y"
                  disabled={running}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault();
                      void submit();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancel();
                    }
                  }}
                  placeholder="Example: make the lighting warmer, remove the extra hand, change the jacket to red..."
                  value={prompt}
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <Field label="Provider">
                  <select
                    className="paper-input"
                    disabled={running}
                    onChange={(event) => setProvider(event.target.value as GenerativeFillProvider)}
                    value={provider}
                  >
                    {PAPER_IMAGE_QUICK_EDIT_PROVIDERS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Estimate">
                  <div className="flex h-8 items-center rounded border border-cyan-300/10 bg-[#10131b] px-2 text-xs text-cyan-100/60">
                    {estimateLabel}
                  </div>
                </Field>
              </div>
              {error ? (
                <div className="rounded border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                  {error}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white disabled:opacity-50"
                  onClick={cancel}
                  type="button"
                >
                  {running ? 'Cancel Run' : 'Cancel'}
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-50"
                  disabled={running || !prompt.trim()}
                  onClick={() => void submit()}
                  type="button"
                >
                  {running ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
                  Apply Edit
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded border border-rose-300/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
            {targetInfo.error}
          </div>
        )}
      </div>
    </div>
  );
}

function PaperKdpExportDialog({
  document,
  initialSettings,
  onClose,
  onExport,
  pendingPrintUpscaleCount,
}: {
  document: PaperDocument;
  initialSettings: PaperKdpExportSettings;
  onClose: () => void;
  onExport: (settings: PaperKdpExportSettings) => void;
  pendingPrintUpscaleCount: number;
}) {
  const [settings, setSettings] = useState<PaperKdpExportSettings>(() => normalizePaperKdpExportSettings(initialSettings, document));
  const normalizedSettings = normalizePaperKdpExportSettings(settings, document);
  const plan = buildPaperKdpExportPlan(document, normalizedSettings);
  const blockingWarnings = plan.warnings.filter((warning) => warning.severity === 'error');
  const exportBlockedByKdp = blockingWarnings.length > 0 && !normalizedSettings.allowPreflightErrors;
  const exportBlockedByUpscale = pendingPrintUpscaleCount > 0;
  const canExport = !exportBlockedByUpscale && !exportBlockedByKdp;
  const estimatedSpineWidthMm = Number((plan.interiorPageCount * getKdpSpinePageThicknessMm(
    normalizedSettings.interiorType,
    normalizedSettings.paperType,
  )).toFixed(4));
  const update = (patch: Partial<PaperKdpExportSettings>) => {
    setSettings((current) => normalizePaperKdpExportSettings({ ...current, ...patch }, document));
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-md border border-cyan-300/20 bg-[#0b121d] text-cyan-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-300/10 p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <BookOpen size={16} />
              KDP Comic Assets
            </div>
            <div className="mt-1 text-xs text-cyan-100/45">
              {plan.interiorPageCount} interior page{plan.interiorPageCount === 1 ? '' : 's'} · {plan.dpi} DPI · {plan.coverWrap.widthPx} x {plan.coverWrap.heightPx}px cover wrap
            </div>
          </div>
          <button
            className="rounded p-1 text-cyan-100/45 hover:bg-cyan-400/10 hover:text-white"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Output DPI">
                  <input
                    className="paper-input"
                    min={72}
                    onChange={(event) => update({ dpi: Number(event.target.value) })}
                    step={1}
                    type="number"
                    value={normalizedSettings.dpi}
                  />
                </Field>
                <Field label="Directory name">
                  <input
                    className="paper-input"
                    onChange={(event) => update({ directoryName: event.target.value })}
                    placeholder={`${document.title || 'paper-document'} KDP assets`}
                    type="text"
                    value={settings.directoryName}
                  />
                </Field>
                <Field label="Interior type">
                  <select
                    className="paper-input"
                    onChange={(event) => update({ interiorType: event.target.value as PaperKdpInteriorType })}
                    value={normalizedSettings.interiorType}
                  >
                    <option value="premium-color">Premium color</option>
                    <option value="standard-color">Standard color</option>
                    <option value="black-and-white">Black and white</option>
                  </select>
                </Field>
                <Field label="Paper">
                  <select
                    className="paper-input"
                    onChange={(event) => update({ paperType: event.target.value as PaperKdpPaperType })}
                    value={normalizedSettings.paperType}
                  >
                    <option value="white">White paper</option>
                    <option value="cream">Cream paper</option>
                  </select>
                </Field>
                <Field label="Spine width mm">
                  <input
                    className="paper-input"
                    min={0}
                    onChange={(event) => {
                      const next = event.target.value.trim();
                      update({ spineWidthMm: next ? Number(next) : undefined });
                    }}
                    placeholder={estimatedSpineWidthMm.toFixed(4)}
                    step={0.0001}
                    type="number"
                    value={normalizedSettings.spineWidthMm ?? ''}
                  />
                </Field>
                <Field label="Spine fill">
                  <AdvancedColorPicker
                    className="h-9 w-full"
                    buttonClassName="paper-input"
                    label="Spine fill color"
                    onChange={(color) => update({ spineFillColor: color })}
                    value={normalizedSettings.spineFillColor}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Interior Page</div>
                  <div className="mt-1 text-xs text-cyan-50">{plan.interiorPageDimensions.widthPx} x {plan.interiorPageDimensions.heightPx}px</div>
                  <div className="mt-1 text-[11px] text-cyan-100/45">{plan.interiorPageDimensions.widthMm} x {plan.interiorPageDimensions.heightMm} mm</div>
                </div>
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Cover Wrap</div>
                  <div className="mt-1 text-xs text-cyan-50">{plan.coverWrap.widthPx} x {plan.coverWrap.heightPx}px</div>
                  <div className="mt-1 text-[11px] text-cyan-100/45">{plan.coverWrap.widthMm} x {plan.coverWrap.heightMm} mm</div>
                </div>
                <div className="rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">Spine</div>
                  <div className="mt-1 text-xs text-cyan-50">{plan.coverWrap.spineWidthMm.toFixed(4)} mm</div>
                  <div className="mt-1 text-[11px] text-cyan-100/45">{plan.coverWrap.allowSpineText ? 'Spine text allowed' : `No spine text under ${KDP_MIN_SPINE_TEXT_PAGES} pages`}</div>
                </div>
              </div>

              <div className="rounded border border-cyan-300/10 bg-slate-950/45 p-3">
                <div className="mb-2 text-xs font-semibold text-white">Page Mapping</div>
                <div className="grid gap-2 text-xs text-cyan-100/65 sm:grid-cols-2">
                  <div>Front cover: source page {plan.roles.frontCover?.sourcePageNumber ?? '-'}</div>
                  <div>Back cover: source page {plan.roles.backCover?.sourcePageNumber ?? '-'}</div>
                  <div>Inside front: source page {plan.roles.insideFrontCover?.sourcePageNumber ?? '-'}</div>
                  <div>Inside back: source page {plan.roles.insideBackCover?.sourcePageNumber ?? '-'}</div>
                  <div>Story starts: source page {plan.interiorPages.find((page) => page.role === 'story')?.sourcePageNumber ?? '-'}</div>
                  <div>Story pages: {plan.storyPageCount}</div>
                </div>
              </div>

              {pendingPrintUpscaleCount > 0 ? (
                <div className="rounded border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                  {pendingPrintUpscaleCount} placed image frame{pendingPrintUpscaleCount === 1 ? '' : 's'} still need print-resolution replacement. Run Finalize Print before exporting KDP assets.
                </div>
              ) : null}

              {plan.warnings.length ? (
                <div className="space-y-2">
                  {plan.warnings.map((warning) => (
                    <div
                      className={`rounded border px-3 py-2 text-xs leading-5 ${
                        warning.severity === 'error'
                          ? 'border-rose-300/25 bg-rose-500/10 text-rose-100'
                          : warning.severity === 'warning'
                            ? 'border-amber-300/25 bg-amber-500/10 text-amber-100'
                            : 'border-cyan-300/15 bg-cyan-400/10 text-cyan-100/70'
                      }`}
                      key={warning.code}
                    >
                      {warning.message}
                    </div>
                  ))}
                </div>
              ) : null}

              {blockingWarnings.length ? (
                <label className="flex items-start gap-2 rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2 text-xs text-cyan-100/70">
                  <input
                    checked={normalizedSettings.allowPreflightErrors}
                    className="mt-0.5"
                    onChange={(event) => update({ allowPreflightErrors: event.target.checked })}
                    type="checkbox"
                  />
                  Allow export even though KDP preflight found blocking submission issues.
                </label>
              ) : null}
            </div>

            <div className="space-y-3 rounded border border-cyan-300/10 bg-[#10131b] p-3">
              <div className="text-xs font-semibold text-white">Archive Contents</div>
              <div className="space-y-2 text-xs leading-5 text-cyan-100/60">
                <div>cover/full-wrap-cover.png</div>
                <div>cover/front-cover-page-001.png</div>
                <div>cover/back-cover-page-{String(plan.roles.backCover?.sourcePageNumber ?? document.pages.length).padStart(3, '0')}.png</div>
                <div>interior/001-inside-front-cover-page-002.png</div>
                <div>interior/story pages</div>
                <div>manifest.json</div>
                <div>preflight.json</div>
              </div>
              <div className="border-t border-cyan-300/10 pt-3 text-xs font-semibold text-white">Official References</div>
              <div className="space-y-2 text-xs leading-5">
                {plan.officialReferences.map((reference) => (
                  <a
                    className="block text-cyan-200 hover:text-white"
                    href={reference.url}
                    key={reference.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {reference.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-cyan-300/10 p-4">
          <button
            className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canExport}
            onClick={() => onExport(normalizedSettings)}
            type="button"
          >
            <Download size={14} />
            Export KDP ZIP
          </button>
        </div>
      </div>
    </div>
  );
}

function PaperWebcomicExportDialog({
  document,
  initialSettings,
  onClose,
  onExport,
}: {
  document: PaperDocument;
  initialSettings: PaperWebcomicExportSettings;
  onClose: () => void;
  onExport: (settings: PaperWebcomicExportSettings) => void;
}) {
  const [settings, setSettings] = useState<PaperWebcomicExportSettings>(initialSettings);
  const includeBleed = settings.includeBleed;
  const widthMm = document.page.widthMm + (includeBleed ? document.page.bleedMm * 2 : 0);
  const heightMm = document.page.heightMm + (includeBleed ? document.page.bleedMm * 2 : 0);
  const widthFromDpi = paperPixelsFromMm(widthMm, settings.outputDpi);
  const heightFromDpi = paperPixelsFromMm(heightMm, settings.outputDpi);
  const update = (patch: Partial<PaperWebcomicExportSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  };
  const normalizedSettings: PaperWebcomicExportSettings = {
    ...settings,
    outputWidthPx: Math.max(64, Math.round(settings.outputWidthPx)),
    outputDpi: Math.max(24, Math.round(settings.outputDpi)),
    quality: Math.min(1, Math.max(0.05, settings.quality)),
  };
  const heightFromWidth = Math.max(1, Math.round(normalizedSettings.outputWidthPx * (heightMm / widthMm)));
  const pageCount = document.pages.length;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-md border border-cyan-300/20 bg-[#0b121d] p-4 text-cyan-50 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-cyan-300/10 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ImageIcon size={16} />
              Webcomic Page Images
            </div>
            <div className="mt-1 text-xs text-cyan-100/45">
              {pageCount} page{pageCount === 1 ? '' : 's'} · {normalizedSettings.format.toUpperCase()} · {normalizedSettings.outputWidthPx}px wide
            </div>
          </div>
          <button
            className="rounded p-1 text-cyan-100/45 hover:bg-cyan-400/10 hover:text-white"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Format">
            <select
              className="paper-input"
              onChange={(event) => update({ format: event.target.value === 'jpeg' ? 'jpeg' : 'png' })}
              value={settings.format}
            >
              <option value="png">PNG lossless</option>
              <option value="jpeg">JPEG</option>
            </select>
          </Field>
          <Field label="Width px">
            <input
              className="paper-input"
              min={64}
              onChange={(event) => update({ outputWidthPx: Number(event.target.value) })}
              type="number"
              value={settings.outputWidthPx}
            />
          </Field>
          <Field label="DPI reference">
            <input
              className="paper-input"
              min={24}
              onChange={(event) => update({ outputDpi: Number(event.target.value), outputWidthPx: paperPixelsFromMm(widthMm, Number(event.target.value)) })}
              type="number"
              value={settings.outputDpi}
            />
          </Field>
          <Field label="Quality">
            <input
              className="paper-input"
              disabled={settings.format === 'png'}
              max={1}
              min={0.05}
              onChange={(event) => update({ quality: Number(event.target.value) })}
              step={0.01}
              type="number"
              value={settings.quality}
            />
          </Field>
          <label className="flex items-center gap-2 rounded border border-cyan-300/10 bg-[#10131b] px-3 py-2 text-xs text-cyan-100/70 sm:col-span-2">
            <input
              checked={settings.includeBleed}
              onChange={(event) => update({ includeBleed: event.target.checked })}
              type="checkbox"
            />
            Include bleed area
          </label>
        </div>
        <div className="mt-3 rounded border border-cyan-300/10 bg-slate-950/45 px-3 py-2 text-xs leading-5 text-cyan-100/60">
          Width setting exports about {normalizedSettings.outputWidthPx} x {heightFromWidth}px per page. DPI reference for this page size is {widthFromDpi} x {heightFromDpi}px.
          PNG is lossless, so quality only applies to JPEG.
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-cyan-300 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-200"
            onClick={() => onExport(normalizedSettings)}
            type="button"
          >
            <Download size={14} />
            Export Pages
          </button>
        </div>
      </div>
    </div>
  );
}

function PaperWorkspaceViewportHost({
  activeEdgeDrawer,
  assetsDrawer,
  children,
  className,
  mobileTopbarHeightPx,
  onCloseEdgeDrawer,
  onToggleEdgeDrawer,
  panels,
  rightPanels,
  sourceDrawer,
  style,
  mobileChromeVisible,
  usePhoneShell,
  workspaceId,
}: {
  activeEdgeDrawer: PaperMobileEdgeDrawerId | null;
  assetsDrawer: React.ReactNode;
  children: React.ReactNode;
  className: string;
  mobileTopbarHeightPx: number;
  onCloseEdgeDrawer: () => void;
  onToggleEdgeDrawer: (drawerId: PaperMobileEdgeDrawerId) => void;
  panels: DockablePanelDefinition[];
  rightPanels: PaperMobileDrawerPanel[];
  sourceDrawer: React.ReactNode;
  style: React.CSSProperties;
  mobileChromeVisible: boolean;
  usePhoneShell: boolean;
  workspaceId: string;
}) {
  if (usePhoneShell) {
    return (
      <div className={`${className} flex min-h-0`} style={style}>
        <PaperMobileEdgeShell
          activeEdgeDrawer={activeEdgeDrawer}
          assetsDrawer={assetsDrawer}
          onCloseEdgeDrawer={onCloseEdgeDrawer}
          onToggleEdgeDrawer={onToggleEdgeDrawer}
          overlayMode="viewport"
          rightPanels={rightPanels}
          sourceDrawer={sourceDrawer}
          topbarHeightPx={mobileTopbarHeightPx}
          visible={mobileChromeVisible}
        >
          {children}
        </PaperMobileEdgeShell>
      </div>
    );
  }

  return (
    <DockablePanelHost
      className={className}
      panels={panels}
      style={style}
      workspaceId={workspaceId}
    >
      {children}
    </DockablePanelHost>
  );
}

function PaperFloatingToolsPalette({
  children,
  collapsed,
  leftInsetPx,
  onPositionChange,
  onToggleCollapsed,
  position,
  topInsetPx,
  visible,
}: {
  children: React.ReactNode;
  collapsed: boolean;
  leftInsetPx: number;
  onPositionChange: (position: PaperToolsPalettePosition) => void;
  onToggleCollapsed: () => void;
  position: PaperToolsPalettePosition;
  topInsetPx: number;
  visible: boolean;
}) {
  const paletteRef = useRef<HTMLDivElement | null>(null);

  const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = position;
    const rect = paletteRef.current?.getBoundingClientRect();
    const paletteSize = {
      width: Math.round(rect?.width ?? 96),
      height: Math.round(rect?.height ?? 560),
    };

    const movePalette = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      onPositionChange(clampPaperToolsPalettePosition(
        {
          x: startPosition.x + pointerEvent.clientX - startX,
          y: startPosition.y + pointerEvent.clientY - startY,
        },
        paletteSize,
        { leftInsetPx, topInsetPx },
      ));
    };
    const stopDrag = () => {
      window.removeEventListener('pointermove', movePalette);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('pointercancel', stopDrag);
    };

    window.addEventListener('pointermove', movePalette);
    window.addEventListener('pointerup', stopDrag, { once: true });
    window.addEventListener('pointercancel', stopDrag, { once: true });
  }, [leftInsetPx, onPositionChange, position, topInsetPx]);

  if (!visible) return null;

  const boundedMaxHeight = `calc(100dvh - ${Math.max(PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN, topInsetPx + PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN)}px)`;
  const boundedBodyMaxHeight = `calc(100dvh - ${Math.max(PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN, topInsetPx + PAPER_TOOLS_PALETTE_VIEWPORT_MARGIN + 12)}px)`;

  // Portal to <body> so the pinned z wins globally and the palette is never covered by the source bin
  // or other panels (otherwise it is trapped inside the Paper workspace's z-30 stacking context).
  return typeof document === 'undefined' ? null : createPortal(
    <div
      aria-label="Paper tools"
      className="fixed z-[75] w-[96px] select-none overflow-hidden rounded-[3px] border border-cyan-300/25 bg-[#11131a] shadow-2xl shadow-black/45"
      data-compact-tool-palette="true"
      data-paper-floating-tools-palette="true"
      data-paper-tools-dockable="false"
      data-paper-tools-resizable="false"
      ref={paletteRef}
      role="toolbar"
      style={{
        left: position.x,
        height: collapsed ? 76 : undefined,
        maxHeight: collapsed ? 76 : boundedMaxHeight,
        top: position.y,
      }}
    >
      <div
        aria-label="Paper tools drag handle"
        className="relative flex h-4 touch-none cursor-grab items-center justify-center border-b border-cyan-300/20 bg-[#171a22] active:cursor-grabbing"
        data-paper-tools-drag-handle="true"
        onPointerDown={startDrag}
        role="button"
        tabIndex={0}
        title="Move Paper tools"
      >
        <span className="h-1 w-3 rounded-full bg-cyan-200/55" />
        <button
          className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center text-cyan-100/50 hover:text-cyan-400 active:text-cyan-500 rounded bg-cyan-950/20 hover:bg-cyan-950/40 p-0.5 transition-colors pointer-events-auto"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapsed();
          }}
          title={collapsed ? "Expand Tools" : "Collapse Tools"}
          type="button"
        >
          {collapsed ? (
            <ChevronDown size={10} />
          ) : (
            <ChevronUp size={10} />
          )}
        </button>
      </div>
      <div className="overflow-x-hidden overflow-y-auto" style={{ maxHeight: boundedBodyMaxHeight }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PaperToolbar({
  activeTool,
  canPasteStyle,
  collapsed = false,
  colorPickersDisabled = false,
  fillColor = '#ffffff',
  onAddComicSfx,
  onAddFrame,
  onCopy,
  onCopyStyle,
  onCut,
  onFillColorChange = () => undefined,
  onPaste,
  onPasteStyle,
  onOpenObjectLibrary = () => undefined,
  onRedo,
  onSetTool,
  onStrokeColorChange = () => undefined,
  onUndo,
  strokeColor = '#111827',
}: {
  activeTool: PaperTool;
  canPasteStyle: boolean;
  collapsed?: boolean;
  colorPickersDisabled?: boolean;
  fillColor?: string;
  onAddComicSfx: (presetId: PaperComicSfxPresetId) => void;
  onAddFrame: (tool: PaperTool) => void;
  onCopy: () => void;
  onCopyStyle: () => void;
  onCut: () => void;
  onFillColorChange?: (color: string) => void;
  onPaste: () => void;
  onPasteStyle: () => void;
  onOpenObjectLibrary?: () => void;
  onRedo: () => void;
  onSetTool: (tool: PaperTool) => void;
  onStrokeColorChange?: (color: string) => void;
  onUndo: () => void;
  strokeColor?: string;
}) {
  const tiltmarkLicensed = useSettingsStore((state) => state.license.licensed);
  const icons: Record<PaperTool, React.ReactNode> = {
    select: <MousePointer2 size={18} />,
    hand: <Hand size={18} />,
    text: <Type size={18} />,
    image: <ImageIcon size={18} />,
    panel: <Frame size={18} />,
    line: <Minus size={18} />,
    ellipse: <Circle size={18} />,
    triangle: <Triangle size={18} />,
    pentagon: <Pentagon size={18} />,
    hexagon: <Hexagon size={18} />,
    shape: <Waypoints size={18} />,
    speech: <MessageCircle size={18} />,
    thought: <Cloud size={18} />,
    caption: <Captions size={18} />,
    eyedropper: <Pipette size={18} />,
    gutterKnife: <Slice size={18} />,
    tiltmark: tiltmarkLicensed ? <Paintbrush size={18} /> : <LockKeyhole size={18} />,
    barcode: <Barcode size={18} />,
  };

  return (
    <div className="w-[96px] bg-[#151720]" data-paper-tools-panel="true">
      {!collapsed && (
        <div className="grid grid-cols-3 justify-items-center gap-0" data-paper-tools-grid="true">
        <PaperToolbarButton icon={<Undo2 size={18} />} label="Undo" onActivate={onUndo} />
        <PaperToolbarButton icon={<Redo2 size={18} />} label="Redo" onActivate={onRedo} />
        <PaperToolbarButton icon={<Scissors size={18} />} label="Cut" onActivate={onCut} />
        <PaperToolbarButton icon={<Copy size={18} />} label="Copy" onActivate={onCopy} />
        <PaperToolbarButton icon={<ClipboardPaste size={18} />} label="Paste" onActivate={onPaste} />
        <PaperToolbarButton icon={<Palette size={18} />} label="Copy Style" onActivate={onCopyStyle} />
        <PaperToolbarButton disabled={!canPasteStyle} icon={<ClipboardPaste size={18} />} label="Paste Style" onActivate={onPasteStyle} />
        <PaperToolbarButton icon={<BookOpen size={18} />} label="Object Library" onActivate={onOpenObjectLibrary} />
        {PAPER_TOOL_DEFINITIONS.map((entry) => (
          <PaperToolbarButton
            className={`flex h-8 w-8 items-center justify-center rounded-none border transition-colors ${
              activeTool === entry.tool
                ? 'border-[#252936] bg-cyan-400 text-slate-950'
                : 'border-[#252936] bg-[#151720] text-cyan-100/70 hover:bg-cyan-400/10 hover:text-white'
            }`}
            icon={icons[entry.tool]}
            key={entry.tool}
            label={entry.label}
            onActivate={() => entry.add ? onAddFrame(entry.tool) : onSetTool(entry.tool)}
            title={entry.shortcut ? `${entry.label} (${entry.shortcut})` : entry.label}
          />
        ))}
        <CompactToolbarMenu
          ariaLabel="Comic sound effects"
          compact
          icon={<Sparkles size={16} />}
          items={PAPER_TOOLBAR_SFX_PRESETS.map((presetId) => {
            const preset = getPaperComicSfxPreset(presetId);
            return {
              id: presetId,
              label: `Design ${preset.label}`,
              onSelect: () => onAddComicSfx(presetId),
            };
          })}
          label="SFX"
          placement="right"
        />
      </div>
      )}
      <div
        className="relative h-[60px] w-24 border-x border-b border-[#252936] bg-[#151720]"
        data-paper-color-well="true"
      >
        <AdvancedColorPicker
          buttonClassName="rounded-none border border-black"
          className="absolute bottom-2 right-6 h-7 w-7 cursor-pointer rounded-none border border-black bg-transparent p-0"
          disabled={colorPickersDisabled}
          label="Frame stroke color"
          onChange={onStrokeColorChange}
          title="Frame stroke color"
          value={cssColorToPickerValue(strokeColor)}
        />
        <AdvancedColorPicker
          buttonClassName="rounded-none border border-white/85 shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
          className="absolute left-6 top-2 z-10 h-8 w-8 cursor-pointer rounded-none border border-white/85 bg-transparent p-0 shadow-[0_0_0_1px_rgba(0,0,0,0.85)]"
          disabled={colorPickersDisabled}
          label="Frame fill color"
          onChange={onFillColorChange}
          title="Frame fill color"
          value={cssColorToPickerValue(fillColor)}
        />
      </div>
    </div>
  );
}

function PaperToolbarButton({
  className = 'flex h-8 w-8 items-center justify-center rounded-none border border-[#252936] bg-[#151720] text-cyan-100/70 transition-colors hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-[#151720] disabled:hover:text-cyan-100/70',
  icon,
  label,
  onActivate,
  disabled = false,
  title = label,
}: {
  className?: string;
  icon: React.ReactNode;
  label: string;
  onActivate: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const lastPointerActivationRef = useRef(0);

  const shouldSuppressActivation = () =>
    Date.now() - lastPointerActivationRef.current < PAPER_TOOLBAR_POINTER_CLICK_SUPPRESSION_MS;

  const markActivated = () => {
    lastPointerActivationRef.current = Date.now();
    onActivate();
  };

  const stopActivationEvent = (
    event:
      | React.PointerEvent<HTMLButtonElement>
      | React.MouseEvent<HTMLButtonElement>
      | React.TouchEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const activateFromPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !isPaperToolbarPrimaryPointer(event)) return;
    stopActivationEvent(event);
    if (shouldSuppressActivation()) return;
    markActivated();
  };

  const activateFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || !isPaperToolbarPrimaryPointer(event)) return;
    stopActivationEvent(event);
    if (shouldSuppressActivation()) return;
    markActivated();
  };

  const activateFromTouchStart = (event: React.TouchEvent<HTMLButtonElement>) => {
    if (disabled) return;
    event.stopPropagation();
    if (shouldSuppressActivation()) return;
    markActivated();
  };

  const activateFromMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    stopActivationEvent(event);
    if (shouldSuppressActivation()) return;
    markActivated();
  };

  const activateFromClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (shouldSuppressActivation()) {
      stopActivationEvent(event);
      return;
    }
    event.stopPropagation();
    markActivated();
  };

  return (
    <button
      aria-label={label}
      className={className}
      disabled={disabled}
      onClick={activateFromClick}
      onMouseDown={activateFromMouseDown}
      onPointerDown={activateFromPointerDown}
      onPointerUp={activateFromPointer}
      onTouchStart={activateFromTouchStart}
      title={title}
      type="button"
    >
      <span className="pointer-events-none flex items-center justify-center">
        {icon}
      </span>
    </button>
  );
}

function isPaperToolbarPrimaryPointer(event: React.PointerEvent<HTMLButtonElement>): boolean {
  if (event.isPrimary === false) return false;
  if (event.pointerType === 'mouse') return event.button === 0;
  return event.button === 0 || event.button === -1;
}

function PaperTouchNavigationControl({
  available,
  settings,
  panelOpen,
  onToggleEnabled,
  onTogglePanel,
  onToggleGesture,
}: {
  available: boolean;
  settings: PaperTouchNavigationSettings;
  panelOpen: boolean;
  onToggleEnabled: () => void;
  onTogglePanel: () => void;
  onToggleGesture: (gesture: 'oneFingerPan' | 'pinchZoom') => void;
}) {
  if (!available) return null;

  const active = settings.enabled && (settings.oneFingerPan || settings.pinchZoom);

  return (
    <div
      className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-2"
      data-paper-touch-navigation-control="true"
    >
      {panelOpen ? (
        <div
          className="w-44 rounded-md border border-cyan-300/20 bg-[#0b1220]/95 p-2 text-xs text-cyan-100 shadow-2xl shadow-black/45 backdrop-blur"
          data-paper-touch-navigation-panel="true"
        >
          <label className="flex items-center justify-between gap-3 rounded px-1 py-1">
            <span>Pan</span>
            <input
              checked={settings.oneFingerPan}
              className="accent-cyan-300"
              onChange={() => onToggleGesture('oneFingerPan')}
              type="checkbox"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded px-1 py-1">
            <span>Pinch zoom</span>
            <input
              checked={settings.pinchZoom}
              className="accent-cyan-300"
              onChange={() => onToggleGesture('pinchZoom')}
              type="checkbox"
            />
          </label>
        </div>
      ) : null}
      <div className="inline-flex overflow-hidden rounded-full border border-cyan-300/25 bg-[#07111f]/95 shadow-xl shadow-black/45 backdrop-blur">
        <button
          aria-label="Touch navigation"
          aria-pressed={active}
          className={`inline-flex h-9 items-center gap-1.5 px-3 text-[11px] font-semibold transition-colors ${
            active
              ? 'bg-emerald-400/18 text-emerald-100'
              : 'bg-[#111827]/85 text-cyan-100/65 hover:text-white'
          }`}
          data-paper-touch-navigation-active={active ? 'true' : 'false'}
          data-paper-touch-navigation-toggle="true"
          onClick={onToggleEnabled}
          title="Touch navigation"
          type="button"
        >
          <Hand size={14} />
          <span>Touch Nav</span>
        </button>
        <button
          aria-label="Touch navigation options"
          aria-expanded={panelOpen}
          className="flex h-9 w-8 items-center justify-center border-l border-cyan-300/15 text-cyan-100/70 hover:bg-cyan-400/10 hover:text-white"
          onClick={onTogglePanel}
          title="Touch navigation options"
          type="button"
        >
          <ChevronDown className={`transition-transform ${panelOpen ? 'rotate-180' : ''}`} size={13} />
        </button>
      </div>
    </div>
  );
}

type PaperMobileEdgeDrawerId = 'source' | 'panels' | 'assets';

export interface PaperMobileDrawerPanel {
  id: string;
  title: string;
  content: React.ReactNode;
  defaultOpen?: boolean;
}

export function PaperMobileEdgeShell({
  activeEdgeDrawer,
  assetsDrawer,
  children,
  onCloseEdgeDrawer,
  onToggleEdgeDrawer,
  overlayMode = 'inline',
  rightPanels,
  sourceDrawer,
  topbarHeightPx = 48,
  visible,
}: {
  activeEdgeDrawer: PaperMobileEdgeDrawerId | null;
  assetsDrawer: React.ReactNode;
  children: React.ReactNode;
  onCloseEdgeDrawer: () => void;
  onToggleEdgeDrawer: (drawerId: PaperMobileEdgeDrawerId) => void;
  overlayMode?: 'inline' | 'viewport';
  rightPanels: PaperMobileDrawerPanel[];
  sourceDrawer: React.ReactNode;
  topbarHeightPx?: number;
  visible: boolean;
}) {
  const drawer = activeEdgeDrawer;
  const viewportOverlay = overlayMode === 'viewport' && typeof document !== 'undefined';
  const drawerTopOffsetPx = viewportOverlay && visible ? topbarHeightPx : 0;
  const positionModeClassName = viewportOverlay ? 'fixed' : 'absolute';
  const overlay = (
    <div
      className="contents"
      data-paper-mobile-edge-overlay={viewportOverlay ? 'viewport' : 'inline'}
    >
      <PaperMobileEdgeHandle
        active={drawer === 'source'}
        ariaLabel="Open Paper Source Library drawer"
        className={`${positionModeClassName} ${viewportOverlay ? '' : 'left-2'} top-1/2 -translate-y-1/2 rounded-r-md`}
        compact={!visible}
        edge="source"
        icon={<PanelLeftOpen size={16} />}
        onClick={() => onToggleEdgeDrawer('source')}
        style={viewportOverlay ? { left: 10 } : undefined}
        viewportOverlay={viewportOverlay}
      />
      <PaperMobileEdgeHandle
        active={drawer === 'panels'}
        ariaLabel="Open Paper panels drawer"
        className={`${positionModeClassName} ${viewportOverlay ? 'right-1' : 'right-0'} top-1/2 -translate-y-1/2 rounded-l-md ${viewportOverlay ? '' : 'border-r-0'}`}
        compact={!visible}
        edge="panels"
        icon={<PanelRightOpen size={16} />}
        onClick={() => onToggleEdgeDrawer('panels')}
        viewportOverlay={viewportOverlay}
      />
      <PaperMobileEdgeHandle
        active={drawer === 'assets'}
        ariaLabel="Open Paper assets drawer"
        className={`${positionModeClassName} ${viewportOverlay ? 'bottom-1' : 'bottom-0'} left-1/2 -translate-x-1/2 rounded-t-md ${viewportOverlay ? '' : 'border-b-0'}`}
        compact={!visible}
        edge="assets"
        icon={<PanelBottomOpen size={16} />}
        onClick={() => onToggleEdgeDrawer('assets')}
        viewportOverlay={viewportOverlay}
      />

      {drawer === 'source' ? (
        <aside
          className={`${viewportOverlay ? 'fixed z-[125]' : 'absolute z-50'} bottom-0 left-0 flex w-[min(22rem,86vw)] flex-col overflow-hidden border-r border-cyan-300/20 bg-[#09111d]/95 shadow-[18px_0_32px_rgba(0,0,0,0.32)] backdrop-blur-md`}
          data-paper-mobile-edge-drawer="source"
          style={viewportOverlay ? { top: drawerTopOffsetPx } : { top: 0 }}
        >
          <PaperMobileDrawerHeader onClose={onCloseEdgeDrawer} title="Paper Source Library" />
          <div className="min-h-0 flex-1 overflow-y-auto">{sourceDrawer}</div>
        </aside>
      ) : null}

      {drawer === 'panels' ? (
        <aside
          className={`${viewportOverlay ? 'fixed z-[125]' : 'absolute z-50'} bottom-0 right-0 flex w-[min(23rem,88vw)] flex-col overflow-hidden border-l border-cyan-300/20 bg-[#09111d]/95 shadow-[-18px_0_32px_rgba(0,0,0,0.32)] backdrop-blur-md`}
          data-paper-mobile-edge-drawer="panels"
          style={viewportOverlay ? { top: drawerTopOffsetPx } : { top: 0 }}
        >
          <PaperMobileDrawerHeader onClose={onCloseEdgeDrawer} title="Paper Panels" />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {rightPanels.map((panel) => (
              <details
                className="mb-2 overflow-hidden rounded-md border border-cyan-300/15 bg-[#0d1724]/90"
                key={panel.id}
                open={panel.defaultOpen}
              >
                <summary className="cursor-pointer select-none border-b border-cyan-300/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100">
                  {panel.title}
                </summary>
                <div className="min-h-0 p-2">{panel.content}</div>
              </details>
            ))}
          </div>
        </aside>
      ) : null}

      {drawer === 'assets' ? (
        <aside
          className={`${viewportOverlay ? 'fixed z-[125]' : 'absolute z-50'} bottom-0 left-0 right-0 flex h-[min(42dvh,20rem)] flex-col overflow-hidden border-t border-cyan-300/20 bg-[#09111d]/95 shadow-[0_-18px_32px_rgba(0,0,0,0.32)] backdrop-blur-md`}
          data-paper-mobile-edge-drawer="assets"
        >
          <PaperMobileDrawerHeader onClose={onCloseEdgeDrawer} title="Paper Assets" />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">{assetsDrawer}</div>
        </aside>
      ) : null}
    </div>
  );

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 overflow-hidden"
      data-paper-mobile-edge-chrome-visible={visible ? 'true' : 'false'}
      data-paper-mobile-edge-shell="true"
    >
      <div className="absolute inset-0 min-h-0 min-w-0">{children}</div>
      {viewportOverlay ? createPortal(overlay, document.body) : overlay}
    </div>
  );
}

function PaperMobileEdgeHandle({
  active,
  ariaLabel,
  className,
  compact,
  edge,
  icon,
  onClick,
  style,
  viewportOverlay,
}: {
  active: boolean;
  ariaLabel: string;
  className: string;
  compact: boolean;
  edge: PaperMobileEdgeDrawerId;
  icon: React.ReactNode;
  onClick: () => void;
  style?: React.CSSProperties;
  viewportOverlay: boolean;
}) {
  const lastPointerActivationAtRef = useRef(0);
  const sizeClassName = edge === 'assets'
    ? (compact ? 'h-6 w-14' : 'h-7 w-16')
    : edge === 'source'
      ? (compact ? 'h-10 w-7' : 'h-11 w-7')
    : (compact ? 'h-12 w-6' : 'h-12 w-7');
  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.stopPropagation();
    lastPointerActivationAtRef.current = Date.now();
    onClick();
  };
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (Date.now() - lastPointerActivationAtRef.current < 700) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick();
  };

  return (
    <button
      aria-label={ariaLabel}
      className={`${viewportOverlay ? 'z-[240]' : 'z-[110]'} flex touch-none items-center justify-center border border-cyan-200/45 bg-[#092033]/95 text-cyan-50 shadow-[0_0_18px_rgba(34,211,238,0.26)] backdrop-blur-md transition-colors hover:bg-cyan-400/25 ${sizeClassName} ${active ? 'bg-cyan-400/30 text-white' : ''} ${className}`}
      data-mobile-edge-handle-compact={compact ? 'true' : 'false'}
      data-mobile-edge-handle-edge={edge}
      data-mobile-edge-handle-visible="true"
      data-mobile-edge-source-visible-strip={edge === 'source' ? 'true' : undefined}
      data-mobile-edge-handle="paper"
      onClick={handleClick}
      onPointerUp={handlePointerUp}
      style={style}
      type="button"
    >
      {icon}
    </button>
  );
}

function PaperMobileDrawerHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-cyan-300/15 px-3 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-100">
      <span className="min-w-0 truncate">{title}</span>
      <button
        aria-label={`Close ${title} drawer`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-cyan-300/15 bg-[#101826]/90 text-cyan-100/70 hover:bg-cyan-400/15 hover:text-white"
        onClick={onClose}
        title={`Close ${title}`}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function PaperTopStrip({
  docTitle,
  onAddPage,
  onDuplicatePage,
  onExportJson,
  onExportIdml,
  onExportKdpPdf,
  onOpenSoftProof,
  onExportStoriesTxt,
  onExportStoriesHtml,
  onExportStoriesRtf,
  onExportStoriesDocx,
  onExportCbz,
  onExportPageToImage,
  onExportPageToSource,
  onExportPagesToEnvelope,
  onFinalizePrintUpscale,
  onExportPdf,
  onExportAccessiblePdf,
  onExportEpub,
  onExportKdpAssets,
  onExportReaderSpreadsPdf,
  onExportBookletProofPdf,
  onExportWebcomicImages,
  onImportJson,
  onNew,
  onPackagePrint,
  onShowPreflight,
  showPreflight,
  onShowFindChange,
  showFindChange,
  onToggleGrid,
  onToggleGuides,
  onToggleTextBaselines,
  onToggleFrameEdges,
  onToggleSnapToGrid,
  onToggleSnapToGuides,
  onToggleInspector,
  onToggleRulers,
  onToggleSpreads,
  onToggleStartOnRight,
  onToggleRtlBinding,
  onToggleToolbar,
  onTogglePages,
  onToggleLayers,
  onToggleStoryEditor,
  onToggleWritingAssistant,
  onToggleAssistedLayout,
  onToggleLiveLayoutAgent,
  onToggleShortcutHelp,
  onToggleLinkedAssets,
  onTogglePrintProduction,
  onFitPage,
  onFitSpread,
  onZoomActual,
  onZoomIn,
  onZoomOut,
  showGrid,
  showGuides,
  showTextBaselines,
  showFrameEdges,
  showInspector,
  showRulers,
  showSpreads,
  snapToGrid,
  snapToGuides,
  startOnRight,
  rtlBinding,
  showToolbar,
  showPages = false,
  showLayers = false,
  showStoryEditor = false,
  showWritingAssistant = false,
  showAssistedLayout = false,
  showLiveLayoutAgent = false,
  showShortcutHelp = false,
  showLinkedAssets = false,
  showPrintProduction = false,
  zoom,
  placement = 'workspace',
  preflightStatus,
}: {
  docTitle: string;
  onAddPage: () => void;
  onDuplicatePage: () => void;
  onExportJson: () => void;
  onExportIdml: () => void;
  onExportKdpPdf?: () => void;
  onOpenSoftProof?: () => void;
  onExportStoriesTxt: () => void;
  onExportStoriesHtml: () => void;
  onExportStoriesRtf: () => void;
  onExportStoriesDocx: () => void;
  onExportCbz: () => void;
  onExportPageToImage: () => void;
  onExportPageToSource: () => void;
  onExportPagesToEnvelope: () => void;
  onFinalizePrintUpscale: () => void;
  onExportPdf: () => void;
  onExportAccessiblePdf: () => void;
  onExportEpub: () => void;
  onExportKdpAssets: () => void;
  onExportReaderSpreadsPdf: () => void;
  onExportBookletProofPdf: () => void;
  onExportWebcomicImages: () => void;
  onImportJson: () => void;
  onNew: () => void;
  onPackagePrint: () => void;
  onShowPreflight: () => void;
  showPreflight: boolean;
  onShowFindChange: () => void;
  showFindChange: boolean;
  onToggleGrid: () => void;
  onToggleGuides: () => void;
  onToggleTextBaselines: () => void;
  onToggleFrameEdges: () => void;
  onToggleSnapToGrid: () => void;
  onToggleSnapToGuides: () => void;
  onToggleInspector: () => void;
  onToggleRulers: () => void;
  onToggleSpreads: () => void;
  onToggleStartOnRight: () => void;
  onToggleRtlBinding: () => void;
  onToggleToolbar: () => void;
  onTogglePages?: () => void;
  onToggleLayers?: () => void;
  onToggleStoryEditor?: () => void;
  onToggleWritingAssistant?: () => void;
  onToggleAssistedLayout?: () => void;
  onToggleLiveLayoutAgent?: () => void;
  onToggleShortcutHelp?: () => void;
  onToggleLinkedAssets?: () => void;
  onTogglePrintProduction?: () => void;
  onFitPage?: () => void;
  onFitSpread?: () => void;
  onZoomActual?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showGrid: boolean;
  showGuides: boolean;
  showTextBaselines: boolean;
  showFrameEdges: boolean;
  showInspector: boolean;
  showRulers: boolean;
  showSpreads: boolean;
  snapToGrid: boolean;
  snapToGuides: boolean;
  startOnRight: boolean;
  rtlBinding: boolean;
  showToolbar: boolean;
  showPages?: boolean;
  showLayers?: boolean;
  showStoryEditor?: boolean;
  showWritingAssistant?: boolean;
  showAssistedLayout?: boolean;
  showLiveLayoutAgent?: boolean;
  showShortcutHelp?: boolean;
  showLinkedAssets?: boolean;
  showPrintProduction?: boolean;
  zoom: number;
  placement?: 'workspace' | 'titlebar';
  preflightStatus: PaperPreflightStatusSummary;
}) {
  const [isExportOpen, setIsExportOpen] = useState(false);
  const { t, tBoth } = useI18n();
  const exportButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [exportButtonRect, setExportButtonRect] = useState<DOMRect | null>(null);

  const updateButtonRect = useCallback(() => {
    if (exportButtonRef.current) {
      setExportButtonRect(exportButtonRef.current.getBoundingClientRect());
    }
  }, []);

  useEffect(() => {
    if (isExportOpen) {
      updateButtonRect();
      window.addEventListener('resize', updateButtonRect, { passive: true });
      window.addEventListener('scroll', updateButtonRect, { passive: true });

      const handleClickOutside = (event: MouseEvent) => {
        if (
          exportButtonRef.current &&
          !exportButtonRef.current.contains(event.target as Node) &&
          dropdownRef.current &&
          !dropdownRef.current.contains(event.target as Node)
        ) {
          setIsExportOpen(false);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);

      return () => {
        window.removeEventListener('resize', updateButtonRect);
        window.removeEventListener('scroll', updateButtonRect);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isExportOpen, updateButtonRect]);

  const isTitlebar = placement === 'titlebar';

  const style: React.CSSProperties = exportButtonRect ? {
    position: 'fixed',
    top: `${exportButtonRect.bottom + 8}px`,
    right: `${window.innerWidth - exportButtonRect.right}px`,
    zIndex: 9999,
  } : {
    position: 'fixed',
    top: '50px',
    right: '16px',
    zIndex: 9999,
  };

  const viewMenuItems: CompactToolbarMenuItem[] = [
    { id: 'rulers', label: t('paper.view.rulers'), active: showRulers, onSelect: onToggleRulers },
    { id: 'guides', label: t('paper.view.guides'), active: showGuides, onSelect: onToggleGuides },
    { id: 'grid', label: t('paper.view.grid'), active: showGrid, onSelect: onToggleGrid },
    { id: 'text-baselines', label: t('paper.view.textBaselines'), active: showTextBaselines, onSelect: onToggleTextBaselines },
    { id: 'frame-edges', label: t('paper.view.frameEdges'), active: showFrameEdges, onSelect: onToggleFrameEdges },
    { id: 'snap-guides', label: t('paper.view.snapGuides'), active: snapToGuides, onSelect: onToggleSnapToGuides, separatorBefore: true },
    { id: 'snap-grid', label: t('paper.view.snapGrid'), active: snapToGrid, onSelect: onToggleSnapToGrid },
    { id: 'spreads', label: t('paper.view.spreads'), active: showSpreads, onSelect: onToggleSpreads, separatorBefore: true },
    { id: 'start-right', label: t('paper.view.startOnRight'), active: startOnRight, onSelect: onToggleStartOnRight },
    { id: 'rtl-binding', label: tBoth('paper.jp.rtlBinding'), active: rtlBinding, onSelect: onToggleRtlBinding },
  ];
  const panelMenuItems: CompactToolbarMenuItem[] = [
    ...(onTogglePages ? [{ id: 'pages', label: t('paper.pages.title'), active: showPages, onSelect: onTogglePages }] : []),
    ...(onToggleLayers ? [{ id: 'layers', label: t('paper.layers.title'), active: showLayers, onSelect: onToggleLayers }] : []),
    ...(onToggleStoryEditor ? [{ id: 'story-editor', label: t('paper.story.title'), active: showStoryEditor, onSelect: onToggleStoryEditor }] : []),
    ...(onToggleWritingAssistant ? [{ id: 'writing-assistant', label: t('paper.panels.writingAssistant'), active: showWritingAssistant, onSelect: onToggleWritingAssistant }] : []),
    ...(onToggleAssistedLayout ? [{ id: 'assisted-layout', label: t('paper.panels.assistedLayout'), active: showAssistedLayout, onSelect: onToggleAssistedLayout }] : []),
    ...(onToggleLiveLayoutAgent ? [{ id: 'live-layout-agent', label: t('paper.panels.liveLayoutAgent'), active: showLiveLayoutAgent, onSelect: onToggleLiveLayoutAgent }] : []),
    ...(onToggleShortcutHelp ? [{ id: 'shortcuts-help', label: t('paper.panels.shortcuts'), active: showShortcutHelp, onSelect: onToggleShortcutHelp }] : []),
    { id: 'inspector', label: t('paper.panels.inspector'), active: showInspector, onSelect: onToggleInspector },
    { id: 'find-change', label: t('paper.panels.findChange'), active: showFindChange, onSelect: onShowFindChange },
    { id: 'preflight', label: t('paper.panels.preflight'), active: showPreflight, onSelect: onShowPreflight, separatorBefore: true },
    ...(onToggleLinkedAssets ? [{ id: 'linked-assets', label: t('paper.panels.linkedAssets'), active: showLinkedAssets, onSelect: onToggleLinkedAssets }] : []),
    ...(onTogglePrintProduction ? [{ id: 'print-production', label: t('paper.insp.printProduction'), active: showPrintProduction, onSelect: onTogglePrintProduction }] : []),
    { id: 'tools', label: t('paper.strip.tools'), active: showToolbar, onSelect: onToggleToolbar, separatorBefore: true },
  ];
  const zoomMenuItems: CompactToolbarMenuItem[] = [
    { id: 'zoom-out', label: t('paper.strip.zoomOut'), onSelect: onZoomOut },
    { id: 'zoom-in', label: t('paper.strip.zoomIn'), onSelect: onZoomIn },
    ...(onZoomActual ? [{ id: 'actual-size', label: t('paper.strip.actualSize'), onSelect: onZoomActual, separatorBefore: true }] : []),
    ...(onFitPage ? [{ id: 'fit-page', label: t('paper.pages.fitPage'), onSelect: onFitPage }] : []),
    ...(onFitSpread ? [{ id: 'fit-spread', label: t('paper.pages.fitSpread'), onSelect: onFitSpread }] : []),
  ];

  return (
    <div
      aria-label={`Paper controls for ${docTitle}`}
      className={`flex min-w-0 items-center gap-3 ${
        isTitlebar
          ? 'h-11 w-full overflow-hidden bg-transparent'
          : 'min-h-14 justify-between bg-[#0d1725]/95 backdrop-blur'
      }`}
      data-paper-document-title={docTitle}
      data-paper-topbar-controls="true"
      data-paper-topbar-placement={placement}
    >
      <div
        className={`flex min-w-0 items-center gap-1.5 overflow-hidden ${isTitlebar ? 'h-full flex-1 pr-2' : 'w-full'}`}
        data-paper-topbar-grouped-controls="true"
      >
        <StripButton icon={<FilePlus2 size={13} />} label={t('paper.strip.new')} onClick={onNew} />
        <StripButton icon={<FilePlus2 size={13} />} label={t('paper.strip.page')} onClick={onAddPage} />
        <StripButton icon={<FileJson size={13} />} label={t('paper.strip.duplicate')} onClick={onDuplicatePage} />
        <PaperPreflightStatusButton
          active={showPreflight}
          onClick={onShowPreflight}
          status={preflightStatus}
        />
        
        {/* Reclaim titlebar layout space with a single Export Document trigger */}
        <button
          ref={exportButtonRef}
          aria-label={t('paper.strip.exportDocument')}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border text-[11px] font-semibold px-2.5 transition-all duration-150 ${
            isExportOpen
              ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
              : 'border-cyan-300/20 bg-[#101a29]/80 text-cyan-100/75 hover:border-cyan-300/40 hover:text-white'
          }`}
          onClick={() => setIsExportOpen(!isExportOpen)}
          type="button"
        >
          <Download size={13} />
          <span className="hidden min-[1500px]:inline">{t('paper.strip.exportDocument')}</span>
          <ChevronDown size={11} className={`transition-transform duration-200 ${isExportOpen ? 'rotate-180' : ''}`} />
        </button>

        {isExportOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={dropdownRef}
            style={style}
            className="w-[560px] rounded-xl border border-cyan-500/25 bg-[#0b1320]/95 backdrop-blur-xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.65)] text-white"
          >
            <div className="flex items-center justify-between border-b border-cyan-300/10 pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Download size={14} className="text-cyan-300" />
                <span className="text-xs font-bold uppercase tracking-wider text-cyan-200">{t('paper.export.options')}</span>
              </div>
              <button
                onClick={() => setIsExportOpen(false)}
                className="rounded-md p-1 text-cyan-100/40 hover:bg-cyan-500/15 hover:text-white transition-all duration-150"
              >
                <X size={12} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Left Column */}
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/60 mb-2 px-1">{t('paper.export.sec.print')}</div>
                  <div className="flex flex-col gap-1">
                    <ExportMenuItem
                      icon={<Printer size={13} />}
                      label="PDF"
                      description={t('paper.export.desc.pdf')}
                      onClick={() => { onExportPdf(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<BookOpen size={13} />}
                      label="Accessible PDF"
                      description="Tagged reading order, document language, and authored image descriptions."
                      onClick={() => { onExportAccessiblePdf(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<BookOpen size={13} />}
                      label="KDP"
                      description={t('paper.export.desc.kdp')}
                      onClick={() => { onExportKdpAssets(); setIsExportOpen(false); }}
                    />
                    {onOpenSoftProof ? (
                      <ExportMenuItem
                        icon={<Printer size={13} />}
                        label={t('paper.export.softProof')}
                        description={t('paper.export.desc.softProof')}
                        onClick={() => { onOpenSoftProof(); setIsExportOpen(false); }}
                      />
                    ) : null}
                    <ExportMenuItem
                      icon={<BookOpen size={13} />}
                      label={t('paper.export.spreadPdf')}
                      description={t('paper.export.desc.spread')}
                      onClick={() => { onExportReaderSpreadsPdf(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<BookOpen size={13} />}
                      label={t('paper.export.booklet')}
                      description={t('paper.export.desc.booklet')}
                      onClick={() => { onExportBookletProofPdf(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label={t('paper.export.package')}
                      description={t('paper.export.desc.package')}
                      onClick={() => { onPackagePrint(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Printer size={13} />}
                      label={t('paper.export.finalizePrint')}
                      description={t('paper.export.desc.finalize')}
                      onClick={() => { onFinalizePrintUpscale(); setIsExportOpen(false); }}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/60 mb-2 px-1">{t('paper.export.sec.text')}</div>
                  <div className="flex flex-col gap-1">
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="TXT"
                      description={t('paper.export.desc.txt')}
                      onClick={() => { onExportStoriesTxt(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="HTML"
                      description={t('paper.export.desc.html')}
                      onClick={() => { onExportStoriesHtml(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="RTF"
                      description={t('paper.export.desc.rtf')}
                      onClick={() => { onExportStoriesRtf(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="DOCX"
                      description={t('paper.export.desc.docx')}
                      onClick={() => { onExportStoriesDocx(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<BookOpen size={13} />}
                      label="EPUB"
                      description={t('paper.export.desc.epub')}
                      onClick={() => { onExportEpub(); setIsExportOpen(false); }}
                    />
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="flex flex-col gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/60 mb-2 px-1">{t('paper.export.sec.web')}</div>
                  <div className="flex flex-col gap-1">
                    <ExportMenuItem
                      icon={<ImageIcon size={13} />}
                      label={t('paper.export.webPng')}
                      description={t('paper.export.desc.webPng')}
                      onClick={() => { onExportWebcomicImages(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<ImageIcon size={13} />}
                      label={t('paper.export.image')}
                      description={t('paper.export.desc.image')}
                      onClick={() => { onExportPageToImage(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="CBZ"
                      description={t('paper.export.desc.cbz')}
                      onClick={() => { onExportCbz(); setIsExportOpen(false); }}
                    />
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-400/60 mb-2 px-1">{t('paper.export.sec.interop')}</div>
                  <div className="flex flex-col gap-1">
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label={t('paper.export.source')}
                      description={t('paper.export.desc.source')}
                      onClick={() => { onExportPageToSource(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<FilePlus2 size={13} />}
                      label={t('paper.export.envelope')}
                      description={t('paper.export.desc.envelope')}
                      onClick={() => { onExportPagesToEnvelope(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="JSON"
                      description={t('paper.export.desc.json')}
                      onClick={() => { onExportJson(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label="Adobe IDML"
                      description={t('paper.export.desc.idml')}
                      onClick={() => { onExportIdml(); setIsExportOpen(false); }}
                    />
                    <ExportMenuItem
                      icon={<Download size={13} />}
                      label={t('paper.export.kdpPrintPdf')}
                      description={t('paper.export.desc.kdpPdf')}
                      onClick={() => { onExportKdpPdf?.(); setIsExportOpen(false); }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

        <StripButton icon={<FileJson size={13} />} label={t('paper.strip.importPlace')} title={t('paper.strip.importPlace.tooltip')} onClick={onImportJson} />
        <div className="mx-1 h-5 w-px shrink-0 bg-cyan-300/15" />
        <CompactToolbarMenu icon={<Ruler size={13} />} items={viewMenuItems} label={t('paper.strip.viewMenu')} />
        <CompactToolbarMenu icon={<PanelRightOpen size={13} />} items={panelMenuItems} label={t('paper.strip.panelsMenu')} />
        <div className="mx-1 h-5 w-px shrink-0 bg-cyan-300/15" />
        <CompactToolbarMenu
          ariaLabel={`${t('paper.strip.zoomMenu')}: ${Math.round(zoom * 100)}%`}
          icon={<Maximize2 size={13} />}
          items={zoomMenuItems}
          label={`${Math.round(zoom * 100)}%`}
        />
      </div>
    </div>
  );
}

function PaperConnectedSpreadView({
  doc,
  interaction,
  onBeginBubbleConnectorHandle,
  onBeginBubbleHandle,
  onBeginBubbleTextMove,
  onBeginBubbleTextResize,
  onBeginBubbleTextRotate,
  onBeginCreate,
  onBeginGutterKnife,
  onBeginGuideMove,
  onBeginImageCropPan,
  onBeginImageCropRotate,
  onBeginImageCropScale,
  onBeginFrameVertexMove,
  onBeginFrameVertexInsert,
  onDeleteFrameVertex,
  onToggleImageFlip,
  onBeginMove,
  onBeginResize,
  onBeginRotate,
  onDropSourceItem,
  onDropPaperPageImageImportFiles,
  onFinishInteraction,
  onAddGuideToPage,
  onInteractionMove,
  onOpenFrameMenu,
  onOpenPageMenu,
  onPolygonPoint,
  onResolveFrameImageNaturalSize,
  onSelectFrame,
  onSelectPage,
  onCommitFrameText,
  onDetachInheritedFrame,
  onUpdateGuide,
  polygonPoints,
  selectedFrameId,
  selectedFrameIds,
  selectedPageId,
  smartGuides,
  spread,
  tool,
  vertexEditModifierActive,
  zoom,
}: {
  doc: PaperDocument;
  interaction: PaperInteraction | null;
  onBeginCreate: (pageId: string, point: PaperPoint, frameKind: PaperFrameKind, shapeKind?: PaperFrame['shapeKind']) => void;
  onBeginGutterKnife?: (pageId: string, point: PaperPoint) => void;
  onBeginImageCropPan: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginImageCropRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginImageCropScale: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginFrameVertexMove: (pageId: string, frame: PaperFrame, vertexIndex: number) => void;
  onBeginFrameVertexInsert: (pageId: string, frame: PaperFrame, edgeIndex: number, point: PaperPoint, snapToBorder?: boolean) => void;
  onDeleteFrameVertex: (pageId: string, frame: PaperFrame, vertexIndex: number) => void;
  onToggleImageFlip: (pageId: string, frame: PaperFrame, axis: 'x' | 'y') => void;
  onBeginMove: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginResize: (pageId: string, frame: PaperFrame, handle: PaperResizeHandle, point: PaperPoint) => void;
  onBeginRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginBubbleConnectorHandle: (
    pageId: string,
    segment: PaperBubbleConnectorSegment,
    handle: PaperBubbleConnectorHandle,
  ) => void;
  onBeginBubbleHandle: (pageId: string, frame: PaperFrame, handle: PaperBubbleHandle) => void;
  onBeginBubbleTextMove: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginBubbleTextResize: (pageId: string, frame: PaperFrame, handle: PaperResizeHandle, point: PaperPoint) => void;
  onBeginBubbleTextRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginGuideMove: (pageId: string, guideId: string, orientation: PaperGuideOrientation) => void;
  onDropSourceItem: (event: React.DragEvent, frameId?: string, pageId?: string, point?: PaperPoint) => void;
  onDropPaperPageImageImportFiles: (event: React.DragEvent, pageId: string, point?: PaperPoint, frameId?: string) => void;
  onFinishInteraction: () => void;
  onAddGuideToPage: ReturnType<typeof usePaperStore.getState>['addGuideToPage'];
  onInteractionMove: (point: PaperPoint, modifiers?: PaperInteractionModifiers) => void;
  onOpenFrameMenu: (pageId: string, frameId: string, point: PaperPoint, screen: { x: number; y: number }) => void;
  onOpenPageMenu: (pageId: string, point: PaperPoint, screen: { x: number; y: number }) => void;
  onPolygonPoint: (pageId: string, point: PaperPoint) => void;
  onResolveFrameImageNaturalSize: (pageId: string, frame: PaperFrame, naturalWidth: number, naturalHeight: number) => void;
  onSelectFrame: (
    frameId: string | null,
    event?: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => void;
  onSelectPage: (pageId: string) => void;
  onCommitFrameText: (pageId: string, frameId: string, text: string, richText?: PaperRichParagraph[]) => void;
  onDetachInheritedFrame: (pageId: string, frameId: string) => void;
  onUpdateGuide: ReturnType<typeof usePaperStore.getState>['updateGuide'];
  polygonPoints: Array<PaperPoint & { pageId: string }>;
  selectedFrameId: string | null;
  selectedFrameIds: string[];
  selectedPageId: string;
  smartGuides: Array<PaperSmartGuideLine & { pageId: string }>;
  spread: PaperSpread;
  tool: PaperTool;
  vertexEditModifierActive: boolean;
  zoom: number;
}) {
  const pageRefs = useRef(new Map<string, HTMLDivElement>());
  const suppressNextPageClickRef = useRef(false);
  const spreadLayout = buildLivePaperSpreadLayout(spread, doc.page, {
    pasteboardMm: PAPER_PASTEBOARD_PADDING_PX / (PX_PER_MM * zoom),
  });
  const pageWidthPx = doc.page.widthMm * PX_PER_MM * zoom;
  const pageHeightPx = doc.page.heightMm * PX_PER_MM * zoom;
  const spreadWidthPx = spreadLayout.widthMm * PX_PER_MM * zoom;
  const spreadHeightPx = spreadLayout.heightMm * PX_PER_MM * zoom;
  const gridSizePx = doc.layout.grid.sizeMm * PX_PER_MM * zoom;
  const activeFrameKind = frameKindForTool(tool);
  const activeShapeKind = shapeKindForTool(tool);
  const interactionSlot = interaction
    ? spreadLayout.slots.find((slot) => slot.page?.id === interaction.pageId)
    : undefined;
  const previewGeometry = interaction?.kind === 'create' && interactionSlot
    ? buildPaperFrameDragGeometry(interaction.start, interaction.current)
    : null;
  const selectedOrFirstPageId = selectedPageId && spreadLayout.slots.some((slot) => slot.page?.id === selectedPageId)
    ? selectedPageId
    : spreadLayout.slots.find((slot) => slot.page)?.page?.id;
  const selectedOrFirstPage = selectedOrFirstPageId
    ? spreadLayout.slots.find((slot) => slot.page?.id === selectedOrFirstPageId)?.page
    : undefined;

  const resolveTarget = (event: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>, 'clientX' | 'clientY'>) =>
    resolveSpreadPointerTarget(event, spreadLayout.slots, pageRefs.current, zoom);

  return (
    <section className="flex items-start gap-3" data-paper-spread-view="true">
      {doc.view.showRulers ? (
        <div style={{ marginTop: PAPER_PASTEBOARD_PADDING_PX }}>
          <VerticalRuler
            height={pageHeightPx}
            grid={doc.layout.grid}
            onBeginGuideDrag={(event) => {
              const selectedPageEl = selectedOrFirstPageId ? pageRefs.current.get(selectedOrFirstPageId) : undefined;
              if (!selectedOrFirstPage || !selectedPageEl) return;
              beginGuideDragFromRuler({
                event,
                orientation: paperGuideOrientationFromRuler('vertical'),
                page: doc.page,
                pageEl: selectedPageEl,
                pageId: selectedOrFirstPage.id,
                zoom,
                grid: doc.layout.grid,
                onAddGuideToPage,
                onUpdateGuide,
              });
            }}
            zoom={zoom}
          />
        </div>
      ) : null}
      <div>
        {doc.view.showRulers ? (
          <div style={{ marginLeft: PAPER_PASTEBOARD_PADDING_PX }}>
            <HorizontalRuler
              onBeginGuideDrag={(event) => {
                const target = resolveTarget(event);
                const page = target?.page ?? selectedOrFirstPage;
                const fallbackPageEl = selectedOrFirstPageId ? pageRefs.current.get(selectedOrFirstPageId) : undefined;
                const pageEl = page ? pageRefs.current.get(page.id) : fallbackPageEl;
                if (!page || !pageEl) return;
                beginGuideDragFromRuler({
                  event,
                  orientation: paperGuideOrientationFromRuler('horizontal'),
                  page: doc.page,
                  pageEl,
                  pageId: page.id,
                  zoom,
                  grid: doc.layout.grid,
                  onAddGuideToPage,
                  onUpdateGuide,
                });
              }}
              width={pageWidthPx * spreadLayout.slots.length}
              grid={doc.layout.grid}
              zoom={zoom}
            />
          </div>
        ) : null}
        <div
          className="relative overflow-hidden"
          onClick={() => {
            if (suppressNextPageClickRef.current) {
              suppressNextPageClickRef.current = false;
              return;
            }
            if (tool === 'hand') return;
            const page = selectedOrFirstPage;
            if (!page) return;
            onSelectPage(page.id);
            onSelectFrame(null);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            const target = resolveTarget(event);
            if (!target) return;
            onOpenPageMenu(target.page.id, target.point, { x: event.clientX, y: event.clientY });
          }}
          onDragOver={(event) => {
            if (getDraggedSourceItemId(event.dataTransfer) || hasPaperPageImageFileDrag(event.dataTransfer)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDrop={(event) => {
            const itemId = getDraggedSourceItemId(event.dataTransfer);
            const shouldImportImageFiles = hasPaperPageImageFileDrag(event.dataTransfer);
            if (!itemId && !shouldImportImageFiles) return;
            const target = resolveTarget(event);
            if (!target) return;
            if (itemId) {
              onDropSourceItem(event, undefined, target.page.id, target.point);
              return;
            }
            void onDropPaperPageImageImportFiles(event, target.page.id, target.point);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (tool === 'hand') return;
            const target = resolveTarget(event);
            if (!target) {
              onSelectFrame(null);
              return;
            }
            onSelectPage(target.page.id);
            onSelectFrame(null);
            if (tool === 'shape') {
              event.preventDefault();
              onPolygonPoint(target.page.id, target.point);
              return;
            }
            if (tool === 'gutterKnife') {
              event.preventDefault();
              event.stopPropagation();
              suppressNextPageClickRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              onBeginGutterKnife?.(target.page.id, target.point);
              return;
            }
            if (!activeFrameKind) return;
            event.preventDefault();
            event.stopPropagation();
            suppressNextPageClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            onBeginCreate(target.page.id, target.point, activeFrameKind, activeShapeKind);
          }}
          onPointerMove={(event) => {
            const target = interaction ? { page: { id: interaction.pageId } } : resolveTarget(event);
            if (!target) return;
            const pageEl = pageRefs.current.get(target.page.id);
            if (!pageEl) return;
            onInteractionMove(clientPointToPageMm(event, pageEl, doc, zoom), { shiftKey: event.shiftKey });
          }}
          onPointerUp={(event) => {
            const target = interaction ? { page: { id: interaction.pageId } } : resolveTarget(event);
            const pageEl = target ? pageRefs.current.get(target.page.id) : null;
            if (pageEl) {
              onInteractionMove(clientPointToPageMm(event, pageEl, doc, zoom), { shiftKey: event.shiftKey });
            }
            onFinishInteraction();
          }}
          style={{ width: spreadWidthPx, height: spreadHeightPx, isolation: 'isolate' }}
        >
          {spreadLayout.slots.map((slot, slotIndex) => slot.page ? (
            <div
              className={`absolute overflow-visible bg-white text-slate-950 shadow-2xl ${
                slot.page.id === selectedPageId ? 'outline outline-2 outline-cyan-300/70' : 'outline outline-1 outline-black/30'
              }`}
              data-paper-page-id={slot.page.id}
              data-paper-page-number={slot.page.pageNumber}
              data-paper-page-view="true"
              key={slot.page.id}
              ref={(node) => {
                if (node) pageRefs.current.set(slot.page!.id, node);
                else pageRefs.current.delete(slot.page!.id);
              }}
              style={{
                left: slot.xMm * PX_PER_MM * zoom,
                top: slot.yMm * PX_PER_MM * zoom,
                width: pageWidthPx,
                height: pageHeightPx,
                background: paperDocumentBackgroundCss(doc.background),
              }}
            >
              <PaperSmartGuideOverlay
                guides={smartGuides.filter((guide) => guide.pageId === slot.page!.id)}
                zoom={zoom}
              />
              {doc.view.showGrid ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  data-paper-grid-snap-active={doc.view.snapToGrid ? 'true' : 'false'}
                  data-paper-editor-overlay="grid"
                  style={{
                    backgroundImage: paperGridOverlayBackground(doc.view.snapToGrid),
                    backgroundSize: `${gridSizePx}px ${gridSizePx}px`,
                  }}
                />
              ) : null}
              {doc.view.showBaselineGrid ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  data-paper-editor-overlay="baseline-grid"
                  style={{
                    backgroundImage: `repeating-linear-gradient(to bottom, rgba(56,189,248,0.3) 0, rgba(56,189,248,0.3) 1px, transparent 1px, transparent ${Math.max(2, doc.layout.baselineGrid.incrementMm * PX_PER_MM * zoom)}px)`,
                    backgroundPositionY: `${doc.layout.baselineGrid.startMm * PX_PER_MM * zoom}px`,
                  }}
                />
              ) : null}
              <div
                className="pointer-events-none absolute border border-dashed border-cyan-500/45"
                data-paper-editor-overlay="margins"
                style={{
                  left: doc.layout.marginsMm.left * PX_PER_MM * zoom,
                  top: doc.layout.marginsMm.top * PX_PER_MM * zoom,
                  right: doc.layout.marginsMm.right * PX_PER_MM * zoom,
                  bottom: doc.layout.marginsMm.bottom * PX_PER_MM * zoom,
                }}
              />
              <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-white/80 px-2 py-0.5 text-xs font-semibold text-slate-500" data-paper-editor-overlay="page-label">
                {slot.label} {slot.page.pageNumber}
              </div>
              {slotIndex === 0 ? <SpreadGutterRule pageHeightPx={pageHeightPx} pageWidthPx={pageWidthPx} zoom={zoom} /> : null}
            </div>
          ) : (
            <div
              className="absolute flex items-center justify-center border border-dashed border-cyan-100/15 bg-[#151b25] text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/25"
              key={`${spread.id}-${slot.side}`}
              style={{
                left: slot.xMm * PX_PER_MM * zoom,
                top: slot.yMm * PX_PER_MM * zoom,
                width: pageWidthPx,
                height: pageHeightPx,
              }}
            >
              {slot.label}
            </div>
          ))}
          {spreadLayout.slots.map((slot) => {
            if (!slot.page) return null;
            const pageOriginXPx = slot.xMm * PX_PER_MM * zoom;
            const pageOriginYPx = slot.yMm * PX_PER_MM * zoom;
            const outputFrames = resolvePaperPageFramesForCanvas(doc, slot.page);
            // Resolve catalog/condition values before thread flow, then retain the raw frame for editing.
            // This makes line breaks and overset truth match the derived output without ever writing values
            // back into the authored Paper document.
            const displayFrames = resolvePaperFramesTextTemplates(outputFrames, doc, slot.page.pageNumber);
            const displayFrameById = new Map(displayFrames.map((frame) => [frame.id, frame]));
            const frameLayers = buildPaperCanvasFrameLayers(outputFrames);
            const compoundBubbleFrameIds = getPaperCompoundBubbleFrameIds(outputFrames);
            const guidesForView = [...resolvePaperPageInheritedGuides(doc, slot.page), ...slot.page.guides];
            const threadSlices = computePaperThreadSlices(displayFrames, paperThreadTextMeasurer);

            return (
              <div key={`${slot.page.id}-content`}>
                <PaperBubbleConnectorsOverlay
                  frames={outputFrames}
                  onBeginConnectorHandle={(segment, handle) => onBeginBubbleConnectorHandle(slot.page!.id, segment, handle)}
                  pageHeightMm={doc.page.heightMm}
                  pageOriginXPx={pageOriginXPx}
                  pageOriginYPx={pageOriginYPx}
                  pageWidthMm={doc.page.widthMm}
                  selectedFrameIds={selectedFrameId ? [...new Set([selectedFrameId, ...selectedFrameIds])] : selectedFrameIds}
                  zoom={zoom}
                />
                {frameLayers
                  .filter(({ frame }) => tool !== 'tiltmark' || !isPaperTiltmarkPaintFrame(frame))
                  .map(({ frame, canvasZIndex }) => {
                    const displayFrame = displayFrameById.get(frame.id) ?? frame;
                    const threadSlice = threadSlices.get(frame.id);
                    return <PaperFrameView
                    canvasZIndex={canvasZIndex}
                    displayText={threadSlice?.sourceText ?? displayFrame.text ?? ''}
                    displayRichText={threadSlice?.richText ?? displayFrame.richText}
                    isThreadContinuation={threadSlice ? !threadSlice.isHead : false}
                    isOverset={threadSlice?.isOverset ?? false}
                    frame={frame}
                    pageId={slot.page!.id}
                    pageBackgroundCss={paperDocumentBackgroundCss(doc.background)}
                    wrapSpacers={resolveFrameWrapSpacers(frame, outputFrames)}
                    isSelected={frame.id === selectedFrameId || selectedFrameIds.includes(frame.id)}
                    key={frame.id}
                    showFrameEdges={doc.view.showFrameEdges}
                    suppressBubbleShape={compoundBubbleFrameIds.has(frame.id)}
                    showVertexHandles={shouldShowPaperVertexHandles(frame, {
                      isSelected: frame.id === selectedFrameId || selectedFrameIds.includes(frame.id),
                      modifierActive: vertexEditModifierActive,
                      vertexInteractionActive: interaction?.kind === 'frame-vertex' && interaction.frameId === frame.id,
                    })}
                    onBeginMove={(event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginMove(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginImageCropPan={(event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginImageCropPan(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginImageCropRotate={(event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginImageCropRotate(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginImageCropScale={(event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginImageCropScale(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginFrameVertexMove={(vertexIndex) => onBeginFrameVertexMove(slot.page!.id, frame, vertexIndex)}
                    onBeginFrameVertexInsert={(edgeIndex, event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginFrameVertexInsert(slot.page!.id, frame, edgeIndex, clientPointToPageMm(event, pageEl, doc, zoom), event.shiftKey);
                    }}
                    onDeleteFrameVertex={(vertexIndex) => onDeleteFrameVertex(slot.page!.id, frame, vertexIndex)}
                    onBeginResize={(handle, event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginResize(slot.page!.id, frame, handle, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginRotate={(event) => {
                      if (frame.inherited) return;
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginRotate(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginBubbleHandle={(handle) => onBeginBubbleHandle(slot.page!.id, frame, handle)}
                    onBeginBubbleTextMove={(event) => {
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginBubbleTextMove(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginBubbleTextResize={(handle, event) => {
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginBubbleTextResize(slot.page!.id, frame, handle, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onBeginBubbleTextRotate={(event) => {
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onBeginBubbleTextRotate(slot.page!.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
                    }}
                    onDropSourceItem={(event, frameId) => onDropSourceItem(event, frameId, slot.page!.id)}
                    onDropPaperPageImageImportFiles={(event, frameId) => onDropPaperPageImageImportFiles(event, slot.page!.id, undefined, frameId)}
                    onOpenMenu={(event) => {
                      const pageEl = pageRefs.current.get(slot.page!.id);
                      if (!pageEl) return;
                      onOpenFrameMenu(slot.page!.id, frame.id, clientPointToPageMm(event, pageEl, doc, zoom), { x: event.clientX, y: event.clientY });
                    }}
                    onSelect={(event) => onSelectFrame(frame.id, event)}
                    onDetachInherited={() => onDetachInheritedFrame(slot.page!.id, frame.id)}
                    onCommitText={(text, richText) => onCommitFrameText(slot.page!.id, frame.id, text, richText)}
                    onResolveImageNaturalSize={(naturalWidth, naturalHeight) => onResolveFrameImageNaturalSize(slot.page!.id, frame, naturalWidth, naturalHeight)}
                    onToggleImageFlipX={() => onToggleImageFlip(slot.page!.id, frame, 'x')}
                    onToggleImageFlipY={() => onToggleImageFlip(slot.page!.id, frame, 'y')}
                    pageNumber={slot.page!.pageNumber}
                    pageOriginPx={pageOriginXPx}
                    pageOriginYPx={pageOriginYPx}
                    tool={tool}
                    zoom={zoom}
                  />;
                  })}
                {tool === 'tiltmark' ? (
                  <PaperTiltmarkCanvasLayer
                    doc={doc}
                    leftPx={pageOriginXPx}
                    page={slot.page}
                    topPx={pageOriginYPx}
                    zoom={zoom}
                  />
                ) : null}
                {doc.view.showGuides ? guidesForView.map((guide) => (
                  <PaperGuideOverlay
                    guide={guide}
                    key={guide.id}
                    onBeginMove={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      onBeginGuideMove(slot.page!.id, guide.id, guide.orientation);
                    }}
                    pageHeightPx={pageHeightPx}
                    pageOriginPx={pageOriginXPx}
                    pageOriginYPx={pageOriginYPx}
                    pageWidthPx={pageWidthPx}
                    snapActive={doc.view.snapToGuides}
                    zoom={zoom}
                  />
                )) : null}
                {polygonPoints.filter((point) => point.pageId === slot.page!.id).map((point, index) => (
                  <span
                    className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500 shadow"
                    key={`${slot.page!.id}-${point.xMm}-${point.yMm}-${index}`}
                    style={{
                      left: pageOriginXPx + point.xMm * PX_PER_MM * zoom,
                      top: pageOriginYPx + point.yMm * PX_PER_MM * zoom,
                    }}
                  />
                ))}
                {doc.view.showBleed ? (
                  <PaperBleedOverlay
                    bleedMm={doc.page.bleedMm}
                    pageHeightPx={pageHeightPx}
                    pageOriginPx={pageOriginXPx}
                    pageOriginYPx={pageOriginYPx}
                    pageWidthPx={pageWidthPx}
                    zoom={zoom}
                  />
                ) : null}
                {paperPrintMarksEnabled(doc.printProduction.marks) ? (
                  <PaperPrintMarksOverlay
                    document={doc}
                    pageHeightPx={pageHeightPx}
                    pageOriginPx={pageOriginXPx}
                    pageOriginYPx={pageOriginYPx}
                    pageWidthPx={pageWidthPx}
                    zoom={zoom}
                  />
                ) : null}
                <PaperCutOverlay
                  pageHeightPx={pageHeightPx}
                  pageOriginPx={pageOriginXPx}
                  pageOriginYPx={pageOriginYPx}
                  pageWidthPx={pageWidthPx}
                />
              </div>
            );
          })}
          {previewGeometry && interactionSlot ? (
            <div
              className="pointer-events-none absolute border border-dashed border-cyan-500 bg-cyan-300/10"
              style={{
                left: interactionSlot.xMm * PX_PER_MM * zoom + previewGeometry.xMm * PX_PER_MM * zoom,
                top: interactionSlot.yMm * PX_PER_MM * zoom + previewGeometry.yMm * PX_PER_MM * zoom,
                width: previewGeometry.widthMm * PX_PER_MM * zoom,
                height: previewGeometry.heightMm * PX_PER_MM * zoom,
              }}
            />
          ) : null}
          {interaction?.kind === 'gutterKnife' && (() => {
            const slot = spreadLayout.slots.find((s) => s.page?.id === interaction.pageId);
            if (!slot) return null;
            const xOffsetPx = slot.xMm * PX_PER_MM * zoom;
            const yOffsetPx = slot.yMm * PX_PER_MM * zoom;
            return (
              <svg
                className="pointer-events-none absolute overflow-visible"
                style={{
                  left: xOffsetPx,
                  top: yOffsetPx,
                  width: pageWidthPx,
                  height: pageHeightPx,
                  zIndex: PAPER_PAGE_OVERLAY_Z + 10,
                }}
              >
                <line
                  x1={interaction.start.xMm * PX_PER_MM * zoom}
                  y1={interaction.start.yMm * PX_PER_MM * zoom}
                  x2={interaction.current.xMm * PX_PER_MM * zoom}
                  y2={interaction.current.yMm * PX_PER_MM * zoom}
                  stroke="#ec4899"
                  strokeDasharray="4 4"
                  strokeWidth={2 / zoom}
                />
              </svg>
            );
          })()}
        </div>
      </div>
    </section>
  );
}

function PaperPageView({
  doc,
  interaction,
  isSelected,
  onBeginBubbleConnectorHandle,
  onBeginCreate,
  onBeginGutterKnife,
  onBeginMove,
  onBeginResize,
  onBeginRotate,
  onBeginBubbleHandle,
  onBeginBubbleTextMove,
  onBeginBubbleTextResize,
  onBeginBubbleTextRotate,
  onBeginGuideMove,
  onBeginImageCropPan,
  onBeginImageCropRotate,
  onBeginImageCropScale,
  onBeginFrameVertexMove,
  onBeginFrameVertexInsert,
  onDeleteFrameVertex,
  onToggleImageFlip,
  onDropSourceItem,
  onDropPaperPageImageImportFiles,
  onFinishInteraction,
  onAddGuideToPage,
  onInteractionMove,
  onOpenFrameMenu,
  onOpenPageMenu,
  onPolygonPoint,
  onResolveFrameImageNaturalSize,
  onSelectFrame,
  onSelectPage,
  onCommitFrameText,
  onDetachInheritedFrame,
  onUpdateGuide,
  page,
  pageSideLabel,
  polygonPoints,
  selectedFrameId,
  selectedFrameIds,
  smartGuides,
  tool,
  vertexEditModifierActive,
  zoom,
}: {
  doc: PaperDocument;
  interaction: PaperInteraction | null;
  isSelected: boolean;
  onBeginCreate: (pageId: string, point: PaperPoint, frameKind: PaperFrameKind, shapeKind?: PaperFrame['shapeKind']) => void;
  onBeginGutterKnife?: (pageId: string, point: PaperPoint) => void;
  onBeginImageCropPan: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginImageCropRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginImageCropScale: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginFrameVertexMove: (pageId: string, frame: PaperFrame, vertexIndex: number) => void;
  onBeginFrameVertexInsert: (pageId: string, frame: PaperFrame, edgeIndex: number, point: PaperPoint, snapToBorder?: boolean) => void;
  onDeleteFrameVertex: (pageId: string, frame: PaperFrame, vertexIndex: number) => void;
  onToggleImageFlip: (pageId: string, frame: PaperFrame, axis: 'x' | 'y') => void;
  onBeginMove: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginResize: (pageId: string, frame: PaperFrame, handle: PaperResizeHandle, point: PaperPoint) => void;
  onBeginRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginBubbleConnectorHandle: (
    pageId: string,
    segment: PaperBubbleConnectorSegment,
    handle: PaperBubbleConnectorHandle,
  ) => void;
  onBeginBubbleHandle: (pageId: string, frame: PaperFrame, handle: PaperBubbleHandle) => void;
  onBeginBubbleTextMove: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginBubbleTextResize: (pageId: string, frame: PaperFrame, handle: PaperResizeHandle, point: PaperPoint) => void;
  onBeginBubbleTextRotate: (pageId: string, frame: PaperFrame, point: PaperPoint) => void;
  onBeginGuideMove: (pageId: string, guideId: string, orientation: PaperGuideOrientation) => void;
  onDropSourceItem: (event: React.DragEvent, frameId?: string, pageId?: string, point?: PaperPoint) => void;
  onDropPaperPageImageImportFiles: (event: React.DragEvent, pageId: string, point?: PaperPoint, frameId?: string) => void;
  onFinishInteraction: () => void;
  onAddGuideToPage: ReturnType<typeof usePaperStore.getState>['addGuideToPage'];
  onInteractionMove: (point: PaperPoint, modifiers?: PaperInteractionModifiers) => void;
  onOpenFrameMenu: (frameId: string, point: PaperPoint, screen: { x: number; y: number }) => void;
  onOpenPageMenu: (point: PaperPoint, screen: { x: number; y: number }) => void;
  onPolygonPoint: (point: PaperPoint) => void;
  onResolveFrameImageNaturalSize: (pageId: string, frame: PaperFrame, naturalWidth: number, naturalHeight: number) => void;
  onSelectFrame: (
    frameId: string | null,
    event?: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  ) => void;
  onSelectPage: () => void;
  onCommitFrameText: (pageId: string, frameId: string, text: string, richText?: PaperRichParagraph[]) => void;
  onDetachInheritedFrame: (frameId: string) => void;
  onUpdateGuide: ReturnType<typeof usePaperStore.getState>['updateGuide'];
  page: PaperPage;
  pageSideLabel?: string;
  polygonPoints: Array<PaperPoint & { pageId: string }>;
  selectedFrameId: string | null;
  selectedFrameIds: string[];
  smartGuides: Array<PaperSmartGuideLine & { pageId: string }>;
  tool: PaperTool;
  vertexEditModifierActive: boolean;
  zoom: number;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const suppressNextPageClickRef = useRef(false);
  const pageWidthPx = doc.page.widthMm * PX_PER_MM * zoom;
  const pageHeightPx = doc.page.heightMm * PX_PER_MM * zoom;
  const gridSizePx = doc.layout.grid.sizeMm * PX_PER_MM * zoom;
  const activeFrameKind = frameKindForTool(tool);
  const activeShapeKind = shapeKindForTool(tool);
  const previewGeometry = interaction?.kind === 'create' && interaction.pageId === page.id
    ? buildPaperFrameDragGeometry(interaction.start, interaction.current)
    : null;
  const pageStyle: React.CSSProperties = {
    width: pageWidthPx,
    height: pageHeightPx,
    left: PAPER_PASTEBOARD_PADDING_PX,
    top: PAPER_PASTEBOARD_PADDING_PX,
    background: paperDocumentBackgroundCss(doc.background),
  };
  const pasteboardStyle: React.CSSProperties = {
    width: pageWidthPx + PAPER_PASTEBOARD_PADDING_PX * 2,
    height: pageHeightPx + PAPER_PASTEBOARD_PADDING_PX * 2,
    isolation: 'isolate',
  };
  const outputFrames = resolvePaperPageFramesForCanvas(doc, page);
  // This compact spread fallback uses the same derived-text boundary as the connected canvas view.
  // Keep the raw frames for edit gestures and selection, while rendering a throwaway resolved copy.
  const displayFrameById = new Map(resolvePaperFramesTextTemplates(outputFrames, doc, page.pageNumber)
    .map((frame) => [frame.id, frame]));
  const frameLayers = buildPaperCanvasFrameLayers(outputFrames);
  const compoundBubbleFrameIds = getPaperCompoundBubbleFrameIds(outputFrames);
  const guidesForView = [...resolvePaperPageInheritedGuides(doc, page), ...page.guides];

  return (
    <section className="flex items-start gap-3">
      {doc.view.showRulers ? (
        <div style={{ marginTop: PAPER_PASTEBOARD_PADDING_PX }}>
          <VerticalRuler
            height={pageHeightPx}
            grid={doc.layout.grid}
            onBeginGuideDrag={(event) => {
              const pageEl = pageRef.current;
              if (!pageEl) return;
              beginGuideDragFromRuler({
                event,
                orientation: paperGuideOrientationFromRuler('vertical'),
                page: doc.page,
                pageEl,
                pageId: page.id,
                zoom,
                grid: doc.layout.grid,
                onAddGuideToPage,
                onUpdateGuide,
              });
            }}
            zoom={zoom}
          />
        </div>
      ) : null}
      <div>
        {doc.view.showRulers ? (
          <div style={{ marginLeft: PAPER_PASTEBOARD_PADDING_PX }}>
            <HorizontalRuler
              onBeginGuideDrag={(event) => {
                const pageEl = pageRef.current;
                if (!pageEl) return;
                beginGuideDragFromRuler({
                  event,
                  orientation: paperGuideOrientationFromRuler('horizontal'),
                  page: doc.page,
                  pageEl,
                  pageId: page.id,
                  zoom,
                  grid: doc.layout.grid,
                  onAddGuideToPage,
                  onUpdateGuide,
                });
              }}
              width={pageWidthPx}
              grid={doc.layout.grid}
              zoom={zoom}
            />
          </div>
        ) : null}
        <div
          className="relative overflow-hidden"
          onClick={() => {
            if (suppressNextPageClickRef.current) {
              suppressNextPageClickRef.current = false;
              return;
            }
            if (tool === 'hand') return;
            onSelectPage();
            onSelectFrame(null);
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (tool === 'hand') return;
            const pageEl = pageRef.current;
            if (!pageEl) return;
            onSelectPage();
            onSelectFrame(null);
            const point = clientPointToPageMm(event, pageEl, doc, zoom);
            if (tool === 'shape') {
              event.preventDefault();
              onPolygonPoint(point);
              return;
            }
            if (tool === 'gutterKnife') {
              event.preventDefault();
              event.stopPropagation();
              suppressNextPageClickRef.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              onBeginGutterKnife?.(page.id, point);
              return;
            }
            if (!activeFrameKind) return;
            event.preventDefault();
            event.stopPropagation();
            suppressNextPageClickRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            onBeginCreate(page.id, point, activeFrameKind, activeShapeKind);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            const pageEl = pageRef.current;
            if (!pageEl) return;
            const point = clientPointToPageMm(event, pageEl, doc, zoom);
            onOpenPageMenu(point, { x: event.clientX, y: event.clientY });
          }}
          onDragOver={(event) => {
            if (getDraggedSourceItemId(event.dataTransfer) || hasPaperPageImageFileDrag(event.dataTransfer)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onPointerMove={(event) => {
            const pageEl = pageRef.current;
            if (!pageEl) return;
            onInteractionMove(clientPointToPageMm(event, pageEl, doc, zoom), { shiftKey: event.shiftKey });
          }}
          onPointerUp={(event) => {
            const pageEl = pageRef.current;
            if (pageEl) {
              onInteractionMove(clientPointToPageMm(event, pageEl, doc, zoom), { shiftKey: event.shiftKey });
            }
            onFinishInteraction();
          }}
          onDrop={(event) => {
            const itemId = getDraggedSourceItemId(event.dataTransfer);
            const shouldImportImageFiles = hasPaperPageImageFileDrag(event.dataTransfer);
            if (!itemId && !shouldImportImageFiles) return;
            const pageEl = pageRef.current;
            if (!pageEl) return;
            const point = clientPointToPageMm(event, pageEl, doc, zoom);
            if (itemId) {
              onDropSourceItem(event, undefined, page.id, point);
              return;
            }
            void onDropPaperPageImageImportFiles(event, page.id, point);
          }}
          style={pasteboardStyle}
        >
          <div
            className={`absolute overflow-visible bg-white text-slate-950 shadow-2xl ${
              isSelected ? 'outline outline-2 outline-cyan-300/70' : 'outline outline-1 outline-black/30'
            }`}
            data-paper-page-id={page.id}
            data-paper-page-number={page.pageNumber}
            data-paper-page-view="true"
            ref={pageRef}
            style={pageStyle}
          >
            <PaperSmartGuideOverlay
              guides={smartGuides.filter((guide) => guide.pageId === page.id)}
              zoom={zoom}
            />
            {doc.view.showGrid ? (
              <div
                className="pointer-events-none absolute inset-0"
                data-paper-grid-snap-active={doc.view.snapToGrid ? 'true' : 'false'}
                data-paper-editor-overlay="grid"
                style={{
                  backgroundImage: paperGridOverlayBackground(doc.view.snapToGrid),
                  backgroundSize: `${gridSizePx}px ${gridSizePx}px`,
                }}
              />
            ) : null}
            {doc.view.showBaselineGrid ? (
              <div
                className="pointer-events-none absolute inset-0"
                data-paper-editor-overlay="baseline-grid"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, rgba(56,189,248,0.3) 0, rgba(56,189,248,0.3) 1px, transparent 1px, transparent ${Math.max(2, doc.layout.baselineGrid.incrementMm * PX_PER_MM * zoom)}px)`,
                  backgroundPositionY: `${doc.layout.baselineGrid.startMm * PX_PER_MM * zoom}px`,
                }}
              />
            ) : null}
            <div
              className="pointer-events-none absolute border border-dashed border-cyan-500/45"
              data-paper-editor-overlay="margins"
              style={{
                left: doc.layout.marginsMm.left * PX_PER_MM * zoom,
                top: doc.layout.marginsMm.top * PX_PER_MM * zoom,
                right: doc.layout.marginsMm.right * PX_PER_MM * zoom,
                bottom: doc.layout.marginsMm.bottom * PX_PER_MM * zoom,
              }}
            />
            <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-white/80 px-2 py-0.5 text-xs font-semibold text-slate-500" data-paper-editor-overlay="page-label">
              {pageSideLabel ? `${pageSideLabel} ${page.pageNumber}` : page.pageNumber}
            </div>
          </div>
          <PaperBubbleConnectorsOverlay
            frames={outputFrames}
            onBeginConnectorHandle={(segment, handle) => onBeginBubbleConnectorHandle(page.id, segment, handle)}
            pageHeightMm={doc.page.heightMm}
            pageOriginXPx={PAPER_PASTEBOARD_PADDING_PX}
            pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
            pageWidthMm={doc.page.widthMm}
            selectedFrameIds={selectedFrameId ? [...new Set([selectedFrameId, ...selectedFrameIds])] : selectedFrameIds}
            zoom={zoom}
          />
          {frameLayers
            .filter(({ frame }) => tool !== 'tiltmark' || !isPaperTiltmarkPaintFrame(frame))
            .map(({ frame, canvasZIndex }) => {
              const displayFrame = displayFrameById.get(frame.id) ?? frame;
              return <PaperFrameView
              canvasZIndex={canvasZIndex}
              displayRichText={displayFrame.richText}
              displayText={displayFrame.text}
              frame={frame}
              pageId={page.id}
              isSelected={frame.id === selectedFrameId || selectedFrameIds.includes(frame.id)}
              key={frame.id}
              pageBackgroundCss={paperDocumentBackgroundCss(doc.background)}
              showFrameEdges={doc.view.showFrameEdges}
              suppressBubbleShape={compoundBubbleFrameIds.has(frame.id)}
              showVertexHandles={shouldShowPaperVertexHandles(frame, {
                isSelected: frame.id === selectedFrameId || selectedFrameIds.includes(frame.id),
                modifierActive: vertexEditModifierActive,
                vertexInteractionActive: interaction?.kind === 'frame-vertex' && interaction.frameId === frame.id,
              })}
              onBeginMove={(event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginMove(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginImageCropPan={(event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginImageCropPan(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginImageCropRotate={(event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginImageCropRotate(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginImageCropScale={(event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginImageCropScale(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginFrameVertexMove={(vertexIndex) => onBeginFrameVertexMove(page.id, frame, vertexIndex)}
              onBeginFrameVertexInsert={(edgeIndex, event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginFrameVertexInsert(page.id, frame, edgeIndex, clientPointToPageMm(event, pageEl, doc, zoom), event.shiftKey);
              }}
              onDeleteFrameVertex={(vertexIndex) => onDeleteFrameVertex(page.id, frame, vertexIndex)}
              onBeginResize={(handle, event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginResize(page.id, frame, handle, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginRotate={(event) => {
                if (frame.inherited) return;
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginRotate(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginBubbleHandle={(handle) => onBeginBubbleHandle(page.id, frame, handle)}
              onBeginBubbleTextMove={(event) => {
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginBubbleTextMove(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginBubbleTextResize={(handle, event) => {
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginBubbleTextResize(page.id, frame, handle, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onBeginBubbleTextRotate={(event) => {
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onBeginBubbleTextRotate(page.id, frame, clientPointToPageMm(event, pageEl, doc, zoom));
              }}
              onDropSourceItem={(event, frameId) => onDropSourceItem(event, frameId, page.id)}
              onDropPaperPageImageImportFiles={(event, frameId) => onDropPaperPageImageImportFiles(event, page.id, undefined, frameId)}
              onOpenMenu={(event) => {
                const pageEl = pageRef.current;
                if (!pageEl) return;
                onOpenFrameMenu(frame.id, clientPointToPageMm(event, pageEl, doc, zoom), { x: event.clientX, y: event.clientY });
              }}
              onSelect={(event) => onSelectFrame(frame.id, event)}
              onDetachInherited={() => onDetachInheritedFrame(frame.id)}
              onCommitText={(text, richText) => onCommitFrameText(page.id, frame.id, text, richText)}
              onResolveImageNaturalSize={(naturalWidth, naturalHeight) => onResolveFrameImageNaturalSize(page.id, frame, naturalWidth, naturalHeight)}
              onToggleImageFlipX={() => onToggleImageFlip(page.id, frame, 'x')}
              onToggleImageFlipY={() => onToggleImageFlip(page.id, frame, 'y')}
              pageNumber={page.pageNumber}
              pageOriginPx={PAPER_PASTEBOARD_PADDING_PX}
              pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
              tool={tool}
              zoom={zoom}
            />;
            })}
          {tool === 'tiltmark' ? (
            <PaperTiltmarkCanvasLayer
              doc={doc}
              leftPx={PAPER_PASTEBOARD_PADDING_PX}
              page={page}
              topPx={PAPER_PASTEBOARD_PADDING_PX}
              zoom={zoom}
            />
          ) : null}
          {doc.view.showGuides ? guidesForView.map((guide) => (
            <PaperGuideOverlay
              guide={guide}
              key={guide.id}
              onBeginMove={(event) => {
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                onBeginGuideMove(page.id, guide.id, guide.orientation);
              }}
              pageHeightPx={pageHeightPx}
              pageOriginPx={PAPER_PASTEBOARD_PADDING_PX}
              pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
              pageWidthPx={pageWidthPx}
              snapActive={doc.view.snapToGuides}
              zoom={zoom}
            />
          )) : null}
          {polygonPoints.map((point, index) => (
            <span
              className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-500 shadow"
              key={`${point.xMm}-${point.yMm}-${index}`}
              style={{
                left: PAPER_PASTEBOARD_PADDING_PX + point.xMm * PX_PER_MM * zoom,
                top: PAPER_PASTEBOARD_PADDING_PX + point.yMm * PX_PER_MM * zoom,
              }}
            />
          ))}
          {previewGeometry ? (
            <div
              className="pointer-events-none absolute border border-dashed border-cyan-500 bg-cyan-300/10"
              style={{
                left: PAPER_PASTEBOARD_PADDING_PX + previewGeometry.xMm * PX_PER_MM * zoom,
                top: PAPER_PASTEBOARD_PADDING_PX + previewGeometry.yMm * PX_PER_MM * zoom,
                width: previewGeometry.widthMm * PX_PER_MM * zoom,
                height: previewGeometry.heightMm * PX_PER_MM * zoom,
              }}
            />
          ) : null}
          {interaction?.kind === 'gutterKnife' && interaction.pageId === page.id ? (
            <svg
              className="pointer-events-none absolute overflow-visible"
              style={{
                left: PAPER_PASTEBOARD_PADDING_PX,
                top: PAPER_PASTEBOARD_PADDING_PX,
                width: pageWidthPx,
                height: pageHeightPx,
                zIndex: PAPER_PAGE_OVERLAY_Z + 10,
              }}
            >
              <line
                x1={interaction.start.xMm * PX_PER_MM * zoom}
                y1={interaction.start.yMm * PX_PER_MM * zoom}
                x2={interaction.current.xMm * PX_PER_MM * zoom}
                y2={interaction.current.yMm * PX_PER_MM * zoom}
                stroke="#ec4899"
                strokeDasharray="4 4"
                strokeWidth={2 / zoom}
              />
            </svg>
          ) : null}
          {doc.view.showBleed ? (
            <PaperBleedOverlay
              bleedMm={doc.page.bleedMm}
              pageHeightPx={pageHeightPx}
              pageOriginPx={PAPER_PASTEBOARD_PADDING_PX}
              pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
              pageWidthPx={pageWidthPx}
              zoom={zoom}
            />
          ) : null}
          {paperPrintMarksEnabled(doc.printProduction.marks) ? (
            <PaperPrintMarksOverlay
              document={doc}
              pageHeightPx={pageHeightPx}
              pageOriginPx={PAPER_PASTEBOARD_PADDING_PX}
              pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
              pageWidthPx={pageWidthPx}
              zoom={zoom}
            />
          ) : null}
          <PaperCutOverlay
            pageHeightPx={pageHeightPx}
            pageOriginPx={PAPER_PASTEBOARD_PADDING_PX}
            pageOriginYPx={PAPER_PASTEBOARD_PADDING_PX}
            pageWidthPx={pageWidthPx}
          />
        </div>
      </div>
    </section>
  );
}

function PaperVirtualSpreadPlaceholder({ metric }: { metric: PaperSpreadVirtualMetric }) {
  return (
    <section
      aria-hidden="true"
      className="pointer-events-none"
      style={{
        minWidth: metric.widthPx,
        height: metric.heightPx,
      }}
    />
  );
}

function PaperBlankSpreadSlot({ doc, label, zoom }: { doc: PaperDocument; label: string; zoom: number }) {
  const pageWidthPx = doc.page.widthMm * PX_PER_MM * zoom;
  const pageHeightPx = doc.page.heightMm * PX_PER_MM * zoom;
  const pasteboardStyle: React.CSSProperties = {
    width: pageWidthPx + PAPER_PASTEBOARD_PADDING_PX * 2,
    height: pageHeightPx + PAPER_PASTEBOARD_PADDING_PX * 2 + (doc.view.showRulers ? 25 : 0),
  };

  return (
    <section className="flex items-start gap-3 opacity-45" aria-label={label}>
      {doc.view.showRulers ? <div className="w-5" /> : null}
      <div>
        {doc.view.showRulers ? <div className="mb-1 h-5" style={{ marginLeft: PAPER_PASTEBOARD_PADDING_PX, width: pageWidthPx }} /> : null}
        <div className="relative" style={pasteboardStyle}>
          <div
            className="absolute flex items-center justify-center border border-dashed border-cyan-100/15 bg-[#151b25] text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/25"
            style={{
              left: PAPER_PASTEBOARD_PADDING_PX,
              top: PAPER_PASTEBOARD_PADDING_PX,
              width: pageWidthPx,
              height: pageHeightPx,
            }}
          >
            {label}
          </div>
        </div>
      </div>
    </section>
  );
}

function SpreadGutterRule({
  pageHeightPx,
  pageWidthPx,
  zoom,
}: {
  pageHeightPx: number;
  pageWidthPx: number;
  zoom: number;
}) {
  return (
    <div
      aria-label="Spread gutter guide"
      className="pointer-events-none absolute bottom-0 top-0 border-r border-dashed border-rose-300/70 text-rose-100/70"
      data-paper-editor-overlay="spread-gutter"
      style={{ left: pageWidthPx - 1, height: pageHeightPx, zIndex: PAPER_PAGE_OVERLAY_Z }}
    >
      <span
        className="absolute left-1 top-2 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] [writing-mode:vertical-rl]"
        style={{ transform: `scale(${Math.max(0.8, Math.min(1.2, zoom))})`, transformOrigin: 'top left' }}
      >
        Gutter
      </span>
    </div>
  );
}

function resolveSpreadPointerTarget(
  event: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement> | React.DragEvent<HTMLElement>, 'clientX' | 'clientY'>,
  slots: LivePaperSpreadSlot[],
  pageRefs: Map<string, HTMLDivElement>,
  zoom: number,
): { page: PaperPage; point: PaperPoint } | null {
  for (const slot of slots) {
    if (!slot.page) continue;
    const pageEl = pageRefs.get(slot.page.id);
    if (!pageEl) continue;
    const rect = pageEl.getBoundingClientRect();
    if (
      event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom
    ) {
      return {
        page: slot.page,
        point: clientPointToPaperPoint(event, rect, zoom),
      };
    }
  }
  return null;
}

function PaperGuideOverlay({
  guide,
  onBeginMove,
  pageHeightPx,
  pageOriginPx,
  pageOriginYPx = pageOriginPx,
  pageWidthPx,
  snapActive,
  zoom,
}: {
  guide: PaperGuide;
  onBeginMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  pageHeightPx: number;
  pageOriginPx: number;
  pageOriginYPx?: number;
  pageWidthPx: number;
  snapActive: boolean;
  zoom: number;
}) {
  const positionPx = guide.positionMm * PX_PER_MM * zoom;
  const isVertical = guide.orientation === 'vertical';

  return (
    <div
      aria-label={guide.label ?? (isVertical ? 'Vertical guide' : 'Horizontal guide')}
      className={`absolute z-30 touch-none ${
        isVertical ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
      data-paper-editor-overlay="guide"
      data-paper-guide-snap-active={snapActive ? 'true' : 'false'}
      onPointerDown={onBeginMove}
      role="separator"
      style={isVertical
        ? {
            left: pageOriginPx + positionPx - 5,
            top: pageOriginYPx,
            width: 10,
            height: pageHeightPx,
            zIndex: PAPER_GUIDE_OVERLAY_Z,
          }
        : {
            left: pageOriginPx,
            top: pageOriginYPx + positionPx - 5,
            width: pageWidthPx,
            height: 10,
            zIndex: PAPER_GUIDE_OVERLAY_Z,
          }}
      title="Drag to move guide"
    >
      <div
        className="pointer-events-none absolute"
        style={isVertical
          ? { left: 5, top: 0, width: 1, height: '100%', backgroundColor: paperGuideOverlayColor(snapActive) }
          : { left: 0, top: 5, width: '100%', height: 1, backgroundColor: paperGuideOverlayColor(snapActive) }}
      />
    </div>
  );
}

function PaperCutOverlay({
  pageHeightPx,
  pageOriginPx,
  pageOriginYPx = pageOriginPx,
  pageWidthPx,
}: {
  pageHeightPx: number;
  pageOriginPx: number;
  pageOriginYPx?: number;
  pageWidthPx: number;
}) {
  return (
    <div
      className="pointer-events-none absolute border-2 border-cyan-200/90 shadow-[0_0_0_1px_rgba(8,145,178,0.28)]"
      data-paper-editor-overlay="cut"
      style={{
        left: pageOriginPx,
        top: pageOriginYPx,
        width: pageWidthPx,
        height: pageHeightPx,
        zIndex: PAPER_CUT_OVERLAY_Z,
      }}
    >
      <span className="absolute right-1 top-1 rounded bg-cyan-700/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
        Cut
      </span>
    </div>
  );
}

function PaperBleedOverlay({
  bleedMm,
  pageHeightPx,
  pageOriginPx,
  pageOriginYPx = pageOriginPx,
  pageWidthPx,
  zoom,
}: {
  bleedMm: number;
  pageHeightPx: number;
  pageOriginPx: number;
  pageOriginYPx?: number;
  pageWidthPx: number;
  zoom: number;
}) {
  const bleedPx = bleedMm * PX_PER_MM * zoom;

  if (bleedPx <= 0) return null;

  return (
    <div
      className="pointer-events-none absolute border-2 border-rose-400/80 shadow-[0_0_0_1px_rgba(15,23,42,0.45)]"
      data-paper-editor-overlay="bleed"
      style={{
        left: pageOriginPx - bleedPx,
        top: pageOriginYPx - bleedPx,
        width: pageWidthPx + bleedPx * 2,
        height: pageHeightPx + bleedPx * 2,
        zIndex: PAPER_PAGE_OVERLAY_Z,
      }}
    >
      <span className="absolute left-1 top-1 rounded bg-rose-500/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
        Bleed
      </span>
    </div>
  );
}

function PaperPrintMarksOverlay({
  document,
  pageOriginPx,
  pageOriginYPx,
  zoom,
}: {
  document: PaperDocument;
  pageHeightPx: number;
  pageOriginPx: number;
  pageOriginYPx: number;
  pageWidthPx: number;
  zoom: number;
}) {
  const sheet = buildPaperPrintSheetPlan(document.page, document.printProduction);
  const screenPxPerPt = (25.4 / 72) * PX_PER_MM * zoom;
  const left = pageOriginPx - sheet.trimBox.xPt * screenPxPerPt;
  const top = pageOriginYPx - sheet.trimBox.yTopPt * screenPxPerPt;
  const cmykPreview = (color: { c: number; m: number; y: number; k: number }) => {
    const channel = (primary: number) => Math.round(255 * (1 - primary) * (1 - color.k));
    return `rgb(${channel(color.c)}, ${channel(color.m)}, ${channel(color.y)})`;
  };

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute overflow-visible"
      data-paper-print-marks-overlay="true"
      preserveAspectRatio="none"
      style={{
        height: sheet.mediaBox.heightPt * screenPxPerPt,
        left,
        top,
        width: sheet.mediaBox.widthPt * screenPxPerPt,
        zIndex: PAPER_PAGE_OVERLAY_Z + 6,
      }}
      viewBox={`0 0 ${sheet.mediaBox.widthPt} ${sheet.mediaBox.heightPt}`}
    >
      {sheet.cropMarks.map((mark) => (
        <line
          data-production-mark={mark.id}
          key={mark.id}
          stroke="#111827"
          strokeWidth={mark.strokeWidthPt}
          x1={mark.x1Pt}
          x2={mark.x2Pt}
          y1={mark.y1TopPt}
          y2={mark.y2TopPt}
        />
      ))}
      {sheet.registrationMarks.map((mark) => (
        <g data-production-mark={mark.id} key={mark.id} stroke="#111827" strokeWidth={mark.strokeWidthPt}>
          <circle cx={mark.centerXPt} cy={mark.centerYTopPt} fill="none" r={mark.radiusPt} />
          <line x1={mark.centerXPt - mark.crossArmPt} x2={mark.centerXPt + mark.crossArmPt} y1={mark.centerYTopPt} y2={mark.centerYTopPt} />
          <line x1={mark.centerXPt} x2={mark.centerXPt} y1={mark.centerYTopPt - mark.crossArmPt} y2={mark.centerYTopPt + mark.crossArmPt} />
        </g>
      ))}
      {sheet.colorBars.map((patch) => (
        <rect
          data-production-mark={patch.id}
          fill={cmykPreview(patch.cmyk)}
          height={patch.rect.heightPt}
          key={patch.id}
          width={patch.rect.widthPt}
          x={patch.rect.xPt}
          y={patch.rect.yTopPt}
        />
      ))}
      {sheet.slugBox && sheet.slugText ? (
        <foreignObject
          height={sheet.slugBox.heightPt}
          width={sheet.slugBox.widthPt}
          x={sheet.slugBox.xPt}
          y={sheet.slugBox.yTopPt}
        >
          <div
            className="overflow-hidden px-1 text-slate-800"
            style={{ font: '7pt/1.25 Arial, sans-serif', paddingTop: '4pt' }}
          >
            {sheet.slugText}
          </div>
        </foreignObject>
      ) : null}
    </svg>
  );
}

const paperThreadTextMeasurer = createPaperCanvasMeasurer();

/**
 * Live "is this frame's rendered content taller than its own box" signal for the editor-only overset
 * indicator (see frameOverflow.ts for the pure decision and PaperFrameView for how the ref/deps are wired).
 * Deliberately measures the real DOM (`scrollHeight` vs `clientHeight`) on every change to anything that can
 * affect the rendered text's height, rather than reusing the thread-flow text-layout estimator
 * (computePaperThreadSlices/flowPaperText) — see this feature's commit for why that estimator's metrics can
 * drift from what actually renders. Returns false whenever `ref` isn't attached to anything (e.g. the frame
 * isn't a plain text/caption frame, or it's mid-edit and the editor overlay has replaced the measured node).
 */
function usePaperFrameContentOverset(ref: React.RefObject<HTMLElement | null>, deps: React.DependencyList): boolean {
  const [overset, setOverset] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    setOverset(el ? isFrameContentOverset(el.scrollHeight, el.clientHeight) : false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return overset;
}

/**
 * Browser-native and active-edit text cannot expose HarfBuzz's exact line origins. Keep the global baseline
 * switch useful for those frames by drawing their own leading rhythm inside the text box. Managed preview
 * frames draw exact composed baselines in PaperManagedTextLayer instead. This overlay is editor-only.
 */
function PaperTextBaselineRhythmOverlay({ frame, zoom }: { frame: PaperFrame; zoom: number }) {
  const textBox = resolvePaperTextBox(frame);
  const isBubble = frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
  const vertical = frame.typography.writingMode === 'vertical-rl';
  const leadingPx = Math.max(2, frame.typography.leadingPt * PT_TO_PX * zoom);
  const fontSizePx = Math.max(1, frame.typography.fontSizePt * PT_TO_PX * zoom);
  const insetPx = paperFrameContentPaddingPx(frame, zoom);
  const baselineOffsetPx = Math.min(leadingPx - 0.5, Math.max(1, fontSizePx * 0.82));
  const lineColor = 'rgba(34, 211, 238, 0.78)';
  const style: React.CSSProperties = {
    left: isBubble ? `${textBox.xPercent}%` : insetPx,
    top: isBubble ? `${textBox.yPercent}%` : insetPx,
    width: isBubble ? `${textBox.widthPercent}%` : `calc(100% - ${insetPx * 2}px)`,
    height: isBubble ? `${textBox.heightPercent}%` : `calc(100% - ${insetPx * 2}px)`,
    transform: isBubble && textBox.rotationDeg ? `rotate(${textBox.rotationDeg}deg)` : undefined,
    transformOrigin: 'center',
    backgroundImage: vertical
      ? `repeating-linear-gradient(to left, transparent 0, transparent ${Math.max(0, leadingPx - 1)}px, ${lineColor} ${Math.max(0, leadingPx - 1)}px, ${lineColor} ${leadingPx}px)`
      : `repeating-linear-gradient(to bottom, transparent 0, transparent ${Math.max(0, leadingPx - 1)}px, ${lineColor} ${Math.max(0, leadingPx - 1)}px, ${lineColor} ${leadingPx}px)`,
    backgroundPosition: vertical
      ? `${Math.max(0, fontSizePx * 0.5 - leadingPx)}px 0`
      : `0 ${baselineOffsetPx - leadingPx}px`,
  };

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-40 overflow-hidden"
      data-paper-editor-overlay="text-baselines"
      data-paper-text-baseline-mode="leading-rhythm"
      style={style}
    />
  );
}

function PaperFrameView({
  canvasZIndex,
  frame,
  pageId,
  displayText,
  displayRichText,
  wrapSpacers = [],
  isThreadContinuation = false,
  isOverset = false,
  isSelected,
  onBeginImageCropPan,
  onBeginImageCropRotate,
  onBeginImageCropScale,
  onBeginFrameVertexMove,
  onBeginFrameVertexInsert,
  onBeginMove,
  onBeginResize,
  onBeginRotate,
  onBeginBubbleHandle,
  onBeginBubbleTextMove,
  onBeginBubbleTextResize,
  onBeginBubbleTextRotate,
  onDropSourceItem,
  onDropPaperPageImageImportFiles,
  onOpenMenu,
  onSelect,
  onDetachInherited,
  onCommitText,
  onResolveImageNaturalSize,
  onDeleteFrameVertex,
  onToggleImageFlipX,
  onToggleImageFlipY,
  pageBackgroundCss,
  pageNumber,
  pageOriginPx,
  pageOriginYPx = pageOriginPx,
  showVertexHandles,
  showFrameEdges = false,
  suppressBubbleShape = false,
  tool,
  zoom,
}: {
  canvasZIndex: number;
  frame: PaperFrame;
  pageId: string;
  displayText?: string;
  displayRichText?: PaperRichParagraph[];
  wrapSpacers?: PaperWrapSpacer[];
  isThreadContinuation?: boolean;
  isOverset?: boolean;
  isSelected: boolean;
  onBeginImageCropPan: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginImageCropRotate: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginImageCropScale: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginFrameVertexMove: (vertexIndex: number) => void;
  onBeginFrameVertexInsert: (edgeIndex: number, event: React.PointerEvent<HTMLElement>) => void;
  onBeginMove: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginResize: (handle: PaperResizeHandle, event: React.PointerEvent<HTMLElement>) => void;
  onBeginRotate: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginBubbleHandle: (handle: PaperBubbleHandle) => void;
  onBeginBubbleTextMove: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginBubbleTextResize: (handle: PaperResizeHandle, event: React.PointerEvent<HTMLElement>) => void;
  onBeginBubbleTextRotate: (event: React.PointerEvent<HTMLElement>) => void;
  onDropSourceItem: (event: React.DragEvent, frameId?: string) => void;
  onDropPaperPageImageImportFiles: (event: React.DragEvent, frameId?: string) => void;
  onOpenMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onSelect: (event?: Pick<React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>, 'ctrlKey' | 'metaKey' | 'shiftKey'>) => void;
  onDetachInherited: () => void;
  onCommitText: (text: string, richText?: PaperRichParagraph[]) => void;
  onResolveImageNaturalSize: (naturalWidth: number, naturalHeight: number) => void;
  onDeleteFrameVertex: (vertexIndex: number) => void;
  onToggleImageFlipX: () => void;
  onToggleImageFlipY: () => void;
  /** Resolved CSS for the document/page background (paperDocumentBackgroundCss(doc.background)) — threaded
   *  down to the in-canvas text editor so it can decide whether its editing surface needs a readability
   *  backdrop (see editorContrast.ts). Editor-chrome concern only; never applied to document rendering. */
  pageBackgroundCss: string;
  pageNumber: number;
  pageOriginPx: number;
  pageOriginYPx?: number;
  showVertexHandles: boolean;
  showFrameEdges?: boolean;
  suppressBubbleShape?: boolean;
  tool: PaperTool;
  zoom: number;
}) {
  const [textEditing, setTextEditing] = useState(false);
  const [textDraft, setTextDraft] = useState(frame.text ?? '');
  const [managedTextReady, setManagedTextReady] = useState(false);
  const lastContextMenuAtRef = useRef(0);
  const managedTextDocument = usePaperStore((state) => state.document);
  const sourceBins = useSourceBinStore((state) => state.bins);
  const sourceItem = useMemo(
    () => frame.asset?.sourceBinItemId
      ? sourceBins.flatMap((bin) => bin.items).find((item) => item.id === frame.asset?.sourceBinItemId)
      : undefined,
    [frame.asset?.sourceBinItemId, sourceBins],
  );
  const managedAssetUrl = usePaperAssetUrl(frame.asset, sourceItem);
  const assetUrl = managedAssetUrl
    ?? (frame.comicSfxDesign ? paperComicSfxDesignToDataUrl(frame.comicSfxDesign) : undefined);
  // Live "does the rendered text clip its own box" signal for the overset indicator badge below — measured
  // from the actual DOM (see usePaperFrameContentOverset), not the thread-flow text estimator, so it reflects
  // exactly what's clipping on screen. Only meaningful for plain text/caption frames (see isPlainInlineTextFrame
  // below); the ref is left unattached for every other kind, so contentOverset stays false for them.
  const contentMeasureRef = useRef<HTMLDivElement | null>(null);
  const contentOverset = usePaperFrameContentOverset(contentMeasureRef, [
    displayText ?? frame.text,
    displayRichText ?? frame.richText,
    frame.typography,
    frame.widthMm,
    frame.heightMm,
    frame.columns,
    zoom,
    textEditing,
  ]);
  const contentClipPath = clipPathForFrame(frame);
  const hasImageContent = isImageCropFrame(frame);
  const imageContentClipPath = hasImageContent ? clipPathForImageContentFrame(frame) : undefined;
  const effectiveClipPath = imageContentClipPath ?? contentClipPath;
  const hasShapeStrokeOverlay = Boolean(contentClipPath) || Boolean(hasImageContent && imageContentClipPath && frame.kind === 'shape');
  const baselineGrid = frame.typography.alignToBaselineGrid && frame.typography.writingMode !== 'vertical-rl'
    ? managedTextDocument.layout.baselineGrid
    : undefined;
  const baselineLeadingPt = resolvePaperBaselineLeadingPt(frame.typography.leadingPt, baselineGrid);
  const contentPaddingPx = paperFrameContentPaddingPx(frame, zoom);
  const contentPaddingMm = contentPaddingPx / (PX_PER_MM * zoom);
  const baselineTopInsetPx = resolvePaperBaselineTopInsetMm(
    frame.yMm + contentPaddingMm,
    baselineLeadingPt,
    baselineGrid,
  ) * PX_PER_MM * zoom;
  const frameStyle: React.CSSProperties = {
    left: pageOriginPx + frame.xMm * PX_PER_MM * zoom,
    top: pageOriginYPx + frame.yMm * PX_PER_MM * zoom,
    width: frame.widthMm * PX_PER_MM * zoom,
    height: frame.heightMm * PX_PER_MM * zoom,
    transform: `rotate(${frame.rotationDeg}deg)`,
    // A selected frame floats just below the guide/bleed overlays so its edit handles are reachable even
    // when the frame sits underneath other frames in the stack. Unselected frames keep their normal
    // stacking order. (PAPER_GUIDE_OVERLAY_Z - 1 is above every frame's canvasZIndex, below the overlays.)
    zIndex: isSelected ? PAPER_GUIDE_OVERLAY_Z - 1 : canvasZIndex,
    opacity: resolvePaperCanvasFrameOpacity(frame),
    pointerEvents: tool === 'select' || tool === 'eyedropper' ? 'auto' : 'none',
  };
  const contentStyle: React.CSSProperties = {
    background: frame.kind === 'shape' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble'
      ? 'transparent'
      : frameFillCss(frame),
    border: frame.kind === 'shape' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' || hasShapeStrokeOverlay
      ? 0
      : frame.strokeWidthMm > 0
        // A frame with a real stroke keeps a min-1px hairline so it stays visible at low zoom. A frame with
        // strokeWidthMm 0 (imported document paragraphs/images, any borderless frame) paints NO border —
        // the old Math.max(1, …) forced a 1px stroke-coloured box even when the stroke width was zero.
        ? `${Math.max(1, frame.strokeWidthMm * PX_PER_MM * zoom)}px ${frame.strokeStyle} ${frame.strokeColor}`
        : 0,
    borderRadius: effectiveClipPath
      ? 0
      : frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble'
        ? '999px'
        : frame.cornerRadiusMm * PX_PER_MM * zoom,
    color: frame.typography.color,
    fontFamily: paperManagedFontFamilyForLivePaint(frame.typography, managedTextDocument.importedFonts) ?? frame.typography.fontFamily,
    fontSize: frame.typography.fontSizePt * PT_TO_PX * zoom,
    lineHeight: `${baselineLeadingPt * PT_TO_PX * zoom}px`,
    fontWeight: frame.typography.fontWeight,
    fontStyle: frame.typography.fontStyle,
    fontKerning: frame.typography.fontKerning ?? 'auto',
    textAlign: frame.typography.align,
    letterSpacing: `${frame.typography.tracking / 1000}em`,
    textIndent: frame.typography.firstLineIndentMm
      ? `${(frame.typography.firstLineIndentMm * PX_PER_MM * zoom).toFixed(2)}px each-line`
      : undefined,
    textAlignLast: frame.typography.alignLast && frame.typography.alignLast !== 'auto'
      ? frame.typography.alignLast
      : undefined,
    fontVariantCaps: frame.typography.smallCaps ? 'small-caps' : undefined,
    fontVariantNumeric: paperNumericStyleToCss(frame.typography.numericStyle),
    textWrapStyle: frame.typography.lineBreak && frame.typography.lineBreak !== 'auto'
      ? frame.typography.lineBreak
      : undefined,
    hyphens: frame.typography.hyphenate ? 'auto' : 'manual',
    // Japanese 縦書き (tategaki). `vertical-rl` flows glyphs top→bottom and columns right→left — the reading
    // direction for manga and Japanese prose. `text-orientation: mixed` (default) keeps CJK upright and lays
    // Latin on its side; `upright` forces every glyph upright. Kinsoku (禁則処理) via `line-break: strict` is on
    // by default in vertical text so 、。」 never open a line and 「（ never end one. These inherit to the text
    // content div (and each rich paragraph), so both document frames and bubbles pick them up.
    writingMode: frame.typography.writingMode === 'vertical-rl' ? 'vertical-rl' : undefined,
    textOrientation:
      frame.typography.writingMode === 'vertical-rl' ? (frame.typography.textOrientation ?? 'mixed') : undefined,
    lineBreak:
      (frame.typography.lineBreakStrict ?? frame.typography.writingMode === 'vertical-rl') ? 'strict' : undefined,
    // 圏点 bouten emphasis marks (CSS text-emphasis). The default position (over for horizontal, right for
    // vertical) is exactly what Japanese typesetting uses, so only the mark style needs setting.
    textEmphasis: paperEmphasisMarkToCss(frame.typography.emphasis),
    columnCount: frame.kind === 'text' ? Math.max(1, frame.columns) : 1,
    columnGap: `${resolvePaperColumnGutterMm(frame) * PX_PER_MM * zoom}px`,
    columnFill: frame.kind === 'text' && frame.columnBalance ? 'balance' : 'auto',
    columnRule:
      frame.kind === 'text' && frame.columnRule && frame.columns > 1
        ? `${Math.max(1, 0.2 * PX_PER_MM * zoom)}px solid ${frame.strokeColor}`
        : undefined,
    borderStyle: frame.kind === 'thoughtBubble' ? 'dashed' : frame.strokeStyle,
    // Non-printing "frame edges" affordance (View ▸ Frame Edges) — a light 1px hairline, like guides/grid, so
    // borderless document frames stay easy to see and grab. Editor-only: it's an `outline` on the live canvas,
    // never part of the frame's real stroke, and the print/PDF/flatten paths re-render independently. Skipped
    // for clip-path/bubble/shape frames where a rectangle would misrepresent the shape.
    outline: showFrameEdges && !effectiveClipPath
      && frame.kind !== 'speechBubble' && frame.kind !== 'thoughtBubble' && frame.kind !== 'shape'
      ? '1px solid rgba(148, 163, 184, 0.5)'
      : undefined,
    clipPath: effectiveClipPath,
    padding: contentPaddingPx,
    paddingTop: contentPaddingPx + baselineTopInsetPx,
  };
  const imageStyle: React.CSSProperties = {
    ...buildPaperImageRenderStyle(frame),
    userSelect: 'none',
  };
  const allowsVisibleOverflow = frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
  const showFrameTransformHandles = isSelected && !frame.inherited && !showVertexHandles;
  // A threaded continuation frame is read-only (the story is edited on the thread's head frame).
  const editableTextFrame = isPaperInlineTextFrame(frame) && !isThreadContinuation && !frame.table;
  // Overset-indicator/Fit-Frame-to-Text scope: plain text/caption frames only. Speech/thought bubbles render
  // their text in a nested %-based sub-box (textBox*Percent) with its own, different overflow semantics from
  // the outer frame box measured here, and growing a bubble's height would also need to regrow its whole
  // shape/tail — a materially bigger feature. Left as a follow-up rather than guessed at in this pass.
  const isPlainInlineTextFrame = editableTextFrame && frame.kind !== 'speechBubble' && frame.kind !== 'thoughtBubble';
  // A read-only thread continuation carrying a computed RICH slice must render through the same rich renderer as
  // the head (so bold/italic/link/paragraph/list survive), NOT the plaintext fallback — while staying
  // non-editable (it is not an editableTextFrame, so double-click/edit never activates on it).
  const richThreadContinuation = isThreadContinuation
    && !frame.table
    && isPaperInlineTextFrame(frame)
    && Boolean(displayRichText && displayRichText.length > 0);

  // Managed composition owns only frames whose visible source text is the document's actual text. Thread
  // continuations/folios can display a derived string, and remain in the legacy preview until they have their
  // own managed source contract. Browser-only paint effects remain on the browser preview until the production
  // renderer owns matching vector/flattened effects; a missing face never turns into substitution here.
  const hasBrowserOnlyTextPaint = Boolean(
    (frame.textStrokeWidthMm ?? 0) > 0 && frame.textStrokeColor,
  ) || Boolean(frame.textShadowColor);
  const inlineLayoutSource = (displayRichText ?? frame.richText)
    ?.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
    ?? displayText
    ?? frame.text
    ?? '';
  const usesBrowserNativeInlineLayout = paperInlineTextUsesBrowserNativeLayout(
    inlineLayoutSource,
    frame.typography.writingMode === 'vertical-rl',
  );
  const managedTextEligible = editableTextFrame
    && !textEditing
    && !isThreadContinuation
    && !frame.textArcPercent
    && !hasBrowserOnlyTextPaint
    // Print/raster export also uses native CSS for ruby, text-emphasis, and tate-chu-yoko. Keeping the exact
    // managed-font DOM preview visible for these annotations preserves CSS reading distribution and line-box
    // expansion instead of showing a centered, overlapping HarfBuzz approximation on the canvas.
    && !usesBrowserNativeInlineLayout
    && (displayText === undefined || displayText === (frame.text ?? ''));

  const beginTextEdit = (event: React.MouseEvent<Element>) => {
    if (!editableTextFrame || frame.locked || frame.inherited || tool !== 'select') return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(event);
    setTextDraft(frame.text ?? '');
    setTextEditing(true);
  };
  const commitTextEdit = (nextText: string, richText?: PaperRichParagraph[]) => {
    const normalizedText = normalizePaperInlineText(nextText);
    setTextEditing(false);
    setTextDraft(normalizedText);
    if (richText) {
      // Rich edit: patch the runs (the flattened text rides along). The rich editor only calls this when it
      // actually changed, so no equality guard is needed here.
      onCommitText(normalizedText, richText);
      return;
    }
    if (normalizedText !== (frame.text ?? '')) {
      onCommitText(normalizedText);
    }
  };
  const cancelTextEdit = () => {
    setTextEditing(false);
    setTextDraft(frame.text ?? '');
  };

  return (
    <div
      aria-label={frame.label}
      className={`absolute touch-none text-left transition-shadow ${
        isSelected ? 'ring-2 ring-cyan-400 ring-offset-2 ring-offset-white' : ''
      } ${frame.kind === 'thoughtBubble' ? 'border-dashed' : ''} ${frame.inherited ? 'pointer-events-auto' : ''}`}
      data-paper-frame="true"
      data-paper-frame-id={frame.id}
      data-paper-frame-kind={frame.kind}
      data-paper-frame-page-number={pageNumber}
      onClick={(event) => {
        event.stopPropagation();
        if (shouldTogglePaperFrameSelectionOnModifiedClick({
          modified: event.ctrlKey || event.metaKey || event.shiftKey,
          lastContextMenuAt: lastContextMenuAtRef.current,
          now: Date.now(),
        })) {
          onSelect(event);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        lastContextMenuAtRef.current = Date.now();
        if (shouldReplacePaperFrameSelectionForContextMenu(isSelected)) {
          onSelect(event);
        }
        onOpenMenu(event);
      }}
      onDoubleClick={beginTextEdit}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        if (textEditing) {
          event.stopPropagation();
          return;
        }
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        if (frame.inherited) {
          onSelect(event);
        } else if (tool === 'select') {
          if (event.ctrlKey || event.metaKey || event.shiftKey) {
            return;
          }
          onBeginMove(event);
        }
      }}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes('application/x-flow-source-bin-item') ||
          hasPaperPageImageFileDrag(event.dataTransfer)
        ) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        if (getDraggedSourceItemId(event.dataTransfer)) {
          onDropSourceItem(event, frame.id);
          return;
        }
        void onDropPaperPageImageImportFiles(event, frame.id);
      }}
      role="button"
      style={frameStyle}
      tabIndex={0}
      title={frame.label}
    >
      {frame.inherited ? (
        <button
          className="absolute -right-2 -top-2 z-20 rounded border border-cyan-500/60 bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100 shadow"
          onClick={(event) => {
            event.stopPropagation();
            onDetachInherited();
          }}
          title="Inherited parent item. Click to detach/override."
          type="button"
        >
          Parent
        </button>
      ) : null}
      <div
        className={`absolute inset-0 ${allowsVisibleOverflow ? 'overflow-visible' : 'overflow-hidden'}`}
        data-paper-frame-content-box={isPlainInlineTextFrame ? 'true' : undefined}
        ref={isPlainInlineTextFrame ? contentMeasureRef : undefined}
        style={contentStyle}
      >
        {frame.table ? (
          <PaperTableView frame={frame} zoom={zoom} />
        ) : hasImageContent && assetUrl && frame.asset ? (
          <>
            <img
              alt={frame.asset.label}
              className="h-full w-full"
              decoding="async"
              draggable={false}
              loading="lazy"
              onDragStart={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onLoad={(event) => onResolveImageNaturalSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
              src={assetUrl}
              style={imageStyle}
            />
            <PaperHaneStrokePreviewCanvas frame={frame} pageId={pageId} />
          </>
        ) : frame.kind === 'image' ? (
          <div className="flex h-full items-center justify-center border border-dashed border-slate-400/70 text-xs text-slate-500">
            Drop image asset
          </div>
        ) : frame.kind === 'document' ? (
          <PaperDocumentFramePreview assetUrl={assetUrl} frame={frame} />
        ) : frame.kind === 'panel' ? (
          <div className="h-full w-full" />
        ) : frame.kind === 'shape' ? (
          <PaperPolygonShape frame={frame} zoom={zoom} />
        ) : frame.kind === 'barcode' ? (
          <PaperBarcodeView frame={frame} zoom={zoom} />
        ) : frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' ? (
          <>
            {suppressBubbleShape ? null : <PaperBubbleShape frame={frame} zoom={zoom} />}
            {managedTextEligible ? (
              <PaperManagedTextLayer
                document={managedTextDocument}
                frame={frame}
                onDoubleClick={beginTextEdit}
                onReadyChange={setManagedTextReady}
                showBaselines={managedTextDocument.view.showTextBaselines}
                style={{ ...paperManagedTextLayerStyle(frame, zoom), zIndex: 45 }}
                zoom={zoom}
              />
            ) : null}
            <div className={managedTextEligible && !textEditing ? 'invisible' : undefined}>
              <PaperBubbleText
                displayText={displayText}
                draft={textDraft}
                frame={frame}
                isEditing={textEditing}
                onBeginEdit={beginTextEdit}
                onCancel={cancelTextEdit}
                onCommit={commitTextEdit}
                onDraftChange={setTextDraft}
                pageBackgroundCss={pageBackgroundCss}
                zoom={zoom}
              />
            </div>
          </>
        ) : frame.textArcPercent && !textEditing && isPaperInlineTextFrame(frame) ? (
          <PaperTextArc frame={frame} text={displayText ?? frame.text ?? ''} zoom={zoom} />
        ) : editableTextFrame || richThreadContinuation ? (
          <>
            {managedTextEligible ? (
              <PaperManagedTextLayer
                document={managedTextDocument}
                frame={frame}
                onDoubleClick={beginTextEdit}
                onReadyChange={setManagedTextReady}
                showBaselines={managedTextDocument.view.showTextBaselines}
                style={{ ...paperManagedTextLayerStyle(frame, zoom), zIndex: 1 }}
                zoom={zoom}
              />
            ) : null}
            <div className={`h-full w-full${managedTextEligible && !textEditing ? ' invisible' : ''}`}>
              <PaperInlineText
                displayText={displayText}
                displayRichText={displayRichText}
                frame={frame}
                isEditing={textEditing}
                managedFonts={managedTextDocument.importedFonts}
                onBeginEdit={beginTextEdit}
                onCancel={cancelTextEdit}
                onCommit={commitTextEdit}
                pageBackgroundCss={pageBackgroundCss}
                wrapSpacers={wrapSpacers}
                zoom={zoom}
              />
            </div>
          </>
        ) : (
          <div className="whitespace-pre-wrap break-words">
            <PaperWrapFloats spacers={wrapSpacers} zoom={zoom} />
            {displayText ?? frame.text}
          </div>
        )}
      </div>
      {managedTextDocument.view.showTextBaselines
        && isPaperInlineTextFrame(frame)
        && !frame.table
        && !frame.textArcPercent
        && (!managedTextEligible || !managedTextReady || textEditing) ? (
          <PaperTextBaselineRhythmOverlay frame={frame} zoom={zoom} />
        ) : null}
      {isOverset ? (
        <div
          className="pointer-events-none absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-red-500 text-[9px] font-bold leading-none text-white shadow"
          title="Overset text — thread another frame to continue the story"
        >
          +
        </div>
      ) : isPlainInlineTextFrame && !textEditing && contentOverset ? (
        <div
          className="pointer-events-none absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-red-500 text-[9px] font-bold leading-none text-white shadow"
          title="Text doesn't fit this frame — right-click and choose Fit Frame to Text, or resize the frame"
        >
          !
        </div>
      ) : null}
      {frame.hyperlink ? (
        <div
          className="pointer-events-none absolute -left-1 -top-1 flex h-3.5 items-center justify-center rounded-sm bg-cyan-500 px-1 text-[9px] font-bold leading-none text-white shadow"
          title={`Links to ${frame.hyperlink}`}
        >
          ↗
        </div>
      ) : null}
      {hasShapeStrokeOverlay ? <PaperFrameShapeStroke frame={frame} zoom={zoom} /> : null}
      {isSelected && !frame.inherited ? (
        <>
          {showFrameTransformHandles ? (
            <>
              <button
                className="absolute left-1/2 top-0 flex h-6 w-6 -translate-x-1/2 -translate-y-9 items-center justify-center rounded-full border border-cyan-500 bg-white text-cyan-700 shadow"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onBeginRotate(event);
                }}
                title="Rotate frame"
                type="button"
              >
                <RotateCw size={13} />
              </button>
              {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as PaperResizeHandle[]).map((handle) => (
                <button
                  className={`absolute h-3 w-3 rounded-full border border-cyan-600 bg-white shadow ${paperResizeHandleClassName(handle)}`}
                  key={handle}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    onBeginResize(handle, event);
                  }}
                  title={`Resize ${handle.toUpperCase()}${handle.length === 1 ? ' edge' : ''}. Hold Shift to lock aspect ratio.`}
                  type="button"
                />
              ))}
            </>
          ) : null}
          {showFrameTransformHandles && isImageCropFrame(frame) ? (
            <PaperImageContentHandles
              frame={frame}
              onBeginPan={onBeginImageCropPan}
              onBeginRotate={onBeginImageCropRotate}
              onBeginScale={onBeginImageCropScale}
              onToggleFlipX={onToggleImageFlipX}
              onToggleFlipY={onToggleImageFlipY}
            />
          ) : null}
          {showVertexHandles ? <PaperVertexHandles
            frame={frame}
            onBeginEdgeInsert={onBeginFrameVertexInsert}
            onBeginVertex={onBeginFrameVertexMove}
            onDeleteVertex={onDeleteFrameVertex}
          /> : null}
          {showFrameTransformHandles && (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') ? (
            <>
              <PaperBubbleHandles frame={frame} onBeginHandle={onBeginBubbleHandle} />
              <PaperBubbleTextBoxHandles
                frame={frame}
                onBeginMove={onBeginBubbleTextMove}
                onBeginResize={onBeginBubbleTextResize}
                onBeginRotate={onBeginBubbleTextRotate}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PaperImageContentHandles({
  frame,
  onBeginPan,
  onBeginRotate,
  onBeginScale,
  onToggleFlipX,
  onToggleFlipY,
}: {
  frame: PaperFrame;
  onBeginPan: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginRotate: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginScale: (event: React.PointerEvent<HTMLElement>) => void;
  onToggleFlipX: () => void;
  onToggleFlipY: () => void;
}) {
  const iconButtonClass = 'flex h-7 w-7 items-center justify-center rounded-full border border-fuchsia-500 bg-slate-950/90 text-fuchsia-100 shadow hover:bg-fuchsia-500 hover:text-white';

  return (
    <>
      <button
        className={`${iconButtonClass} absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 cursor-move`}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onBeginPan(event);
        }}
        title="Move image inside frame"
        type="button"
      >
        <Move size={13} />
      </button>
      <button
        className={`${iconButtonClass} absolute bottom-1 right-1 z-40 cursor-nwse-resize`}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onBeginScale(event);
        }}
        title="Scale image inside frame"
        type="button"
      >
        <Maximize2 size={13} />
      </button>
      <div className="absolute right-1 top-1 z-40 flex gap-1">
        <button
          className={iconButtonClass}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            onBeginRotate(event);
          }}
          title="Rotate image inside frame"
          type="button"
        >
          <RotateCw size={13} />
        </button>
        <button
          aria-pressed={frame.imageFlipX}
          className={iconButtonClass}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFlipX();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          title="Flip image horizontally"
          type="button"
        >
          <FlipHorizontal size={13} />
        </button>
        <button
          aria-pressed={frame.imageFlipY}
          className={iconButtonClass}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFlipY();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          title="Flip image vertically"
          type="button"
        >
          <FlipVertical size={13} />
        </button>
      </div>
    </>
  );
}

function paperResizeHandleClassName(handle: PaperResizeHandle): string {
  switch (handle) {
    case 'nw':
      return 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize';
    case 'n':
      return 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize';
    case 'ne':
      return 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize';
    case 'e':
      return 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2 cursor-ew-resize';
    case 'se':
      return 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize';
    case 's':
      return 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize';
    case 'sw':
      return 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize';
    case 'w':
      return 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize';
  }
}

function PaperVertexHandles({
  frame,
  onBeginEdgeInsert,
  onBeginVertex,
  onDeleteVertex,
}: {
  frame: PaperFrame;
  onBeginEdgeInsert: (edgeIndex: number, event: React.PointerEvent<HTMLElement>) => void;
  onBeginVertex: (vertexIndex: number) => void;
  onDeleteVertex: (vertexIndex: number) => void;
}) {
  const vertices = verticesForEditableFrame(frame);
  if (!vertices?.length) return null;
  const canDelete = vertices.length > (frame.shapeKind === 'line' ? 2 : 3);

  return (
    <>
      {vertices.length >= 3 ? vertices.map((vertex, index) => {
        const next = vertices[(index + 1) % vertices.length];
        if (!next) return null;
        return (
          <button
            className="absolute z-40 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-amber-700 bg-slate-950 text-amber-200 shadow hover:bg-amber-300 hover:text-amber-950"
            key={`${frame.id}-edge-${index}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              onBeginEdgeInsert(index, event);
            }}
            style={{
              left: `${(vertex.xPercent + next.xPercent) / 2}%`,
              top: `${(vertex.yPercent + next.yPercent) / 2}%`,
            }}
            title={`Add vertex after ${index + 1}`}
            type="button"
          >
            <Plus size={10} />
          </button>
        );
      }) : null}
      {vertices.map((vertex, index) => (
        <button
          className="absolute z-50 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-amber-800 bg-amber-300 shadow hover:bg-amber-200"
          key={`${frame.id}-vertex-${index}`}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (canDelete) onDeleteVertex(index);
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (canDelete) onDeleteVertex(index);
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            if (event.altKey && canDelete) {
              onDeleteVertex(index);
              return;
            }
            onBeginVertex(index);
          }}
          style={{
            left: `${vertex.xPercent}%`,
            top: `${vertex.yPercent}%`,
          }}
          title={canDelete ? `Move vertex ${index + 1}. Double-click or right-click to delete.` : `Move vertex ${index + 1}`}
          type="button"
        />
      ))}
    </>
  );
}

function clipPathForImageContentFrame(frame: PaperFrame): string | undefined {
  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') return undefined;
  if (frame.shapeKind === 'ellipse') return 'ellipse(50% 50% at 50% 50%)';
  const vertices = verticesForEditableFrame(frame);
  if (!vertices || vertices.length < 3) return undefined;
  return `polygon(${vertices.map((vertex) => `${formatCssPercent(vertex.xPercent)} ${formatCssPercent(vertex.yPercent)}`).join(', ')})`;
}

function formatCssPercent(value: number): string {
  return `${Math.round(value * 100) / 100}%`;
}

function isImageCropFrame(frame: PaperFrame): boolean {
  return (frame.kind === 'image' || frame.kind === 'panel' || frame.kind === 'shape')
    && Boolean(hasPaperAssetReference(frame.asset) || frame.comicSfxDesign);
}

function PaperDocumentFramePreview({ assetUrl, frame }: { assetUrl?: string; frame: PaperFrame }) {
  const label = frame.asset?.label ?? frame.label;
  if (assetUrl && frame.asset?.mimeType === 'application/pdf') {
    return (
      <object className="h-full w-full" data={assetUrl} type="application/pdf">
        <div className="flex h-full flex-col items-center justify-center gap-2 border border-dashed border-slate-400/70 bg-slate-50 p-3 text-center text-xs text-slate-600">
          <FileJson size={18} />
          <span>Linked PDF</span>
          <span className="max-w-full truncate">{label}</span>
        </div>
      </object>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 border border-dashed border-slate-400/70 bg-slate-50 p-3 text-center text-xs text-slate-600">
      <FileJson size={18} />
      <span>Linked document preview</span>
      <span className="max-w-full truncate">{label}</span>
      {frame.asset?.mimeType ? <span className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{frame.asset.mimeType}</span> : null}
    </div>
  );
}

function PaperPolygonShape({ frame, zoom }: { frame: PaperFrame; zoom: number }) {
  const strokeDasharray = frame.strokeStyle === 'dashed' ? '5 4' : frame.strokeStyle === 'dotted' ? '1 3' : undefined;
  const commonShapeProps = {
    fill: frame.shapeKind === 'line' ? 'none' : svgFillForFrame(frame),
    fillOpacity: frame.fillGradient ? frame.fillOpacity : undefined,
    stroke: frame.strokeColor,
    strokeOpacity: frame.strokeOpacity,
    strokeDasharray,
    strokeLinejoin: 'round',
    strokeWidth: shapeStrokeWidthPx(frame, zoom),
    vectorEffect: 'non-scaling-stroke',
  } as const;
  const points = (verticesForEditableFrame(frame) ?? [])
    .map((vertex) => `${vertex.xPercent},${vertex.yPercent}`)
    .join(' ');

  return (
    <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
      <SvgGradientDef frame={frame} />
      {frame.shapeKind === 'ellipse' ? (
        <ellipse cx={50} cy={50} rx={48} ry={48} {...commonShapeProps} />
      ) : frame.shapeKind === 'line' ? (
        <line x1={0} y1={50} x2={100} y2={50} {...commonShapeProps} />
      ) : (
        <polygon points={points} {...commonShapeProps} />
      )}
    </svg>
  );
}

/** Live canvas ISBN/EAN-13 barcode using the same pure geometry as print and PDF/X. */
function PaperBarcodeView({ frame }: { frame: PaperFrame; zoom: number }) {
  const geometry = buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm);
  const moduleWidthMm = geometry.moduleWidthMm > 0 ? geometry.moduleWidthMm : PAPER_EAN13_NOMINAL.totalModuleCount;
  const heightModules = Math.max(0, frame.heightMm) / moduleWidthMm;
  const formatModule = (value: number) => Number((value / moduleWidthMm).toFixed(4));

  if (geometry.resolution.status === 'invalid' || geometry.bars.length === 0) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-red-400/70 bg-red-950/20 p-1 text-center"
        data-paper-barcode-invalid="true"
      >
        <AlertTriangle className="text-red-300" size={14} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-red-200">
          {geometry.resolution.status === 'invalid' ? 'Enter ISBN' : 'No bars'}
        </span>
      </div>
    );
  }

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      data-paper-barcode="true"
      preserveAspectRatio="none"
      viewBox={`0 0 ${PAPER_EAN13_NOMINAL.totalModuleCount} ${Number(heightModules.toFixed(4))}`}
    >
      <rect
        fill={svgFillForFrame(frame)}
        height={Number(heightModules.toFixed(4))}
        opacity={frame.fillGradient ? frame.fillOpacity : undefined}
        width={PAPER_EAN13_NOMINAL.totalModuleCount}
        x={0}
        y={0}
      />
      {geometry.bars.map((bar, index) => (
        <rect
          fill={frame.strokeColor}
          height={formatModule(bar.heightMm)}
          key={`barcode-bar-${index}`}
          width={formatModule(bar.widthMm)}
          x={formatModule(bar.xMm)}
          y={0}
        />
      ))}
      {geometry.humanReadableGroups.map((group, index) => (
        <text
          dominantBaseline="alphabetic"
          fill={frame.strokeColor}
          fontFamily="'DejaVu Sans Mono', 'Courier New', monospace"
          fontSize={Number((geometry.humanReadableFontPt * (25.4 / 72) / moduleWidthMm).toFixed(4))}
          key={`barcode-hri-${index}`}
          textAnchor="middle"
          x={formatModule(group.centerMm)}
          y={formatModule(Math.max(0, frame.heightMm) - 0.35 * moduleWidthMm)}
        >
          {group.text}
        </text>
      ))}
    </svg>
  );
}

function PaperFrameShapeStroke({ frame, zoom }: { frame: PaperFrame; zoom: number }) {
  const strokeDasharray = frame.strokeStyle === 'dashed' ? '5 4' : frame.strokeStyle === 'dotted' ? '1 3' : undefined;
  const commonShapeProps = {
    fill: 'none',
    stroke: frame.strokeColor,
    strokeOpacity: frame.strokeOpacity,
    strokeDasharray,
    strokeLinejoin: 'round',
    strokeWidth: shapeStrokeWidthPx(frame, zoom),
    vectorEffect: 'non-scaling-stroke',
  } as const;
  const points = (verticesForEditableFrame(frame) ?? [])
    .map((vertex) => `${vertex.xPercent},${vertex.yPercent}`)
    .join(' ');

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
      {frame.shapeKind === 'ellipse' ? (
        <ellipse cx={50} cy={50} rx={48} ry={48} {...commonShapeProps} />
      ) : frame.shapeKind === 'line' ? (
        <line x1={0} y1={50} x2={100} y2={50} {...commonShapeProps} />
      ) : (
        <polygon points={points} {...commonShapeProps} />
      )}
    </svg>
  );
}

function PaperBubbleShape({ frame, zoom }: { frame: PaperFrame; zoom: number }) {
  const path = buildPaperBubblePath(frame);
  return (
    <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
      <SvgGradientDef frame={frame} />
      <path
        d={path}
        fill={svgFillForFrame(frame)}
        fillOpacity={frame.fillGradient ? frame.fillOpacity : undefined}
        stroke={frame.strokeColor}
        strokeOpacity={frame.strokeOpacity}
        strokeDasharray={frame.strokeStyle === 'dashed' ? '5 4' : frame.strokeStyle === 'dotted' ? '1 3' : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={shapeStrokeWidthPx(frame, zoom)}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function PaperBubbleText({
  displayText,
  draft,
  frame,
  isEditing,
  onBeginEdit,
  onCancel,
  onCommit,
  onDraftChange,
  pageBackgroundCss,
  zoom,
}: {
  displayText?: string;
  draft: string;
  frame: PaperFrame;
  isEditing: boolean;
  onBeginEdit: (event: React.MouseEvent<HTMLElement>) => void;
  onCancel: () => void;
  onCommit: (text: string) => void;
  onDraftChange: (text: string) => void;
  pageBackgroundCss: string;
  zoom: number;
}) {
  const baseStyle = paperTextBoxReactStyle(frame);
  const style = paperTextEffectReactStyle(frame, zoom, baseStyle);
  const vertical = frame.typography.writingMode === 'vertical-rl';

  if (isEditing) {
    // The editor keeps the raw text (incl. the 《》/｜ furigana notation), so lettering round-trips; ruby/TCY
    // render only in the display view below. The editing surface itself is transparent (it sits directly over
    // the bubble's own fill/shape, so it always matches the frame); a computed ink/paper backdrop is added only
    // when that real pairing is too low-contrast to read — editor chrome only, never a document colour change.
    const backdrop = resolveEditorBackdrop({
      textColor: frame.typography.color,
      fillColor: frame.fillColor,
      fillOpacity: frame.fillOpacity,
      pageBackground: pageBackgroundCss,
    });
    const editorStyle = backdrop.needsBackdrop ? { ...style, backgroundColor: backdrop.backdropColor } : style;
    return (
      <PaperEditableText
        className="absolute z-50 whitespace-pre-wrap break-words rounded border border-cyan-400/80 p-1 shadow-[0_0_0_2px_rgba(8,145,178,0.18)] outline-none"
        onCancel={onCancel}
        onChange={onDraftChange}
        onCommit={onCommit}
        style={editorStyle}
        vertical={vertical}
        value={draft}
      />
    );
  }

  // The text box is a flex container (for vertical/horizontal centering). Inline content — especially <ruby> —
  // must NOT be a direct flex child: flex blockifies each <ruby> into its own item, which in vertical text scatters
  // the reading across separate columns. Wrapping the content in one inner block keeps it a single flex item so
  // the text (and furigana) flows and wraps as normal columns.
  return (
    <div className="pointer-events-none absolute z-40" onDoubleClick={onBeginEdit} style={style}>
      <div className="whitespace-pre-wrap break-words">{renderPaperInlineText(displayText ?? frame.text ?? '', vertical)}</div>
    </div>
  );
}

function PaperTableView({ frame, zoom }: { frame: PaperFrame; zoom: number }) {
  const table = frame.table;
  if (!table) return null;
  const borderPx = Math.max(0.5, table.borderWidthMm * PX_PER_MM * zoom);
  const padPx = Math.max(0, table.cellPaddingMm * PX_PER_MM * zoom);
  const border = `${borderPx}px solid ${table.borderColor ?? frame.strokeColor}`;
  return (
    <table
      className="absolute inset-0 h-full w-full border-collapse"
      style={{
        color: frame.typography.color,
        fontFamily: frame.typography.fontFamily,
        fontSize: frame.typography.fontSizePt * PT_TO_PX * zoom,
        lineHeight: 1.25,
        tableLayout: 'fixed',
      }}
    >
      <tbody>
        {table.cells.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => {
              const isHeader = table.headerRow && r === 0;
              // An imported per-cell fill (header/alternating-row shading) wins; else the default header tint.
              const cellFill = table.cellFills?.[r]?.[c];
              const background = cellFill || (isHeader ? 'rgba(148,163,184,0.18)' : undefined);
              return (
                <td
                  key={c}
                  style={{
                    border,
                    padding: padPx,
                    verticalAlign: 'top',
                    fontWeight: isHeader ? 700 : undefined,
                    background,
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {cell}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaperTextArc({ frame, text, zoom }: { frame: PaperFrame; text: string; zoom: number }) {
  const widthPx = frame.widthMm * PX_PER_MM * zoom;
  const heightPx = frame.heightMm * PX_PER_MM * zoom;
  const arc = buildPaperTextArcPath(widthPx, heightPx, frame.textArcPercent ?? 0);
  if (!arc) return null;
  const pathId = `paper-textarc-${frame.id}`;
  return (
    <svg
      className="pointer-events-none absolute inset-0 overflow-visible"
      height={heightPx}
      viewBox={`0 0 ${widthPx} ${heightPx}`}
      width={widthPx}
    >
      <defs>
        <path d={arc.d} id={pathId} />
      </defs>
      <text
        fill={frame.typography.color}
        fontFamily={frame.typography.fontFamily}
        fontSize={frame.typography.fontSizePt * PT_TO_PX * zoom}
        fontStyle={frame.typography.fontStyle}
        fontWeight={frame.typography.fontWeight}
        letterSpacing={`${frame.typography.tracking / 1000}em`}
        textAnchor="middle"
      >
        <textPath href={`#${pathId}`} startOffset="50%">
          {text}
        </textPath>
      </text>
    </svg>
  );
}

function PaperWrapFloats({ spacers, zoom }: { spacers: PaperWrapSpacer[]; zoom: number }) {
  if (!spacers || spacers.length === 0) return null;
  return (
    <>
      {spacers.map((spacer) => (
        <div
          aria-hidden
          key={spacer.id}
          style={{
            float: spacer.side,
            width: Math.max(0, spacer.widthMm * PX_PER_MM * zoom),
            height: Math.max(0, spacer.heightMm * PX_PER_MM * zoom),
            marginTop: Math.max(0, spacer.topMm * PX_PER_MM * zoom),
            shapeOutside: spacer.shapeOutside,
            shapeMargin: Math.max(0, spacer.shapeMarginMm * PX_PER_MM * zoom),
            pointerEvents: 'none',
          }}
        />
      ))}
    </>
  );
}

function PaperInlineText({
  frame,
  managedFonts,
  displayText,
  displayRichText,
  wrapSpacers = [],
  isEditing,
  onBeginEdit,
  onCancel,
  onCommit,
  pageBackgroundCss,
  zoom,
}: {
  frame: PaperFrame;
  managedFonts: readonly PaperManagedFontFace[] | undefined;
  displayText?: string;
  displayRichText?: PaperRichParagraph[];
  wrapSpacers?: PaperWrapSpacer[];
  isEditing: boolean;
  onBeginEdit: (event: React.MouseEvent<HTMLElement>) => void;
  onCancel: () => void;
  onCommit: (text: string, richText?: PaperRichParagraph[]) => void;
  pageBackgroundCss: string;
  zoom: number;
}) {
  const className = 'h-full w-full whitespace-pre-wrap break-words';
  const style = paperTextEffectReactStyle(frame, zoom);
  const vertical = frame.typography.writingMode === 'vertical-rl';
  if (isEditing) {
    // The editing surface itself is transparent (it sits directly over the frame's own fill, so it always
    // matches what the frame actually looks like). A computed ink/paper backdrop is added only when that real
    // pairing is too low-contrast to read (e.g. light typography over a transparent/light fill) — editor chrome
    // only, this never changes the document's real colours.
    const backdrop = resolveEditorBackdrop({
      textColor: frame.typography.color,
      fillColor: frame.fillColor,
      fillOpacity: frame.fillOpacity,
      pageBackground: pageBackgroundCss,
    });
    const editorStyle = backdrop.needsBackdrop ? { ...style, backgroundColor: backdrop.backdropColor } : style;
    // Every text/caption frame edits through the same WYSIWYG rich editor now — a plain frame (no richText
    // yet) is seeded from its plain text (ensureRichTextForTransform) so the toolbar/Ctrl+B/I/U are available
    // from the first keystroke. PaperRichEditableText's own commit() only PERSISTS richText (promoting the
    // frame) when real formatting was actually applied (paperRichTextIsUniform is false) — merely entering
    // edit mode, or editing plain text with no formatting, commits as plain text exactly as before, so a
    // frame Jarrod never formats never migrates. See richTextTransforms.ts's commit note for the full design
    // (this closes the gap B3's investigation found: the toolbar already existed, but only for frames that
    // already had richText — which a hand-drawn plain frame never does).
    return (
      <PaperRichEditableText
        baseStyle={editorStyle}
        className={`${className} rounded border border-cyan-400/80 p-1 shadow-[0_0_0_2px_rgba(8,145,178,0.18)] outline-none`}
        frame={frame}
        managedFonts={managedFonts}
        onCancel={onCancel}
        onCommit={onCommit}
        zoom={zoom}
      />
    );
  }

  // Inline-rich content (imported docx, mixed styling) renders paragraphs of styled runs; the plain single
  // -style path below is untouched for every frame that has no richText (comics, bubbles, captions, …).
  // In a rich thread the effective paragraphs are the frame's computed slice (`displayRichText`): the head shows
  // only its own slice — never the whole stored story — and a read-only continuation (which has no richText of
  // its own) shows the slice it was handed. Unthreaded rich frames keep rendering their full `frame.richText`.
  const effectiveRichText = displayRichText ?? frame.richText;
  if (effectiveRichText && effectiveRichText.length > 0) {
    return (
      <PaperRichTextView
        baseStyle={style}
        className={className}
        frame={frame}
        paragraphs={effectiveRichText}
        onBeginEdit={onBeginEdit}
        wrapSpacers={wrapSpacers}
        zoom={zoom}
      />
    );
  }

  const frameOwnsStoryOpening = !frame.threadId || (frame.threadOrder ?? 1) <= 1;
  const dropCapLines = frameOwnsStoryOpening && frame.typography.dropCapLines && frame.typography.dropCapLines >= 2
    ? Math.min(8, Math.round(frame.typography.dropCapLines))
    : 0;
  const spaceBeforePx = Math.max(0, frame.typography.spaceBeforeMm ?? 0) * PX_PER_MM * zoom;
  const spaceAfterPx = Math.max(0, frame.typography.spaceAfterMm ?? 0) * PX_PER_MM * zoom;
  const text = displayText ?? frame.text ?? '';

  // Paragraph spacing needs real paragraph boxes, so split on hard breaks when space-before/after is
  // set; otherwise keep the single pre-wrap block (cheaper, and drop cap rides the whole block).
  if (spaceBeforePx > 0 || spaceAfterPx > 0) {
    const paragraphs = text.split('\n');
    return (
      <div className={className} onDoubleClick={onBeginEdit} style={style}>
        <PaperWrapFloats spacers={wrapSpacers} zoom={zoom} />
        {paragraphs.map((paragraph, index) => {
          const isFirst = index === 0;
          const paragraphDropCap = isFirst && dropCapLines > 0;
          return (
            <div
              className={paragraphDropCap ? 'paper-dropcap' : undefined}
              key={index}
              style={{
                marginTop: isFirst ? 0 : spaceBeforePx,
                marginBottom: index === paragraphs.length - 1 ? 0 : spaceAfterPx,
                ...(paragraphDropCap ? { '--sl-dropcap-lines': String(dropCapLines) } : {}),
              } as React.CSSProperties}
            >
              {paragraph ? renderPaperInlineText(paragraph, vertical) : '\u00a0'}
            </div>
          );
        })}
      </div>
    );
  }

  const textStyle = dropCapLines
    ? ({ ...style, '--sl-dropcap-lines': String(dropCapLines) } as React.CSSProperties)
    : style;
  return (
    <div
      className={dropCapLines ? `${className} paper-dropcap` : className}
      onDoubleClick={onBeginEdit}
      style={textStyle}
    >
      <PaperWrapFloats spacers={wrapSpacers} zoom={zoom} />
      {renderPaperInlineText(text, vertical)}
    </div>
  );
}

// Render a frame's text with Japanese inline notation resolved: furigana kanji-《reading》 / \uff5c-delimited base
// -> real <ruby>, and (in vertical text) 1-2 digit numbers as tate-chu-yoko. The parsing lives in the shared
// `paperJapaneseText` tokenizer so the on-canvas render and the print/PDF export stay identical. Editors keep the
// raw notation (they show the source), so lettering round-trips; only this display view resolves it.
function renderPaperInlineText(text: string, vertical: boolean): React.ReactNode {
  const tokens = tokenizePaperInlineText(text, vertical);
  if (tokens.length === 0) return text;
  if (tokens.length === 1 && tokens[0].type === 'text') return tokens[0].text;
  return tokens.map((token, index) => {
    if (token.type === 'text') return <Fragment key={index}>{token.text}</Fragment>;
    if (token.type === 'tcy') {
      return (
        <span key={index} style={{ textCombineUpright: 'all', WebkitTextCombine: 'horizontal' } as React.CSSProperties}>
          {token.digits}
        </span>
      );
    }
    if (token.type === 'emphasis') {
      return (
        <span key={index} style={{ textEmphasis: 'filled sesame' } as React.CSSProperties}>
          {token.text}
        </span>
      );
    }
    return (
      <ruby key={index}>
        {token.base}
        <rt>{token.reading}</rt>
      </ruby>
    );
  });
}

/** CSS overrides for one inline run — only the fields the run actually changes; the rest inherit the frame. */
function paperRunReactStyle(run: PaperTextRun, zoom: number): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (run.fontFamily) style.fontFamily = run.fontFamily;
  if (run.fontWeight) style.fontWeight = run.fontWeight;
  if (run.fontStyle) style.fontStyle = run.fontStyle;
  if (run.fontStretch) style.fontStretch = run.fontStretch;
  if (run.fontVariationSettings) style.fontVariationSettings = Object.entries(run.fontVariationSettings)
    .filter(([tag, value]) => /^[ -~]{4}$/.test(tag) && Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, value]) => `"${tag}" ${value}`).join(', ');
  if (run.fontKerning) style.fontKerning = run.fontKerning;
  if (run.color) style.color = run.color;
  if (run.highlight) { style.backgroundColor = run.highlight; style.borderRadius = '1px'; style.boxDecorationBreak = 'clone'; style.WebkitBoxDecorationBreak = 'clone'; }
  if (run.tracking != null) style.letterSpacing = `${run.tracking / 1000}em`;
  if (run.smallCaps != null) style.fontVariantCaps = run.smallCaps ? 'small-caps' : 'normal';
  if (run.numericStyle) style.fontVariantNumeric = paperNumericStyleToCss(run.numericStyle) ?? 'normal';
  if (run.textOrientation) style.textOrientation = run.textOrientation;
  if (run.emphasis) style.textEmphasis = paperEmphasisMarkToCss(run.emphasis) ?? 'none';
  if (run.leadingPt != null) style.lineHeight = `${run.leadingPt * PT_TO_PX * zoom}px`;
  const decorations: string[] = [];
  if (run.underline) decorations.push('underline');
  if (run.strike) decorations.push('line-through');
  if (decorations.length) style.textDecoration = decorations.join(' ');
  if (run.vertAlign === 'super' || run.vertAlign === 'sub') {
    style.verticalAlign = run.vertAlign;
    // Super/subscript shrinks like it does everywhere; honour an explicit run size, else 0.7em of the line.
    style.fontSize = run.fontSizePt ? run.fontSizePt * PT_TO_PX * zoom : '0.7em';
  } else if (run.fontSizePt) {
    style.fontSize = run.fontSizePt * PT_TO_PX * zoom;
  }
  return style;
}

/** Render a frame's inline-rich content: paragraphs of styled runs, with per-paragraph align/indent/spacing,
 * drop caps, and hanging list markers. Font/size/colour defaults come from the frame's content style (which
 * this div inherits); each run span overrides only what it carries. */
function PaperRichTextView({
  baseStyle,
  className,
  frame,
  paragraphs,
  onBeginEdit,
  wrapSpacers,
  zoom,
}: {
  baseStyle: React.CSSProperties;
  className: string;
  frame: PaperFrame;
  /** The paragraphs to render — the frame's own richText, or a threaded frame's computed rich slice. */
  paragraphs: PaperRichParagraph[];
  onBeginEdit: (event: React.MouseEvent<HTMLElement>) => void;
  wrapSpacers: PaperWrapSpacer[];
  zoom: number;
}) {
  const vertical = frame.typography.writingMode === 'vertical-rl';
  // A merged callout (every paragraph shares a border/shading) renders as ONE continuous box, the way a word
  // processor draws a multi-paragraph shaded note: the border padding and any top/bottom stroke apply only at the
  // outer edges, not around every paragraph, so the paragraphs flow inside one box instead of stacking as chunks.
  const continuousBox = paragraphs.length > 1 && paragraphs.every((p) => p.borders || p.shading);
  return (
    <div className={className} onDoubleClick={onBeginEdit} style={baseStyle}>
      <PaperWrapFloats spacers={wrapSpacers} zoom={zoom} />
      {paragraphs.map((paragraph, index) => {
        const isFirstPara = index === 0;
        const isLastPara = index === paragraphs.length - 1;
        const ownsParagraphStart = !isPaperRichParagraphFragment(paragraph) || paragraph.ownsParagraphStart;
        const ownsParagraphEnd = !isPaperRichParagraphFragment(paragraph) || paragraph.ownsParagraphEnd;
        const frameOpeningDropCapLines = isFirstPara
          && (!frame.threadId || (frame.threadOrder ?? 1) <= 1)
          ? frame.typography.dropCapLines
          : 0;
        const inheritedDropCapLines = paragraph.dropCapLines ?? frameOpeningDropCapLines;
        const dropCapLines = ownsParagraphStart && inheritedDropCapLines && inheritedDropCapLines >= 2 ? Math.min(8, Math.round(inheritedDropCapLines)) : 0;
        const spaceBefore = ownsParagraphStart ? Math.max(0, paragraph.spaceBeforeMm ?? frame.typography.spaceBeforeMm ?? 0) * PX_PER_MM * zoom : 0;
        const spaceAfter = ownsParagraphEnd ? Math.max(0, paragraph.spaceAfterMm ?? frame.typography.spaceAfterMm ?? 0) * PX_PER_MM * zoom : 0;
        // Authored rich paragraphs are distinct blocks in print HTML. Its pre-wrap separator consumes one
        // frame-leading line, so mirror that paragraph gap in the browser fallback and managed layer alike.
        const richParagraphGap = ownsParagraphEnd && !isLastPara
          ? frame.typography.leadingPt * PT_TO_PX * zoom
          : 0;
        const leftIndentPx = Math.max(0, paragraph.leftIndentMm ?? 0) * PX_PER_MM * zoom;
        const rightIndentPx = Math.max(0, paragraph.rightIndentMm ?? 0) * PX_PER_MM * zoom;
        const hangingPx = ownsParagraphStart ? Math.max(0, paragraph.hangingIndentMm ?? 0) * PX_PER_MM * zoom : 0;
        const markerPadPx = paragraph.listMarker ? 4.5 * PX_PER_MM * zoom : 0;
        const firstLineMm = ownsParagraphStart
          ? paragraph.firstLineIndentMm ?? frame.typography.firstLineIndentMm ?? 0
          : 0;
        const firstLinePx = firstLineMm * PX_PER_MM * zoom;
        // Indent priority: list bullet > Word hanging indent > positive first-line indent. Word's hanging model:
        // body lines sit at the left indent; the first line out-dents by `hanging` (textIndent negative).
        let indentLeftPx = leftIndentPx;
        let textIndent: string | number | undefined = ownsParagraphStart ? undefined : 0;
        if (paragraph.listMarker) { indentLeftPx = leftIndentPx + markerPadPx; textIndent = -markerPadPx; }
        else if (hangingPx > 0) { indentLeftPx = leftIndentPx; textIndent = -hangingPx; }
        else if (firstLinePx !== 0) { textIndent = `${firstLinePx.toFixed(2)}px each-line`; }
        // Paragraph borders + shading (from Word's `<w:pBdr>` / `<w:shd>`). `w:space` becomes inset padding.
        const borders = paragraph.borders;
        const borderPadPx = borders?.paddingPt ? borders.paddingPt * PT_TO_PX * zoom : borders ? 2 * zoom : 0;
        const edgeCss = (edge?: PaperParagraphBorderEdge) =>
          edge ? `${(edge.widthPt * PT_TO_PX * zoom).toFixed(2)}px solid ${edge.color}` : undefined;
        // Inside a continuous callout, top padding/stroke belongs to the first paragraph only and bottom to the
        // last; the interior boundaries carry neither so the paragraphs read as one box.
        const padTopPx = !ownsParagraphStart || (continuousBox && !isFirstPara) ? 0 : borderPadPx;
        const padBottomPx = !ownsParagraphEnd || (continuousBox && !isLastPara) ? 0 : borderPadPx;
        const paragraphStyle: React.CSSProperties = {
          marginTop: spaceBefore || undefined,
          marginBottom: spaceAfter + richParagraphGap || undefined,
          textAlign: paragraph.align,
          textAlignLast: ownsParagraphEnd && paragraph.alignLast && paragraph.alignLast !== 'auto' ? paragraph.alignLast : 'auto',
          lineHeight: paragraph.leadingPt != null ? `${paragraph.leadingPt * PT_TO_PX * zoom}px` : undefined,
          hyphens: paragraph.hyphenate == null ? undefined : paragraph.hyphenate ? 'auto' : 'manual',
          textWrapStyle: paragraph.lineBreak && paragraph.lineBreak !== 'auto' ? paragraph.lineBreak : undefined,
          lineBreak: paragraph.lineBreakStrict == null ? undefined : paragraph.lineBreakStrict ? 'strict' : 'auto',
          paddingLeft: indentLeftPx + borderPadPx || undefined,
          paddingRight: rightIndentPx + borderPadPx || undefined,
          paddingTop: padTopPx || undefined,
          paddingBottom: padBottomPx || undefined,
          textIndent,
          background: paragraph.shading || undefined,
          ...(borders
            ? {
                borderTop: !ownsParagraphStart || (continuousBox && !isFirstPara) ? undefined : edgeCss(borders.top),
                borderLeft: edgeCss(borders.left),
                borderBottom: !ownsParagraphEnd || (continuousBox && !isLastPara) ? undefined : edgeCss(borders.bottom),
                borderRight: edgeCss(borders.right),
              }
            : {}),
          ...(dropCapLines ? ({ '--sl-dropcap-lines': String(dropCapLines) } as React.CSSProperties) : {}),
        };
        const hasText = paragraph.runs.some((run) => run.text.length > 0);
        return (
          <div className={dropCapLines ? 'paper-dropcap' : undefined} key={index} style={paragraphStyle}>
            {paragraph.listMarker ? <span>{`${paragraph.listMarker}\u2003`}</span> : null}
            {hasText
              ? paragraph.runs.map((run, runIndex) => {
                  const runStyle = paperRunReactStyle(run, zoom);
                  return run.link ? (
                    <a href={run.link} key={runIndex} onClick={(event) => event.preventDefault()} style={runStyle}>
                      {renderPaperInlineText(run.text, vertical)}
                    </a>
                  ) : (
                    <span key={runIndex} style={runStyle}>
                      {renderPaperInlineText(run.text, vertical)}
                    </span>
                  );
                })
              : '\u00a0'}
          </div>
        );
      })}
    </div>
  );
}

function paperTextEffectReactStyle(
  frame: PaperFrame,
  zoom: number,
  baseStyle: React.CSSProperties = {},
): React.CSSProperties {
  const style: React.CSSProperties = {
    ...baseStyle,
    ...buildPaperTextPaintEffectStyle(frame, (valueMm) => valueMm * PX_PER_MM * zoom),
  };
  const transform = appendPaperTextEffectTransform(
    typeof baseStyle.transform === 'string' ? baseStyle.transform : undefined,
    frame,
  );
  if (transform) {
    style.transform = transform;
    style.transformOrigin = baseStyle.transformOrigin ?? 'center';
  }
  return style;
}

/** The managed SVG owns glyph coordinates; this keeps the bubble text-box rotation/effect transform identical. */
function paperManagedTextLayerStyle(frame: PaperFrame, zoom: number): React.CSSProperties {
  const style = paperTextEffectReactStyle(frame, zoom);
  if (frame.kind !== 'speechBubble' && frame.kind !== 'thoughtBubble') return style;
  const rotationDeg = resolvePaperTextBox(frame).rotationDeg;
  const transform = appendPaperTextEffectTransform(`rotate(${rotationDeg}deg)`, frame);
  return transform ? { ...style, transform, transformOrigin: 'center' } : style;
}

function PaperContextualToolbarButton({
  children,
  compact = false,
  onApply,
  title,
}: {
  children: React.ReactNode;
  compact?: boolean;
  onApply: () => void;
  title: string;
}) {
  return (
    <button
      className={compact
        ? 'min-w-[20px] rounded px-1 py-0.5 text-[11px] font-semibold leading-none text-slate-100 hover:bg-cyan-500/30'
        : 'min-w-[22px] rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none text-slate-100 hover:bg-cyan-500/30'}
      onClick={(event) => { event.preventDefault(); onApply(); }}
      onMouseDown={(event) => event.preventDefault()}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function PaperEditableText({
  className,
  onCancel,
  onChange,
  onCommit,
  style,
  value,
  vertical = false,
}: {
  className: string;
  onCancel: () => void;
  onChange: (text: string) => void;
  onCommit: (text: string) => void;
  style?: React.CSSProperties;
  value: string;
  vertical?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const finishedRef = useRef(false);
  const initialValueRef = useRef(value);
  const { t, tBoth } = useI18n();
  // Vertical (manga) frames get a tiny ルビ/圏 toolbar so a letterer can add furigana/emphasis without typing the
  // fullwidth 《》 by hand (which otherwise needs a Japanese IME). Positioned once at mount, above the editor.
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerText = initialValueRef.current;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (vertical) {
      const rect = editor.getBoundingClientRect();
      setToolbarPos({ left: Math.max(4, rect.left), top: Math.max(4, rect.top - 30) });
    }
  }, [vertical]);

  const readText = () => normalizePaperInlineText(editorRef.current?.innerText ?? '');
  const finishCommit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(readText());
  };
  const finishCancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };
  // Wrap the current selection in furigana (語《》) or emphasis (《《語》》) notation. Inserted as plain text so it
  // round-trips through the frame text and renders as <ruby>/圏点 in the non-editing view.
  const wrapNotation = (before: string, after: string, caretBackBy = 0) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const selected = sel.toString();
    if (!selected && before) return; // emphasis needs a word; furigana may open an empty 《》
    document.execCommand('insertText', false, `${before}${selected}${after}`);
    const movable = sel as Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
    for (let i = 0; i < caretBackBy; i += 1) movable.modify?.('move', 'backward', 'character');
    onChange(readText());
  };
  return (
    <>
      <div
        className={className}
        contentEditable
        onBlur={finishCommit}
        onInput={() => onChange(readText())}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finishCancel();
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            finishCommit();
            event.currentTarget.blur();
          }
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={editorRef}
        role="textbox"
        spellCheck
        style={style}
        suppressContentEditableWarning
      />
      {vertical && toolbarPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed z-[999] flex items-center gap-0.5 rounded-md border border-cyan-400/40 bg-slate-900/95 px-1.5 py-1 text-slate-100 shadow-xl"
              onMouseDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}
              style={{ left: toolbarPos.left, top: toolbarPos.top }}
            >
              <PaperContextualToolbarButton
                compact
                onApply={() => wrapNotation('', '《》', 1)}
                title={t('paper.jp.furigana.tooltip')}
              >
                {tBoth('paper.jp.furigana')}
              </PaperContextualToolbarButton>
              <PaperContextualToolbarButton
                compact
                onApply={() => wrapNotation('《《', '》》')}
                title={t('paper.jp.emphasis.tooltip')}
              >
                <span style={{ textEmphasis: 'filled sesame', textEmphasisPosition: 'over' } as React.CSSProperties}>圏</span>
              </PaperContextualToolbarButton>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function RichTypeNumber({
  label,
  max,
  min = 0,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <label className="grid grid-cols-[1fr_4.5rem] items-center gap-2 text-[10px] text-cyan-100/60">
      <span>{label}</span>
      <input
        className="h-6 rounded border border-cyan-300/15 bg-[#0b121d] px-1.5 text-right text-[11px] tabular-nums text-cyan-50 outline-none focus:border-cyan-300/60"
        max={max}
        min={min}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

function RichTypeSelect({
  children,
  label,
  onChange,
  value,
}: {
  children: React.ReactNode;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid grid-cols-[1fr_6.5rem] items-center gap-2 text-[10px] text-cyan-100/60">
      <span>{label}</span>
      <select
        className="h-6 rounded border border-cyan-300/15 bg-[#0b121d] px-1 text-[10px] text-cyan-50 outline-none focus:border-cyan-300/60"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {children}
      </select>
    </label>
  );
}

export function PaperRichAdvancedTypePanel({
  onApply,
  typography,
}: {
  onApply: (patch: Partial<RichTypographyPatch>) => void;
  typography: PaperTypography;
}) {
  const { t } = useI18n();
  return (
    <div className="max-h-[min(34rem,75vh)] w-[34rem] overflow-y-auto rounded-lg border border-cyan-300/25 bg-[#101722] p-3 text-slate-100 shadow-2xl">
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-cyan-300/10 pb-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200">{t('paper.richType.title')}</div>
          <div className="mt-0.5 text-[10px] text-cyan-100/45">{t('paper.richType.scope')}</div>
        </div>
        <span className="rounded bg-cyan-300/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-cyan-200/70">{t('paper.richType.liveSelection')}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <section className="space-y-1.5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">{t('paper.richType.character')}</div>
          <RichTypeNumber label={t('paper.richType.sizePt')} max={1600} min={1} onChange={(fontSizePt) => onApply({ fontSizePt })} step={0.5} value={typography.fontSizePt} />
          <RichTypeNumber label={t('paper.richType.tracking')} max={2000} min={-200} onChange={(tracking) => onApply({ tracking })} step={5} value={typography.tracking} />
          <RichTypeSelect label={t('paper.insp.kerning')} onChange={(fontKerning) => onApply({ fontKerning: fontKerning as PaperTypography['fontKerning'] })} value={typography.fontKerning ?? 'auto'}>
            <option value="auto">{t('paper.insp.auto')}</option><option value="normal">{t('paper.richType.kerningMetrics')}</option><option value="none">{t('paper.insp.none')}</option>
          </RichTypeSelect>
          <RichTypeSelect label={t('paper.insp.weight')} onChange={(fontWeight) => onApply({ fontWeight })} value={typography.fontWeight}>
            {PAPER_FONT_WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
          </RichTypeSelect>
          <RichTypeSelect label={t('paper.insp.style')} onChange={(fontStyle) => onApply({ fontStyle: fontStyle as PaperTypography['fontStyle'] })} value={typography.fontStyle}>
            <option value="normal">{t('paper.insp.normal')}</option><option value="italic">{t('paper.insp.italic')}</option>
          </RichTypeSelect>
          <RichTypeSelect label={t('paper.insp.figures')} onChange={(numericStyle) => onApply({ numericStyle: numericStyle as PaperNumericStyle })} value={typography.numericStyle ?? 'normal'}>
            <option value="normal">{t('paper.insp.default')}</option><option value="lining">{t('paper.insp.lining')}</option><option value="oldstyle">{t('paper.insp.oldstyle')}</option><option value="tabular">{t('paper.insp.tabular')}</option>
          </RichTypeSelect>
          <label className="flex items-center justify-between gap-2 text-[10px] text-cyan-100/60">
            {t('paper.insp.smallCaps')}
            <input checked={Boolean(typography.smallCaps)} onChange={(event) => onApply({ smallCaps: event.target.checked })} type="checkbox" />
          </label>
          <label className="flex items-center justify-between gap-2 text-[10px] text-cyan-100/60">
            {t('paper.richType.textColour')}
            <AdvancedColorPicker
              buttonClassName="rounded border border-cyan-300/20"
              className="h-6 w-16"
              label={t('paper.richType.selectedTextColour')}
              onChange={(color) => onApply({ color })}
              value={cssColorToPickerValue(typography.color)}
            />
          </label>
        </section>

        <section className="space-y-1.5 border-l border-cyan-300/10 pl-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">{t('paper.richType.paragraph')}</div>
          <RichTypeNumber label={t('paper.richType.leadingPt')} max={3200} min={1} onChange={(leadingPt) => onApply({ leadingPt })} step={0.5} value={typography.leadingPt} />
          <RichTypeSelect label={t('paper.richType.alignment')} onChange={(align) => onApply({ align: align as PaperTypography['align'] })} value={typography.align}>
            <option value="left">{t('paper.insp.left')}</option><option value="center">{t('paper.insp.center')}</option><option value="right">{t('paper.insp.right')}</option><option value="justify">{t('paper.insp.justify')}</option>
          </RichTypeSelect>
          <RichTypeSelect label={t('paper.insp.lastLine')} onChange={(alignLast) => onApply({ alignLast: alignLast as PaperTextAlignLast })} value={typography.alignLast ?? 'auto'}>
            <option value="auto">{t('paper.insp.auto')}</option><option value="left">{t('paper.insp.left')}</option><option value="center">{t('paper.insp.center')}</option><option value="right">{t('paper.insp.right')}</option><option value="justify">{t('paper.insp.justify')}</option>
          </RichTypeSelect>
          <RichTypeNumber label={t('paper.richType.firstIndentMm')} max={200} min={-200} onChange={(firstLineIndentMm) => onApply({ firstLineIndentMm })} step={0.5} value={typography.firstLineIndentMm ?? 0} />
          <RichTypeNumber label={t('paper.richType.spaceBeforeMm')} max={200} onChange={(spaceBeforeMm) => onApply({ spaceBeforeMm })} step={0.5} value={typography.spaceBeforeMm ?? 0} />
          <RichTypeNumber label={t('paper.richType.spaceAfterMm')} max={200} onChange={(spaceAfterMm) => onApply({ spaceAfterMm })} step={0.5} value={typography.spaceAfterMm ?? 0} />
          <RichTypeNumber label={t('paper.richType.dropCapLines')} max={8} onChange={(dropCapLines) => onApply({ dropCapLines: Math.round(dropCapLines) })} value={typography.dropCapLines ?? 0} />
          <RichTypeSelect label={t('paper.richType.lineBreaking')} onChange={(lineBreak) => onApply({ lineBreak: lineBreak as PaperLineBreak })} value={typography.lineBreak ?? 'auto'}>
            <option value="auto">{t('paper.insp.auto')}</option><option value="balance">{t('paper.insp.balance')}</option><option value="pretty">{t('paper.insp.pretty')}</option>
          </RichTypeSelect>
          <label className="flex items-center justify-between gap-2 text-[10px] text-cyan-100/60">
            {t('paper.insp.hyphenation')}
            <input checked={typography.hyphenate} onChange={(event) => onApply({ hyphenate: event.target.checked })} type="checkbox" />
          </label>
        </section>

        <section className="space-y-1.5 border-l border-cyan-300/10 pl-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">{t('paper.richType.japanese')}</div>
          <RichTypeSelect label={t('paper.insp.orientation')} onChange={(textOrientation) => onApply({ textOrientation: textOrientation as PaperTextOrientation })} value={typography.textOrientation ?? 'mixed'}>
            <option value="mixed">{t('paper.insp.mixedTcy')}</option><option value="upright">{t('paper.insp.upright')}</option>
          </RichTypeSelect>
          <RichTypeSelect label={t('paper.insp.emphasisField')} onChange={(emphasis) => onApply({ emphasis: emphasis as PaperEmphasisMark })} value={typography.emphasis ?? 'none'}>
            <option value="none">{t('paper.insp.none')}</option><option value="dot">{t('paper.richType.emphasis.dot')}</option><option value="sesame">{t('paper.richType.emphasis.sesame')}</option><option value="open-dot">{t('paper.richType.emphasis.openDot')}</option><option value="circle">{t('paper.richType.emphasis.circle')}</option>
          </RichTypeSelect>
          <label className="flex items-center justify-between gap-2 text-[10px] text-cyan-100/60">
            {t('paper.richType.kinsoku')}
            <input checked={Boolean(typography.lineBreakStrict)} onChange={(event) => onApply({ lineBreakStrict: event.target.checked })} type="checkbox" />
          </label>
          <div className="rounded border border-cyan-300/10 bg-[#0b121d] p-2 text-[10px] leading-relaxed text-cyan-100/45">
            {t('paper.richType.help')}
          </div>
        </section>
      </div>
    </div>
  );
}

const PAPER_RICH_SIZE_CHOICES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 32, 48];

/**
 * WYSIWYG editor for an inline-rich text frame: an uncontrolled contentEditable seeded from the frame's runs,
 * with a floating formatting toolbar (bold/italic/underline/strike, super/subscript, lists, font, size,
 * colour). On commit it serialises the DOM back to runs. Only rich frames use it — every other text frame
 * keeps the plain single-style editor, so nothing else in Sloom changes.
 */
export function PaperRichEditableText({
  baseStyle,
  className,
  frame,
  managedFonts,
  onCancel,
  onCommit,
  zoom,
}: {
  baseStyle: React.CSSProperties;
  className: string;
  frame: PaperFrame;
  managedFonts: readonly PaperManagedFontFace[] | undefined;
  onCancel: () => void;
  onCommit: (text: string, richText?: PaperRichParagraph[]) => void;
  zoom: number;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const finishedRef = useRef(false);
  const [openingZoom] = useState(zoom);
  const savedRangeRef = useRef<Range | null>(null);
  const preserveEditorInteractionRef = useRef(false);
  const [toolbarPos, setToolbarPos] = useState<{ left: number; top: number } | null>(null);
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [advancedTypeOpen, setAdvancedTypeOpen] = useState(false);
  const managedFacePlan = useMemo(() => {
    try {
      const faces = collectExactPaperManagedFaces([frame], managedFonts);
      // Empty frames still inherit their frame typography when the first character is typed, so authenticate
      // that exact face before opening the contentEditable even though the output collector skips empty text.
      const inheritedFace = requestedExactPaperManagedFace(frame.typography, managedFonts ?? []);
      if (inheritedFace && !faces.some((face) => face.id === inheritedFace.id)) faces.push(inheritedFace);
      faces.sort((left, right) => left.id.localeCompare(right.id));
      return { faces, error: undefined };
    } catch (error) {
      return { faces: [] as PaperManagedFontFace[], error: error instanceof Error ? error : new Error('Exact managed-font selection failed.') };
    }
  }, [frame, managedFonts]);
  const managedFaceKey = useMemo(() => managedFacePlan.faces.map((face) => [
    face.id,
    face.fontAsset.sha256,
    face.weight,
    face.style,
    face.obliqueAngleDeg,
    face.stretchPercent,
    face.collectionIndex,
    face.variationSettings,
  ]).map((entry) => JSON.stringify(entry)).join('|'), [managedFacePlan.faces]);
  const [managedFaceAuthentication, setManagedFaceAuthentication] = useState<{
    key: string;
    status: 'loading' | 'ready' | 'error';
    error?: Error;
  }>({ key: '', status: 'loading' });
  const managedFacesReady = !managedFacePlan.error && (
    managedFacePlan.faces.length === 0
    || (managedFaceAuthentication.key === managedFaceKey && managedFaceAuthentication.status === 'ready')
  );
  const managedFaceError = managedFacePlan.error
    ?? (managedFaceAuthentication.key === managedFaceKey && managedFaceAuthentication.status === 'error'
      ? managedFaceAuthentication.error
      : undefined);
  const { t, tBoth } = useI18n();

  const base = useMemo(
    () => createRichEditorBase(frame.typography, openingZoom, managedFonts),
    [frame.typography, managedFonts, openingZoom],
  );

  useEffect(() => {
    if (managedFacePlan.error || managedFacePlan.faces.length === 0) return undefined;
    let active = true;
    void Promise.all(managedFacePlan.faces.map((face) => ensurePaperImportedFontRegistered(face)))
      .then(() => {
        if (active) setManagedFaceAuthentication({ key: managedFaceKey, status: 'ready' });
      })
      .catch((error) => {
        if (active) setManagedFaceAuthentication({
          key: managedFaceKey,
          status: 'error',
          error: error instanceof Error ? error : new Error('Exact managed-font authentication failed.'),
        });
      });
    return () => { active = false; };
    // managedFaceKey is the complete immutable identity of the captured faces; an equivalent frame rerender
    // must not tear down an active editor just because collectExactPaperManagedFaces returned a new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedFaceKey, managedFacePlan.error]);

  useEffect(() => {
    if (!managedFacesReady) return undefined;
    const editor = editorRef.current;
    if (!editor) return;
    // A plain frame (no richText yet) is lifted into a single-run seed here purely for the editor's initial
    // DOM — commit() below only persists that promotion if the user actually applies real formatting.
    editor.innerHTML = richTextToEditorHtml(
      ensureRichTextForTransform(frame.richText, frame.text ?? ''),
      openingZoom,
      { typography: frame.typography, managedFonts },
    );
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* older engines */ }
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const rect = editor.getBoundingClientRect();
    setToolbarPos({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 620)), top: Math.max(8, rect.top - 42) });

    // Remember the last selection that lived inside the editor, so toolbar clicks (which move focus) still
    // apply to the text the user had highlighted.
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managedFacesReady]);

  const restoreSelection = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    const range = savedRangeRef.current;
    if (range && (!sel?.rangeCount || !editor.contains(sel.anchorNode))) {
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  const executeCommand = (command: string, value?: string) => {
    restoreSelection();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* older engines */ }
    document.execCommand(command, false, value);
  };
  const runCommand = (command: string, value?: string) => {
    restoreSelection();
    const editor = editorRef.current;
    if (!editor) return;
    void runPaperRichEditorCommand({
      editor,
      range: savedRangeRef.current,
      typography: frame.typography,
      zoom: openingZoom,
      managedFonts: managedFonts ?? [],
      command,
      value,
      isCommandActive: (candidate) => {
        try { return document.queryCommandState(candidate); } catch { return false; }
      },
      authenticateFace: ensurePaperImportedFontRegistered,
      executeFacePatch: (patch) => { applySelectionTypographyPatchNow(patch, managedFonts); },
      executeCollapsedManagedCommand: (face) => {
        restoreSelection();
        try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* older engines */ }
        document.execCommand('fontName', false, paperManagedFontFamilyAlias(face));
        document.execCommand(command, false, value);
      },
      executeCommand,
    }).catch(async (error) => {
      await showAlertDialog({
        title: 'Exact Font Edit Blocked',
        message: error instanceof Error ? error.message : 'The requested exact face could not be authenticated, so the text was not changed.',
        tone: 'danger',
      });
    });
  };
  const createSelectionLink = () => {
    void (async () => {
      const url = await useTextInputDialogStore.getState().requestTextInput({
        title: 'Link selected text',
        message: 'Enter the destination for the highlighted words.',
        label: 'URL',
        initialValue: 'https://',
        placeholder: 'https://example.com',
        confirmLabel: 'Apply link',
      });
      if (url?.trim()) runCommand('createLink', url.trim());
    })();
  };
  const applySelectionTypographyPatchNow = (
    patch: Parameters<typeof applyTypographyPatchToDomSelection>[2],
    paintFonts: readonly PaperManagedFontFace[] | undefined = managedFonts,
    canCommit?: () => boolean,
  ): boolean => {
    if (canCommit && !canCommit()) return false;
    const editor = editorRef.current;
    if (!editor) return false;
    const managedPaint = { typography: frame.typography, managedFonts: paintFonts };
    const applied = applyTypographyPatchToDomSelection(editor, savedRangeRef.current, patch, openingZoom, managedPaint);
    if (applied) {
      savedRangeRef.current = applied.range.cloneRange();
      return true;
    }
    const current = serializeRichEditor(editor, base);
    const richText = applyTypographyPatchToRichText(current, patch) ?? current;
    editor.innerHTML = richTextToEditorHtml(richText, openingZoom, managedPaint);
    const caret = document.createRange();
    caret.selectNodeContents(editor);
    caret.collapse(false);
    savedRangeRef.current = caret;
    return true;
  };
  const applySelectionTypographyPatch = (
    patch: Parameters<typeof applyTypographyPatchToDomSelection>[2],
    paintFonts: readonly PaperManagedFontFace[] | undefined = managedFonts,
    canCommit?: () => boolean,
  ): boolean | Promise<boolean> => {
    if (!FACE_SELECTING_TYPOGRAPHY_KEYS.some((key) => key in patch)) {
      return applySelectionTypographyPatchNow(patch, paintFonts, canCommit);
    }
    try {
      const editor = editorRef.current;
      const selected = editor
        ? collectEffectiveRichEditorSelectionTypographies(editor, savedRangeRef.current, frame.typography, base)
        : [];
      const effective = selected.length ? selected : [frame.typography];
      const exactFaces = requestedExactPaperManagedFacesForTypographyPatch(effective, patch, paintFonts ?? []);
      if (!exactFaces.length) return applySelectionTypographyPatchNow(patch, paintFonts, canCommit);
      return Promise.all(exactFaces.map((face) => ensurePaperImportedFontRegistered(face)))
        .then(() => applySelectionTypographyPatchNow(patch, paintFonts, canCommit))
        .catch(async (error) => {
          if (canCommit && !canCommit()) return false;
          await showAlertDialog({
            title: 'Exact Font Edit Blocked',
            message: error instanceof Error ? error.message : 'The requested exact face could not be authenticated, so the text was not changed.',
            tone: 'danger',
          });
          return false;
        });
    } catch (error) {
      if (canCommit && !canCommit()) return false;
      return showAlertDialog({
        title: 'Exact Font Edit Blocked',
        message: error instanceof Error ? error.message : 'The requested exact face could not be resolved, so the text was not changed.',
        tone: 'danger',
      }).then(() => false);
    }
  };
  const applyFontSizePt = (pt: number) => {
    applySelectionTypographyPatch({ fontSizePt: pt });
  };
  const applyBundledFontFace = async (
    familyName: string,
    face: { id: string; weight: number; style: PaperManagedFontStyle; stretchPercent: number; axes: Record<string, { default: number }> },
    authority: BundledFontSelectionAuthority,
    installedFont: PaperImportedFont,
  ) => {
    if (!authority.isCurrent()) return false;
    const currentFonts = usePaperStore.getState().document.importedFonts;
    const availableFonts = replacePaperImportedFontFace(currentFonts, installedFont);
    const installed = availableFonts.find((candidate) => candidate.id === `bundled-${face.id}`);
    const variationSettings = Object.keys(face.axes).length
      ? Object.fromEntries(Object.entries(face.axes).map(([tag, axis]) => [tag, axis.default]))
      : undefined;
    const patch: Partial<PaperTypography> = {
      fontFamily: familyName,
      fontWeight: String(face.weight),
      fontStyle: face.style === 'oblique' ? `oblique ${installed?.obliqueAngleDeg ?? 14}deg` : face.style,
      fontStretch: `${face.stretchPercent}%`,
      ...(variationSettings ? { fontVariationSettings: variationSettings } : {}),
    };
    if (!await applySelectionTypographyPatch(patch, availableFonts, authority.isCurrent)) return false;
    if (!authority.isCurrent()) return false;
    setFontMenuOpen(false);
    return true;
  };
  // Wrap the selection in Japanese inline notation (furigana 語《》 or emphasis 《《語》》). The notation is
  // inserted as plain text — it round-trips through the frame text and renders as <ruby>/圏点 in the non-editing
  // view (same as typing it by hand), so it also survives export. `caretBackBy` drops the caret inside a trailing
  // 《》 so the letterer can type the reading immediately after pressing ルビ.
  const wrapSelectionWithNotation = (before: string, after: string, caretBackBy = 0) => {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const selected = sel.toString();
    if (!selected && before) return; // emphasis needs a word to mark; furigana (before='') may open an empty 《》
    document.execCommand('insertText', false, `${before}${selected}${after}`);
    const movable = sel as Selection & { modify?: (alter: string, direction: string, granularity: string) => void };
    for (let i = 0; i < caretBackBy; i += 1) movable.modify?.('move', 'backward', 'character');
  };

  // Paragraph-level authoring operates on the block(s) the selection touches, setting BOTH inline style (live
  // preview) and the `data-*` attribute the serializer round-trips — so the change survives the edit commit.
  const blocksInSelection = (): HTMLElement[] => {
    const editor = editorRef.current;
    if (!editor) return [];
    const blocks = Array.from(editor.children).filter((c) => c.nodeName === 'DIV' || c.nodeName === 'P') as HTMLElement[];
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return blocks.slice(0, 1);
    const range = sel.getRangeAt(0);
    const inRange = blocks.filter((b) => {
      try { return range.intersectsNode(b); } catch { return false; }
    });
    if (inRange.length) return inRange;
    let node: Node | null = sel.anchorNode;
    while (node && node.parentElement !== editor) node = node.parentElement;
    return node instanceof HTMLElement ? [node] : blocks.slice(0, 1);
  };
  const updateBlocks = (mutator: (el: HTMLElement) => void) => {
    restoreSelection();
    blocksInSelection().forEach(mutator);
  };
  const setParagraphAlign = (align: 'left' | 'center' | 'right' | 'justify') =>
    updateBlocks((el) => { el.style.textAlign = align; el.dataset.align = align; });
  const toggleDropCap = () =>
    updateBlocks((el) => {
      if (el.dataset.dc) { delete el.dataset.dc; el.classList.remove('paper-dropcap'); el.style.removeProperty('--sl-dropcap-lines'); }
      else { el.dataset.dc = '3'; el.classList.add('paper-dropcap'); el.style.setProperty('--sl-dropcap-lines', '3'); }
    });
  const setParagraphShading = (hex: string) =>
    updateBlocks((el) => { el.dataset.shade = hex; el.style.backgroundColor = hex; });
  const clearParagraphFormat = () =>
    updateBlocks((el) => {
      for (const key of ['align', 'al', 'lead', 'hyph', 'lb', 'lbs', 'shade', 'dc', 'sb', 'sa', 'fi', 'li', 'ri', 'hi', 'borders']) delete el.dataset[key];
      el.classList.remove('paper-dropcap');
      el.removeAttribute('style');
    });

  const commit = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const editor = editorRef.current;
    if (!editor) { onCancel(); return; }
    const richText = serializeRichEditor(editor, base);
    // The plain-frame-promotion policy (promote only on a real formatting action, never on mere entry/plain
    // edits) is pure decision logic — see resolveRichEditorCommit in richTextTransforms.ts for the rules and
    // its own unit tests.
    const decision = resolveRichEditorCommit(richText, frame.richText, frame.text ?? '');
    if (!decision.changed) { onCancel(); return; }
    onCommit(decision.text, decision.richText);
  };
  const cancel = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  };

  useEffect(() => {
    if (!managedFacesReady) return undefined;
    return registerPaperRichEditorSession(frame.id, {
      applyTypography: (previous, next, context) => {
        const patch = changedRichTypographyPatch(previous, next);
        const applyAuthenticatedUpdate = (): ReturnType<PaperRichEditorSession['applyTypography']> => {
          if (context?.authority && !context.authority.isCurrent()) return null;
          const editor = editorRef.current;
          if (!editor || finishedRef.current) return null;
          const currentFonts = context?.managedFonts ?? usePaperStore.getState().document.importedFonts;
          const applied = applyTypographyToDomSelection(
            editor,
            savedRangeRef.current,
            previous,
            next,
            openingZoom,
            { typography: previous, managedFonts: currentFonts },
          );
          if (applied) {
            savedRangeRef.current = applied.range.cloneRange();
            const richText = serializeRichEditor(editor, base);
            return { richText, text: flattenPaperRichText(richText) };
          }

          // A caret-only character edit means "format the frame" (the same fallback as the Inspector when the
          // editor is closed). Rewrite the uncontrolled DOM from the synchronized model immediately so a later
          // blur cannot serialize stale spans back over the Inspector change.
          if (!Object.keys(patch).length) return null;
          const current = serializeRichEditor(editor, base);
          const richText = applyTypographyPatchToRichText(current, patch) ?? current;
          editor.innerHTML = richTextToEditorHtml(
            richText,
            openingZoom,
            { typography: next, managedFonts: currentFonts },
          );
          const caret = document.createRange();
          caret.selectNodeContents(editor);
          caret.collapse(false);
          savedRangeRef.current = caret;
          return { richText, text: flattenPaperRichText(richText) };
        };

        if (!FACE_SELECTING_TYPOGRAPHY_KEYS.some((key) => key in patch)) return applyAuthenticatedUpdate();
        try {
          const currentFonts = context?.managedFonts ?? usePaperStore.getState().document.importedFonts ?? [];
          const exactFace = requestedExactPaperManagedFace(next, currentFonts);
          return exactFace
            ? ensurePaperImportedFontRegistered(exactFace).then(applyAuthenticatedUpdate)
            : applyAuthenticatedUpdate();
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });
  }, [base, frame.id, managedFacesReady, openingZoom]);

  useEffect(() => {
    const preserveSelector = '[data-paper-rich-inspector="true"], [data-advanced-color-picker-panel="true"], [data-text-input-dialog="true"]';
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const element = target instanceof Element ? target : target.parentElement;
      const isPreserved = Boolean(
        editorRef.current?.contains(target)
        || toolbarRef.current?.contains(target)
        || element?.closest(preserveSelector),
      );
      preserveEditorInteractionRef.current = isPreserved;
      if (!isPreserved) commit();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  });

  if (!managedFacesReady) {
    return (
      <div
        className={`${className} flex items-center justify-center p-3`}
        data-paper-rich-editor-font-gate={managedFaceError ? 'error' : 'loading'}
        style={baseStyle}
      >
        <div className="max-w-md rounded border border-rose-300/30 bg-slate-950/95 p-3 text-xs text-slate-100 shadow-xl">
          <div className="font-semibold">{managedFaceError ? 'Exact managed font unavailable' : 'Verifying exact managed font…'}</div>
          <div className="mt-1 text-slate-300">
            {managedFaceError?.message ?? 'The editor will open after the requested face identity is authenticated.'}
          </div>
          {managedFaceError ? (
            <button className="mt-2 rounded border border-slate-500 px-2 py-1 hover:bg-slate-800" onClick={onCancel} type="button">
              Close editor
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const toolbar = toolbarPos && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed z-[999] flex items-center gap-0.5 rounded-md border border-cyan-400/40 bg-slate-900/95 px-1.5 py-1 text-slate-100 shadow-xl"
          onMouseDown={(event) => { if (event.target === event.currentTarget) event.preventDefault(); }}
          ref={toolbarRef}
          style={{ left: toolbarPos.left, top: toolbarPos.top }}
        >
          <PaperContextualToolbarButton onApply={() => runCommand('bold')} title="Bold (Ctrl+B)"><b>B</b></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('italic')} title="Italic (Ctrl+I)"><i>I</i></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('underline')} title="Underline (Ctrl+U)"><u>U</u></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('strikeThrough')} title="Strikethrough"><s>S</s></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('superscript')} title="Superscript"><span>x²</span></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('subscript')} title="Subscript"><span>x₂</span></PaperContextualToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-cyan-300/20" />
          <PaperContextualToolbarButton onApply={() => runCommand('insertUnorderedList')} title="Bullet list">•</PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('insertOrderedList')} title="Numbered list">1.</PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={createSelectionLink} title="Link selected text">↗</PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => runCommand('unlink')} title="Remove link">↗̸</PaperContextualToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-cyan-300/20" />
          <PaperContextualToolbarButton
            onApply={() => wrapSelectionWithNotation('', '《》', 1)}
            title={t('paper.jp.furigana.tooltip')}
          >
            {tBoth('paper.jp.furigana')}
          </PaperContextualToolbarButton>
          <PaperContextualToolbarButton
            onApply={() => wrapSelectionWithNotation('《《', '》》')}
            title={t('paper.jp.emphasis.tooltip')}
          >
            <span style={{ textEmphasis: 'filled sesame', textEmphasisPosition: 'over' } as React.CSSProperties}>圏</span>
          </PaperContextualToolbarButton>
          <span className="mx-0.5 h-4 w-px bg-cyan-300/20" />
          <div className="relative">
            <button
              className="rounded bg-slate-800 px-2 py-0.5 text-[11px] hover:bg-slate-700"
              onClick={() => setFontMenuOpen((open) => !open)}
              onMouseDown={(event) => event.preventDefault()}
              title="Audited font library"
              type="button"
            >
              Font…
            </button>
            {fontMenuOpen ? (
              <div className="absolute left-0 top-7 z-[1000] w-[28rem] rounded-lg bg-slate-950 p-1 shadow-2xl">
                <PaperBundledFontFaceBrowser
                  fontFamily={frame.typography.fontFamily}
                  fontStyle={paperFontStyleFromCss(frame.typography.fontStyle)}
                  fontWeight={Number.parseInt(frame.typography.fontWeight, 10) || 400}
                  initiallyOpen
                  onSelect={(family, face, authority, installedFont) => applyBundledFontFace(family.family, face, authority, installedFont)}
                />
              </div>
            ) : null}
          </div>
          <select
            className="rounded bg-slate-800 px-1 py-0.5 text-[11px]"
            onChange={(event) => { const value = event.target.value; event.currentTarget.selectedIndex = 0; if (value) applyFontSizePt(Number(value)); }}
            title="Font size (pt)"
            value=""
          >
            <option value="">Size…</option>
            {PAPER_RICH_SIZE_CHOICES.map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
          <AdvancedColorPicker
            buttonClassName="rounded border border-cyan-300/20"
            className="h-5 w-6"
            label="Selected text colour"
            onChange={(color) => {
              if (applySelectionTypographyPatch({ color }) === false) runCommand('foreColor', color);
            }}
            title="Text colour"
            value={cssColorToPickerValue(frame.typography.color)}
          />
          <AdvancedColorPicker
            buttonClassName="rounded border border-cyan-300/20"
            className="h-5 w-6"
            label="Selected text highlight"
            onChange={(color) => runCommand('hiliteColor', color)}
            title="Highlight colour"
            value="#fff59d"
          />
          <div className="relative">
            <button
              aria-expanded={advancedTypeOpen}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${advancedTypeOpen ? 'bg-cyan-500/30 text-cyan-100' : 'bg-slate-800 hover:bg-slate-700'}`}
              onClick={() => setAdvancedTypeOpen((open) => !open)}
              onMouseDown={(event) => event.preventDefault()}
              title="Advanced character, paragraph, and Japanese typesetting"
              type="button"
            >
              Type…
            </button>
            {advancedTypeOpen ? (
              <div className="absolute right-0 top-7 z-[1000]">
                <PaperRichAdvancedTypePanel
                  onApply={(patch) => { applySelectionTypographyPatch(patch); }}
                  typography={frame.typography}
                />
              </div>
            ) : null}
          </div>
          <span className="mx-0.5 h-4 w-px bg-cyan-300/20" />
          <PaperContextualToolbarButton onApply={() => setParagraphAlign('left')} title="Align left"><span aria-hidden>⇤</span></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => setParagraphAlign('center')} title="Align centre"><span aria-hidden>≡</span></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => setParagraphAlign('right')} title="Align right"><span aria-hidden>⇥</span></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={() => setParagraphAlign('justify')} title="Justify"><span aria-hidden>▤</span></PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={toggleDropCap} title="Toggle drop cap"><span className="font-serif">D̲</span></PaperContextualToolbarButton>
          <AdvancedColorPicker
            buttonClassName="rounded border border-cyan-300/20"
            className="h-5 w-6"
            label="Paragraph shading colour"
            onChange={setParagraphShading}
            title="Paragraph shading"
            value="#e2e8f0"
          />
          <span className="mx-0.5 h-4 w-px bg-cyan-300/20" />
          <PaperContextualToolbarButton onApply={() => runCommand('removeFormat')} title="Clear run formatting">⌫</PaperContextualToolbarButton>
          <PaperContextualToolbarButton onApply={clearParagraphFormat} title="Clear paragraph formatting"><span aria-hidden>¶⌫</span></PaperContextualToolbarButton>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {toolbar}
      <div
        className={className}
        contentEditable
        onBlur={(event) => {
          // Inspector, toolbar, and portalled colour controls deliberately preserve the editor session/range.
          // A document-level pointer listener commits on the next click outside those authoring surfaces.
          if (preserveEditorInteractionRef.current) return;
          if (toolbarRef.current && event.relatedTarget instanceof Node && toolbarRef.current.contains(event.relatedTarget)) return;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            cancel();
            event.currentTarget.blur();
            return;
          }
          // Ctrl/Cmd+B/I/U — the same bold/italic/underline the floating toolbar's B/I/U buttons already run
          // (runCommand, just below), wired to the keyboard so authoring formatting doesn't require reaching
          // for the mouse. See richTextTransforms.ts's commit note for why this reuses the existing
          // execCommand path here rather than the new pure library directly (a live-DOM-selection ->
          // character-range mapping problem, checkpointed rather than rushed).
          if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
            const key = event.key.toLowerCase();
            if (key === 'b' || key === 'i' || key === 'u') {
              event.preventDefault();
              event.stopPropagation();
              runCommand(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
              return;
            }
          }
          // Enter inserts a new paragraph (word-processor behaviour); commit happens on blur / Escape. Stop
          // propagation so the workspace's global shortcuts don't fire while typing.
          event.stopPropagation();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        ref={editorRef}
        role="textbox"
        spellCheck
        style={baseStyle}
        suppressContentEditableWarning
      />
    </>
  );
}

function isPaperInlineTextFrame(frame: PaperFrame): boolean {
  return frame.kind === 'text' || frame.kind === 'caption' || frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble';
}

function normalizePaperInlineText(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replaceAll('\u00a0', ' ');
}

function PaperBubbleTextBoxHandles({
  frame,
  onBeginMove,
  onBeginResize,
  onBeginRotate,
}: {
  frame: PaperFrame;
  onBeginMove: (event: React.PointerEvent<HTMLElement>) => void;
  onBeginResize: (handle: PaperResizeHandle, event: React.PointerEvent<HTMLElement>) => void;
  onBeginRotate: (event: React.PointerEvent<HTMLElement>) => void;
}) {
  const textBox = resolvePaperTextBox(frame);
  const handles: PaperResizeHandle[] = ['nw', 'ne', 'se', 'sw'];

  return (
    <div
      className="absolute z-30 cursor-move border border-cyan-500/80 bg-transparent"
      onPointerDown={(event) => {
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onBeginMove(event);
      }}
      style={{
        ...paperTextBoxReactStyle(frame),
        outline: '1px solid rgba(255,255,255,0.75)',
      }}
      title="Drag bubble text box"
    >
      <button
        className="absolute left-1/2 top-0 flex h-5 w-5 -translate-x-1/2 -translate-y-7 items-center justify-center rounded-full border border-cyan-700 bg-white text-cyan-700 shadow"
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onBeginRotate(event);
        }}
        title="Rotate bubble text"
        type="button"
      >
        <RotateCw size={11} />
      </button>
      {handles.map((handle) => (
        <button
          className={`absolute h-2.5 w-2.5 rounded-full border border-cyan-700 bg-white shadow ${
            handle.includes('n') ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2'
          } ${handle.includes('w') ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'}`}
          key={handle}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            onBeginResize(handle, event);
          }}
          title={`Resize bubble text ${handle.toUpperCase()}`}
          type="button"
        />
      ))}
      <span className="pointer-events-none absolute bottom-0 right-0 rounded-tl bg-cyan-500/90 px-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-white">
        {textBox.verticalAlign}
      </span>
    </div>
  );
}

function SvgGradientDef({ frame }: { frame: PaperFrame }) {
  if (!frame.fillGradient) return null;
  const vector = gradientVector(frame.fillGradient.angleDeg);
  return (
    <defs>
      <linearGradient
        id={svgGradientId(frame.id)}
        x1={`${vector.x1}%`}
        x2={`${vector.x2}%`}
        y1={`${vector.y1}%`}
        y2={`${vector.y2}%`}
      >
        <stop offset="0%" stopColor={frame.fillGradient.fromColor} />
        <stop offset="100%" stopColor={frame.fillGradient.toColor} />
      </linearGradient>
    </defs>
  );
}

function PaperBubbleHandles({
  frame,
  onBeginHandle,
}: {
  frame: PaperFrame;
  onBeginHandle: (handle: PaperBubbleHandle) => void;
}) {
  // Each side handle sits on the edge it now shapes (per-side warp), so it tracks its own bulge/pinch.
  const radii = resolveBubbleRadii(frame);
  // Order matters: later siblings + higher zIndex win overlapping clicks. The tail (the thing you grab
  // most, and which used to sit under the bottom edge handle) is rendered LAST and on top; pinch/curve
  // next; the four edge handles underneath.
  const handles: Array<{ handle: PaperBubbleHandle; x: number; y: number; title: string; z: number }> = [
    { handle: 'left', x: 50 - radii.rLeft, y: 50, title: 'Left edge', z: 10 },
    { handle: 'right', x: 50 + radii.rRight, y: 50, title: 'Right edge', z: 10 },
    { handle: 'top', x: 50, y: 50 - radii.rTop, title: 'Top edge', z: 10 },
    { handle: 'bottom', x: 50, y: 50 + radii.rBottom, title: 'Bottom edge', z: 10 },
    { handle: 'curve', ...resolveBubbleTailCurveHandle(frame), title: 'Tail curve', z: 20 },
    { handle: 'pinch', x: frame.bubblePinchXPercent ?? 58, y: frame.bubblePinchYPercent ?? 75, title: 'Tail base / pinch', z: 20 },
    { handle: 'tail', x: frame.tailXPercent ?? 72, y: frame.tailYPercent ?? 92, title: 'Tail point', z: 30 },
  ];

  return (
    <>
      {handles.map((entry) => (
        <button
          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border shadow ${
            entry.handle === 'tail'
              ? 'h-4 w-4 border-amber-600 bg-amber-300'
              : 'h-3.5 w-3.5 border-cyan-700 bg-white'
          }`}
          key={entry.handle}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            onBeginHandle(entry.handle);
          }}
          style={{ left: `${entry.x}%`, top: `${entry.y}%`, zIndex: entry.z }}
          title={entry.title}
          type="button"
        />
      ))}
    </>
  );
}

function readPaperContextMenuViewport(): { width: number; height: number; top: number } {
  if (typeof window === 'undefined') {
    return { width: 1024, height: 768, top: 0 };
  }
  // The fixed top chrome (navbar + menu row) paints above popovers, so the menu must
  // never be clamped underneath it — usable space starts at the canvas region's top.
  const canvasTop = document
    .querySelector('[data-paper-scroll-container="true"]')
    ?.getBoundingClientRect().top ?? 0;
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    top: Math.max(0, Math.round(canvasTop)),
  };
}

export function PaperContextMenu({
  bubbleChainActionsDisabled = false,
  context,
  frame,
  hasStyleClipboard,
  onAddComicSfx,
  onApplyFrameAction,
  onApplyPageAction,
  onChainSelectedBubbles,
  onClose,
  onCopyFrameStyle,
  onEditComicSfxFrame,
  onOpenImageFrame,
  onOpenImageFrameInHane,
  onQuickEditImageFrame,
  onAiFixImageFrame,
  onUpscaleFrameForPrint,
  onFitFrameToText,
  onPasteFrameStyle,
  onPlaceSourceInFrame,
  onSendFrameSourceToFlow,
  onLocateFrameSourceInFlow,
  onSendFrameSourceToVideo,
  onSendPageToSourceLibrary,
  onSendAllPagesToSourceLibrary,
  onUnchainSelectedBubbles,
  onThreadSelectedFrames,
  onUnthreadSelectedFrames,
  onAlignSelectedFrames,
  onDistributeSelectedFrames,
  selectedBubbleCount,
  selectedTextFrameCount,
  selectedFrameCount,
  sourceItems,
  haneLinkedEditTarget,
}: {
  bubbleChainActionsDisabled?: boolean;
  context: PaperContextMenuState;
  frame?: PaperFrame;
  hasStyleClipboard: boolean;
  onAddComicSfx: (presetId: PaperComicSfxPresetId, pageId: string, point: PaperPoint) => void;
  onApplyFrameAction: (pageId: string, frameId: string, actionId: PaperFrameContextActionId) => void;
  onApplyPageAction: (pageId: string, actionId: PaperPageContextActionId, point: PaperPoint, sourceItem?: SourceBinLibraryItem) => void;
  onChainSelectedBubbles: (style?: PaperBubbleConnectorStyle) => void;
  onClose: () => void;
  onCopyFrameStyle: () => void;
  onEditComicSfxFrame: (pageId: string, frame: PaperFrame | undefined) => void;
  onOpenImageFrame: (pageId: string, frameId: string | undefined, frame: PaperFrame | undefined) => void;
  onOpenImageFrameInHane: (pageId: string, frameId: string, frame: PaperFrame | undefined) => void;
  onQuickEditImageFrame: (pageId: string, frameId: string) => void;
  onAiFixImageFrame: (pageId: string, frameId: string) => void;
  onUpscaleFrameForPrint: (pageId: string, frame: PaperFrame | undefined) => void;
  /** Grows a clipping text/caption frame's height to fit its measured content (see frameOverflow.ts's
   *  computeFitToTextFrameHeightMm). Not offered for bubbles — see isPlainInlineTextFrame in PaperFrameView. */
  onFitFrameToText: (pageId: string, frameId: string) => void;
  onPasteFrameStyle: () => void;
  onPlaceSourceInFrame: (pageId: string, frameId: string, item: SourceBinLibraryItem) => void;
  onSendFrameSourceToFlow: (frame: PaperFrame | undefined) => void;
  onLocateFrameSourceInFlow?: (frame: PaperFrame | undefined) => void;
  onSendFrameSourceToVideo: (frame: PaperFrame | undefined) => void;
  onSendPageToSourceLibrary: (pageId: string) => void;
  onSendAllPagesToSourceLibrary: () => void;
  onUnchainSelectedBubbles: () => void;
  onThreadSelectedFrames: () => void;
  onUnthreadSelectedFrames: () => void;
  onAlignSelectedFrames: (edge: PaperAlignEdge) => void;
  onDistributeSelectedFrames: (axis: PaperDistributeAxis) => void;
  selectedBubbleCount: number;
  selectedTextFrameCount: number;
  selectedFrameCount: number;
  sourceItems: SourceBinLibraryItem[];
  haneLinkedEditTarget?: { pageId: string; frameId: string } | null;
}) {
  const { t, tf, locale } = useI18n();
  const imageItems = sourceItems.filter((item) => item.kind === 'image').slice(0, 8);
  const textItems = sourceItems.filter((item) => item.kind === 'text').slice(0, 8);
  const groupedFrameActions = groupContextActions(PAPER_FRAME_CONTEXT_ACTIONS);
  const groupedPageActions = groupContextActions(PAPER_PAGE_CONTEXT_ACTIONS);
  const isComicSfxFrame = Boolean(frame?.comicSfxDesign);
  const isHaneLinkedFrame = Boolean(
    context.frameId
    && haneLinkedEditTarget?.pageId === context.pageId
    && haneLinkedEditTarget.frameId === context.frameId,
  );
  const menuRef = useRef<HTMLDivElement | null>(null);
  const viewport = useMemo(() => readPaperContextMenuViewport(), []);
  const maxHeight = getContextMenuMaxHeight(viewport);
  const fallbackMenuPosition = useMemo(
    () => clampContextMenuPosition(
      { x: context.x, y: context.y },
      viewport,
      { width: 288, height: maxHeight },
    ),
    [context.x, context.y, maxHeight, viewport],
  );
  const [menuPosition, setMenuPosition] = useState(fallbackMenuPosition);

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [onClose]);

  useLayoutEffect(() => {
    const rect = menuRef.current?.getBoundingClientRect();
    const measuredSize = {
      width: Math.round(rect?.width ?? 288),
      height: Math.min(maxHeight, Math.round(rect?.height ?? maxHeight)),
    };
    const nextPosition = clampContextMenuPosition(
      { x: context.x, y: context.y },
      viewport,
      measuredSize,
    );
    setMenuPosition((current) => (
      current.x === nextPosition.x && current.y === nextPosition.y
        ? current
        : nextPosition
    ));
  }, [context.x, context.y, maxHeight, viewport]);

  return (
    <div
      className="fixed z-[80] w-72 overflow-y-auto rounded-md border border-cyan-300/20 bg-[#0b121d] p-2 text-xs text-cyan-50 shadow-2xl"
      data-paper-context-menu="true"
      onClick={(event) => event.stopPropagation()}
      ref={menuRef}
      style={{ left: menuPosition.x, maxHeight, top: menuPosition.y }}
    >
      {frame && context.frameId ? (
        <>
          <MenuHeading label={frame.label} />
          {isComicSfxFrame ? (
            <MenuGroup label={t('paper.ctx.comicSfx')}>
              <MenuButton label={t('paper.ctx.editDecal')} onClick={() => {
                onEditComicSfxFrame(context.pageId, frame);
                onClose();
              }} />
            </MenuGroup>
          ) : null}
          {frame.kind === 'image' && !isComicSfxFrame ? (
            <MenuButton
              label={t(isHaneLinkedFrame ? 'paper.ctx.stopHaneEdit' : 'paper.ctx.openInHane')}
              onClick={() => {
                onOpenImageFrameInHane(context.pageId, context.frameId!, frame);
                onClose();
              }}
            />
          ) : null}
          {frame.asset?.kind === 'image' && !isComicSfxFrame ? (
            <>
              <MenuButton label={t('paper.ctx.quickEdit')} onClick={() => {
                if (context.frameId) onQuickEditImageFrame(context.pageId, context.frameId);
                onClose();
              }} />
              <MenuButton label={t('paper.ctx.aiFix')} onClick={() => {
                if (context.frameId) onAiFixImageFrame(context.pageId, context.frameId);
                onClose();
              }} />
              <MenuButton label={t('paper.ctx.editInImage')} onClick={() => {
                onOpenImageFrame(context.pageId, context.frameId, frame);
                onClose();
              }} />
              <MenuButton label={t('paper.ctx.upscale')} onClick={() => {
                onUpscaleFrameForPrint(context.pageId, frame);
              }} />
              <MenuButton label={t('paper.ctx.sendToFlow')} onClick={() => {
                onSendFrameSourceToFlow(frame);
                onClose();
              }} />
              <MenuButton label={t('paper.ctx.locateInFlow')} onClick={() => {
                onLocateFrameSourceInFlow?.(frame);
                onClose();
              }} />
              <MenuButton label={t('paper.ctx.useInVideo')} onClick={() => {
                onSendFrameSourceToVideo(frame);
                onClose();
              }} />
            </>
          ) : null}
          {(frame.kind === 'text' || frame.kind === 'caption') && context.frameId ? (
            <MenuButton label="Fit Frame to Text" onClick={() => {
              onFitFrameToText(context.pageId, context.frameId!);
            }} />
          ) : null}
          {Object.entries(groupedFrameActions).map(([group, actions]) => (
            <MenuGroup key={group} label={paperActionGroupLabel(group, locale)}>
              {actions.map((action) => (
                <MenuButton
                  key={action.id}
                  label={paperActionLabel(action, locale)}
                  onClick={() => onApplyFrameAction(context.pageId, context.frameId!, action.id)}
                />
              ))}
            </MenuGroup>
          ))}
          <MenuGroup label={t('paper.ctx.styleClipboard')}>
            <MenuButton label={t('paper.ctx.copyStyle')} onClick={onCopyFrameStyle} />
            <MenuButton disabled={!hasStyleClipboard} label={t('paper.ctx.pasteStyle')} onClick={onPasteFrameStyle} />
          </MenuGroup>
          {frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' ? (
            <MenuGroup label={t('paper.ctx.bubbleChain')}>
              {selectedBubbleCount < 2 ? <MenuHint label={t('paper.ctx.selectBubblesHint')} /> : null}
              <MenuButton disabled={bubbleChainActionsDisabled || selectedBubbleCount < 2} label={tf('paper.ctx.mergeBubbles', { count: selectedBubbleCount })} onClick={() => onChainSelectedBubbles('bridge')} />
              <MenuButton disabled={bubbleChainActionsDisabled || selectedBubbleCount < 2} label={t('paper.ctx.linkLine')} onClick={() => onChainSelectedBubbles('line')} />
              <MenuButton disabled={bubbleChainActionsDisabled || selectedBubbleCount < 2} label={t('paper.ctx.linkTail')} onClick={() => onChainSelectedBubbles('tail')} />
              <MenuButton disabled={bubbleChainActionsDisabled || selectedBubbleCount < 2} label={t('paper.ctx.linkThought')} onClick={() => onChainSelectedBubbles('thought-dots')} />
              <MenuButton
                disabled={bubbleChainActionsDisabled || !frame.bubbleChainId}
                label={selectedBubbleCount >= 2 ? t('paper.ctx.unchainSelected') : t('paper.ctx.unchainThis')}
                onClick={onUnchainSelectedBubbles}
              />
            </MenuGroup>
          ) : null}
          {selectedTextFrameCount >= 2 ? (
            <MenuGroup label={t('paper.ctx.textThread')}>
              <MenuButton label={tf('paper.ctx.threadFrames', { count: selectedTextFrameCount })} onClick={onThreadSelectedFrames} />
              <MenuButton label={t('paper.ctx.unthreadSelected')} onClick={onUnthreadSelectedFrames} />
            </MenuGroup>
          ) : frame && frame.kind === 'text' && frame.threadId ? (
            <MenuGroup label={t('paper.ctx.textThread')}>
              <MenuButton label={t('paper.ctx.unthreadThis')} onClick={onUnthreadSelectedFrames} />
            </MenuGroup>
          ) : null}
          {selectedFrameCount >= 2 ? (
            <MenuGroup label={t('paper.ctx.alignDistribute')}>
              <div className="grid grid-cols-3 gap-1 px-2 py-1">
                {(([['paper.ctx.align.left', 'left'], ['paper.ctx.align.center', 'centerX'], ['paper.ctx.align.right', 'right'], ['paper.ctx.align.top', 'top'], ['paper.ctx.align.middle', 'centerY'], ['paper.ctx.align.bottom', 'bottom']]) as Array<[MessageKey, PaperAlignEdge]>).map(([labelKey, edge]) => (
                  <button
                    className="rounded border border-cyan-300/15 bg-[#101a29]/70 px-1.5 py-1 text-[11px] text-cyan-100/75 hover:border-cyan-300/40 hover:text-white"
                    key={edge}
                    onClick={() => onAlignSelectedFrames(edge)}
                    type="button"
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
              {selectedFrameCount >= 3 ? (
                <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                  {(([['paper.ctx.distributeH', 'horizontal'], ['paper.ctx.distributeV', 'vertical']]) as Array<[MessageKey, PaperDistributeAxis]>).map(([labelKey, axis]) => (
                    <button
                      className="rounded border border-cyan-300/15 bg-[#101a29]/70 px-1.5 py-1 text-[11px] text-cyan-100/75 hover:border-cyan-300/40 hover:text-white"
                      key={axis}
                      onClick={() => onDistributeSelectedFrames(axis)}
                      type="button"
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
              ) : null}
            </MenuGroup>
          ) : null}
          {imageItems.length || textItems.length ? (
            <MenuGroup label={t('paper.ctx.placeSource')}>
              {[...imageItems, ...textItems].map((item) => (
                <MenuButton
                  key={item.id}
                  label={item.label}
                  onClick={() => onPlaceSourceInFrame(context.pageId, context.frameId!, item)}
                />
              ))}
            </MenuGroup>
          ) : null}
        </>
      ) : (
        <>
          <MenuHeading label={t('paper.ctx.page')} />
          <MenuGroup label={t('paper.ctx.sendToSourceLib')}>
            <MenuButton
              label={t('paper.ctx.sendThisPage')}
              onClick={() => onSendPageToSourceLibrary(context.pageId)}
            />
            <MenuButton
              label={t('paper.ctx.sendAllPages')}
              onClick={() => onSendAllPagesToSourceLibrary()}
            />
          </MenuGroup>
          <MenuGroup label={t('paper.ctx.comicSfx')}>
            {PAPER_COMIC_SFX_PRESET_IDS.map((presetId) => {
              const preset = getPaperComicSfxPreset(presetId);
              return (
                <MenuButton
                  key={presetId}
                  label={tf('paper.ctx.designHere', { name: preset.label })}
                  onClick={() => onAddComicSfx(presetId, context.pageId, context.point)}
                />
              );
            })}
          </MenuGroup>
          {Object.entries(groupedPageActions).map(([group, actions]) => (
            <MenuGroup key={group} label={paperActionGroupLabel(group, locale)}>
              {actions.map((action) => (
                <MenuButton
                  key={action.id}
                  label={paperActionLabel(action, locale)}
                  onClick={() => onApplyPageAction(context.pageId, action.id, context.point)}
                />
              ))}
            </MenuGroup>
          ))}
          {imageItems.length || textItems.length ? (
            <MenuGroup label={t('paper.ctx.dropSource')}>
              {imageItems.map((item) => (
                <MenuButton
                  key={item.id}
                  label={tf('paper.ctx.imageItem', { name: item.label })}
                  onClick={() => onApplyPageAction(context.pageId, 'add-image-here', context.point, item)}
                />
              ))}
              {textItems.map((item) => (
                <MenuButton
                  key={item.id}
                  label={tf('paper.ctx.textItem', { name: item.label })}
                  onClick={() => onApplyPageAction(context.pageId, 'add-caption-here', context.point, item)}
                />
              ))}
            </MenuGroup>
          ) : null}
        </>
      )}
    </div>
  );
}

function MenuHeading({ label }: { label: string }) {
  return <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-100/45">{label}</div>;
}

function MenuGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="mt-1 border-t border-cyan-300/10 pt-1">
      <div className="px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100/35">{label}</div>
      {children}
    </div>
  );
}

function MenuHint({ label }: { label: string }) {
  return <div className="px-2 pb-1.5 text-[11px] leading-4 text-cyan-100/45">{label}</div>;
}

function MenuButton({ disabled = false, label, onClick }: { disabled?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className="block w-full rounded px-2 py-1.5 text-left text-cyan-50/80 hover:bg-cyan-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-cyan-50/80"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function groupContextActions<TActionId extends string>(
  actions: Array<{ id: TActionId; label: string; group: string }>,
): Record<string, Array<{ id: TActionId; label: string; group: string }>> {
  return actions.reduce<Record<string, Array<{ id: TActionId; label: string; group: string }>>>((groups, action) => {
    groups[action.group] = [...(groups[action.group] ?? []), action];
    return groups;
  }, {});
}

function paperNumericStyleToCss(style: PaperNumericStyle | undefined): React.CSSProperties['fontVariantNumeric'] {
  switch (style) {
    case 'oldstyle':
      return 'oldstyle-nums';
    case 'lining':
      return 'lining-nums';
    case 'tabular':
      return 'tabular-nums';
    default:
      return undefined;
  }
}

function PaperFindChangePanel({
  document,
  onReplaceAll,
  onSelectMatch,
}: {
  document: PaperDocument;
  onReplaceAll: (query: string, replacement: string, options: PaperFindOptions) => number;
  onSelectMatch: (target: { pageNumber: number; frameId: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [lastStatus, setLastStatus] = useState<string | null>(null);

  const { matches, pageNumberById } = useMemo(() => {
    const refs: { pageId: string; frameId: string; text: string }[] = [];
    const pageNumbers = new Map<string, number>();
    for (const page of document.pages) {
      pageNumbers.set(page.id, page.pageNumber);
      for (const pageFrame of page.frames) {
        if (typeof pageFrame.text === 'string' && pageFrame.text.length > 0) {
          refs.push({ pageId: page.id, frameId: pageFrame.id, text: pageFrame.text });
        }
      }
    }
    return { matches: findPaperMatches(refs, query, { caseSensitive, wholeWord }), pageNumberById: pageNumbers };
  }, [document.pages, query, caseSensitive, wholeWord]);

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-xs text-cyan-100/80">
      <input className="paper-input" onChange={(event) => setQuery(event.target.value)} placeholder="Find…" value={query} />
      <input className="paper-input" onChange={(event) => setReplacement(event.target.value)} placeholder="Change to…" value={replacement} />
      <div className="flex gap-3 text-cyan-100/55">
        <label className="flex items-center gap-1">
          <input checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} type="checkbox" />
          Case
        </label>
        <label className="flex items-center gap-1">
          <input checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} type="checkbox" />
          Whole word
        </label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-cyan-100/50">{query ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : 'Enter a search term'}</span>
        <button
          className="rounded border border-cyan-300/20 px-2 py-1 text-cyan-100/70 hover:border-cyan-300/50 hover:text-white disabled:opacity-40"
          disabled={!query || matches.length === 0}
          onClick={() => {
            const replaced = onReplaceAll(query, replacement, { caseSensitive, wholeWord });
            setLastStatus(`Replaced ${replaced} occurrence${replaced === 1 ? '' : 's'}.`);
          }}
          type="button"
        >
          Replace All
        </button>
      </div>
      {lastStatus ? <div className="text-emerald-300/80">{lastStatus}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto rounded border border-cyan-300/10">
        {matches.slice(0, 200).map((match, index) => {
          const pageNumber = pageNumberById.get(match.pageId) ?? 1;
          return (
            <button
              className="flex w-full items-center justify-between gap-2 border-b border-cyan-300/5 px-2 py-1 text-left hover:bg-cyan-300/5"
              key={`${match.frameId}-${match.index}-${index}`}
              onClick={() => onSelectMatch({ pageNumber, frameId: match.frameId })}
              type="button"
            >
              <span className="truncate">p{pageNumber} · {match.frameId}</span>
              <span className="text-cyan-100/40">@{match.index}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PaperInspector({
  document,
  documentTitle,
  frame,
  onDeletePage,
  onUpdateDocumentSetup,
  onUpdatePublicationReferences,
  onUpdatePaperTrackChanges,
  onDecidePaperTrackChange,
  onUpdateStyleAutomation,
  onUpdateFrame,
  onExportDerivedPdf,
  onUpdateBubbleConnectorGeometry,
  onChainBubbleWith,
  onMoveBubbleInChain,
  onUnchainBubble,
  onAddSwatch,
  onRemoveSwatch,
  onToggleViewOption,
  onAddParentPage,
  onAddSelectedFrameToParent,
  onAssignParentPage,
  onClearStyleLinks,
  onClearStyleOverrides,
  onCopyStyle,
  onEditComicSfxFrame,
  onSendGeneratedMediaToFlow,
  onPasteStyle,
  onRedefineStyle,
  canPasteStyle,
  pageCount,
  selectedPageNumber,
  status,
}: {
  document: PaperDocument;
  documentTitle: string;
  frame: PaperFrame | null;
  canPasteStyle: boolean;
  onDeletePage: () => void;
  onUpdateDocumentSetup: ReturnType<typeof usePaperStore.getState>['updateDocumentSetup'];
  onUpdatePublicationReferences: ReturnType<typeof usePaperStore.getState>['updatePaperPublicationReferences'];
  onUpdatePaperTrackChanges?: ReturnType<typeof usePaperStore.getState>['updatePaperTrackChanges'];
  onDecidePaperTrackChange?: ReturnType<typeof usePaperStore.getState>['decidePaperTrackChange'];
  onUpdateStyleAutomation: ReturnType<typeof usePaperStore.getState>['updateStyleAutomation'];
  onUpdateFrame: (patch: PaperFramePatch) => void;
  /** Routes one derived data-merge record document through the existing Paper PDF/print pipeline. */
  onExportDerivedPdf?: (derivedDocument: PaperDocument) => void | Promise<void>;
  onUpdateBubbleConnectorGeometry: (
    ownerFrameId: string,
    geometry: PaperFrame['bubbleConnectorGeometry'],
  ) => void;
  onChainBubbleWith: (targetFrameId: string) => void;
  onMoveBubbleInChain: (direction: 'earlier' | 'later') => void;
  onUnchainBubble: () => void;
  onAddSwatch: ReturnType<typeof usePaperStore.getState>['addPaperSwatch'];
  onRemoveSwatch: ReturnType<typeof usePaperStore.getState>['removePaperSwatch'];
  onToggleViewOption: ReturnType<typeof usePaperStore.getState>['toggleViewOption'];
  onAddParentPage: () => void;
  onAddSelectedFrameToParent: (parentPageId: string) => void;
  onAssignParentPage: (parentPageId: string) => void;
  onClearStyleLinks: () => void;
  onClearStyleOverrides: () => void;
  onCopyStyle: () => void;
  onEditComicSfxFrame: () => void;
  onSendGeneratedMediaToFlow: () => void;
  onPasteStyle: () => void;
  onRedefineStyle: (kind: 'paragraph' | 'character' | 'object') => void;
  pageCount: number;
  selectedPageNumber: number;
  status: string;
}) {
  const { t } = useI18n();
  const frameTypography = frame?.typography;
  const documentBackground = document.background ?? DEFAULT_PAPER_BACKGROUND;
  const documentSwatches = document.swatches ?? [];
  const selectedFillSwatch = frame?.fillSwatchId
    ? documentSwatches.find((swatch) => swatch.id === frame.fillSwatchId)
    : undefined;
  const selectedStrokeSwatch = frame?.strokeSwatchId
    ? documentSwatches.find((swatch) => swatch.id === frame.strokeSwatchId)
    : undefined;
  const currentPage = document.pages.find((page) => page.pageNumber === selectedPageNumber) ?? document.pages[0];
  const effectiveFrame = frame ? computeEffectivePaperFrame(document, frame) : null;
  const selectedFontFamily = frameTypography?.fontFamily ?? '';
  const [newSpotName, setNewSpotName] = useState('');
  const [trackAuthor, setTrackAuthor] = useState('Author');
  const [trackText, setTrackText] = useState('');
  const commitBundledFrameTypography = usePaperStore((state) => state.commitBundledFrameTypography);
  const inspectorGeneration = useRef(0);
  const inspectorAuthority = useRef<{
    document: PaperDocument;
    page: PaperDocument['pages'][number];
    frame: PaperFrame;
    generation: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!frame) {
      inspectorAuthority.current = null;
      return;
    }
    const authority = { document, page: currentPage, frame, generation: ++inspectorGeneration.current };
    inspectorAuthority.current = authority;
    return () => {
      if (inspectorAuthority.current === authority) inspectorAuthority.current = null;
    };
  }, [currentPage, document, frame]);
  const importedFontFamilies = [...new Set((document.importedFonts ?? []).map((font) => font.familyName))];
  const selectedFontIsPreset = PAPER_FONT_OPTIONS.some((option) => option.value === selectedFontFamily)
    || importedFontFamilies.includes(selectedFontFamily);
  const barcodeResolution = frame?.kind === 'barcode' ? resolvePaperBarcodeValue(frame.barcode?.value ?? '') : null;
  const barcodeGeometry = frame?.kind === 'barcode'
    ? buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm)
    : null;
  const barcodeSizeStatus = barcodeGeometry ? paperBarcodePhysicalSizeStatus(barcodeGeometry) : null;
  const barcodeCheckDigitFix = frame?.kind === 'barcode' && barcodeResolution?.status === 'invalid'
    && (barcodeResolution.reason === 'isbn10-check-digit' || barcodeResolution.reason === 'ean13-check-digit')
    && barcodeResolution.expectedCheckCharacter !== undefined
    ? (() => {
      const sanitized = sanitizePaperBarcodeInput(frame.barcode?.value ?? '');
      return barcodeResolution.reason === 'isbn10-check-digit'
        ? `${sanitized.slice(0, 9)}${barcodeResolution.expectedCheckCharacter}`
        : `${sanitized.slice(0, 12)}${barcodeResolution.expectedCheckCharacter}`;
    })()
    : undefined;
  const applyFrameTypography = (
    typography: PaperFrame['typography'],
    bundledAuthority?: BundledFontSelectionAuthority,
    installedFont?: PaperImportedFont,
  ) => {
    if (!frame) return false;
    const target = inspectorAuthority.current;
    const storeAuthority = capturePaperInspectorStoreAuthority();
    const operationAuthority: PaperRichEditorCommitAuthority | undefined = bundledAuthority && installedFont
      ? {
          isCurrent: () => {
            if (
              !bundledAuthority.isCurrent()
              || !isPaperInspectorStoreAuthorityCurrent(storeAuthority)
              || !target
              || inspectorAuthority.current !== target
              || inspectorGeneration.current !== target.generation
              || target.document !== document
              || target.page !== currentPage
              || target.frame !== frame
            ) return false;
            const state = usePaperStore.getState();
            const selectedPage = state.document.pages.find((candidate) => candidate.id === state.selectedPageId);
            const selectedFrame = selectedPage?.frames.find((candidate) => candidate.id === state.selectedFrameId);
            return state.document === target.document
              && state.selectedPageId === target.page.id
              && state.selectedFrameId === target.frame.id
              && selectedPage === target.page
              && selectedFrame === target.frame;
          },
        }
      : undefined;
    if (operationAuthority && !operationAuthority.isCurrent()) return false;
    const operationFonts = operationAuthority && installedFont
      ? replacePaperImportedFontFace(target?.document.importedFonts, installedFont)
      : undefined;
    const operationContext: PaperRichEditorCommitContext | undefined = operationAuthority
      ? { authority: operationAuthority, managedFonts: operationFonts }
      : undefined;
    const commit = (patch: PaperFramePatch) => {
      if (operationAuthority && installedFont) {
        if (!operationAuthority.isCurrent()) return false;
        return commitBundledFrameTypography({
          authority: storeAuthority,
          document: target!.document,
          page: target!.page,
          frame: target!.frame,
          patch,
          importedFont: installedFont,
        });
      }
      onUpdateFrame(patch);
      return true;
    };
    const resolved = resolvePaperRichEditorTypographyUpdate(
      frame.id,
      frame.typography,
      typography,
      frame.richText,
      operationContext,
    );
    if (!(resolved instanceof Promise)) {
      return commit(resolved);
    }
    return resolved.then(commit).catch((error) => {
      if (operationAuthority && !operationAuthority.isCurrent()) return false;
      return showAlertDialog({
        title: 'Exact Font Edit Blocked',
        message: error instanceof Error ? error.message : 'The requested exact face could not be authenticated, so the typography was not changed.',
        tone: 'danger',
      }).then(() => false);
    });
  };
  const outputIntent = PAPER_OUTPUT_INTENT_PROFILES[document.printProduction.outputIntentProfileId];
  const outputConditionId = document.printProduction.outputIntentProfileId === 'custom'
    ? document.printProduction.customOutputIntentName.trim()
    : outputIntent.printingCondition ?? '';
  const publicationReferences = document.publicationReferences ?? {
    version: 1 as const,
    tocEntries: [],
    indexMarkers: [],
    crossReferences: [],
  };
  const trackChanges = normalizePaperTrackChanges(document.trackChanges);

  return (
    <div className="flex min-h-full flex-col bg-[#101722]" data-paper-rich-inspector="true">
      <div className="border-b border-cyan-300/10 pb-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-100/50">{t('paper.insp.title')}</div>
        <div className="mt-1 truncate text-sm font-semibold text-white">{documentTitle}</div>
        <div className="mt-2 text-xs text-cyan-100/50">Page {selectedPageNumber} of {pageCount}</div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-3">
        <InspectorSection defaultOpen={false} title={t('paper.insp.document')}>
          <Field label={t('paper.insp.pageSize')}>
            <select
              className="paper-input"
              onChange={(event) => onUpdateDocumentSetup({ preset: event.target.value as PaperPagePreset })}
              value={document.page.preset}
            >
              {Object.entries(PAPER_PAGE_PRESETS).map(([preset, spec]) => (
                <option key={preset} value={preset}>
                  {pagePresetLabel(preset as PaperPagePreset)} ({spec.widthMm} x {spec.heightMm} mm)
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label={t('paper.insp.widthMm')}
              onChange={(widthMm) => onUpdateDocumentSetup({ preset: 'custom', widthMm })}
              value={document.page.widthMm}
            />
            <NumberField
              label={t('paper.insp.heightMm')}
              onChange={(heightMm) => onUpdateDocumentSetup({ preset: 'custom', heightMm })}
              value={document.page.heightMm}
            />
            <NumberField
              label={t('paper.insp.bleedMm')}
              onChange={(bleedMm) => onUpdateDocumentSetup({ bleedMm })}
              value={document.page.bleedMm}
            />
            <NumberField
              label="DPI"
              onChange={(dpi) => onUpdateDocumentSetup({ dpi })}
              step={1}
              value={document.page.dpi}
            />
          </div>
          <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] text-cyan-100/45">
            Export raster target: {paperPixelsFromMm(document.page.widthMm, document.page.dpi)} x {paperPixelsFromMm(document.page.heightMm, document.page.dpi)} px
          </div>
          <Field label="Document language (accessible PDF)">
            <select
              className="paper-input"
              onChange={(event) => onUpdateDocumentSetup({ accessibility: { language: event.target.value } })}
              value={document.accessibility.language}
            >
              {!['en', 'en-us', 'es', 'fr', 'de', 'ja', 'ja-jp', 'ko', 'zh-hans'].includes(document.accessibility.language) ? (
                <option value={document.accessibility.language}>Custom ({document.accessibility.language})</option>
              ) : null}
              <option value="en">English (en)</option>
              <option value="en-us">English, United States (en-US)</option>
              <option value="es">Spanish (es)</option>
              <option value="fr">French (fr)</option>
              <option value="de">German (de)</option>
              <option value="ja">Japanese (ja)</option>
              <option value="ja-jp">Japanese, Japan (ja-JP)</option>
              <option value="ko">Korean (ko)</option>
              <option value="zh-hans">Chinese, Simplified (zh-Hans)</option>
            </select>
          </Field>
          <div className="text-[11px] leading-4 text-cyan-100/45">Tagged PDF uses this publication language and requires authored alternative text for image and placed-document frames.</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('paper.insp.marginT')} onChange={(top) => onUpdateDocumentSetup({ marginsMm: { top } })} value={document.layout.marginsMm.top} />
            <NumberField label={t('paper.insp.marginR')} onChange={(right) => onUpdateDocumentSetup({ marginsMm: { right } })} value={document.layout.marginsMm.right} />
            <NumberField label={t('paper.insp.marginB')} onChange={(bottom) => onUpdateDocumentSetup({ marginsMm: { bottom } })} value={document.layout.marginsMm.bottom} />
            <NumberField label={t('paper.insp.marginL')} onChange={(left) => onUpdateDocumentSetup({ marginsMm: { left } })} value={document.layout.marginsMm.left} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label={t('paper.insp.columns')} onChange={(count) => onUpdateDocumentSetup({ columns: { count } })} step={1} value={document.layout.columns.count} />
            <NumberField label={t('paper.insp.gutter')} onChange={(gutterMm) => onUpdateDocumentSetup({ columns: { gutterMm } })} value={document.layout.columns.gutterMm} />
            <NumberField label={t('paper.insp.gridMm')} onChange={(sizeMm) => onUpdateDocumentSetup({ grid: { sizeMm } })} value={document.layout.grid.sizeMm} />
            <NumberField label={t('paper.insp.subdiv')} onChange={(subdivisions) => onUpdateDocumentSetup({ grid: { subdivisions } })} step={1} value={document.layout.grid.subdivisions} />
          </div>
          <label className="flex items-center gap-2 text-xs text-cyan-100/55">
            <input
              checked={document.layout.grid.enabled}
              onChange={(event) => onUpdateDocumentSetup({ grid: { enabled: event.target.checked } })}
              type="checkbox"
            />{t('paper.insp.gridEnabled')}</label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 text-xs text-cyan-100/55">
              <input
                checked={document.view.snapToGuides}
                onChange={() => onToggleViewOption('snapToGuides')}
                type="checkbox"
              />{t('paper.insp.snapGuides')}</label>
            <label className="flex items-center gap-2 text-xs text-cyan-100/55">
              <input
                checked={document.view.snapToGrid}
                onChange={() => onToggleViewOption('snapToGrid')}
                type="checkbox"
              />{t('paper.insp.snapGrid')}</label>
          </div>
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.baselineGrid')}</div>
              <label className="flex items-center gap-1 text-xs text-cyan-100/55">
                <input checked={document.view.showBaselineGrid} onChange={() => onToggleViewOption('showBaselineGrid')} type="checkbox" />{t('paper.insp.show')}</label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label={t('paper.insp.startMm')} onChange={(startMm) => onUpdateDocumentSetup({ baselineGrid: { startMm: Math.max(0, startMm) } })} step={0.5} value={document.layout.baselineGrid.startMm} />
              <NumberField label={t('paper.insp.stepMm')} onChange={(incrementMm) => onUpdateDocumentSetup({ baselineGrid: { incrementMm: Math.max(0.5, incrementMm) } })} step={0.1} value={document.layout.baselineGrid.incrementMm} />
            </div>
          </div>
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.documentBackground')}</div>
            <Field label={t('paper.insp.type')}>
              <select
                className="paper-input"
                onChange={(event) => onUpdateDocumentSetup({ background: { type: event.target.value as PaperDocument['background']['type'] } })}
                value={documentBackground.type}
              >
                <option value="solid">{t('paper.insp.solidColor')}</option>
                <option value="linear-gradient">{t('paper.insp.linearGradient')}</option>
                <option value="radial-gradient">{t('paper.insp.radialGradient')}</option>
              </select>
            </Field>
            {documentBackground.type === 'solid' ? (
              <Field label={t('paper.insp.color')}>
                <AdvancedColorPicker
                  className="h-8 w-full"
                  buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                  label={t('paper.insp.docBgColor')}
                  onChange={(color) => onUpdateDocumentSetup({ background: { color } })}
                  value={cssColorToPickerValue(documentBackground.color)}
                />
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('paper.insp.from')}>
                    <AdvancedColorPicker
                      className="h-8 w-full"
                      buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                      label={t('paper.insp.docGradFrom')}
                      onChange={(color) => onUpdateDocumentSetup({ background: { fromColor: color } })}
                      value={cssColorToPickerValue(documentBackground.fromColor)}
                    />
                  </Field>
                  <Field label={t('paper.insp.to')}>
                    <AdvancedColorPicker
                      className="h-8 w-full"
                      buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                      label={t('paper.insp.docGradTo')}
                      onChange={(color) => onUpdateDocumentSetup({ background: { toColor: color } })}
                      value={cssColorToPickerValue(documentBackground.toColor)}
                    />
                  </Field>
                </div>
                {documentBackground.type === 'linear-gradient' ? (
                  <NumberField
                    label={t('paper.insp.angle')}
                    onChange={(angleDeg) => onUpdateDocumentSetup({ background: { angleDeg } })}
                    step={1}
                    value={documentBackground.angleDeg}
                  />
                ) : (
                  <Field label={t('paper.insp.radialShape')}>
                    <select
                      className="paper-input"
                      onChange={(event) => onUpdateDocumentSetup({ background: { radialShape: event.target.value as PaperDocument['background']['radialShape'] } })}
                      value={documentBackground.radialShape}
                    >
                      <option value="ellipse">{t('paper.insp.ellipse')}</option>
                      <option value="circle">{t('paper.insp.circle')}</option>
                    </select>
                  </Field>
                )}
              </>
            )}
            <div
              className="mt-2 h-8 rounded border border-cyan-300/15"
              style={{ background: paperDocumentBackgroundCss(documentBackground) }}
            />
          </div>
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.printProduction')}</div>
            <Field label={t('paper.insp.pdfTarget')}>
              <select
                className="paper-input"
                onChange={(event) => onUpdateDocumentSetup({ printProduction: { pdfStandard: event.target.value as PaperDocument['printProduction']['pdfStandard'] } })}
                value={document.printProduction.pdfStandard}
              >
                <option value="browser-pdf">{t('paper.insp.browserPdfProof')}</option>
                <option value="pdf-x-4">{t('paper.insp.pdfx4')}</option>
                <option value="pdf-x-1a">{t('paper.insp.pdfx1a')}</option>
              </select>
            </Field>
            <Field label={t('paper.insp.outputIntent')}>
              <select
                className="paper-input"
                onChange={(event) => onUpdateDocumentSetup({
                  printProduction: {
                    outputIntentProfileId: event.target.value as PaperDocument['printProduction']['outputIntentProfileId'],
                    // An ICC belongs to one output condition. Force an explicit re-selection after changing it.
                    outputIntentProfileAssetId: undefined,
                  },
                })}
                value={document.printProduction.outputIntentProfileId}
              >
                {Object.values(PAPER_OUTPUT_INTENT_PROFILES).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.label} ({profile.colorSpace.toUpperCase()})
                  </option>
                ))}
              </select>
            </Field>
            {document.printProduction.outputIntentProfileId === 'custom' ? (
              <Field label={t('paper.insp.customIntentName')}>
                <input
                  className="paper-input"
                  onChange={(event) => onUpdateDocumentSetup({
                    printProduction: {
                      customOutputIntentName: event.target.value,
                      outputIntentProfileAssetId: undefined,
                    },
                  })}
                  value={document.printProduction.customOutputIntentName}
                />
              </Field>
            ) : null}
            {isPdfXProductionTarget(document.printProduction) && outputIntent.colorSpace === 'cmyk' ? (
              <PaperIccProfileManager
                outputConditionId={outputConditionId}
                profiles={document.managedIccProfiles}
                registryName={outputIntent.registryName}
                selectedProfileAssetId={document.printProduction.outputIntentProfileAssetId}
                onChange={({ profiles, selectedProfileAssetId, outputConditionId: exactCondition }) => {
                  const selected = profiles.find((profile) => profile.id === selectedProfileAssetId);
                  const selectedCondition = (exactCondition ?? selected?.outputConditionId ?? '').trim();
                  onUpdateDocumentSetup({
                    managedIccProfiles: profiles,
                    printProduction: {
                      outputIntentProfileAssetId: selectedProfileAssetId,
                      ...(selectedCondition && selectedCondition !== outputConditionId ? {
                        outputIntentProfileId: 'custom',
                        customOutputIntentName: selectedCondition,
                      } : {}),
                    },
                  });
                }}
              />
            ) : null}
            <NumberField
              label={t('paper.insp.inkLimit')}
              onChange={(totalInkLimitPercent) => onUpdateDocumentSetup({ printProduction: { totalInkLimitPercent } })}
              step={1}
              value={document.printProduction.totalInkLimitPercent}
            />
            <Field label={t('paper.insp.blackHandling')}>
              <select
                className="paper-input"
                onChange={(event) => onUpdateDocumentSetup({ printProduction: { blackPolicy: event.target.value as PaperDocument['printProduction']['blackPolicy'] } })}
                value={document.printProduction.blackPolicy}
              >
                <option value="warn-rich-black">{t('paper.insp.warnRichBlack')}</option>
                <option value="force-100k-text">{t('paper.insp.force100kText')}</option>
                <option value="allow-rich-black">{t('paper.insp.allowRichBlack')}</option>
              </select>
            </Field>
            <Field label={t('paper.insp.spotColors')}>
              <select
                className="paper-input"
                onChange={(event) => onUpdateDocumentSetup({ printProduction: { spotColorPolicy: event.target.value as PaperDocument['printProduction']['spotColorPolicy'] } })}
                value={document.printProduction.spotColorPolicy}
              >
                <option value="warn">{t('paper.insp.warnIfPresent')}</option>
                <option value="convert-process">{t('paper.insp.convertProcess')}</option>
                <option value="preserve-named">{t('paper.insp.preserveSpots')}</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-xs text-cyan-100/55">
              <input
                checked={document.printProduction.overprintPreview}
                onChange={(event) => onUpdateDocumentSetup({ printProduction: { overprintPreview: event.target.checked } })}
                type="checkbox"
              />{t('paper.insp.overprintPreview')}</label>
            <PaperPrintMarksControls
              jobInfo={document.printProduction.jobInfo}
              marks={document.printProduction.marks}
              onChange={(marks) => onUpdateDocumentSetup({ printProduction: { marks } })}
              onJobInfoChange={(jobInfo) => onUpdateDocumentSetup({ printProduction: { jobInfo } })}
            />
          </div>
          <button
            className="w-full rounded-md border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-left text-xs font-semibold text-rose-100 hover:border-rose-300/50"
            disabled={pageCount <= 1}
            onClick={onDeletePage}
            type="button"
          >{t('paper.insp.deleteCurrentPage')}</button>
        </InspectorSection>

        <InspectorSection defaultOpen title="Publication references">
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/55">
            Add document-local TOC entries, index markers, and cross-reference targets. Tokens resolve in canvas and print output; missing targets remain visible.
          </div>
          <div className="space-y-2 rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">
              <span>Table of contents</span>
              <button data-testid="publication-add-toc" className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-cyan-100/70" type="button" onClick={() => onUpdatePublicationReferences({ ...publicationReferences, tocEntries: [...publicationReferences.tocEntries, { id: `toc-${Date.now().toString(36)}`, label: 'New entry', targetPageId: currentPage.id }] })}>+ Add</button>
            </div>
            {publicationReferences.tocEntries.map((entry) => (
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1" key={entry.id}>
                <input aria-label={`TOC label ${entry.id}`} className="paper-input min-w-0 px-1.5 py-1 text-[11px]" value={entry.label} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, tocEntries: publicationReferences.tocEntries.map((candidate) => candidate.id === entry.id ? { ...candidate, label: event.target.value } : candidate) })} />
                <select aria-label={`TOC page ${entry.id}`} className="paper-input px-1 text-[11px]" value={entry.targetPageId} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, tocEntries: publicationReferences.tocEntries.map((candidate) => candidate.id === entry.id ? { ...candidate, targetPageId: event.target.value } : candidate) })}>{document.pages.map((page) => <option key={page.id} value={page.id}>p.{page.pageNumber}</option>)}</select>
                <button aria-label={`Insert page token ${entry.id}`} className="rounded border border-cyan-300/20 px-1 text-[10px]" type="button" disabled={!frame} onClick={() => { const token = createPaperPageReferenceToken(entry.id); if (token && frame) onUpdateFrame({ text: `${frame.text ?? ''}${frame.text ? ' ' : ''}${token}` }); }}>Token</button>
              </div>
            ))}
          </div>
          <div className="space-y-2 rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">
              <span>Index markers</span>
              <button data-testid="publication-add-index" className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-cyan-100/70" type="button" onClick={() => onUpdatePublicationReferences({ ...publicationReferences, indexMarkers: [...publicationReferences.indexMarkers, { id: `index-${Date.now().toString(36)}`, term: 'New term', targetPageId: currentPage.id }] })}>+ Add</button>
            </div>
            {publicationReferences.indexMarkers.map((entry) => <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-1" key={entry.id}><input aria-label={`Index term ${entry.id}`} className="paper-input px-1.5 py-1 text-[11px]" value={entry.term} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, indexMarkers: publicationReferences.indexMarkers.map((candidate) => candidate.id === entry.id ? { ...candidate, term: event.target.value } : candidate) })} /><select aria-label={`Index page ${entry.id}`} className="paper-input px-1 text-[11px]" value={entry.targetPageId} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, indexMarkers: publicationReferences.indexMarkers.map((candidate) => candidate.id === entry.id ? { ...candidate, targetPageId: event.target.value } : candidate) })}>{document.pages.map((page) => <option key={page.id} value={page.id}>p.{page.pageNumber}</option>)}</select></div>)}
          </div>
          <div className="space-y-2 rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40"><span>Cross-references</span><button data-testid="publication-add-reference" className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-cyan-100/70" type="button" onClick={() => onUpdatePublicationReferences({ ...publicationReferences, crossReferences: [...publicationReferences.crossReferences, { id: `ref-${Date.now().toString(36)}`, label: 'New reference', targetPageId: currentPage.id }] })}>+ Add</button></div>
            {publicationReferences.crossReferences.map((entry) => <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-1" key={entry.id}><input aria-label={`Reference label ${entry.id}`} className="paper-input px-1.5 py-1 text-[11px]" value={entry.label} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, crossReferences: publicationReferences.crossReferences.map((candidate) => candidate.id === entry.id ? { ...candidate, label: event.target.value } : candidate) })} /><select aria-label={`Reference page ${entry.id}`} className="paper-input px-1 text-[11px]" value={entry.targetPageId} onChange={(event) => onUpdatePublicationReferences({ ...publicationReferences, crossReferences: publicationReferences.crossReferences.map((candidate) => candidate.id === entry.id ? { ...candidate, targetPageId: event.target.value } : candidate) })}>{document.pages.map((page) => <option key={page.id} value={page.id}>p.{page.pageNumber}</option>)}</select><button aria-label={`Insert reference token ${entry.id}`} className="rounded border border-cyan-300/20 px-1 text-[10px]" type="button" disabled={!frame} onClick={() => { const token = createPaperCrossReferenceToken(entry.id); if (token && frame) onUpdateFrame({ text: `${frame.text ?? ''}${frame.text ? ' ' : ''}${token}` }); }}>Token</button></div>)}
          </div>
        </InspectorSection>

        <InspectorSection defaultOpen={false} title="Track changes & redlining">
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/55">Document-local revisions are recorded with author and time. Canvas and print use the current text; redline controls never leak into derived output.</div>
          {frame?.kind === 'text' ? <>
            <Field label="Author"><input aria-label="Track change author" className="paper-input" maxLength={96} onChange={(event) => setTrackAuthor(event.target.value)} value={trackAuthor} /></Field>
            <Field label="Proposed text"><textarea aria-label="Track change proposed text" className="paper-input min-h-16" maxLength={100000} onChange={(event) => setTrackText(event.target.value)} value={trackText} /></Field>
            <button className="w-full rounded border border-cyan-300/20 px-2 py-1 text-xs" type="button" disabled={!trackText.trim()} onClick={() => { const now = Date.now(); onUpdatePaperTrackChanges?.([...trackChanges, { id: `change-${now.toString(36)}`, pageId: currentPage.id, frameId: frame.id, kind: trackText.length >= (frame.text ?? '').length ? 'insert' : 'delete', beforeText: frame.text ?? '', afterText: trackText, author: trackAuthor.trim() || 'Anonymous', createdAt: now, status: 'pending' }]); setTrackText(''); }}>Record revision</button>
          </> : <div className="text-xs text-cyan-100/45">Select a text frame to record a revision.</div>}
          {trackChanges.length ? <div className="space-y-1">{trackChanges.map((change) => <div className="rounded border border-cyan-300/10 p-1.5 text-[11px]" key={change.id}><div className="flex justify-between"><span>{change.kind} · {change.author}</span><span>{change.status}</span></div><div className="truncate text-cyan-100/45">{change.afterText}</div>{change.status === 'pending' ? <div className="mt-1 flex gap-1"><button className="rounded border border-emerald-300/20 px-1.5" type="button" onClick={() => onDecidePaperTrackChange?.(change.id, 'accept')}>Accept</button><button className="rounded border border-rose-300/20 px-1.5" type="button" onClick={() => onDecidePaperTrackChange?.(change.id, 'reject')}>Reject</button></div> : null}</div>)}</div> : null}
        </InspectorSection>

        <InspectorSection defaultOpen={false} title="Text variables & conditional text">
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/55">
            Derived output only: use <span className="text-cyan-100/80">{'{{var:edition}}'}</span> for a value and{' '}
            <span className="text-cyan-100/80">{'{{if:print}}Press{{else}}Screen{{/if}}'}</span> for a named condition. Source text is never rewritten; unknown or malformed markers stay visible.
          </div>
          <div className="mt-2 rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">Variables</div>
              <button
                className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100/70 hover:border-cyan-300/50 hover:text-white disabled:opacity-40"
                disabled={(document.textVariables?.length ?? 0) >= 64}
                onClick={() => {
                  const entries = document.textVariables ?? [];
                  const names = new Set(entries.map((entry) => entry.name));
                  let number = 1;
                  while (names.has(`variable${number}`)) number += 1;
                  onUpdateDocumentSetup({
                    textVariables: [...entries, {
                      id: `text-variable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                      name: `variable${number}`,
                      value: '',
                    }],
                  });
                }}
                type="button"
              >+ Variable</button>
            </div>
            {(document.textVariables ?? []).length ? (
              <div className="space-y-2">
                {(document.textVariables ?? []).map((entry) => (
                  <div className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] gap-1" key={entry.id}>
                    <input
                      aria-label={`Variable key ${entry.name}`}
                      className="paper-input min-w-0 px-1.5 py-1 text-[11px]"
                      maxLength={48}
                      onChange={(event) => onUpdateDocumentSetup({
                        textVariables: (document.textVariables ?? []).map((candidate) => candidate.id === entry.id
                          ? { ...candidate, name: event.target.value }
                          : candidate),
                      })}
                      title="Lowercase token key"
                      value={entry.name}
                    />
                    <input
                      aria-label={`Variable value for ${entry.name}`}
                      className="paper-input min-w-0 px-1.5 py-1 text-[11px]"
                      maxLength={4096}
                      onChange={(event) => onUpdateDocumentSetup({
                        textVariables: (document.textVariables ?? []).map((candidate) => candidate.id === entry.id
                          ? { ...candidate, value: event.target.value }
                          : candidate),
                      })}
                      placeholder="Value"
                      value={entry.value}
                    />
                    <button
                      aria-label={`Remove variable ${entry.name}`}
                      className="rounded border border-rose-300/20 px-1.5 text-[11px] text-rose-100/70 hover:border-rose-300/50 hover:text-white"
                      onClick={() => onUpdateDocumentSetup({ textVariables: (document.textVariables ?? []).filter((candidate) => candidate.id !== entry.id) })}
                      title="Remove variable"
                      type="button"
                    >×</button>
                  </div>
                ))}
              </div>
            ) : <div className="text-[11px] text-cyan-100/35">No variables yet.</div>}
          </div>
          <div className="mt-2 rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">Conditions</div>
              <button
                className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100/70 hover:border-cyan-300/50 hover:text-white disabled:opacity-40"
                disabled={(document.textConditions?.length ?? 0) >= 64}
                onClick={() => {
                  const entries = document.textConditions ?? [];
                  const names = new Set(entries.map((entry) => entry.name));
                  let number = 1;
                  while (names.has(`condition${number}`)) number += 1;
                  onUpdateDocumentSetup({
                    textConditions: [...entries, {
                      id: `text-condition-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                      name: `condition${number}`,
                      enabled: false,
                    }],
                  });
                }}
                type="button"
              >+ Condition</button>
            </div>
            {(document.textConditions ?? []).length ? (
              <div className="space-y-2">
                {(document.textConditions ?? []).map((entry) => (
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1" key={entry.id}>
                    <input
                      aria-label={`Condition key ${entry.name}`}
                      className="paper-input min-w-0 px-1.5 py-1 text-[11px]"
                      maxLength={48}
                      onChange={(event) => onUpdateDocumentSetup({
                        textConditions: (document.textConditions ?? []).map((candidate) => candidate.id === entry.id
                          ? { ...candidate, name: event.target.value }
                          : candidate),
                      })}
                      title="Lowercase token key"
                      value={entry.name}
                    />
                    <label className="flex items-center gap-1 whitespace-nowrap text-[11px] text-cyan-100/65">
                      <input
                        checked={entry.enabled}
                        onChange={(event) => onUpdateDocumentSetup({
                          textConditions: (document.textConditions ?? []).map((candidate) => candidate.id === entry.id
                            ? { ...candidate, enabled: event.target.checked }
                            : candidate),
                        })}
                        type="checkbox"
                      />On</label>
                    <button
                      aria-label={`Remove condition ${entry.name}`}
                      className="rounded border border-rose-300/20 px-1.5 py-1 text-[11px] text-rose-100/70 hover:border-rose-300/50 hover:text-white"
                      onClick={() => onUpdateDocumentSetup({ textConditions: (document.textConditions ?? []).filter((candidate) => candidate.id !== entry.id) })}
                      title="Remove condition"
                      type="button"
                    >×</button>
                  </div>
                ))}
              </div>
            ) : <div className="text-[11px] text-cyan-100/35">No conditions yet.</div>}
          </div>
        </InspectorSection>

        <InspectorSection defaultOpen={false} title="Data merge">
          <PaperDataMergeSection document={document} onExportDerivedPdf={onExportDerivedPdf} />
        </InspectorSection>

        <InspectorSection defaultOpen={false} title="Footnotes & endnotes">
          <PaperAuthoredNotesSection document={document} page={currentPage} selectedFrameId={frame?.id} />
        </InspectorSection>

        <InspectorSection defaultOpen={false} title="Anchored objects">
          <PaperAnchoredObjectsSection document={document} page={currentPage} selectedFrameId={frame?.id} />
        </InspectorSection>

        <InspectorSection defaultOpen={false} title={t('paper.insp.parentPages')}>
          <Field label={t('paper.insp.currentPageParent')}>
            <select
              className="paper-input"
              onChange={(event) => onAssignParentPage(event.target.value)}
              value={currentPage?.parentPageId ?? ''}
            >
              <option value="">{t('paper.insp.none')}</option>
              {document.parentPages.map((parent) => <option key={parent.id} value={parent.id}>{parent.name}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40" onClick={onAddParentPage} type="button">{t('paper.insp.newParent')}</button>
            <button
              className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 disabled:opacity-40"
              disabled={!frame || !currentPage?.parentPageId}
              onClick={() => currentPage?.parentPageId && onAddSelectedFrameToParent(currentPage.parentPageId)}
              type="button"
            >{t('paper.insp.addFrameToParent')}</button>
          </div>
          <div className="text-[11px] leading-4 text-cyan-100/45">{t('paper.insp.inheritedParentInfo')}</div>
        </InspectorSection>

        {frame ? (
          <>
            {frame.comicSfxDesign ? (
              <InspectorSection title={t('paper.insp.comicSfxDecal')}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-cyan-50">{frame.comicSfxDesign.text}</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/40">{frame.comicSfxDesign.presetId}</div>
                  </div>
                  <button
                    className="rounded-md border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 hover:border-amber-300/50 hover:text-white"
                    onClick={onEditComicSfxFrame}
                    type="button"
                  >{t('paper.insp.edit')}</button>
                </div>
              </InspectorSection>
            ) : null}
            {frame.kind === 'image' && frame.generatedMediaPrompt ? (
              <InspectorSection title={t('paper.insp.generatedMedia')}>
                <div className="rounded-md border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/60">
                  {frame.generatedMediaPrompt}
                </div>
                <button
                  className="w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-left text-xs font-semibold text-cyan-50 hover:border-cyan-300/45 hover:bg-cyan-400/15"
                  onClick={onSendGeneratedMediaToFlow}
                  type="button"
                >
                  {t('paper.insp.createFlowMediaNode')}
                </button>
                <div className="text-[10px] leading-4 text-cyan-100/40">{t('paper.insp.generatedMediaHelp')}</div>
              </InspectorSection>
            ) : null}
            <InspectorSection defaultOpen={false} title={t('paper.insp.styles')}>
              {frame.kind !== 'image' && frame.kind !== 'panel' ? (
                <>
                  <Field label={t('paper.insp.paragraphStyle')}>
                    <select className="paper-input" onChange={(event) => onUpdateFrame({ paragraphStyleId: event.target.value || undefined })} value={frame.paragraphStyleId ?? ''}>
                      <option value="">{t('paper.insp.none')}</option>
                      {document.styles.paragraph.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('paper.insp.characterStyle')}>
                    <select className="paper-input" onChange={(event) => onUpdateFrame({ characterStyleId: event.target.value || undefined })} value={frame.characterStyleId ?? ''}>
                      <option value="">{t('paper.insp.none')}</option>
                      {document.styles.character.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                    </select>
                  </Field>
                </>
              ) : null}
              <Field label={t('paper.insp.objectStyle')}>
                <select className="paper-input" onChange={(event) => onUpdateFrame({ objectStyleId: event.target.value || undefined })} value={frame.objectStyleId ?? ''}>
                  <option value="">{t('paper.insp.none')}</option>
                  {document.styles.object.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70" onClick={onCopyStyle} type="button">{t('paper.insp.copyStyle')}</button>
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70 disabled:opacity-40" disabled={!canPasteStyle} onClick={onPasteStyle} type="button">{t('paper.insp.pasteStyle')}</button>
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70" disabled={!frame.paragraphStyleId} onClick={() => onRedefineStyle('paragraph')} type="button">{t('paper.insp.redefinePara')}</button>
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70" disabled={!frame.objectStyleId} onClick={() => onRedefineStyle('object')} type="button">{t('paper.insp.redefineObj')}</button>
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70" onClick={onClearStyleLinks} type="button">{t('paper.insp.clearLinks')}</button>
                <button className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70" onClick={onClearStyleOverrides} type="button">{t('paper.insp.clearOverrides')}</button>
              </div>
            </InspectorSection>
            {['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind) ? (
              <InspectorSection defaultOpen={false} title={t('paper.insp.grepStyles')}>
                {frame.richText?.length ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.grepRules')}</div>
                    {(document.styles.grepStyleRules ?? []).map((rule, index) => {
                      const validation = validatePaperGrepPattern(rule.pattern);
                      return (
                        <div className="rounded border border-cyan-300/15 bg-[#101a29]/70 p-2" data-paper-grep-rule="true" key={rule.id}>
                          <div className="mb-1 flex items-center gap-2">
                            <input
                              checked={rule.enabled}
                              onChange={(event) => onUpdateStyleAutomation({
                                grepStyleRules: (document.styles.grepStyleRules ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, enabled: event.target.checked } : candidate),
                              })}
                              type="checkbox"
                            />
                            <input
                              className="paper-input flex-1"
                              onChange={(event) => onUpdateStyleAutomation({
                                grepStyleRules: (document.styles.grepStyleRules ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, name: event.target.value } : candidate),
                              })}
                              value={rule.name}
                            />
                            <button
                              className="rounded border border-red-300/25 px-2 py-0.5 text-[10px] text-red-200/80"
                              onClick={() => onUpdateStyleAutomation({ grepStyleRules: (document.styles.grepStyleRules ?? []).filter((_, candidateIndex) => candidateIndex !== index) })}
                              type="button"
                            >✕</button>
                          </div>
                          <input
                            className={`paper-input mb-1 ${validation.ok ? '' : 'border-red-400/50'}`}
                            data-paper-grep-pattern="true"
                            onChange={(event) => onUpdateStyleAutomation({
                              grepStyleRules: (document.styles.grepStyleRules ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, pattern: event.target.value } : candidate),
                            })}
                            placeholder="\d+"
                            value={rule.pattern}
                          />
                          <select
                            className="paper-input"
                            onChange={(event) => onUpdateStyleAutomation({
                              grepStyleRules: (document.styles.grepStyleRules ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, characterStyleId: event.target.value } : candidate),
                            })}
                            value={rule.characterStyleId}
                          >
                            {document.styles.character.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                          </select>
                          <label className="mt-1 flex items-center gap-2 text-[10px] text-cyan-100/50">
                            <input
                              checked={rule.caseInsensitive === true}
                              onChange={(event) => onUpdateStyleAutomation({
                                grepStyleRules: (document.styles.grepStyleRules ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, caseInsensitive: event.target.checked } : candidate),
                              })}
                              type="checkbox"
                            />{t('paper.insp.grepIgnoreCase')}</label>
                          {!validation.ok ? <div className="mt-1 text-[10px] text-red-300">{t('paper.insp.grepInvalidPattern')}</div> : null}
                        </div>
                      );
                    })}
                    <button
                      className="w-full rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70"
                      data-paper-grep-add-rule="true"
                      disabled={(document.styles.grepStyleRules ?? []).length >= PAPER_GREP_STYLE_LIMITS.maxRuleCount}
                      onClick={() => onUpdateStyleAutomation({
                        grepStyleRules: [...(document.styles.grepStyleRules ?? []), {
                          id: newGrepRuleId('rule'),
                          name: t('paper.insp.grepNewRule'),
                          enabled: true,
                          pattern: '',
                          characterStyleId: document.styles.character[0]?.id ?? '',
                        }],
                      })}
                      type="button"
                    >+ {t('paper.insp.grepAddRule')}</button>
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.nestedStyles')}</div>
                    {(document.styles.nestedStyleSteps ?? []).map((step, index) => (
                      <div className="rounded border border-cyan-300/15 bg-[#101a29]/70 p-2" data-paper-nested-step="true" key={step.id}>
                        <div className="mb-1 flex items-center gap-2">
                          <input
                            checked={step.enabled}
                            onChange={(event) => onUpdateStyleAutomation({
                              nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, enabled: event.target.checked } : candidate),
                            })}
                            type="checkbox"
                          />
                          <select
                            className="paper-input flex-1"
                            onChange={(event) => onUpdateStyleAutomation({
                              nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, characterStyleId: event.target.value } : candidate),
                            })}
                            value={step.characterStyleId}
                          >
                            {document.styles.character.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}
                          </select>
                          <button
                            className="rounded border border-red-300/25 px-2 py-0.5 text-[10px] text-red-200/80"
                            onClick={() => onUpdateStyleAutomation({ nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).filter((_, candidateIndex) => candidateIndex !== index) })}
                            type="button"
                          >✕</button>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            className={`paper-input ${step.delimiterPattern !== '' && !validatePaperGrepPattern(step.delimiterPattern).ok ? 'border-red-400/50' : ''}`}
                            data-paper-nested-delimiter="true"
                            onChange={(event) => onUpdateStyleAutomation({
                              nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, delimiterPattern: event.target.value } : candidate),
                            })}
                            placeholder={t('paper.insp.nestedDelimiter')}
                            value={step.delimiterPattern}
                          />
                          <input
                            className="paper-input w-12"
                            max={PAPER_GREP_STYLE_LIMITS.maxRepeat}
                            min={1}
                            onChange={(event) => onUpdateStyleAutomation({
                              nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, repeat: Number(event.target.value) } : candidate),
                            })}
                            type="number"
                            value={step.repeat}
                          />
                          <label className="flex items-center gap-1 text-[10px] text-cyan-100/50">
                            <input
                              checked={step.inclusive}
                              onChange={(event) => onUpdateStyleAutomation({
                                nestedStyleSteps: (document.styles.nestedStyleSteps ?? []).map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, inclusive: event.target.checked } : candidate),
                              })}
                              type="checkbox"
                            />{t('paper.insp.nestedInclusive')}</label>
                        </div>
                        {step.delimiterPattern !== '' && !validatePaperGrepPattern(step.delimiterPattern).ok ? (
                          <div className="mt-1 text-[10px] text-red-300" data-paper-nested-invalid="true">{t('paper.insp.grepInvalidPattern')}</div>
                        ) : null}
                      </div>
                    ))}
                    <button
                      className="w-full rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70"
                      data-paper-grep-add-step="true"
                      disabled={(document.styles.nestedStyleSteps ?? []).length >= PAPER_GREP_STYLE_LIMITS.maxNestedStepCount}
                      onClick={() => onUpdateStyleAutomation({
                        nestedStyleSteps: [...(document.styles.nestedStyleSteps ?? []), {
                          id: newGrepRuleId('step'),
                          enabled: true,
                          characterStyleId: document.styles.character[0]?.id ?? '',
                          delimiterPattern: '\\s',
                          repeat: 1,
                          inclusive: true,
                        }],
                      })}
                      type="button"
                    >+ {t('paper.insp.nestedAddStep')}</button>
                    {(() => {
                      const application = applyPaperGrepStylesToRichText(frame.richText, document.styles);
                      const totalSpans = application.styledSpanCounts.reduce((total, entry) => total + entry.spans, 0);
                      return (
                        <div className="mt-2">
                          <div className="text-[10px] leading-4 text-cyan-100/40" data-paper-grep-preview="true">
                            {t('paper.insp.grepPreview')}: {totalSpans}
                            {application.skippedRules.length > 0 ? ` — ${t('paper.insp.grepSkipped')}: ${application.skippedRules.map((entry) => entry.name).join(', ')}` : ''}
                          </div>
                          <button
                            className="mt-1 w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                            data-paper-grep-apply="true"
                            disabled={totalSpans === 0}
                            onClick={() => onUpdateFrame({ richText: application.paragraphs })}
                            type="button"
                          >{t('paper.insp.grepApply')}</button>
                          <div className="text-[10px] leading-4 text-cyan-100/40">{t('paper.insp.grepHelp')}</div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <div className="text-[10px] leading-4 text-cyan-100/40">{t('paper.insp.grepNoRichText')}</div>
                )}
              </InspectorSection>
            ) : null}
            <InspectorSection title={t('paper.insp.frame')}>
              <Field label={t('paper.insp.label')}>
                <input className="paper-input" onChange={(e) => onUpdateFrame({ label: e.target.value })} value={frame.label} />
              </Field>
              {(frame.kind === 'image' || frame.kind === 'document') ? (
                <>
                  <Field label="Alternative text (accessible PDF)">
                    <textarea
                      className="paper-input min-h-16 resize-y"
                      maxLength={1000}
                      onChange={(event) => onUpdateFrame({ altText: event.target.value })}
                      placeholder="Describe the information this visual conveys."
                      value={frame.altText ?? ''}
                    />
                  </Field>
                  <div className="text-[11px] leading-4 text-cyan-100/45">Required for this visual frame when exporting an accessible tagged PDF. The frame label is not used as alternative text.</div>
                </>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="X" onChange={(xMm) => onUpdateFrame({ xMm })} value={frame.xMm} />
                <NumberField label="Y" onChange={(yMm) => onUpdateFrame({ yMm })} value={frame.yMm} />
                <NumberField label="W" onChange={(widthMm) => onUpdateFrame({ widthMm })} value={frame.widthMm} />
                <NumberField label="H" onChange={(heightMm) => onUpdateFrame({ heightMm })} value={frame.heightMm} />
              </div>
                <NumberField label={t('paper.insp.rotation')} onChange={(rotationDeg) => onUpdateFrame({ rotationDeg })} value={frame.rotationDeg} />
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t('paper.insp.stroke')} onChange={(strokeWidthMm) => onUpdateFrame({ strokeWidthMm })} value={frame.strokeWidthMm} />
                <NumberField label={t('paper.insp.radius')} onChange={(cornerRadiusMm) => onUpdateFrame({ cornerRadiusMm })} value={frame.cornerRadiusMm} />
              </div>
              <Field label={t('paper.insp.borderStyle')}>
                <select
                  className="paper-input"
                  onChange={(event) => onUpdateFrame({ strokeStyle: event.target.value as PaperFrame['strokeStyle'] })}
                  value={frame.strokeStyle}
                >
                  <option value="solid">{t('paper.insp.solid')}</option>
                  <option value="dashed">{t('paper.insp.dashed')}</option>
                  <option value="dotted">{t('paper.insp.dotted')}</option>
                  <option value="double">{t('paper.insp.double')}</option>
                  <option value="groove">{t('paper.insp.groove')}</option>
                  <option value="ridge">{t('paper.insp.ridge')}</option>
                </select>
              </Field>
              <Field label={t('paper.insp.frameShape')}>
                <select
                  className="paper-input"
                  onChange={(event) => onUpdateFrame({
                    shapeKind: event.target.value === 'none' ? undefined : event.target.value as PaperFrame['shapeKind'],
                    vertices: event.target.value === 'none'
                      ? undefined
                      : verticesForShapeKind(event.target.value as PaperFrame['shapeKind']),
                  })}
                  value={frame.shapeKind ?? 'none'}
                >
                  <option value="none">{t('paper.insp.rectangle')}</option>
                  <option value="ellipse">{t('paper.insp.ellipseCircle')}</option>
                  <option value="triangle">{t('paper.insp.triangle')}</option>
                  <option value="pentagon">{t('paper.insp.pentagon')}</option>
                  <option value="hexagon">{t('paper.insp.hexagon')}</option>
                </select>
              </Field>
              <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.textWrap')}</div>
                <Field label={t('paper.insp.wrapSurrounding')}>
                  <select
                    className="paper-input"
                    onChange={(event) => {
                      const mode = event.target.value as PaperTextWrapMode;
                      onUpdateFrame({
                        textWrap: mode === 'none'
                          ? undefined
                          : { mode, standoffMm: frame.textWrap?.standoffMm ?? 2, contourSource: frame.textWrap?.contourSource },
                      });
                    }}
                    value={frame.textWrap?.mode ?? 'none'}
                  >
                    <option value="none">{t('paper.insp.none')}</option>
                    <option value="boundingBox">{t('paper.insp.boundingBox')}</option>
                    <option value="jumpObject">{t('paper.insp.jumpObject')}</option>
                    <option value="contour">{t('paper.insp.contourShape')}</option>
                  </select>
                </Field>
                {frame.textWrap && frame.textWrap.mode !== 'none' ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <NumberField
                      label={t('paper.insp.standoffMm')}
                      onChange={(standoffMm) => onUpdateFrame({ textWrap: { ...frame.textWrap!, standoffMm: Math.max(0, standoffMm) } })}
                      step={0.5}
                      value={frame.textWrap.standoffMm}
                    />
                    {frame.textWrap.mode === 'contour' ? (
                      <Field label={t('paper.insp.contourFrom')}>
                        <select
                          className="paper-input"
                          onChange={(event) => onUpdateFrame({ textWrap: { ...frame.textWrap!, contourSource: event.target.value as 'frameShape' | 'vertices' } })}
                          value={frame.textWrap.contourSource ?? 'frameShape'}
                        >
                          <option value="frameShape">{t('paper.insp.frameShapeWrap')}</option>
                          <option value="vertices">{t('paper.insp.verticesOnly')}</option>
                        </select>
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.table')}</div>
                  {frame.table ? (
                    <button className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100/60 hover:border-cyan-300/50 hover:text-white" onClick={() => onUpdateFrame({ table: undefined })} type="button">{t('paper.insp.remove')}</button>
                  ) : (
                    <button className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100/60 hover:border-cyan-300/50 hover:text-white" onClick={() => onUpdateFrame({ table: createPaperTable(3, 3) })} type="button">{t('paper.insp.addTable')}</button>
                  )}
                </div>
                {frame.table ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-cyan-100/55">
                      <div className="flex items-center justify-between gap-1">
                        <span>{t('paper.insp.rows')}</span>
                        <span className="flex items-center gap-1">
                          <button className="rounded border border-cyan-300/20 px-1.5" onClick={() => onUpdateFrame({ table: removePaperTableRow(frame.table!, frame.table!.rows - 1) })} type="button">−</button>
                          <span className="tabular-nums">{frame.table.rows}</span>
                          <button className="rounded border border-cyan-300/20 px-1.5" onClick={() => onUpdateFrame({ table: addPaperTableRow(frame.table!) })} type="button">+</button>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <span>{t('paper.insp.cols')}</span>
                        <span className="flex items-center gap-1">
                          <button className="rounded border border-cyan-300/20 px-1.5" onClick={() => onUpdateFrame({ table: removePaperTableColumn(frame.table!, frame.table!.cols - 1) })} type="button">−</button>
                          <span className="tabular-nums">{frame.table.cols}</span>
                          <button className="rounded border border-cyan-300/20 px-1.5" onClick={() => onUpdateFrame({ table: addPaperTableColumn(frame.table!) })} type="button">+</button>
                        </span>
                      </div>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/55">
                      <input checked={frame.table.headerRow} onChange={(event) => onUpdateFrame({ table: { ...frame.table!, headerRow: event.target.checked } })} type="checkbox" />{t('paper.insp.headerRow')}</label>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <NumberField label={t('paper.insp.borderMm')} onChange={(borderWidthMm) => onUpdateFrame({ table: { ...frame.table!, borderWidthMm: Math.max(0, borderWidthMm) } })} step={0.1} value={frame.table.borderWidthMm} />
                      <NumberField label={t('paper.insp.paddingMm')} onChange={(cellPaddingMm) => onUpdateFrame({ table: { ...frame.table!, cellPaddingMm: Math.max(0, cellPaddingMm) } })} step={0.5} value={frame.table.cellPaddingMm} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-cyan-100/55">
                      <label className="flex items-center gap-1" title={t('paper.insp.tableBorderColor')}>
                        <span>{t('paper.insp.border')}</span>
                        <input
                          aria-label={t('paper.insp.tableBorderColor')}
                          className="h-5 w-6 cursor-pointer rounded border border-cyan-300/20 bg-transparent p-0"
                          onChange={(event) => onUpdateFrame({ table: { ...frame.table!, borderColor: event.target.value } })}
                          type="color"
                          value={/^#[0-9a-f]{6}$/i.test(frame.table.borderColor ?? '') ? frame.table.borderColor : '#334155'}
                        />
                      </label>
                      <label className="flex items-center gap-1" title={t('paper.insp.shadeHeaderRow')}>
                        <span>{t('paper.insp.header')}</span>
                        <input
                          aria-label={t('paper.insp.headerRowShading')}
                          className="h-5 w-6 cursor-pointer rounded border border-cyan-300/20 bg-transparent p-0"
                          onChange={(event) => onUpdateFrame({ table: setPaperTableHeaderFill(frame.table!, event.target.value) })}
                          type="color"
                          value="#4472c4"
                        />
                      </label>
                      <label className="flex items-center gap-1" title={t('paper.insp.shadeAltRows')}>
                        <span>{t('paper.insp.bands')}</span>
                        <input
                          aria-label={t('paper.insp.altRowShading')}
                          className="h-5 w-6 cursor-pointer rounded border border-cyan-300/20 bg-transparent p-0"
                          onChange={(event) => onUpdateFrame({ table: setPaperTableBandFill(frame.table!, event.target.value) })}
                          type="color"
                          value="#d9e1f2"
                        />
                      </label>
                      <button
                        className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] hover:border-cyan-300/50 hover:text-white"
                        onClick={() => onUpdateFrame({ table: clearPaperTableFills(frame.table!) })}
                        type="button"
                      >{t('paper.insp.clearShading')}</button>
                    </div>
                    <div className="mt-2 space-y-1">
                      {frame.table.cells.map((row, r) => (
                        <div className="flex gap-1" key={r}>
                          {row.map((cell, c) => (
                            <input
                              className="paper-input min-w-0 flex-1 px-1 py-0.5 text-[11px]"
                              key={c}
                              onChange={(event) => onUpdateFrame({ table: setPaperTableCell(frame.table!, r, c, event.target.value) })}
                              placeholder={`${r + 1},${c + 1}`}
                              value={cell}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
              <Field label={t('paper.insp.linkUrl')}>
                <input
                  className="paper-input"
                  onChange={(event) => onUpdateFrame({ hyperlink: event.target.value || undefined })}
                  placeholder="https://…"
                  value={frame.hyperlink ?? ''}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label={t('paper.insp.opacity')} onChange={(opacity) => onUpdateFrame({ opacity: clamp(opacity, 0, 1) })} step={0.05} value={effectiveFrame?.opacity ?? frame.opacity} />
                <NumberField label={t('paper.insp.fillOpacity')} onChange={(fillOpacity) => onUpdateFrame({ fillOpacity: clamp(fillOpacity, 0, 1) })} step={0.05} value={effectiveFrame?.fillOpacity ?? frame.fillOpacity} />
              </div>
              <Field label={t('paper.insp.fill')}>
                <AdvancedColorPicker className="h-8 w-full" buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]" label={t('paper.insp.frameFillColor')} onChange={(color) => onUpdateFrame({ fillColor: color })} value={cssColorToPickerValue(frame.fillColor)} />
              </Field>
              <Field label={t('paper.insp.strokeColor')}>
                <AdvancedColorPicker className="h-8 w-full" buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]" label={t('paper.insp.frameStrokeColor')} onChange={(color) => onUpdateFrame({ strokeColor: color })} value={cssColorToPickerValue(frame.strokeColor)} />
              </Field>
              {selectedFillSwatch || selectedStrokeSwatch ? (
                <div className="grid grid-cols-2 gap-2">
                  {selectedFillSwatch ? (
                    <NumberField
                      label={t('paper.insp.fillInkTint')}
                      onChange={(value) => {
                        const tintPercent = clamp(value, 0, 100);
                        onUpdateFrame({
                          fillColor: resolveSwatchCssColor(selectedFillSwatch, tintPercent),
                          fillSwatchId: selectedFillSwatch.id,
                          fillTintPercent: tintPercent,
                        });
                      }}
                      step={1}
                      value={frame.fillTintPercent ?? 100}
                    />
                  ) : null}
                  {selectedStrokeSwatch ? (
                    <NumberField
                      label={t('paper.insp.strokeInkTint')}
                      onChange={(value) => {
                        const tintPercent = clamp(value, 0, 100);
                        onUpdateFrame({
                          strokeColor: resolveSwatchCssColor(selectedStrokeSwatch, tintPercent),
                          strokeSwatchId: selectedStrokeSwatch.id,
                          strokeTintPercent: tintPercent,
                        });
                      }}
                      step={1}
                      value={frame.strokeTintPercent ?? 100}
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.swatchesCmyk')}</div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const rgb = parseHexColor(cssColorToPickerValue(frame.fillColor));
                      if (!rgb) return null;
                      const cmyk = rgbToCmyk(rgb);
                      return <span className="tabular-nums text-[10px] text-cyan-100/45">C{cmyk.c} M{cmyk.m} Y{cmyk.y} K{cmyk.k}</span>;
                    })()}
                    <button
                      className="rounded border border-cyan-300/20 px-1.5 py-0.5 text-[10px] text-cyan-100/60 hover:border-cyan-300/50 hover:text-white"
                      onClick={() => {
                        const rgb = parseHexColor(cssColorToPickerValue(frame.fillColor));
                        if (!rgb) return;
                        const cmyk = rgbToCmyk(rgb);
                        onAddSwatch({
                          id: `swatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                          name: `CMYK ${cmyk.c}/${cmyk.m}/${cmyk.y}/${cmyk.k}`,
                          type: 'process',
                          model: 'cmyk',
                          rgb,
                          cmyk,
                        });
                      }}
                      title={t('paper.insp.addFillToSwatches')}
                      type="button"
                    >
                      + Add
                    </button>
                  </div>
                </div>
                <div className="mb-1.5 flex items-center gap-1">
                  <input
                    className="paper-input h-6 flex-1 text-[10px]"
                    onChange={(event) => setNewSpotName(event.target.value)}
                    placeholder={t('paper.insp.spotNamePlaceholder')}
                    value={newSpotName}
                  />
                  <button
                    className="whitespace-nowrap rounded border border-amber-300/30 px-1.5 py-0.5 text-[10px] text-amber-100/70 hover:border-amber-300/60 hover:text-white disabled:opacity-40"
                    disabled={!newSpotName.trim() || !parseHexColor(cssColorToPickerValue(frame.fillColor))}
                    onClick={() => {
                      const rgb = parseHexColor(cssColorToPickerValue(frame.fillColor));
                      if (!rgb || !newSpotName.trim()) return;
                      onAddSwatch({
                        id: `swatch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
                        name: newSpotName.trim(),
                        type: 'spot',
                        model: 'cmyk',
                        rgb,
                        cmyk: rgbToCmyk(rgb),
                        spotName: newSpotName.trim(),
                      });
                      setNewSpotName('');
                    }}
                    title={t('paper.insp.addSpotSwatch')}
                    type="button"
                  >
                    + Spot
                  </button>
                </div>
                <select
                  aria-label={t('paper.insp.loadPrintSafePalette')}
                  className="mb-1.5 w-full rounded border border-cyan-300/15 bg-[#0b121d] px-1.5 py-1 text-[10px] text-cyan-100/70 hover:border-cyan-300/40"
                  onChange={(event) => {
                    const palette = findPrintSafePalette(event.target.value);
                    if (palette) paletteToPaperSwatches(palette).forEach(onAddSwatch);
                    event.target.value = '';
                  }}
                  value=""
                >
                  <option value="">{t('paper.insp.loadPrintSafePaletteEllipsis')}</option>
                  {PRINT_SAFE_PALETTES.map((palette) => (
                    <option key={palette.id} value={palette.id}>
                      {palette.name} ({palette.swatches.length})
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap gap-1">
                  {PAPER_DEFAULT_SWATCHES.map((swatch) => (
                    <button
                      className="h-5 w-5 rounded border border-cyan-300/25 hover:ring-2 hover:ring-cyan-300/50"
                      key={swatch.id}
                      onClick={(event) => onUpdateFrame(event.altKey
                        ? { strokeColor: resolveSwatchCssColor(swatch), strokeSwatchId: swatch.id }
                        : { fillColor: resolveSwatchCssColor(swatch), fillSwatchId: swatch.id })}
                      style={{ backgroundColor: resolveSwatchCssColor(swatch) }}
                      title={`${swatch.name}${swatch.cmyk ? ` — C${swatch.cmyk.c} M${swatch.cmyk.m} Y${swatch.cmyk.y} K${swatch.cmyk.k}` : ''} (tap: fill, Alt: stroke)`}
                      type="button"
                    />
                  ))}
                </div>
                {documentSwatches.length > 0 ? (
                  <div className="mt-1.5">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100/30">{t('paper.insp.documentSwatches')}</div>
                    <div className="flex flex-wrap gap-1">
                      {documentSwatches.map((swatch) => (
                        <button
                          className="h-5 w-5 rounded border border-cyan-300/25 hover:ring-2 hover:ring-cyan-300/50"
                          key={swatch.id}
                          onClick={(event) => {
                            if (event.shiftKey) {
                              onRemoveSwatch(swatch.id);
                              return;
                            }
                            onUpdateFrame(event.altKey
                              ? { strokeColor: resolveSwatchCssColor(swatch), strokeSwatchId: swatch.id }
                              : { fillColor: resolveSwatchCssColor(swatch), fillSwatchId: swatch.id });
                          }}
                          style={{ backgroundColor: resolveSwatchCssColor(swatch) }}
                          title={`${swatch.name} (tap: fill, Alt: stroke${swatch.type === 'spot' ? ' → spot plate' : ''}, Shift: remove)`}
                          type="button"
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {(() => {
                  const rgb = parseHexColor(cssColorToPickerValue(frame.fillColor)) ?? { r: 0, g: 0, b: 0 };
                  const cmyk = rgbToCmyk(rgb);
                  const ink = totalInkPercent(cmyk);
                  const channels: { key: 'c' | 'm' | 'y' | 'k'; label: string }[] = [
                    { key: 'c', label: 'C' },
                    { key: 'm', label: 'M' },
                    { key: 'y', label: 'Y' },
                    { key: 'k', label: 'K' },
                  ];
                  return (
                    <div className="mt-2">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.16em] text-cyan-100/30">{t('paper.insp.fillCmyk')}</div>
                      <div className="grid grid-cols-4 gap-1">
                        {channels.map(({ key, label }) => (
                          <NumberField
                            key={key}
                            label={label}
                            onChange={(value) => onUpdateFrame({ fillColor: rgbToCss(cmykToRgb({ ...cmyk, [key]: Math.round(clamp(value, 0, 100)) })) })}
                            step={1}
                            value={cmyk[key]}
                          />
                        ))}
                      </div>
                      <div className={`mt-1 tabular-nums text-[10px] ${ink > 300 ? 'text-amber-300' : 'text-cyan-100/40'}`}>
                        Total ink {ink}%{ink > 300 ? ' — exceeds 300% coverage limit' : ''}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                <input
                  checked={Boolean(frame.fillGradient)}
                  onChange={(event) => onUpdateFrame({
                    fillGradient: event.target.checked
                      ? { type: 'linear', fromColor: '#67e8f9', toColor: '#f9a8d4', angleDeg: 135 }
                      : undefined,
                  })}
                  type="checkbox"
                />{t('paper.insp.gradientFill')}</label>
            </InspectorSection>

            {frame.kind === 'barcode' && frame.barcode ? (
              <InspectorSection title={t('paper.insp.barcode')}>
                <Field label={t('paper.insp.barcodeValue')}>
                  <input
                    className="paper-input"
                    data-paper-barcode-value="true"
                    onChange={(event) => onUpdateFrame({ barcode: { ...frame.barcode!, value: event.target.value } })}
                    placeholder="978-0-306-40615-7"
                    value={frame.barcode.value}
                  />
                </Field>
                <div className="text-[10px] leading-4 text-cyan-100/40">{t('paper.insp.barcodeValueHelp')}</div>
                {barcodeResolution?.status === 'valid' ? (
                  <div className="rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-100/80" data-paper-barcode-status="valid">
                    {barcodeResolution.derivedCheckDigit
                      ? `${t('paper.insp.barcodeValidDerived')} — ${barcodeResolution.ean13}`
                      : barcodeResolution.bookland
                        ? `${t('paper.insp.barcodeValidIsbn13')} — ${barcodeResolution.ean13}`
                        : `${t('paper.insp.barcodeGeneralEan')} — ${barcodeResolution.ean13}`}
                  </div>
                ) : barcodeResolution?.status === 'invalid' ? (
                  <div className="rounded border border-red-300/25 bg-red-400/10 px-2 py-1 text-[10px] font-semibold text-red-100/80" data-paper-barcode-status="invalid">
                    {`${t('paper.insp.barcodeInvalid')} (${frame.label})`}
                  </div>
                ) : null}
                {barcodeCheckDigitFix !== undefined ? (
                  <button
                    className="w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-left text-xs font-semibold text-cyan-50 hover:border-cyan-300/45 hover:bg-cyan-400/15"
                    data-paper-barcode-fix-check="true"
                    onClick={() => onUpdateFrame({ barcode: { ...frame.barcode!, value: barcodeCheckDigitFix } })}
                    type="button"
                  >
                    {t('paper.insp.barcodeFixCheckDigit')}
                  </button>
                ) : null}
                <label className="flex items-center gap-2 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70">
                  <input
                    checked={frame.barcode.showHumanReadable}
                    data-paper-barcode-show-digits="true"
                    onChange={(event) => onUpdateFrame({
                      barcode: { ...frame.barcode!, showHumanReadable: event.target.checked },
                      heightMm: frame.barcode!.showHumanReadable === event.target.checked
                        ? frame.heightMm
                        : paperBarcodeSymbolSizeMm(
                          frame.widthMm / PAPER_EAN13_NOMINAL.totalModuleCount / PAPER_EAN13_NOMINAL.moduleWidthMm,
                          event.target.checked,
                        ).heightMm,
                    })}
                    type="checkbox"
                  />{t('paper.insp.barcodeShowDigits')}</label>
                <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                  <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">
                    <span>{t('paper.insp.barcodeMagnification')}</span>
                    <span className={barcodeSizeStatus?.magnificationInRange ? 'text-cyan-100/70' : 'text-red-300'}>
                      {Math.round((barcodeSizeStatus?.magnification ?? 0) * 100)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-6 gap-1" data-paper-barcode-presets="true">
                    {[80, 90, 100, 125, 150, 200].map((percent) => {
                      const target = paperBarcodeSymbolSizeMm(percent / 100, frame.barcode!.showHumanReadable);
                      return (
                        <button
                          className="rounded border border-cyan-300/15 bg-[#101a29]/70 px-1 py-1 text-[10px] font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                          key={`barcode-preset-${percent}`}
                          onClick={() => onUpdateFrame({ widthMm: target.widthMm, heightMm: target.heightMm })}
                          type="button"
                        >
                          {percent}%
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[10px] leading-4 text-cyan-100/40">
                    {`${t('paper.insp.barcodeQuietZone')}: ${(barcodeSizeStatus?.leftQuietZoneMm ?? 0).toFixed(2)} mm / ${(barcodeSizeStatus?.rightQuietZoneMm ?? 0).toFixed(2)} mm`}
                  </div>
                </div>
                <Field label={t('paper.insp.barcodeFont')}>
                  <PaperBundledFontPicker
                    onChange={(typography, authority, installedFont) => applyFrameTypography(typography, authority, installedFont)}
                    typography={frame.typography}
                  />
                  <div className="text-[10px] leading-4 text-cyan-100/40">{t('paper.insp.barcodeFontHelp')}</div>
                </Field>
              </InspectorSection>
            ) : null}

            {(frame.kind === 'image' || isImageCropFrame(frame)) && !frame.comicSfxDesign ? (
              <InspectorSection title={t('paper.insp.imageCrop')}>
                <Field label={t('paper.insp.fit')}>
                  <select
                    className="paper-input"
                    onChange={(e) => onUpdateFrame({ fit: e.target.value as PaperFrame['fit'] })}
                    value={frame.fit}
                  >
                    <option value="contain">{t('paper.insp.contain')}</option>
                    <option value="cover">{t('paper.insp.coverCrop')}</option>
                    <option value="stretch">{t('paper.insp.stretch')}</option>
                  </select>
                </Field>
                <NumberField label={t('paper.insp.scale')} onChange={(imageScale) => onUpdateFrame({ imageScale })} step={0.05} value={frame.imageScale} />
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label={t('paper.insp.offsetX')} onChange={(imageOffsetXPercent) => onUpdateFrame({ imageOffsetXPercent })} value={frame.imageOffsetXPercent} />
                  <NumberField label={t('paper.insp.offsetY')} onChange={(imageOffsetYPercent) => onUpdateFrame({ imageOffsetYPercent })} value={frame.imageOffsetYPercent} />
                </div>
                <NumberField label={t('paper.insp.imageRotate')} onChange={(imageRotationDeg) => onUpdateFrame({ imageRotationDeg })} value={frame.imageRotationDeg} />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70">
                    <input
                      checked={Boolean(frame.imageFlipX)}
                      onChange={(event) => onUpdateFrame({ imageFlipX: event.target.checked })}
                      type="checkbox"
                    />{t('paper.insp.flipX')}</label>
                  <label className="flex items-center gap-2 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/70">
                    <input
                      checked={Boolean(frame.imageFlipY)}
                      onChange={(event) => onUpdateFrame({ imageFlipY: event.target.checked })}
                      type="checkbox"
                    />{t('paper.insp.flipY')}</label>
                </div>
                <button
                  className="w-full rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-left text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                  onClick={() => onUpdateFrame({
                    fit: 'cover',
                    imageScale: 1,
                    imageOffsetXPercent: 0,
                    imageOffsetYPercent: 0,
                    imageRotationDeg: 0,
                    imageFlipX: false,
                    imageFlipY: false,
                  })}
                  type="button"
                >{t('paper.insp.resetCrop')}</button>
              </InspectorSection>
            ) : null}

            {frame.kind !== 'image' && frame.kind !== 'panel' && frame.kind !== 'barcode' ? (
              <InspectorSection title={t('paper.insp.type')}>
                <Field label={t('paper.insp.text')}>
                  <textarea
                    className="paper-input min-h-24 resize-y"
                    onChange={(e) => onUpdateFrame({ text: e.target.value })}
                    value={frame.text ?? ''}
                  />
                </Field>
                <Field label={t('paper.insp.fontFamily')}>
                  <PaperBundledFontPicker
                    onChange={(typography, authority, installedFont) => applyFrameTypography(typography, authority, installedFont)}
                    typography={frame.typography}
                  />
                  <select
                    className="paper-input"
                    onChange={(event) => applyFrameTypography({ ...frame.typography, fontFamily: event.target.value })}
                    style={{ fontFamily: selectedFontFamily }}
                    value={selectedFontFamily}
                  >
                    {!selectedFontIsPreset && selectedFontFamily ? <option value={selectedFontFamily}>Custom - {selectedFontFamily}</option> : null}
                    {importedFontFamilies.length > 0 ? (
                      <optgroup label={t('paper.insp.importedFonts')}>
                        {importedFontFamilies.map((family) => (
                          <option key={`imported-${family}`} style={{ fontFamily: family }} value={family}>
                            {family} (imported)
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {PAPER_FONT_OPTIONS.map((font) => (
                      <option key={font.value} style={{ fontFamily: font.value }} value={font.value}>
                        {font.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <PaperFontImportControl />
                <Field label={t('paper.insp.customFontStack')}>
                  <input
                    className="paper-input"
                    onChange={(event) => applyFrameTypography({ ...frame.typography, fontFamily: event.target.value })}
                    value={selectedFontFamily}
                  />
                </Field>
                <div
                  className="rounded border border-cyan-300/10 bg-white px-3 py-2 text-sm text-slate-950"
                  style={{
                    color: frame.typography.color,
                    fontFamily: frame.typography.fontFamily,
                    fontSize: `${frame.typography.fontSizePt}pt`,
                    fontStyle: frame.typography.fontStyle,
                    fontKerning: frame.typography.fontKerning ?? 'auto',
                    fontWeight: frame.typography.fontWeight,
                    letterSpacing: `${frame.typography.tracking / 1000}em`,
                    lineHeight: `${frame.typography.leadingPt}pt`,
                    ...paperTextEffectReactStyle(frame, 1),
                  }}
                >
                  Ag The quick brown fox 0123456789
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label={t('paper.insp.sizePt')}
                    onChange={(fontSizePt) => applyFrameTypography({ ...frame.typography, fontSizePt })}
                    value={frame.typography.fontSizePt}
                  />
                  <NumberField
                    label={t('paper.insp.leading')}
                    onChange={(leadingPt) => applyFrameTypography({ ...frame.typography, leadingPt })}
                    value={frame.typography.leadingPt}
                  />
                  <NumberField
                    label={t('paper.insp.tracking')}
                    onChange={(tracking) => applyFrameTypography({ ...frame.typography, tracking })}
                    step={5}
                    value={frame.typography.tracking}
                  />
                  <Field label={t('paper.insp.kerning')}>
                    <select
                      className="paper-input"
                      onChange={(event) => applyFrameTypography({ ...frame.typography, fontKerning: event.target.value as NonNullable<PaperFrame['typography']['fontKerning']> })}
                      value={frame.typography.fontKerning ?? 'auto'}
                    >
                      <option value="auto">{t('paper.insp.auto')}</option>
                      <option value="normal">{t('paper.richType.kerningMetrics')}</option>
                      <option value="none">{t('paper.insp.none')}</option>
                    </select>
                  </Field>
                  <Field label={t('paper.insp.fontColor')}>
                    <AdvancedColorPicker
                      className="h-8 w-full"
                      buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                      label={t('paper.insp.paperFrameFontColor')}
                      onChange={(color) => applyFrameTypography({ ...frame.typography, color, colorSwatchId: undefined })}
                      value={cssColorToPickerValue(frame.typography.color)}
                    />
                  </Field>
                </div>
                {(document.swatches ?? []).some((swatch) => swatch.type === 'spot') ? (
                  <Field label={t('paper.insp.spotInk')}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(document.swatches ?? [])
                        .filter((swatch) => swatch.type === 'spot')
                        .map((swatch) => {
                          const active = frame.typography.colorSwatchId === swatch.id;
                          return (
                            <button
                              key={swatch.id}
                              type="button"
                              className={`h-6 w-6 rounded border ${active ? 'border-cyan-300 ring-2 ring-cyan-300/60' : 'border-cyan-300/20 hover:border-cyan-300/50'}`}
                              onClick={() => applyFrameTypography({
                                ...frame.typography,
                                color: resolveSwatchCssColor(swatch),
                                colorSwatchId: active ? undefined : swatch.id,
                              })}
                              style={{ backgroundColor: resolveSwatchCssColor(swatch) }}
                              title={`${swatch.spotName ?? swatch.name} — text prints on its own named /Separation plate in PDF/X (needs spot policy "Preserve named spots"). Tap again to unbind.`}
                            />
                          );
                        })}
                      {frame.typography.colorSwatchId ? (
                        <span className="ml-1 text-[10px] text-cyan-100/60">
                          {(document.swatches ?? []).find((swatch) => swatch.id === frame.typography.colorSwatchId)?.spotName
                            ?? (document.swatches ?? []).find((swatch) => swatch.id === frame.typography.colorSwatchId)?.name
                            ?? 'spot'} plate
                          {document.printProduction.spotColorPolicy !== 'preserve-named' ? ' (enable "Preserve named spots")' : ''}
                        </span>
                      ) : null}
                    </div>
                  </Field>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t('paper.insp.weight')}>
                    <select
                      className="paper-input"
                      onChange={(event) => applyFrameTypography({ ...frame.typography, fontWeight: event.target.value })}
                      value={frame.typography.fontWeight}
                    >
                      {PAPER_FONT_WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
                    </select>
                  </Field>
                  <Field label={t('paper.insp.style')}>
                    <select
                      className="paper-input"
                      onChange={(event) => applyFrameTypography({ ...frame.typography, fontStyle: event.target.value as PaperFrame['typography']['fontStyle'] })}
                      value={frame.typography.fontStyle}
                    >
                      <option value="normal">{t('paper.insp.normal')}</option>
                      <option value="italic">{t('paper.insp.italic')}</option>
                    </select>
                  </Field>
                </div>
                <Field label={t('paper.insp.align')}>
                  <select
                    className="paper-input"
                    onChange={(e) => applyFrameTypography({ ...frame.typography, align: e.target.value as PaperFrame['typography']['align'] })}
                    value={frame.typography.align}
                  >
                    <option value="left">{t('paper.insp.left')}</option>
                    <option value="center">{t('paper.insp.center')}</option>
                    <option value="right">{t('paper.insp.right')}</option>
                    <option value="justify">{t('paper.insp.justify')}</option>
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                  <input
                    checked={frame.typography.hyphenate}
                    onChange={(event) => applyFrameTypography({ ...frame.typography, hyphenate: event.target.checked })}
                    type="checkbox"
                  />{t('paper.insp.hyphenation')}</label>
                <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                  <input
                    checked={Boolean(frame.typography.alignToBaselineGrid)}
                    disabled={frame.typography.writingMode === 'vertical-rl'}
                    onChange={(event) => applyFrameTypography({ ...frame.typography, alignToBaselineGrid: event.target.checked })}
                    type="checkbox"
                  />{t('paper.insp.alignBaselineGrid')}</label>
                <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                  <input
                    checked={Boolean(frame.typography.opticalMarginAlignment)}
                    disabled={frame.typography.writingMode === 'vertical-rl'}
                    onChange={(event) => applyFrameTypography({ ...frame.typography, opticalMarginAlignment: event.target.checked })}
                    type="checkbox"
                  />{t('paper.insp.opticalMargin')}</label>
                <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.paragraph')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label={t('paper.insp.indentMm')}
                      onChange={(firstLineIndentMm) => applyFrameTypography({ ...frame.typography, firstLineIndentMm: Math.max(0, firstLineIndentMm) })}
                      step={0.5}
                      value={frame.typography.firstLineIndentMm ?? 0}
                    />
                    <Field label={t('paper.insp.lastLine')}>
                      <select
                        className="paper-input"
                        onChange={(event) => applyFrameTypography({ ...frame.typography, alignLast: event.target.value as PaperTextAlignLast })}
                        value={frame.typography.alignLast ?? 'auto'}
                      >
                        <option value="auto">{t('paper.insp.auto')}</option>
                        <option value="left">{t('paper.insp.left')}</option>
                        <option value="center">{t('paper.insp.center')}</option>
                        <option value="right">{t('paper.insp.right')}</option>
                        <option value="justify">{t('paper.insp.justify')}</option>
                      </select>
                    </Field>
                    <NumberField
                      label={t('paper.insp.dropCapLines')}
                      onChange={(dropCapLines) => applyFrameTypography({ ...frame.typography, dropCapLines: Math.max(0, Math.round(dropCapLines)) })}
                      step={1}
                      value={frame.typography.dropCapLines ?? 0}
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                      <input
                        checked={Boolean(frame.typography.smallCaps)}
                        onChange={(event) => applyFrameTypography({ ...frame.typography, smallCaps: event.target.checked })}
                        type="checkbox"
                      />{t('paper.insp.smallCaps')}</label>
                    <Field label={t('paper.insp.figures')}>
                      <select
                        className="paper-input"
                        onChange={(event) => applyFrameTypography({ ...frame.typography, numericStyle: event.target.value as PaperNumericStyle })}
                        value={frame.typography.numericStyle ?? 'normal'}
                      >
                        <option value="normal">{t('paper.insp.default')}</option>
                        <option value="lining">{t('paper.insp.lining')}</option>
                        <option value="oldstyle">{t('paper.insp.oldstyle')}</option>
                        <option value="tabular">{t('paper.insp.tabular')}</option>
                      </select>
                    </Field>
                    <Field label={t('paper.insp.lineBreak')}>
                      <select
                        className="paper-input"
                        onChange={(event) => applyFrameTypography({ ...frame.typography, lineBreak: event.target.value as PaperLineBreak })}
                        value={frame.typography.lineBreak ?? 'auto'}
                      >
                        <option value="auto">{t('paper.insp.auto')}</option>
                        <option value="balance">{t('paper.insp.balance')}</option>
                        <option value="pretty">{t('paper.insp.pretty')}</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <NumberField
                      label={t('paper.insp.spaceBeforeMm')}
                      onChange={(spaceBeforeMm) => applyFrameTypography({ ...frame.typography, spaceBeforeMm: Math.max(0, spaceBeforeMm) })}
                      step={0.5}
                      value={frame.typography.spaceBeforeMm ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.spaceAfterMm')}
                      onChange={(spaceAfterMm) => applyFrameTypography({ ...frame.typography, spaceAfterMm: Math.max(0, spaceAfterMm) })}
                      step={0.5}
                      value={frame.typography.spaceAfterMm ?? 0}
                    />
                  </div>
                  <div className="mt-2 text-[10px] text-cyan-100/35">Folios: type {'{page}'} or {'{pages}'} for live page numbers (great on master pages).</div>
                </div>
                <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.jp.section')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t('paper.insp.direction')}>
                      <select
                        className="paper-input"
                        onChange={(event) =>
                          applyFrameTypography({
                            ...frame.typography,
                            writingMode: event.target.value === 'vertical-rl' ? 'vertical-rl' : undefined,
                          })
                        }
                        value={frame.typography.writingMode ?? 'horizontal-tb'}
                      >
                        <option value="horizontal-tb">横書き Horizontal</option>
                        <option value="vertical-rl">縦書き Vertical (RL)</option>
                      </select>
                    </Field>
                    <Field label={t('paper.insp.orientation')}>
                      <select
                        className="paper-input"
                        disabled={frame.typography.writingMode !== 'vertical-rl'}
                        onChange={(event) =>
                          applyFrameTypography({ ...frame.typography, textOrientation: event.target.value as PaperTextOrientation })
                        }
                        value={frame.typography.textOrientation ?? 'mixed'}
                      >
                        <option value="mixed">{t('paper.insp.mixedTcy')}</option>
                        <option value="upright">{t('paper.insp.upright')}</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                      <input
                        checked={frame.typography.lineBreakStrict ?? frame.typography.writingMode === 'vertical-rl'}
                        onChange={(event) => applyFrameTypography({ ...frame.typography, lineBreakStrict: event.target.checked })}
                        type="checkbox"
                      />
                      禁則処理 Kinsoku
                    </label>
                    <Field label={t('paper.insp.emphasisField')}>
                      <select
                        className="paper-input"
                        onChange={(event) => applyFrameTypography({ ...frame.typography, emphasis: event.target.value as PaperEmphasisMark })}
                        value={frame.typography.emphasis ?? 'none'}
                      >
                        <option value="none">{t('paper.insp.none')}</option>
                        <option value="dot">● Dot</option>
                        <option value="sesame">﹅ Sesame</option>
                        <option value="open-dot">○ Open dot</option>
                        <option value="circle">◉ Circle</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-cyan-100/35">{t('paper.insp.furiganaHint')}<span className="text-cyan-100/60">漢字《かんじ》</span> or <span className="text-cyan-100/60">｜熟語《じゅくご》</span>.
                    圏点 / emphasis on a word: <span className="text-cyan-100/60">《《大事》》</span>.
                    Numbers auto-set as 縦中横 in vertical text. Pick a 明朝/ゴシック font above for proper kana &amp; kanji.
                  </div>
                </div>
                {frame.kind === 'text' ? (
                  <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.columns')}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField label={t('paper.insp.count')} onChange={(columns) => onUpdateFrame({ columns: Math.max(1, Math.round(columns)) })} step={1} value={frame.columns} />
                      <NumberField label={t('paper.insp.gutterMm')} onChange={(columnGutterMm) => onUpdateFrame({ columnGutterMm: Math.max(0, columnGutterMm) })} step={0.5} value={frame.columnGutterMm ?? DEFAULT_PAPER_COLUMN_GUTTER_MM} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                        <input checked={Boolean(frame.columnBalance)} onChange={(event) => onUpdateFrame({ columnBalance: event.target.checked })} type="checkbox" />{t('paper.insp.balance')}</label>
                      <label className="flex items-center gap-2 text-xs text-cyan-100/55">
                        <input checked={Boolean(frame.columnRule)} onChange={(event) => onUpdateFrame({ columnRule: event.target.checked })} type="checkbox" />{t('paper.insp.rule')}</label>
                    </div>
                  </div>
                ) : (
                  <NumberField label={t('paper.insp.columns')} onChange={(columns) => onUpdateFrame({ columns: Math.max(1, Math.round(columns)) })} value={frame.columns} />
                )}
                <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.textEffects')}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t('paper.insp.stroke')}>
                      <AdvancedColorPicker
                        className="h-8 w-full"
                        buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                        label={t('paper.insp.textStrokeColor')}
                        onChange={(color) => onUpdateFrame({ textStrokeColor: color })}
                        value={cssColorToPickerValue(frame.textStrokeColor ?? '#111111')}
                      />
                    </Field>
                    <NumberField
                      label={t('paper.insp.strokeMm')}
                      onChange={(textStrokeWidthMm) => onUpdateFrame({ textStrokeWidthMm: Math.max(0, textStrokeWidthMm) })}
                      step={0.05}
                      value={frame.textStrokeWidthMm ?? 0}
                    />
                    <Field label={t('paper.insp.shadow')}>
                      <AdvancedColorPicker
                        className="h-8 w-full"
                        buttonClassName="rounded border border-cyan-300/15 bg-[#0b121d]"
                        label={t('paper.insp.textShadowColor')}
                        onChange={(color) => onUpdateFrame({ textShadowColor: color })}
                        value={cssColorToPickerValue(frame.textShadowColor ?? '#000000')}
                      />
                    </Field>
                    <NumberField
                      label={t('paper.insp.shadowBlur')}
                      onChange={(textShadowBlurMm) => onUpdateFrame({ textShadowBlurMm: Math.max(0, textShadowBlurMm) })}
                      step={0.1}
                      value={frame.textShadowBlurMm ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.shadowX')}
                      onChange={(textShadowOffsetXMm) => onUpdateFrame({ textShadowOffsetXMm })}
                      step={0.1}
                      value={frame.textShadowOffsetXMm ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.shadowY')}
                      onChange={(textShadowOffsetYMm) => onUpdateFrame({ textShadowOffsetYMm })}
                      step={0.1}
                      value={frame.textShadowOffsetYMm ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.skewX')}
                      onChange={(textSkewXDeg) => onUpdateFrame({ textSkewXDeg })}
                      step={1}
                      value={frame.textSkewXDeg ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.skewY')}
                      onChange={(textSkewYDeg) => onUpdateFrame({ textSkewYDeg })}
                      step={1}
                      value={frame.textSkewYDeg ?? 0}
                    />
                    <NumberField
                      label={t('paper.insp.scaleX')}
                      onChange={(textScaleX) => onUpdateFrame({ textScaleX: Math.max(0.1, textScaleX) })}
                      step={0.05}
                      value={frame.textScaleX ?? 1}
                    />
                    <NumberField
                      label={t('paper.insp.scaleY')}
                      onChange={(textScaleY) => onUpdateFrame({ textScaleY: Math.max(0.1, textScaleY) })}
                      step={0.05}
                      value={frame.textScaleY ?? 1}
                    />
                    <NumberField
                      label={t('paper.insp.arc')}
                      onChange={(textArcPercent) => onUpdateFrame({ textArcPercent: Math.max(-100, Math.min(100, Math.round(textArcPercent))) })}
                      step={5}
                      value={frame.textArcPercent ?? 0}
                    />
                  </div>
                  <button
                    className="mt-2 w-full rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-xs text-cyan-100/70"
                    onClick={() => onUpdateFrame({
                      textStrokeColor: undefined,
                      textStrokeWidthMm: undefined,
                      textShadowColor: undefined,
                      textShadowOffsetXMm: undefined,
                      textShadowOffsetYMm: undefined,
                      textShadowBlurMm: undefined,
                      textSkewXDeg: undefined,
                      textSkewYDeg: undefined,
                      textScaleX: undefined,
                      textScaleY: undefined,
                      textArcPercent: undefined,
                    })}
                    type="button"
                  >{t('paper.insp.clearTextEffects')}</button>
                </div>
                {frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' ? (
                  <>
                    <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">{t('paper.insp.bubblePresets')}</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {PAPER_BUBBLE_PRESETS.map((preset) => (
                          <button
                            className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 py-1 text-[11px] text-cyan-100/75 hover:border-cyan-300/40 hover:text-white"
                            key={preset.id}
                            onClick={() => onUpdateFrame(preset.patch)}
                            title={preset.description}
                            type="button"
                          >
                            {preset.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Field label={t('paper.insp.bubbleShape')}>
                      <select
                        className="paper-input"
                        onChange={(event) => onUpdateFrame({ bubbleShape: event.target.value as PaperFrame['bubbleShape'] })}
                        value={frame.bubbleShape ?? 'organic'}
                      >
                        <option value="organic">{t('paper.insp.organic')}</option>
                        <option value="oval">{t('paper.insp.oval')}</option>
                        <option value="squircle">{t('paper.insp.squircle')}</option>
                        <option value="cloud">{t('paper.insp.thoughtCloud')}</option>
                      </select>
                    </Field>
                    <PaperBubbleChainControls
                      document={document}
                      frame={frame}
                      onChainWith={onChainBubbleWith}
                      onMove={onMoveBubbleInChain}
                      onUnchain={onUnchainBubble}
                      pageFrames={currentPage?.frames ?? []}
                    />
                    <PaperBubbleConnectorControls
                      frame={frame}
                      onUpdate={onUpdateBubbleConnectorGeometry}
                      pageFrames={currentPage?.frames ?? []}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label={t('paper.insp.connector')}>
                        <select
                          className="paper-input"
                          onChange={(event) => onUpdateFrame({ bubbleConnectorStyle: event.target.value as PaperFrame['bubbleConnectorStyle'] })}
                          value={frame.bubbleConnectorStyle ?? 'line'}
                        >
                          <option value="line">{t('paper.insp.line')}</option>
                          <option value="tail">{t('paper.insp.curvedTail')}</option>
                          <option value="thought-dots">{t('paper.insp.thoughtDots')}</option>
                          <option value="bridge">{t('paper.insp.sameSpeakerBridge')}</option>
                        </select>
                      </Field>
                      <Field label={t('paper.insp.anchor')}>
                        <select
                          className="paper-input"
                          onChange={(event) => onUpdateFrame({ bubbleConnectorAnchor: event.target.value as PaperFrame['bubbleConnectorAnchor'] })}
                          value={frame.bubbleConnectorAnchor ?? 'auto'}
                        >
                          <option value="auto">{t('paper.insp.auto')}</option>
                          <option value="left">{t('paper.insp.left')}</option>
                          <option value="right">{t('paper.insp.right')}</option>
                          <option value="top">{t('paper.insp.top')}</option>
                          <option value="bottom">{t('paper.insp.bottom')}</option>
                        </select>
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField label={t('paper.insp.tailX')} onChange={(tailXPercent) => onUpdateFrame({ tailXPercent })} value={frame.tailXPercent ?? 72} />
                      <NumberField label={t('paper.insp.tailY')} onChange={(tailYPercent) => onUpdateFrame({ tailYPercent })} value={frame.tailYPercent ?? 92} />
                      <NumberField label={t('paper.insp.pinchX')} onChange={(bubblePinchXPercent) => onUpdateFrame({ bubblePinchXPercent })} value={frame.bubblePinchXPercent ?? 58} />
                      <NumberField label={t('paper.insp.pinchY')} onChange={(bubblePinchYPercent) => onUpdateFrame({ bubblePinchYPercent })} value={frame.bubblePinchYPercent ?? 75} />
                      <NumberField label={t('paper.insp.tailWidth')} onChange={(bubbleTailWidthPercent) => onUpdateFrame({ bubbleTailWidthPercent })} value={frame.bubbleTailWidthPercent ?? 18} />
                      <NumberField label={t('paper.insp.tailCurve')} onChange={(bubbleTailCurvePercent) => onUpdateFrame({ bubbleTailCurvePercent })} value={frame.bubbleTailCurvePercent ?? 55} />
                      <NumberField label={t('paper.insp.warp')} onChange={(bubbleWarp) => onUpdateFrame({ bubbleWarp })} step={0.01} value={frame.bubbleWarp ?? 0.18} />
                    </div>
                    <Field label={t('paper.insp.textVAlign')}>
                      <select
                        className="paper-input"
                        onChange={(event) => onUpdateFrame({ textVerticalAlign: event.target.value as PaperFrame['textVerticalAlign'] })}
                        value={resolvePaperTextBox(frame).verticalAlign}
                      >
                        <option value="top">{t('paper.insp.top')}</option>
                        <option value="middle">{t('paper.insp.middle')}</option>
                        <option value="bottom">{t('paper.insp.bottom')}</option>
                      </select>
                    </Field>
                    <label className="flex items-center gap-2 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-xs font-semibold text-cyan-100/75">
                      <input
                        checked={frame.typography.writingMode === 'vertical-rl'}
                        onChange={(event) =>
                          applyFrameTypography({
                            ...frame.typography,
                            // Manga bubbles are almost always centered; turning on 縦書き also centers the text
                            // box so it reads like a proper vertical bubble in one click. Full JP controls
                            // (furigana notation, kinsoku, 圏点, fonts) live in the Japanese 縦組 section above.
                            writingMode: event.target.checked ? 'vertical-rl' : undefined,
                            align: event.target.checked ? 'center' : frame.typography.align,
                          })
                        }
                        type="checkbox"
                      />
                      縦書き Vertical text (manga)
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <NumberField label={t('paper.insp.textX')} onChange={(textBoxXPercent) => onUpdateFrame({ textBoxXPercent: clamp(textBoxXPercent, 0, 100) })} value={resolvePaperTextBox(frame).xPercent} />
                      <NumberField label={t('paper.insp.textY')} onChange={(textBoxYPercent) => onUpdateFrame({ textBoxYPercent: clamp(textBoxYPercent, 0, 100) })} value={resolvePaperTextBox(frame).yPercent} />
                      <NumberField label={t('paper.insp.textW')} onChange={(textBoxWidthPercent) => onUpdateFrame({ textBoxWidthPercent: clamp(textBoxWidthPercent, 5, 100) })} value={resolvePaperTextBox(frame).widthPercent} />
                      <NumberField label={t('paper.insp.textH')} onChange={(textBoxHeightPercent) => onUpdateFrame({ textBoxHeightPercent: clamp(textBoxHeightPercent, 5, 100) })} value={resolvePaperTextBox(frame).heightPercent} />
                    </div>
                    <NumberField label={t('paper.insp.textRotate')} onChange={(textRotationDeg) => onUpdateFrame({ textRotationDeg })} value={resolvePaperTextBox(frame).rotationDeg} />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-left text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                        onClick={() => {
                          onUpdateFrame({
                            textBoxXPercent: 12,
                            textBoxYPercent: 18,
                            textBoxWidthPercent: 76,
                            textBoxHeightPercent: 48,
                            textVerticalAlign: 'middle',
                          });
                          applyFrameTypography({ ...frame.typography, align: 'center' });
                        }}
                        type="button"
                      >{t('paper.insp.centerText')}</button>
                      <button
                        className="rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-3 py-2 text-left text-xs font-semibold text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                        onClick={() => onUpdateFrame({
                          textBoxXPercent: 0,
                          textBoxYPercent: 0,
                          textBoxWidthPercent: 100,
                          textBoxHeightPercent: 100,
                          textRotationDeg: 0,
                        })}
                        type="button"
                      >{t('paper.insp.fillBubble')}</button>
                    </div>
                  </>
                ) : null}
              </InspectorSection>
            ) : null}
          </>
        ) : (
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-3 text-sm text-cyan-100/45">{t('paper.insp.selectFrameHint')}</div>
        )}
      </div>
      <div className="border-t border-cyan-300/10 pt-3 text-xs text-cyan-100/50">{status}</div>
    </div>
  );
}

function PaperPreflightPanel({
  onSelectPreflightIssue,
  preflight,
}: {
  onSelectPreflightIssue: (issue: PaperPreflightIssue) => void;
  preflight: PaperPreflightReport;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <PreflightCount label={t('paper.insp.errors')} value={preflight.counts.error} tone="error" />
        <PreflightCount label={t('paper.insp.warnings')} value={preflight.counts.warning} tone="warning" />
        <PreflightCount label={t('paper.insp.info')} value={preflight.counts.info} tone="info" />
      </div>
      <div className="max-h-[30rem] space-y-2 overflow-y-auto pr-1">
        {preflight.issues.length ? preflight.issues.slice(0, 24).map((issue) => (
          <button
            className="block w-full rounded-md border border-cyan-300/10 bg-[#10131b] p-2 text-left hover:border-cyan-300/35"
            key={issue.id}
            onClick={() => onSelectPreflightIssue(issue)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${preflightSeverityClass(issue.severity)}`}>{issue.severity}</span>
              {issue.pageNumber ? <span className="text-[10px] text-cyan-100/35">Page {issue.pageNumber}</span> : null}
            </div>
            <div className="mt-1 text-xs font-semibold text-cyan-50/85">{issue.title}</div>
            <div className="mt-0.5 text-[11px] leading-4 text-cyan-100/45">{issue.detail}</div>
          </button>
        )) : (
          <div className="rounded-md border border-emerald-300/15 bg-emerald-400/10 p-2 text-xs text-emerald-100/75">{t('paper.insp.noPreflightIssues')}</div>
        )}
      </div>
    </div>
  );
}

function PaperLinkedAssetsPanel({
  document,
  onSelectLinkedAsset,
  sourceItems,
}: {
  document: PaperDocument;
  onSelectLinkedAsset: (asset: PaperLinkedAssetInfo) => void;
  sourceItems: SourceBinLibraryItem[];
}) {
  const { t } = useI18n();
  const linkedAssets = useMemo(() => collectPaperLinkedAssets(document, sourceItems), [document, sourceItems]);

  return (
    <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
      {linkedAssets.length ? linkedAssets.map((asset) => (
        <button
          className="block w-full rounded-md border border-cyan-300/10 bg-[#10131b] p-2 text-left hover:border-cyan-300/35"
          key={asset.id}
          onClick={() => onSelectLinkedAsset(asset)}
          type="button"
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${linkedAssetStatusClass(asset.status)}`}>{asset.status}</span>
            <span className="text-[10px] text-cyan-100/35">Page {asset.pageNumber}</span>
          </div>
          <div className="mt-1 truncate text-xs font-semibold text-cyan-50/85">{asset.sourceLabel}</div>
          <div className="mt-0.5 text-[11px] leading-4 text-cyan-100/45">
            {asset.sourceId ? `ID ${asset.sourceId}` : 'No source ID'} - {asset.frameLabel}
          </div>
          <div className="mt-0.5 text-[11px] leading-4 text-cyan-100/50">{asset.detail}</div>
        </button>
      )) : (
        <div className="rounded-md border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/45">{t('paper.insp.noPlacedImages')}</div>
      )}
    </div>
  );
}

function PaperDtpParityPanel({
  onRunParityAction,
}: {
  onRunParityAction: (target: 'linked-assets' | 'spreads' | 'preflight') => void;
}) {
  const { t } = useI18n();
  const parityFeatures = useMemo(() => getPaperDtpParityPriorities(), []);

  return (
    <div className="space-y-3">
      <div className="text-[11px] leading-4 text-cyan-100/45">{t('paper.insp.preflightIntro')}</div>
      <div className="space-y-2">
        {parityFeatures.map((feature) => (
          <div className="rounded-md border border-cyan-300/10 bg-[#10131b] p-2" key={feature.id}>
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-cyan-50/85">{feature.feature}</div>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${parityStatusClass(feature.status)}`}>{feature.status}</span>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2 text-[10px] leading-4 text-cyan-100/45">
              <div><span className="font-semibold text-cyan-100/60">{t('paper.insp.printStandard')}</span> {feature.indesign}</div>
              <div><span className="font-semibold text-cyan-100/60">Sloom Studio:</span> {feature.signalLoom}</div>
            </div>
            <div className="mt-1 text-[11px] leading-4 text-cyan-100/50">{feature.comicImpact}</div>
            {feature.actionTarget ? (
              <button
                className="mt-2 rounded border border-cyan-300/15 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/70 hover:border-cyan-300/40 hover:text-white"
                onClick={() => onRunParityAction(feature.actionTarget!)}
                type="button"
              >{t('paper.insp.showInPaper')}</button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalRuler({
  grid,
  onBeginGuideDrag,
  width,
  zoom,
}: {
  grid: PaperDocument['layout']['grid'];
  onBeginGuideDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  width: number;
  zoom: number;
}) {
  const { t } = useI18n();
  const marks = useMemo(() => buildRulerMarks(width, zoom, grid), [grid, width, zoom]);
  return (
    <div
      className="relative mb-1 h-5 cursor-col-resize bg-[#0b121d] text-[9px] text-cyan-100/45"
      onPointerDown={onBeginGuideDrag}
      style={{ width }}
      title={t('paper.insp.dragVGuide')}
    >
      {marks.map((mark) => (
        <span
          className={`absolute top-0 border-l pl-0.5 ${mark.major ? 'h-full border-cyan-100/25' : 'h-2.5 border-cyan-100/10'}`}
          key={`${mark.position}-${mark.label ?? 'minor'}`}
          style={{ left: mark.position }}
        >
          {mark.label}
        </span>
      ))}
    </div>
  );
}

function VerticalRuler({
  grid,
  height,
  onBeginGuideDrag,
  zoom,
}: {
  grid: PaperDocument['layout']['grid'];
  height: number;
  onBeginGuideDrag: (event: React.PointerEvent<HTMLDivElement>) => void;
  zoom: number;
}) {
  const { t } = useI18n();
  const marks = useMemo(() => buildRulerMarks(height, zoom, grid), [grid, height, zoom]);
  return (
    <div
      className="relative mt-6 w-5 cursor-row-resize bg-[#0b121d] text-[9px] text-cyan-100/45"
      onPointerDown={onBeginGuideDrag}
      style={{ height }}
      title={t('paper.insp.dragHGuide')}
    >
      {marks.map((mark) => (
        <span
          className={`absolute left-0 border-t pt-0.5 [writing-mode:vertical-rl] ${mark.major ? 'w-full border-cyan-100/25' : 'w-2.5 border-cyan-100/10'}`}
          key={`${mark.position}-${mark.label ?? 'minor'}`}
          style={{ top: mark.position }}
        >
          {mark.label}
        </span>
      ))}
    </div>
  );
}

function buildRulerMarks(
  lengthPx: number,
  zoom: number,
  grid: PaperDocument['layout']['grid'],
): Array<{ position: number; label?: string; major: boolean }> {
  const markerMm = paperRulerMarkerSpacingMm(grid);
  const majorMm = Math.max(markerMm, grid.sizeMm);
  const markerPx = markerMm * PX_PER_MM * zoom;
  const majorPx = majorMm * PX_PER_MM * zoom;
  const includeMinor = markerPx >= 4;
  const labelEveryMajor = Math.max(1, Math.ceil(18 / Math.max(1, majorPx)));
  const marks: Array<{ position: number; label?: string; major: boolean }> = [];
  const lengthMm = lengthPx / Math.max(0.001, PX_PER_MM * zoom);
  for (let index = 0; index * markerMm <= lengthMm; index += 1) {
    const positionMm = Number((index * markerMm).toFixed(3));
    const majorIndex = Math.round(positionMm / majorMm);
    const major = Math.abs(positionMm - majorIndex * majorMm) < 0.001;
    if (!major && !includeMinor) continue;
    marks.push({
      position: positionMm * PX_PER_MM * zoom,
      label: major && majorIndex % labelEveryMajor === 0 ? `${Math.round(positionMm)}` : undefined,
      major,
    });
  }
  return marks;
}

function InspectorSection({
  children,
  defaultOpen = true,
  title,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
  title: string;
}) {
  const storageKey = `signal-loom-paper-inspector-section:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    const stored = window.localStorage.getItem(storageKey);
    return stored ? stored !== 'closed' : defaultOpen;
  });

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, next ? 'open' : 'closed');
      }
      return next;
    });
  };

  return (
    <section className="rounded-lg border border-cyan-300/10 bg-[#0b121d]">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100/55 hover:bg-cyan-300/5 hover:text-cyan-100"
        onClick={toggleOpen}
        type="button"
      >
        <span>{title}</span>
        <ChevronDown
          aria-hidden
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          size={14}
        />
      </button>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </section>
  );
}

function PreflightCount({ label, tone, value }: { label: string; tone: 'error' | 'warning' | 'info'; value: number }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${preflightCountClass(tone)}`}>
      <div className="text-lg font-semibold leading-none">{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.14em] opacity-70">{label}</div>
    </div>
  );
}

function preflightCountClass(tone: 'error' | 'warning' | 'info'): string {
  if (tone === 'error') return 'border-rose-300/20 bg-rose-400/10 text-rose-100';
  if (tone === 'warning') return 'border-amber-300/20 bg-amber-400/10 text-amber-100';
  return 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100';
}

function preflightSeverityClass(severity: 'error' | 'warning' | 'info'): string {
  if (severity === 'error') return 'bg-rose-400/15 text-rose-100';
  if (severity === 'warning') return 'bg-amber-400/15 text-amber-100';
  return 'bg-cyan-400/15 text-cyan-100';
}

function parityStatusClass(status: 'available' | 'partial' | 'gap' | 'done'): string {
  if (status === 'available' || status === 'done') return 'bg-emerald-400/15 text-emerald-100';
  if (status === 'partial') return 'bg-amber-400/15 text-amber-100';
  return 'bg-rose-400/15 text-rose-100';
}

function linkedAssetStatusClass(status: 'ok' | 'missing' | 'embedded' | 'unknown' | 'stale'): string {
  if (status === 'ok') return 'bg-emerald-400/15 text-emerald-100';
  if (status === 'missing') return 'bg-rose-400/15 text-rose-100';
  if (status === 'stale') return 'bg-amber-400/15 text-amber-100';
  if (status === 'embedded') return 'bg-violet-400/15 text-violet-100';
  return 'bg-cyan-400/15 text-cyan-100';
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block text-xs text-cyan-100/55">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function NumberField({
  label,
  onChange,
  step = 0.5,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return (
    <Field label={label}>
      <input
        className="paper-input"
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={Number(safeValue.toFixed(2))}
      />
    </Field>
  );
}

function PaperPreflightStatusButton({
  active,
  onClick,
  status,
}: {
  active: boolean;
  onClick: () => void;
  status: PaperPreflightStatusSummary;
}) {
  return (
    <button
      aria-label={`Paper preflight: ${status.detail}`}
      aria-pressed={active}
      className={`inline-flex h-8 min-w-[6.75rem] shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-semibold ${paperPreflightStatusToneClass(status.tone, active)}`}
      data-paper-preflight-status="true"
      data-paper-preflight-tone={status.tone}
      data-paper-preflight-visible={active ? 'true' : 'false'}
      onClick={onClick}
      title={`${active ? 'Hide' : 'Show'} preflight checks. ${status.detail} ${status.countsLabel}`}
      type="button"
    >
      {status.tone === 'ready' ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
      <span className="whitespace-nowrap">{status.label}</span>
    </button>
  );
}

function paperPreflightStatusToneClass(tone: PaperPreflightStatusTone, active: boolean): string {
  const activeTint = active
    ? 'border-cyan-200/75 ring-1 ring-cyan-200/40 shadow-sm'
    : 'border-cyan-300/25';

  if (tone === 'error') return `${activeTint} bg-rose-500/15 text-rose-100 hover:border-rose-200/60 hover:text-white`;
  if (tone === 'warning') return `${activeTint} bg-amber-500/15 text-amber-100 hover:border-amber-200/60 hover:text-white`;
  if (tone === 'info') return `${activeTint} bg-cyan-400/10 text-cyan-100/80 hover:border-cyan-200/45 hover:text-white`;
  return `${activeTint} bg-emerald-400/10 text-emerald-100/80 hover:border-emerald-200/45 hover:text-white`;
}

function StripButton({ icon, label, onClick, title }: { icon: React.ReactNode; label: string; onClick: () => void; title?: string }) {
  return (
    <button
      aria-label={label}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-cyan-300/15 bg-[#101a29]/70 px-2 text-[11px] font-semibold text-cyan-100/75 hover:border-cyan-300/40 hover:text-white"
      onClick={onClick}
      title={title ?? label}
      type="button"
    >
      {icon}
      <span className="hidden min-[1500px]:inline">{label}</span>
    </button>
  );
}

function ExportMenuItem({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      type="button"
      className="flex w-full items-start gap-2.5 rounded-lg p-1.5 text-left transition-all duration-200 hover:bg-cyan-500/10 hover:border-cyan-300/30 border border-transparent group"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cyan-400/5 text-cyan-200 border border-cyan-400/10 group-hover:bg-cyan-400/25 group-hover:text-white group-hover:border-cyan-400/30 transition-all duration-200">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-cyan-100 group-hover:text-white transition-colors duration-150">
          {label}
        </div>
        <div className="text-[10px] text-cyan-100/40 group-hover:text-cyan-100/60 leading-tight transition-colors duration-150 mt-0.5">
          {description}
        </div>
      </div>
    </button>
  );
}

function paperGridOverlayBackground(snapActive: boolean): string {
  const lineColor = snapActive ? 'rgba(34,197,94,0.26)' : 'rgba(71,85,105,0.18)';
  return `linear-gradient(${lineColor} 1px, transparent 1px), linear-gradient(90deg, ${lineColor} 1px, transparent 1px)`;
}

function PaperSmartGuideOverlay({
  guides,
  zoom,
}: {
  guides: Array<PaperSmartGuideLine & { pageId: string }>;
  zoom: number;
}) {
  return (
    <>
      {guides.map((guide, index) => (
        <div
          className="pointer-events-none absolute z-[90] bg-fuchsia-500 shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
          data-paper-editor-overlay="smart-guide"
          data-paper-smart-guide-orientation={guide.orientation}
          key={`${guide.orientation}-${guide.positionMm}-${index}`}
          style={guide.orientation === 'vertical'
            ? {
                height: Math.max(1, (guide.endMm - guide.startMm) * PX_PER_MM * zoom),
                left: guide.positionMm * PX_PER_MM * zoom,
                top: guide.startMm * PX_PER_MM * zoom,
                width: 1,
              }
            : {
                height: 1,
                left: guide.startMm * PX_PER_MM * zoom,
                top: guide.positionMm * PX_PER_MM * zoom,
                width: Math.max(1, (guide.endMm - guide.startMm) * PX_PER_MM * zoom),
              }}
        />
      ))}
    </>
  );
}

function paperGuideOverlayColor(snapActive: boolean): string {
  return snapActive ? 'rgba(34,197,94,0.82)' : 'rgba(217,70,239,0.48)';
}
