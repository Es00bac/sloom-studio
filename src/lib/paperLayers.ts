import type { PaperDocument, PaperFrame, PaperLayer } from '../types/paper';

export const PAPER_DEFAULT_LAYER_ID = 'paper-layer-default';

export const DEFAULT_PAPER_LAYER: PaperLayer = {
  id: PAPER_DEFAULT_LAYER_ID,
  name: 'Layer 1',
  visible: true,
  printable: true,
  locked: false,
};

const MAX_LAYER_COUNT = 256;
const MAX_LAYER_ID_LENGTH = 160;
const MAX_LAYER_NAME_LENGTH = 160;
let fallbackLayerIdSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/** Parse untrusted/legacy layer metadata without allowing duplicate identities or an empty catalog. */
export function normalizePaperLayers(value: unknown): PaperLayer[] {
  if (!Array.isArray(value)) return [{ ...DEFAULT_PAPER_LAYER }];
  const seen = new Set<string>();
  const layers: PaperLayer[] = [];
  for (const entry of value.slice(0, MAX_LAYER_COUNT)) {
    if (!isRecord(entry)) continue;
    const id = boundedText(entry.id, MAX_LAYER_ID_LENGTH);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    layers.push({
      id,
      name: boundedText(entry.name, MAX_LAYER_NAME_LENGTH) ?? `Layer ${layers.length + 1}`,
      visible: entry.visible !== false,
      printable: entry.printable !== false,
      locked: entry.locked === true,
    });
  }
  return layers.length ? layers : [{ ...DEFAULT_PAPER_LAYER }];
}

export function resolveDefaultPaperLayerId(document: Pick<PaperDocument, 'layers'>): string {
  return normalizePaperLayers(document.layers)[0].id;
}

export function resolvePaperFrameLayer(
  document: Pick<PaperDocument, 'layers'>,
  frame: Pick<PaperFrame, 'layerId'>,
): PaperLayer {
  const layers = normalizePaperLayers(document.layers);
  return layers.find((layer) => layer.id === frame.layerId) ?? layers[0];
}

export function paperFrameLayerIsVisible(
  document: Pick<PaperDocument, 'layers'>,
  frame: Pick<PaperFrame, 'layerId'>,
): boolean {
  return resolvePaperFrameLayer(document, frame).visible;
}

export function paperFrameLayerIsPrintable(
  document: Pick<PaperDocument, 'layers'>,
  frame: Pick<PaperFrame, 'layerId'>,
): boolean {
  const layer = resolvePaperFrameLayer(document, frame);
  return layer.visible && layer.printable;
}

export function paperFrameLayerIsLocked(
  document: Pick<PaperDocument, 'layers'>,
  frame: Pick<PaperFrame, 'layerId'>,
): boolean {
  return resolvePaperFrameLayer(document, frame).locked;
}

/** Parent-page content participates in page output only while at least one page applies it. */
export function paperParentPageIsApplied(
  document: Pick<PaperDocument, 'pages'>,
  parentPageId: string,
): boolean {
  return document.pages.some((page) => page.parentPageId === parentPageId);
}

/** Stable back-to-front ordering: layer order first, then the frame's existing z-index. */
export function sortPaperFramesByLayer(
  document: Pick<PaperDocument, 'layers'>,
  frames: readonly PaperFrame[],
): PaperFrame[] {
  const layers = normalizePaperLayers(document.layers);
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]));
  const fallbackOrder = 0;
  return frames
    .map((frame, inputIndex) => ({ frame, inputIndex }))
    .sort((a, b) => {
      const aLayer = layerOrder.get(a.frame.layerId ?? '') ?? fallbackOrder;
      const bLayer = layerOrder.get(b.frame.layerId ?? '') ?? fallbackOrder;
      return aLayer - bLayer || a.frame.zIndex - b.frame.zIndex || a.inputIndex - b.inputIndex;
    })
    .map(({ frame }) => frame);
}

function makePaperLayerId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `paper-layer-${uuid}`;
  fallbackLayerIdSequence += 1;
  return `paper-layer-${Date.now().toString(36)}-${fallbackLayerIdSequence.toString(36)}`;
}

