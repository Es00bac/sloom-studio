import type {
  BrushEraserChannel,
  BrushEraserRouteDescriptor,
  BrushEraserToolDescriptor,
  BrushEraserToolWarning,
  BrushEraserWorkflowDescriptor,
  BrushEraserWorkflowRoute,
  BackgroundEraserToolDescriptor,
  MagicEraserToolDescriptor,
  Point,
  ToolEnv,
  ToolHandler,
  UnsupportedBackgroundEraserRouteDescriptor,
  UnsupportedMagicEraserRouteDescriptor,
} from './types';
import type { BrushSettings, ImageLayer } from '../../../types/imageEditor';
import { canEditImageLayerPixels } from '../../../lib/imageLayerLocks';
import { recordStrokePaint } from '../imageStrokePerf';
import { cloneBitmap, createBitmap, getBitmapImageData, putBitmapImageData } from '../LayerBitmap';
import {
  paintLayerMaskDabs,
  resolveLayerMaskBrushTargetValue,
} from '../ImageLayerMask';
import { getSelection, setSelection } from '../selectionRegistry';
import {
  isMaskEmpty,
  maskToCanvas,
  toSnapshot,
  createMask,
  cloneMask,
  setFloodFill,
  type SelectionMask,
} from '../SelectionMask';
import {
  buildBrushDabs,
  buildBrushStrokePreviewMetadata,
  buildSymmetryBrushDabs,
  getUnsupportedBrushCapabilityWarnings,
  normalizeBrushSettings,
  paintBrushDab,
  readBrushPressure,
  readBrushTiltState,
  resolveBrushDabColor,
  smoothBrushPoint,
} from '../ImageBrushEngine';
import { paintPixelBuffer, executeHighBitTool } from '../pixels/highBitTools';
import {
  paintQuickMaskDabs,
  resolveQuickMaskBrushTargetValue,
} from '../ImageQuickMask';
import { getImageChannelEditTarget } from '../ImageSelectionChannels';
import { paintMixerDabs } from './brushMixerPaint';
import type { MixerColor } from '../ImageBrushMixer';
import { brushStraightLineStart, recordBrushStrokeAnchor } from './brushLineAnchor';
import {
  applyTiltmarkLayerSubstrateDabs,
  checkpointTiltmarkLayerSubstrate,
  createTiltmarkStrokeSession,
  isTiltmarkRuntimeReady,
  releaseTiltmarkLayerSubstrate,
  renderTiltmarkLayerSubstrate,
  type TiltmarkStrokeSession,
} from '../tiltmark/TiltmarkRuntime';
import {
  endTiltmarkWetInputActivity,
  noteTiltmarkWetInputActivity,
  requestTiltmarkWetSnapshot,
} from '../tiltmark/TiltmarkWetEvolution';
import { composeTiltmarkSurfacePreview } from '../tiltmark/TiltmarkSurfacePreview';
import {
  buildTiltmarkSymmetryDabs,
  EMPTY_TILTMARK_MIXER_STATE,
  renderTiltmarkDabs,
  rasterizeTiltmarkDabCoverage,
  resolveTiltmarkRasterInteractions,
  tiltmarkDabsBitmapRect,
  tiltmarkDabsDocumentRect,
  type TiltmarkCoverageRaster,
  type TiltmarkMixerState,
} from '../tiltmark/TiltmarkRenderer';
import type { TiltmarkBrushDab } from '../tiltmark/TiltmarkTypes';
import {
  createImageTiltmarkLayerSet,
  isImageTiltmarkGroup,
  isImageTiltmarkSurface,
} from '../tiltmark/ImageTiltmarkLayer';

interface BitmapStrokeState {
  quickMask: false;
  paintTarget: 'layer';
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  lastPoint: Point;
  isEraser: boolean;
  dabIndex: number;
  seed: number;
  lastTime: number;
  /** Running colour-smudge / mixer state, carried across stroke segments (mixer mode only). */
  mixerState: MixerColor;
  tiltmarkMixerState: TiltmarkMixerState;
  tiltmarkSession?: TiltmarkStrokeSession;
  createdLayerSetBefore?: ImageLayer[];
  createdActiveLayerIdBefore?: string | null;
  tiltmarkLayerBefore?: {
    base: OffscreenCanvas | null;
    simulationData?: string | null;
    metadata?: ImageLayer['metadata'];
  };
}

interface LayerMaskStrokeState {
  quickMask: false;
  paintTarget: 'mask';
  layerId: string;
  maskBefore: OffscreenCanvas;
  lastPoint: Point;
  isEraser: boolean;
  dabIndex: number;
  seed: number;
  lastTime: number;
  tiltmarkSession?: TiltmarkStrokeSession;
}

interface QuickMaskStrokeState {
  quickMask: true;
  selectionBefore: SelectionMask;
  lastPoint: Point;
  isEraser: boolean;
  dabIndex: number;
  seed: number;
  lastTime: number;
  tiltmarkSession?: TiltmarkStrokeSession;
}

type StrokeState = BitmapStrokeState | LayerMaskStrokeState | QuickMaskStrokeState;

let stroke: StrokeState | null = null;

interface HighBitStrokeState {
  layerId: string;
  before: NonNullable<ImageLayer['pixels']>;
  points: Point[];
  isEraser: boolean;
}

/** Native-depth brush strokes are collected separately from the legacy canvas stroke union. */
let highBitStroke: HighBitStrokeState | null = null;

// Identity-memoized brush-settings normalization. `env.brushSettings` is a stable object across a
// stroke (the Zustand store replaces it only when the user changes a setting), so normalizing once
// and reusing it avoids ~40-field validation + an object allocation on every pointer-move. The
// returned object is only read by the paint paths below, never mutated, so sharing it is safe; a
// mid-stroke change (e.g. `[`/`]` resize) swaps the object identity and triggers a recompute.
let memoRawBrushSettings: BrushSettings | undefined;
let memoNormalizedBrushSettings: ReturnType<typeof normalizeBrushSettings> | null = null;
function normalizedBrushSettings(raw: BrushSettings): ReturnType<typeof normalizeBrushSettings> {
  if (raw !== memoRawBrushSettings || !memoNormalizedBrushSettings) {
    memoNormalizedBrushSettings = normalizeBrushSettings(raw);
    memoRawBrushSettings = raw;
  }
  return memoNormalizedBrushSettings;
}

interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface BackgroundEraserStrokeState {
  layerId: string;
  bitmapBefore: OffscreenCanvas;
  lastPoint: Point;
  dabIndex: number;
  seed: number;
  sampleColor: RgbaColor | null;
  erasedPixels: number;
}

let backgroundEraserStroke: BackgroundEraserStrokeState | null = null;

interface DescribeBrushAndEraserToolWorkflowOptions {
  activeRoute?: BrushEraserWorkflowRoute;
  channel?: BrushEraserChannel;
  quickMaskEnabled?: boolean;
  previewFrom?: Point;
  previewTo?: Point;
  pressure?: number;
  seed?: number;
  magicEraserTolerance?: number;
  magicEraserContiguous?: boolean;
  backgroundEraserTolerance?: number;
  backgroundEraserContiguous?: boolean;
  backgroundEraserSampling?: 'once' | 'continuous';
  backgroundEraserUseBackgroundSwatch?: boolean;
  backgroundEraserLimits?: 'contiguous' | 'discontiguous';
  backgroundEraserProtectForeground?: boolean;
  backgroundEraserForegroundColor?: string;
  backgroundEraserBackgroundColor?: string;
}

export interface MagicEraserApplyOptions {
  tolerance?: number;
  contiguous?: boolean;
  edgeCleanup?: boolean;
  /**
   * Document-space selection coverage. Magic Eraser keeps the color match
   * calculation layer-local, then clips the alpha edit to this mask.
   */
  selection?: SelectionMask;
  /** Document-space origin of the layer bitmap receiving the edit. */
  selectionOffset?: Point;
}

/**
 * A Magic Eraser transaction holds the source bitmap, two undo snapshots,
 * ImageData, and two single-channel work buffers.  Eight megapixels keeps that
 * one-shot synchronous operation well below the editor's 768 MiB history cap
 * while still covering a 4K-class layer.  Larger layers fail closed rather
 * than attempting an unbounded main-thread allocation.
 */
export const MAX_MAGIC_ERASER_PIXELS = 8 * 1024 * 1024;

export interface MagicEraserApplyResult {
  removedPixels: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  seedColor: { r: number; g: number; b: number; a: number };
  tolerance: number;
  contiguous: boolean;
  resourceLimit: {
    maxPixels: number;
    pixelCount: number;
    exceeded: boolean;
  };
  edgeSummary: MagicEraserEdgeSummary;
  signature: string;
}

export interface BackgroundEraserApplyOptions {
  brushSize?: number;
  tolerance?: number;
  contiguous?: boolean;
  sampling?: 'once' | 'continuous';
  useBackgroundSwatch?: boolean;
  limits?: 'contiguous' | 'discontiguous';
  protectForeground?: boolean;
  foregroundColor?: string;
  backgroundColor?: string;
  sampleColor?: RgbaColor;
  edgeCleanup?: boolean;
}

export interface BackgroundEraserApplyResult {
  removedPixels: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  sampleColor: RgbaColor;
  tolerance: number;
  contiguous: boolean;
  sampling: 'once' | 'continuous';
  limits: 'contiguous' | 'discontiguous';
  protectForeground: boolean;
  edgeSummary: BackgroundEraserEdgeSummary;
  signature: string;
}

export interface EraserEdgeSummaryBase {
  matchingMetric: 'rgb-euclidean-distance';
  tolerance: number;
  edgeMode: 'hard-alpha-cutout' | 'one-pixel-alpha-fringe';
  antiAlias: boolean;
  fringePixels: 0 | 1;
  edgeCleanupPixels: number;
  rgbPreserved: true;
  alphaClearValue: 0;
  boundsSignature: string;
}

export interface BackgroundEraserEdgeSummary extends EraserEdgeSummaryBase {
  matchingScope: 'brush-bounded-contiguous' | 'brush-bounded-discontiguous';
  sampleSource: 'pointer-sample' | 'background-swatch';
}

export interface MagicEraserEdgeSummary extends EraserEdgeSummaryBase {
  matchingScope: 'contiguous' | 'global';
  connectivity: 4 | 'layer-wide';
}

function ensureLayer(env: ToolEnv): ImageLayer | null {
  if (env.activeLayer) return env.activeLayer;
  return null;
}

function liveDocument(env: ToolEnv) {
  const active = typeof env.store.getActiveDocument === 'function'
    ? env.store.getActiveDocument()
    : undefined;
  return active?.id === env.doc.id ? active : env.doc;
}

function liveLayer(env: ToolEnv, layerId: string): ImageLayer | null {
  return liveDocument(env).layers.find((candidate) => candidate.id === layerId) ?? null;
}

