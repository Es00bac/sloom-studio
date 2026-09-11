import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Expand, Loader2, Maximize2, MoveDiagonal2 } from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useDockExpandToContent } from '../DockablePanel/dockExpandContext';
import { useSettingsStore } from '../../store/settingsStore';
import type {
  EditorTool,
  ImageColorProofIntent,
  ImageColorProofMode,
  ImageDocument,
  ImageLayer,
} from '../../types/imageEditor';
import {
  type CanvasResizeAnchor,
} from './ImageDocumentGeometry';
import {
  describeUniversalImageUpscaleProvider,
  upscaleImageDocumentUniversal,
  type UniversalImageUpscaleProvider,
} from './ImageUniversalUpscale';
import { describeUniversalImageUpscaleWorkflow } from '../../lib/universalImageUpscale';
import { getVertexProjectConfig } from '../../lib/vertexProviderSettings';
import { resolveVertexImageGenerator } from '../../lib/cloudImageUpscale';
import { isAndroidAcceleratorConfigured } from '../../lib/androidAccelerator';
import {
  isAndroidNativeImageUpscalerAvailable,
  runAndroidNativeImageUpscale,
} from '../../lib/androidNativeImageUpscaler';
import {
  isLocalCpuUpscalerConfigured,
  runLocalCpuUpscaler,
} from '../../lib/localCpuUpscaler';
import { clearSelection } from './selectionRegistry';
import { BrushPanel } from './ImageEditorBrushProperties';
import { CropPanel } from './ImageEditorCropProperties';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { MovePanel, SelectionPanel } from './ImageEditorSelectionMoveProperties';
import { getBitmapImageData } from './LayerBitmap';
import {
  buildImageHistogram,
  buildImageHistogramChannelReadoutDescriptor,
  summarizeHistogramBins,
  type ImageHistogram,
  type ImageHistogramChannel,
} from './ImageHistogram';
import {
  ComicMangaPanel,
  GradientPanel,
  PaintBucketPanel,
  PenPanel,
  ShapePanel,
  TextPanel,
} from './ImageEditorTextShapeProperties';
import { Slider } from './ImageEditorPropertyControls';
import {
  IMAGE_COLOR_PROOF_INTENTS,
  IMAGE_COLOR_PROOF_MODES,
  applyImageColorProofSetup,
  buildImageColorProofStatus,
  normalizeImageColorProofSetup,
} from './ImageColorProof';
import { ImageArtboardsPanel } from './ImageArtboardsPanel';
import { ImageFrameAnimationPanel } from './ImageFrameAnimationPanel';
import { ImageLiquifyWorkspacePanel } from './ImageLiquifyWorkspacePanel';
import { ImageMultiShotStackingPanel } from './ImageMultiShotStackingPanel';
import { imageDocumentHasPhysicalTiltmarkSurface } from './tiltmark/ImageTiltmarkLayer';
import { ImageCmykModePanel } from './cmyk/ImageCmykModePanel';
import { ImageCmykRefusalStatus } from './cmyk/ImageCmykRefusalStatus';
import { imageCmykDocumentUsesNativeAuthority } from './cmyk/ImageCmykDocument';