function touchLayers(document: PaperDocument, layers: PaperLayer[]): PaperDocument {
  return { ...document, layers, updatedAt: Date.now() };
}

function uniqueLayerName(layers: readonly PaperLayer[], requestedName?: string): string {
  const base = boundedText(requestedName, MAX_LAYER_NAME_LENGTH) ?? `Layer ${layers.length + 1}`;
  const names = new Set(layers.map((layer) => layer.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`.toLocaleLowerCase())) suffix += 1;
  return `${base} ${suffix}`.slice(0, MAX_LAYER_NAME_LENGTH);
}

export function addPaperLayer(
  document: PaperDocument,
  requestedName?: string,
): { document: PaperDocument; layerId?: string } {
  const layers = normalizePaperLayers(document.layers);
  if (layers.length >= MAX_LAYER_COUNT) return { document };
  const layer: PaperLayer = {
    id: makePaperLayerId(),
    name: uniqueLayerName(layers, requestedName),
    visible: true,
    printable: true,
    locked: false,
  };
  return { document: touchLayers(document, [...layers, layer]), layerId: layer.id };
}

export function renamePaperLayer(document: PaperDocument, layerId: string, name: string): PaperDocument {
  const normalizedName = boundedText(name, MAX_LAYER_NAME_LENGTH);
  if (!normalizedName) return document;
  const layers = normalizePaperLayers(document.layers);
  const target = layers.find((layer) => layer.id === layerId);
  if (!target || target.name === normalizedName) return document;
  return touchLayers(document, layers.map((layer) => (
    layer.id === layerId ? { ...layer, name: normalizedName } : layer
  )));
}

export function movePaperLayer(
  document: PaperDocument,
  layerId: string,
  direction: 'backward' | 'forward',
): PaperDocument {
  const layers = normalizePaperLayers(document.layers);
  const index = layers.findIndex((layer) => layer.id === layerId);
  if (index < 0) return document;
  const nextIndex = direction === 'backward' ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= layers.length) return document;
  const reordered = [...layers];
  [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
  return touchLayers(document, reordered);
}

export function updatePaperLayer(
  document: PaperDocument,
  layerId: string,
  patch: Partial<Pick<PaperLayer, 'visible' | 'printable' | 'locked'>>,
): PaperDocument {
  const layers = normalizePaperLayers(document.layers);
  const target = layers.find((layer) => layer.id === layerId);
  if (!target) return document;
  const next = {
    ...target,
    ...(typeof patch.visible === 'boolean' ? { visible: patch.visible } : {}),
    ...(typeof patch.printable === 'boolean' ? { printable: patch.printable } : {}),
    ...(typeof patch.locked === 'boolean' ? { locked: patch.locked } : {}),
  };
  if (
    next.visible === target.visible
    && next.printable === target.printable
    && next.locked === target.locked
  ) return document;
  return touchLayers(document, layers.map((layer) => layer.id === layerId ? next : layer));
}

/** Assign only editable local frames. Locked frames/layers and inherited parent items fail closed. */
export function assignPaperFramesToLayer(
  document: PaperDocument,
  pageId: string,
  frameIds: readonly string[],
  layerId: string,
): PaperDocument {
  const layers = normalizePaperLayers(document.layers);
  const targetLayer = layers.find((layer) => layer.id === layerId);
  if (!targetLayer || targetLayer.locked) return document;
  const selected = new Set(frameIds);
  if (!selected.size) return document;
  let changed = false;
  const pages = document.pages.map((page) => {
    if (page.id !== pageId) return page;
    const frames = page.frames.map((frame) => {
      if (!selected.has(frame.id) || frame.inherited || frame.locked || paperFrameLayerIsLocked(document, frame)) {
        return frame;
      }
      if (frame.layerId === layerId) return frame;
      changed = true;
      return { ...frame, layerId };
    });
    return changed ? { ...page, frames } : page;
  });
  return changed ? { ...document, layers, pages, updatedAt: Date.now() } : document;
}
