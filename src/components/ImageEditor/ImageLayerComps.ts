import type { ImageDocument, ImageLayer, ImageLayerComp } from '../../types/imageEditor';

/** Capture a small, intentional layer-arrangement snapshot. Pixel contents, masks, and
 * transforms stay live; a comp only records the presentation decisions it promises. */
export function captureImageLayerComp(document: ImageDocument, name: string): ImageLayerComp {
  return {
    id: `layer-comp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: name.trim().slice(0, 80) || `Layer Comp ${(document.layerComps?.length ?? 0) + 1}`,
    createdAt: Date.now(),
    layers: document.layers.map((layer) => ({
      layerId: layer.id,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    })),
  };
}

/** Apply only still-present layers so a saved comp remains safe after later layer edits. */
export function applyImageLayerComp(layers: readonly ImageLayer[], comp: ImageLayerComp): ImageLayer[] {
  const states = new Map(comp.layers.map((state) => [state.layerId, state] as const));
  return layers.map((layer) => {
    const state = states.get(layer.id);
    return state ? {
      ...layer,
      visible: state.visible,
      opacity: state.opacity,
      blendMode: state.blendMode,
    } : layer;
  });
}

export function upsertImageLayerComp(
  current: readonly ImageLayerComp[] | undefined,
  comp: ImageLayerComp,
): ImageLayerComp[] {
  const withoutSameName = (current ?? []).filter((candidate) => candidate.name !== comp.name);
  return [...withoutSameName, comp];
}

export type ImageLayerCompMutation =
  | { ok: true; comps: ImageLayerComp[] }
  | { ok: false; reason: 'blank-name' | 'duplicate-name' | 'unknown-comp' };

/** Rename one saved comp. Refuses blank or colliding names and unknown comp ids so a
 * mistyped identifier can never silently corrupt the retained comp list. */
export function renameImageLayerComp(
  current: readonly ImageLayerComp[] | undefined,
  compId: string,
  nextName: string,
): ImageLayerCompMutation {
  const list = current ?? [];
  const trimmed = typeof nextName === 'string' ? nextName.trim().slice(0, 80) : '';
  if (!trimmed) return { ok: false, reason: 'blank-name' };
  if (!list.some((comp) => comp.id === compId)) return { ok: false, reason: 'unknown-comp' };
  if (list.some((comp) => comp.id !== compId && comp.name === trimmed)) return { ok: false, reason: 'duplicate-name' };
  return { ok: true, comps: list.map((comp) => (comp.id === compId ? { ...comp, name: trimmed } : comp)) };
}

/** Delete one saved comp by id, refusing unknown ids without touching the rest of the list. */
export function deleteImageLayerComp(
  current: readonly ImageLayerComp[] | undefined,
  compId: string,
): ImageLayerCompMutation {
  const list = current ?? [];
  if (!list.some((comp) => comp.id === compId)) return { ok: false, reason: 'unknown-comp' };
  return { ok: true, comps: list.filter((comp) => comp.id !== compId) };
}