function ensureTiltmarkSurfaceLayer(
  env: ToolEnv,
  activeLayer: ImageLayer | null,
): {
  layer: ImageLayer;
  createdLayerSetBefore?: ImageLayer[];
  createdActiveLayerIdBefore?: string | null;
} {
  if (isImageTiltmarkSurface(activeLayer)) return { layer: activeLayer };
  if (isImageTiltmarkGroup(activeLayer)) {
    const child = liveDocument(env).layers.find((candidate) => (
      candidate.groupId === activeLayer.id && isImageTiltmarkSurface(candidate)
    ));
    if (child) return { layer: child };
  }
  const liveBefore = liveDocument(env);
  const before = liveBefore.layers;
  const created = createImageTiltmarkLayerSet(env.doc);
  env.store.setLayers(env.doc.id, [...before, created.group, created.surface], created.surface.id);
  env.store.setSelectedLayers(env.doc.id, [created.surface.id]);
  env.store.setActiveLayerEditTarget(env.doc.id, 'layer');
  return {
    layer: created.surface,
    createdLayerSetBefore: before,
    createdActiveLayerIdBefore: liveBefore.activeLayerId,
  };
}

function ensureBitmap(env: ToolEnv, layer: ImageLayer): OffscreenCanvas {
  if (layer.bitmap) return layer.bitmap;
  const bitmap = createBitmap(env.doc.width, env.doc.height);
  env.store.updateLayer(env.doc.id, layer.id, { bitmap });
  return bitmap;
}

function canEditLayerMask(layer: ImageLayer | null | undefined): layer is ImageLayer & { mask: OffscreenCanvas } {
  return Boolean(layer && layer.type !== 'group' && !layer.locked && layer.mask);
}

function parseBrushColor(color: string): [number, number, number, number] {
  const match = color.trim().match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (!match) return [0, 0, 0, 1];
  const hex = match[1]!;
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
    match[2] ? Number.parseInt(match[2], 16) / 255 : 1,
  ];
}

function makeBrushTool(isEraser: boolean): ToolHandler {
  return {
    onPointerDown(env, point, mods, event) {
      // Drop the per-stroke selection-mask cache so a selection changed since the last stroke is
      // re-read (within a stroke the selection is stable, so the cache stays valid there).
      selectionMaskCache = null;
      const engineSettings = normalizedBrushSettings(env.brushSettings);
      const useTiltmark = engineSettings.brushEngine === 'tiltmark';
      // A stored/tampered engine id is never enough to enter the proprietary
      // path. Only the license-gated runtime can make a Tiltmark stroke.
      if (useTiltmark && !isTiltmarkRuntimeReady()) return;
      const seed = Date.now() % 100000;
      // Photoshop Shift straight-line: when Shift is held, start the stroke from the previous stroke's
      // end point so the first segment is a straight connecting line (else from this point = one dab).
      const lineStart = brushStraightLineStart(isEraser ? 'eraser' : 'brush', env.doc.id, mods) ?? point;
      if (env.store.quickMaskSettings.enabled) {
        const selection = ensureQuickMaskSelection(env);
        stroke = {
          quickMask: true,
          selectionBefore: cloneMask(selection),
          lastPoint: point,
          isEraser,
          dabIndex: 0,
          seed,
          lastTime: event.timeStamp,
          tiltmarkSession: useTiltmark
            ? createTiltmarkSessionForStroke(env, seed, isEraser, false)
            : undefined,
        };
        if (!beginTiltmarkStroke(env, lineStart, point, event)) {
          paintQuickMaskStrokeSegment(env, selection, lineStart, point, event);
        }
        env.store.bumpSelectionVersion(env.doc.id);
        env.requestRender();
        return;
      }

      let layer = ensureLayer(env);
      if ((env.doc.activeLayerEditTarget ?? 'layer') === 'mask') {
        if (!canEditLayerMask(layer)) return;
        stroke = {
          quickMask: false,
          paintTarget: 'mask',
          layerId: layer.id,
          maskBefore: cloneBitmap(layer.mask),
          lastPoint: point,
          isEraser,
          dabIndex: 0,
          seed,
          lastTime: event.timeStamp,
          tiltmarkSession: useTiltmark
            ? createTiltmarkSessionForStroke(env, seed, isEraser, false)
            : undefined,
        };
        if (!beginTiltmarkStroke(env, lineStart, point, event)) {
          paintLayerMaskStrokeSegment(env, layer, layer.mask, lineStart, point, event);
        }
        env.requestRender();
        return;
      }

      // A4: once a native authority exists, brush/eraser writes it directly. The
      // legacy Canvas2D stroke remains the exact path for ordinary 8-bit documents.
      if (layer?.pixels && (env.doc.metadata?.bitDepth === 16 || env.doc.metadata?.bitDepth === 32)) {
        if (useTiltmark) {
          const refusal = executeHighBitTool('tiltmark', () => true);
          if (!refusal.ok && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', { detail: refusal.policy }));
          }
          return;
        }
        const policy = executeHighBitTool(isEraser ? 'eraser' : 'brush', () => true);
        if (!policy.ok) return;
        if (!canEditImageLayerPixels(layer)) return;
        highBitStroke = {
          layerId: layer.id,
          before: layer.pixels,
          points: [point],
          isEraser,
        };
        env.requestRender();
        return;
      }

      const tiltmarkLayer = useTiltmark
        ? ensureTiltmarkSurfaceLayer(env, layer)
        : null;
      if (tiltmarkLayer) layer = tiltmarkLayer.layer;
      if (!canEditImageLayerPixels(layer, { allowTiltmarkSurface: useTiltmark })) return;
      const bitmap = ensureBitmap(env, layer);
      const before = cloneBitmap(bitmap);
      const substrateTarget = useTiltmark
        ? resolveTiltmarkSubstrateTarget(env, layer)
        : null;
      noteTiltmarkWetInputActivity();
      stroke = {
        quickMask: false,
        paintTarget: 'layer',
        layerId: layer.id,
        bitmapBefore: before,
        lastPoint: point,
        isEraser,
        dabIndex: 0,
        seed,
        lastTime: event.timeStamp,
        mixerState: [0, 0, 0, 0],
        tiltmarkMixerState: { ...EMPTY_TILTMARK_MIXER_STATE },
        tiltmarkSession: useTiltmark
          ? createTiltmarkSessionForStroke(env, seed, isEraser, true, substrateTarget)
          : undefined,
        createdLayerSetBefore: tiltmarkLayer?.createdLayerSetBefore,
        createdActiveLayerIdBefore: tiltmarkLayer?.createdActiveLayerIdBefore,
        tiltmarkLayerBefore: isImageTiltmarkSurface(layer)
          ? {
              base: layer.tiltmarkBaseBitmap ? cloneBitmap(layer.tiltmarkBaseBitmap) : null,
              simulationData: layer.tiltmarkSimulationData,
              metadata: structuredClone(layer.metadata),
            }
          : undefined,
      };
      if (!beginTiltmarkStroke(env, lineStart, point, event)) {
        paintStrokeSegment(env, layer, bitmap, lineStart, point, event);
      }
      env.requestRender();
    },

    onPointerMove(env, point, _mods, event) {
      if (highBitStroke) {
        const last = highBitStroke.points[highBitStroke.points.length - 1]!;
        const settings = normalizedBrushSettings(env.brushSettings);
        const smoothedPoint = smoothBrushPoint(last, point, settings.smoothing);
        highBitStroke.points.push(smoothedPoint);
        env.markDirty?.({
          x: Math.max(0, Math.floor(smoothedPoint.x - settings.size)),
          y: Math.max(0, Math.floor(smoothedPoint.y - settings.size)),
          width: Math.min(env.doc.width, Math.ceil(settings.size * 2)),
          height: Math.min(env.doc.height, Math.ceil(settings.size * 2)),
        });
        env.requestRender({ invalidateBitmapCache: true });
        return;
      }
      const activeStroke = stroke;
      if (!activeStroke) return;
      noteTiltmarkWetInputActivity();
      if (activeStroke.tiltmarkSession) {
        const result = activeStroke.tiltmarkSession.append(point, event);
        paintActiveTiltmarkDabs(env, result.dabs);
        activeStroke.lastPoint = point;
        activeStroke.lastTime = event.timeStamp;
        if (activeStroke.quickMask) {
          env.store.bumpSelectionVersion(env.doc.id);
        }
        env.requestRender();
        return;
      }
      if (activeStroke.quickMask) {
        const selection = ensureQuickMaskSelection(env);
        const settings = normalizedBrushSettings(env.brushSettings);
        const smoothedPoint = smoothBrushPoint(activeStroke.lastPoint, point, settings.smoothing);
        paintQuickMaskStrokeSegment(env, selection, activeStroke.lastPoint, smoothedPoint, event);
        activeStroke.lastPoint = smoothedPoint;
        activeStroke.lastTime = event.timeStamp;
        env.store.bumpSelectionVersion(env.doc.id);
        env.requestRender();
        return;
      }

      const layer = liveLayer(env, activeStroke.layerId);
      if (activeStroke.paintTarget === 'mask') {
        if (!canEditLayerMask(layer)) return;
        const settings = normalizedBrushSettings(env.brushSettings);
        const smoothedPoint = smoothBrushPoint(activeStroke.lastPoint, point, settings.smoothing);
        paintLayerMaskStrokeSegment(env, layer, layer.mask, activeStroke.lastPoint, smoothedPoint, event);
        activeStroke.lastPoint = smoothedPoint;
        activeStroke.lastTime = event.timeStamp;
        env.requestRender();
        return;
      }
      if (!layer || !layer.bitmap) return;
      const settings = normalizedBrushSettings(env.brushSettings);
      const smoothedPoint = smoothBrushPoint(activeStroke.lastPoint, point, settings.smoothing);
      paintStrokeSegment(env, layer, layer.bitmap, activeStroke.lastPoint, smoothedPoint, event);
      activeStroke.lastPoint = smoothedPoint;
      activeStroke.lastTime = event.timeStamp;
      env.requestRender();
    },

    onPointerUp(env, point, _mods, event) {
      if (highBitStroke) {
        const active = highBitStroke;
        highBitStroke = null;
        const layer = liveLayer(env, active.layerId);
        if (layer?.pixels) {
          active.points.push(point);
          const settings = normalizedBrushSettings(env.brushSettings);
          const painted = paintPixelBuffer(active.before, {
            points: active.points,
            radius: settings.size / 2,
            color: parseBrushColor(settings.color),
            opacity: settings.opacity,
            eraser: active.isEraser,
          });
          const committed = env.store.commitHighBitPixelEdit(env.doc.id, layer.id, painted.pixels);
          if (committed.ok) {
            if (painted.bounds) env.markDirty?.(painted.bounds);
            recordBrushStrokeAnchor(active.isEraser ? 'eraser' : 'brush', env.doc.id, point);
            env.requestRender({ invalidateBitmapCache: true });
          }
        }
        return;
      }
      const activeStroke = stroke;
      if (!activeStroke) return;
      endTiltmarkWetInputActivity();
      let tiltmarkHistory: { before: unknown; after: unknown } | undefined;
      if (activeStroke.tiltmarkSession) {
        const result = activeStroke.tiltmarkSession.end(point, event);
        paintActiveTiltmarkDabs(env, result.dabs);
        activeStroke.lastPoint = point;
        const before = activeStroke.tiltmarkSession.historyBefore;
        const after = activeStroke.tiltmarkSession.historyAfter();
        if (before && after) tiltmarkHistory = { before, after };
        activeStroke.tiltmarkSession.dispose();
        if (!activeStroke.quickMask && activeStroke.paintTarget === 'layer') {
          const physicalLayer = liveLayer(env, activeStroke.layerId);
          if (isImageTiltmarkSurface(physicalLayer)) {
            const checkpoint = checkpointTiltmarkLayerSubstrate({
              documentId: env.doc.id,
              layer: physicalLayer,
              width: physicalLayer.bitmap?.width ?? env.doc.width,
              height: physicalLayer.bitmap?.height ?? env.doc.height,
            });
            if (checkpoint) {
              if (physicalLayer.bitmap && checkpoint.raster) {
                composeTiltmarkSurfacePreview(
                  physicalLayer.bitmap,
                  physicalLayer.tiltmarkBaseBitmap,
                  checkpoint.raster,
                );
              }
              env.store.updateLayer(env.doc.id, physicalLayer.id, {
                tiltmarkSimulationData: checkpoint.simulationData,
                metadata: { ...physicalLayer.metadata, tiltmark: checkpoint.metadata },
              });
              // Persistence encoding is coalesced off the pen-up path; the
              // checkpoint above only presented the field.
              requestTiltmarkWetSnapshot(env.doc.id, physicalLayer.id);
            }
          }
        }
        if (activeStroke.quickMask) {
          env.store.bumpSelectionVersion(env.doc.id);
        }
        env.requestRender();
      }
      // Remember where this stroke ended so a following Shift+click draws a straight line to it.
      recordBrushStrokeAnchor(isEraser ? 'eraser' : 'brush', env.doc.id, activeStroke.lastPoint);
      if (activeStroke.quickMask) {
        const after = getSelection(env.doc.id) ?? createMask(env.doc.width, env.doc.height);
        env.pushOperation({
          kind: 'selection',
          docId: env.doc.id,
          before: isMaskEmpty(activeStroke.selectionBefore) ? null : toSnapshot(activeStroke.selectionBefore),
          after: isMaskEmpty(after) ? null : toSnapshot(after),
        });
        env.store.setHasSelection(env.doc.id, !isMaskEmpty(after));
        stroke = null;
        return;
      }

      const layer = liveLayer(env, activeStroke.layerId);
      if (activeStroke.paintTarget === 'mask' && layer?.mask) {
        env.pushOperation({
          kind: 'paint',
          docId: env.doc.id,
          layerId: layer.id,
          paintTarget: 'mask',
          before: activeStroke.maskBefore,
          after: cloneBitmap(layer.mask),
        });
        env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
        env.store.markDocumentDirty(env.doc.id);
        stroke = null;
        return;
      }
      if (activeStroke.paintTarget === 'layer' && layer?.bitmap) {
        const tiltmarkMetadata = layer.metadata?.tiltmark;
        if (tiltmarkMetadata) {
          env.store.updateLayer(env.doc.id, layer.id, {
            metadata: {
              ...layer.metadata,
              tiltmark: {
                ...tiltmarkMetadata,
                strokeCount: (tiltmarkMetadata.strokeCount ?? 0) + 1,
                lastPresetId: activeStroke.tiltmarkSession?.preset.id
                  ?? tiltmarkMetadata.lastPresetId,
              },
            },
          });
        }
        const committedLayer = liveLayer(env, layer.id) ?? layer;
        if (activeStroke.createdLayerSetBefore) {
          const after = liveDocument(env).layers;
          env.pushOperation({
            kind: 'layerOp',
            docId: env.doc.id,
            before: activeStroke.createdLayerSetBefore,
            after,
          });
        } else {
          env.pushOperation({
            kind: 'paint',
            docId: env.doc.id,
            layerId: layer.id,
            before: activeStroke.bitmapBefore,
            after: cloneBitmap(committedLayer.bitmap!),
            ...(tiltmarkHistory ? { tiltmarkHistory } : {}),
            ...(activeStroke.tiltmarkLayerBefore
              ? {
                  tiltmarkLayer: {
                    before: activeStroke.tiltmarkLayerBefore,
                    after: {
                      base: committedLayer.tiltmarkBaseBitmap
                        ? cloneBitmap(committedLayer.tiltmarkBaseBitmap)
                        : null,
                      simulationData: committedLayer.tiltmarkSimulationData,
                      metadata: structuredClone(committedLayer.metadata),
                    },
                  },
                }
              : {}),
          });
        }
        env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
        env.store.markDocumentDirty(env.doc.id);
      }
      stroke = null;
    },

    onCancel(env) {
      if (highBitStroke) {
        highBitStroke = null;
        env.requestRender({ invalidateBitmapCache: true });
        return;
      }
      const activeStroke = stroke;
      endTiltmarkWetInputActivity();
      let restoredTiltmarkRaster = false;
      if (activeStroke?.tiltmarkSession) {
        activeStroke.tiltmarkSession.cancel();
        activeStroke.tiltmarkSession.dispose();
        if (!activeStroke.quickMask) {
          const layer = liveLayer(env, activeStroke.layerId);
          const target = activeStroke.paintTarget === 'mask' ? layer?.mask : layer?.bitmap;
          const before = activeStroke.paintTarget === 'mask'
            ? activeStroke.maskBefore
            : activeStroke.bitmapBefore;
          const context = target?.getContext('2d');
          if (target && context) {
            context.clearRect(0, 0, target.width, target.height);
            context.drawImage(before, 0, 0);
            env.store.bumpLayerBitmapVersion(env.doc.id, activeStroke.layerId);
            restoredTiltmarkRaster = true;
          }
          if (activeStroke.paintTarget === 'layer' && activeStroke.tiltmarkLayerBefore) {
            env.store.updateLayer(env.doc.id, activeStroke.layerId, {
              tiltmarkBaseBitmap: activeStroke.tiltmarkLayerBefore.base,
              tiltmarkSimulationData: activeStroke.tiltmarkLayerBefore.simulationData,
              metadata: activeStroke.tiltmarkLayerBefore.metadata,
            });
            releaseTiltmarkLayerSubstrate(env.doc.id, activeStroke.layerId);
          }
        }
      }
      if (
        activeStroke
        && !activeStroke.quickMask
        && activeStroke.paintTarget === 'layer'
        && activeStroke.createdLayerSetBefore
      ) {
        env.store.setLayers(
          env.doc.id,
          activeStroke.createdLayerSetBefore,
          activeStroke.createdActiveLayerIdBefore,
        );
        releaseTiltmarkLayerSubstrate(env.doc.id, activeStroke.layerId);
      }
      if (stroke?.quickMask) {
        setSelection(env.doc.id, cloneMask(stroke.selectionBefore));
        env.store.setHasSelection(env.doc.id, !isMaskEmpty(stroke.selectionBefore));
        env.requestRender();
      }
      if (restoredTiltmarkRaster) {
        env.requestRender({ invalidateBitmapCache: true });
      }
      stroke = null;
    },
  };
}

