import { useEffect, useMemo, useRef, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import type { ImagePathsPanelEntryReadiness } from './ImagePaths';
import type { ImageDocument, ImageLayer, ImageVectorPathPoint } from '../../types/imageEditor';
import {
  createVectorMaskDescriptorFromVectorPath,
  createFillLayerFromVectorPath,
  createLayerMaskFromVectorPath,
  createStrokeLayerFromVectorPath,
  deleteImagePathAnchor,
  describeImagePathAnchorEditSession,
  describeImagePathOperationReadinessLane,
  getVectorPathLayers,
  insertImagePathAnchor,
  describeImagePathsPanelReadiness,
  vectorPathLayerToSelectionMask,
} from './ImagePaths';
import {
  getEditableVectorShape,
  getVectorPathDocumentPoints,
  refreshLiveImageVectorBooleanLayers,
  updateVectorPathLayerPoint,
} from './ImageVectorShape';
import { attachVectorMaskToLayer, getLayerVectorMaskDescriptor } from './ImageVectorMasks';
import { maskBoundingBox, toSnapshot } from './SelectionMask';
import {
  convertVectorPathAnchor,
  isSmoothVectorPathAnchor,
} from './pathAnchorConversion';
import {
  createSavedWorkPathFromLayer,
  getSavedWorkPathBounds,
  planSavedWorkPathToSelection,
  sanitizeSavedWorkPathName,
  savedWorkPathToSelectionMask,
  truncateSavedWorkPaths,
} from './ImageSavedWorkPaths';

export function ImageEditorPathsPanel() {
  const doc = useImageEditorStore((state) =>
    state.documents.find((candidate) => candidate.id === state.activeDocId) ?? null,
  );
  const setLayers = useImageEditorStore((state) => state.setLayers);
  const setActiveLayer = useImageEditorStore((state) => state.setActiveLayer);
  const setTool = useImageEditorStore((state) => state.setTool);
  const pushOperation = useImageEditorStore((state) => state.pushOperation);
  const setHasSelection = useImageEditorStore((state) => state.setHasSelection);
  const setActiveLayerEditTarget = useImageEditorStore((state) => state.setActiveLayerEditTarget);
  const shapeToolSettings = useImageEditorStore((state) => state.shapeToolSettings);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);
  const [selectedAnchorIndex, setSelectedAnchorIndex] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [selectedSavedPathId, setSelectedSavedPathId] = useState<string | null>(null);
  const [pendingSavedPathName, setPendingSavedPathName] = useState('');

  const paths = useMemo(() => (doc ? getVectorPathLayers(doc) : []), [doc]);
  const savedWorkPaths = doc?.savedWorkPaths ?? [];
  const savedWorkPathSummaries = useMemo(() => savedWorkPaths.map((path) => ({
    id: path.id,
    name: path.name,
    closed: path.closed,
    pointCount: path.points.length,
    bounds: getSavedWorkPathBounds(path),
    kind: path.kind,
  })), [savedWorkPaths]);
  const pathsPanelReadiness = useMemo(() => (
    doc
      ? describeImagePathsPanelReadiness(doc, {
        selectedPathLayerId: selectedPathId,
        targetLayerId: doc.activeLayerId,
        workPathEntries: savedWorkPathSummaries,
      })
      : null
  ), [doc, selectedPathId, savedWorkPathSummaries]);
  const pathReadinessById = useMemo(() => {
    const map = new Map<string, ImagePathsPanelEntryReadiness>();
    pathsPanelReadiness?.entries.forEach((entry) => {
      map.set(entry.layerId ?? entry.id, entry);
    });
    return map;
  }, [pathsPanelReadiness]);
  const selectedPath = paths.find((layer) => layer.id === selectedPathId) ?? null;
  const selectedPathReadiness = selectedPath ? pathReadinessById.get(selectedPath.id) ?? null : null;
  const selectedPathAnchorPoints = useMemo(() => (
    selectedPath ? getVectorPathDocumentPoints(selectedPath) : []
  ), [selectedPath]);
  const selectedPathAnchorSession = useMemo(() => {
    if (!selectedPath || selectedPathAnchorPoints.length === 0) return null;
    const activeAnchorIndex = Math.min(selectedAnchorIndex, selectedPathAnchorPoints.length - 1);
    return describeImagePathAnchorEditSession(selectedPath, {
      selectedAnchorIndices: [activeAnchorIndex],
      activeAnchorIndex,
    });
  }, [selectedAnchorIndex, selectedPath, selectedPathAnchorPoints]);
  const selectedPathAnchorStatus = selectedPathAnchorSession?.selection.activeAnchorIndex != null
    ? `P${selectedPathAnchorSession.selection.activeAnchorIndex + 1} ${
      selectedPathAnchorSession.operations.moveSelectedAnchors.ready ? 'ready' : 'blocked'
    }`
    : 'none';
  const selectedAnchorPoint = selectedPathAnchorPoints[Math.min(selectedAnchorIndex, Math.max(0, selectedPathAnchorPoints.length - 1))] ?? null;
  const selectedAnchorIsSmooth = selectedAnchorPoint ? isSmoothVectorPathAnchor(selectedAnchorPoint) : false;
  const activeLayer = doc?.activeLayerId
    ? doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null
    : null;
  const activeVectorMask = activeLayer ? getLayerVectorMaskDescriptor(activeLayer) : null;
  const activeVectorMaskPoints = activeVectorMask?.path.points ?? [];
  const selectedPathOperationLane = useMemo(() => (
    selectedPath ? describeImagePathOperationReadinessLane(selectedPath, activeLayer) : null
  ), [activeLayer, selectedPath]);
  const vectorMaskOperationState = selectedPathOperationLane?.operations.find((operation) => operation.kind === 'vector-mask')?.state ?? 'blocked';
  const textOnPathOperationState = selectedPathOperationLane?.operations.find((operation) => operation.kind === 'text-on-path')?.state ?? 'unsupported';
  const canCreateLayerMask = Boolean(
    selectedPath
      && activeLayer
      && activeLayer.id !== selectedPath.id
      && !activeLayer.locked
      && activeLayer.type !== 'group',
  );
  const canCreateVectorMask = Boolean(
    selectedPath
      && activeLayer
      && activeLayer.id !== selectedPath.id
      && !activeLayer.locked
      && activeLayer.type !== 'group'
      && createVectorMaskDescriptorFromVectorPath(selectedPath, activeLayer),
  );
  const operationChecks = pathsPanelReadiness?.operationChecks ?? null;
  const independentSavedPathsStatus = pathsPanelReadiness?.independentSavedPaths.state ?? 'empty';
  const bezierPathEditingStatus = pathsPanelReadiness?.unsupportedStates.some((state) => state.category === 'bezier')
    ? 'unsupported'
    : 'ready';

  useEffect(() => {
    if (!paths.length) {
      setSelectedPathId(null);
      setPendingName('');
      return;
    }
    const activeVectorPath = doc?.activeLayerId
      ? paths.find((layer) => layer.id === doc.activeLayerId) ?? null
      : null;
    const nextSelected = selectedPathId && paths.some((layer) => layer.id === selectedPathId)
      ? selectedPathId
      : (activeVectorPath?.id ?? paths[0]?.id ?? null);
    setSelectedPathId(nextSelected);
    const selected = paths.find((layer) => layer.id === nextSelected) ?? null;
    setPendingName(selected?.name ?? '');
  }, [doc?.activeLayerId, paths, selectedPathId]);

  useEffect(() => {
    if (!selectedPath || selectedPathAnchorPoints.length === 0) {
      if (selectedAnchorIndex !== 0) setSelectedAnchorIndex(0);
      return;
    }
    if (selectedAnchorIndex >= selectedPathAnchorPoints.length) {
      setSelectedAnchorIndex(0);
    }
  }, [selectedAnchorIndex, selectedPath, selectedPathAnchorPoints.length]);

  useEffect(() => {
    if (!savedWorkPaths.length) {
      setSelectedSavedPathId(null);
      setPendingSavedPathName('');
      return;
    }
    const nextSelected = selectedSavedPathId && savedWorkPaths.some((path) => path.id === selectedSavedPathId)
      ? selectedSavedPathId
      : savedWorkPaths[savedWorkPaths.length - 1]?.id ?? null;
    setSelectedSavedPathId(nextSelected);
    const selected = savedWorkPaths.find((path) => path.id === nextSelected) ?? null;
    setPendingSavedPathName(selected?.name ?? '');
  }, [savedWorkPaths, selectedSavedPathId]);

  if (!doc) {
    return (
      <div className="h-full min-h-0 overflow-y-auto bg-[#1a1b23] p-3 text-xs text-cyan-100/40">
        Open an image document to manage vector paths.
      </div>
    );
  }

  const readCurrentDoc = () => useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id) ?? null;

  const commitLayers = (after: typeof doc.layers, activeLayerId = doc.activeLayerId) => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc) return;
    const refreshedLayers = refreshLiveImageVectorBooleanLayers(after);
    pushOperation({
      kind: 'layerOp',
      docId: currentDoc.id,
      before: currentDoc.layers,
      after: refreshedLayers,
    });
    setLayers(currentDoc.id, refreshedLayers, activeLayerId);
  };

  const commitSelection = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const before = getSelection(currentDoc.id);
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const after = vectorPathLayerToSelectionMask(currentDoc, currentPath);
    pushOperation({
      kind: 'selection',
      docId: currentDoc.id,
      before: before ? toSnapshot(before) : null,
      after: toSnapshot(after),
    });
    if (maskBoundingBox(after)) {
      setSelection(currentDoc.id, after);
      setHasSelection(currentDoc.id, true);
      return;
    }
    clearSelection(currentDoc.id);
    setHasSelection(currentDoc.id, false);
  };

  const commitDocumentState = (nextDoc: ImageDocument) => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc) return;
    pushOperation({
      kind: 'documentState',
      docId: currentDoc.id,
      before: currentDoc,
      after: nextDoc,
    });
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((candidate) => (candidate.id === currentDoc.id ? nextDoc : candidate)),
    }));
  };

  const saveSelectedPathAsIndependent = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const existing = currentDoc.savedWorkPaths ?? [];
    const created = createSavedWorkPathFromLayer(currentPath, existing);
    if (!created) return;
    const nextSavedWorkPaths = truncateSavedWorkPaths([...existing, created]);
    commitDocumentState({ ...currentDoc, dirty: true, savedWorkPaths: nextSavedWorkPaths });
    setSelectedSavedPathId(created.id);
  };

  const renameSelectedSavedPath = () => {
    const currentDoc = readCurrentDoc();
    const existing = currentDoc?.savedWorkPaths ?? [];
    const selected = existing.find((path) => path.id === selectedSavedPathId);
    if (!currentDoc || !selected) return;
    const nextName = sanitizeSavedWorkPathName(pendingSavedPathName);
    if (!nextName || nextName === selected.name) return;
    commitDocumentState({
      ...currentDoc,
      dirty: true,
      savedWorkPaths: existing.map((path) => (
        path.id === selected.id ? { ...path, name: nextName, updatedAt: Date.now() } : path
      )),
    });
  };

  const deleteSelectedSavedPath = () => {
    const currentDoc = readCurrentDoc();
    const existing = currentDoc?.savedWorkPaths ?? [];
    if (!currentDoc || !selectedSavedPathId) return;
    commitDocumentState({
      ...currentDoc,
      dirty: true,
      savedWorkPaths: existing.filter((path) => path.id !== selectedSavedPathId),
    });
  };

  const loadSelectedSavedPathAsSelection = () => {
    const currentDoc = readCurrentDoc();
    const existing = currentDoc?.savedWorkPaths ?? [];
    const selected = existing.find((path) => path.id === selectedSavedPathId);
    if (!currentDoc || !selected) return;
    const plan = planSavedWorkPathToSelection(selected);
    if (!plan.canApply) return;
    const mask = savedWorkPathToSelectionMask(currentDoc.width, currentDoc.height, selected);
    if (!mask) return;
    const before = getSelection(currentDoc.id);
    pushOperation({
      kind: 'selection',
      docId: currentDoc.id,
      before: before ? toSnapshot(before) : null,
      after: toSnapshot(mask),
    });
    setSelection(currentDoc.id, mask);
    setHasSelection(currentDoc.id, true);
  };

  const applyRename = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const nextName = pendingName.trim();
    if (!nextName || nextName === selectedPath.name) return;
    commitLayers(
      currentDoc.layers.map((layer) => (
        layer.id === selectedPath.id
          ? { ...layer, name: nextName }
          : layer
      )),
      selectedPath.id,
    );
  };

  const createFillLayer = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const nextLayer = createFillLayerFromVectorPath(currentDoc, currentPath, shapeToolSettings);
    commitLayers([...currentDoc.layers, nextLayer], nextLayer.id);
  };

  const createStrokeLayer = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const nextLayer = createStrokeLayerFromVectorPath(currentDoc, currentPath, shapeToolSettings);
    commitLayers([...currentDoc.layers, nextLayer], nextLayer.id);
  };

  const createLayerMask = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const targetLayer = currentDoc.activeLayerId
      ? currentDoc.layers.find((layer) => layer.id === currentDoc.activeLayerId) ?? null
      : null;
    if (!targetLayer || targetLayer.id === currentPath.id || targetLayer.locked || targetLayer.type === 'group') return;

    const nextMask = createLayerMaskFromVectorPath(currentDoc, currentPath, targetLayer);
    const nextLayer = {
      ...targetLayer,
      mask: nextMask,
      maskDensity: targetLayer.maskDensity ?? 1,
      maskFeather: targetLayer.maskFeather ?? 0,
      bitmapVersion: targetLayer.bitmapVersion + 1,
    };
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === targetLayer.id ? nextLayer : layer),
      targetLayer.id,
    );
    setActiveLayerEditTarget(currentDoc.id, 'mask');
  };

  const createVectorMask = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const targetLayer = currentDoc.activeLayerId
      ? currentDoc.layers.find((layer) => layer.id === currentDoc.activeLayerId) ?? null
      : null;
    if (!targetLayer || targetLayer.id === currentPath.id || targetLayer.locked || targetLayer.type === 'group') return;
    const descriptor = createVectorMaskDescriptorFromVectorPath(currentPath, targetLayer);
    if (!descriptor) return;

    const nextLayer = attachVectorMaskToLayer(targetLayer, descriptor);
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === targetLayer.id ? nextLayer : layer),
      targetLayer.id,
    );
    setActiveLayerEditTarget(currentDoc.id, 'layer');
  };

  const updatePathPoint = (pointIndex: number, patch: Partial<{ x: number; y: number }>) => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const points = getVectorPathDocumentPoints(currentPath);
    const currentPoint = points[pointIndex];
    if (!currentPoint) return;
    const nextPoint = {
      x: patch.x ?? currentPoint.x,
      y: patch.y ?? currentPoint.y,
    };
    if (!Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y)) return;
    if (nextPoint.x === currentPoint.x && nextPoint.y === currentPoint.y) return;
    const nextLayer = updateVectorPathLayerPoint(currentPath, pointIndex, nextPoint);
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === currentPath.id ? nextLayer : layer),
      nextLayer.id,
    );
  };

  const convertSelectedPathAnchor = (target: 'corner' | 'smooth') => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const points = getVectorPathDocumentPoints(currentPath);
    const activeAnchorIndex = Math.min(selectedAnchorIndex, points.length - 1);
    const nextLayer = convertVectorPathAnchor(currentPath, activeAnchorIndex, target);
    if (nextLayer === currentPath) return;
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === currentPath.id ? nextLayer : layer),
      nextLayer.id,
    );
  };

  const commitActiveVectorMaskUpdate = (patch: {
    enabled?: boolean;
    inverted?: boolean;
    linked?: boolean;
    points?: ImageVectorPathPoint[];
  }) => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !currentDoc.activeLayerId) return;
    const targetLayer = currentDoc.layers.find((layer) => layer.id === currentDoc.activeLayerId) ?? null;
    const descriptor = getLayerVectorMaskDescriptor(targetLayer);
    if (!targetLayer || !descriptor) return;
    const nextLayer = attachVectorMaskToLayer(targetLayer, {
      id: descriptor.id,
      name: descriptor.name,
      kind: descriptor.kind,
      targetLayerId: descriptor.targetLayerId,
      enabled: patch.enabled ?? descriptor.enabled,
      inverted: patch.inverted ?? descriptor.inverted,
      linked: patch.linked ?? descriptor.linked,
      path: {
        closed: descriptor.path.closed,
        fillRule: descriptor.path.fillRule,
        points: patch.points ?? descriptor.path.points,
      },
    });
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === targetLayer.id ? nextLayer : layer),
      targetLayer.id,
    );
    setActiveLayerEditTarget(currentDoc.id, 'layer');
  };

  const updateActiveVectorMaskPoint = (pointIndex: number, patch: Partial<{ x: number; y: number }>) => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !currentDoc.activeLayerId) return;
    const targetLayer = currentDoc.layers.find((layer) => layer.id === currentDoc.activeLayerId) ?? null;
    const descriptor = getLayerVectorMaskDescriptor(targetLayer);
    const currentPoint = descriptor?.path.points[pointIndex];
    if (!descriptor || !currentPoint) return;
    const nextPoint = {
      x: patch.x ?? currentPoint.x,
      y: patch.y ?? currentPoint.y,
    };
    if (!Number.isFinite(nextPoint.x) || !Number.isFinite(nextPoint.y)) return;
    if (nextPoint.x === currentPoint.x && nextPoint.y === currentPoint.y) return;
    const points = descriptor.path.points.map((point, index) => (
      index === pointIndex ? nextPoint : point
    ));
    commitActiveVectorMaskUpdate({ points });
  };

  const insertPathPointAfterSelection = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const points = getVectorPathDocumentPoints(currentPath);
    const activeAnchorIndex = Math.min(selectedAnchorIndex, points.length - 1);
    const point = buildInsertedPathAnchorPoint(points, activeAnchorIndex);
    if (!point) return;
    const result = insertImagePathAnchor(currentPath, {
      afterAnchorIndex: activeAnchorIndex,
      point,
      documentBounds: { width: currentDoc.width, height: currentDoc.height },
    });
    if (result.status !== 'updated') return;
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === currentPath.id ? result.layer : layer),
      result.layer.id,
    );
    setSelectedAnchorIndex(result.anchorIndex ?? activeAnchorIndex);
  };

  const deleteSelectedPathPoint = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const currentPath = currentDoc.layers.find((layer) => layer.id === selectedPath.id) ?? selectedPath;
    const points = getVectorPathDocumentPoints(currentPath);
    const activeAnchorIndex = Math.min(selectedAnchorIndex, points.length - 1);
    const result = deleteImagePathAnchor(currentPath, { anchorIndex: activeAnchorIndex });
    if (result.status !== 'updated') return;
    commitLayers(
      currentDoc.layers.map((layer) => layer.id === currentPath.id ? result.layer : layer),
      result.layer.id,
    );
    setSelectedAnchorIndex(Math.max(0, Math.min(activeAnchorIndex - 1, result.afterPoints.length - 1)));
  };

  const deleteSelectedPath = () => {
    const currentDoc = readCurrentDoc();
    if (!currentDoc || !selectedPath) return;
    const remaining = currentDoc.layers.filter((layer) => layer.id !== selectedPath.id);
    const nextActiveLayerId = remaining.find((layer) => layer.id === currentDoc.activeLayerId)?.id
      ?? remaining[remaining.length - 1]?.id
      ?? null;
    commitLayers(remaining, nextActiveLayerId);
  };

  const selectWholePath = (path: ImageLayer) => {
    setSelectedPathId(path.id);
    setPendingName(path.name);
    setActiveLayer(doc.id, path.id);
  };

  const beginDirectAnchorEdit = () => {
    if (!selectedPath || !selectedAnchorPoint) return;
    setActiveLayer(doc.id, selectedPath.id);
    // The canvas mounts its dedicated retained-anchor overlay while Pen is selected
    // outside a creation session; anchors and Bezier handles receive pointer capture there.
    setTool('pen');
  };

  const beginCurvaturePen = () => {
    if (selectedPath) setActiveLayer(doc.id, selectedPath.id);
    // Pen's click-drag gesture creates a retained cubic pair. With a committed path selected,
    // the same tool exposes the direct anchor/handle overlay rather than opening a new session.
    setTool('pen');
  };

  return (
    <div
      className="h-full min-h-0 overflow-y-auto bg-[#1a1b23] p-3 text-xs text-cyan-100/60"
      data-bezier-unsupported-signature={pathsPanelReadiness?.signatures.unsupportedStates ?? 'image-paths-panel-unsupported-states:v1:{"codes":[]}'}
      data-independent-saved-path-signature={pathsPanelReadiness?.independentSavedPaths.signature ?? 'image-paths-independent-saved-paths:v1:{"state":"empty"}'}
      data-path-anchor-session-signature={selectedPathAnchorSession?.previewSignature ?? 'image-path-anchor-edit-session:v1:{"status":"empty"}'}
      data-path-operation-signature={pathsPanelReadiness?.signatures.operations ?? 'image-paths-panel-operations:v1:{}'}
      data-path-operation-lane-signature={selectedPathOperationLane?.signature ?? 'image-path-operation-readiness:v1:{"status":"empty"}'}
      data-paths-panel-signature={pathsPanelReadiness?.previewSignature ?? 'image-paths-panel-readiness:v1:{"summary":{"totalEntries":0}}'}
      data-path-selection-active={selectedPath?.id ?? ''}
      data-thumbnail-readiness-signature={pathsPanelReadiness?.thumbnailReadiness.signature ?? 'image-paths-panel-thumbnails:v1:{"state":"empty"}'}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">Paths</div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-cyan-100/40">
          <span aria-label="Paths panel visibility">{pathsPanelReadiness?.visibility.panel ?? 'empty'}</span>
          <span aria-label="Independent saved paths status">{independentSavedPathsStatus}</span>
          <span aria-label="Bezier path editing status">{bezierPathEditingStatus}</span>
          <span aria-label="Selected path anchor session">{selectedPathAnchorStatus}</span>
          <span aria-label="Path operation lane status">vector-mask:{vectorMaskOperationState}</span>
          <span aria-label="Text on path status">text-path:{textOnPathOperationState}</span>
          <span>{paths.length} entries</span>
        </div>
      </div>

      {!paths.length ? (
        <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-3 text-[11px] text-cyan-100/35">
          Vector shape layers appear here as durable path entries.
        </div>
      ) : (
        <>
          <div className="space-y-1">
            {paths.map((path) => (
              <button
                aria-label={`Select path ${path.name}`}
                className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-[11px] font-semibold ${
                  selectedPathId === path.id
                    ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
                  : 'border-cyan-300/10 bg-[#10131b] text-cyan-100/60 hover:border-cyan-300/30 hover:text-white'
                }`}
                key={path.id}
                onClick={() => {
                  selectWholePath(path);
                }}
                type="button"
              >
                <PathPanelThumbnail
                  layer={path}
                  entry={pathReadinessById.get(path.id)}
                />
                <span className="truncate">{path.name}</span>
                <span className="font-mono text-[10px] text-cyan-100/40">
                  {path.metadata?.vectorShape?.kind === 'ellipse'
                    ? 'ellipse'
                    : path.metadata?.vectorShape?.kind === 'path'
                      ? 'path'
                      : 'rect'}
                </span>
              </button>
            ))}
          </div>

          {activeVectorMask ? (
            <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2" data-active-vector-mask-editor="true">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">Active Vector Mask</div>
                <span aria-label="Active vector mask path edit status" className="font-mono text-[10px] text-cyan-100/35">
                  {activeVectorMaskPoints.length >= 3 ? 'ready' : 'blocked'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                <button
                  aria-label="Toggle active vector mask enabled"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  onClick={() => commitActiveVectorMaskUpdate({ enabled: !activeVectorMask.enabled })}
                  type="button"
                >
                  {activeVectorMask.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  aria-label="Toggle active vector mask invert"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  onClick={() => commitActiveVectorMaskUpdate({ inverted: !activeVectorMask.inverted })}
                  type="button"
                >
                  Invert
                </button>
                <button
                  aria-label="Toggle active vector mask link"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  onClick={() => commitActiveVectorMaskUpdate({ linked: !activeVectorMask.linked })}
                  type="button"
                >
                  {activeVectorMask.linked ? 'Unlink' : 'Link'}
                </button>
              </div>
              <div className="space-y-1">
                {activeVectorMaskPoints.map((point, index) => (
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1" key={`${activeVectorMask.id}-point-${index}`}>
                    <span className="w-7 rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-center font-mono text-[10px] text-cyan-100/45">
                      V{index + 1}
                    </span>
                    <label className="flex min-w-0 items-center gap-1">
                      <span className="text-[10px] text-cyan-100/35">X</span>
                      <input
                        aria-label={`Vector mask point ${index + 1} X`}
                        className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/80 outline-none focus:border-cyan-300/50"
                        onChange={(event) => updateActiveVectorMaskPoint(index, { x: Number(event.target.value) })}
                        type="number"
                        value={Math.round(point.x)}
                      />
                    </label>
                    <label className="flex min-w-0 items-center gap-1">
                      <span className="text-[10px] text-cyan-100/35">Y</span>
                      <input
                        aria-label={`Vector mask point ${index + 1} Y`}
                        className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/80 outline-none focus:border-cyan-300/50"
                        onChange={(event) => updateActiveVectorMaskPoint(index, { y: Number(event.target.value) })}
                        type="number"
                        value={Math.round(point.y)}
                      />
                    </label>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {selectedPath ? (
            <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
              <label className="block">
                <span className="mb-1 block text-cyan-100/40">Path Name</span>
                <input
                  aria-label="Selected path name"
                  className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50"
                  onChange={(event) => setPendingName(event.target.value)}
                  value={pendingName}
                />
              </label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  aria-label="Apply selected path name"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  onClick={applyRename}
                  type="button"
                >
                  Apply Name
                </button>
                <button
                  aria-label="Delete selected path"
                  className="rounded border border-rose-300/15 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-rose-100/75 hover:border-rose-300/35 hover:text-white"
                  onClick={deleteSelectedPath}
                  type="button"
                >
                  Delete Path
                </button>
                <button
                  aria-label="Load selected path as selection"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  data-path-operation-ready={String(operationChecks?.loadSelection.ready ?? false)}
                  data-path-operation-signature={operationChecks?.loadSelection.signature ?? ''}
                  onClick={commitSelection}
                  type="button"
                >
                  Load Selection
                </button>
                <button
                  aria-label="Create layer mask from selected path"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!canCreateLayerMask}
                  onClick={createLayerMask}
                  type="button"
                >
                  Create Layer Mask
                </button>
                <button
                  aria-label="Create vector mask from selected path"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  data-path-operation-ready={String(operationChecks?.createVectorMask.ready ?? false)}
                  data-path-operation-signature={operationChecks?.createVectorMask.signature ?? ''}
                  disabled={!canCreateVectorMask}
                  onClick={createVectorMask}
                  type="button"
                >
                  Create Vector Mask
                </button>
                <button
                  aria-label="Create fill layer from selected path"
                  className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  data-path-operation-ready={String(operationChecks?.fillPath.ready ?? false)}
                  data-path-operation-signature={operationChecks?.fillPath.signature ?? ''}
                  onClick={createFillLayer}
                  type="button"
                >
                  Create Fill Layer
                </button>
                <button
                  aria-label="Create stroke layer from selected path"
                  className="col-span-2 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                  data-path-operation-ready={String(operationChecks?.strokePath.ready ?? false)}
                  data-path-operation-signature={operationChecks?.strokePath.signature ?? ''}
                  onClick={createStrokeLayer}
                  type="button"
                >
                  Create Stroke Layer
                </button>
              </div>
              {getEditableVectorShape(selectedPath)?.kind === 'path' ? (
                <div className="space-y-1 border-t border-cyan-300/10 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/40">Points</div>
                    <div className="font-mono text-[10px] text-cyan-100/35">
                      {getVectorPathDocumentPoints(selectedPath).length} anchors
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      aria-label="Select whole retained path"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                      onClick={() => selectWholePath(selectedPath)}
                      type="button"
                    >
                      Select Path
                    </button>
                    <button
                      aria-label="Directly edit selected path anchor"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedAnchorPoint}
                      onClick={beginDirectAnchorEdit}
                      type="button"
                    >
                      Direct Edit
                    </button>
                    <button
                      aria-label="Use Curvature Pen for retained path"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                      onClick={beginCurvaturePen}
                      type="button"
                    >
                      Curvature Pen
                    </button>
                    <button
                      aria-label="Add anchor after selected point"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedPathAnchorSession?.operations.addAnchor.ready}
                      onClick={insertPathPointAfterSelection}
                      type="button"
                    >
                      Add Anchor
                    </button>
                    <button
                      aria-label="Delete selected anchor point"
                      className="rounded border border-rose-300/15 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-rose-100/75 hover:border-rose-300/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedPathAnchorSession?.operations.deleteAnchor.ready}
                      onClick={deleteSelectedPathPoint}
                      type="button"
                    >
                      Delete Anchor
                    </button>
                    <button
                      aria-label="Convert selected anchor to corner"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedAnchorPoint || !selectedAnchorIsSmooth}
                      onClick={() => convertSelectedPathAnchor('corner')}
                      type="button"
                    >
                      Corner
                    </button>
                    <button
                      aria-label="Convert selected anchor to smooth"
                      className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!selectedAnchorPoint || selectedAnchorIsSmooth}
                      onClick={() => convertSelectedPathAnchor('smooth')}
                      type="button"
                    >
                      Smooth
                    </button>
                  </div>
                  {selectedPathAnchorPoints.map((point, index) => (
                    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1" key={`${selectedPath.id}-point-${index}`}>
                      <button
                        aria-label={`Select anchor P${index + 1}`}
                        aria-pressed={selectedAnchorIndex === index}
                        className={`w-7 rounded border px-1 py-0.5 font-mono text-[10px] ${
                          selectedAnchorIndex === index
                            ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
                            : 'border-cyan-300/10 bg-[#252630] text-cyan-100/45 hover:border-cyan-300/30 hover:text-cyan-100'
                        }`}
                        onClick={() => setSelectedAnchorIndex(index)}
                        type="button"
                      >
                        P{index + 1}
                      </button>
                      <label className="flex min-w-0 items-center gap-1">
                        <span className="text-[10px] text-cyan-100/35">X</span>
                        <input
                          aria-label={`Path point ${index + 1} X`}
                          className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/80 outline-none focus:border-cyan-300/50"
                          onChange={(event) => {
                            setSelectedAnchorIndex(index);
                            updatePathPoint(index, { x: Number(event.target.value) });
                          }}
                          type="number"
                          value={Math.round(point.x)}
                        />
                      </label>
                      <label className="flex min-w-0 items-center gap-1">
                        <span className="text-[10px] text-cyan-100/35">Y</span>
                        <input
                          aria-label={`Path point ${index + 1} Y`}
                          className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1 py-0.5 text-[11px] text-cyan-100/80 outline-none focus:border-cyan-300/50"
                          onChange={(event) => {
                            setSelectedAnchorIndex(index);
                            updatePathPoint(index, { y: Number(event.target.value) });
                          }}
                          type="number"
                          value={Math.round(point.y)}
                        />
                      </label>
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedPathReadiness ? (
                <div className="space-y-1 border-t border-cyan-300/10 pt-2 text-[10px] text-cyan-100/42">
                  <div className="font-semibold uppercase tracking-[0.14em] text-cyan-100/36">Edit Readiness</div>
                  <p>{selectedPathReadiness.editReadiness.anchorPointEditReadiness.state === 'ready-for-retained-anchor-editing' ? 'Retained anchors ready' : 'Shape bounds only'}</p>
                  {selectedPathAnchorSession ? (
                    <>
                      <p>{selectedPathAnchorSession.operations.moveSelectedAnchors.ready ? 'Move/nudge ready' : 'Move/nudge blocked'}</p>
                      <p>{selectedAnchorPoint ? `Convert anchor ready (${selectedAnchorIsSmooth ? 'smooth' : 'corner'})` : 'Convert anchor blocked'}</p>
                      <p>{selectedPathAnchorSession.operations.editBezierHandles.ready ? 'Bezier handles editable' : 'Select an anchor to edit Bezier handles'}</p>
                    </>
                  ) : null}
                  <p>Text on path unavailable</p>
                  <p>Live stroke styles unavailable</p>
                  <p>Native PSD path fidelity unavailable</p>
                  <p>Boolean combine uses separate vector layers</p>
                  <p>Rasterize flattens retained path editing</p>
                  <p>Vector mask stores a closed local copy</p>
                  <p>SVG export flattens path appearance; keep .slimg for editable paths</p>
                  <p>PSD keeps layer-backed paths only</p>
                </div>
              ) : null}
              <p className="text-[11px] text-cyan-100/40">
                New fill and stroke layers inherit the selected path geometry and use the current Shape panel fill/stroke settings.
              </p>
            </div>
          ) : null}
        </>
      )}

      <div className="mt-4 border-t border-cyan-300/10 pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="font-semibold uppercase tracking-[0.16em] text-cyan-100/45">Saved Paths</div>
          <span className="font-mono text-[10px] text-cyan-100/40">{savedWorkPaths.length} entries</span>
        </div>
        <button
          aria-label="Save selected path as independent saved path"
          className="mb-2 w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!selectedPath}
          onClick={saveSelectedPathAsIndependent}
          type="button"
        >
          Save Selected Path (Detach From Layer)
        </button>
        {!savedWorkPaths.length ? (
          <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-3 text-[11px] text-cyan-100/35">
            Document-owned saved paths, independent of any vector layer, appear here.
          </div>
        ) : (
          <>
            <div className="space-y-1">
              {savedWorkPaths.map((path) => (
                <button
                  aria-label={`Select saved path ${path.name}`}
                  className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left text-[11px] font-semibold ${
                    selectedSavedPathId === path.id
                      ? 'border-cyan-300/45 bg-cyan-400/15 text-cyan-100'
                      : 'border-cyan-300/10 bg-[#10131b] text-cyan-100/60 hover:border-cyan-300/30 hover:text-white'
                  }`}
                  key={path.id}
                  onClick={() => setSelectedSavedPathId(path.id)}
                  type="button"
                >
                  <span className="truncate">{path.name}</span>
                  <span className="font-mono text-[10px] text-cyan-100/40">{path.points.length} pts</span>
                </button>
              ))}
            </div>
            {selectedSavedPathId ? (
              <div className="mt-2 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
                <label className="block">
                  <span className="mb-1 block text-cyan-100/40">Saved Path Name</span>
                  <input
                    aria-label="Selected saved path name"
                    className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1.5 text-xs text-cyan-100/85 outline-none focus:border-cyan-300/50"
                    onChange={(event) => setPendingSavedPathName(event.target.value)}
                    value={pendingSavedPathName}
                  />
                </label>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    aria-label="Apply selected saved path name"
                    className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                    onClick={renameSelectedSavedPath}
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    aria-label="Load selected saved path as selection"
                    className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/70 hover:border-cyan-300/30 hover:text-white"
                    onClick={loadSelectedSavedPathAsSelection}
                    type="button"
                  >
                    Make Selection
                  </button>
                  <button
                    aria-label="Delete selected saved path"
                    className="rounded border border-rose-300/15 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-rose-100/75 hover:border-rose-300/35 hover:text-white"
                    onClick={deleteSelectedSavedPath}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function PathPanelThumbnail({
  layer,
  entry,
}: {
  layer: ImageLayer;
  entry?: ImagePathsPanelEntryReadiness | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const previewSize = entry?.thumbnail.width ?? 28;
  const ready = entry?.thumbnail.supported === true && entry.thumbnail.status === 'ready';

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      // Canvas rendering is optional in some test/runtime environments.
      return;
    }
    if (!ctx) return;

    const targetSize = entry?.thumbnail.width ?? previewSize;
    canvas.width = targetSize;
    canvas.height = targetSize;
    const width = targetSize;
    const height = targetSize;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#11131c';
    ctx.fillRect(0, 0, width, height);
    if (!ready || !layer.bitmap) return;

    const source = layer.bitmap;
    const sourceWidth = source.width;
    const sourceHeight = source.height;
    if (sourceWidth <= 0 || sourceHeight <= 0) return;

    const inset = 2;
    const scale = Math.min((width - inset * 2) / sourceWidth, (height - inset * 2) / sourceHeight);
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    const dx = Math.round((width - drawWidth) / 2);
    const dy = Math.round((height - drawHeight) / 2);

    try {
      ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
    } catch {
      // Thumbnails remain best-effort in non-standard canvas runtimes.
    }
  }, [ready, layer.bitmap, layer.bitmapVersion, entry?.thumbnail.signature, previewSize]);

  return (
    <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded border border-cyan-300/25 bg-[#10131b]">
      {ready ? (
        <canvas
          aria-label={`Path thumbnail ${layer.name}`}
          className="h-full w-full"
          ref={ref}
        />
      ) : (
        <span aria-hidden className="text-[8px] font-mono text-cyan-100/45">N/A</span>
      )}
    </span>
  );
}

function buildInsertedPathAnchorPoint(
  points: ImageVectorPathPoint[],
  afterAnchorIndex: number,
): ImageVectorPathPoint | null {
  const current = points[afterAnchorIndex];
  if (!current) return null;
  const next = points[afterAnchorIndex + 1];
  if (next) {
    return {
      x: Math.round((current.x + next.x) / 2),
      y: Math.round((current.y + next.y) / 2),
    };
  }
  const previous = points[afterAnchorIndex - 1];
  if (!previous) {
    return {
      x: current.x + 24,
      y: current.y,
    };
  }
  return {
    x: Math.round(current.x + (current.x - previous.x) / 2),
    y: Math.round(current.y + (current.y - previous.y) / 2),
  };
}
