import type { ImageDocument, ImageLayer } from '../types/imageEditor';

/**
 * Pure, canvas-free op model for the unified cross-device sync of the **Image** workspace (task #53) —
 * the Image analog of [[flowGraphNativeSync]] / [[paperDocumentNativeSync]], but with the one structural
 * difference that makes Image the hard channel: **a layer's pixels are a live `OffscreenCanvas`
 * (`bitmap`/`mask`), multi-MB and non-serializable, so they cannot ride inside a JSON op the way Paper
 * inlines a frame or Flow inlines node data.**
 *
 * The resolution is a clean split:
 *
 *  - This module operates only on a **canvas-free projection**, `ImageDocumentWire`, where every layer's
 *    `bitmap`/`mask`/`bitmapData`/`maskData` are dropped and replaced by `hasBitmap`/`hasMask` flags plus
 *    the layer's existing monotonic `bitmapVersion`. That keeps the op core a pure function with no
 *    canvas dependency — fully testable under jsdom with no `OffscreenCanvas`.
 *  - The actual pixels travel **out-of-band**, content-addressed by `\`${layerId}@${bitmapVersion}\``.
 *    An op never carries bytes; `image-layer-pixels-updated` carries only the version + presence flags,
 *    and the receiving channel fetches the bytes for a version it does not already hold. Because the key
 *    is the content version, a receiver never re-fetches pixels it has cached — which is what makes even
 *    a full `image-document-snapshot` cheap (it re-fetches only genuinely-new layer versions).
 *
 * The store seam (`imageEditorStore.applyRemoteImageDocumentChange`) and the channel
 * (`imageSyncChannel`) — both of which have canvas access — own the live↔wire projection and the
 * out-of-band byte transfer. This module owns only the serializable op algebra.
 */

/** A layer with its live/serialized pixel buffers stripped — metadata + version + presence flags only. */
export type ImageLayerWire = Omit<
  ImageLayer,
  | 'bitmap'
  | 'mask'
  | 'bitmapData'
  | 'maskData'
  | 'tiltmarkBaseBitmap'
  | 'tiltmarkBaseBitmapData'
  | 'tiltmarkSimulationData'
> & {
  /** Whether the source layer currently holds bitmap pixels (so a receiver knows to fetch them). */
  hasBitmap: boolean;
  /** Whether the source layer currently holds a mask (fetched as its own out-of-band asset). */
  hasMask: boolean;
  /** Optional for compatibility with peers predating Tiltmark smart layers. */
  hasTiltmarkBase?: boolean;
  hasTiltmarkSimulation?: boolean;
};

/** The whole document, canvas-free: wire layers, and undo `snapshots` dropped (history isn't synced). */
export type ImageDocumentWire = Omit<ImageDocument, 'layers' | 'snapshots'> & {
  layers: ImageLayerWire[];
};

/** A metadata patch for a layer — never carries pixel-version fields (those move via a pixels op). */
export type ImageLayerWireMetaPatch = Partial<Omit<
  ImageLayerWire,
  'bitmapVersion' | 'hasBitmap' | 'hasMask' | 'hasTiltmarkBase' | 'hasTiltmarkSimulation'
>>;

/** A document-level patch — everything that isn't the layer list or the active/selection pointers. */
export type ImageDocumentPropsPatch = Partial<
  Omit<ImageDocumentWire, 'layers' | 'activeLayerId' | 'selectedLayerIds'>
>;

export type ImageDocumentNativeChange =
  | {
      type: 'image-document-snapshot';
      document: ImageDocumentWire;
      /** Per-layer immutable transport keys; omitted by legacy single-writer peers. */
      pixelAssetRevisions?: Record<string, string>;
    }
  | { type: 'image-layer-added'; documentId?: string; index: number; layer: ImageLayerWire; pixelAssetRevision?: string }
  | { type: 'image-layer-removed'; documentId?: string; layerId: string }
  | { type: 'image-layers-reordered'; documentId?: string; layerIds: string[] }
  | { type: 'image-layer-props-updated'; documentId?: string; layerId: string; patch: ImageLayerWireMetaPatch; unsetKeys?: string[] }
  | {
      type: 'image-layer-pixels-updated';
      /** Explicit document target. Optional only for compatibility with pre-simultaneous peers. */
      documentId?: string;
      layerId: string;
      bitmapVersion: number;
      hasBitmap: boolean;
      hasMask: boolean;
      hasTiltmarkBase?: boolean;
      hasTiltmarkSimulation?: boolean;
      /** Disambiguates concurrent peers that independently advance the same numeric version. */
      pixelAssetRevision?: string;
    }
  | { type: 'image-document-props-updated'; documentId?: string; patch: ImageDocumentPropsPatch; unsetKeys?: string[] }
  | { type: 'image-active-layer-changed'; documentId?: string; activeLayerId: string | null; selectedLayerIds?: string[] };