function ensureQuickMaskSelection(env: ToolEnv): SelectionMask {
  const existing = getSelection(env.doc.id);
  if (existing) return existing;
  const mask = createMask(env.doc.width, env.doc.height);
  setSelection(env.doc.id, mask);
  return mask;
}

function createTiltmarkSessionForStroke(
  env: ToolEnv,
  seed: number,
  isEraser: boolean,
  persistentSupply: boolean,
  substrateTarget: { documentId: string; layerId: string } | null = null,
): TiltmarkStrokeSession {
  return createTiltmarkStrokeSession({
    settings: {
      ...normalizedBrushSettings(env.brushSettings),
      tiltmarkPersistentSupply: persistentSupply
        ? env.brushSettings.tiltmarkPersistentSupply
        : false,
    },
    backgroundColor: env.backgroundColor ?? env.brushSettings.color,
    seed,
    forceEraser: isEraser,
    substrateTarget,
  });
}

/**
 * Contact physics (and therefore substrate pickup) applies only when the
 * stroke's deposits would actually reach the layer's physical substrate: an
 * editable smart surface, no active selection clip, and RGB channel routing.
 */
function resolveTiltmarkSubstrateTarget(
  env: ToolEnv,
  layer: ImageLayer | null,
): { documentId: string; layerId: string } | null {
  if (!layer || !isImageTiltmarkSurface(layer)) return null;
  if (getSelection(env.doc.id)) return null;
  if (getImageChannelEditTarget(env.doc).channel !== 'rgb') return null;
  return { documentId: env.doc.id, layerId: layer.id };
}

function beginTiltmarkStroke(
  env: ToolEnv,
  from: Point,
  to: Point,
  event: PointerEvent,
): boolean {
  const activeStroke = stroke;
  const session = activeStroke?.tiltmarkSession;
  if (!activeStroke || !session) return false;
  const dabs = [...session.begin(from, event).dabs];
  if (from.x !== to.x || from.y !== to.y) {
    dabs.push(...session.append(to, event).dabs);
  }
  paintActiveTiltmarkDabs(env, dabs);
  return true;
}

function paintActiveTiltmarkDabs(
  env: ToolEnv,
  sourceDabs: readonly TiltmarkBrushDab[],
): void {
  const activeStroke = stroke;
  if (!activeStroke || sourceDabs.length === 0) return;
  const settings = normalizedBrushSettings(env.brushSettings);
  const dabs = buildTiltmarkSymmetryDabs(sourceDabs, settings.symmetryMode ?? 'none', {
    x: env.doc.width / 2,
    y: env.doc.height / 2,
    width: env.doc.width,
    height: env.doc.height,
  });

  if (activeStroke.quickMask) {
    const selection = ensureQuickMaskSelection(env);
    const erase = activeStroke.isEraser
      || dabs.some((dab) => dab.eraser || dab.interaction === 'lift');
    const coverage = rasterizeTiltmarkDabCoverage(
      dabs,
      env.doc.width,
      env.doc.height,
    );
    applyTiltmarkCoverageToQuickMask(
      selection,
      coverage,
      resolveQuickMaskBrushTargetValue(settings.color, erase),
    );
    return;
  }

  const layer = liveLayer(env, activeStroke.layerId);
  if (activeStroke.paintTarget === 'mask') {
    if (!canEditLayerMask(layer)) return;
    const dirtyRect = tiltmarkDabsDocumentRect(dabs);
    if (dirtyRect) env.markDirty?.(dirtyRect);
    const erase = activeStroke.isEraser
      || dabs.some((dab) => dab.eraser || dab.interaction === 'lift');
    const coverage = rasterizeTiltmarkDabCoverage(
      dabs,
      env.doc.width,
      env.doc.height,
    );
    applyTiltmarkCoverageToLayerMask(
      layer.mask,
      layer,
      coverage,
      resolveLayerMaskBrushTargetValue(settings.color, erase),
      getSelection(env.doc.id) ?? null,
    );
    return;
  }

  if (!layer?.bitmap) return;
  paintTiltmarkPixelDabs(env, layer, layer.bitmap, dabs, activeStroke);
}

function blendTiltmarkMaskByte(
  current: number,
  target: number,
  coverage: number,
): number {
  return Math.max(
    0,
    Math.min(255, Math.round(current + (target - current) * (coverage / 255))),
  );
}

