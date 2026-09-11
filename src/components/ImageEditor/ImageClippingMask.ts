import type { ImageLayer } from '../../types/imageEditor';
import {
  getImageLayerGroupDescendantLayers,
  isImageLayerEffectivelyVisible,
  normalizeImageLayerGroupTree,
} from './ImageLayerGroups';

export interface ImageClippingMaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ImageClippingMaskBaseKind = 'layer' | 'group' | 'missing';
export type ImageClippingMaskBlockerCode = 'missing-base' | 'hidden-base';
export type ImageClippingMaskCaveat = 'group-base-descendant-alpha' | 'group-base-hidden';
export type ImageClippingMaskUnsupportedStateCode =
  | 'nested-clipping-mask-chain-editing'
  | 'group-base-descendant-alpha-preview'
  | 'source-linked-destructive-clipping-edit'
  | 'native-psd-clipping-group-roundtrip';
export type ImageClippingMaskSourceSafetyBlocker =
  | 'source-linked-base-layer'
  | 'source-linked-clipped-layer';

export interface ImageClippingMaskReadinessChain {
  baseLayerId: string | null;
  baseKind: ImageClippingMaskBaseKind;
  clippedLayerIds: string[];
  valid: boolean;
  baseVisible: boolean;
  visibleBaseDescendantLayerIds: string[];
  hiddenBaseDescendantLayerIds: string[];
  baseBounds: ImageClippingMaskBounds | null;
  blockers: ImageClippingMaskBlockerCode[];
  caveats: ImageClippingMaskCaveat[];
}

export interface ImageClippingMaskReadiness {
  descriptorId: 'image-clipping-mask-readiness:v1';
  ready: boolean;
  clippedLayerIds: string[];
  baseLayerIds: string[];
  invalidLayerIds: string[];
  hiddenBaseLayerIds: string[];
  groupBaseLayerIds: string[];
  chains: ImageClippingMaskReadinessChain[];
  chainValidation: {
    maxClippedLayerCount: number;
    groupedChainBaseLayerIds: string[];
    groupBaseChainLayerIds: string[];
    unsupportedStateCodes: ImageClippingMaskUnsupportedStateCode[];
  };
  sourceSafety: {
    sourceLinkedLayerIds: string[];
    sourceLinkedClippedLayerIds: string[];
    sourceLinkedBaseLayerIds: string[];
    destructiveBatchSafe: boolean;
    blockers: ImageClippingMaskSourceSafetyBlocker[];
  };
  previewSignature: string;
}

export function describeImageClippingMaskReadiness(
  layers: readonly ImageLayer[],
): ImageClippingMaskReadiness {
  const normalized = normalizeImageLayerGroupTree(layers).layers;
  const clippedLayerIds: string[] = [];
  const baseLayerIds: string[] = [];
  const invalidLayerIds: string[] = [];
  const hiddenBaseLayerIds: string[] = [];
  const groupBaseLayerIds: string[] = [];
  const chains: ImageClippingMaskReadinessChain[] = [];
  let activeChain: ImageClippingMaskReadinessChain | undefined;

  for (let index = 0; index < normalized.length; index += 1) {
    const layer = normalized[index];
    if (!layer.clippingMask) {
      activeChain = undefined;
      continue;
    }

    clippedLayerIds.push(layer.id);
    const baseLayer = findImageClippingBaseLayer(normalized, index);
    const chain = describeClippingMaskChainForLayer(layer, baseLayer, normalized);

    if (baseLayer) {
      pushUnique(baseLayerIds, baseLayer.id);
      if (baseLayer.type === 'group') pushUnique(groupBaseLayerIds, baseLayer.id);
      if (!chain.baseVisible) pushUnique(hiddenBaseLayerIds, baseLayer.id);
    }
    if (chain.blockers.length > 0) invalidLayerIds.push(layer.id);

    if (activeChain && activeChain.baseLayerId === chain.baseLayerId) {
      activeChain.clippedLayerIds.push(layer.id);
      activeChain.valid = activeChain.valid && chain.valid;
      activeChain.blockers = mergeUnique(activeChain.blockers, chain.blockers);
      activeChain.caveats = mergeUnique(activeChain.caveats, chain.caveats);
      continue;
    }

    chains.push(chain);
    activeChain = chain;
  }

  const chainValidation = buildClippingMaskChainValidation(chains);
  const sourceSafety = buildClippingMaskSourceSafety(normalized, chains);
  if (sourceSafety.blockers.length > 0) {
    chainValidation.unsupportedStateCodes = mergeUnique(
      chainValidation.unsupportedStateCodes,
      ['source-linked-destructive-clipping-edit'],
    );
  }
  if (chains.length > 0) {
    chainValidation.unsupportedStateCodes = mergeUnique(
      chainValidation.unsupportedStateCodes,
      ['native-psd-clipping-group-roundtrip'],
    );
  }

  const readiness: ImageClippingMaskReadiness = {
    descriptorId: 'image-clipping-mask-readiness:v1',
    ready: invalidLayerIds.length === 0 && hiddenBaseLayerIds.length === 0,
    clippedLayerIds,
    baseLayerIds,
    invalidLayerIds,
    hiddenBaseLayerIds,
    groupBaseLayerIds,
    chains,
    chainValidation,
    sourceSafety,
    previewSignature: '',
  };
  readiness.previewSignature = buildClippingMaskReadinessSignature(readiness);
  return readiness;
}

