import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react';
import { Check, GripVertical, Pencil, X } from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { useTouchNavigationStore } from '../../store/touchNavigationStore';
import { canMoveImageLayer } from '../../lib/imageLayerLocks';
import { shouldRouteImagePointerToTouchNavigation } from '../../lib/imageTouchNavigation';
import { usePaperTouchNavigationAvailabilityDescriptor } from '../../lib/paperTouchNavigation';
import { CompositeRenderer } from './CompositeRenderer';
import { bitmapFromUrl, cloneBitmap, createBitmap } from './LayerBitmap';
import { docToScreen, fitToContainer, screenToDoc, zoomAround, type Point, type Size } from './viewport';
import { ImageEditorRulers } from './ImageEditorRulers';
import { snapGuidePosition } from './ImageRulersGuides';
import { computeBrushCursorRings } from './brushCursorGeometry';
import {
  computeBrushTiltPreview,
  resolveBrushTiltState,
  type BrushTiltDynamicsSettings,
  type BrushTiltState,
} from './brushTiltGeometry';
import { CanvasViewportGesture } from './imageCanvasGestures';
import { getSelection } from './selectionRegistry';
import {
  setTiltmarkWetActiveDocument,
  subscribeTiltmarkWetEvolution,
} from './tiltmark/TiltmarkWetEvolution';
import { composeTiltmarkSurfacePreview } from './tiltmark/TiltmarkSurfacePreview';
import { isImageTiltmarkSurface } from './tiltmark/ImageTiltmarkLayer';
import { imageCmykDocumentUsesNativeAuthority } from './cmyk/ImageCmykDocument';
import { useToolDispatcher } from './tools/dispatcher';
import { isPenSessionActive } from './tools/penTool';
import type { EditorTool, ImageDocument, ImageLayer, ImageVectorPathPoint, LayerBitmap, PixelBuffer } from '../../types/imageEditor';
import {
  getImageTextEditOverlayBounds,
  shouldRefocusTextEditorOnBlur,
  imageTextLayerContainsPoint,
} from './ImageTextPresets';
import { formatFontFamily } from '../../lib/formatFontFamily';
import { bundledFontFaceRuntimeFamilyName, bundledFontFaceStyleDescriptor, bundledFontFaceVariationSettingsCss } from '../../lib/bundledFontLibrary';
import { updateTextLayerFromStyle } from './ImageTextLayer';
import {
  calculateLayerPerspectiveValue,
  calculateLayerSkewDeg,
  calculateLayerWarpValue,
  calculateLayerRotationDeg,
  getImageLayerIntrinsicSize,
  getImageLayerTransformBounds,
  getImageLayerTransformHandlePoints,
  getImageLayerTransformRotateHandlePoint,
  getImageLayerTransformScreenBorderPoints,
  getImageLayerTransformScreenCorners,
  getImageLayerTransformShape,
  getImageLayerTransformTargetCorners,
  moveLayerDistortCornerOffset,
  resizeLayerRectFromHandle,
  type ImageLayerTransformHandle,
  type ImageLayerTransformRect,
} from './ImageLayerTransformControls';
import {
  getImageLayerPivotPoint,
  getImageLayerBitmapDrawMetrics,
  transformSourcePoint,
  resolveImageLayerTransformOrigin,
} from './ImageLayerTransform';
import { resamplePixelBuffer, syncPixelBufferProxy } from './pixels/highBitTools';
import { clonePixelBuffer } from './pixels/PixelBuffer';
import {
  createIdentityWarpMesh,
  normalizeWarpMesh,
  warpMeshNodeIndex,
  type WarpMesh,
} from './ImageWarpMesh';
import {
  applyTransformPreviewSession,
  beginTransformPreviewSession,
  beginMultiLayerTransformPreviewSession,
  cancelTransformPreviewSession,
  clearTransformPreviewSession,
  getTransformPreviewSession,
  isMultiLayerTransformSession,
  markTransformPreviewSessionStructureChange,
  markMultiLayerTransformSessionStructureChange,
  subscribeTransformPreviewSession,
  transformPreviewSessionHasPendingChanges,
} from './ImageTransformPreview';
import {
  getMultiLayerTransformPivot,
  resolveMultiLayerTransformParticipants,
  rotateSelectedLayersAroundPivot,
  scaleSelectedLayerRectsAroundPivot,
  type MultiLayerTransformParticipantPlan,
} from './ImageGroupTransform';
import {
  applySelectionTransformSession,
  cancelSelectionTransformSession,
  getSelectionTransformSession,
  updateSelectionTransformDistortCornerOffset,
  subscribeSelectionTransformSession,
  updateSelectionTransformSkew,
  updateSelectionTransformBounds,
  updateSelectionTransformRotation,
  type SelectionTransformBounds,
  type SelectionTransformCorner,
  type SelectionTransformMode,
  type SelectionTransformShape,
} from './ImageSelectionTransform';
import {
  calculateSelectionSkewDeg,
  calculateSelectionRotationDeg,
  getSelectionTransformHandlePoints,
  getSelectionTransformRotateHandlePoint,
  getSelectionTransformScreenCorners,
  getSelectionTransformScreenExtents,
  moveSelectionBounds,
  moveSelectionDistortCornerOffset,
  resizeSelectionBoundsFromHandle,
  type SelectionTransformHandle,
} from './ImageSelectionTransformControls';
import {
  buildCroppedImageDocumentState,
  clearCropPreview,
  clearPerspectiveCropPreview,
  commitPerspectiveCropPreview,
  getCropPreview,
  getPerspectiveCropPreview,
  getPerspectiveCropRefusal,
  reconcileCropPreviewMode,
  subscribeCropPreview,
  subscribePerspectiveCropPreview,
  type CropPreviewRect,
} from './tools/cropTool';
import {
  describePerspectiveCropSession,
  isPerspectiveCropQuadValid,
  type PerspectiveCropRefusalReason,
} from './tools/perspectiveCropSession';
import {
  getEditableVectorShape,
  getVectorPathDocumentPoints,
  refreshLiveImageVectorBooleanLayers,
  type ImageVectorPathHandleKind,
  updateVectorPathLayerHandle,
  updateVectorPathLayerPoint,
} from './ImageVectorShape';

const BRUSH_STATUS_TOOLS = new Set<EditorTool>([
  'brush',
  'eraser',
  'cloneStamp',
  'spotHeal',
  'blurBrush',
  'sharpenBrush',
  'smudgeBrush',
  'dodgeBrush',
  'burnBrush',
  'spongeSaturateBrush',
  'spongeDesaturateBrush',
]);
const BRUSH_SYMMETRY_TOOLS = new Set<EditorTool>(['brush', 'eraser']);