function applyTiltmarkCoverageToQuickMask(
  selection: SelectionMask,
  coverage: TiltmarkCoverageRaster | null,
  targetValue: number,
): void {
  if (!coverage) return;
  for (let py = 0; py < coverage.height; py += 1) {
    const documentY = coverage.y + py;
    if (documentY < 0 || documentY >= selection.height) continue;
    for (let px = 0; px < coverage.width; px += 1) {
      const documentX = coverage.x + px;
      if (documentX < 0 || documentX >= selection.width) continue;
      const strength = coverage.alpha[py * coverage.width + px] ?? 0;
      if (strength <= 0) continue;
      const index = documentY * selection.width + documentX;
      selection.data[index] = blendTiltmarkMaskByte(
        selection.data[index] ?? 0,
        targetValue,
        strength,
      );
    }
  }
}

function applyTiltmarkCoverageToLayerMask(
  mask: NonNullable<ImageLayer['mask']>,
  layer: Pick<ImageLayer, 'x' | 'y'>,
  coverage: TiltmarkCoverageRaster | null,
  targetValue: number,
  selection: SelectionMask | null,
): void {
  if (!coverage) return;
  const imageData = getBitmapImageData(mask);
  for (let py = 0; py < coverage.height; py += 1) {
    const documentY = coverage.y + py;
    const maskY = Math.round(documentY - layer.y);
    if (maskY < 0 || maskY >= mask.height) continue;
    for (let px = 0; px < coverage.width; px += 1) {
      const documentX = coverage.x + px;
      const maskX = Math.round(documentX - layer.x);
      if (maskX < 0 || maskX >= mask.width) continue;
      const markCoverage = coverage.alpha[py * coverage.width + px] ?? 0;
      const selectionCoverage = selection
        && documentX >= 0
        && documentY >= 0
        && documentX < selection.width
        && documentY < selection.height
        ? selection.data[documentY * selection.width + documentX] ?? 0
        : selection ? 0 : 255;
      const strength = Math.round(markCoverage * selectionCoverage / 255);
      if (strength <= 0) continue;
      const offset = (maskY * mask.width + maskX) * 4;
      imageData.data[offset] = 255;
      imageData.data[offset + 1] = 255;
      imageData.data[offset + 2] = 255;
      imageData.data[offset + 3] = blendTiltmarkMaskByte(
        imageData.data[offset + 3] ?? 0,
        targetValue,
        strength,
      );
    }
  }
  putBitmapImageData(mask, imageData);
}

function renderTiltmarkLayerDabs(
  context: OffscreenCanvasRenderingContext2D,
  dabs: readonly TiltmarkBrushDab[],
  layer: Pick<ImageLayer, 'x' | 'y'>,
  options: {
    forceColor?: string;
    forceCompositeOperation?: GlobalCompositeOperation;
  } = {},
): void {
  context.save();
  context.translate(-layer.x, -layer.y);
  renderTiltmarkDabs(context, dabs, options);
  context.restore();
}

function paintTiltmarkPixelDabs(
  env: ToolEnv,
  layer: ImageLayer,
  bitmap: OffscreenCanvas,
  dabsInput: readonly TiltmarkBrushDab[],
  activeStroke: BitmapStrokeState,
): void {
  const context = bitmap.getContext('2d');
  if (!context || dabsInput.length === 0) return;
  const paintStartedAt = performance.now();
  const channelEditTarget = getImageChannelEditTarget(env.doc);
  const routeColorComponents = channelEditTarget.channel !== 'rgb';
  const dabs = resolveTiltmarkRasterInteractions(
    context,
    dabsInput,
    activeStroke.tiltmarkMixerState,
    layer,
  );

  const smartSurface = isImageTiltmarkSurface(layer);
  const canUsePhysicalSurface = smartSurface
    && !getSelection(env.doc.id)
    && !routeColorComponents;
  if (canUsePhysicalSurface) {
    const physical = applyTiltmarkLayerSubstrateDabs({
      documentId: env.doc.id,
      layer,
      width: bitmap.width,
      height: bitmap.height,
      dabs,
      preset: activeStroke.tiltmarkSession!.preset,
      settings: normalizedBrushSettings(env.brushSettings),
    });
    if (physical.handled && physical.raster) {
      composeTiltmarkSurfacePreview(
        bitmap,
        layer.tiltmarkBaseBitmap,
        physical.raster,
      );
      env.store.updateLayer(env.doc.id, layer.id, {
        tiltmarkSimulationData: physical.simulationData,
        metadata: { ...layer.metadata, tiltmark: physical.metadata },
      });
      const dirtyRect = tiltmarkDabsDocumentRect(dabs);
      if (dirtyRect) env.markDirty?.(dirtyRect);
      recordStrokePaint(performance.now() - paintStartedAt, dabs.length);
      return;
    }
  }

  const dirtyRect = tiltmarkDabsDocumentRect(dabs);
  if (dirtyRect) env.markDirty?.(dirtyRect);

  const channelRect = routeColorComponents
    ? tiltmarkDabsBitmapRect(dabs, layer, bitmap)
    : null;
  const beforeChannelRoute = channelRect
    ? context.getImageData(channelRect.x, channelRect.y, channelRect.width, channelRect.height)
    : null;
  const routeOptions = routeColorComponents
    ? {
        forceColor: activeStroke.isEraser ? '#000000' : undefined,
        forceCompositeOperation: 'source-over' as GlobalCompositeOperation,
      }
    : {};

  const selection = getSelection(env.doc.id);
  const paintBitmap = smartSurface
    ? ensureTiltmarkBaseBitmap(env, layer)
    : bitmap;
  const paintContext = paintBitmap.getContext('2d');
  if (!paintContext) return;
  if (selection) {
    const temp = getSelectionPaintScratch(paintBitmap.width, paintBitmap.height);
    const tempContext = temp.getContext('2d');
    if (!tempContext) return;
    tempContext.clearRect(0, 0, temp.width, temp.height);
    renderTiltmarkLayerDabs(tempContext, dabs, layer, {
      ...routeOptions,
      // Coverage must first exist in the scratch before it can be clipped.
      forceCompositeOperation: 'source-over',
    });
    tempContext.save();
    tempContext.globalCompositeOperation = 'destination-in';
    tempContext.translate(-layer.x, -layer.y);
    tempContext.drawImage(getSelectionMaskCanvas(selection), 0, 0);
    tempContext.restore();

    const erase = !routeColorComponents && dabs.every((dab) => dab.eraser);
    paintContext.save();
    paintContext.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    paintContext.drawImage(temp, 0, 0);
    paintContext.restore();
  } else {
    renderTiltmarkLayerDabs(paintContext, dabs, layer, routeOptions);
  }

  if (beforeChannelRoute && channelRect) {
    const afterChannelRoute = paintContext.getImageData(
      channelRect.x,
      channelRect.y,
      channelRect.width,
      channelRect.height,
    );
    applyColorChannelRoute(
      beforeChannelRoute,
      afterChannelRoute,
      channelEditTarget.components,
    );
    paintContext.putImageData(afterChannelRoute, channelRect.x, channelRect.y);
  }
  if (smartSurface) {
    const substrate = renderTiltmarkLayerSubstrate({
      documentId: env.doc.id,
      layer: liveLayer(env, layer.id) ?? layer,
      width: bitmap.width,
      height: bitmap.height,
    });
    composeTiltmarkSurfacePreview(bitmap, paintBitmap, substrate);
    env.store.updateLayer(env.doc.id, layer.id, { tiltmarkBaseBitmap: paintBitmap });
  }
  recordStrokePaint(performance.now() - paintStartedAt, dabs.length);
}

function ensureTiltmarkBaseBitmap(env: ToolEnv, layer: ImageLayer): OffscreenCanvas {
  if (layer.tiltmarkBaseBitmap) return layer.tiltmarkBaseBitmap;
  const base = createBitmap(
    layer.bitmap?.width ?? env.doc.width,
    layer.bitmap?.height ?? env.doc.height,
  );
  env.store.updateLayer(env.doc.id, layer.id, { tiltmarkBaseBitmap: base });
  return base;
}

function resolveActiveBrushStrokeVelocity(from: Point, to: Point, event: PointerEvent): number {
  const activeStroke = stroke;
  if (!activeStroke) return 0;
  const elapsedMs = Math.max(1, event.timeStamp - activeStroke.lastTime);
  return Math.hypot(to.x - from.x, to.y - from.y) / elapsedMs;
}

function paintQuickMaskStrokeSegment(
  env: ToolEnv,
  selection: SelectionMask,
  from: Point,
  to: Point,
  event: PointerEvent,
): void {
  const settings = normalizedBrushSettings(env.brushSettings);
  const pressure = readBrushPressure(event);
  const tilt = readBrushTiltState(event);
  const velocityPxPerMs = resolveActiveBrushStrokeVelocity(from, to, event);
  const dabs = buildBrushDabs(from, to, settings, pressure, {
    seed: stroke?.seed ?? 0,
    startIndex: stroke?.dabIndex ?? 0,
    tilt,
    velocityPxPerMs,
  });
  if (stroke) {
    stroke.dabIndex += dabs.length;
  }
  const symmetryDabs = buildSymmetryBrushDabs(dabs, settings.symmetryMode, {
    x: env.doc.width / 2,
    y: env.doc.height / 2,
  });
  paintQuickMaskDabs(
    selection,
    symmetryDabs,
    resolveQuickMaskBrushTargetValue(settings.color, stroke?.isEraser ?? false),
  );
}

function paintLayerMaskStrokeSegment(
  env: ToolEnv,
  layer: ImageLayer & { mask: OffscreenCanvas },
  mask: OffscreenCanvas,
  from: Point,
  to: Point,
  event: PointerEvent,
): void {
  const settings = normalizedBrushSettings(env.brushSettings);
  const pressure = readBrushPressure(event);
  const tilt = readBrushTiltState(event);
  const velocityPxPerMs = resolveActiveBrushStrokeVelocity(from, to, event);
  const dabs = buildBrushDabs(from, to, settings, pressure, {
    seed: stroke?.seed ?? 0,
    startIndex: stroke?.dabIndex ?? 0,
    tilt,
    velocityPxPerMs,
  });
  if (stroke) {
    stroke.dabIndex += dabs.length;
  }
  const symmetryDabs = buildSymmetryBrushDabs(dabs, settings.symmetryMode, {
    x: env.doc.width / 2,
    y: env.doc.height / 2,
  });

  // Same seam as pixel-layer painting (see dabsDocRect above): tell the renderer which document
  // region this mask stroke touched so it recomposites only that rect instead of the whole
  // document. Mask edits change what's visible through the active layer just like pixel edits do,
  // so they benefit from the identical dirty-rect compositing fast path.
  const dirtyRect = dabsDocRect(symmetryDabs);
  if (dirtyRect) env.markDirty?.(dirtyRect);

  paintLayerMaskDabs(
    mask,
    layer,
    symmetryDabs,
    resolveLayerMaskBrushTargetValue(settings.color, stroke?.isEraser ?? false),
    getSelection(env.doc.id),
  );
}

// Reused across stroke segments so painting inside a selection doesn't allocate a full-document
// temp canvas (and rebuild the selection→mask canvas) on every pointer-move — the big per-segment
// GC cost, worst on mobile. The mask is cached by selection identity (a paint stroke never changes
// the selection); the scratch is cleared before each reuse so no stale pixels leak.
let selectionPaintScratch: OffscreenCanvas | null = null;
let selectionMaskCache: { selection: SelectionMask; canvas: ReturnType<typeof maskToCanvas> } | null = null;