/** Deterministic, key-sorted JSON so object key order never registers as a change. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** Project a live layer to its canvas-free wire form. Reads `.bitmap`/`.mask` only for null-ness. */
export function toImageLayerWire(layer: ImageLayer): ImageLayerWire {
  const {
    bitmap,
    mask,
    bitmapData,
    maskData,
    tiltmarkBaseBitmap,
    tiltmarkBaseBitmapData,
    tiltmarkSimulationData,
    ...meta
  } = layer;
  return {
    ...meta,
    hasBitmap: bitmap != null || bitmapData != null,
    hasMask: mask != null || maskData != null,
    ...(tiltmarkBaseBitmap != null || tiltmarkBaseBitmapData != null
      ? { hasTiltmarkBase: true }
      : {}),
    ...(tiltmarkSimulationData ? { hasTiltmarkSimulation: true } : {}),
  };
}

/** Project a live document to its canvas-free wire form (layers stripped, undo snapshots dropped). */
export function toImageDocumentWire(document: ImageDocument): ImageDocumentWire {
  const { layers, snapshots: _snapshots, ...rest } = document;
  return { ...rest, layers: layers.map(toImageLayerWire) };
}

/** The non-pixel metadata of a wire layer (the comparable surface for a props diff). */
function layerMetaPatch(layer: ImageLayerWire): ImageLayerWireMetaPatch {
  const {
    bitmapVersion: _v,
    hasBitmap: _b,
    hasMask: _m,
    hasTiltmarkBase: _tb,
    hasTiltmarkSimulation: _ts,
    ...meta
  } = layer;
  return meta;
}

/** True when two wire layers differ in any non-pixel metadata field (id excluded — same id assumed). */
function layerMetaChanged(a: ImageLayerWire, b: ImageLayerWire): boolean {
  return stableStringify(layerMetaPatch(a)) !== stableStringify(layerMetaPatch(b));
}

/** True when a layer's pixel state changed: a new bitmap version, or bitmap/mask presence flipped. */
function layerPixelsChanged(a: ImageLayerWire, b: ImageLayerWire): boolean {
  return a.bitmapVersion !== b.bitmapVersion
    || a.hasBitmap !== b.hasBitmap
    || a.hasMask !== b.hasMask
    || Boolean(a.hasTiltmarkBase) !== Boolean(b.hasTiltmarkBase)
    || Boolean(a.hasTiltmarkSimulation) !== Boolean(b.hasTiltmarkSimulation);
}

const findLayer = (document: ImageDocumentWire, layerId: string): ImageLayerWire | undefined =>
  document.layers.find((layer) => layer.id === layerId);

/**
 * Reducer: apply one serialized op to a wire document, returning the **same reference on a no-op**
 * (re-add of an existing id, op against a missing layer, move to an identical order/value). That
 * idempotency is what the channel's echo-guard and change/no-op return both rely on.
 */