export function ImageEditorCanvas() {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Ctrl temporarily turns a paint tool into the eyedropper; the brush cursor
  // shows a sampler crosshair while it's held.
  const [eyedropperModifierHeld, setEyedropperModifierHeld] = useState(false);
  const rendererRef = useRef<CompositeRenderer | null>(null);

  useToolDispatcher({ wrapperRef, rendererRef });

  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((d) => d.id === stateSnapshot.activeDocId)
    ?? null;
  const remoteImageApplyEpoch = useImageEditorStore((s) => s.remoteImageApplyEpoch);
  // Ephemeral frame-animation playback pointer: each timer tick produces a new cursor object,
  // which re-renders here and repaints the canvas (the document itself is never rewritten by
  // playback, so the setInputs effect above deliberately does not fire on ticks).
  const animationPlayback = useImageEditorStore((s) => s.animationPlayback);
  const subscribedBrushSettings = useImageEditorStore((s) => s.brushSettings);
  const subscribedCropToolSettings = useImageEditorStore((s) => s.cropToolSettings);
  const subscribedQuickMaskSettings = useImageEditorStore((s) => s.quickMaskSettings);
  const subscribedTool = useImageEditorStore((s) => s.tool);
  const subscribedViewportContainerSize = useImageEditorStore((s) => s.viewportContainerSize);
  const imageTouchNavigation = useTouchNavigationStore((s) => s.image);
  const imageTouchNavigationAvailability = usePaperTouchNavigationAvailabilityDescriptor();
  const setViewport = useImageEditorStore((s) => s.setViewport);
  const setViewportContainerSize = useImageEditorStore((s) => s.setViewportContainerSize);
  const setDocumentDimensions = useImageEditorStore((s) => s.setDocumentDimensions);
  const addLayer = useImageEditorStore((s) => s.addLayer);
  const setActiveLayer = useImageEditorStore((s) => s.setActiveLayer);
  const updateLayer = useImageEditorStore((s) => s.updateLayer);
  const removeLayer = useImageEditorStore((s) => s.removeLayer);
  const pushOperation = useImageEditorStore((s) => s.pushOperation);
  const pendingTextEditLayerId = useImageEditorStore((s) => s.pendingTextEditLayerId);
  const setPendingTextEditLayerId = useImageEditorStore((s) => s.setPendingTextEditLayerId);
  const imageViewSettings = useImageEditorStore((s) => s.imageViewSettings);
  const showRulers = imageViewSettings.rulers;
  const [editingTextLayerId, setEditingTextLayerId] = useState<string | null>(null);
  const [editingTextDraft, setEditingTextDraft] = useState('');
  const [cropPreviewVersion, setCropPreviewVersion] = useState(0);
  const [perspectivePreviewVersion, setPerspectivePreviewVersion] = useState(0);
  const [transformPreviewVersion, setTransformPreviewVersion] = useState(0);
  const [selectionTransformPreviewVersion, setSelectionTransformPreviewVersion] = useState(0);

  const activeLayer = useMemo(() => {
    if (!activeDoc?.activeLayerId) return null;
    return activeDoc.layers.find((candidate) => candidate.id === activeDoc.activeLayerId) ?? null;
  }, [activeDoc]);
  const brushSettings = stateSnapshot.brushSettings === subscribedBrushSettings
    ? subscribedBrushSettings
    : stateSnapshot.brushSettings;
  const cropToolSettings = stateSnapshot.cropToolSettings === subscribedCropToolSettings
    ? subscribedCropToolSettings
    : stateSnapshot.cropToolSettings;
  const quickMaskSettings = stateSnapshot.quickMaskSettings === subscribedQuickMaskSettings
    ? subscribedQuickMaskSettings
    : stateSnapshot.quickMaskSettings;
  const tool = stateSnapshot.tool === subscribedTool
    ? subscribedTool
    : stateSnapshot.tool;
  const viewportContainerSize = stateSnapshot.viewportContainerSize === subscribedViewportContainerSize
    ? subscribedViewportContainerSize
    : stateSnapshot.viewportContainerSize;
  const showBrushStatus = BRUSH_STATUS_TOOLS.has(tool);
  const showBrushSymmetry = Boolean(
    activeDoc
    && BRUSH_SYMMETRY_TOOLS.has(tool)
    && brushSettings.symmetryMode
    && brushSettings.symmetryMode !== 'none',
  );
  const navigationViewSize = viewportContainerSize.width > 0 && viewportContainerSize.height > 0
    ? viewportContainerSize
    : undefined;

  const cropPreview = useMemo(() => {
    void cropPreviewVersion;
    return activeDoc ? getCropPreview(activeDoc) : null;
  }, [activeDoc, cropPreviewVersion, cropToolSettings]);
  const perspectiveCropQuad = useMemo(() => {
    void perspectivePreviewVersion;
    return activeDoc && (cropToolSettings.mode ?? 'rectangular') === 'perspective'
      ? getPerspectiveCropPreview(activeDoc)
      : null;
  }, [activeDoc, perspectivePreviewVersion, cropToolSettings]);
  const perspectiveCropRefusal = useMemo(() => {
    void perspectivePreviewVersion;
    return getPerspectiveCropRefusal(activeDoc ?? undefined);
  }, [activeDoc, perspectivePreviewVersion]);
  const perspectiveCropReady = perspectiveCropQuad !== null
    && isPerspectiveCropQuadValid(perspectiveCropQuad)
    && perspectiveCropRefusal === null;
  const perspectiveCropOutputLabel = useMemo(() => {
    if (!perspectiveCropQuad || !activeDoc) return '';
    const descriptor = describePerspectiveCropSession({
      doc: activeDoc,
      quad: perspectiveCropQuad,
      guideMode: cropToolSettings.guideMode,
    });
    return descriptor.validity.canApply ? descriptor.output.sizeLabel : 'Adjust the quad';
  }, [activeDoc, perspectiveCropQuad, cropToolSettings]);
  const perspectiveCropQuadScreenBounds = useMemo(() => {
    if (!perspectiveCropQuad || !activeDoc) return null;
    const screenPoints = perspectiveCropQuad.map((corner) => docToScreen(corner, activeDoc.viewport, navigationViewSize));
    const minX = Math.min(...screenPoints.map((point) => point.x));
    const minY = Math.min(...screenPoints.map((point) => point.y));
    const maxX = Math.max(...screenPoints.map((point) => point.x));
    const maxY = Math.max(...screenPoints.map((point) => point.y));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [activeDoc, navigationViewSize, perspectiveCropQuad]);
  const transformPreview = useMemo(() => {
    void transformPreviewVersion;
    return activeDoc ? getTransformPreviewSession(activeDoc.id) : null;
  }, [activeDoc, transformPreviewVersion]);
  const selectionTransformPreview = useMemo(() => {
    void selectionTransformPreviewVersion;
    return activeDoc ? getSelectionTransformSession(activeDoc.id) : null;
  }, [activeDoc, selectionTransformPreviewVersion]);

  const activeTextLayer = useMemo(() => {
    const layer = activeLayer;
    return layer?.text && layer.metadata?.editableText !== false ? layer : null;
  }, [activeLayer]);
  const activeVectorPathLayer = useMemo(() => {
    if (!activeLayer) return null;
    const shape = getEditableVectorShape(activeLayer);
    return shape?.kind === 'path' ? activeLayer : null;
  }, [activeLayer]);

  const activeTextBounds = activeTextLayer && activeDoc
    ? getImageTextEditOverlayBounds(activeTextLayer, activeDoc.viewport, navigationViewSize)
    : null;
  const editingTextLayer = activeDoc?.layers.find((layer) => layer.id === editingTextLayerId) ?? null;
  const editingTextBounds = editingTextLayer && activeDoc
    ? getImageTextEditOverlayBounds(editingTextLayer, activeDoc.viewport, navigationViewSize)
    : null;
  const transformPreviewLayer = activeDoc && transformPreview
    ? activeDoc.layers.find((layer) => layer.id === transformPreview.layerId) ?? null
    : null;
  const transformPreviewBounds = activeDoc && transformPreviewLayer
    ? getImageLayerTransformBounds(transformPreviewLayer, activeDoc.viewport, navigationViewSize)
    : null;
  const hasPendingTransformPreview = activeDoc ? transformPreviewSessionHasPendingChanges(activeDoc) : false;
  const selectionTransformPreviewBounds = selectionTransformPreview?.currentBounds ?? null;
  const selectionTransformPreviewShape = selectionTransformPreviewBounds
    ? {
        bounds: selectionTransformPreviewBounds,
        rotationDeg: selectionTransformPreview?.currentRotationDeg ?? 0,
        skewXDeg: selectionTransformPreview?.currentSkewXDeg ?? 0,
        skewYDeg: selectionTransformPreview?.currentSkewYDeg ?? 0,
        cornerOffsets: selectionTransformPreview?.currentCornerOffsets ?? {
          nw: { x: 0, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: 0 },
          sw: { x: 0, y: 0 },
        },
      } satisfies SelectionTransformShape
    : null;
  const selectionTransformPreviewScreenBounds = activeDoc && selectionTransformPreviewShape
    ? getSelectionTransformScreenExtents(
        getSelectionTransformScreenCorners(
          selectionTransformPreviewShape,
          activeDoc.viewport,
          (() => {
            const size = useImageEditorStore.getState().viewportContainerSize;
            return size.width > 0 && size.height > 0 ? size : undefined;
          })(),
        ),
      )
    : null;

  // Multi-selection shared-pivot transform: replaces the single-layer overlay while the
  // Move tool faces two or more selected unlocked sibling layers.
  const multiLayerTransformPlan = useMemo(
    () => (activeDoc && tool === 'move' && !editingTextLayer
      ? resolveMultiLayerTransformParticipants(activeDoc)
      : null),
    [activeDoc, tool, editingTextLayer],
  );
  const multiLayerTransformActive = Boolean(multiLayerTransformPlan?.eligible);
  const multiLayerTransformSessionBounds = activeDoc
    && transformPreview
    && isMultiLayerTransformSession(transformPreview)
    && transformPreview.participantLayerIds
    && hasPendingTransformPreview
    ? computeMultiLayerTransformScreenBounds(activeDoc, transformPreview.participantLayerIds, navigationViewSize)
    : null;
  const activeTransformActionsBounds = multiLayerTransformSessionBounds
    ? { ...multiLayerTransformSessionBounds, rotationDeg: 0 }
    : (transformPreview && transformPreviewBounds && hasPendingTransformPreview ? transformPreviewBounds : null);

  const startTextEditing = useCallback((layer: ImageLayer) => {
    if (!layer.text || layer.locked) return;
    setEditingTextLayerId(layer.id);
    setEditingTextDraft(layer.text.content);
  }, []);

  const cancelTextEditing = useCallback(() => {
    const layerId = editingTextLayerId;
    setEditingTextLayerId(null);
    setEditingTextDraft('');
    if (!layerId) return;
    // Discard a freshly-placed Type-tool layer that was dismissed before any
    // text was committed, so a stray click never leaves an empty text layer.
    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
    const layer = doc?.layers.find((candidate) => candidate.id === layerId);
    if (doc && layer?.metadata?.freshlyPlaced && !(layer.text?.content ?? '').trim()) {
      removeLayer(doc.id, layer.id);
      rendererRef.current?.requestRender();
    }
  }, [editingTextLayerId, removeLayer]);

  const commitTextEditing = useCallback(() => {
    if (!editingTextLayerId) return;
    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
    const layer = doc?.layers.find((candidate) => candidate.id === editingTextLayerId);
    if (!doc || !layer?.text || layer.locked) {
      cancelTextEditing();
      return;
    }

    if (layer.text.content === editingTextDraft) {
      cancelTextEditing();
      return;
    }

    const before = doc.layers;
    const restyled = updateTextLayerFromStyle(layer, { content: editingTextDraft });
    // Once a freshly-placed layer gets real content it becomes a normal text
    // layer; clear the flag so future edits/cancels don't discard it.
    const nextLayer = restyled.metadata?.freshlyPlaced
      ? { ...restyled, metadata: { ...restyled.metadata, freshlyPlaced: false } }
      : restyled;
    const after = doc.layers.map((candidate) => candidate.id === layer.id ? nextLayer : candidate);
    pushOperation({ kind: 'layerOp', docId: doc.id, before, after });
    updateLayer(doc.id, layer.id, nextLayer);
    cancelTextEditing();
    rendererRef.current?.requestRender();
  }, [cancelTextEditing, editingTextDraft, editingTextLayerId, pushOperation, updateLayer]);

  // The Type tool drops a new layer and flags it for editing; open the on-canvas
  // editor for it, then clear the flag so it fires exactly once per placement.
  useEffect(() => {
    if (!pendingTextEditLayerId) return;
    const layer = activeDoc?.layers.find((candidate) => candidate.id === pendingTextEditLayerId);
    if (layer?.text && !layer.locked) {
      startTextEditing(layer);
    }
    setPendingTextEditLayerId(null);
  }, [activeDoc, pendingTextEditLayerId, setPendingTextEditLayerId, startTextEditing]);

  const commitCropEditing = useCallback(() => {
    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
    const preview = doc ? getCropPreview(doc) : null;
    if (!doc || !preview) return;
    if (imageCmykDocumentUsesNativeAuthority(doc)) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
          detail: {
            tool: 'crop',
            disclosure: 'Crop is refused for native CMYK; no ink authority changed.',
          },
        }));
      }
      clearCropPreview();
      rendererRef.current?.requestRender();
      return;
    }
    const result = buildCroppedImageDocumentState(doc, preview, state.cropToolSettings);
    if (!result) return;

    state.pushOperation({
      kind: 'docResize',
      docId: doc.id,
      before: {
        width: doc.width,
        height: doc.height,
        layers: doc.layers,
        activeLayerId: doc.activeLayerId,
      },
      after: {
        width: result.width,
        height: result.height,
        layers: result.layers,
        activeLayerId: result.activeLayerId,
      },
    });
    state.setLayers(doc.id, result.layers, result.activeLayerId);
    state.setDocumentDimensions(doc.id, result.width, result.height);
    clearCropPreview();
    rendererRef.current?.requestRender();
  }, []);

  const cancelCropEditing = useCallback(() => {
    clearCropPreview();
    rendererRef.current?.requestRender();
  }, []);

  const commitPerspectiveCropEditing = useCallback(() => {
    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
    if (!doc) return;
    commitPerspectiveCropPreview({
      doc,
      activeLayer: doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null,
      brushSettings: state.brushSettings,
      cropToolSettings: state.cropToolSettings,
      selectionToolSettings: state.selectionToolSettings,
      screenToDoc: (point) => point,
      docToScreen: (point) => point,
      pushOperation: state.pushOperation,
      store: state,
      requestRender: (options) => rendererRef.current?.requestRender(options),
      resolveSelectionMode: () => 'replace',
    });
  }, []);

  const cancelPerspectiveCropEditing = useCallback(() => {
    clearPerspectiveCropPreview();
    rendererRef.current?.requestRender();
  }, []);

  const applyTransformEditing = useCallback(() => {
    if (!activeDoc) return;
    applyTransformPreviewSession(activeDoc.id, () => rendererRef.current?.requestRender());
  }, [activeDoc]);

  const cancelTransformEditing = useCallback(() => {
    if (!activeDoc) return;
    cancelTransformPreviewSession(activeDoc.id, () => rendererRef.current?.requestRender());
  }, [activeDoc]);

  const handleCanvasDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!activeDoc || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const docPoint = screenToDoc(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      activeDoc.viewport,
      { width: rect.width, height: rect.height },
    );
    const hitLayer = [...activeDoc.layers]
      .reverse()
      .find((layer) =>
        layer.visible &&
        !layer.locked &&
        layer.text &&
        layer.metadata?.editableText !== false &&
        imageTextLayerContainsPoint(layer, docPoint),
      );

    if (!hitLayer) return;
    event.preventDefault();
    event.stopPropagation();
    setActiveLayer(activeDoc.id, hitLayer.id);
    startTextEditing(hitLayer);
  }, [activeDoc, setActiveLayer, startTextEditing]);

  // Dropping a drag started from a ruler creates a guide at the release point
  // (snapped to the grid when snapping is on). Releasing off the document cancels.
  const handleCreateGuide = useCallback((axis: 'x' | 'y', clientX: number, clientY: number) => {
    const wrapper = wrapperRef.current;
    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === state.activeDocId);
    if (!wrapper || !doc) return;
    const rect = wrapper.getBoundingClientRect();
    const docPoint = screenToDoc(
      { x: clientX - rect.left, y: clientY - rect.top },
      doc.viewport,
      { width: rect.width, height: rect.height },
    );
    if (axis === 'y') {
      if (docPoint.y < 0 || docPoint.y > doc.height) return;
      state.addImageGuide(doc.id, 'y', snapGuidePosition(docPoint.y, state.imageViewSettings));
    } else {
      if (docPoint.x < 0 || docPoint.x > doc.width) return;
      state.addImageGuide(doc.id, 'x', snapGuidePosition(docPoint.x, state.imageViewSettings));
    }
    rendererRef.current?.requestRender();
  }, []);

  // Mount/unmount the renderer.
  useEffect(() => {
    const canvas = canvasElRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const renderer = new CompositeRenderer(canvas, wrapper);
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Engaged Tiltmark wet evolution: as smart-surface substrates keep drying,
  // recompose each layer's preview from its base + presented wet field and
  // persist throttled simulation snapshots. Idle evolution is not an undoable
  // edit, so it writes layer state directly without pushing history.
  useEffect(() => {
    const documentId = activeDoc?.id ?? null;
    setTiltmarkWetActiveDocument(documentId);
    if (!documentId) return;
    const unsubscribe = subscribeTiltmarkWetEvolution(documentId, (event) => {
      const state = useImageEditorStore.getState();
      const doc = state.documents.find((candidate) => candidate.id === documentId);
      const layer = doc?.layers.find((candidate) => candidate.id === event.layerId);
      if (!doc || !layer || !isImageTiltmarkSurface(layer)) return;
      if (event.kind === 'presented') {
        if (!layer.bitmap) return;
        composeTiltmarkSurfacePreview(layer.bitmap, layer.tiltmarkBaseBitmap, event.raster);
        state.bumpLayerBitmapVersion(doc.id, layer.id);
        rendererRef.current?.requestRender();
        return;
      }
      if (event.kind === 'settled') {
        rendererRef.current?.requestRender();
        return;
      }
      const tiltmark = layer.metadata?.tiltmark;
      state.updateLayer(doc.id, layer.id, {
        tiltmarkSimulationData: event.simulationData,
        metadata: {
          ...layer.metadata,
          tiltmark: {
            ...(tiltmark ?? { schemaVersion: 1 as const, role: 'surface' as const }),
            materialState: 'physical' as const,
            simulation: {
              format: 'tiltmark-substrate' as const,
              version: 1 as const,
              byteLength: event.simulation.byteLength,
              tileCount: event.simulation.tileCount,
              stepCount: event.simulation.stepCount,
              evolvingTileCount: event.simulation.evolvingTileCount,
              updatedAt: Date.now(),
            },
          },
        },
      });
      rendererRef.current?.requestRender();
    });
    return () => {
      unsubscribe();
      setTiltmarkWetActiveDocument(null);
    };
  }, [activeDoc?.id]);

  // Keep TopNavbar zoom controls grounded in the actual image canvas size.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const updateSize = () => {
      const rect = wrapper.getBoundingClientRect();
      setViewportContainerSize({ width: rect.width, height: rect.height });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [setViewportContainerSize]);

  // Push current doc + selection into the renderer whenever they change.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const selection = activeDoc ? getSelection(activeDoc.id) ?? null : null;
    renderer.setInputs(activeDoc, selection);
  }, [activeDoc]);

  // Cross-device sync applied remote pixels/structure: hard-invalidate the renderer's cached
  // composite. Remote flips can land at a bitmapVersion the cache already has a composite for
  // (devices bump versions independently), so the signature check alone would keep serving
  // stale pixels — the canvas stayed blank/old until the next local stroke (docs/notes/820).
  useEffect(() => {
    if (remoteImageApplyEpoch === 0) return;
    rendererRef.current?.requestRender({ invalidateBitmapCache: true });
  }, [remoteImageApplyEpoch]);

  // Repaint on every animation playback tick / pause. draw() resolves the played cel and onion
  // ghosts from the live store cursor, so no document mutation or cache invalidation is needed.
  useEffect(() => {
    rendererRef.current?.requestRender();
  }, [animationPlayback]);

  // The renderer draws the grid + guides from the view settings, but it only
  // repaints on demand — request a repaint when those settings change.
  useEffect(() => {
    rendererRef.current?.requestRender();
  }, [imageViewSettings]);

  useEffect(() => subscribeCropPreview(() => {
    setCropPreviewVersion((version) => version + 1);
  }), []);

  useEffect(() => subscribePerspectiveCropPreview(() => {
    setPerspectivePreviewVersion((version) => version + 1);
  }), []);

  useEffect(() => subscribeTransformPreviewSession(() => {
    setTransformPreviewVersion((version) => version + 1);
  }), []);

  useEffect(() => subscribeSelectionTransformSession(() => {
    setSelectionTransformPreviewVersion((version) => version + 1);
  }), []);

  useEffect(() => {
    if (tool !== 'crop' && getCropPreview()) {
      clearCropPreview();
      rendererRef.current?.requestRender();
    }
    if (tool !== 'crop' && getPerspectiveCropPreview()) {
      clearPerspectiveCropPreview();
      rendererRef.current?.requestRender();
    }
    if (tool !== 'move' && activeDoc && getTransformPreviewSession(activeDoc.id)) {
      applyTransformPreviewSession(activeDoc.id, () => rendererRef.current?.requestRender());
    }
    if (tool !== 'move' && activeDoc && getSelectionTransformSession(activeDoc.id)) {
      applySelectionTransformSession(activeDoc.id, () => rendererRef.current?.requestRender());
    }
  }, [activeDoc, tool]);

  useEffect(() => {
    if (tool !== 'crop') return;
    reconcileCropPreviewMode(cropToolSettings.mode);
    rendererRef.current?.requestRender();
  }, [cropToolSettings.mode, tool]);

  useEffect(() => {
    if (tool === 'crop' && activeDoc && (getCropPreview(activeDoc) || getPerspectiveCropPreview(activeDoc))) {
      rendererRef.current?.requestRender();
    }
  }, [activeDoc, cropToolSettings, tool]);

  useEffect(() => {
    rendererRef.current?.requestRender();
  }, [quickMaskSettings]);

  // Bootstrap a source-bin-backed document by loading the image into a layer
  // and fitting the viewport.
  useEffect(() => {
    if (!activeDoc) return;
    if (activeDoc.layers.length > 0) return;
    if (!activeDoc.sourceBinItemId) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const sourceItem = useSourceBinStore
      .getState()
      .bins.flatMap((bin) => bin.items)
      .find((candidate) => candidate.id === activeDoc.sourceBinItemId);

    if (!sourceItem?.assetUrl) return;

    let cancelled = false;
    void (async () => {
      try {
        const bitmap = await bitmapFromUrl(sourceItem.assetUrl!);
        if (cancelled) return;

        const docId = activeDoc.id;
        setDocumentDimensions(docId, bitmap.width, bitmap.height);

        const layer: ImageLayer = {
          id: `layer-${Date.now()}`,
          name: sourceItem.label ?? 'Background',
          type: 'image',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          x: 0,
          y: 0,
          bitmap,
          bitmapVersion: 0,
          mask: null,
        };
        addLayer(docId, layer);

        const container = renderer.getCssSize();
        const viewport = fitToContainer(
          { width: bitmap.width, height: bitmap.height },
          container,
        );
        setViewport(docId, viewport);
      } catch {
        // Failed to load source image; leave the doc empty.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDoc, addLayer, setDocumentDimensions, setViewport]);

  // Auto-fit viewport when doc dimensions become known and viewport is still
  // at its default (zoom 1, no pan).
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !activeDoc) return;
    const isDefaultViewport =
      activeDoc.viewport.zoom === 1 &&
      activeDoc.viewport.panX === 0 &&
      activeDoc.viewport.panY === 0;
    if (!isDefaultViewport) return;
    const container = renderer.getCssSize();
    if (container.width <= 1 || container.height <= 1) return;
    const fit = fitToContainer(
      { width: activeDoc.width, height: activeDoc.height },
      container,
    );
    setViewport(activeDoc.id, fit);
  }, [activeDoc, setViewport]);

  // Wheel-zoom + space-drag pan + pinch-zoom.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const onWheel = (event: WheelEvent) => {
      const state = useImageEditorStore.getState();
      const doc = state.documents.find((d) => d.id === state.activeDocId);
      if (!doc) return;
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      // ctrl-wheel = fine zoom; plain wheel zooms in larger increments.
      const stepFactor = event.ctrlKey || event.metaKey ? 1.05 : 1.15;
      const factor = event.deltaY < 0 ? stepFactor : 1 / stepFactor;
      const next = zoomAround(doc.viewport, anchor, factor, { width: rect.width, height: rect.height });
      state.setViewport(doc.id, next);
      rendererRef.current?.requestRender();
    };

    let spaceHeld = false;
    // Pan + two-finger pinch-zoom. Two fingers always pinch (ahead of single-finger pan),
    // so a pinch can't degrade into the view jumping between fingers. See imageCanvasGestures.
    const gesture = new CanvasViewportGesture({
      getViewport: () => {
        const state = useImageEditorStore.getState();
        return state.documents.find((d) => d.id === state.activeDocId)?.viewport ?? null;
      },
      setViewport: (viewport) => {
        const state = useImageEditorStore.getState();
        if (state.activeDocId) state.setViewport(state.activeDocId, viewport);
      },
      requestRender: () => rendererRef.current?.requestRender(),
      getRect: () => wrapper.getBoundingClientRect(),
      getViewSize: () => {
        const size = useImageEditorStore.getState().viewportContainerSize;
        return size.width > 0 && size.height > 0 ? { width: size.width, height: size.height } : null;
      },
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === 'Space' && !spaceHeld) {
        spaceHeld = true;
        wrapper.style.cursor = 'grab';
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceHeld = false;
        if (!gesture.isActive()) wrapper.style.cursor = '';
      }
    };
    const onDown = (event: PointerEvent) => {
      const state = useImageEditorStore.getState();
      const handToolActive = state.tool === 'hand';
      const panAllowed = shouldRouteImagePointerToTouchNavigation({
        available: imageTouchNavigationAvailability.available,
        pointerType: event.pointerType,
        settings: imageTouchNavigation,
      }) || event.button === 1 || spaceHeld || (handToolActive && event.button === 0);
      const kind = gesture.pointerDown({
        pointerType: event.pointerType,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        panAllowed,
      });
      if (kind === 'pinch' || kind === 'pan') {
        event.preventDefault();
        event.stopPropagation();
        try { wrapper.setPointerCapture(event.pointerId); } catch { /* ignore */ }
        wrapper.style.cursor = 'grabbing';
      }
    };
    const onMove = (event: PointerEvent) => {
      const kind = gesture.pointerMove({
        pointerType: event.pointerType,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
      if (kind === 'pinch' || kind === 'pan') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onUp = (event: PointerEvent) => {
      const kind = gesture.pointerUp({ pointerType: event.pointerType, pointerId: event.pointerId });
      if (kind === 'pinch' || kind === 'pan') {
        try { wrapper.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
        wrapper.style.cursor = spaceHeld || useImageEditorStore.getState().tool === 'hand' ? 'grab' : '';
      }
    };

    wrapper.addEventListener('wheel', onWheel, { passive: false });
    wrapper.addEventListener('pointerdown', onDown, { capture: true });
    wrapper.addEventListener('pointermove', onMove, { capture: true });
    wrapper.addEventListener('pointerup', onUp, { capture: true });
    wrapper.addEventListener('pointercancel', onUp, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      wrapper.removeEventListener('wheel', onWheel);
      wrapper.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions);
      wrapper.removeEventListener('pointermove', onMove, { capture: true } as EventListenerOptions);
      wrapper.removeEventListener('pointerup', onUp, { capture: true } as EventListenerOptions);
      wrapper.removeEventListener('pointercancel', onUp, { capture: true } as EventListenerOptions);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [imageTouchNavigation, imageTouchNavigationAvailability.available]);

  void docToScreen; // re-export hint for tooling

  // Track Ctrl for the brush -> eyedropper temporary-tool modifier.
  useEffect(() => {
    const sync = (event: KeyboardEvent) => setEyedropperModifierHeld(event.ctrlKey);
    window.addEventListener('keydown', sync);
    window.addEventListener('keyup', sync);
    const blur = () => setEyedropperModifierHeld(false);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', sync);
      window.removeEventListener('keyup', sync);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const brushCursorActive = BRUSH_STATUS_TOOLS.has(tool);
  const brushCursorZoom = activeDoc?.viewport.zoom ?? 1;

  return (
    <div
      ref={wrapperRef}
      className={`theme-surface relative flex-1 ${tool === 'hand' ? 'cursor-grab' : brushCursorActive ? 'cursor-none' : ''}`}
      onDoubleClick={handleCanvasDoubleClick}
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasElRef} className="block h-full w-full" style={{ touchAction: 'none' }} />

      {brushCursorActive ? (
        <BrushCursorOverlay
          angleDeg={brushSettings.angleDeg}
          eyedropper={eyedropperModifierHeld}
          hardness={brushSettings.hardness}
          roundness={brushSettings.roundness}
          sizePx={brushSettings.size * brushCursorZoom}
          square={brushSettings.tipShape === 'square'}
          tiltAngle={brushSettings.tiltAngle ?? 0.7}
          tiltRoundness={brushSettings.tiltRoundness ?? 0.6}
          tiltSize={brushSettings.tiltSize ?? 0.2}
          rotationFollowsTwist={brushSettings.rotationFollowsTwist ?? true}
          wrapperRef={wrapperRef}
        />
      ) : null}

      {brushCursorActive ? <BrushQuickSizeControl zoom={brushCursorZoom} /> : null}

      {showRulers && activeDoc ? (
        <ImageEditorRulers
          cursor={null}
          onCreateGuide={handleCreateGuide}
          viewport={activeDoc.viewport}
        />
      ) : null}

      {activeTextLayer && activeTextBounds && !editingTextLayer && !activeTextLayer.locked ? (
        <button
          className="pointer-events-auto absolute z-20 inline-flex h-8 items-center gap-1.5 rounded-md border border-cyan-300/25 bg-[#10131b]/95 px-2 text-[11px] font-semibold text-cyan-50 shadow-lg shadow-black/30 hover:border-cyan-300/55"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            startTextEditing(activeTextLayer);
          }}
          style={{
            left: Math.max(8, activeTextBounds.x),
            top: Math.max(8, activeTextBounds.y - 36),
          }}
          title="Edit text on canvas"
          type="button"
        >
          <Pencil size={12} />
          Edit Text
        </button>
      ) : null}

      {activeDoc && editingTextLayer?.text && editingTextBounds ? (
        <ImageTextEditOverlay
          bounds={editingTextBounds}
          draft={editingTextDraft}
          layer={editingTextLayer}
          onCancel={cancelTextEditing}
          onChange={setEditingTextDraft}
          onCommit={commitTextEditing}
          zoom={activeDoc.viewport.zoom}
        />
      ) : null}

      {activeDoc && activeLayer && tool === 'move' && !editingTextLayer && !multiLayerTransformActive ? (
        <ImageLayerTransformOverlay
          doc={activeDoc}
          layer={activeLayer}
          requestRender={() => rendererRef.current?.requestRender()}
          wrapperRef={wrapperRef}
        />
      ) : null}

      {activeDoc && tool === 'move' && !editingTextLayer && multiLayerTransformPlan?.eligible ? (
        <ImageMultiLayerTransformOverlay
          doc={activeDoc}
          plan={multiLayerTransformPlan}
          requestRender={() => rendererRef.current?.requestRender()}
          view={navigationViewSize}
          wrapperRef={wrapperRef}
        />
      ) : null}

      {activeDoc && activeVectorPathLayer && !editingTextLayer
        && (tool === 'move' || (tool === 'pen' && !isPenSessionActive(activeDoc.id))) ? (
        <ImageVectorPathAnchorOverlay
          doc={activeDoc}
          layer={activeVectorPathLayer}
          requestRender={() => rendererRef.current?.requestRender()}
          wrapperRef={wrapperRef}
        />
      ) : null}

      {tool === 'move' && activeTransformActionsBounds ? (
        <ImageTransformActionOverlay
          bounds={activeTransformActionsBounds}
          onApply={applyTransformEditing}
          onCancel={cancelTransformEditing}
        />
      ) : null}

      {activeDoc && tool === 'move' && selectionTransformPreview && selectionTransformPreviewBounds && selectionTransformPreviewShape && selectionTransformPreviewScreenBounds ? (
        <>
          <ImageSelectionTransformOverlay
            bounds={selectionTransformPreviewBounds}
            cornerOffsets={selectionTransformPreview.currentCornerOffsets}
            doc={activeDoc}
            mode={selectionTransformPreview.currentMode}
            rotationDeg={selectionTransformPreview.currentRotationDeg}
            requestRender={() => rendererRef.current?.requestRender()}
            skewXDeg={selectionTransformPreview.currentSkewXDeg}
            skewYDeg={selectionTransformPreview.currentSkewYDeg}
            viewport={activeDoc.viewport}
            wrapperRef={wrapperRef}
          />
          <ImageSelectionTransformActionOverlay
            bounds={selectionTransformPreviewScreenBounds}
            onApply={() => applySelectionTransformSession(activeDoc.id, () => rendererRef.current?.requestRender())}
            onCancel={() => cancelSelectionTransformSession(activeDoc.id, () => rendererRef.current?.requestRender())}
          />
        </>
      ) : null}

      {activeDoc && tool === 'crop' && cropPreview ? (
        <ImageCropActionOverlay
          onApply={commitCropEditing}
          onCancel={cancelCropEditing}
          preview={cropPreview}
          viewport={activeDoc.viewport}
          view={navigationViewSize}
        />
      ) : null}

      {activeDoc && tool === 'crop' && perspectiveCropQuad && perspectiveCropQuadScreenBounds ? (
        <ImagePerspectiveCropActionOverlay
          bounds={perspectiveCropQuadScreenBounds}
          onApply={commitPerspectiveCropEditing}
          onCancel={cancelPerspectiveCropEditing}
          outputSizeLabel={perspectiveCropOutputLabel}
          ready={perspectiveCropReady}
          refusal={perspectiveCropRefusal}
        />
      ) : null}

      {activeDoc && showBrushSymmetry ? (
        <ImageBrushSymmetryOverlay
          doc={activeDoc}
          mode={brushSettings.symmetryMode ?? 'none'}
        />
      ) : null}

      {showBrushStatus && (tool === 'cloneStamp' || (brushSettings.symmetryMode && brushSettings.symmetryMode !== 'none')) ? (
        // Size / opacity / hardness now live in the lower-left quick control, so this readout only
        // appears for the contextual hints (clone-stamp source, active symmetry) — and only then does it
        // take a row above the bottom controls on phones (md+ centres it at the bottom).
        <div className="pointer-events-none absolute bottom-20 left-1/2 max-w-[92vw] -translate-x-1/2 md:bottom-3">
          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 rounded-md border border-cyan-300/10 bg-[#1a1b23] px-3 py-1.5 text-xs text-cyan-100/50">
            {tool === 'cloneStamp' ? (
              <span className="font-medium text-cyan-200/90">Alt-click (Option-click) a source, then paint to clone</span>
            ) : null}
            {brushSettings.symmetryMode && brushSettings.symmetryMode !== 'none' ? (
              <>
                {tool === 'cloneStamp' ? <span>|</span> : null}
                <span>Symmetry: {brushSettings.symmetryMode === 'both' ? 'Four-Way' : brushSettings.symmetryMode === 'vertical' ? 'Vertical' : 'Horizontal'}</span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Photoshop/GIMP-style brush cursor: an outline that follows the pointer and
 * shows the brush size/shape (round/square, roundness, angle), replacing the
 * system cursor. Position is updated imperatively on the outer element (no
 * re-render per move); the inner element carries the React-managed shape. While
 * Ctrl is held it becomes a sampler crosshair (the eyedropper modifier).
 */
const BRUSH_QUICK_SIZE_MIN = 1;
const BRUSH_QUICK_SIZE_MAX = 512;
const BRUSH_QUICK_PREVIEW_BOX = 44;

/**
 * Always-on quick brush-size control, pinned to the lower-left of the canvas (mirroring the
 * lower-right Touch Nav button) and visible whenever a brush-class tool is active — including in
 * fullscreen with the rest of the chrome hidden, since it lives on the canvas overlay layer. Drags
 * the base brush size with a live footprint preview (scaled to the current zoom, capped to a small
 * box) and the exact size in pixels, so size can be tweaked without opening the Tool Options dialog.
 * Marked as an interaction overlay so adjusting it never paints on the canvas underneath.
 */
function BrushQuickSizeControl({ zoom }: { zoom: number }) {
  const size = useImageEditorStore((s) => s.brushSettings.size);
  const opacity = useImageEditorStore((s) => s.brushSettings.opacity);
  const hardness = useImageEditorStore((s) => s.brushSettings.hardness);
  const setBrushSettings = useImageEditorStore((s) => s.setBrushSettings);
  const roundedSize = Math.round(size);
  const opacityPct = Math.round(opacity * 100);
  const hardnessPct = Math.round(hardness * 100);
  // Footprint preview at on-screen scale, capped so large brushes still fit the swatch; the dot also
  // reflects opacity (alpha) and hardness (soft edge) so the preview shows all three at a glance —
  // which is why the separate brush-status text box is gone.
  const previewDiameter = Math.max(3, Math.min(BRUSH_QUICK_PREVIEW_BOX - 6, size * zoom));

  // Free-floating + collapsible: a left-side grip handle (same thickness as the tools dialog handle)
  // drags the whole panel and, on a tap, collapses the horizontal body leftward into just the handle.
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    moved: boolean;
  } | null>(null);

  const beginHandleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    const parentRect = parent?.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const startLeft = parentRect ? rect.left - parentRect.left : el.offsetLeft;
    const startTop = parentRect ? rect.top - parentRect.top : el.offsetTop;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft, startTop, moved: false };
    if (!pos) setPos({ left: startLeft, top: startTop });
  };
  const moveHandleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    const pw = parent?.clientWidth ?? window.innerWidth;
    const ph = parent?.clientHeight ?? window.innerHeight;
    const ew = el?.offsetWidth ?? 0;
    const eh = el?.offsetHeight ?? 0;
    setPos({
      left: Math.min(Math.max(drag.startLeft + dx, 4), Math.max(4, pw - ew - 4)),
      top: Math.min(Math.max(drag.startTop + dy, 4), Math.max(4, ph - eh - 4)),
    });
  };
  const endHandleDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) setCollapsed((value) => !value); // a tap (no drag) toggles collapse
    dragRef.current = null;
  };

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto absolute z-[65] flex items-stretch overflow-hidden rounded-2xl border border-cyan-300/20 bg-[#08111d]/90 shadow-xl shadow-black/40 backdrop-blur-md ${pos ? '' : 'bottom-3 left-3'}`}
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      data-image-canvas-interaction-overlay="true"
      data-image-brush-size-quick-slider="true"
    >
      <div
        className="flex w-5 shrink-0 cursor-grab touch-none items-center justify-center border-r border-cyan-300/15 bg-[#101826] text-cyan-200/80 active:cursor-grabbing"
        data-image-brush-quick-handle="true"
        onPointerCancel={endHandleDrag}
        onPointerDown={beginHandleDrag}
        onPointerMove={moveHandleDrag}
        onPointerUp={endHandleDrag}
        role="button"
        style={{ minHeight: '2.75rem' }}
        tabIndex={0}
        title={collapsed ? 'Brush controls — tap to expand, drag to move' : 'Brush controls — tap to collapse, drag to move'}
      >
        <GripVertical size={14} />
      </div>
      {collapsed ? null : (
        <div className="flex items-center gap-2 px-2.5 py-1.5">
          <span
            className="relative flex shrink-0 items-center justify-center rounded-full border border-cyan-300/15 bg-[#0d1320]"
            style={{ width: BRUSH_QUICK_PREVIEW_BOX, height: BRUSH_QUICK_PREVIEW_BOX }}
          >
            <span
              className="rounded-full shadow-[0_0_0_1px_rgba(8,11,18,0.9)]"
              style={{
                width: previewDiameter,
                height: previewDiameter,
                opacity: Math.max(0.12, opacity),
                background: `radial-gradient(circle, rgba(186,230,253,0.95) ${Math.max(0, hardnessPct - 15)}%, rgba(186,230,253,0) 100%)`,
              }}
            />
          </span>
          <div className="flex flex-col gap-1">
            <BrushQuickRow
              ariaLabel="Brush size"
              label="S"
              min={BRUSH_QUICK_SIZE_MIN}
              max={BRUSH_QUICK_SIZE_MAX}
              step={1}
              value={Math.min(BRUSH_QUICK_SIZE_MAX, Math.max(BRUSH_QUICK_SIZE_MIN, roundedSize))}
              display={`${roundedSize}px`}
              onChange={(value) => setBrushSettings({ size: value })}
            />
            <BrushQuickRow
              ariaLabel="Brush opacity"
              label="O"
              min={0}
              max={100}
              step={1}
              value={opacityPct}
              display={`${opacityPct}%`}
              onChange={(value) => setBrushSettings({ opacity: value / 100 })}
            />
            <BrushQuickRow
              ariaLabel="Brush hardness"
              label="H"
              min={0}
              max={100}
              step={1}
              value={hardnessPct}
              display={`${hardnessPct}%`}
              onChange={(value) => setBrushSettings({ hardness: value / 100 })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** One labelled mini-slider row inside the lower-left brush quick control (size / opacity / hardness). */
function BrushQuickRow({
  ariaLabel,
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  ariaLabel: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-1.5" title={`${ariaLabel} — drag to adjust`}>
      <span className="w-2.5 shrink-0 text-center text-[9px] font-bold text-cyan-100/45">{label}</span>
      <input
        aria-label={ariaLabel}
        className="h-1 w-20 cursor-pointer accent-cyan-300 sm:w-28"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
      <span className="w-9 shrink-0 text-right text-[10px] font-semibold tabular-nums text-cyan-100/80">
        {display}
      </span>
    </label>
  );
}

function BrushCursorOverlay({
  angleDeg,
  eyedropper,
  hardness,
  roundness,
  sizePx,
  square,
  tiltAngle,
  tiltRoundness,
  tiltSize,
  rotationFollowsTwist,
  wrapperRef,
}: {
  angleDeg: number;
  eyedropper: boolean;
  hardness: number;
  roundness: number;
  sizePx: number;
  square: boolean;
  tiltAngle: number;
  tiltRoundness: number;
  tiltSize: number;
  rotationFollowsTwist: boolean;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const footprintRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const shaftRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const tiltSettings = useMemo<BrushTiltDynamicsSettings>(
    () => ({ tiltAngle, tiltRoundness, tiltSize, rotationFollowsTwist }),
    [tiltAngle, tiltRoundness, tiltSize, rotationFollowsTwist],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const el = ref.current;
    if (!wrapper || !el || eyedropper) return undefined;

    // Live geometry is applied via direct style mutation (like the position update) to
    // avoid a React re-render on every high-frequency stylus sample.
    const applyGeometry = (event: PointerEvent) => {
      const tilt: BrushTiltState = resolveBrushTiltState({
        tiltX: event.tiltX,
        tiltY: event.tiltY,
        twist: event.twist,
        altitudeAngle: (event as PointerEvent & { altitudeAngle?: number }).altitudeAngle,
        azimuthAngle: (event as PointerEvent & { azimuthAngle?: number }).azimuthAngle,
      });
      const preview = computeBrushTiltPreview({ sizePx, baseRoundness: roundness, tilt, settings: tiltSettings });
      const rot = angleDeg + preview.footprint.rotationDeg;
      const radius = square ? '0' : '9999px';

      const footprint = footprintRef.current;
      if (footprint) {
        footprint.style.width = `${preview.footprint.width}px`;
        footprint.style.height = `${preview.footprint.height}px`;
        footprint.style.borderRadius = radius;
        footprint.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
      }
      const innerEl = innerRef.current;
      if (innerEl) {
        const showInner = hardness < 0.99;
        innerEl.style.opacity = showInner ? '1' : '0';
        innerEl.style.width = `${Math.max(2, preview.footprint.width * hardness)}px`;
        innerEl.style.height = `${Math.max(2, preview.footprint.height * hardness)}px`;
        innerEl.style.borderRadius = radius;
        innerEl.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
      }
      // Pen-shaft indicator: a stick standing out of the contact point toward the held
      // end of the pen, lengthening as the pen lays down (Krita-style 3D tip cue).
      const shaft = shaftRef.current;
      const handle = handleRef.current;
      if (shaft && handle) {
        if (preview.shaft) {
          const { angleDeg: shaftAngle, lengthPx } = preview.shaft;
          shaft.style.opacity = '1';
          shaft.style.width = `${lengthPx}px`;
          shaft.style.transform = `rotate(${shaftAngle}deg)`;
          const rad = (shaftAngle * Math.PI) / 180;
          handle.style.opacity = '1';
          handle.style.transform = `translate(${Math.cos(rad) * lengthPx}px, ${Math.sin(rad) * lengthPx}px) translate(-50%, -50%)`;
        } else {
          shaft.style.opacity = '0';
          handle.style.opacity = '0';
        }
      }
    };

    const move = (event: PointerEvent) => {
      const rect = wrapper.getBoundingClientRect();
      el.style.left = `${event.clientX - rect.left}px`;
      el.style.top = `${event.clientY - rect.top}px`;
      el.style.opacity = '1';
      applyGeometry(event);
    };
    const hide = () => { el.style.opacity = '0'; };
    wrapper.addEventListener('pointermove', move, { passive: true });
    wrapper.addEventListener('pointerenter', move, { passive: true });
    wrapper.addEventListener('pointerdown', move, { passive: true });
    wrapper.addEventListener('pointerleave', hide, { passive: true });
    return () => {
      wrapper.removeEventListener('pointermove', move);
      wrapper.removeEventListener('pointerenter', move);
      wrapper.removeEventListener('pointerdown', move);
      wrapper.removeEventListener('pointerleave', hide);
    };
  }, [wrapperRef, eyedropper, angleDeg, hardness, roundness, sizePx, square, tiltSettings]);

  // Initial (upright) geometry; the live handler refines it per pointer sample.
  const { outer, inner } = computeBrushCursorRings({ sizePx, roundness, hardness });

  if (eyedropper) {
    return (
      <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-30 opacity-0">
        <svg width="24" height="24" viewBox="0 0 24 24" style={{ transform: 'translate(-50%, -50%)' }} aria-hidden>
          <g stroke="#fff" strokeWidth="1.5" style={{ filter: 'drop-shadow(0 0 1px rgba(0,0,0,0.9))' }}>
            <line x1="12" y1="2" x2="12" y2="9" />
            <line x1="12" y1="15" x2="12" y2="22" />
            <line x1="2" y1="12" x2="9" y2="12" />
            <line x1="15" y1="12" x2="22" y2="12" />
            <circle cx="12" cy="12" r="2.5" fill="none" />
          </g>
        </svg>
      </div>
    );
  }

  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-30 opacity-0">
      {/* Pen-shaft line: anchored at the cursor point, drawn outward; hidden when upright. */}
      <div
        ref={shaftRef}
        className="absolute left-0 top-0 opacity-0"
        style={{
          height: '2.5px',
          width: '0px',
          transformOrigin: '0 50%',
          background: 'linear-gradient(90deg, rgba(80,180,255,0.95), rgba(80,180,255,0.35))',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
          borderRadius: '2px',
        }}
      />
      <div
        ref={handleRef}
        className="absolute left-0 top-0 opacity-0"
        style={{
          width: '9px',
          height: '9px',
          borderRadius: '9999px',
          background: 'rgba(80,180,255,0.95)',
          boxShadow: '0 0 0 1px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.6)',
        }}
      />
      {/* Tipped footprint (flattens + rotates with tilt/twist). Contains a top notch so
          orientation/rotation reads even for near-round tips. */}
      <div
        ref={footprintRef}
        className="absolute left-0 top-0"
        style={{
          width: `${outer.width}px`,
          height: `${outer.height}px`,
          borderRadius: square ? '0' : '9999px',
          border: '1px solid rgba(0,0,0,0.78)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.85)',
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '-6px',
            width: '2px',
            height: '7px',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.7)',
            boxShadow: '0 0 0 1px rgba(255,255,255,0.8)',
          }}
        />
      </div>
      <div
        ref={innerRef}
        className="absolute left-0 top-0"
        style={{
          width: `${inner?.width ?? 2}px`,
          height: `${inner?.height ?? 2}px`,
          opacity: inner ? 1 : 0,
          borderRadius: square ? '0' : '9999px',
          border: '1px dashed rgba(0,0,0,0.45)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.45)',
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
        }}
      />
    </div>
  );
}

export interface BrushSymmetryGuideSegment {
  start: Point;
  end: Point;
  length: number;
  angleDeg: number;
}

/**
 * Map one document-space brush symmetry axis into the actual screen-space line segment.
 * The guide is a line, not an axis-aligned box: at a rotated view its endpoints must stay
 * transformed so the DOM overlay follows the painted canvas instead of collapsing at 90°.
 */
export function getBrushSymmetryGuideSegment(
  doc: ImageDocument,
  axis: 'vertical' | 'horizontal',
  view?: { width: number; height: number },
): BrushSymmetryGuideSegment {
  const startDoc = axis === 'vertical'
    ? { x: doc.width / 2, y: 0 }
    : { x: 0, y: doc.height / 2 };
  const endDoc = axis === 'vertical'
    ? { x: doc.width / 2, y: doc.height }
    : { x: doc.width, y: doc.height / 2 };
  const start = docToScreen(startDoc, doc.viewport, view);
  const end = docToScreen(endDoc, doc.viewport, view);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  return {
    start,
    end,
    length: Math.hypot(dx, dy),
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

function brushSymmetryGuideStyle(segment: BrushSymmetryGuideSegment) {
  return {
    left: segment.start.x,
    top: segment.start.y,
    width: `${segment.length}px`,
    transform: `rotate(${segment.angleDeg}deg)`,
    transformOrigin: '0 0',
  };
}

export function ImageBrushSymmetryOverlay({
  doc,
  mode,
}: {
  doc: ImageDocument;
  mode: 'none' | 'vertical' | 'horizontal' | 'both';
}) {
  if (mode === 'none') return null;

  const viewSize = useImageEditorStore.getState().viewportContainerSize;
  const view = viewSize.width > 0 && viewSize.height > 0 ? viewSize : undefined;
  const vertical = getBrushSymmetryGuideSegment(doc, 'vertical', view);
  const horizontal = getBrushSymmetryGuideSegment(doc, 'horizontal', view);

  return (
    <div className="pointer-events-none absolute inset-0 z-10" data-image-brush-symmetry-overlay="true">
      {(mode === 'vertical' || mode === 'both') ? (
        <div
          className="absolute border-t border-dashed border-cyan-300/45"
          data-image-brush-symmetry-guide="vertical"
          style={brushSymmetryGuideStyle(vertical)}
        />
      ) : null}
      {(mode === 'horizontal' || mode === 'both') ? (
        <div
          className="absolute border-t border-dashed border-cyan-300/45"
          data-image-brush-symmetry-guide="horizontal"
          style={brushSymmetryGuideStyle(horizontal)}
        />
      ) : null}
    </div>
  );
}

interface VectorPathAnchorDragState {
  pointerId: number;
  layerId: string;
  pointIndex: number;
  handleKind: ImageVectorPathHandleKind | null;
  beforeLayers: ImageLayer[];
  moved: boolean;
}

export function ImageVectorPathAnchorOverlay({
  doc,
  layer,
  requestRender,
  wrapperRef,
}: {
  doc: ImageDocument;
  layer: ImageLayer;
  requestRender: () => void;
  wrapperRef: RefObject<HTMLDivElement | null>;
}) {
  const dragRef = useRef<VectorPathAnchorDragState | null>(null);
  const shape = getEditableVectorShape(layer);
  const points = shape?.kind === 'path' ? getVectorPathDocumentPoints(layer) : [];

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLElement>): Point | null => {
    const wrapper = wrapperRef.current;
    const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id);
    if (!wrapper || !currentDoc) return null;
    const rect = wrapper.getBoundingClientRect();
    return screenToDoc(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      currentDoc.viewport,
      { width: rect.width, height: rect.height },
    );
  }, [doc.id, wrapperRef]);

  const updateAnchorFromEvent = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);
    const currentLayer = currentDoc?.layers.find((candidate) => candidate.id === drag.layerId);
    if (!currentDoc || !currentLayer) return;

    const nextLayer = drag.handleKind
      ? updateVectorPathLayerHandle(currentLayer, drag.pointIndex, drag.handleKind, point)
      : updateVectorPathLayerPoint(currentLayer, drag.pointIndex, point);
    if (nextLayer === currentLayer) return;
    drag.moved = true;
    const afterLayers = refreshLiveImageVectorBooleanLayers(
      currentDoc.layers.map((candidate) => candidate.id === currentLayer.id ? nextLayer : candidate),
    );
    state.setLayers(currentDoc.id, afterLayers, nextLayer.id);
    requestRender();
  }, [doc.id, pointFromEvent, requestRender]);

  const startAnchorDrag = useCallback((pointIndex: number) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!shape || shape.kind !== 'path' || layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      pointIndex,
      handleKind: null,
      beforeLayers: doc.layers,
      moved: false,
    };
  }, [doc.layers, layer.id, layer.locked, shape]);

  const startBezierHandleDrag = useCallback((
    pointIndex: number,
    handleKind: ImageVectorPathHandleKind,
  ) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!shape || shape.kind !== 'path' || layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      layerId: layer.id,
      pointIndex,
      handleKind,
      beforeLayers: doc.layers,
      moved: false,
    };
  }, [doc.layers, layer.id, layer.locked, shape]);

  const finishAnchorDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);
    if (drag.moved && currentDoc) {
      state.pushOperation({
        kind: 'layerOp',
        docId: currentDoc.id,
        before: drag.beforeLayers,
        after: currentDoc.layers,
      });
    }
    dragRef.current = null;
    requestRender();
  }, [doc.id, requestRender]);

  if (!shape || shape.kind !== 'path' || points.length === 0 || !layer.visible || layer.locked) return null;

  const screenPoints = points.map((point) => toScreenVectorPathPoint(point, doc.viewport));
  const pathData = buildScreenVectorPathData(screenPoints, shape.closed);
  const bezierHandles = screenPoints.flatMap((point, pointIndex) => (
    (['inHandle', 'outHandle'] as const)
      .map((handleKind) => {
        const handle = point[handleKind];
        return handle
          ? {
              pointIndex,
              handleKind,
              anchor: point,
              handle,
            }
          : null;
      })
      .filter((handle): handle is {
        pointIndex: number;
        handleKind: ImageVectorPathHandleKind;
        anchor: ImageVectorPathPoint;
        handle: Point;
      } => Boolean(handle))
  ));

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[25]"
      data-image-canvas-interaction-overlay="true"
      data-image-vector-path-anchor-overlay="true"
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <path
          d={pathData}
          fill="none"
          stroke="rgba(251, 191, 36, 0.92)"
          strokeDasharray="4 3"
          strokeWidth="1.25"
        />
        {bezierHandles.map(({ pointIndex, handleKind, anchor, handle }) => (
          <line
            data-image-vector-path-bezier-line={`${pointIndex}-${handleKind}`}
            key={`${layer.id}-bezier-line-${pointIndex}-${handleKind}`}
            stroke="rgba(34, 211, 238, 0.72)"
            strokeDasharray="3 3"
            strokeWidth="1"
            x1={anchor.x}
            x2={handle.x}
            y1={anchor.y}
            y2={handle.y}
          />
        ))}
      </svg>
      {bezierHandles.map(({ pointIndex, handleKind, handle }) => (
        <button
          aria-label={`Move path anchor ${pointIndex + 1} ${handleKind === 'inHandle' ? 'in' : 'out'} handle`}
          className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-50 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95),0_0_10px_rgba(34,211,238,0.35)]"
          data-image-vector-path-bezier-handle={`${pointIndex}-${handleKind}`}
          key={`${layer.id}-bezier-${pointIndex}-${handleKind}`}
          onPointerDown={startBezierHandleDrag(pointIndex, handleKind)}
          onPointerMove={updateAnchorFromEvent}
          onPointerUp={finishAnchorDrag}
          onPointerCancel={finishAnchorDrag}
          style={{
            left: handle.x,
            top: handle.y,
            cursor: 'crosshair',
          }}
          title={`Move ${handleKind === 'inHandle' ? 'in' : 'out'} handle ${pointIndex + 1}`}
          type="button"
        />
      ))}
      {screenPoints.map((point, index) => (
        <button
          aria-label={`Move path anchor ${index + 1}`}
          className="pointer-events-auto absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-50 bg-amber-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95),0_0_10px_rgba(251,191,36,0.35)]"
          data-image-vector-path-anchor-handle={index}
          key={`${layer.id}-anchor-${index}`}
          onPointerDown={startAnchorDrag(index)}
          onPointerMove={updateAnchorFromEvent}
          onPointerUp={finishAnchorDrag}
          onPointerCancel={finishAnchorDrag}
          style={{
            left: point.x,
            top: point.y,
            cursor: 'move',
          }}
          title={`Move anchor ${index + 1}`}
          type="button"
        />
      ))}
    </div>
  );
}