export function ImageEditorPropertiesPanel({
  documentPropertiesDefaultOpen = false,
}: {
  documentPropertiesDefaultOpen?: boolean;
} = {}) {
  const subscribedTool = useImageEditorStore((s) => s.tool);
  const tool = useImageEditorStore.getState().tool ?? subscribedTool;
  // `getState()` keeps static-render/test callers on the live Zustand snapshot while the
  // subscription still invalidates the mounted panel when a document opens or closes.
  const subscribedActiveDocId = useImageEditorStore((s) => s.activeDocId);
  const hasDocument = Boolean(
    useImageEditorStore.getState().getActiveDocument()
    ?? (subscribedActiveDocId
      ? useImageEditorStore.getState().documents.find((document) => document.id === subscribedActiveDocId)
      : undefined),
  );
  // When side-docked, expand to content so only the whole sidebar scrolls (no inner scroll region).
  const expandToContent = useDockExpandToContent();
  // Document-level properties (histogram, soft-proof, bit depth, artboards,
  // geometry, comic/manga) are collapsed by default so the panel leads with the
  // active tool's options instead of stacking every document section at once.
  const [documentPropsOpen, setDocumentPropsOpen] = useState(documentPropertiesDefaultOpen);

  return (
    <div className={`min-h-0 border-t border-cyan-300/10 bg-[#1a1b23] p-3 ${expandToContent ? '' : 'h-full overflow-y-auto'}`}>
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-cyan-100/35">Tool Options</div>
      <div className="mb-3 text-xs font-semibold text-cyan-100/70">
        {sectionTitle(tool)}
      </div>
      {renderForTool(tool)}
      {hasDocument ? <ImageLiquifyWorkspacePanel /> : null}
      {hasDocument ? <ImageCmykRefusalStatus /> : null}

      {hasDocument ? <div className="mt-3 border-t border-cyan-300/10 pt-2">
        <button
          aria-expanded={documentPropsOpen}
          className="flex w-full items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-cyan-100/35 hover:text-cyan-100/60"
          onClick={() => setDocumentPropsOpen((open) => !open)}
          type="button"
        >
          {documentPropsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Document Properties
        </button>
        {documentPropsOpen ? (
          <div className="mt-1">
            <DocumentHistogramPanel />
            <DocumentColorProofPanel />
            <ImageCmykModePanel />
            <DocumentSourceBitDepthPanel />
            <ImageArtboardsPanel />
            <ImageFrameAnimationPanel />
            <ImageMultiShotStackingPanel />
            <DocumentGeometryPanel />
            <ComicMangaPanel />
          </div>
        ) : null}
      </div> : (
        <div
          className="mt-3 rounded border border-dashed border-cyan-300/10 px-2 py-2 text-[11px] text-cyan-100/35"
          title="Create, open, or receive an image document to use document-level controls."
        >
          No document open
        </div>
      )}
    </div>
  );
}

function sectionTitle(tool: EditorTool): string {
  switch (tool) {
    case 'hand':
      return 'Hand';
    case 'brush':
      return 'Brush';
    case 'eraser':
      return 'Eraser';
    case 'backgroundEraser':
      return 'Background Eraser';
    case 'magicEraser':
      return 'Magic Eraser';
    case 'cloneStamp':
      return 'Clone Stamp';
    case 'spotHeal':
      return 'Spot Heal';
    case 'blurBrush':
      return 'Blur Brush';
    case 'sharpenBrush':
      return 'Sharpen Brush';
    case 'smudgeBrush':
      return 'Smudge Brush';
    case 'dodgeBrush':
      return 'Dodge Brush';
    case 'burnBrush':
      return 'Burn Brush';
    case 'spongeSaturateBrush':
      return 'Sponge Saturate';
    case 'spongeDesaturateBrush':
      return 'Sponge Desaturate';
    case 'paintBucket':
      return 'Paint Bucket';
    case 'gradientTool':
      return 'Gradient';
    case 'pen':
      return 'Pen';
    case 'rectShape':
      return 'Rectangle Shape';
    case 'ellipseShape':
      return 'Ellipse Shape';
    case 'marquee':
    case 'lasso':
    case 'magicWand':
      return 'Selection';
    case 'move':
      return 'Move';
    case 'crop':
      return 'Crop';
    case 'text':
      return 'Text';
    case 'eyedropper':
      return 'Eyedropper';
  }
}

function renderForTool(tool: EditorTool): React.ReactNode {
  switch (tool) {
    case 'hand':
      return (
        <p className="text-xs text-cyan-100/40">
          Drag the canvas to pan around the workspace without changing the image.
        </p>
      );
    case 'brush':
    case 'eraser':
    case 'cloneStamp':
    case 'spotHeal':
    case 'blurBrush':
    case 'sharpenBrush':
    case 'smudgeBrush':
    case 'dodgeBrush':
    case 'burnBrush':
    case 'spongeSaturateBrush':
    case 'spongeDesaturateBrush':
      return <BrushPanel />;
    case 'backgroundEraser':
      return <BackgroundEraserPanel />;
    case 'magicEraser':
      return <MagicEraserPanel />;
    case 'paintBucket':
      return <PaintBucketPanel />;
    case 'gradientTool':
      return <GradientPanel />;
    case 'pen':
      return <PenPanel />;
    case 'rectShape':
    case 'ellipseShape':
      return <ShapePanel />;
    case 'marquee':
    case 'lasso':
      return <SelectionPanel showShape />;
    case 'magicWand':
      return <SelectionPanel showTolerance />;
    case 'move':
      return <MovePanel />;
    case 'eyedropper':
      return <EyedropperPanel />;
    case 'crop':
      return <CropPanel />;
    case 'text':
      return <TextPanel />;
  }
}

function BackgroundEraserPanel() {
  const settings = useImageEditorStore((s) => s.selectionToolSettings);
  const set = useImageEditorStore((s) => s.setSelectionToolSettings);
  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <Slider
        label="Tolerance"
        value={settings.backgroundEraserTolerance ?? 32}
        max={255}
        min={0}
        step={1}
        onChange={(v) => set({ backgroundEraserTolerance: v })}
        format={(v) => `${Math.round(v)}`}
      />
      <div className="flex items-center gap-2">
        <input
          checked={settings.backgroundEraserContiguous ?? true}
          id="background-eraser-contiguous-matching"
          onChange={(event) => set({ backgroundEraserContiguous: event.target.checked })}
          type="checkbox"
        />
        <label htmlFor="background-eraser-contiguous-matching">Contiguous</label>
      </div>
      <label className="block space-y-1">
        <span>Sampling</span>
        <select
          aria-label="Background Eraser sampling"
          className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-cyan-100"
          onChange={(event) => set({ backgroundEraserSampling: event.target.value as 'once' | 'continuous' })}
          value={settings.backgroundEraserSampling ?? 'once'}
        >
          <option value="once">Once</option>
          <option value="continuous">Continuous</option>
        </select>
      </label>
      <div className="flex items-center gap-2">
        <input
          checked={settings.backgroundEraserUseBackgroundSwatch ?? false}
          id="background-eraser-use-background-swatch"
          onChange={(event) => set({ backgroundEraserUseBackgroundSwatch: event.target.checked })}
          type="checkbox"
        />
        <label htmlFor="background-eraser-use-background-swatch">Use Background Swatch</label>
      </div>
      <label className="block space-y-1">
        <span>Limits</span>
        <select
          aria-label="Background Eraser limits"
          className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-cyan-100"
          onChange={(event) => set({ backgroundEraserLimits: event.target.value as 'contiguous' | 'discontiguous' })}
          value={settings.backgroundEraserLimits ?? 'contiguous'}
        >
          <option value="contiguous">Contiguous</option>
          <option value="discontiguous">Discontiguous</option>
        </select>
      </label>
      <div className="flex items-center gap-2">
        <input
          checked={settings.backgroundEraserProtectForeground ?? false}
          id="background-eraser-protect-foreground"
          onChange={(event) => set({ backgroundEraserProtectForeground: event.target.checked })}
          type="checkbox"
        />
        <label htmlFor="background-eraser-protect-foreground">Protect Foreground</label>
      </div>
    </div>
  );
}