export function applyImageDocumentNativeChange(
  document: ImageDocumentWire,
  change: ImageDocumentNativeChange,
): ImageDocumentWire {
  switch (change.type) {
    case 'image-document-snapshot':
      return change.document;

    case 'image-layer-added': {
      if (findLayer(document, change.layer.id)) return document; // idempotent re-add
      const layers = document.layers.slice();
      const index = Math.max(0, Math.min(change.index, layers.length));
      layers.splice(index, 0, change.layer);
      return { ...document, layers };
    }

    case 'image-layer-removed': {
      if (!findLayer(document, change.layerId)) return document;
      const layers = document.layers.filter((layer) => layer.id !== change.layerId);
      const activeLayerId = document.activeLayerId === change.layerId
        ? layers[0]?.id ?? null
        : document.activeLayerId;
      const selectedLayerIds = document.selectedLayerIds?.filter((id) => id !== change.layerId);
      return { ...document, layers, activeLayerId, selectedLayerIds };
    }

    case 'image-layers-reordered': {
      const byId = new Map(document.layers.map((layer) => [layer.id, layer] as const));
      const reordered = change.layerIds
        .map((id) => byId.get(id))
        .filter((layer): layer is ImageLayerWire => layer != null);
      // Keep any layers the order list didn't mention (defensive against a stale ordering).
      for (const layer of document.layers) {
        if (!change.layerIds.includes(layer.id)) reordered.push(layer);
      }
      if (reordered.length === document.layers.length
        && reordered.every((layer, i) => layer === document.layers[i])) {
        return document; // identical order — no-op
      }
      return { ...document, layers: reordered };
    }

    case 'image-layer-props-updated': {
      const target = findLayer(document, change.layerId);
      if (!target) return document;
      const merged = { ...target, ...change.patch };
      for (const key of change.unsetKeys ?? []) delete (merged as unknown as Record<string, unknown>)[key];
      if (stableStringify(layerMetaPatch(merged)) === stableStringify(layerMetaPatch(target))) {
        return document; // patch changed nothing
      }
      return {
        ...document,
        layers: document.layers.map((layer) => (layer.id === change.layerId ? merged : layer)),
      };
    }

    case 'image-layer-pixels-updated': {
      const target = findLayer(document, change.layerId);
      if (!target) return document;
      if (target.bitmapVersion === change.bitmapVersion
        && target.hasBitmap === change.hasBitmap
        && target.hasMask === change.hasMask
        && Boolean(target.hasTiltmarkBase) === Boolean(change.hasTiltmarkBase)
        && Boolean(target.hasTiltmarkSimulation) === Boolean(change.hasTiltmarkSimulation)) {
        return document; // already at this pixel version
      }
      return {
        ...document,
        layers: document.layers.map((layer) =>
          layer.id === change.layerId
            ? {
                ...layer,
                bitmapVersion: change.bitmapVersion,
                hasBitmap: change.hasBitmap,
                hasMask: change.hasMask,
                ...(change.hasTiltmarkBase ? { hasTiltmarkBase: true } : { hasTiltmarkBase: undefined }),
                ...(change.hasTiltmarkSimulation
                  ? { hasTiltmarkSimulation: true }
                  : { hasTiltmarkSimulation: undefined }),
              }
            : layer,
        ),
      };
    }

    case 'image-document-props-updated': {
      const merged = { ...document, ...change.patch };
      for (const key of change.unsetKeys ?? []) delete (merged as unknown as Record<string, unknown>)[key];
      if (stableStringify({ ...merged, layers: null }) === stableStringify({ ...document, layers: null })) {
        return document; // no document-level field actually changed
      }
      return merged;
    }

    case 'image-active-layer-changed': {
      const activeUnchanged = document.activeLayerId === change.activeLayerId;
      const selectedUnchanged =
        stableStringify(document.selectedLayerIds ?? null) === stableStringify(change.selectedLayerIds ?? null);
      if (activeUnchanged && selectedUnchanged) return document;
      return { ...document, activeLayerId: change.activeLayerId, selectedLayerIds: change.selectedLayerIds };
    }

    default:
      return document;
  }
}

/**
 * Diff two wire documents into the minimal op list. Granular by design (not a snapshot-on-any-change
 * like Paper) so a single brush stroke ships only that layer's pixel op + metadata, never the whole
 * layer array — and the out-of-band, content-versioned pixel fetch keeps it correct regardless.
 *
 * Emission order is apply-safe: removes → adds → reorder → per-layer props/pixels → doc props → active.
 */