function toScreenVectorPathPoint(
  point: ImageVectorPathPoint,
  viewport: ImageDocument['viewport'],
): ImageVectorPathPoint {
  const viewSize = useImageEditorStore.getState().viewportContainerSize;
  const view = viewSize.width > 0 && viewSize.height > 0 ? viewSize : undefined;
  const anchor = docToScreen(point, viewport, view);
  return {
    ...anchor,
    ...(point.inHandle ? { inHandle: docToScreen(point.inHandle, viewport, view) } : {}),
    ...(point.outHandle ? { outHandle: docToScreen(point.outHandle, viewport, view) } : {}),
  };
}

function buildScreenVectorPathData(points: ImageVectorPathPoint[], closed: boolean): string {
  if (points.length === 0) return 'M 0 0';
  const firstPoint = points[0]!;
  const commands = [`M ${firstPoint.x} ${firstPoint.y}`];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const point = points[index]!;
    if (previous.outHandle || point.inHandle) {
      const control1 = previous.outHandle ?? previous;
      const control2 = point.inHandle ?? point;
      commands.push(`C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${point.x} ${point.y}`);
    } else {
      commands.push(`L ${point.x} ${point.y}`);
    }
  }
  if (closed && points.length > 1) {
    const lastPoint = points[points.length - 1]!;
    if (lastPoint.outHandle || firstPoint.inHandle) {
      const control1 = lastPoint.outHandle ?? lastPoint;
      const control2 = firstPoint.inHandle ?? firstPoint;
      commands.push(`C ${control1.x} ${control1.y} ${control2.x} ${control2.y} ${firstPoint.x} ${firstPoint.y}`);
    }
    commands.push('Z');
  }
  return commands.join(' ');
}