function buildClippingMaskChainValidation(
  chains: readonly ImageClippingMaskReadinessChain[],
): ImageClippingMaskReadiness['chainValidation'] {
  const maxClippedLayerCount = chains.reduce(
    (max, chain) => Math.max(max, chain.clippedLayerIds.length),
    0,
  );
  const groupedChainBaseLayerIds = chains
    .filter((chain) => chain.baseLayerId && chain.clippedLayerIds.length > 1)
    .map((chain) => chain.baseLayerId as string);
  const groupBaseChainLayerIds = chains
    .filter((chain) => chain.baseKind === 'group')
    .flatMap((chain) => chain.clippedLayerIds);
  const unsupportedStateCodes: ImageClippingMaskUnsupportedStateCode[] = [];
  if (groupedChainBaseLayerIds.length > 0) unsupportedStateCodes.push('nested-clipping-mask-chain-editing');
  if (groupBaseChainLayerIds.length > 0) unsupportedStateCodes.push('group-base-descendant-alpha-preview');
  return {
    maxClippedLayerCount,
    groupedChainBaseLayerIds,
    groupBaseChainLayerIds,
    unsupportedStateCodes,
  };
}

function buildClippingMaskSourceSafety(
  layers: readonly ImageLayer[],
  chains: readonly ImageClippingMaskReadinessChain[],
): ImageClippingMaskReadiness['sourceSafety'] {
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const sourceLinkedLayerIds = layers.filter(isSourceLinkedLayer).map((layer) => layer.id);
  const sourceLinkedClippedLayerIds = chains
    .flatMap((chain) => chain.clippedLayerIds)
    .filter((layerId) => isSourceLinkedLayer(layersById.get(layerId)));
  const sourceLinkedBaseLayerIds = chains
    .map((chain) => chain.baseLayerId)
    .filter((layerId): layerId is string => Boolean(layerId))
    .filter((layerId) => isSourceLinkedLayer(layersById.get(layerId)));
  const blockers: ImageClippingMaskSourceSafetyBlocker[] = [];
  if (sourceLinkedBaseLayerIds.length > 0) blockers.push('source-linked-base-layer');
  if (sourceLinkedClippedLayerIds.length > 0) blockers.push('source-linked-clipped-layer');
  return {
    sourceLinkedLayerIds,
    sourceLinkedClippedLayerIds,
    sourceLinkedBaseLayerIds,
    destructiveBatchSafe: blockers.length === 0,
    blockers,
  };
}