function getSelectionPaintScratch(width: number, height: number): OffscreenCanvas {
  if (!selectionPaintScratch || selectionPaintScratch.width !== width || selectionPaintScratch.height !== height) {
    selectionPaintScratch = createBitmap(width, height);
  }
  return selectionPaintScratch;
}

function getSelectionMaskCanvas(selection: SelectionMask): ReturnType<typeof maskToCanvas> {
  if (!selectionMaskCache || selectionMaskCache.selection !== selection) {
    selectionMaskCache = { selection, canvas: maskToCanvas(selection, 255, 255, 255) };
  }
  return selectionMaskCache.canvas;
}

/** Bitmap-local bounding box of a set of dabs (expanded by radius), clamped to the bitmap, or null
 * if nothing falls inside. Used to bound the channel-route read-back/write-back to the painted area
 * instead of the whole document. */
function dabsBitmapRect(
  dabs: ReturnType<typeof buildBrushDabs>,
  layer: ImageLayer,
  bitmap: OffscreenCanvas,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const dab of dabs) {
    const r = dab.size / 2 + 2;
    const cx = dab.x - layer.x;
    const cy = dab.y - layer.y;
    minX = Math.min(minX, cx - r);
    minY = Math.min(minY, cy - r);
    maxX = Math.max(maxX, cx + r);
    maxY = Math.max(maxY, cy + r);
  }
  if (!Number.isFinite(minX)) return null;
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const right = Math.min(bitmap.width, Math.ceil(maxX));
  const bottom = Math.min(bitmap.height, Math.ceil(maxY));
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/** Document-space bounding box of a set of dabs (expanded by radius), for dirty-rect compositing.
 * Unlike dabsBitmapRect this is in document coordinates (no layer offset) since the renderer's
 * composite/scratch is document-sized. */