function MagicEraserPanel() {
  const settings = useImageEditorStore((s) => s.selectionToolSettings);
  const set = useImageEditorStore((s) => s.setSelectionToolSettings);
  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <Slider
        label="Tolerance"
        value={settings.magicWandTolerance}
        max={255}
        min={0}
        step={1}
        onChange={(v) => set({ magicWandTolerance: v })}
        format={(v) => `${Math.round(v)}`}
      />
      <div className="flex items-center gap-2">
        <input
          checked={settings.contiguous}
          id="magic-eraser-contiguous-matching"
          onChange={(event) => set({ contiguous: event.target.checked })}
          type="checkbox"
        />
        <label htmlFor="magic-eraser-contiguous-matching">Contiguous</label>
      </div>
    </div>
  );
}

function EyedropperPanel() {
  const color = useImageEditorStore((s) => s.brushSettings.color);
  return (
    <div className="space-y-2 text-xs text-cyan-100/50">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 rounded border border-cyan-300/20" style={{ backgroundColor: color }} />
        <span className="font-mono text-cyan-100/80">{color}</span>
      </div>
      <p>Click the canvas to sample the visible color. Alt-click samples only the active layer.</p>
    </div>
  );
}

export interface SelectedImageLayerPropertyDescriptor {
  documentId: string;
  documentTitle: string;
  selectedLayerId: string;
  selectedLayerName: string;
  layerIndex: number;
  typeSummary: {
    type: ImageLayer['type'];
    label: string;
    visible: boolean;
    locked: boolean;
    lockSummary: string;
    opacityPercent: number;
    blendMode: ImageLayer['blendMode'];
  };
  geometry: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotationDeg: number;
    skewXDeg: number;
    skewYDeg: number;
    perspectiveX: number;
    perspectiveY: number;
    transformOriginX: number;
    transformOriginY: number;
  };
  source: {
    documentSourceBinItemId: string | null;
    sourceLabel: string;
    sourceFormat: string;
    sourceMimeType: string;
    sourceLinkStatus: string;
    sourceLinkLabel: string;
    sourceLinkSize: string;
    relinkCount: number;
  };
  mask: {
    hasMask: boolean;
    editTarget: NonNullable<ImageDocument['activeLayerEditTarget']>;
    densityPercent: number;
    featherPx: number;
    size: string;
  };
  vector: {
    hasVectorData: boolean;
    shapeKind: string;
    hasSvgSource: boolean;
    recipeSignature: string;
  };
  text: {
    editable: boolean;
    contentPreview: string;
    fontFamily: string;
    fontSizePx: number;
    align: string;
    wrap: boolean;
    box: string;
  };
  effects: {
    total: number;
    enabled: number;
    kinds: string[];
  };
  unsupportedPropertyEditingCaveats: string[];
  preview: {
    label: string;
    boundsLabel: string;
    sourceLabel: string;
    signature: string;
  };
  signature: string;
}

export function buildSelectedImageLayerPropertyDescriptor(
  document: ImageDocument,
): SelectedImageLayerPropertyDescriptor | null {
  const layerIndex = document.layers.findIndex((layer) => layer.id === document.activeLayerId);
  if (layerIndex < 0) return null;

  const layer = document.layers[layerIndex];
  const width = getLayerWidth(layer);
  const height = getLayerHeight(layer);
  const typeSummary = {
    type: layer.type,
    label: getLayerTypeLabel(layer.type),
    visible: layer.visible,
    locked: layer.locked,
    lockSummary: summarizeLayerLocks(layer),
    opacityPercent: stableNumber(layer.opacity * 100),
    blendMode: layer.blendMode,
  };
  const geometry = {
    x: stableNumber(layer.x),
    y: stableNumber(layer.y),
    width: stableNumber(width),
    height: stableNumber(height),
    rotationDeg: stableNumber(layer.rotationDeg ?? 0),
    skewXDeg: stableNumber(layer.skewXDeg ?? 0),
    skewYDeg: stableNumber(layer.skewYDeg ?? 0),
    perspectiveX: stableNumber(layer.perspectiveX ?? 0),
    perspectiveY: stableNumber(layer.perspectiveY ?? 0),
    transformOriginX: stableNumber(layer.transformOriginX ?? 0.5),
    transformOriginY: stableNumber(layer.transformOriginY ?? 0.5),
  };
  const sourceFormat = layer.metadata?.sourceFormat ?? document.metadata?.sourceFormat ?? 'Sloom Studio layer';
  const sourceMimeType = layer.metadata?.sourceMimeType ?? document.metadata?.sourceMimeType ?? 'application/x-signal-loom-layer';
  const sourceLink = layer.metadata?.sourceLink;
  const source = {
    documentSourceBinItemId: document.sourceBinItemId ?? null,
    sourceLabel: layer.metadata?.sourceLabel ?? sourceLink?.label ?? document.title,
    sourceFormat,
    sourceMimeType,
    sourceLinkStatus: sourceLink?.status ?? 'embedded',
    sourceLinkLabel: sourceLink?.label ?? layer.metadata?.sourceLabel ?? 'Embedded layer',
    sourceLinkSize: sourceLink?.width && sourceLink.height ? `${sourceLink.width}x${sourceLink.height}` : 'unknown',
    relinkCount: sourceLink?.relinkHistory.length ?? 0,
  };
  const mask = {
    hasMask: Boolean(layer.mask),
    editTarget: document.activeLayerEditTarget ?? 'layer',
    densityPercent: stableNumber(layer.maskDensity ?? 100),
    featherPx: stableNumber(layer.maskFeather ?? 0),
    size: layer.mask ? `${layer.mask.width}x${layer.mask.height}` : 'none',
  };
  const vectorRecipe = layer.vectorRecipe ?? layer.metadata?.originalSvgSource ?? '';
  const vectorShapeKind = layer.metadata?.vectorShape?.kind ?? (layer.type === 'vector' ? 'vector' : 'none');
  const vector = {
    hasVectorData: Boolean(layer.metadata?.vectorShape || vectorRecipe),
    shapeKind: vectorShapeKind,
    hasSvgSource: Boolean(vectorRecipe),
    recipeSignature: vectorRecipe ? buildStableTextSignature('svg', vectorRecipe) : 'none',
  };
  const text = {
    editable: Boolean(layer.text && (layer.metadata?.editableText ?? layer.type === 'text')),
    contentPreview: layer.text ? truncateDescriptorText(layer.text.content, 48) : '',
    fontFamily: layer.text?.fontFamily ?? '',
    fontSizePx: stableNumber(layer.text?.fontSize ?? 0),
    align: layer.text?.align ?? 'none',
    wrap: Boolean(layer.text?.wrap),
    box: layer.text ? `${layer.text.boxWidth ?? 'auto'}x${layer.text.boxHeight ?? 'auto'}` : 'none',
  };
  const effectKinds = (layer.effects ?? []).map((effect) => effect.kind);
  const effects = {
    total: effectKinds.length,
    enabled: (layer.effects ?? []).filter((effect) => effect.enabled).length,
    kinds: effectKinds,
  };
  const unsupportedPropertyEditingCaveats = buildUnsupportedLayerPropertyEditingCaveats(document, layer);
  const signature = [
    document.id,
    layer.id,
    layer.type,
    `${geometry.x},${geometry.y},${geometry.width},${geometry.height}`,
    `rot:${geometry.rotationDeg}`,
    `skew:${geometry.skewXDeg},${geometry.skewYDeg}`,
    `persp:${geometry.perspectiveX},${geometry.perspectiveY}`,
    `origin:${geometry.transformOriginX},${geometry.transformOriginY}`,
    `vis:${layer.visible ? 1 : 0}`,
    `lock:${layer.locked ? 1 : 0}`,
    `locks:${typeSummary.lockSummary}`,
    `op:${typeSummary.opacityPercent}`,
    `blend:${layer.blendMode}`,
    `mask:${mask.hasMask ? 1 : 0}:${mask.densityPercent}:${mask.featherPx}`,
    `src:${source.sourceFormat}:${source.sourceMimeType}:${source.sourceLinkStatus}`,
    `vec:${vector.shapeKind}:${vector.recipeSignature}`,
    `text:${text.fontFamily}:${text.fontSizePx}:${text.align}:${text.wrap ? 'wrap' : 'nowrap'}:${layer.text?.content.length ?? 0}`,
    `fx:${effects.kinds.join(',')}:${effects.enabled}/${effects.total}`,
    `v:${layer.bitmapVersion}`,
  ].join('|');

  return {
    documentId: document.id,
    documentTitle: document.title,
    selectedLayerId: layer.id,
    selectedLayerName: layer.name,
    layerIndex,
    typeSummary,
    geometry,
    source,
    mask,
    vector,
    text,
    effects,
    unsupportedPropertyEditingCaveats,
    preview: {
      label: `${layer.name} · ${typeSummary.label}`,
      boundsLabel: `${geometry.width}x${geometry.height} at ${geometry.x},${geometry.y}`,
      sourceLabel: source.sourceLabel,
      signature,
    },
    signature,
  };
}