function isSourceLinkedLayer(layer: ImageLayer | undefined): boolean {
  return Boolean(layer?.metadata?.sourceLink?.id || layer?.metadata?.smartLinkedSourceId);
}

function describeClippingMaskChainForLayer(
  clippedLayer: ImageLayer,
  baseLayer: ImageLayer | undefined,
  layers: readonly ImageLayer[],
): ImageClippingMaskReadinessChain {
  if (!baseLayer) {
    return {
      baseLayerId: null,
      baseKind: 'missing',
      clippedLayerIds: [clippedLayer.id],
      valid: false,
      baseVisible: false,
      visibleBaseDescendantLayerIds: [],
      hiddenBaseDescendantLayerIds: [],
      baseBounds: null,
      blockers: ['missing-base'],
      caveats: [],
    };
  }

  const baseSummary = baseLayer.type === 'group'
    ? describeGroupBaseVisibility(baseLayer, layers)
    : describeLayerBaseVisibility(baseLayer, layers);
  const blockers: ImageClippingMaskBlockerCode[] = baseSummary.baseVisible ? [] : ['hidden-base'];
  const caveats: ImageClippingMaskCaveat[] = [];
  if (baseLayer.type === 'group') {
    caveats.push('group-base-descendant-alpha');
    if (!baseSummary.baseVisible) caveats.push('group-base-hidden');
  }

  return {
    baseLayerId: baseLayer.id,
    baseKind: baseLayer.type === 'group' ? 'group' : 'layer',
    clippedLayerIds: [clippedLayer.id],
    valid: blockers.length === 0,
    baseVisible: baseSummary.baseVisible,
    visibleBaseDescendantLayerIds: baseSummary.visibleBaseDescendantLayerIds,
    hiddenBaseDescendantLayerIds: baseSummary.hiddenBaseDescendantLayerIds,
    baseBounds: baseSummary.baseBounds,
    blockers,
    caveats,
  };
}

function describeGroupBaseVisibility(
  group: ImageLayer,
  layers: readonly ImageLayer[],
): Pick<
  ImageClippingMaskReadinessChain,
  'baseVisible' | 'visibleBaseDescendantLayerIds' | 'hiddenBaseDescendantLayerIds' | 'baseBounds'
> {
  const descendants = getImageLayerGroupDescendantLayers(layers, group.id)
    .filter((layer) => layer.type !== 'group');
  const visibleDescendants = descendants.filter((layer) => isImageLayerEffectivelyVisible(layer, layers));
  const hiddenDescendants = descendants.filter((layer) => !isImageLayerEffectivelyVisible(layer, layers));
  return {
    baseVisible: isImageLayerEffectivelyVisible(group, layers) && visibleDescendants.length > 0,
    visibleBaseDescendantLayerIds: visibleDescendants.map((layer) => layer.id),
    hiddenBaseDescendantLayerIds: hiddenDescendants.map((layer) => layer.id),
    baseBounds: unionLayerBounds(visibleDescendants),
  };
}

function describeLayerBaseVisibility(
  layer: ImageLayer,
  layers: readonly ImageLayer[],
): Pick<
  ImageClippingMaskReadinessChain,
  'baseVisible' | 'visibleBaseDescendantLayerIds' | 'hiddenBaseDescendantLayerIds' | 'baseBounds'
> {
  const baseVisible = isImageLayerEffectivelyVisible(layer, layers);
  return {
    baseVisible,
    visibleBaseDescendantLayerIds: [],
    hiddenBaseDescendantLayerIds: [],
    baseBounds: baseVisible ? getLayerBounds(layer) : null,
  };
}

function findImageClippingBaseLayer(
  layers: readonly ImageLayer[],
  clippedLayerIndex: number,
): ImageLayer | undefined {
  const clippedLayer = layers[clippedLayerIndex];
  for (let index = clippedLayerIndex - 1; index >= 0; index -= 1) {
    const candidate = layers[index];
    if (candidate.clippingMask) continue;
    if (candidate.groupId !== clippedLayer.groupId) continue;
    return candidate;
  }
  return undefined;
}