function dabsDocRect(
  dabs: ReturnType<typeof buildBrushDabs>,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const dab of dabs) {
    const r = dab.size / 2 + 2;
    minX = Math.min(minX, dab.x - r);
    minY = Math.min(minY, dab.y - r);
    maxX = Math.max(maxX, dab.x + r);
    maxY = Math.max(maxY, dab.y + r);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function paintStrokeSegment(
  env: ToolEnv,
  layer: ImageLayer,
  bitmap: OffscreenCanvas,
  from: Point,
  to: Point,
  event: PointerEvent,
): void {
  const ctx = bitmap.getContext('2d');
  if (!ctx) return;
  const paintStartedAt = performance.now();
  // `paintStrokeSegment` is only invoked on the bitmap-layer path, so the active stroke (if any) is
  // a BitmapStrokeState; narrow it once here so the mixer branch can read/write `mixerState`.
  const bitmapStroke = stroke && !stroke.quickMask && stroke.paintTarget === 'layer' ? stroke : null;
  const settings = normalizedBrushSettings(env.brushSettings);
  const channelEditTarget = getImageChannelEditTarget(env.doc);
  const routeColorComponents = channelEditTarget.channel !== 'rgb';
  const compositeOperation = stroke?.isEraser && !routeColorComponents ? 'destination-out' : 'source-over';
  const pressure = readBrushPressure(event);
  const tilt = readBrushTiltState(event);
  // Krita-style colour dynamics: blend the dab colour from foreground toward the
  // background (the two-colour picker) by pressure/tilt.
  const color = stroke?.isEraser
    ? 'rgba(0,0,0,1)'
    : resolveBrushDabColor({
        primaryColor: settings.color,
        secondaryColor: env.backgroundColor ?? settings.color,
        pressure,
        tiltAmount: tilt.tiltAmount,
        pressureColor: settings.pressureColor ?? 0,
        tiltColor: settings.tiltColor ?? 0,
      });
  const velocityPxPerMs = resolveActiveBrushStrokeVelocity(from, to, event);
  const dabs = buildBrushDabs(from, to, settings, pressure, {
    seed: stroke?.seed ?? 0,
    startIndex: stroke?.dabIndex ?? 0,
    tilt,
    velocityPxPerMs,
  });

  if (stroke) {
    stroke.dabIndex += dabs.length;
  }
  const symmetryDabs = buildSymmetryBrushDabs(dabs, settings.symmetryMode, {
    x: env.doc.width / 2,
    y: env.doc.height / 2,
  });

  // Tell the renderer which document region changed so it recomposites only that rectangle this
  // frame (dirty-rect compositing) instead of the whole 4K canvas.
  const dirtyRect = dabsDocRect(symmetryDabs);
  if (dirtyRect) env.markDirty?.(dirtyRect);

  // Channel routing only rewrites the painted pixels, so capture/restore just the dab's bounding
  // box instead of the whole document.
  const channelRect = routeColorComponents ? dabsBitmapRect(symmetryDabs, layer, bitmap) : null;
  const beforeChannelRoute = channelRect
    ? ctx.getImageData(channelRect.x, channelRect.y, channelRect.width, channelRect.height)
    : null;

  // If a selection exists, restrict painting to its mask (reusing a cleared scratch canvas and a
  // mask canvas cached for the stroke, rather than allocating both per segment).
  const selection = getSelection(env.doc.id);
  if (selection) {
    const temp = getSelectionPaintScratch(bitmap.width, bitmap.height);
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return;
    tempCtx.clearRect(0, 0, temp.width, temp.height);
    const maskCanvas = getSelectionMaskCanvas(selection);
    paintDabs(tempCtx, symmetryDabs, layer, color, 'source-over');
    tempCtx.save();
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.translate(-layer.x, -layer.y);
    tempCtx.drawImage(maskCanvas, 0, 0);
    tempCtx.restore();

    ctx.save();
    ctx.globalCompositeOperation = compositeOperation;
    ctx.drawImage(temp, 0, 0);
    ctx.restore();
  } else if (settings.mixerEnabled && bitmapStroke && !bitmapStroke.isEraser) {
    // Color-smudge / mixer mode: each dab samples the canvas it passes over, mixes the picked-up
    // colour into a running smudge state, blends with the foreground, and paints that. Gated by
    // `mixerEnabled` (default off) so the normal brush path is untouched when the mode is disabled.
    const fg = cssColorToRgba(color);
    bitmapStroke.mixerState = paintMixerDabs(ctx, symmetryDabs, {
      state: bitmapStroke.mixerState,
      fg,
      smudgeLength: settings.smudgeLength ?? 0.5,
      colorRate: settings.colorRate ?? 0.5,
      smudgeRadius: settings.smudgeRadius ?? 12,
      mixMode: settings.mixMode ?? 'rgb',
      smudgeMode: settings.smudgeMode ?? 'dulling',
      layerX: layer.x,
      layerY: layer.y,
      width: bitmap.width,
      height: bitmap.height,
      paintDab: (c, dab, css) =>
        paintDabs(c as OffscreenCanvasRenderingContext2D, [dab as unknown as (typeof symmetryDabs)[number]], layer, css, compositeOperation),
    });
  } else {
    paintDabs(ctx, symmetryDabs, layer, color, compositeOperation);
  }

  if (beforeChannelRoute && channelRect) {
    const afterChannelRoute = ctx.getImageData(channelRect.x, channelRect.y, channelRect.width, channelRect.height);
    applyColorChannelRoute(beforeChannelRoute, afterChannelRoute, channelEditTarget.components);
    ctx.putImageData(afterChannelRoute, channelRect.x, channelRect.y);
  }
  recordStrokePaint(performance.now() - paintStartedAt, symmetryDabs.length);
}

export const brushTool: ToolHandler = makeBrushTool(false);
export const eraserTool: ToolHandler = makeBrushTool(true);

export const backgroundEraserTool: ToolHandler = {
  onPointerDown(env, point, _mods, event) {
    if (env.store.quickMaskSettings.enabled) return;
    if ((env.doc.activeLayerEditTarget ?? 'layer') !== 'layer') return;
    if (getImageChannelEditTarget(env.doc).channel !== 'rgb') return;

    const layer = ensureLayer(env);
    if (!canEditImageLayerPixels(layer) || !layer.bitmap) return;

    backgroundEraserStroke = {
      layerId: layer.id,
      bitmapBefore: cloneBitmap(layer.bitmap),
      lastPoint: point,
      dabIndex: 0,
      seed: Date.now() % 100000,
      sampleColor: null,
      erasedPixels: 0,
    };
    paintBackgroundEraserPoint(env, layer, layer.bitmap, point, event);
    env.requestRender();
  },

  onPointerMove(env, point, _mods, event) {
    const activeStroke = backgroundEraserStroke;
    if (!activeStroke) return;
    const layer = env.doc.layers.find((l) => l.id === activeStroke.layerId);
    if (!layer?.bitmap) return;
    const settings = normalizedBrushSettings(env.brushSettings);
    const smoothedPoint = smoothBrushPoint(activeStroke.lastPoint, point, settings.smoothing);
    paintBackgroundEraserPoint(env, layer, layer.bitmap, smoothedPoint, event);
    activeStroke.lastPoint = smoothedPoint;
    env.requestRender();
  },

  onPointerUp(env) {
    const activeStroke = backgroundEraserStroke;
    if (!activeStroke) return;
    const layer = env.doc.layers.find((l) => l.id === activeStroke.layerId);
    if (activeStroke.erasedPixels > 0 && layer?.bitmap) {
      env.pushOperation({
        kind: 'paint',
        docId: env.doc.id,
        layerId: layer.id,
        before: activeStroke.bitmapBefore,
        after: cloneBitmap(layer.bitmap),
      });
      env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
      env.store.markDocumentDirty(env.doc.id);
    }
    backgroundEraserStroke = null;
  },

  onCancel(env) {
    const activeStroke = backgroundEraserStroke;
    if (!activeStroke) return;
    const layer = env.doc.layers.find((l) => l.id === activeStroke.layerId);
    if (layer?.bitmap) {
      const ctx = layer.bitmap.getContext('2d');
      ctx?.drawImage(activeStroke.bitmapBefore, 0, 0);
      env.requestRender();
    }
    backgroundEraserStroke = null;
  },
};

export const magicEraserTool: ToolHandler = {
  onPointerDown(env, point) {
    if (env.store.quickMaskSettings.enabled) return;
    if ((env.doc.activeLayerEditTarget ?? 'layer') !== 'layer') return;
    if (getImageChannelEditTarget(env.doc).channel !== 'rgb') return;

    const layer = ensureLayer(env);
    if (!canEditImageLayerPixels(layer) || !layer.bitmap) return;
    if (!isMagicEraserResourceBounded(layer.bitmap.width, layer.bitmap.height)) return;

    const before = cloneBitmap(layer.bitmap);
    const result = applyMagicEraserToBitmap(layer.bitmap, {
      x: point.x - layer.x,
      y: point.y - layer.y,
    }, {
      tolerance: env.selectionToolSettings.magicWandTolerance,
      contiguous: env.selectionToolSettings.contiguous,
      edgeCleanup: env.selectionToolSettings.antiAlias,
      selection: getSelection(env.doc.id),
      selectionOffset: { x: layer.x, y: layer.y },
    });
    if (result.removedPixels <= 0) return;

    env.pushOperation({
      kind: 'paint',
      docId: env.doc.id,
      layerId: layer.id,
      before,
      after: cloneBitmap(layer.bitmap),
    });
    env.store.bumpLayerBitmapVersion(env.doc.id, layer.id);
    env.store.markDocumentDirty(env.doc.id);
    env.requestRender();
  },
};

function paintBackgroundEraserPoint(
  env: ToolEnv,
  layer: ImageLayer,
  bitmap: OffscreenCanvas,
  point: Point,
  _event: PointerEvent,
): void {
  const activeStroke = backgroundEraserStroke;
  if (!activeStroke) return;
  const settings = normalizedBrushSettings(env.brushSettings);
  const result = applyBackgroundEraserToBitmap(bitmap, {
    x: point.x - layer.x,
    y: point.y - layer.y,
  }, {
    brushSize: settings.size,
    tolerance: env.selectionToolSettings.backgroundEraserTolerance ?? 32,
    contiguous: env.selectionToolSettings.backgroundEraserContiguous ?? true,
    sampling: env.selectionToolSettings.backgroundEraserSampling ?? 'once',
    useBackgroundSwatch: env.selectionToolSettings.backgroundEraserUseBackgroundSwatch ?? false,
    limits: env.selectionToolSettings.backgroundEraserLimits ?? 'contiguous',
    protectForeground: env.selectionToolSettings.backgroundEraserProtectForeground ?? false,
    foregroundColor: settings.color,
    backgroundColor: env.backgroundColor,
    sampleColor: (env.selectionToolSettings.backgroundEraserSampling ?? 'once') === 'once'
      ? activeStroke.sampleColor ?? undefined
      : undefined,
    edgeCleanup: env.selectionToolSettings.antiAlias,
  });
  if (!activeStroke.sampleColor) {
    activeStroke.sampleColor = result.sampleColor;
  }
  activeStroke.erasedPixels += result.removedPixels;
}

export function applyBackgroundEraserToBitmap(
  bitmap: OffscreenCanvas,
  seed: Point,
  options: BackgroundEraserApplyOptions = {},
): BackgroundEraserApplyResult {
  const imageData = getBitmapImageData(bitmap);
  const result = applyBackgroundEraserToImageData(imageData, seed, options);
  if (result.removedPixels > 0) {
    putBitmapImageData(bitmap, imageData);
  }
  return result;
}

export function applyBackgroundEraserToImageData(
  imageData: ImageData,
  seed: Point,
  options: BackgroundEraserApplyOptions = {},
): BackgroundEraserApplyResult {
  const x = Math.floor(seed.x);
  const y = Math.floor(seed.y);
  const brushSize = normalizeBrushSize(options.brushSize ?? 12);
  const tolerance = normalizeMagicEraserTolerance(options.tolerance ?? 32);
  const sampling = options.sampling ?? 'once';
  const limits = options.limits ?? (options.contiguous ?? true ? 'contiguous' : 'discontiguous');
  const contiguous = options.contiguous ?? limits === 'contiguous';
  const protectForeground = options.protectForeground ?? false;
  const emptySample = { r: 0, g: 0, b: 0, a: 0 };
  const foregroundColor = parseCssHexColor(options.foregroundColor);
  const backgroundColor = parseCssHexColor(options.backgroundColor);

  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return buildBackgroundEraserApplyResult(
      imageData,
      x,
      y,
      brushSize,
      tolerance,
      contiguous,
      sampling,
      options.useBackgroundSwatch ? 'swatch' : 'sample',
      limits,
      protectForeground,
      options.useBackgroundSwatch && backgroundColor ? backgroundColor : emptySample,
      0,
      null,
    );
  }

  const seedColor = readImageDataColor(imageData, x, y);
  const sampleColor = options.useBackgroundSwatch && backgroundColor
    ? backgroundColor
    : options.sampleColor ?? seedColor;

  const candidate = buildBackgroundEraserCandidateMask(imageData, x, y, brushSize, sampleColor, tolerance);
  const target = createMask(imageData.width, imageData.height);
  if (contiguous || limits === 'contiguous') {
    setBrushBoundedFloodFill(target, candidate, x, y);
  } else {
    target.data.set(candidate.data);
  }

  let removedPixels = 0;
  const cleared = new Uint8Array(imageData.width * imageData.height);
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < imageData.height; py += 1) {
    for (let px = 0; px < imageData.width; px += 1) {
      const maskIndex = py * imageData.width + px;
      if (target.data[maskIndex] <= 0) continue;
      const offset = maskIndex * 4;
      const alpha = imageData.data[offset + 3] ?? 0;
      if (alpha <= 0) continue;
      const pixelColor = readImageDataColor(imageData, px, py);
      if (protectForeground && foregroundColor && colorDistance(pixelColor, foregroundColor) <= tolerance) continue;
      imageData.data[offset + 3] = 0;
      cleared[maskIndex] = 1;
      removedPixels += 1;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  const bounds = removedPixels > 0
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
  const edgeCleanupPixels = options.edgeCleanup === true && removedPixels > 0
    ? applyEraserAlphaEdgeCleanup(imageData, cleared)
    : 0;
  return buildBackgroundEraserApplyResult(
    imageData,
    x,
    y,
    brushSize,
    tolerance,
    contiguous,
    sampling,
    options.useBackgroundSwatch ? 'swatch' : 'sample',
    limits,
    protectForeground,
    sampleColor,
    removedPixels,
    bounds,
    edgeCleanupPixels,
    options.edgeCleanup === true,
  );
}

export function applyMagicEraserToBitmap(
  bitmap: OffscreenCanvas,
  seed: Point,
  options: MagicEraserApplyOptions = {},
): MagicEraserApplyResult {
  if (!isMagicEraserResourceBounded(bitmap.width, bitmap.height)) {
    return buildMagicEraserResourceLimitResult(bitmap.width, bitmap.height, seed, options);
  }
  const imageData = getBitmapImageData(bitmap);
  const result = applyMagicEraserToImageData(imageData, seed, options);
  if (result.removedPixels > 0) {
    putBitmapImageData(bitmap, imageData);
  }
  return result;
}

export function applyMagicEraserToImageData(
  imageData: ImageData,
  seed: Point,
  options: MagicEraserApplyOptions = {},
): MagicEraserApplyResult {
  const x = Math.floor(seed.x);
  const y = Math.floor(seed.y);
  const tolerance = normalizeMagicEraserTolerance(options.tolerance ?? 32);
  const contiguous = options.contiguous ?? true;
  const emptySeed = { r: 0, g: 0, b: 0, a: 0 };
  if (!isMagicEraserResourceBounded(imageData.width, imageData.height)) {
    return buildMagicEraserResourceLimitResult(imageData.width, imageData.height, { x, y }, options);
  }

  if (x < 0 || y < 0 || x >= imageData.width || y >= imageData.height) {
    return buildMagicEraserApplyResult(imageData, x, y, tolerance, contiguous, emptySeed, 0, null);
  }

  const seedOffset = (y * imageData.width + x) * 4;
  const seedColor = {
    r: imageData.data[seedOffset] ?? 0,
    g: imageData.data[seedOffset + 1] ?? 0,
    b: imageData.data[seedOffset + 2] ?? 0,
    a: imageData.data[seedOffset + 3] ?? 0,
  };
  if (seedColor.a <= 0) {
    return buildMagicEraserApplyResult(imageData, x, y, tolerance, contiguous, seedColor, 0, null);
  }
  if (magicEraserSelectionCoverage(options.selection, options.selectionOffset, x, y) <= 0) {
    return buildMagicEraserApplyResult(imageData, x, y, tolerance, contiguous, seedColor, 0, null);
  }

  const mask = createMask(imageData.width, imageData.height);
  setFloodFill(mask, imageData, x, y, tolerance, 255, contiguous);

  let removedPixels = 0;
  const cleared = new Uint8Array(imageData.width * imageData.height);
  let minX = imageData.width;
  let minY = imageData.height;
  let maxX = -1;
  let maxY = -1;
  for (let py = 0; py < imageData.height; py += 1) {
    for (let px = 0; px < imageData.width; px += 1) {
      const maskIndex = py * imageData.width + px;
      if (mask.data[maskIndex] <= 0) continue;
      const offset = maskIndex * 4;
      const alpha = imageData.data[offset + 3] ?? 0;
      if (alpha <= 0) continue;
      const coverage = magicEraserSelectionCoverage(options.selection, options.selectionOffset, px, py);
      if (coverage <= 0) continue;
      const nextAlpha = coverage >= 255 ? 0 : Math.round(alpha * (1 - coverage / 255));
      if (nextAlpha >= alpha) continue;
      imageData.data[offset + 3] = nextAlpha;
      // Edge cleanup may only soften around fully cleared pixels.  A partially
      // selected pixel is already its own anti-aliased edge and must not bleed
      // alpha reduction outside the selection.
      if (nextAlpha <= 0) cleared[maskIndex] = 1;
      removedPixels += 1;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  const bounds = removedPixels > 0
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;
  const edgeCleanupPixels = options.edgeCleanup === true && removedPixels > 0
    ? applyEraserAlphaEdgeCleanup(imageData, cleared, options.selection, options.selectionOffset)
    : 0;
  return buildMagicEraserApplyResult(
    imageData,
    x,
    y,
    tolerance,
    contiguous,
    seedColor,
    removedPixels,
    bounds,
    edgeCleanupPixels,
    options.edgeCleanup === true,
  );
}

export function describeBrushAndEraserToolWorkflow<TSettings extends Partial<BrushSettings>>(
  settings: TSettings = {} as TSettings,
  options: DescribeBrushAndEraserToolWorkflowOptions = {},
): BrushEraserWorkflowDescriptor {
  const normalized = normalizeBrushSettings(settings);
  const activeRoute = options.quickMaskEnabled ? 'quick-mask' : options.activeRoute ?? 'pixel-layer';
  const channel = options.channel ?? 'rgb';
  const preview = buildBrushStrokePreviewMetadata(
    options.previewFrom ?? { x: 0, y: 0 },
    options.previewTo ?? { x: Math.max(1, normalized.size), y: 0 },
    normalized,
    {
      pressure: options.pressure ?? 1,
      seed: options.seed ?? 0,
      maxDabs: 8,
    },
  );
  const backgroundEraserWarning = buildBrushEraserToolWarning(
    'background-eraser-heuristic-limits',
    'Background Eraser is bounded to active pixel-layer alpha clearing; sampling, limits, and protect-foreground are heuristic RGB-distance controls.',
  );
  const advancedDynamicWarnings = getUnsupportedBrushCapabilityWarnings(settings).map((warning): BrushEraserToolWarning => ({
    code: 'advanced-dynamics-unsupported',
    field: warning.field,
    category: warning.category,
    message: warning.message,
  }));
  const warnings = [
    backgroundEraserWarning,
    ...advancedDynamicWarnings,
  ];
  const symmetryMode = normalized.symmetryMode ?? 'none';
  const descriptor: Omit<BrushEraserWorkflowDescriptor, 'signature'> = {
    descriptorId: 'image-brush-eraser-workflow:v1',
    version: 1,
    deterministic: true,
    activeRoute,
    tools: {
      brush: buildBrushToolDescriptor(activeRoute, channel),
      eraser: buildEraserToolDescriptor(activeRoute, channel),
      backgroundEraser: buildBackgroundEraserToolDescriptor(
        activeRoute,
        backgroundEraserWarning,
        {
          tolerance: normalizeMagicEraserTolerance(options.backgroundEraserTolerance ?? 32),
          contiguous: options.backgroundEraserContiguous ?? true,
          sampling: options.backgroundEraserSampling ?? 'once',
          useBackgroundSwatch: options.backgroundEraserUseBackgroundSwatch ?? false,
          limits: options.backgroundEraserLimits ?? 'contiguous',
          protectForeground: options.backgroundEraserProtectForeground ?? false,
          foregroundColor: options.backgroundEraserForegroundColor ?? null,
        },
      ),
      magicEraser: buildMagicEraserToolDescriptor(
        activeRoute,
        normalizeMagicEraserTolerance(options.magicEraserTolerance ?? 32),
        options.magicEraserContiguous ?? true,
      ),
    },
    behavior: {
      opacity: { value: normalized.opacity, affects: ['dab-alpha'] },
      flow: { value: normalized.flow, affects: ['dab-build-up'] },
      hardness: { value: normalized.hardness, affects: ['dab-edge-falloff'] },
      smoothing: {
        value: normalized.smoothing,
        followFactor: preview.smoothing.followFactor,
      },
      symmetry: {
        mode: symmetryMode,
        axes: symmetryMode === 'both'
          ? ['vertical', 'horizontal']
          : symmetryMode === 'vertical' || symmetryMode === 'horizontal'
            ? [symmetryMode]
            : [],
        mirroredDabMultiplier: symmetryMode === 'both'
          ? 4
          : symmetryMode === 'vertical' || symmetryMode === 'horizontal'
            ? 2
            : 1,
      },
    },
    preview: {
      deterministic: true,
      from: preview.from,
      to: preview.to,
      smoothedTo: preview.smoothedTo,
      seed: preview.randomization.seed,
      pressure: preview.pressure.resolved,
      dabCount: preview.spacing.dabCount,
      sampleDabCount: preview.dabPreview.length,
      activeRoute,
      channel,
      signature: preview.signature,
    },
    warnings,
  };

  return {
    ...descriptor,
    signature: buildBrushEraserWorkflowSignature(descriptor, normalized),
  };
}

// Used by tablet integration to enable pressure modulation without writing
// back to the store (avoiding the historical feedback loop).
export function readPressure(event: PointerEvent): number {
  return readBrushPressure(event);
}

// Touch-up modifier handler — `[` / `]` adjust brush size.
export function brushKeyResize(env: ToolEnv, key: string): boolean {
  if (key === '[') {
    env.store.setBrushSettings({
      size: Math.max(1, env.brushSettings.size - 2),
    });
    return true;
  }
  if (key === ']') {
    env.store.setBrushSettings({
      size: Math.min(512, env.brushSettings.size + 2),
    });
    return true;
  }
  return false;
}

function paintDabs(
  context: OffscreenCanvasRenderingContext2D,
  dabs: ReturnType<typeof buildBrushDabs>,
  layer: ImageLayer,
  color: string,
  compositeOperation: GlobalCompositeOperation,
): void {
  context.save();
  context.translate(-layer.x, -layer.y);
  for (const dab of dabs) {
    paintBrushDab(context, dab, color, compositeOperation);
  }
  context.restore();
}

function applyColorChannelRoute(
  before: ImageData,
  after: ImageData,
  components: ReturnType<typeof getImageChannelEditTarget>['components'],
): void {
  const editable = new Set(components);
  for (let offset = 0; offset < after.data.length; offset += 4) {
    if (!editable.has('red')) {
      after.data[offset] = before.data[offset] ?? after.data[offset];
    }
    if (!editable.has('green')) {
      after.data[offset + 1] = before.data[offset + 1] ?? after.data[offset + 1];
    }
    if (!editable.has('blue')) {
      after.data[offset + 2] = before.data[offset + 2] ?? after.data[offset + 2];
    }
    after.data[offset + 3] = before.data[offset + 3] ?? after.data[offset + 3];
  }
}

function buildBrushToolDescriptor(
  activeRoute: BrushEraserWorkflowRoute,
  channel: BrushEraserChannel,
): BrushEraserToolDescriptor {
  return {
    status: 'supported',
    operation: 'paint-color',
    routes: {
      pixelLayer: buildRouteDescriptor('pixel-layer', activeRoute, {
        channel: 'rgb',
        compositing: 'source-over',
      }),
      rgbChannel: buildRouteDescriptor('rgb-channel', activeRoute, {
        channel,
        compositing: 'source-over',
      }),
      layerMask: buildRouteDescriptor('layer-mask', activeRoute, {
        brushTarget: 'reveal-or-conceal-from-color',
      }),
      quickMask: buildRouteDescriptor('quick-mask', activeRoute, {
        brushTarget: 'selection-coverage-from-color',
      }),
    },
    warnings: [],
  };
}

function buildEraserToolDescriptor(
  activeRoute: BrushEraserWorkflowRoute,
  channel: BrushEraserChannel,
): BrushEraserToolDescriptor {
  return {
    status: 'supported',
    operation: 'remove-pixels-or-reveal-masks',
    routes: {
      pixelLayer: buildRouteDescriptor('pixel-layer', activeRoute, {
        channel: 'rgb',
        compositing: 'destination-out',
      }),
      rgbChannel: buildRouteDescriptor('rgb-channel', activeRoute, {
        channel,
        compositing: 'source-over-channel-route',
      }),
      layerMask: buildRouteDescriptor('layer-mask', activeRoute, {
        brushTarget: 'conceal-mask',
      }),
      quickMask: buildRouteDescriptor('quick-mask', activeRoute, {
        brushTarget: 'reveal-selection-coverage',
      }),
    },
    warnings: [],
  };
}

function buildRouteDescriptor(
  route: BrushEraserWorkflowRoute,
  activeRoute: BrushEraserWorkflowRoute,
  descriptor: Omit<BrushEraserRouteDescriptor, 'supported' | 'active'>,
): BrushEraserRouteDescriptor {
  return {
    supported: true,
    active: route === activeRoute,
    ...descriptor,
  };
}

function buildBackgroundEraserToolDescriptor(
  activeRoute: BrushEraserWorkflowRoute,
  warning: BrushEraserToolWarning,
  options: {
    tolerance: number;
    contiguous: boolean;
    sampling: 'once' | 'continuous';
    useBackgroundSwatch: boolean;
    limits: 'contiguous' | 'discontiguous';
    protectForeground: boolean;
    foregroundColor: string | null;
  },
): BackgroundEraserToolDescriptor {
  return {
    status: 'partial',
    operation: 'brush-bounded-background-alpha-clear',
    routes: {
      pixelLayer: buildRouteDescriptor('pixel-layer', activeRoute, {
        channel: 'rgb',
        compositing: 'alpha-clear',
      }),
      rgbChannel: buildUnsupportedBackgroundEraserRouteDescriptor(
        'rgb-channel',
        activeRoute,
        'Background Eraser clears layer alpha only; RGB channel component editing is a no-op.',
      ),
      layerMask: buildUnsupportedBackgroundEraserRouteDescriptor(
        'layer-mask',
        activeRoute,
        'Background Eraser is limited to active pixel-layer alpha; use mask painting for layer masks.',
      ),
      quickMask: buildUnsupportedBackgroundEraserRouteDescriptor(
        'quick-mask',
        activeRoute,
        'Background Eraser is limited to active pixel-layer alpha; use QuickMask brush editing for selections.',
      ),
    },
    tolerance: {
      value: options.tolerance,
      metric: 'rgb-euclidean-distance',
    },
    matching: {
      scope: 'brush-bounded',
      contiguous: options.contiguous,
      limits: options.limits,
    },
    sampling: {
      mode: options.sampling,
      source: options.useBackgroundSwatch ? 'background-swatch' : 'pointer-sample',
    },
    protectForeground: {
      enabled: options.protectForeground,
      color: options.foregroundColor,
      semantics: 'heuristic-rgb-distance',
    },
    output: {
      target: 'active-pixel-layer-alpha',
      alpha: 0,
      undoable: true,
      edgeCleanup: {
        supported: true,
        antiAliasSetting: 'selection-anti-alias',
        model: 'one-pixel-alpha-fringe',
        fringePixels: 1,
      },
    },
    warnings: [warning],
  };
}

function buildUnsupportedBackgroundEraserRouteDescriptor(
  route: BrushEraserWorkflowRoute,
  activeRoute: BrushEraserWorkflowRoute,
  reason: string,
): UnsupportedBackgroundEraserRouteDescriptor {
  return {
    supported: false,
    active: route === activeRoute,
    reason,
  };
}

function buildMagicEraserToolDescriptor(
  activeRoute: BrushEraserWorkflowRoute,
  tolerance: number,
  contiguous: boolean,
): MagicEraserToolDescriptor {
  return {
    status: 'supported',
    operation: 'remove-contiguous-color-by-tolerance',
    routes: {
      pixelLayer: buildRouteDescriptor('pixel-layer', activeRoute, {
        channel: 'rgb',
        compositing: 'alpha-clear',
      }),
      rgbChannel: buildUnsupportedMagicEraserRouteDescriptor(
        'rgb-channel',
        activeRoute,
        'Magic Eraser clears layer alpha, not individual RGB channel components.',
      ),
      layerMask: buildUnsupportedMagicEraserRouteDescriptor(
        'layer-mask',
        activeRoute,
        'Magic Eraser is limited to active pixel-layer alpha; use mask painting for layer masks.',
      ),
      quickMask: buildUnsupportedMagicEraserRouteDescriptor(
        'quick-mask',
        activeRoute,
        'Magic Eraser is limited to active pixel-layer alpha; use Magic Wand or QuickMask brush editing for selections.',
      ),
    },
    tolerance: {
      value: tolerance,
      metric: 'rgb-euclidean-distance',
    },
    matching: {
      scope: contiguous ? 'contiguous' : 'global',
      connectivity: contiguous ? 4 : 'layer-wide',
    },
    output: {
      target: 'active-pixel-layer-alpha',
      alpha: 0,
      undoable: true,
      edgeCleanup: {
        supported: true,
        antiAliasSetting: 'selection-anti-alias',
        model: 'one-pixel-alpha-fringe',
        fringePixels: 1,
      },
    },
    warnings: [],
  };
}

function buildUnsupportedMagicEraserRouteDescriptor(
  route: BrushEraserWorkflowRoute,
  activeRoute: BrushEraserWorkflowRoute,
  reason: string,
): UnsupportedMagicEraserRouteDescriptor {
  return {
    supported: false,
    active: route === activeRoute,
    reason,
  };
}

function buildBrushEraserToolWarning(
  code: BrushEraserToolWarning['code'],
  message: string,
): BrushEraserToolWarning {
  return { code, message };
}

function buildBrushEraserWorkflowSignature(
  descriptor: Omit<BrushEraserWorkflowDescriptor, 'signature'>,
  settings: BrushSettings,
): string {
  return `image-brush-eraser-workflow:v1:${JSON.stringify({
    toolStatus: {
      brush: descriptor.tools.brush.status,
      eraser: descriptor.tools.eraser.status,
      backgroundEraser: descriptor.tools.backgroundEraser.status,
      magicEraser: descriptor.tools.magicEraser.status,
    },
    route: descriptor.activeRoute,
    channel: descriptor.preview.channel,
    quickMask: descriptor.activeRoute === 'quick-mask',
    settings: {
      size: settings.size,
      opacity: descriptor.behavior.opacity.value,
      flow: descriptor.behavior.flow.value,
      hardness: descriptor.behavior.hardness.value,
      smoothing: descriptor.behavior.smoothing.value,
      symmetry: descriptor.behavior.symmetry.mode,
    },
    preview: descriptor.preview.signature,
    warnings: descriptor.warnings.map((warning) => warning.field ?? warning.code),
  })}`;
}

function normalizeMagicEraserTolerance(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value * 1000) / 1000;
}

/** Exported for the UI entrypoint and regression tests; no image buffers are allocated here. */
export function isMagicEraserResourceBounded(width: number, height: number): boolean {
  return Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width > 0
    && height > 0
    && width <= Math.floor(MAX_MAGIC_ERASER_PIXELS / height);
}

function magicEraserSelectionCoverage(
  selection: SelectionMask | undefined,
  offset: Point | undefined,
  layerX: number,
  layerY: number,
): number {
  if (!selection) return 255;
  const x = Math.floor(layerX + (offset?.x ?? 0));
  const y = Math.floor(layerY + (offset?.y ?? 0));
  if (x < 0 || y < 0 || x >= selection.width || y >= selection.height) return 0;
  return selection.data[y * selection.width + x] ?? 0;
}

function normalizeBrushSize(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.round(value * 1000) / 1000;
}

function readImageDataColor(imageData: ImageData, x: number, y: number): RgbaColor {
  const offset = (y * imageData.width + x) * 4;
  return {
    r: imageData.data[offset] ?? 0,
    g: imageData.data[offset + 1] ?? 0,
    b: imageData.data[offset + 2] ?? 0,
    a: imageData.data[offset + 3] ?? 0,
  };
}

function buildBackgroundEraserCandidateMask(
  imageData: ImageData,
  centerX: number,
  centerY: number,
  brushSize: number,
  sampleColor: RgbaColor,
  tolerance: number,
): SelectionMask {
  const mask = createMask(imageData.width, imageData.height);
  const radius = brushSize / 2;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(imageData.width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(imageData.height - 1, Math.ceil(centerY + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centerX;
      const dy = y - centerY;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      const color = readImageDataColor(imageData, x, y);
      if (color.a <= 0) continue;
      if (colorDistance(color, sampleColor) <= tolerance) {
        mask.data[y * imageData.width + x] = 255;
      }
    }
  }
  return mask;
}

function setBrushBoundedFloodFill(target: SelectionMask, candidate: SelectionMask, seedX: number, seedY: number): void {
  if (seedX < 0 || seedY < 0 || seedX >= candidate.width || seedY >= candidate.height) return;
  const seedIndex = seedY * candidate.width + seedX;
  if (candidate.data[seedIndex] <= 0) return;
  const visited = new Uint8Array(candidate.width * candidate.height);
  const queue: number[] = [seedIndex];
  visited[seedIndex] = 1;
  while (queue.length) {
    const index = queue.shift() ?? 0;
    target.data[index] = 255;
    const x = index % candidate.width;
    const y = Math.floor(index / candidate.width);
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < candidate.width - 1 ? index + 1 : -1,
      y > 0 ? index - candidate.width : -1,
      y < candidate.height - 1 ? index + candidate.width : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || visited[next] || candidate.data[next] <= 0) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
}

function applyEraserAlphaEdgeCleanup(
  imageData: ImageData,
  cleared: Uint8Array,
  selection?: SelectionMask,
  selectionOffset?: Point,
): number {
  let softenedPixels = 0;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const index = y * imageData.width + x;
      if (cleared[index]) continue;
      // A selection's anti-aliased edge already attenuates the alpha edit. Do
      // not let the optional fringe pass reduce unselected/partially selected
      // neighbours after the primary selection clip has done its work.
      if (selection && magicEraserSelectionCoverage(selection, selectionOffset, x, y) < 255) continue;
      const offset = index * 4;
      const alpha = imageData.data[offset + 3] ?? 0;
      if (alpha <= 0) continue;
      const coverage = eraserEdgeCoverage(cleared, imageData.width, imageData.height, x, y);
      if (coverage <= 0) continue;
      const nextAlpha = Math.max(0, Math.round(alpha * (1 - coverage)));
      if (nextAlpha >= alpha) continue;
      imageData.data[offset + 3] = nextAlpha;
      softenedPixels += 1;
    }
  }
  return softenedPixels;
}

function eraserEdgeCoverage(
  cleared: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let orthogonalWeight = 0;
  let diagonalWeight = 0;
  if (isClearedEraserPixel(cleared, width, height, x - 1, y)) orthogonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x + 1, y)) orthogonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x, y - 1)) orthogonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x, y + 1)) orthogonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x - 1, y - 1)) diagonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x + 1, y - 1)) diagonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x - 1, y + 1)) diagonalWeight += 1;
  if (isClearedEraserPixel(cleared, width, height, x + 1, y + 1)) diagonalWeight += 1;
  return Math.min(0.75, orthogonalWeight * 0.1875 + diagonalWeight * 0.125);
}