export function ImageSelectionTransformOverlay({
  bounds,
  cornerOffsets,
  doc,
  mode,
  rotationDeg,
  requestRender,
  skewXDeg,
  skewYDeg,
  viewport,
  wrapperRef,
}: {
  bounds: SelectionTransformBounds;
  cornerOffsets: SelectionTransformShape['cornerOffsets'];
  doc: ImageDocument;
  mode: SelectionTransformMode;
  rotationDeg: number;
  requestRender: () => void;
  skewXDeg: number;
  skewYDeg: number;
  viewport: ImageDocument['viewport'];
  wrapperRef: RefObject<HTMLDivElement | null>;
}) {
  const dragRef = useRef<SelectionTransformDragState | null>(null);
  const shape: SelectionTransformShape = {
    bounds,
    rotationDeg,
    skewXDeg,
    skewYDeg,
    cornerOffsets,
  };
  const selectionTransformViewSizeState = useImageEditorStore.getState().viewportContainerSize;
  const selectionTransformViewSize = selectionTransformViewSizeState.width > 0 && selectionTransformViewSizeState.height > 0
    ? selectionTransformViewSizeState
    : undefined;
  const screenCorners = getSelectionTransformScreenCorners(shape, viewport, selectionTransformViewSize);
  const screenBounds = getSelectionTransformScreenExtents(screenCorners);
  const handlePoints = getSelectionTransformHandlePoints(screenCorners, mode);
  const rotateHandlePoint = getSelectionTransformRotateHandlePoint(screenCorners);
  const relativePoint = useCallback((point: Point) => ({
    x: point.x - screenBounds.x,
    y: point.y - screenBounds.y,
  }), [screenBounds.x, screenBounds.y]);

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLElement>): Point | null => {
    const wrapper = wrapperRef.current;
    const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id);
    if (!wrapper || !currentDoc) return null;
    const rect = wrapper.getBoundingClientRect();
    return screenToDoc(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      currentDoc.viewport,
      { width: rect.width, height: rect.height },
    );
  }, [doc.id, wrapperRef]);

  const startMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      origin: bounds,
      startPoint,
    };
  }, [bounds, pointFromEvent]);

  const startResize = useCallback((handle: SelectionTransformHandle) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      handle,
      origin: bounds,
      startPoint,
    };
  }, [bounds, pointFromEvent]);

  const startSkew = useCallback((handle: SelectionTransformHandle) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'skew',
      pointerId: event.pointerId,
      handle,
      axis: handle === 'n' || handle === 's' ? 'x' : 'y',
      origin: bounds,
      startPoint,
      startSkewXDeg: skewXDeg,
      startSkewYDeg: skewYDeg,
    };
  }, [bounds, pointFromEvent, skewXDeg, skewYDeg]);

  const startDistort = useCallback((corner: SelectionTransformCorner) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'distort',
      pointerId: event.pointerId,
      corner,
      originCornerOffsets: cornerOffsets,
      startPoint,
    };
  }, [cornerOffsets, pointFromEvent]);

  const startRotate = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      center: {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
      startPoint,
      startRotationDeg: rotationDeg,
    };
  }, [bounds, pointFromEvent, rotationDeg]);

  const continueDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = {
      x: point.x - drag.startPoint.x,
      y: point.y - drag.startPoint.y,
    };
    if (drag.kind === 'rotate') {
      const nextRotation = calculateSelectionRotationDeg({
        center: drag.center,
        startPoint: drag.startPoint,
        point,
        startRotationDeg: drag.startRotationDeg,
        snapToFifteenDegrees: event.shiftKey,
      });
      if (updateSelectionTransformRotation(doc.id, nextRotation)) {
        requestRender();
      }
      return;
    }
    if (drag.kind === 'skew') {
      const nextSkewDeg = calculateSelectionSkewDeg({
        axis: drag.axis,
        origin: drag.origin,
        delta,
        startSkewDeg: drag.axis === 'x' ? drag.startSkewXDeg : drag.startSkewYDeg,
        snapToFifteenDegrees: event.shiftKey,
      });
      if (updateSelectionTransformSkew(doc.id, drag.axis === 'x' ? { skewXDeg: nextSkewDeg } : { skewYDeg: nextSkewDeg })) {
        requestRender();
      }
      return;
    }
    if (drag.kind === 'distort') {
      const nextCornerOffsets = moveSelectionDistortCornerOffset({
        corner: drag.corner,
        originOffsets: drag.originCornerOffsets,
        delta,
      });
      if (updateSelectionTransformDistortCornerOffset(doc.id, drag.corner, nextCornerOffsets[drag.corner])) {
        requestRender();
      }
      return;
    }
    const nextBounds = drag.kind === 'move'
      ? moveSelectionBounds(drag.origin, delta)
      : resizeSelectionBoundsFromHandle({
          handle: drag.handle,
          origin: drag.origin,
        delta,
        keepAspect: event.shiftKey,
      });
    if (updateSelectionTransformBounds(doc.id, nextBounds)) {
      requestRender();
    }
  }, [doc.id, pointFromEvent, requestRender]);

  const endDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
  }, []);

  return (
    <div
      className="pointer-events-none absolute z-20"
      data-image-selection-transform-overlay="true"
      style={{
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        data-image-selection-transform-rotation-preview="true"
        height={Math.max(1, screenBounds.height)}
        width={Math.max(1, screenBounds.width)}
      >
        <polygon
          fill="rgba(103, 232, 249, 0.08)"
          points={Object.values(screenCorners).map((point) => {
            const relative = relativePoint(point);
            return `${relative.x},${relative.y}`;
          }).join(' ')}
          stroke="rgba(165, 243, 252, 0.9)"
          strokeDasharray="4 3"
          strokeWidth="1"
        />
      </svg>
      <div
        className="pointer-events-auto absolute inset-0 cursor-move"
        data-image-selection-transform-body="true"
        onPointerDown={startMove}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
      <button
        aria-label="Rotate selection"
        className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-50 bg-[#10131b] text-cyan-100 shadow-md shadow-black/40"
        data-image-selection-transform-rotate-handle="true"
        onPointerDown={startRotate}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          left: relativePoint(rotateHandlePoint).x,
          top: relativePoint(rotateHandlePoint).y,
        }}
        title="Rotate selection"
        type="button"
      >
        <span className="block h-full w-full rounded-full border border-cyan-300/60" />
      </button>
      {handlePoints.map(({ kind, handle, point, cursor }) => {
        const relative = relativePoint(point);
        const dataProps = kind === 'resize'
          ? { 'data-image-selection-transform-handle': String(handle) }
          : kind === 'skew'
            ? { 'data-image-selection-transform-skew-handle': String(handle) }
            : { 'data-image-selection-transform-distort-handle': String(handle) };
        const pointerDown = kind === 'resize'
          ? startResize(handle as SelectionTransformHandle)
          : kind === 'skew'
            ? startSkew(handle as SelectionTransformHandle)
            : startDistort(handle as SelectionTransformCorner);
        return (
          <button
            aria-label={`${kind === 'resize' ? 'Resize' : kind === 'skew' ? 'Skew' : 'Distort'} selection ${handle}`}
            className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded border border-cyan-50/80 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95)]"
            key={`${kind}-${handle}`}
            onPointerDown={pointerDown}
            onPointerMove={continueDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{
              left: relative.x,
              top: relative.y,
              cursor,
            }}
            type="button"
            {...dataProps}
          />
        );
      })}
    </div>
  );
}