export function diffImageDocumentNativeChanges(
  prev: ImageDocumentWire,
  next: ImageDocumentWire,
): ImageDocumentNativeChange[] {
  const ops: ImageDocumentNativeChange[] = [];

  const prevById = new Map(prev.layers.map((layer) => [layer.id, layer] as const));
  const nextById = new Map(next.layers.map((layer) => [layer.id, layer] as const));

  // 1. Removed layers.
  for (const layer of prev.layers) {
    if (!nextById.has(layer.id)) ops.push({ type: 'image-layer-removed', layerId: layer.id });
  }

  // 2. Added layers (with their index in `next`).
  next.layers.forEach((layer, index) => {
    if (!prevById.has(layer.id)) ops.push({ type: 'image-layer-added', index, layer });
  });

  // 3. Reorder, if the surviving layers' relative order changed.
  const prevSurviving = prev.layers.filter((layer) => nextById.has(layer.id)).map((layer) => layer.id);
  const nextSurviving = next.layers.filter((layer) => prevById.has(layer.id)).map((layer) => layer.id);
  if (stableStringify(prevSurviving) !== stableStringify(nextSurviving)) {
    ops.push({ type: 'image-layers-reordered', layerIds: next.layers.map((layer) => layer.id) });
  }

  // 4. Per-surviving-layer metadata + pixel changes (independent ops).
  for (const layer of next.layers) {
    const before = prevById.get(layer.id);
    if (!before) continue; // already covered by add (its pixels emit below as a fresh add's own op)
    if (layerMetaChanged(before, layer)) {
      const beforeMeta = layerMetaPatch(before) as Record<string, unknown>;
      const nextMeta = layerMetaPatch(layer) as Record<string, unknown>;
      const patch = Object.fromEntries(Object.entries(nextMeta).filter(([key, value]) =>
        stableStringify(beforeMeta[key]) !== stableStringify(value))) as ImageLayerWireMetaPatch;
      const unsetKeys = Object.keys(beforeMeta).filter((key) => !Object.hasOwn(nextMeta, key));
      ops.push({
        type: 'image-layer-props-updated', layerId: layer.id, patch,
        ...(unsetKeys.length ? { unsetKeys } : {}),
      });
    }
    if (layerPixelsChanged(before, layer)) {
      ops.push({
        type: 'image-layer-pixels-updated',
        layerId: layer.id,
        bitmapVersion: layer.bitmapVersion,
        hasBitmap: layer.hasBitmap,
        hasMask: layer.hasMask,
        hasTiltmarkBase: layer.hasTiltmarkBase,
        hasTiltmarkSimulation: layer.hasTiltmarkSimulation,
      });
    }
  }

  // 5. Document-level props (everything but layers/active/selected).
  const docPatch = diffDocumentProps(prev, next);
  if (docPatch) ops.push({ type: 'image-document-props-updated', ...docPatch });

  // 6. Active / selected layer pointers.
  const activeChanged = prev.activeLayerId !== next.activeLayerId;
  const selectedChanged =
    stableStringify(prev.selectedLayerIds ?? null) !== stableStringify(next.selectedLayerIds ?? null);
  if (activeChanged || selectedChanged) {
    ops.push({
      type: 'image-active-layer-changed',
      activeLayerId: next.activeLayerId,
      selectedLayerIds: next.selectedLayerIds,
    });
  }

  return ops;
}

/** Build the minimal document-level patch (non-layer, non-active fields), or null if unchanged. */
function diffDocumentProps(
  prev: ImageDocumentWire,
  next: ImageDocumentWire,
): { patch: ImageDocumentPropsPatch; unsetKeys?: string[] } | null {
  const skip = new Set(['layers', 'activeLayerId', 'selectedLayerIds']);
  const patch: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if (skip.has(key)) continue;
    const a = (prev as Record<string, unknown>)[key];
    const b = (next as Record<string, unknown>)[key];
    if (stableStringify(a) !== stableStringify(b) && Object.hasOwn(next, key)) patch[key] = b;
  }
  const unsetKeys = [...keys].filter((key) => !skip.has(key) && Object.hasOwn(prev, key) && !Object.hasOwn(next, key));
  return Object.keys(patch).length > 0 || unsetKeys.length > 0
    ? { patch: patch as ImageDocumentPropsPatch, ...(unsetKeys.length ? { unsetKeys } : {}) }
    : null;
}