function isClearedEraserPixel(
  cleared: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return x >= 0 && y >= 0 && x < width && y < height && cleared[y * width + x] === 1;
}

function parseCssHexColor(color: string | undefined): RgbaColor | null {
  if (!color) return null;
  const trimmed = color.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1].split('').map((part) => Number.parseInt(`${part}${part}`, 16));
    return { r: r ?? 0, g: g ?? 0, b: b ?? 0, a: 255 };
  }
  const long = /^#([0-9a-f]{6})$/i.exec(trimmed);
  if (long) {
    const value = long[1];
    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
      a: 255,
    };
  }
  return null;
}

/** Parse a CSS colour string (`rgba(...)`, `rgb(...)`, `#rgb`, `#rrggbb`) into a MixerColor
 *  (0..255, alpha 0..255). Falls back to opaque black `[0,0,0,255]` when it can't parse. */
function cssColorToRgba(css: string): MixerColor {
  const t = css.trim();
  const rgbaMatch = /rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+))?\s*\)/i.exec(t);
  if (rgbaMatch) {
    const r = Math.round(Number(rgbaMatch[1]));
    const g = Math.round(Number(rgbaMatch[2]));
    const b = Math.round(Number(rgbaMatch[3]));
    const a = rgbaMatch[4] !== undefined ? Math.round(Math.min(1, Number(rgbaMatch[4])) * 255) : 255;
    return [r, g, b, a];
  }
  if (/^#[0-9a-f]{6}$/i.test(t)) {
    return [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16), 255];
  }
  if (/^#[0-9a-f]{3}$/i.test(t)) {
    return [parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16), parseInt(t[3] + t[3], 16), 255];
  }
  return [0, 0, 0, 255];
}