export function ImageSelectionTransformActionOverlay({
  bounds,
  onApply,
  onCancel,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  onApply: () => void;
  onCancel: () => void;
}) {
  const top = bounds.y >= 42 ? bounds.y - 38 : bounds.y + bounds.height + 8;
  const left = Math.max(8, bounds.x);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-md border border-cyan-300/25 bg-[#080b12]/95 p-1 shadow-xl shadow-black/40"
      data-image-selection-transform-actions="true"
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left, top }}
    >
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/15 text-cyan-50 hover:border-cyan-300/60"
        onClick={onApply}
        title="Apply selection transform"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-rose-300/25 bg-rose-500/15 text-rose-50 hover:border-rose-300/60"
        onClick={onCancel}
        title="Cancel selection transform"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface SelectionTransformMoveDragState {
  kind: 'move';
  pointerId: number;
  origin: SelectionTransformBounds;
  startPoint: Point;
}

interface SelectionTransformRotateDragState {
  kind: 'rotate';
  pointerId: number;
  center: Point;
  startPoint: Point;
  startRotationDeg: number;
}

interface SelectionTransformResizeDragState {
  kind: 'resize';
  pointerId: number;
  handle: SelectionTransformHandle;
  origin: SelectionTransformBounds;
  startPoint: Point;
}

interface SelectionTransformSkewDragState {
  kind: 'skew';
  pointerId: number;
  handle: SelectionTransformHandle;
  axis: 'x' | 'y';
  origin: SelectionTransformBounds;
  startPoint: Point;
  startSkewXDeg: number;
  startSkewYDeg: number;
}

interface SelectionTransformDistortDragState {
  kind: 'distort';
  pointerId: number;
  corner: SelectionTransformCorner;
  originCornerOffsets: SelectionTransformShape['cornerOffsets'];
  startPoint: Point;
}

type SelectionTransformDragState =
  | SelectionTransformMoveDragState
  | SelectionTransformRotateDragState
  | SelectionTransformResizeDragState
  | SelectionTransformSkewDragState
  | SelectionTransformDistortDragState;

export type { ImageDocument };

export function ImageTextEditOverlay({
  bounds,
  draft,
  layer,
  onCancel,
  onChange,
  onCommit,
  zoom,
}: {
  bounds: NonNullable<ReturnType<typeof getImageTextEditOverlayBounds>>;
  draft: string;
  layer: ImageLayer;
  onCancel: () => void;
  onChange: (value: string) => void;
  onCommit: () => void;
  zoom: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const justOpenedRef = useRef(false);
  const text = layer.text;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    // The same pointer gesture that places the text layer finishes just after this editor
    // opens and can pull focus back to <body>. Mark a brief "just opened" window so that a
    // blur to nothing (focus fell through, not a click on a real control) is treated as
    // transient and refocused — otherwise the freshly-placed empty layer is committed-then-
    // discarded the instant it appears, and the Type tool looks completely dead.
    justOpenedRef.current = true;
    const settle = window.setTimeout(() => { justOpenedRef.current = false; }, 400);
    return () => window.clearTimeout(settle);
  }, [layer.id]);

  if (!text) return null;

  return (
    <div
      className="pointer-events-auto absolute z-30 rounded-md border border-cyan-300/45 bg-[#080b12]/75 p-1 shadow-2xl shadow-black/40"
      data-image-text-edit-overlay="true"
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        if (shouldRefocusTextEditorOnBlur(justOpenedRef.current, nextTarget)) {
          // Transient focus loss to <body> during the opening gesture — keep editing.
          const textarea = textareaRef.current;
          if (textarea) requestAnimationFrame(() => { if (textarea.isConnected) textarea.focus(); });
          return;
        }
        onCommit();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: Math.max(160, bounds.width),
        minHeight: Math.max(48, bounds.height),
        transform: `rotate(${bounds.rotationDeg}deg)`,
        transformOrigin: `${bounds.transformOriginX * 100}% ${bounds.transformOriginY * 100}%`,
      }}
    >
      <div className="mb-1 flex justify-end gap-1">
        <button
          className="flex h-6 w-6 items-center justify-center rounded border border-cyan-300/20 bg-cyan-300/15 text-cyan-50 hover:border-cyan-300/50"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCommit}
          title="Apply text edit"
          type="button"
        >
          <Check size={13} />
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded border border-rose-300/20 bg-rose-500/10 text-rose-100 hover:border-rose-300/50"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCancel}
          title="Cancel text edit"
          type="button"
        >
          <X size={13} />
        </button>
      </div>
      <textarea
        className="block w-full resize both rounded border border-cyan-300/25 bg-[#f8fafc] px-2 py-1 outline-none focus:border-cyan-300"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
            return;
          }
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onCommit();
          }
        }}
        ref={textareaRef}
        spellCheck={false}
        style={{
          color: text.color,
          fontFamily: formatFontFamily(text.managedFace
            ? bundledFontFaceRuntimeFamilyName(text.managedFace)
            : text.managedFaceIssue
              ? 'Sloom Managed Face Blocked'
              : text.fontFamily),
          fontSize: Math.max(11, text.fontSize * zoom),
          fontStyle: text.managedFace ? bundledFontFaceStyleDescriptor(text.managedFace) : text.fontStyle,
          fontWeight: text.fontWeight,
          letterSpacing: text.letterSpacing * zoom,
          lineHeight: text.lineHeight,
          minHeight: Math.max(36, bounds.height),
          textAlign: text.align === 'justify' ? 'justify' : text.align,
          fontVariantCaps: text.fontVariantCaps === 'all-small-caps' ? 'all-small-caps' : text.fontVariantCaps,
          fontVariationSettings: text.managedFace ? bundledFontFaceVariationSettingsCss(text.managedFace) : undefined,
        }}
        value={draft}
      />
    </div>
  );
}

