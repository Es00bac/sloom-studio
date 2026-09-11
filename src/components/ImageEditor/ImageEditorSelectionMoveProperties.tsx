import { useEffect, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { canMoveImageLayer } from '../../lib/imageLayerLocks';
import type { ImageLayer, SelectionMode } from '../../types/imageEditor';
import { Slider } from './ImageEditorPropertyControls';
import { createBitmap } from './LayerBitmap';
import {
  createEmptyImageLayerTransformCornerOffsets,
  createEmptyImageLayerWarpOffsets,
  getImageLayerIntrinsicSize,
} from './ImageLayerTransformControls';
import { getImageLayerPivotPoint, resolveImageLayerTransformOrigin } from './ImageLayerTransform';
import {
  applyTransformPreviewSession,
  beginTransformPreviewSession,
  cancelTransformPreviewSession,
  getTransformPreviewSession,
  setTransformPreviewMode,
  subscribeTransformPreviewSession,
} from './ImageTransformPreview';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import { maskBoundingBox, toSnapshot } from './SelectionMask';
import {
  applySelectionTransformSession,
  beginSelectionTransformSession,
  cancelSelectionTransformSession,
  getSelectionTransformSession,
  resetSelectionTransformDistort,
  setSelectionTransformMode,
  subscribeSelectionTransformSession,
  updateSelectionTransformSkew,
  updateSelectionTransformRotation,
  updateSelectionTransformBounds,
} from './ImageSelectionTransform';
import { applyLocalObjectSelection } from './ImageObjectSelection';
import { nudgeSelection } from './photoshopQuickActions/selectionActions';

const SELECTION_MODES: { mode: SelectionMode; label: string }[] = [
  { mode: 'replace', label: 'New' },
  { mode: 'add', label: '+' },
  { mode: 'subtract', label: '−' },
  { mode: 'intersect', label: '∩' },
];

export function SelectionPanel({ showShape, showTolerance }: { showShape?: boolean; showTolerance?: boolean }) {
  const subscribedSettings = useImageEditorStore((s) => s.selectionToolSettings);
  const settings = useImageEditorStore.getState().selectionToolSettings ?? subscribedSettings;
  const set = useImageEditorStore((s) => s.setSelectionToolSettings);
  const subscribedTool = useImageEditorStore((s) => s.tool);
  const tool = useImageEditorStore.getState().tool ?? subscribedTool;
  const activeDocId = useImageEditorStore((s) => s.activeDocId);
  const activeDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const hasSelection = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId)?.hasSelection ?? false,
  );
  const [objectSelectionStatus, setObjectSelectionStatus] = useState<string | null>(null);
  const runLocalObjectSelection = (selectionMode: 'object' | 'subject') => {
    if (!activeDoc) {
      setObjectSelectionStatus('Open a document first.');
      return;
    }
    const result = applyLocalObjectSelection(activeDoc, { selectionMode });
    setObjectSelectionStatus(result
      ? `Selected ${selectionMode === 'subject' ? 'offline subject' : 'local object'} from ${result.bounds.width}x${result.bounds.height}px foreground.`
      : `No ${selectionMode === 'subject' ? 'offline subject' : 'local foreground object'} found on the active visible layer.`);
  };

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <div>
        <label className="mb-1 block">Mode</label>
        <div className="flex gap-1">
          {SELECTION_MODES.map(({ mode, label }) => (
            <button
              key={mode}
              className={`flex-1 rounded border px-2 py-1 text-xs ${
                settings.mode === mode
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                  : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
              }`}
              onClick={() => set({ mode })}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {showShape && tool === 'marquee' && (
        <div>
          <label className="mb-1 block">Shape</label>
          <div className="flex gap-1">
            {(['rectangle', 'ellipse'] as const).map((shape) => (
              <button
                key={shape}
                className={`flex-1 rounded border px-2 py-1 text-xs capitalize ${
                  settings.marqueeShape === shape
                    ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
                }`}
                onClick={() => set({ marqueeShape: shape })}
                type="button"
              >
                {shape}
              </button>
            ))}
          </div>
        </div>
      )}
      {showShape && tool === 'lasso' && (
        <div>
          <label className="mb-1 block">Lasso</label>
          <div className="flex gap-1">
            {(['freehand', 'polygonal', 'magnetic'] as const).map((shape) => (
              <button
                key={shape}
                className={`flex-1 rounded border px-2 py-1 text-xs capitalize ${
                  settings.lassoShape === shape
                    ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-400/40'
                }`}
                onClick={() => set({ lassoShape: shape })}
                type="button"
              >
                {shape}
              </button>
            ))}
          </div>
          {settings.lassoShape === 'magnetic' ? (
            <div className="mt-2 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Magnetic sensitivity</p>
              <Slider
                label="Snap radius"
                value={settings.magneticSnapRadius ?? 16}
                max={32}
                min={4}
                step={1}
                onChange={(value) => set({ magneticSnapRadius: value })}
                format={(value) => `${Math.round(value)}px`}
              />
              <Slider
                label="Edge contrast"
                value={settings.magneticContrastThreshold ?? 0.15}
                max={1}
                min={0}
                step={0.05}
                onChange={(value) => set({ magneticContrastThreshold: value })}
                format={(value) => `${Math.round(value * 100)}%`}
              />
              <p className="text-[11px] text-cyan-100/35">The bounded detector chooses the strongest local edge inside this radius above the contrast threshold.</p>
            </div>
          ) : null}
        </div>
      )}
      <Slider
        label="Feather"
        value={settings.feather}
        max={64}
        min={0}
        step={1}
        onChange={(v) => set({ feather: v })}
        format={(v) => `${Math.round(v)}px`}
      />
      <div className="flex items-center gap-2">
        <input
          checked={settings.antiAlias}
          id="anti-alias"
          onChange={(e) => set({ antiAlias: e.target.checked })}
          type="checkbox"
        />
        <label htmlFor="anti-alias">Anti-alias</label>
      </div>
      {showTolerance && (
        <>
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
              checked={settings.sampleAllLayers}
              id="sample-all-layers"
              onChange={(e) => set({ sampleAllLayers: e.target.checked })}
              type="checkbox"
            />
            <label htmlFor="sample-all-layers">Sample All Layers</label>
          </div>
          <div className="flex items-center gap-2">
            <input
              checked={settings.contiguous}
              id="contiguous-matching"
              onChange={(e) => set({ contiguous: e.target.checked })}
              type="checkbox"
            />
            <label htmlFor="contiguous-matching">Contiguous</label>
          </div>
        </>
      )}
      <div className="space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Object Selection</span>
          <MoveActionButton disabled={!activeDoc} onClick={() => runLocalObjectSelection('object')}>
            Select Local Object
          </MoveActionButton>
        </div>
        <p className="text-[11px] text-cyan-100/35">
          Local alpha/luminance foreground selection; no AI subject detection.
        </p>
        <div className="flex items-center justify-between gap-2 border-t border-cyan-300/10 pt-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Offline Subject</span>
          <MoveActionButton disabled={!activeDoc} onClick={() => runLocalObjectSelection('subject')}>
            Select Subject (Offline)
          </MoveActionButton>
        </div>
        <p className="text-[11px] text-cyan-100/35">
          Uses local border-contrast foreground analysis. It never downloads or runs an AI model; inspect complex edges in Select and Mask.
        </p>
        {objectSelectionStatus ? (
          <p className="text-[11px] text-cyan-100/50">{objectSelectionStatus}</p>
        ) : null}
      </div>
      {activeDocId && hasSelection ? (
        <div className="flex items-center justify-between gap-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Generative Edit</span>
          <GenerativeEditVisibilityButton docId={activeDocId} />
        </div>
      ) : null}
    </div>
  );
}

export function MovePanel() {
  const subscribedActiveDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const stateSnapshot = useImageEditorStore.getState();
  const activeDoc = subscribedActiveDoc
    ?? stateSnapshot.documents.find((d) => d.id === stateSnapshot.activeDocId)
    ?? null;
  const selectionVersion = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId)?.selectionVersion ?? 0,
  );
  const updateLayer = useImageEditorStore((s) => s.updateLayer);
  const pushOperation = useImageEditorStore((s) => s.pushOperation);
  const layer = activeDoc?.layers.find((l) => l.id === activeDoc.activeLayerId) ?? null;
  const intrinsicSize = layer ? getImageLayerIntrinsicSize(layer) : null;
  const pivot = layer ? getImageLayerPivotPoint(layer, intrinsicSize) : null;
  const [, setTransformPreviewVersion] = useState(0);
  const [, setSelectionTransformVersion] = useState(0);

  useEffect(() => subscribeTransformPreviewSession(() => {
    setTransformPreviewVersion((version) => version + 1);
  }), []);

  useEffect(() => subscribeSelectionTransformSession(() => {
    setSelectionTransformVersion((version) => version + 1);
  }), []);

  void selectionVersion;
  const layerTransformSession = activeDoc ? getTransformPreviewSession(activeDoc.id) : null;
  const layerTransformMode = layerTransformSession?.currentMode ?? 'resize';
  const layerSkewX = layer?.skewXDeg ?? 0;
  const layerSkewY = layer?.skewYDeg ?? 0;
  const layerPerspectiveX = (layer?.perspectiveX ?? 0) * 100;
  const layerPerspectiveY = (layer?.perspectiveY ?? 0) * 100;
  const layerWarpTop = (layer?.warp?.top ?? 0) * 100;
  const layerWarpRight = (layer?.warp?.right ?? 0) * 100;
  const layerWarpBottom = (layer?.warp?.bottom ?? 0) * 100;
  const layerWarpLeft = (layer?.warp?.left ?? 0) * 100;
  const liveSelection = activeDoc ? getSelection(activeDoc.id) ?? null : null;
  const selectionBounds = liveSelection ? maskBoundingBox(liveSelection) : null;
  const selectionTransformSession = activeDoc ? getSelectionTransformSession(activeDoc.id) : null;
  const canMoveLayer = canMoveImageLayer(layer);
  const commitTransform = (patch: Partial<{ x: number; y: number; rotationDeg: number; transformOriginX: number; transformOriginY: number }>) => {
    if (!activeDoc || !layer || !canMoveLayer) return;
    applyTransformPreviewSession(activeDoc.id);
    const origin = resolveImageLayerTransformOrigin(layer);
    const before = {
      x: layer.x,
      y: layer.y,
      rotationDeg: layer.rotationDeg ?? 0,
      transformOriginX: origin.x,
      transformOriginY: origin.y,
    };
    const after = {
      x: patch.x ?? before.x,
      y: patch.y ?? before.y,
      rotationDeg: patch.rotationDeg ?? before.rotationDeg,
      transformOriginX: patch.transformOriginX ?? before.transformOriginX,
      transformOriginY: patch.transformOriginY ?? before.transformOriginY,
    };
    if (
      before.x === after.x &&
      before.y === after.y &&
      (before.rotationDeg ?? 0) === (after.rotationDeg ?? 0) &&
      before.transformOriginX === after.transformOriginX &&
      before.transformOriginY === after.transformOriginY
    ) {
      return;
    }
    updateLayer(activeDoc.id, layer.id, {
      ...(patch.x !== undefined ? { x: after.x } : {}),
      ...(patch.y !== undefined ? { y: after.y } : {}),
      ...(patch.rotationDeg !== undefined ? { rotationDeg: after.rotationDeg } : {}),
      ...(patch.transformOriginX !== undefined ? { transformOriginX: after.transformOriginX } : {}),
      ...(patch.transformOriginY !== undefined ? { transformOriginY: after.transformOriginY } : {}),
    });
    pushOperation({
      kind: 'transform',
      docId: activeDoc.id,
      layerId: layer.id,
      before,
      after,
    });
  };
  const setRotation = (rotationDeg: number) => {
    commitTransform({ rotationDeg: normalizeLayerRotation(rotationDeg) });
  };
  const ensureLayerTransformSession = () => {
    if (!activeDoc || !layer || !canMoveLayer) return null;
    return getTransformPreviewSession(activeDoc.id) ?? beginTransformPreviewSession(activeDoc, layer);
  };
  const setPosition = (axis: 'x' | 'y', value: number) => {
    if (!layer) return;
    if (!Number.isFinite(value)) return;
    commitTransform({ [axis]: Math.round(value * 100) / 100 });
  };
  const setPivot = (axis: 'x' | 'y', value: number) => {
    if (!layer || !canMoveLayer || !intrinsicSize || !pivot || !Number.isFinite(value)) return;
    const currentOrigin = resolveImageLayerTransformOrigin(layer);
    if (axis === 'x') {
      commitTransform({
        transformOriginX: clampTransformOrigin((value - layer.x) / intrinsicSize.width),
        transformOriginY: currentOrigin.y,
      });
      return;
    }
    commitTransform({
      transformOriginX: currentOrigin.x,
      transformOriginY: clampTransformOrigin((value - layer.y) / intrinsicSize.height),
    });
  };
  const setSize = (axis: 'width' | 'height', value: number) => {
    if (!activeDoc || !layer || !canMoveLayer || !intrinsicSize || !Number.isFinite(value)) return;
    applyTransformPreviewSession(activeDoc.id);
    const nextValue = Math.max(1, Math.round(value));
    const nextWidth = axis === 'width' ? nextValue : intrinsicSize.width;
    const nextHeight = axis === 'height' ? nextValue : intrinsicSize.height;

    if (nextWidth === intrinsicSize.width && nextHeight === intrinsicSize.height) {
      return;
    }

    const before = activeDoc.layers;
    if (layer.bitmap) {
      updateLayer(activeDoc.id, layer.id, {
        bitmap: resizeBitmap(layer.bitmap, nextWidth, nextHeight),
        ...(layer.mask ? { mask: resizeBitmap(layer.mask, nextWidth, nextHeight) } : {}),
      });
    } else if (layer.text) {
      updateLayer(activeDoc.id, layer.id, {
        text: {
          ...layer.text,
          ...(axis === 'width' ? { boxWidth: nextWidth } : {}),
          ...(axis === 'height' ? { boxHeight: nextHeight } : {}),
        },
      });
    } else {
      return;
    }

    const after = useImageEditorStore.getState()
      .documents.find((doc) => doc.id === activeDoc.id)?.layers;
    if (!after || after === before) return;
    pushOperation({
      kind: 'layerOp',
      docId: activeDoc.id,
      before,
      after,
    });
  };
  const beginLayerTransform = () => {
    ensureLayerTransformSession();
  };
  const setLayerTransformMode = (mode: 'resize' | 'skew' | 'distort' | 'perspective' | 'warp') => {
    if (!activeDoc) return;
    if (!ensureLayerTransformSession()) return;
    setTransformPreviewMode(activeDoc.id, mode);
  };
  const commitLayerTransformPreview = (patch: Partial<Pick<ImageLayer, 'skewXDeg' | 'skewYDeg' | 'perspectiveX' | 'perspectiveY' | 'warp' | 'warpMesh' | 'cornerOffsets'>>) => {
    if (!activeDoc || !layer || !canMoveLayer) return;
    if (!ensureLayerTransformSession()) return;
    updateLayer(activeDoc.id, layer.id, patch);
  };
  const setLayerSkew = (axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) return;
    const normalized = normalizeLayerSkew(value);
    commitLayerTransformPreview(axis === 'x' ? { skewXDeg: normalized } : { skewYDeg: normalized });
  };
  const resetLayerDistort = () => {
    commitLayerTransformPreview({ cornerOffsets: createEmptyImageLayerTransformCornerOffsets() });
  };
  const setLayerPerspective = (axis: 'x' | 'y', value: number) => {
    if (!Number.isFinite(value)) return;
    const normalized = normalizeLayerPerspective(value / 100);
    commitLayerTransformPreview(axis === 'x' ? { perspectiveX: normalized } : { perspectiveY: normalized });
  };
  const setLayerWarp = (edge: 'top' | 'right' | 'bottom' | 'left', value: number) => {
    if (!Number.isFinite(value)) return;
    const normalized = normalizeLayerWarp(value / 100);
    commitLayerTransformPreview({
      warp: {
        top: layer?.warp?.top ?? 0,
        right: layer?.warp?.right ?? 0,
        bottom: layer?.warp?.bottom ?? 0,
        left: layer?.warp?.left ?? 0,
        [edge]: normalized,
      },
    });
  };
  const resetLayerWarp = () => {
    commitLayerTransformPreview({ warp: createEmptyImageLayerWarpOffsets() });
  };
  const resetLayerPuppetMesh = () => {
    commitLayerTransformPreview({ warpMesh: null });
  };

  const selectionTransformBounds = selectionTransformSession?.currentBounds ?? selectionBounds;
  const selectionTransformRotation = selectionTransformSession?.currentRotationDeg ?? 0;
  const selectionTransformSkewX = selectionTransformSession?.currentSkewXDeg ?? 0;
  const selectionTransformSkewY = selectionTransformSession?.currentSkewYDeg ?? 0;
  const selectionTransformMode = selectionTransformSession?.currentMode ?? 'resize';
  const beginSelectionTransform = () => {
    if (!activeDoc || !selectionBounds) return;
    beginSelectionTransformSession(activeDoc.id);
  };
  const commitSelectionTransform = (patch: Partial<{ x: number; y: number; width: number; height: number; rotationDeg: number; skewXDeg: number; skewYDeg: number }>) => {
    if (!activeDoc || !selectionTransformBounds) return;
    if (
      patch.x !== undefined ||
      patch.y !== undefined ||
      patch.width !== undefined ||
      patch.height !== undefined
    ) {
      updateSelectionTransformBounds(activeDoc.id, {
        x: patch.x ?? selectionTransformBounds.x,
        y: patch.y ?? selectionTransformBounds.y,
        width: patch.width ?? selectionTransformBounds.width,
        height: patch.height ?? selectionTransformBounds.height,
      });
    }
    if (patch.rotationDeg !== undefined) {
      updateSelectionTransformRotation(activeDoc.id, normalizeLayerRotation(patch.rotationDeg));
    }
    if (patch.skewXDeg !== undefined || patch.skewYDeg !== undefined) {
      updateSelectionTransformSkew(activeDoc.id, {
        ...(patch.skewXDeg !== undefined ? { skewXDeg: patch.skewXDeg } : {}),
        ...(patch.skewYDeg !== undefined ? { skewYDeg: patch.skewYDeg } : {}),
      });
    }
  };
  const nudgeActiveSelection = (dx: number, dy: number) => {
    if (!activeDoc || !selectionBounds) return;
    if (selectionTransformSession) {
      const currentBounds = selectionTransformSession.currentBounds ?? selectionBounds;
      if (!currentBounds) return;
      updateSelectionTransformBounds(activeDoc.id, {
        x: currentBounds.x + dx,
        y: currentBounds.y + dy,
        width: currentBounds.width,
        height: currentBounds.height,
      });
      return;
    }

    const before = getSelection(activeDoc.id);
    if (!before || !maskBoundingBox(before)) return;
    const after = nudgeSelection(before, dx, dy);
    const hasSelectionAfter = Boolean(maskBoundingBox(after));
    const store = useImageEditorStore.getState();
    store.pushOperation({
      kind: 'selection',
      docId: activeDoc.id,
      before: toSnapshot(before),
      after: hasSelectionAfter ? toSnapshot(after) : null,
    });
    if (hasSelectionAfter) {
      setSelection(activeDoc.id, after);
    } else {
      clearSelection(activeDoc.id);
    }
    store.bumpSelectionVersion(activeDoc.id);
    store.setHasSelection(activeDoc.id, hasSelectionAfter);
  };

  if (!layer && !selectionBounds && !selectionTransformSession) {
    return <p className="text-xs text-cyan-100/40">Select a layer or selection to move it.</p>;
  }

  return (
    <div className="space-y-2 text-xs text-cyan-100/60">
      {layer ? (
        <>
          <div className="flex gap-2">
            <EditableNumericField
              ariaLabel="Layer X"
              disabled={!canMoveLayer}
              label="X"
              onCommit={(value) => setPosition('x', value)}
              value={layer.x}
            />
            <EditableNumericField
              ariaLabel="Layer Y"
              disabled={!canMoveLayer}
              label="Y"
              onCommit={(value) => setPosition('y', value)}
              value={layer.y}
            />
          </div>
          <div className="flex gap-2">
            <EditableNumericField
              ariaLabel="Layer width"
              disabled={!canMoveLayer || !intrinsicSize}
              label="W"
              min={1}
              onCommit={(value) => setSize('width', value)}
              value={intrinsicSize?.width ?? 0}
            />
            <EditableNumericField
              ariaLabel="Layer height"
              disabled={!canMoveLayer || !intrinsicSize}
              label="H"
              min={1}
              onCommit={(value) => setSize('height', value)}
              value={intrinsicSize?.height ?? 0}
            />
          </div>
          <div className="flex gap-2">
            <EditableNumericField
              ariaLabel="Layer pivot X"
              disabled={!canMoveLayer || !intrinsicSize || !pivot}
              label="PX"
              onCommit={(value) => setPivot('x', value)}
              step={0.1}
              value={pivot?.pivotX ?? layer.x}
            />
            <EditableNumericField
              ariaLabel="Layer pivot Y"
              disabled={!canMoveLayer || !intrinsicSize || !pivot}
              label="PY"
              onCommit={(value) => setPivot('y', value)}
              step={0.1}
              value={pivot?.pivotY ?? layer.y}
            />
          </div>
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span>Rotation</span>
              <span className="text-cyan-100/40">{Math.round(layer.rotationDeg ?? 0)}deg</span>
            </label>
            <EditableNumericField
              ariaLabel="Layer rotation"
              disabled={!canMoveLayer}
              label="Deg"
              max={180}
              min={-180}
              onCommit={setRotation}
              value={normalizeSignedRotation(layer.rotationDeg ?? 0)}
            />
            <div className="grid grid-cols-4 gap-1">
              <MoveActionButton disabled={!canMoveLayer} onClick={() => setRotation((layer.rotationDeg ?? 0) - 15)}>−15</MoveActionButton>
              <MoveActionButton disabled={!canMoveLayer} onClick={() => setRotation((layer.rotationDeg ?? 0) + 15)}>+15</MoveActionButton>
              <MoveActionButton disabled={!canMoveLayer} onClick={() => setRotation((layer.rotationDeg ?? 0) - 90)}>−90</MoveActionButton>
              <MoveActionButton disabled={!canMoveLayer} onClick={() => setRotation(0)}>Reset</MoveActionButton>
            </div>
            <input
              className="mt-2 w-full cursor-pointer accent-cyan-400"
              disabled={!canMoveLayer}
              max={180}
              min={-180}
              onChange={(event) => setRotation(Number(event.target.value))}
              step={1}
              type="range"
              value={normalizeSignedRotation(layer.rotationDeg ?? 0)}
            />
          </div>
          <div className="space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Free Transform</span>
              {!layerTransformSession ? (
                <MoveActionButton disabled={!canMoveLayer} onClick={beginLayerTransform}>Start Transform</MoveActionButton>
              ) : null}
            </div>
            {layerTransformSession ? (
              <>
                <div className="grid grid-cols-4 gap-1">
                  {(['resize', 'skew', 'distort', 'perspective', 'warp'] as const).map((mode) => (
                    <SelectionModeButton
                      active={layerTransformMode === mode}
                      key={mode}
                      label={
                        mode === 'resize'
                          ? 'Resize'
                          : mode === 'skew'
                            ? 'Skew'
                            : mode === 'distort'
                              ? 'Distort'
                              : mode === 'perspective'
                                ? 'Perspective'
                                : 'Puppet'
                      }
                      onClick={() => setLayerTransformMode(mode)}
                    />
                  ))}
                </div>
                {layerTransformMode === 'perspective' ? (
                  <p className="text-[11px] text-violet-100/55" data-image-layer-perspective-plane-help="true">
                    Perspective plane: drag a corner on the canvas or set PX/PY. One retained plane is available per layer.
                  </p>
                ) : null}
                {layerTransformMode === 'warp' ? (
                  <p className="text-[11px] text-cyan-100/55" data-image-layer-puppet-mesh-help="true">
                    Puppet mesh: drag the on-canvas cage pins to deform this layer, then Apply or Cancel the retained edit.
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <EditableNumericField
                    ariaLabel="Layer skew X"
                    disabled={!canMoveLayer}
                    label="SX"
                    max={75}
                    min={-75}
                    onCommit={(value) => setLayerSkew('x', value)}
                    value={layerSkewX}
                  />
                  <EditableNumericField
                    ariaLabel="Layer skew Y"
                    disabled={!canMoveLayer}
                    label="SY"
                    max={75}
                    min={-75}
                    onCommit={(value) => setLayerSkew('y', value)}
                    value={layerSkewY}
                  />
                </div>
                <div className="flex gap-2">
                  <EditableNumericField
                    ariaLabel="Layer perspective X"
                    disabled={!canMoveLayer}
                    label="PX%"
                    max={95}
                    min={-95}
                    onCommit={(value) => setLayerPerspective('x', value)}
                    value={layerPerspectiveX}
                  />
                  <EditableNumericField
                    ariaLabel="Layer perspective Y"
                    disabled={!canMoveLayer}
                    label="PY%"
                    max={95}
                    min={-95}
                    onCommit={(value) => setLayerPerspective('y', value)}
                    value={layerPerspectiveY}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <EditableNumericField
                    ariaLabel="Layer warp top"
                    disabled={!canMoveLayer}
                    label="WT%"
                    max={100}
                    min={-100}
                    onCommit={(value) => setLayerWarp('top', value)}
                    value={layerWarpTop}
                  />
                  <EditableNumericField
                    ariaLabel="Layer warp right"
                    disabled={!canMoveLayer}
                    label="WR%"
                    max={100}
                    min={-100}
                    onCommit={(value) => setLayerWarp('right', value)}
                    value={layerWarpRight}
                  />
                  <EditableNumericField
                    ariaLabel="Layer warp bottom"
                    disabled={!canMoveLayer}
                    label="WB%"
                    max={100}
                    min={-100}
                    onCommit={(value) => setLayerWarp('bottom', value)}
                    value={layerWarpBottom}
                  />
                  <EditableNumericField
                    ariaLabel="Layer warp left"
                    disabled={!canMoveLayer}
                    label="WL%"
                    max={100}
                    min={-100}
                    onCommit={(value) => setLayerWarp('left', value)}
                    value={layerWarpLeft}
                  />
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => setLayerSkew('x', 0)}>Reset SX</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => setLayerSkew('y', 0)}>Reset SY</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => setLayerPerspective('x', 0)}>Reset PX</MoveActionButton>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => setLayerPerspective('y', 0)}>Reset PY</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={resetLayerDistort}>Reset Distort</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={resetLayerWarp}>Reset Warp</MoveActionButton>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <MoveActionButton disabled={!canMoveLayer} onClick={resetLayerPuppetMesh}>Reset Puppet Mesh</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => activeDoc && applyTransformPreviewSession(activeDoc.id)}>Apply Transform</MoveActionButton>
                  <MoveActionButton disabled={!canMoveLayer} onClick={() => activeDoc && cancelTransformPreviewSession(activeDoc.id)}>Cancel Transform</MoveActionButton>
                </div>
              </>
            ) : null}
          </div>
          <p className="text-cyan-100/30">
            Drag on the canvas to move the active layer. Use rotation controls for comic panel angles and manga action elements.
          </p>
        </>
      ) : null}

      {selectionBounds || selectionTransformSession ? (
        <div className="space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Transform Selection</span>
            <div className="flex flex-wrap items-center gap-1">
              {activeDoc?.hasSelection ? <GenerativeEditVisibilityButton docId={activeDoc.id} /> : null}
              {!selectionTransformSession ? (
                <MoveActionButton disabled={!selectionBounds} onClick={beginSelectionTransform}>Transform Selection</MoveActionButton>
              ) : null}
            </div>
          </div>
          {selectionTransformBounds ? (
            <>
              {selectionTransformSession ? (
                <div className="grid grid-cols-3 gap-1">
                  {(['resize', 'skew', 'distort'] as const).map((mode) => (
                    <SelectionModeButton
                      active={selectionTransformMode === mode}
                      key={mode}
                      label={mode === 'resize' ? 'Resize' : mode === 'skew' ? 'Skew' : 'Distort'}
                      onClick={() => activeDoc && setSelectionTransformMode(activeDoc.id, mode)}
                    />
                  ))}
                </div>
              ) : null}
              <div className="flex gap-2">
                <EditableNumericField
                  ariaLabel="Selection X"
                  disabled={!selectionTransformSession}
                  label="X"
                  onCommit={(value) => commitSelectionTransform({ x: value })}
                  value={selectionTransformBounds.x}
                />
                <EditableNumericField
                  ariaLabel="Selection Y"
                  disabled={!selectionTransformSession}
                  label="Y"
                  onCommit={(value) => commitSelectionTransform({ y: value })}
                  value={selectionTransformBounds.y}
                />
              </div>
              <div className="grid grid-cols-4 gap-1">
                <MoveActionButton ariaLabel="Nudge selection left 1 px" disabled={!selectionBounds} onClick={() => nudgeActiveSelection(-1, 0)}>Left</MoveActionButton>
                <MoveActionButton ariaLabel="Nudge selection right 1 px" disabled={!selectionBounds} onClick={() => nudgeActiveSelection(1, 0)}>Right</MoveActionButton>
                <MoveActionButton ariaLabel="Nudge selection up 1 px" disabled={!selectionBounds} onClick={() => nudgeActiveSelection(0, -1)}>Up</MoveActionButton>
                <MoveActionButton ariaLabel="Nudge selection down 1 px" disabled={!selectionBounds} onClick={() => nudgeActiveSelection(0, 1)}>Down</MoveActionButton>
              </div>
              <div className="flex gap-2">
                <EditableNumericField
                  ariaLabel="Selection width"
                  disabled={!selectionTransformSession}
                  label="W"
                  min={1}
                  onCommit={(value) => commitSelectionTransform({ width: value })}
                  value={selectionTransformBounds.width}
                />
                <EditableNumericField
                  ariaLabel="Selection height"
                  disabled={!selectionTransformSession}
                  label="H"
                  min={1}
                  onCommit={(value) => commitSelectionTransform({ height: value })}
                  value={selectionTransformBounds.height}
                />
              </div>
              <div>
                <label className="mb-1 flex items-center justify-between">
                  <span>Rotation</span>
                  <span className="text-cyan-100/40">{Math.round(normalizeSignedRotation(selectionTransformRotation))}deg</span>
                </label>
                <EditableNumericField
                  ariaLabel="Selection rotation"
                  disabled={!selectionTransformSession}
                  label="Deg"
                  max={180}
                  min={-180}
                  onCommit={(value) => commitSelectionTransform({ rotationDeg: value })}
                  value={normalizeSignedRotation(selectionTransformRotation)}
                />
                <div className="mt-1 grid grid-cols-3 gap-1">
                  <MoveActionButton disabled={!selectionTransformSession} onClick={() => commitSelectionTransform({ rotationDeg: selectionTransformRotation - 15 })}>−15</MoveActionButton>
                  <MoveActionButton disabled={!selectionTransformSession} onClick={() => commitSelectionTransform({ rotationDeg: selectionTransformRotation + 15 })}>+15</MoveActionButton>
                  <MoveActionButton disabled={!selectionTransformSession} onClick={() => commitSelectionTransform({ rotationDeg: 0 })}>Reset</MoveActionButton>
                </div>
              </div>
              <div className="flex gap-2">
                <EditableNumericField
                  ariaLabel="Selection skew X"
                  disabled={!selectionTransformSession}
                  label="SX"
                  max={75}
                  min={-75}
                  onCommit={(value) => commitSelectionTransform({ skewXDeg: value })}
                  value={selectionTransformSkewX}
                />
                <EditableNumericField
                  ariaLabel="Selection skew Y"
                  disabled={!selectionTransformSession}
                  label="SY"
                  max={75}
                  min={-75}
                  onCommit={(value) => commitSelectionTransform({ skewYDeg: value })}
                  value={selectionTransformSkewY}
                />
              </div>
              {selectionTransformSession ? (
                <div className="grid grid-cols-3 gap-1">
                  <MoveActionButton disabled={false} onClick={() => commitSelectionTransform({ skewXDeg: 0 })}>Reset SX</MoveActionButton>
                  <MoveActionButton disabled={false} onClick={() => commitSelectionTransform({ skewYDeg: 0 })}>Reset SY</MoveActionButton>
                  <MoveActionButton disabled={false} onClick={() => activeDoc && resetSelectionTransformDistort(activeDoc.id)}>Reset Distort</MoveActionButton>
                </div>
              ) : null}
            </>
          ) : null}
          {selectionTransformSession ? (
            <div className="grid grid-cols-2 gap-1">
              <MoveActionButton disabled={false} onClick={() => activeDoc && applySelectionTransformSession(activeDoc.id)}>Apply Selection</MoveActionButton>
              <MoveActionButton disabled={false} onClick={() => activeDoc && cancelSelectionTransformSession(activeDoc.id)}>Cancel Selection</MoveActionButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SelectionModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`rounded border px-2 py-1 text-[11px] font-semibold ${
        active
          ? 'border-cyan-400 bg-cyan-400/20 text-cyan-50'
          : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65 hover:border-cyan-400/40 hover:text-white'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function GenerativeEditVisibilityButton({ docId }: { docId: string }) {
  const dismissed = useImageEditorStore((s) => Boolean(s.generativeFillDismissedByDocId[docId]));
  const setDismissed = useImageEditorStore((s) => s.setGenerativeFillDismissed);
  return (
    <MoveActionButton disabled={false} onClick={() => setDismissed(docId, !dismissed)}>
      {dismissed ? 'Show Generative Edit' : 'Hide Generative Edit'}
    </MoveActionButton>
  );
}

export function MoveActionButton({
  ariaLabel,
  children,
  disabled,
  onClick,
}: {
  ariaLabel?: string;
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[11px] font-semibold text-cyan-100/65 hover:border-cyan-400/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function EditableNumericField({
  ariaLabel,
  disabled,
  label,
  max,
  min,
  onCommit,
  step = 1,
  value,
}: {
  ariaLabel: string;
  disabled: boolean;
  label: string;
  max?: number;
  min?: number;
  onCommit: (value: number) => void;
  step?: number;
  value: number;
}) {
  const [draft, setDraft] = useState(() => formatEditableNumber(value));

  useEffect(() => {
    setDraft(formatEditableNumber(value));
  }, [value]);

  const commit = () => {
    if (disabled) {
      setDraft(formatEditableNumber(value));
      return;
    }
    const nextValue = Number(draft);
    if (!Number.isFinite(nextValue)) {
      setDraft(formatEditableNumber(value));
      return;
    }
    onCommit(nextValue);
  };

  return (
    <label className="flex flex-1 items-center gap-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1">
      <span className="text-cyan-100/40">{label}</span>
      <input
        aria-label={ariaLabel}
        className="min-w-0 flex-1 bg-transparent text-right text-cyan-100/80 outline-none disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        max={max}
        min={min}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(formatEditableNumber(value));
            event.currentTarget.blur();
          }
        }}
        step={step}
        type="number"
        value={draft}
      />
    </label>
  );
}

function resizeBitmap(source: NonNullable<ImageLayer['bitmap']>, width: number, height: number): NonNullable<ImageLayer['bitmap']> {
  const bitmap = createBitmap(width, height);
  const ctx = bitmap.getContext('2d');
  if (ctx) {
    ctx.drawImage(source, 0, 0, width, height);
  }
  return bitmap;
}

function formatEditableNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function normalizeLayerRotation(rotationDeg: number): number {
  if (!Number.isFinite(rotationDeg)) return 0;
  return Math.round((((rotationDeg % 360) + 360) % 360) * 100) / 100;
}

function normalizeSignedRotation(rotationDeg: number): number {
  const normalized = normalizeLayerRotation(rotationDeg);
  return normalized > 180 ? normalized - 360 : normalized;
}

function clampTransformOrigin(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

function normalizeLayerSkew(skewDeg: number): number {
  if (!Number.isFinite(skewDeg)) return 0;
  return Math.max(-75, Math.min(75, Math.round(skewDeg * 100) / 100));
}

function normalizeLayerPerspective(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-0.95, Math.min(0.95, Math.round(value * 1000) / 1000));
}

function normalizeLayerWarp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, Math.round(value * 1000) / 1000));
}