function colorDistance(a: RgbaColor, b: RgbaColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function buildBackgroundEraserApplyResult(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  brushSize: number,
  tolerance: number,
  contiguous: boolean,
  sampling: BackgroundEraserApplyResult['sampling'],
  sampleSource: 'sample' | 'swatch',
  limits: BackgroundEraserApplyResult['limits'],
  protectForeground: boolean,
  sampleColor: RgbaColor,
  removedPixels: number,
  bounds: BackgroundEraserApplyResult['bounds'],
  edgeCleanupPixels = 0,
  edgeCleanupRequested = false,
): BackgroundEraserApplyResult {
  const boundsSignature = bounds
    ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
    : 'none';
  return {
    removedPixels,
    bounds,
    sampleColor,
    tolerance,
    contiguous,
    sampling,
    limits,
    protectForeground,
    edgeSummary: {
      matchingMetric: 'rgb-euclidean-distance',
      tolerance,
      matchingScope: `brush-bounded-${limits}`,
      sampleSource: sampleSource === 'swatch' ? 'background-swatch' : 'pointer-sample',
      edgeMode: edgeCleanupRequested ? 'one-pixel-alpha-fringe' : 'hard-alpha-cutout',
      antiAlias: edgeCleanupRequested,
      fringePixels: edgeCleanupRequested ? 1 : 0,
      edgeCleanupPixels,
      rgbPreserved: true,
      alphaClearValue: 0,
      boundsSignature,
    },
    signature: `background-eraser:v1:${imageData.width}x${imageData.height}:${seedX},${seedY}:${brushSize}:${tolerance}:${limits}:${sampling}:${sampleSource}:${protectForeground ? 'protected' : 'unprotected'}:${removedPixels}:${boundsSignature}${edgeCleanupRequested ? `:edge-cleanup-${edgeCleanupPixels}` : ''}`,
  };
}

function buildMagicEraserApplyResult(
  imageData: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
  contiguous: boolean,
  seedColor: MagicEraserApplyResult['seedColor'],
  removedPixels: number,
  bounds: MagicEraserApplyResult['bounds'],
  edgeCleanupPixels = 0,
  edgeCleanupRequested = false,
  resourceLimitExceeded = false,
): MagicEraserApplyResult {
  const boundsSignature = bounds
    ? `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
    : 'none';
  return {
    removedPixels,
    bounds,
    seedColor,
    tolerance,
    contiguous,
    resourceLimit: {
      maxPixels: MAX_MAGIC_ERASER_PIXELS,
      pixelCount: imageData.width * imageData.height,
      exceeded: resourceLimitExceeded,
    },
    edgeSummary: {
      matchingMetric: 'rgb-euclidean-distance',
      tolerance,
      matchingScope: contiguous ? 'contiguous' : 'global',
      connectivity: contiguous ? 4 : 'layer-wide',
      edgeMode: edgeCleanupRequested ? 'one-pixel-alpha-fringe' : 'hard-alpha-cutout',
      antiAlias: edgeCleanupRequested,
      fringePixels: edgeCleanupRequested ? 1 : 0,
      edgeCleanupPixels,
      rgbPreserved: true,
      alphaClearValue: 0,
      boundsSignature,
    },
    signature: `magic-eraser:v1:${imageData.width}x${imageData.height}:${seedX},${seedY}:${tolerance}:${contiguous ? 'contiguous' : 'global'}:${removedPixels}:${boundsSignature}${resourceLimitExceeded ? ':pixel-limit' : ''}${edgeCleanupRequested ? `:edge-cleanup-${edgeCleanupPixels}` : ''}`,
  };
}

function buildMagicEraserResourceLimitResult(
  width: number,
  height: number,
  seed: Point,
  options: MagicEraserApplyOptions,
): MagicEraserApplyResult {
  return buildMagicEraserApplyResult(
    { width, height, data: new Uint8ClampedArray() } as ImageData,
    Math.floor(seed.x),
    Math.floor(seed.y),
    normalizeMagicEraserTolerance(options.tolerance ?? 32),
    options.contiguous ?? true,
    { r: 0, g: 0, b: 0, a: 0 },
    0,
    null,
    0,
    false,
    true,
  );
}