function unionLayerBounds(layers: readonly ImageLayer[]): ImageClippingMaskBounds | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const layer of layers) {
    const bounds = getLayerBounds(layer);
    if (!bounds) continue;
    x0 = Math.min(x0, bounds.x);
    y0 = Math.min(y0, bounds.y);
    x1 = Math.max(x1, bounds.x + bounds.width);
    y1 = Math.max(y1, bounds.y + bounds.height);
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
    return null;
  }
  return normalizeBounds({
    x: x0,
    y: y0,
    width: Math.max(0, x1 - x0),
    height: Math.max(0, y1 - y0),
  });
}

function getLayerBounds(layer: ImageLayer): ImageClippingMaskBounds | null {
  const source = layer.bitmap ?? layer.mask;
  if (!source || !Number.isFinite(source.width) || !Number.isFinite(source.height)) return null;
  return normalizeBounds({
    x: Number.isFinite(layer.x) ? layer.x : 0,
    y: Number.isFinite(layer.y) ? layer.y : 0,
    width: Math.max(0, source.width),
    height: Math.max(0, source.height),
  });
}

function normalizeBounds(bounds: ImageClippingMaskBounds): ImageClippingMaskBounds {
  return {
    x: roundBoundsNumber(bounds.x),
    y: roundBoundsNumber(bounds.y),
    width: roundBoundsNumber(bounds.width),
    height: roundBoundsNumber(bounds.height),
  };
}

function roundBoundsNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildClippingMaskReadinessSignature(readiness: ImageClippingMaskReadiness): string {
  return [
    readiness.descriptorId,
    `chains=${readiness.chains.length > 0 ? readiness.chains.map(formatChainSignature).join(';') : 'none'}`,
    `invalid=${formatSignatureList(readiness.invalidLayerIds)}`,
    `hiddenBases=${formatSignatureList(readiness.hiddenBaseLayerIds)}`,
    `groups=${formatSignatureList(readiness.groupBaseLayerIds)}`,
    `validation=max=${readiness.chainValidation.maxClippedLayerCount},grouped=${formatSignatureList(readiness.chainValidation.groupedChainBaseLayerIds)},group-base=${formatSignatureList(readiness.chainValidation.groupBaseChainLayerIds)},unsupported=${formatSignatureList(readiness.chainValidation.unsupportedStateCodes)}`,
    `source=linked=${formatSignatureList(readiness.sourceSafety.sourceLinkedLayerIds)},clipped=${formatSignatureList(readiness.sourceSafety.sourceLinkedClippedLayerIds)},bases=${formatSignatureList(readiness.sourceSafety.sourceLinkedBaseLayerIds)},blockers=${formatSignatureList(readiness.sourceSafety.blockers)}`,
  ].join('|');
}

function formatChainSignature(chain: ImageClippingMaskReadinessChain): string {
  return [
    `${chain.clippedLayerIds.join('+')}->${chain.baseLayerId ?? 'none'}`,
    chain.baseKind,
    chain.baseVisible ? 'visible' : 'hidden',
    `bounds=${formatBoundsSignature(chain.baseBounds)}`,
    `visible=${formatSignatureList(chain.visibleBaseDescendantLayerIds)}`,
    `hidden=${formatSignatureList(chain.hiddenBaseDescendantLayerIds)}`,
    `blockers=${formatSignatureList(chain.blockers)}`,
  ].join(':');
}

function formatBoundsSignature(bounds: ImageClippingMaskBounds | null): string {
  if (!bounds) return 'none';
  return [bounds.x, bounds.y, bounds.width, bounds.height].join(',');
}

function formatSignatureList(values: readonly string[]): string {
  return values.length > 0 ? values.join(',') : 'none';
}

function pushUnique<T>(values: T[], value: T): void {
  if (!values.includes(value)) values.push(value);
}

function mergeUnique<T>(left: readonly T[], right: readonly T[]): T[] {
  return Array.from(new Set([...left, ...right]));
}