export function ImageCropActionOverlay({
  onApply,
  onCancel,
  preview,
  viewport,
  view,
}: {
  onApply: () => void;
  onCancel: () => void;
  preview: CropPreviewRect;
  viewport: ImageDocument['viewport'];
  view?: { width: number; height: number };
}) {
  const bounds = getCropPreviewScreenBounds(preview, viewport, view);
  const top = bounds.y >= 42 ? bounds.y - 38 : bounds.y + bounds.height + 8;
  const left = Math.max(8, bounds.x);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-md border border-cyan-300/25 bg-[#080b12]/95 p-1 shadow-xl shadow-black/40"
      data-image-crop-actions="true"
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left, top }}
    >
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/15 text-cyan-50 hover:border-cyan-300/60"
        onClick={onApply}
        title="Apply crop"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-rose-300/25 bg-rose-500/15 text-rose-50 hover:border-rose-300/60"
        onClick={onCancel}
        title="Cancel crop"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Apply/Cancel controls plus live output size for the interactive perspective-crop quad. */
export function ImagePerspectiveCropActionOverlay({
  bounds,
  onApply,
  onCancel,
  outputSizeLabel,
  ready,
  refusal,
}: {
  bounds: { x: number; y: number; width: number; height: number };
  onApply: () => void;
  onCancel: () => void;
  outputSizeLabel: string;
  ready: boolean;
  refusal: PerspectiveCropRefusalReason | null;
}) {
  const top = bounds.y >= 42 ? bounds.y - 38 : bounds.y + bounds.height + 8;
  const left = Math.max(8, bounds.x);
  const refusalLabel = refusal === 'tiltmark-surface-requires-raster'
    ? 'Editable Tiltmark surfaces must Convert to Raster before a perspective crop.'
    : refusal === 'high-bit-depth-requires-native-crop'
      ? 'Refused before mutation: high-bit Perspective Crop has no native implementation; no pixels were changed.'
    : refusal === 'resource-limit-exceeded'
      ? 'Perspective crop output exceeds the safe raster allocation limit.'
    : null;

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-md border border-cyan-300/25 bg-[#080b12]/95 p-1 shadow-xl shadow-black/40"
      data-image-perspective-crop-actions="true"
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left, top }}
    >
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/15 text-cyan-50 enabled:hover:border-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!ready}
        onClick={onApply}
        title="Apply perspective crop"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-rose-300/25 bg-rose-500/15 text-rose-50 hover:border-rose-300/60"
        onClick={onCancel}
        title="Cancel perspective crop"
        type="button"
      >
        <X size={14} />
      </button>
      {outputSizeLabel ? (
        <span className="px-1 text-[11px] tabular-nums text-cyan-100/70">{outputSizeLabel}</span>
      ) : null}
      {refusalLabel ? (
        <span className="max-w-[220px] px-1 text-[10px] leading-tight text-fuchsia-200/80">{refusalLabel}</span>
      ) : null}
    </div>
  );
}