function getLayerWidth(layer: ImageLayer): number {
  return layer.bitmap?.width ?? layer.text?.boxWidth ?? layer.metadata?.vectorShape?.width ?? 0;
}

function getLayerHeight(layer: ImageLayer): number {
  return layer.bitmap?.height ?? layer.text?.boxHeight ?? layer.metadata?.vectorShape?.height ?? 0;
}

function getLayerTypeLabel(type: ImageLayer['type']): string {
  switch (type) {
    case 'image':
      return 'Image layer';
    case 'mask':
      return 'Mask layer';
    case 'text':
      return 'Text layer';
    case 'adjustment':
      return 'Adjustment layer';
    case 'vector':
      return 'Vector layer';
    case 'group':
      return 'Layer group';
  }
}

function summarizeLayerLocks(layer: ImageLayer): string {
  const lockParts: string[] = [];
  if (layer.locked) lockParts.push('layer');
  if (layer.locks?.pixels) lockParts.push('pixels');
  if (layer.locks?.position) lockParts.push('position');
  return lockParts.length > 0 ? lockParts.join('+') : 'none';
}

function buildUnsupportedLayerPropertyEditingCaveats(document: ImageDocument, layer: ImageLayer): string[] {
  const caveats = new Set<string>();
  const sourceFormat = layer.metadata?.sourceFormat ?? document.metadata?.sourceFormat;
  if (sourceFormat && sourceFormat.toUpperCase() !== 'SIGNAL LOOM') {
    caveats.add(`${sourceFormat.toUpperCase()} source properties are metadata-only after import.`);
  }
  for (const warning of layer.metadata?.sourceWarnings ?? []) {
    if (warning) caveats.add(warning);
  }
  for (const warning of document.metadata?.warnings ?? []) {
    if (warning) caveats.add(warning);
  }
  if ((layer.effects ?? []).length > 0) {
    caveats.add('Native effect parameter editing is limited to Sloom Studio effect controls.');
  }
  if (layer.metadata?.vectorShape || layer.vectorRecipe || layer.metadata?.originalSvgSource) {
    caveats.add('Vector path editing is available only for retained Sloom Studio vector geometry.');
  }
  if (layer.metadata?.sourceLink?.status === 'missing') {
    caveats.add('Missing linked source must be relinked before source-backed edits can be refreshed.');
  }
  return [...caveats];
}

function truncateDescriptorText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function buildStableTextSignature(prefix: string, value: string): string {
  let checksum = 0;
  for (let index = 0; index < value.length; index += 1) {
    checksum += (index + 1) * value.charCodeAt(index);
  }
  return `${prefix}:${value.length}:${checksum}`;
}

function stableNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(3));
}

function DocumentHistogramPanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((document) => document.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((document) => document.id === stateSnapshot.activeDocId)
    ?? null;
  const histogramResult = useMemo<{ histogram: ImageHistogram | null; error: string | null }>(() => {
    if (!activeDoc) return { histogram: null, error: null };
    try {
      const bitmap = renderImageDocumentLayersToBitmap(activeDoc);
      return {
        histogram: buildImageHistogram(getBitmapImageData(bitmap)),
        error: null,
      };
    } catch (error) {
      return {
        histogram: null,
        error: error instanceof Error ? error.message : 'Histogram unavailable.',
      };
    }
  }, [activeDoc]);

  if (!activeDoc) return null;
  if (histogramResult.error) {
    return (
      <div className="mt-3 rounded border border-amber-300/10 bg-[#10131b] p-2 text-xs text-amber-100/55">
        Histogram unavailable: {histogramResult.error}
      </div>
    );
  }
  if (!histogramResult.histogram) return null;
  return <HistogramSummary histogram={histogramResult.histogram} />;
}

function HistogramSummary({ histogram }: { histogram: ImageHistogram }) {
  const [channel, setChannel] = useState<ImageHistogramChannel>('luminance');
  const readout = buildImageHistogramChannelReadoutDescriptor({
    histogram,
    channel,
  });
  const bins = summarizeHistogramBins(histogram.channels[channel], 48);
  const maxBin = Math.max(1, ...bins);
  const rangeLabel = readout.rangeLabel;
  const meanLabel = readout.meanLabel;

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.14em] text-cyan-100/50">Histogram</span>
        <select
          aria-label="Histogram channel"
          className="h-6 min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-1.5 font-mono text-[10px] text-cyan-100/75"
          onChange={(event) => setChannel(event.target.value as ImageHistogramChannel)}
          value={channel}
        >
          {HISTOGRAM_CHANNELS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div
        aria-label={`Document ${getHistogramChannelLabel(channel)} histogram`}
        className="flex h-12 items-end gap-px rounded border border-cyan-300/10 bg-[#070a10] px-1 py-1"
      >
        {bins.map((value, index) => (
          <span
            aria-hidden="true"
            className={`block flex-1 rounded-sm ${getHistogramBarClass(channel)}`}
            key={index}
            style={{ height: `${Math.max(2, Math.round((value / maxBin) * 40))}px` }}
            title={`${value} pixels`}
          />
        ))}
      </div>
        <div className="grid grid-cols-3 gap-1 text-[10px] text-cyan-100/45">
          <span>Mean <b className="font-mono text-cyan-100/70">{meanLabel}</b></span>
          <span>Range <b className="font-mono text-cyan-100/70">{rangeLabel}</b></span>
          <span>Pixels <b className="font-mono text-cyan-100/70">{readout.sampleCount}</b></span>
        </div>
      <div className="grid grid-cols-2 gap-1 text-[10px] text-cyan-100/45">
        <span>Shadow Clip <b className="font-mono text-cyan-100/70">{readout.clippedShadows}</b></span>
        <span>Highlight Clip <b className="font-mono text-cyan-100/70">{readout.clippedHighlights}</b></span>
      </div>
      {readout.caveats.length > 0 ? (
        <div className="text-[10px] text-amber-100/60">
          {readout.caveats.join(' ')}
        </div>
      ) : null}
      {histogram.transparentPixels > 0 ? (
        <div className="text-[10px] text-cyan-100/35">
          {channel === 'alpha'
            ? `Alpha includes transparent pixels: ${histogram.transparentPixels}`
            : `Transparent pixels ignored for tone: ${histogram.transparentPixels}`}
        </div>
      ) : null}
    </div>
  );
}

const HISTOGRAM_CHANNELS: Array<{ value: ImageHistogramChannel; label: string }> = [
  { value: 'luminance', label: 'Lum' },
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'alpha', label: 'Alpha (non-tonal)' },
];

function getHistogramChannelLabel(channel: ImageHistogramChannel): string {
  return HISTOGRAM_CHANNELS.find((item) => item.value === channel)?.label ?? channel;
}

function getHistogramBarClass(channel: ImageHistogramChannel): string {
  switch (channel) {
    case 'red':
      return 'bg-red-400/75';
    case 'green':
      return 'bg-emerald-400/75';
    case 'blue':
      return 'bg-sky-400/75';
    case 'alpha':
      return 'bg-cyan-50/70';
    case 'luminance':
      return 'bg-cyan-300/70';
  }
}

function DocumentColorProofPanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((document) => document.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((document) => document.id === stateSnapshot.activeDocId)
    ?? null;

  if (!activeDoc) return null;

  const setup = normalizeImageColorProofSetup(activeDoc.metadata?.colorProof);
  const status = buildImageColorProofStatus(activeDoc);
  const intentOptions = getProofIntentOptions(setup.mode);

  const updateProofSetup = (patch: Partial<ReturnType<typeof normalizeImageColorProofSetup>>) => {
    updateDocumentColorProof(activeDoc.id, {
      ...setup,
      ...patch,
    });
  };

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.14em] text-cyan-100/50">Color Proof</span>
        <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 font-mono text-[10px] text-cyan-100/60">
          {status.nativeWorkingSpace}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Mode</span>
          <select
            aria-label="Image color proof mode"
            className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
            onChange={(event) => updateProofSetup({ mode: event.target.value as ImageColorProofMode })}
            value={setup.mode}
          >
            {IMAGE_COLOR_PROOF_MODES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Intent</span>
          <select
            aria-label="Image proof intent"
            className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
            onChange={(event) => updateProofSetup({ intent: event.target.value as ImageColorProofIntent })}
            value={setup.intent}
          >
            {intentOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        {setup.mode === 'cmyk-soft-proof' ? (
          <label className="space-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/35">Profile Label</span>
            <input
              aria-label="CMYK proof profile label"
              className="w-full min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
              onChange={(event) => updateProofSetup({ profileLabel: event.target.value })}
              placeholder="Generic CMYK proof"
              type="text"
              value={setup.profileLabel ?? ''}
            />
          </label>
        ) : null}
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[11px] leading-4 text-cyan-100/55">
        <div className="font-semibold text-cyan-100/75">{status.modeLabel}</div>
        <div>Proof intent: {status.proofLabel}</div>
        {status.profileLabel ? <div>Profile: {status.profileLabel}</div> : null}
        <div>Native CMYK export: {activeDoc.metadata?.colorMode === 'cmyk' ? 'DeviceCMYK TIFF available' : 'Not available in this RGB document; use the native CMYK mode panel'}</div>
      </div>
      <ul className="space-y-1 text-[11px] leading-4 text-amber-100/65">
        {status.warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

function getProofIntentOptions(mode: ImageColorProofMode) {
  if (mode === 'rgb') return IMAGE_COLOR_PROOF_INTENTS.filter((item) => item.value === 'screen-rgb');
  if (mode === 'grayscale-soft-proof') {
    return IMAGE_COLOR_PROOF_INTENTS.filter((item) => item.value === 'grayscale-luminance');
  }
  return IMAGE_COLOR_PROOF_INTENTS.filter((item) => (
    item.value === 'relative-colorimetric' || item.value === 'perceptual'
  ));
}

function updateDocumentColorProof(docId: string, setup: Partial<ReturnType<typeof normalizeImageColorProofSetup>>) {
  useImageEditorStore.setState((state) => {
    let changed = false;
    const documents = state.documents.map((document: ImageDocument) => {
      if (document.id !== docId) return document;
      const nextDocument = applyImageColorProofSetup(document, setup);
      if (nextDocument !== document) changed = true;
      return nextDocument;
    });
    return changed ? { documents } : state;
  });
}

function DocumentSourceBitDepthPanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((document) => document.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((document) => document.id === stateSnapshot.activeDocId)
    ?? null;

  if (!activeDoc) return null;

  const sourceFormat = activeDoc.metadata?.sourceFormat ?? 'Untitled raster';
  const sourceMimeType = activeDoc.metadata?.sourceMimeType ?? 'application/x-signal-loom-image';
  const sourceBitDepth = activeDoc.metadata?.sourceBitDepth ?? 8;
  const sourceIsHighBit = sourceBitDepth === 16 || sourceBitDepth === 32;
  const workingBitDepth = activeDoc.metadata?.bitDepth ?? 8;
  const hasNativeHighBitAuthority = workingBitDepth === 16 || workingBitDepth === 32;
  const workingDepthLabel = hasNativeHighBitAuthority
    ? `${workingBitDepth}-bit/channel native ${workingBitDepth === 32 ? 'float' : 'integer'} RGBA authority`
    : '8-bit RGBA browser raster';
  const warnings = getDocumentSourceWarnings(activeDoc);

  return (
    <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-[0.14em] text-cyan-100/50">Source / Bit Depth</span>
        <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 font-mono text-[10px] text-cyan-100/60">
          {hasNativeHighBitAuthority ? `${workingBitDepth}-bit RGBA authority` : '8-bit RGBA'}
        </span>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[11px] leading-4 text-cyan-100/55">
        <div>Source: <span className="font-mono text-cyan-100/75">{sourceFormat}</span></div>
        <div>MIME: <span className="font-mono text-cyan-100/75">{sourceMimeType}</span></div>
        <div>Source depth: <span className="font-mono text-cyan-100/75">{sourceBitDepth}-bit/channel provenance</span></div>
        <div>Working depth: <span className="font-mono text-cyan-100/75">{workingDepthLabel}</span></div>
      </div>
      <ul className="space-y-1 text-[11px] leading-4 text-amber-100/65">
        <li>
          {hasNativeHighBitAuthority
            ? `${workingBitDepth}-bit source precision is retained in the native document authority; the visible preview is a derived 8-bit proxy.`
            : sourceIsHighBit
              ? `${sourceBitDepth}-bit source precision is retained as provenance only; preview, edits, and visible exports use the 8-bit RGBA working derivative.`
            : '8-bit/channel data is preserved in the 8-bit RGBA working pipeline.'}
        </li>
        {hasNativeHighBitAuthority ? (
          <li>
            Native export: {workingBitDepth === 16 ? 'PNG16 or TIFF16' : 'TIFF32f or OpenEXR'} from authority; unsupported layouts and depth conversions refuse before export.
          </li>
        ) : null}
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

function getDocumentSourceWarnings(document: ImageDocument): string[] {
  const warnings = new Set<string>();
  for (const warning of document.metadata?.warnings ?? []) {
    if (warning) warnings.add(warning);
  }
  for (const layer of document.layers) {
    for (const warning of layer.metadata?.sourceWarnings ?? []) {
      if (warning) warnings.add(warning);
    }
  }
  return [...warnings];
}

function DocumentGeometryPanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((document) => document.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((document) => document.id === stateSnapshot.activeDocId)
    ?? null;
  const resizeDocumentPixels = useImageEditorStore((s) => s.resizeDocumentPixels);
  const resizeDocumentCanvas = useImageEditorStore((s) => s.resizeDocumentCanvas);
  const subscribedProviderSettings = useSettingsStore((s) => s.providerSettings);
  const providerSettingsSnapshot = useSettingsStore.getState().providerSettings;
  const providerSettings = isAndroidAcceleratorConfigured(providerSettingsSnapshot)
    ? providerSettingsSnapshot
    : subscribedProviderSettings;
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const [imageDraft, setImageDraft] = useState<{ docId: string; width: number; height: number } | null>(null);
  const [canvasDraft, setCanvasDraft] = useState<{ docId: string; width: number; height: number } | null>(null);
  const [anchor, setAnchor] = useState<CanvasResizeAnchor>('center');
  const [upscaleStatus, setUpscaleStatus] = useState<string | null>(null);
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [selectedUpscaler, setSelectedUpscaler] = useState<'auto' | UniversalImageUpscaleProvider>('auto');

  if (!activeDoc) return null;
  const imageWidth = imageDraft?.docId === activeDoc.id ? imageDraft.width : activeDoc.width;
  const imageHeight = imageDraft?.docId === activeDoc.id ? imageDraft.height : activeDoc.height;
  const canvasWidth = canvasDraft?.docId === activeDoc.id ? canvasDraft.width : activeDoc.width;
  const canvasHeight = canvasDraft?.docId === activeDoc.id ? canvasDraft.height : activeDoc.height;
  const hasPhysicalTiltmarkSurface = imageDocumentHasPhysicalTiltmarkSurface(activeDoc);

  const setImageWidth = (width: number) => setImageDraft({ docId: activeDoc.id, width, height: imageHeight });
  const setImageHeight = (height: number) => setImageDraft({ docId: activeDoc.id, width: imageWidth, height });
  const setCanvasWidth = (width: number) => setCanvasDraft({ docId: activeDoc.id, width, height: canvasHeight });
  const setCanvasHeight = (height: number) => setCanvasDraft({ docId: activeDoc.id, width: canvasWidth, height });

  const applyImageSize = () => {
    if (hasPhysicalTiltmarkSurface) {
      setUpscaleStatus('Convert editable Tiltmark surfaces to Raster before resizing document pixels.');
      return;
    }
    resizeDocumentPixels(activeDoc.id, imageWidth, imageHeight);
    setImageDraft(null);
  };

  const applyCanvasSize = () => {
    resizeDocumentCanvas(activeDoc.id, canvasWidth, canvasHeight, anchor);
    setCanvasDraft(null);
  };

  const isLocalCpuConfigured = isLocalCpuUpscalerConfigured(providerSettings);
  const isAndroidConfigured = isAndroidAcceleratorConfigured(providerSettings);
  const isAndroidNativeConfigured = !isAndroidConfigured && isAndroidNativeImageUpscalerAvailable();
  const autoUpscaleProvider = isAndroidConfigured
    ? 'android-accelerator'
    : isAndroidNativeConfigured
      ? 'android-native'
      : isLocalCpuConfigured
        ? 'local-ai-cpu'
        : 'browser';
  const hasStabilityKey = Boolean(apiKeys.stability?.trim());
  const hasAtlasKey = Boolean(apiKeys.atlas?.trim());
  const isVertexUpscaleConfigured = Boolean(getVertexProjectConfig(providerSettings).projectId)
    && Boolean(resolveVertexImageGenerator(providerSettings));
  const cloudUpscaleOptions: UniversalImageUpscaleProvider[] = [
    ...(hasStabilityKey ? (['stability-fast', 'stability-conservative'] as const) : []),
    ...(isVertexUpscaleConfigured ? (['vertex-imagen'] as const) : []),
    ...(hasAtlasKey ? (['atlas-image-upscaler'] as const) : []),
  ];
  // Selecting a cloud option that later loses its key falls back to Auto so we never claim a paid route is ready.
  const effectiveUpscaler: 'auto' | UniversalImageUpscaleProvider =
    selectedUpscaler !== 'auto' && cloudUpscaleOptions.includes(selectedUpscaler) ? selectedUpscaler : 'auto';
  const isCloudUpscaleSelected = effectiveUpscaler !== 'auto';
  const upscaleProvider = isCloudUpscaleSelected ? effectiveUpscaler : autoUpscaleProvider;
  const upscaleProviderLabel = describeUniversalImageUpscaleProvider(upscaleProvider);
  const cloudUpscaleWorkflow = isCloudUpscaleSelected
    ? describeUniversalImageUpscaleWorkflow(effectiveUpscaler)
    : null;

  const upscale2x = () => {
    if (imageCmykDocumentUsesNativeAuthority(activeDoc)) {
      const disclosure = 'Upscale 2x is refused for native CMYK until CMYKA-native resampling is implemented; no ink authority changed.';
      setUpscaleStatus(disclosure);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
          detail: { tool: 'upscale2x', disclosure },
        }));
      }
      return;
    }
    if (hasPhysicalTiltmarkSurface) {
      setUpscaleStatus('Convert editable Tiltmark surfaces to Raster before upscaling the document.');
      return;
    }
    setUpscaleBusy(true);
    setUpscaleStatus(`${upscaleProviderLabel}: preparing 2x upscale...`);
    void upscaleImageDocumentUniversal({
      doc: activeDoc,
      providerSettings,
      apiKeys,
      scalePercent: 200,
      outputFormat: 'png',
      ...(isCloudUpscaleSelected ? { provider: effectiveUpscaler } : {}),
      localAiCpuUpscale: isLocalCpuConfigured
        ? async (input) => runLocalCpuUpscaler({
          ...input,
          outputFormat: 'png',
          model: providerSettings.localAiCpuModel,
        })
        : undefined,
      androidNativeUpscale: isAndroidNativeConfigured ? runAndroidNativeImageUpscale : undefined,
      isAndroidNativeUpscalerAvailable: isAndroidNativeConfigured,
    }).then((result) => {
      useImageEditorStore.setState((state) => {
        if (!state.documents.some((document) => document.id === activeDoc.id)) {
          return state;
        }

        return {
          documents: state.documents.map((document) => (
            document.id === activeDoc.id ? result.document : document
          )),
        };
      });
      if (result.document.hasSelection === false) {
        clearSelection(activeDoc.id);
      }
      useImageEditorStore.getState().pushOperation({
        kind: 'documentState',
        docId: activeDoc.id,
        before: activeDoc,
        after: result.document,
      });
      setImageDraft(null);
      setCanvasDraft(null);
      setUpscaleStatus(result.statusMessage);
    }).catch((error) => {
      setUpscaleStatus(error instanceof Error ? error.message : 'Image upscale failed.');
    }).finally(() => {
      setUpscaleBusy(false);
    });
  };

  return (
    <div className="mt-3 space-y-3 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">
          Document
        </div>
        <div className="font-mono text-[11px] text-cyan-100/40">
          {activeDoc.width} x {activeDoc.height}
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold text-cyan-100/75">Image Size</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="W" min={1} onChange={setImageWidth} value={imageWidth} />
          <NumberField label="H" min={1} onChange={setImageHeight} value={imageHeight} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="flex items-center justify-center gap-1 rounded border border-cyan-300/15 bg-[#1b2230] px-2 py-1 font-semibold text-cyan-50 hover:border-cyan-300/40"
            onClick={applyImageSize}
            disabled={upscaleBusy || hasPhysicalTiltmarkSurface}
            title={hasPhysicalTiltmarkSurface
              ? 'Convert editable Tiltmark surfaces to Raster before resizing document pixels.'
              : undefined}
            type="button"
          >
            <Maximize2 size={12} />
            Resize Image
          </button>
          <button
            className="flex items-center justify-center gap-1 rounded border border-cyan-300/15 bg-[#1b2230] px-2 py-1 font-semibold text-cyan-50 hover:border-cyan-300/40"
            disabled={upscaleBusy || hasPhysicalTiltmarkSurface}
            onClick={upscale2x}
            title={hasPhysicalTiltmarkSurface
              ? 'Convert editable Tiltmark surfaces to Raster before upscaling.'
              : undefined}
            type="button"
          >
            {upscaleBusy ? <Loader2 className="animate-spin" size={12} /> : <MoveDiagonal2 size={12} />}
            Upscale 2x
          </button>
        </div>
        {hasPhysicalTiltmarkSurface ? (
          <div className="rounded border border-fuchsia-300/20 bg-fuchsia-500/5 px-2 py-1.5 text-[11px] leading-4 text-fuchsia-100/70">
            Pixel resize and upscale are paused while this document contains a physical Tiltmark surface.
            Convert that surface to Raster first. Canvas Size remains non-destructive and available.
          </div>
        ) : null}
          <div className="rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[11px] leading-4 text-cyan-100/55">
          <select
            aria-label="Upscaler"
            className="mb-1.5 w-full rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80 disabled:opacity-60"
            disabled={upscaleBusy}
            onChange={(event) => setSelectedUpscaler(event.target.value as 'auto' | UniversalImageUpscaleProvider)}
            value={effectiveUpscaler}
          >
            <option value="auto">Auto (on-device / local · free)</option>
            {cloudUpscaleOptions.map((cloudProvider) => {
              const workflow = describeUniversalImageUpscaleWorkflow(cloudProvider);
              return (
                <option key={cloudProvider} value={cloudProvider}>
                  {`${workflow.methodLabel} · ${workflow.costLabel} (paid)`}
                </option>
              );
            })}
          </select>
          <div className="font-semibold text-cyan-100/75">{upscaleProviderLabel}</div>
          {isCloudUpscaleSelected && cloudUpscaleWorkflow ? (
            <div className="text-amber-200/80">
              Paid cloud upscaler · provider cost {cloudUpscaleWorkflow.costLabel} per image, billed to your{' '}
              {effectiveUpscaler === 'vertex-imagen'
                ? 'Google Cloud project'
                : effectiveUpscaler === 'atlas-image-upscaler'
                  ? 'Atlas Cloud account'
                  : 'Stability AI account'}.
            </div>
          ) : upscaleProvider === 'android-accelerator' ? (
            <div>Upscaler: {providerSettings.androidAcceleratorDefaultUpscaler ?? 'upscaler_realistic'} · provider cost $0.00</div>
          ) : upscaleProvider === 'android-native' ? (
            <div>Runs inside the Android app with provider cost $0.00.</div>
          ) : upscaleProvider === 'local-ai-cpu' ? (
            <div>Model: {providerSettings.localAiCpuModel ?? 'realesrgan-4x'} · provider cost $0.00</div>
          ) : (
            <div>Phone upscaler is not configured; using local resize with provider cost $0.00.</div>
          )}
          {upscaleStatus ? <div className="mt-1 text-cyan-50">{upscaleStatus}</div> : null}
        </div>
      </div>

      <div className="space-y-2">
        <div className="font-semibold text-cyan-100/75">Canvas Size</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="W" min={1} onChange={setCanvasWidth} value={canvasWidth} />
          <NumberField label="H" min={1} onChange={setCanvasHeight} value={canvasHeight} />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-cyan-100/80"
            onChange={(event) => setAnchor(event.target.value as CanvasResizeAnchor)}
            value={anchor}
          >
            {CANVAS_ANCHORS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            aria-label="Resize canvas"
            className="flex h-7 w-8 items-center justify-center rounded border border-cyan-300/15 bg-[#1b2230] text-cyan-50 hover:border-cyan-300/40"
            onClick={applyCanvasSize}
            title="Resize canvas"
            type="button"
          >
            <Expand size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

const CANVAS_ANCHORS: Array<{ value: CanvasResizeAnchor; label: string }> = [
  { value: 'center', label: 'Anchor Center' },
  { value: 'top-left', label: 'Anchor Top Left' },
  { value: 'top', label: 'Anchor Top' },
  { value: 'top-right', label: 'Anchor Top Right' },
  { value: 'left', label: 'Anchor Left' },
  { value: 'right', label: 'Anchor Right' },
  { value: 'bottom-left', label: 'Anchor Bottom Left' },
  { value: 'bottom', label: 'Anchor Bottom' },
  { value: 'bottom-right', label: 'Anchor Bottom Right' },
];

function NumberField(props: {
  label: string;
  min: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1.5rem_1fr] items-center gap-1">
      <span className="text-[11px] font-semibold text-cyan-100/45">{props.label}</span>
      <input
        className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 font-mono text-cyan-50"
        min={props.min}
        onChange={(event) => props.onChange(Number(event.target.value))}
        type="number"
        value={props.value}
      />
    </label>
  );
}