function getCropPreviewScreenBounds(
  preview: CropPreviewRect,
  viewport: ImageDocument['viewport'],
  view?: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const rotationDeg = preview.rotationDeg ?? 0;
  const center = {
    x: preview.x + preview.w / 2,
    y: preview.y + preview.h / 2,
  };
  const corners = [
    { x: preview.x, y: preview.y },
    { x: preview.x + preview.w, y: preview.y },
    { x: preview.x + preview.w, y: preview.y + preview.h },
    { x: preview.x, y: preview.y + preview.h },
  ].map((point) => docToScreen(rotateCropPoint(point, center, rotationDeg), viewport, view));

  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function rotateCropPoint(point: Point, center: Point, rotationDeg: number): Point {
  if (!Number.isFinite(rotationDeg) || rotationDeg === 0) return point;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function ImageTransformActionOverlay({
  bounds,
  onApply,
  onCancel,
}: {
  bounds: { x: number; y: number; width: number; height: number; rotationDeg: number };
  onApply: () => void;
  onCancel: () => void;
}) {
  const top = bounds.y >= 42 ? bounds.y - 38 : bounds.y + bounds.height + 8;
  const left = Math.max(8, bounds.x);

  return (
    <div
      className="pointer-events-auto absolute z-30 flex items-center gap-1 rounded-md border border-cyan-300/25 bg-[#080b12]/95 p-1 shadow-xl shadow-black/40"
      data-image-transform-actions="true"
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{ left, top }}
    >
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-cyan-300/25 bg-cyan-300/15 text-cyan-50 hover:border-cyan-300/60"
        onClick={onApply}
        title="Apply transform"
        type="button"
      >
        <Check size={14} />
      </button>
      <button
        className="flex h-7 w-7 items-center justify-center rounded border border-rose-300/25 bg-rose-500/15 text-rose-50 hover:border-rose-300/60"
        onClick={onCancel}
        title="Cancel transform"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ImageLayerTransformOverlay({
  doc,
  layer,
  requestRender,
  wrapperRef,
}: {
  doc: ImageDocument;
  layer: ImageLayer;
  requestRender: () => void;
  wrapperRef: RefObject<HTMLDivElement | null>;
}) {
  const dragRef = useRef<TransformDragState | null>(null);
  const transformViewSizeState = useImageEditorStore.getState().viewportContainerSize;
  const transformViewSize = transformViewSizeState.width > 0 && transformViewSizeState.height > 0
    ? transformViewSizeState
    : undefined;
  const bounds = getImageLayerTransformBounds(layer, doc.viewport, transformViewSize);
  const intrinsicSize = getImageLayerIntrinsicSize(layer);
  const pivot = getImageLayerPivotPoint(layer, intrinsicSize);
  const shape = getImageLayerTransformShape(layer, intrinsicSize);
  const transformPreviewSession = getTransformPreviewSession(doc.id);
  const mode = transformPreviewSession?.currentMode ?? 'resize';
  const canTransform = Boolean(bounds && intrinsicSize && pivot && layer.visible && canMoveImageLayer(layer));
  const screenCorners = shape ? getImageLayerTransformScreenCorners(shape, doc.viewport, transformViewSize) : null;
  const borderPoints = shape ? getImageLayerTransformScreenBorderPoints(shape, doc.viewport, 12, transformViewSize) : [];
  const screenBounds = shape
    ? getPointExtents(borderPoints.length > 0 ? borderPoints : Object.values(screenCorners ?? {}))
    : null;
  const handlePoints = screenCorners ? getImageLayerTransformHandlePoints(screenCorners, mode) : [];
  const rotateHandlePoint = screenCorners ? getImageLayerTransformRotateHandlePoint(screenCorners) : null;
  const perspectivePlaneGridSegments = (() => {
    if (mode !== 'perspective' || !screenCorners) return [] as Array<{ start: Point; end: Point; key: string }>;
    const interpolate = (start: Point, end: Point, t: number): Point => ({
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
    });
    const segments: Array<{ start: Point; end: Point; key: string }> = [];
    for (const t of [0.25, 0.5, 0.75]) {
      segments.push({
        start: interpolate(screenCorners.nw, screenCorners.sw, t),
        end: interpolate(screenCorners.ne, screenCorners.se, t),
        key: `horizontal-${t}`,
      });
      segments.push({
        start: interpolate(screenCorners.nw, screenCorners.ne, t),
        end: interpolate(screenCorners.sw, screenCorners.se, t),
        key: `vertical-${t}`,
      });
    }
    return segments;
  })();

  // Warp-mesh control points: in warp mode, show the full NxN deformation grid at the
  // current (warped) node positions, replacing the coarse 4-edge warp handles.
  const warpMesh = mode === 'warp' ? (normalizeWarpMesh(layer.warpMesh) ?? createIdentityWarpMesh()) : null;
  const warpMeshNodes = (() => {
    if (!warpMesh || !intrinsicSize || !layer.bitmap) return [] as { column: number; row: number; screen: Point }[];
    const metrics = getImageLayerBitmapDrawMetrics(layer.bitmap, layer);
    const nodes: { column: number; row: number; screen: Point }[] = [];
    for (let r = 0; r <= warpMesh.rows; r += 1) {
      for (let c = 0; c <= warpMesh.columns; c += 1) {
        const sx = warpMesh.columns > 0 ? (c / warpMesh.columns) * metrics.drawWidth : 0;
        const sy = warpMesh.rows > 0 ? (r / warpMesh.rows) * metrics.drawHeight : 0;
        nodes.push({ column: c, row: r, screen: docToScreen(transformSourcePoint(metrics, sx, sy), doc.viewport, transformViewSize) });
      }
    }
    return nodes;
  })();
  const warpMeshNodeScreen = (column: number, row: number): Point | null =>
    warpMeshNodes.find((n) => n.column === column && n.row === row)?.screen ?? null;
  const pivotScreenPoint = pivot ? docToScreen({ x: pivot.pivotX, y: pivot.pivotY }, doc.viewport, transformViewSize) : null;
  const relativePoint = useCallback((point: Point) => {
    if (!screenBounds) {
      return { x: 0, y: 0 };
    }
    return {
      x: point.x - screenBounds.x,
      y: point.y - screenBounds.y,
    };
  }, [screenBounds]);

  const pointFromEvent = useCallback((event: ReactPointerEvent): Point | null => {
    const wrapper = wrapperRef.current;
    const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id);
    if (!wrapper || !currentDoc) return null;
    const rect = wrapper.getBoundingClientRect();
    return screenToDoc(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      currentDoc.viewport,
      { width: rect.width, height: rect.height },
    );
  }, [doc.id, wrapperRef]);

  const startResize = useCallback((handle: ImageLayerTransformHandle) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform) return;
    const startPoint = pointFromEvent(event);
    const size = getImageLayerIntrinsicSize(layer);
    if (!startPoint || !size) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    markTransformPreviewSessionStructureChange(doc, layer);

    dragRef.current = {
      kind: 'resize',
      pointerId: event.pointerId,
      layerId: layer.id,
      handle,
      beforeLayers: doc.layers,
      origin: {
        x: layer.x,
        y: layer.y,
        width: size.width,
        height: size.height,
      },
      sourceBitmap: layer.bitmap ? cloneBitmap(layer.bitmap) : null,
      sourceMask: layer.mask ? cloneBitmap(layer.mask) : null,
      sourcePixels: layer.pixels ? clonePixelBuffer(layer.pixels) : null,
      startPoint,
      textOrigin: layer.text ?? null,
    };
  }, [canTransform, doc.layers, layer, pointFromEvent]);

  const startSkew = useCallback((handle: ImageLayerTransformHandle) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform || !intrinsicSize) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'skew',
      pointerId: event.pointerId,
      layerId: layer.id,
      axis: handle === 'n' || handle === 's' ? 'x' : 'y',
      origin: {
        x: layer.x,
        y: layer.y,
        width: intrinsicSize.width,
        height: intrinsicSize.height,
      },
      startPoint,
      startSkewXDeg: layer.skewXDeg ?? 0,
      startSkewYDeg: layer.skewYDeg ?? 0,
    };
  }, [canTransform, doc, intrinsicSize, layer, pointFromEvent]);

  const startDistort = useCallback((corner: 'nw' | 'ne' | 'se' | 'sw') => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform || !shape) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'distort',
      pointerId: event.pointerId,
      layerId: layer.id,
      corner,
      originCornerOffsets: shape.cornerOffsets,
      startPoint,
    };
  }, [canTransform, doc, layer, pointFromEvent, shape]);

  const startPerspective = useCallback((corner: 'nw' | 'ne' | 'se' | 'sw') => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform || !intrinsicSize) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'perspective',
      pointerId: event.pointerId,
      layerId: layer.id,
      corner,
      origin: {
        x: layer.x,
        y: layer.y,
        width: intrinsicSize.width,
        height: intrinsicSize.height,
      },
      startPoint,
      startPerspectiveX: layer.perspectiveX ?? 0,
      startPerspectiveY: layer.perspectiveY ?? 0,
    };
  }, [canTransform, doc, intrinsicSize, layer, pointFromEvent]);

  const startWarp = useCallback((handle: 'n' | 'e' | 's' | 'w') => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform || !intrinsicSize) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'warp',
      pointerId: event.pointerId,
      layerId: layer.id,
      handle,
      origin: {
        x: layer.x,
        y: layer.y,
        width: intrinsicSize.width,
        height: intrinsicSize.height,
      },
      startPoint,
      startWarp: {
        top: layer.warp?.top ?? 0,
        right: layer.warp?.right ?? 0,
        bottom: layer.warp?.bottom ?? 0,
        left: layer.warp?.left ?? 0,
      },
    };
  }, [canTransform, doc, intrinsicSize, layer, pointFromEvent]);

  const startWarpMesh = useCallback((column: number, row: number) => (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    if (!canTransform || !intrinsicSize) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'warpMesh',
      pointerId: event.pointerId,
      layerId: layer.id,
      column,
      row,
      origin: { x: layer.x, y: layer.y, width: intrinsicSize.width, height: intrinsicSize.height },
      rotationDeg: layer.rotationDeg ?? 0,
      startPoint,
      startMesh: normalizeWarpMesh(layer.warpMesh) ?? createIdentityWarpMesh(),
    };
  }, [canTransform, doc, intrinsicSize, layer, pointFromEvent]);

  const startRotate = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canTransform || !pivot) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const center = { x: pivot.pivotX, y: pivot.pivotY };
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      layerId: layer.id,
      before: getLayerTransformSnapshot(layer),
      center,
      startPointerDeg: calculateLayerRotationDeg(center, startPoint, false),
      startRotationDeg: layer.rotationDeg ?? 0,
    };
  }, [canTransform, layer, pivot, pointFromEvent]);

  const startPivot = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canTransform || !intrinsicSize) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginTransformPreviewSession(doc, layer);

    dragRef.current = {
      kind: 'pivot',
      pointerId: event.pointerId,
      layerId: layer.id,
      before: getLayerTransformSnapshot(layer),
      size: intrinsicSize,
    };
  }, [canTransform, intrinsicSize, layer]);

  const continueTransform = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);
    const currentLayer = currentDoc?.layers.find((candidate) => candidate.id === drag.layerId);
    if (!currentDoc || !currentLayer) return;

    if (drag.kind === 'rotate') {
      const pointerDeg = calculateLayerRotationDeg(drag.center, point, false);
      const nextRotation = normalizeTransformRotation(
        drag.startRotationDeg + pointerDeg - drag.startPointerDeg,
        event.shiftKey,
      );
      state.updateLayer(currentDoc.id, currentLayer.id, { rotationDeg: nextRotation });
      requestRender();
      return;
    }

    if (drag.kind === 'pivot') {
      const nextOriginX = clampTransformOrigin(
        drag.size.width > 0 ? (point.x - currentLayer.x) / drag.size.width : 0.5,
      );
      const nextOriginY = clampTransformOrigin(
        drag.size.height > 0 ? (point.y - currentLayer.y) / drag.size.height : 0.5,
      );
      state.updateLayer(currentDoc.id, currentLayer.id, {
        transformOriginX: nextOriginX,
        transformOriginY: nextOriginY,
      });
      requestRender();
      return;
    }

    if (drag.kind === 'skew') {
      const nextSkewDeg = calculateLayerSkewDeg({
        axis: drag.axis,
        origin: drag.origin,
        delta: { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y },
        startSkewDeg: drag.axis === 'x' ? drag.startSkewXDeg : drag.startSkewYDeg,
        snapToFifteenDegrees: event.shiftKey,
      });
      state.updateLayer(currentDoc.id, currentLayer.id, drag.axis === 'x' ? {
        skewXDeg: nextSkewDeg,
      } : {
        skewYDeg: nextSkewDeg,
      });
      requestRender();
      return;
    }

    if (drag.kind === 'distort') {
      const nextCornerOffsets = moveLayerDistortCornerOffset({
        corner: drag.corner,
        originOffsets: drag.originCornerOffsets,
        delta: { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y },
      });
      state.updateLayer(currentDoc.id, currentLayer.id, {
        cornerOffsets: nextCornerOffsets,
      });
      requestRender();
      return;
    }

    if (drag.kind === 'perspective') {
      const delta = { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y };
      state.updateLayer(currentDoc.id, currentLayer.id, {
        perspectiveX: calculateLayerPerspectiveValue({
          axis: 'x',
          corner: drag.corner,
          origin: drag.origin,
          delta,
          startPerspective: drag.startPerspectiveX,
        }),
        perspectiveY: calculateLayerPerspectiveValue({
          axis: 'y',
          corner: drag.corner,
          origin: drag.origin,
          delta,
          startPerspective: drag.startPerspectiveY,
        }),
      });
      requestRender();
      return;
    }

    if (drag.kind === 'warp') {
      const delta = { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y };
      state.updateLayer(currentDoc.id, currentLayer.id, {
        warp: {
          ...drag.startWarp,
          [drag.handle]: calculateLayerWarpValue({
            handle: drag.handle,
            origin: drag.origin,
            delta,
            startWarp: drag.startWarp[
              drag.handle === 'n'
                ? 'top'
                : drag.handle === 'e'
                  ? 'right'
                  : drag.handle === 's'
                    ? 'bottom'
                    : 'left'
            ],
          }),
        },
      });
      requestRender();
      return;
    }

    if (drag.kind === 'warpMesh') {
      const delta = { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y };
      // Inverse-rotate the doc-space drag into the layer's source-local space, then
      // normalize to the layer dimensions to update the dragged control point.
      const rad = (drag.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const sourceDx = delta.x * cos + delta.y * sin;
      const sourceDy = -delta.x * sin + delta.y * cos;
      const ndx = drag.origin.width > 0 ? sourceDx / drag.origin.width : 0;
      const ndy = drag.origin.height > 0 ? sourceDy / drag.origin.height : 0;
      const nextMesh: WarpMesh = {
        columns: drag.startMesh.columns,
        rows: drag.startMesh.rows,
        points: drag.startMesh.points.map((p) => ({ x: p.x, y: p.y })),
      };
      const idx = warpMeshNodeIndex(nextMesh, drag.column, drag.row);
      const base = drag.startMesh.points[idx] ?? { x: 0, y: 0 };
      nextMesh.points[idx] = { x: base.x + ndx, y: base.y + ndy };
      state.updateLayer(currentDoc.id, currentLayer.id, { warpMesh: nextMesh });
      requestRender();
      return;
    }

    const rect = resizeLayerRectFromHandle({
      handle: drag.handle,
      origin: drag.origin,
      delta: { x: point.x - drag.startPoint.x, y: point.y - drag.startPoint.y },
      keepAspect: event.shiftKey,
    });
    const patch: Partial<ImageLayer> = { x: rect.x, y: rect.y };

    if (drag.sourceBitmap) {
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      if (drag.sourcePixels) {
        try {
          patch.pixels = resamplePixelBuffer(drag.sourcePixels, nextWidth, nextHeight, 'bilinear');
        } catch (error) {
          discloseHighBitTransformRefusal(
            currentDoc.id,
            currentLayer.id,
            `Refused before mutation: this high-bit resize exceeds native pixel bounds (${error instanceof Error ? error.message : String(error)}).`,
          );
          return;
        }
      }
      patch.bitmap = resizeBitmapToLayerRect(drag.sourceBitmap, { ...rect, width: nextWidth, height: nextHeight });
      if (patch.pixels) {
        syncPixelBufferProxy(patch.pixels, patch.bitmap);
        patch.pixelsVersion = (currentLayer.pixelsVersion ?? currentLayer.bitmapVersion) + 1;
      }
      if (drag.sourceMask) {
        patch.mask = resizeBitmapToLayerRect(drag.sourceMask, { ...rect, width: nextWidth, height: nextHeight });
      }
    } else if (drag.textOrigin) {
      patch.text = {
        ...drag.textOrigin,
        boxWidth: rect.width,
        boxHeight: rect.height,
      };
    }

    state.updateLayer(currentDoc.id, currentLayer.id, patch);
    requestRender();
  }, [doc.id, pointFromEvent, requestRender]);

  const finishTransform = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);
    const currentLayer = currentDoc?.layers.find((candidate) => candidate.id === drag.layerId);

    if (currentDoc && currentLayer && !transformPreviewSessionHasPendingChanges(currentDoc)) {
      clearTransformPreviewSession();
    }

    dragRef.current = null;
    requestRender();
  }, [doc.id, requestRender]);

  if (!bounds || !canTransform || !shape || !screenCorners || !screenBounds || !rotateHandlePoint || !pivotScreenPoint) return null;

  const handleProps = {
    onPointerMove: continueTransform,
    onPointerUp: finishTransform,
    onPointerCancel: finishTransform,
  };

  return (
    <div
      className="pointer-events-none absolute z-20"
      data-image-layer-transform-overlay="true"
      style={{
        left: screenBounds.x,
        top: screenBounds.y,
        width: screenBounds.width,
        height: screenBounds.height,
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        data-image-layer-transform-rotation-preview="true"
        height={Math.max(1, screenBounds.height)}
        width={Math.max(1, screenBounds.width)}
      >
        <polygon
          fill="rgba(103, 232, 249, 0.08)"
          points={(borderPoints.length > 0 ? borderPoints : Object.values(screenCorners)).map((point) => {
            const relative = relativePoint(point);
            return `${relative.x},${relative.y}`;
          }).join(' ')}
          stroke="rgba(165, 243, 252, 0.9)"
          strokeDasharray="4 3"
          strokeWidth="1"
        />
      </svg>
      {perspectivePlaneGridSegments.length > 0 ? (
        <svg
          aria-label="Perspective plane grid"
          className="pointer-events-none absolute inset-0 overflow-visible"
          data-image-layer-perspective-plane-grid="true"
          height={Math.max(1, screenBounds.height)}
          width={Math.max(1, screenBounds.width)}
        >
          {perspectivePlaneGridSegments.map((segment) => {
            const start = relativePoint(segment.start);
            const end = relativePoint(segment.end);
            return (
              <line
                key={segment.key}
                stroke="rgba(196,181,253,0.62)"
                strokeDasharray="3 3"
                strokeWidth="1"
                x1={start.x}
                x2={end.x}
                y1={start.y}
                y2={end.y}
              />
            );
          })}
        </svg>
      ) : null}
      {warpMesh && warpMeshNodes.length > 0 ? (
        <>
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            data-image-layer-warp-mesh-grid="true"
            height={Math.max(1, screenBounds.height)}
            width={Math.max(1, screenBounds.width)}
          >
            {/* Horizontal + vertical cage lines between adjacent control points. */}
            {warpMeshNodes.flatMap((node) => {
              const segments: React.ReactElement[] = [];
              const here = relativePoint(node.screen);
              const right = node.column < warpMesh.columns ? warpMeshNodeScreen(node.column + 1, node.row) : null;
              const down = node.row < warpMesh.rows ? warpMeshNodeScreen(node.column, node.row + 1) : null;
              if (right) {
                const r = relativePoint(right);
                segments.push(<line key={`h-${node.column}-${node.row}`} x1={here.x} y1={here.y} x2={r.x} y2={r.y} stroke="rgba(165,243,252,0.55)" strokeWidth="1" />);
              }
              if (down) {
                const d = relativePoint(down);
                segments.push(<line key={`v-${node.column}-${node.row}`} x1={here.x} y1={here.y} x2={d.x} y2={d.y} stroke="rgba(165,243,252,0.55)" strokeWidth="1" />);
              }
              return segments;
            })}
          </svg>
          {warpMeshNodes.map((node) => {
            const relative = relativePoint(node.screen);
            return (
              <button
                {...handleProps}
                aria-label={`Puppet mesh pin ${node.column},${node.row}`}
                className="pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-50/80 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95)]"
                data-image-layer-warp-mesh-handle={`${node.column}-${node.row}`}
                key={`warpmesh-${node.column}-${node.row}`}
                onPointerDown={startWarpMesh(node.column, node.row)}
                style={{ left: relative.x, top: relative.y, cursor: 'grab' }}
                title={`Puppet mesh pin ${node.column},${node.row}`}
                type="button"
              />
            );
          })}
        </>
      ) : null}
      {handlePoints.filter((entry) => entry.kind !== 'warp').map(({ kind, handle, point, cursor }) => {
        const relative = relativePoint(point);
        const dataProps = kind === 'resize'
          ? { 'data-image-layer-transform-handle': String(handle) }
          : kind === 'skew'
            ? { 'data-image-layer-transform-skew-handle': String(handle) }
            : kind === 'distort'
              ? { 'data-image-layer-transform-distort-handle': String(handle) }
              : kind === 'perspective'
                ? { 'data-image-layer-transform-perspective-handle': String(handle) }
                : { 'data-image-layer-transform-warp-handle': String(handle) };
        const pointerDown = kind === 'resize'
          ? startResize(handle as ImageLayerTransformHandle)
          : kind === 'skew'
            ? startSkew(handle as ImageLayerTransformHandle)
            : kind === 'distort'
              ? startDistort(handle as 'nw' | 'ne' | 'se' | 'sw')
              : kind === 'perspective'
                ? startPerspective(handle as 'nw' | 'ne' | 'se' | 'sw')
                : startWarp(handle as 'n' | 'e' | 's' | 'w');
        return (
          <button
            {...handleProps}
            aria-label={`${
              kind === 'resize'
                ? 'Resize'
                : kind === 'skew'
                  ? 'Skew'
                  : kind === 'distort'
                    ? 'Distort'
                    : kind === 'perspective'
                      ? 'Perspective plane'
                      : 'Warp'
            } layer ${handle}`}
            className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded border border-cyan-50/80 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95)]"
            key={`${kind}-${handle}`}
            onPointerDown={pointerDown}
            style={{
              left: relative.x,
              top: relative.y,
              cursor,
            }}
            title={`${
              kind === 'resize'
                ? 'Resize'
                : kind === 'skew'
                  ? 'Skew'
                  : kind === 'distort'
                    ? 'Distort'
                    : kind === 'perspective'
                      ? 'Perspective'
                      : 'Warp'
            } ${String(handle).toUpperCase()}`}
            type="button"
            {...dataProps}
          />
        );
      })}
      <button
        {...handleProps}
        aria-label="Layer pivot"
        className="pointer-events-auto absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100 bg-amber-400/80 shadow-md shadow-black/50"
        data-image-layer-pivot-handle="true"
        onPointerDown={startPivot}
        style={{
          left: relativePoint(pivotScreenPoint).x,
          top: relativePoint(pivotScreenPoint).y,
        }}
        title="Move pivot"
        type="button"
      />
      <button
        {...handleProps}
        aria-label="Rotate layer"
        className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-50 bg-[#10131b] text-cyan-100 shadow-md shadow-black/40"
        data-image-layer-rotate-handle="true"
        onPointerDown={startRotate}
        style={{
          left: relativePoint(rotateHandlePoint).x,
          top: relativePoint(rotateHandlePoint).y,
        }}
        title="Rotate layer"
        type="button"
      >
        <span className="block h-full w-full rounded-full border border-cyan-300/60" />
      </button>
    </div>
  );
}

/**
 * Shared-pivot transform overlay for a multi-selection of unlocked sibling layers: rotate
 * and uniform scale about one draggable pivot, with locked/group selected layers explicitly
 * excluded (reported by the plan) rather than silently blocking the gesture. One gesture is
 * one transform-preview session, so Apply/Enter commits exactly one history operation and
 * Cancel/Escape restores the whole pre-session selection.
 */
export function ImageMultiLayerTransformOverlay(props: ImageMultiLayerTransformOverlayProps) {
  const participantKey = props.plan.participantLayerIds.join('\u0000');
  return (
    <ImageMultiLayerTransformOverlaySession
      key={participantKey}
      {...props}
    />
  );
}

interface ImageMultiLayerTransformOverlayProps {
  doc: ImageDocument;
  plan: MultiLayerTransformParticipantPlan;
  requestRender: () => void;
  view?: Size;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

function ImageMultiLayerTransformOverlaySession({
  doc,
  plan,
  requestRender,
  view,
  wrapperRef,
}: ImageMultiLayerTransformOverlayProps) {
  const dragRef = useRef<MultiLayerTransformDragState | null>(null);
  const [pivotOverride, setPivotOverride] = useState<Point | null>(null);
  const participants = useMemo(
    () => plan.participantLayerIds
      .map((id) => doc.layers.find((layer) => layer.id === id))
      .filter((layer): layer is ImageLayer => Boolean(layer)),
    [doc, plan.participantLayerIds],
  );
  const sizeOf = useCallback(
    (layer: ImageLayer) => getImageLayerIntrinsicSize(layer) ?? { width: 0, height: 0 },
    [],
  );
  const defaultPivot = useMemo(() => getMultiLayerTransformPivot(participants, sizeOf), [participants, sizeOf]);
  const participantBounds = computeMultiLayerTransformDocBounds(doc, plan.participantLayerIds);
  const validatedPivotOverride = pivotOverride && participantBounds
    && pivotOverride.x >= participantBounds.x
    && pivotOverride.x <= participantBounds.x + participantBounds.width
    && pivotOverride.y >= participantBounds.y
    && pivotOverride.y <= participantBounds.y + participantBounds.height
    ? pivotOverride
    : null;
  const pivot = validatedPivotOverride ?? defaultPivot;
  const screenBox = computeMultiLayerTransformScreenBounds(doc, plan.participantLayerIds, view);

  const pointFromEvent = useCallback((event: ReactPointerEvent): Point | null => {
    const wrapper = wrapperRef.current;
    const currentDoc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id);
    if (!wrapper || !currentDoc) return null;
    const rect = wrapper.getBoundingClientRect();
    return screenToDoc(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      currentDoc.viewport,
      view ?? { width: rect.width, height: rect.height },
    );
  }, [doc.id, view, wrapperRef]);

  const startRotate = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pivot) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    beginMultiLayerTransformPreviewSession(doc, plan.participantLayerIds);

    dragRef.current = {
      kind: 'rotate',
      pointerId: event.pointerId,
      startLayers: doc.layers,
      pivot,
      startPointerDeg: calculateLayerRotationDeg(pivot, startPoint, false),
    };
  }, [doc, pivot, plan.participantLayerIds, pointFromEvent]);

  const startScale = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pivot) return;
    const startPoint = pointFromEvent(event);
    if (!startPoint) return;
    const startDistance = Math.hypot(startPoint.x - pivot.x, startPoint.y - pivot.y);
    if (startDistance <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    markMultiLayerTransformSessionStructureChange(doc, plan.participantLayerIds);

    dragRef.current = {
      kind: 'scale',
      pointerId: event.pointerId,
      startLayers: doc.layers,
      pivot,
      startDistance,
      sources: participants.map((layer) => ({
        layerId: layer.id,
        bitmap: layer.bitmap ? cloneBitmap(layer.bitmap) : null,
        mask: layer.mask ? cloneBitmap(layer.mask) : null,
        pixels: layer.pixels ? clonePixelBuffer(layer.pixels) : null,
        text: layer.text ?? null,
      })),
    };
  }, [doc, participants, pivot, plan.participantLayerIds, pointFromEvent]);

  const startPivot = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    dragRef.current = {
      kind: 'pivot',
      pointerId: event.pointerId,
    };
  }, []);

  const continueMultiTransform = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);
    if (!currentDoc) return;

    if (drag.kind === 'pivot') {
      // The shared pivot is gesture state, not layer metadata: clamp it into the selection's
      // combined transformed bounds so it stays anchored to the selection.
      const bounds = computeMultiLayerTransformDocBounds(currentDoc, plan.participantLayerIds);
      const next = {
        x: bounds ? Math.min(bounds.x + bounds.width, Math.max(bounds.x, point.x)) : point.x,
        y: bounds ? Math.min(bounds.y + bounds.height, Math.max(bounds.y, point.y)) : point.y,
      };
      setPivotOverride(next);
      requestRender();
      return;
    }

    if (drag.kind === 'rotate') {
      const pointerDeg = calculateLayerRotationDeg(drag.pivot, point, false);
      let deltaDeg = pointerDeg - drag.startPointerDeg;
      if (event.shiftKey) deltaDeg = Math.round(deltaDeg / 15) * 15;
      const rotated = rotateSelectedLayersAroundPivot(
        drag.startLayers,
        plan.participantLayerIds,
        drag.pivot,
        deltaDeg,
        sizeOf,
      );
      const ids = new Set(plan.participantLayerIds);
      for (const layer of rotated) {
        if (!ids.has(layer.id)) continue;
        state.updateLayer(currentDoc.id, layer.id, {
          x: layer.x,
          y: layer.y,
          rotationDeg: layer.rotationDeg,
        });
      }
      requestRender();
      return;
    }

    // Uniform scale about the shared pivot by pointer-distance ratio (shift snaps to 5%).
    const distance = Math.hypot(point.x - drag.pivot.x, point.y - drag.pivot.y);
    let scale = drag.startDistance > 0 ? distance / drag.startDistance : 1;
    if (event.shiftKey) scale = Math.round(scale / 0.05) * 0.05;
    scale = Math.min(64, Math.max(0.01, scale));
    const rects = scaleSelectedLayerRectsAroundPivot(
      drag.startLayers,
      plan.participantLayerIds,
      drag.pivot,
      scale,
      scale,
      sizeOf,
    );
    const nextLayerPatches: Array<{ layerId: string; patch: Partial<ImageLayer> }> = [];
    for (const rect of rects) {
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      const patch: Partial<ImageLayer> = { x: rect.x, y: rect.y };
      const source = drag.sources.find((entry) => entry.layerId === rect.id);
      if (source?.bitmap) {
        if (source.pixels) {
          try {
            patch.pixels = resamplePixelBuffer(source.pixels, nextWidth, nextHeight, 'bilinear');
          } catch (error) {
            discloseHighBitTransformRefusal(
              currentDoc.id,
              rect.id,
              `Refused before mutation: this high-bit multi-layer resize exceeds native pixel bounds (${error instanceof Error ? error.message : String(error)}).`,
            );
            return;
          }
        }
        patch.bitmap = resizeBitmapToLayerRect(source.bitmap, { x: rect.x, y: rect.y, width: nextWidth, height: nextHeight });
        if (patch.pixels) {
          syncPixelBufferProxy(patch.pixels, patch.bitmap);
          const currentLayer = currentDoc.layers.find((layer) => layer.id === rect.id);
          patch.pixelsVersion = (currentLayer?.pixelsVersion ?? currentLayer?.bitmapVersion ?? 0) + 1;
        }
        if (source.mask) {
          patch.mask = resizeBitmapToLayerRect(source.mask, { x: rect.x, y: rect.y, width: nextWidth, height: nextHeight });
        }
      } else if (source?.text) {
        patch.text = { ...source.text, boxWidth: nextWidth, boxHeight: nextHeight };
      }
      nextLayerPatches.push({ layerId: rect.id, patch });
    }
    for (const entry of nextLayerPatches) {
      state.updateLayer(currentDoc.id, entry.layerId, entry.patch);
    }
    requestRender();
  }, [doc.id, plan.participantLayerIds, pointFromEvent, requestRender, sizeOf]);

  const finishMultiTransform = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released by the browser.
    }

    const state = useImageEditorStore.getState();
    const currentDoc = state.documents.find((candidate) => candidate.id === doc.id);

    if (currentDoc && !transformPreviewSessionHasPendingChanges(currentDoc)) {
      clearTransformPreviewSession();
    }

    dragRef.current = null;
    requestRender();
  }, [doc.id, requestRender]);

  if (!screenBox || !pivot) return null;

  const handleProps = {
    onPointerMove: continueMultiTransform,
    onPointerUp: finishMultiTransform,
    onPointerCancel: finishMultiTransform,
  };
  const pivotScreen = docToScreen(pivot, doc.viewport, view);
  const cornerHandles: Array<{ handle: 'nw' | 'ne' | 'se' | 'sw'; point: Point; cursor: string }> = [
    { handle: 'nw', point: { x: screenBox.x, y: screenBox.y }, cursor: 'nwse-resize' },
    { handle: 'ne', point: { x: screenBox.x + screenBox.width, y: screenBox.y }, cursor: 'nesw-resize' },
    { handle: 'se', point: { x: screenBox.x + screenBox.width, y: screenBox.y + screenBox.height }, cursor: 'nwse-resize' },
    { handle: 'sw', point: { x: screenBox.x, y: screenBox.y + screenBox.height }, cursor: 'nesw-resize' },
  ];
  const rotateHandlePoint = {
    x: screenBox.x + screenBox.width / 2,
    y: screenBox.y + screenBox.height + 28,
  };
  const excludedSummary = plan.excludedLayers
    .map((excluded) => `${excluded.layerId} (${excluded.reason})`)
    .join(', ');

  return (
    <div
      className="pointer-events-none absolute z-20"
      data-image-multi-layer-transform-overlay="true"
      style={{
        left: screenBox.x,
        top: screenBox.y,
        width: screenBox.width,
        height: screenBox.height,
      }}
    >
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        data-image-multi-layer-transform-box="true"
        height={Math.max(1, screenBox.height)}
        width={Math.max(1, screenBox.width)}
      >
        <rect
          fill="rgba(103, 232, 249, 0.08)"
          height={Math.max(1, screenBox.height)}
          stroke="rgba(165, 243, 252, 0.9)"
          strokeDasharray="4 3"
          strokeWidth={1}
          width={Math.max(1, screenBox.width)}
          x={0}
          y={0}
        />
      </svg>
      {plan.excludedLayers.length > 0 ? (
        <div
          className="pointer-events-none absolute left-0 rounded border border-amber-200/30 bg-[#080b12]/95 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100"
          data-image-multi-layer-transform-excluded="true"
          style={{ top: -22 }}
          title={`Excluded from the transform: ${excludedSummary}`}
        >
          {plan.excludedLayers.length} selected layer{plan.excludedLayers.length === 1 ? '' : 's'} excluded (not transformable)
        </div>
      ) : null}
      {cornerHandles.map(({ handle, point, cursor }) => (
        <button
          {...handleProps}
          aria-label={`Scale selected layers from ${handle.toUpperCase()}`}
          className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded border border-cyan-50/80 bg-cyan-300 shadow-[0_0_0_1px_rgba(8,11,18,0.95)]"
          data-image-multi-layer-transform-handle={handle}
          key={handle}
          onPointerDown={startScale}
          style={{ left: point.x - screenBox.x, top: point.y - screenBox.y, cursor }}
          title={`Scale selected layers about the shared pivot (${handle.toUpperCase()})`}
          type="button"
        />
      ))}
      <button
        {...handleProps}
        aria-label="Shared selection pivot"
        className="pointer-events-auto absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-100 bg-amber-400/80 shadow-md shadow-black/50"
        data-image-multi-layer-pivot-handle="true"
        onPointerDown={startPivot}
        style={{ left: pivotScreen.x - screenBox.x, top: pivotScreen.y - screenBox.y }}
        title="Move shared pivot"
        type="button"
      />
      <button
        {...handleProps}
        aria-label="Rotate selected layers"
        className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-50 bg-[#10131b] text-cyan-100 shadow-md shadow-black/40"
        data-image-multi-layer-rotate-handle="true"
        onPointerDown={startRotate}
        style={{ left: rotateHandlePoint.x - screenBox.x, top: rotateHandlePoint.y - screenBox.y }}
        title="Rotate selected layers about the shared pivot"
        type="button"
      >
        <span className="block h-full w-full rounded-full border border-cyan-300/60" />
      </button>
    </div>
  );
}

type MultiLayerTransformDragState =
  | {
      kind: 'rotate';
      pointerId: number;
      startLayers: ImageLayer[];
      pivot: Point;
      startPointerDeg: number;
    }
  | {
      kind: 'scale';
      pointerId: number;
      startLayers: ImageLayer[];
      pivot: Point;
      startDistance: number;
      sources: Array<{
        layerId: string;
        bitmap: LayerBitmap | null;
        mask: LayerBitmap | null;
        pixels: PixelBuffer | null;
        text: ImageLayer['text'] | null;
      }>;
    }
  | {
      kind: 'pivot';
      pointerId: number;
    };

/** Union of the participants' transformed placement corners in screen space. */
function computeMultiLayerTransformScreenBounds(
  doc: ImageDocument,
  layerIds: readonly string[],
  view?: Size,
): ImageLayerTransformRect | null {
  return getPointExtents(collectMultiLayerTransformCorners(doc, layerIds, false, view));
}

/** Union of the participants' transformed placement corners in document space. */
function computeMultiLayerTransformDocBounds(
  doc: ImageDocument,
  layerIds: readonly string[],
): ImageLayerTransformRect | null {
  return getPointExtents(collectMultiLayerTransformCorners(doc, layerIds, true));
}

function collectMultiLayerTransformCorners(
  doc: ImageDocument,
  layerIds: readonly string[],
  docSpace: boolean,
  view?: Size,
): Point[] {
  const points: Point[] = [];
  for (const id of layerIds) {
    const layer = doc.layers.find((candidate) => candidate.id === id);
    if (!layer) continue;
    const shape = getImageLayerTransformShape(layer, getImageLayerIntrinsicSize(layer));
    if (!shape) continue;
    const corners = docSpace
      ? getImageLayerTransformTargetCorners(shape)
      : getImageLayerTransformScreenCorners(shape, doc.viewport, view);
    points.push(...Object.values(corners));
  }
  return points;
}

type TransformDragState =
  | {
      kind: 'resize';
      pointerId: number;
      layerId: string;
      handle: ImageLayerTransformHandle;
      beforeLayers: ImageLayer[];
      origin: ImageLayerTransformRect;
      sourceBitmap: LayerBitmap | null;
      sourceMask: LayerBitmap | null;
      sourcePixels: PixelBuffer | null;
      startPoint: Point;
      textOrigin: ImageLayer['text'] | null;
    }
  | {
      kind: 'rotate';
      pointerId: number;
      layerId: string;
      before: ReturnType<typeof getLayerTransformSnapshot>;
      center: Point;
      startPointerDeg: number;
      startRotationDeg: number;
    }
  | {
      kind: 'pivot';
      pointerId: number;
      layerId: string;
      before: ReturnType<typeof getLayerTransformSnapshot>;
      size: { width: number; height: number };
    }
  | {
      kind: 'skew';
      pointerId: number;
      layerId: string;
      axis: 'x' | 'y';
      origin: ImageLayerTransformRect;
      startPoint: Point;
      startSkewXDeg: number;
      startSkewYDeg: number;
    }
  | {
      kind: 'distort';
      pointerId: number;
      layerId: string;
      corner: 'nw' | 'ne' | 'se' | 'sw';
      originCornerOffsets: NonNullable<ImageLayer['cornerOffsets']>;
      startPoint: Point;
    }
  | {
      kind: 'perspective';
      pointerId: number;
      layerId: string;
      corner: 'nw' | 'ne' | 'se' | 'sw';
      origin: ImageLayerTransformRect;
      startPoint: Point;
      startPerspectiveX: number;
      startPerspectiveY: number;
    }
  | {
      kind: 'warp';
      pointerId: number;
      layerId: string;
      handle: 'n' | 'e' | 's' | 'w';
      origin: ImageLayerTransformRect;
      startPoint: Point;
      startWarp: {
        top: number;
        right: number;
        bottom: number;
        left: number;
      };
    }
  | {
      kind: 'warpMesh';
      pointerId: number;
      layerId: string;
      column: number;
      row: number;
      origin: ImageLayerTransformRect;
      rotationDeg: number;
      startPoint: Point;
      startMesh: WarpMesh;
    };

function resizeBitmapToLayerRect(source: LayerBitmap, rect: ImageLayerTransformRect): LayerBitmap {
  const bitmap = createBitmap(rect.width, rect.height);
  const ctx = bitmap.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0, rect.width, rect.height);
  }
  return bitmap;
}

function discloseHighBitTransformRefusal(docId: string, layerId: string, disclosure: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sloom-high-bit-tool-refused', {
      detail: { docId, layerId, tool: 'transform', source: 'proxy', precisionLossy: true, disclosure },
    }));
  }
}

function normalizeTransformRotation(rotationDeg: number, snapToFifteenDegrees: boolean): number {
  let normalized = rotationDeg;
  if (snapToFifteenDegrees) {
    normalized = Math.round(normalized / 15) * 15;
  }
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return Math.round(normalized * 100) / 100;
}

function getLayerTransformSnapshot(layer: ImageLayer) {
  const origin = resolveImageLayerTransformOrigin(layer);
  return {
    x: layer.x,
    y: layer.y,
    rotationDeg: layer.rotationDeg ?? 0,
    transformOriginX: origin.x,
    transformOriginY: origin.y,
  };
}

function getPointExtents(points: Point[]): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function clampTransformOrigin(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}
