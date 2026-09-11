import type { BlendMode, ImageLayer, ImageLayerFilter, ImageLayerFilterMask, LayerFilterKind } from '../../../types/imageEditor';

/**
 * C2 stores its source-owned Smart Filter stack on each Smart Object instance.
 * The copies are deliberate: the regular Image layer serializer, history record, and compositor
 * already own this shape. Every write below replaces all members of a source atomically, so an
 * instance cannot silently drift from its source siblings.
 */
export const SMART_OBJECT_FILTER_LIMITS = {
  maxFilters: 32,
  maxFilterMaskCells: 4_194_304,
  maxFilterIdLength: 128,
} as const;

const SUPPORTED_FILTER_KINDS = new Set<LayerFilterKind>([
  'blur',
  'sharpen',
  'grayscale',
  'sepia',
  'invert',
  'noise',
  'pixelate',
  'denoise',
]);

const SUPPORTED_BLEND_MODES = new Set<BlendMode>([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

export type SmartObjectFilterBlockerCode =
  | 'missing-source-instances'
  | 'locked-source-instance'
  | 'too-many-filters'
  | 'invalid-filter'
  | 'duplicate-filter-id'
  | 'unsupported-filter'
  | 'invalid-filter-mask'
  | 'filter-mask-too-large';

export interface SmartObjectFilterBlocker {
  code: SmartObjectFilterBlockerCode;
  message: string;
}

export interface SmartObjectFilterStackRead {
  sourceId: string;
  instanceIds: string[];
  filters: ImageLayerFilter[];
  divergentInstanceIds: string[];
}

export type SmartObjectFilterStackResult =
  | { ok: true; value: SmartObjectFilterStackRead }
  | { ok: false; blocker: SmartObjectFilterBlocker };

export type SmartObjectFilterStackUpdate =
  | { ok: true; layers: ImageLayer[]; changed: boolean; instanceIds: string[]; filters: ImageLayerFilter[] }
  | { ok: false; blocker: SmartObjectFilterBlocker };

/** Read the active instance's retained stack and reveal whether legacy local stacks disagree. */
export function readSmartObjectFilterStack(
  layers: readonly ImageLayer[],
  sourceId: string,
  preferredLayerId?: string,
): SmartObjectFilterStackResult {
  const members = smartObjectMembers(layers, sourceId);
  if (members.length === 0) return missingSourceInstances();
  const preferred = members.find((layer) => layer.id === preferredLayerId) ?? members[0]!;
  const normalized = normalizeSmartObjectFilterStack(preferred.filters);
  if (!normalized.ok) return normalized;
  const divergentInstanceIds: string[] = [];
  for (const member of members) {
    const candidate = normalizeSmartObjectFilterStack(member.filters);
    if (!candidate.ok || !filterStacksEqual(normalized.filters, candidate.filters)) {
      divergentInstanceIds.push(member.id);
    }
  }
  return {
    ok: true,
    value: {
      sourceId,
      instanceIds: members.map((member) => member.id),
      filters: normalized.filters,
      divergentInstanceIds,
    },
  };
}

/**
 * Validate once, then copy the same canonical stack to all instances of this source.
 * Callers commit `layers` as one `layerOp`, keeping undo/redo and save/reopen ordinary.
 */
export function replaceSmartObjectFilterStack(
  layers: readonly ImageLayer[],
  sourceId: string,
  nextFilters: readonly ImageLayerFilter[] | undefined,
): SmartObjectFilterStackUpdate {
  const members = smartObjectMembers(layers, sourceId);
  if (members.length === 0) return missingSourceInstances();
  const locked = members.find((layer) => layer.locked);
  if (locked) {
    return {
      ok: false,
      blocker: {
        code: 'locked-source-instance',
        message: `Smart Filter stack cannot change because shared instance “${locked.name || locked.id}” is locked.`,
      },
    };
  }
  const normalized = normalizeSmartObjectFilterStack(nextFilters);
  if (!normalized.ok) return normalized;
  const memberIds = new Set(members.map((layer) => layer.id));
  let changed = false;
  const nextLayers = layers.map((layer) => {
    if (!memberIds.has(layer.id)) return layer;
    if (!filterStacksEqual(layer.filters ?? [], normalized.filters)) changed = true;
    return { ...layer, filters: cloneFilterStack(normalized.filters) };
  });
  return {
    ok: true,
    layers: nextLayers,
    changed,
    instanceIds: members.map((member) => member.id),
    filters: cloneFilterStack(normalized.filters),
  };
}

function smartObjectMembers(layers: readonly ImageLayer[], sourceId: string): ImageLayer[] {
  if (!sourceId.trim()) return [];
  return layers.filter((layer) => layer.smartObject?.sourceId === sourceId);
}

function missingSourceInstances(): SmartObjectFilterStackUpdate & { ok: false } {
  return {
    ok: false,
    blocker: {
      code: 'missing-source-instances',
      message: 'Smart Filter stack cannot change because this Smart Object source has no retained instances.',
    },
  };
}

export function normalizeSmartObjectFilterStack(
  filters: readonly ImageLayerFilter[] | undefined,
): { ok: true; filters: ImageLayerFilter[] } | { ok: false; blocker: SmartObjectFilterBlocker } {
  if (filters === undefined) return { ok: true, filters: [] };
  if (!Array.isArray(filters)) {
    return { ok: false, blocker: { code: 'invalid-filter', message: 'Smart Filter records must be an array.' } };
  }
  if (filters.length > SMART_OBJECT_FILTER_LIMITS.maxFilters) {
    return {
      ok: false,
      blocker: {
        code: 'too-many-filters',
        message: `Smart Filter stacks are limited to ${SMART_OBJECT_FILTER_LIMITS.maxFilters} retained filters.`,
      },
    };
  }
  const ids = new Set<string>();
  const normalized: ImageLayerFilter[] = [];
  for (const input of filters) {
    if (!input || typeof input !== 'object') {
      return { ok: false, blocker: { code: 'invalid-filter', message: 'Smart Filter records must be objects.' } };
    }
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id || id.length > SMART_OBJECT_FILTER_LIMITS.maxFilterIdLength) {
      return { ok: false, blocker: { code: 'invalid-filter', message: 'Smart Filter ids must be non-empty bounded strings.' } };
    }
    if (ids.has(id)) {
      return { ok: false, blocker: { code: 'duplicate-filter-id', message: `Smart Filter id “${id}” is duplicated.` } };
    }
    ids.add(id);
    if (!SUPPORTED_FILTER_KINDS.has(input.kind)) {
      return { ok: false, blocker: { code: 'unsupported-filter', message: `Smart Filter “${String(input.kind)}” is unsupported; use the bounded Image filter set.` } };
    }
    const maxAmount = input.kind === 'blur' || input.kind === 'pixelate' ? 32 : 100;
    if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > maxAmount
      || !Number.isFinite(input.opacity) || input.opacity < 0 || input.opacity > 1
      || typeof input.enabled !== 'boolean' || !SUPPORTED_BLEND_MODES.has(input.blendMode)) {
      return { ok: false, blocker: { code: 'invalid-filter', message: `Smart Filter “${id}” has an unsupported amount, opacity, enabled state, or blend mode.` } };
    }
    const mask = normalizeFilterMask(input.mask);
    if (!mask.ok) return mask;
    normalized.push({
      id,
      kind: input.kind,
      enabled: input.enabled,
      amount: input.amount,
      opacity: input.opacity,
      blendMode: input.blendMode,
      mask: mask.value,
    });
  }
  return { ok: true, filters: normalized };
}

function normalizeFilterMask(
  input: ImageLayerFilterMask | undefined,
): { ok: true; value: ImageLayerFilterMask | undefined } | { ok: false; blocker: SmartObjectFilterBlocker } {
  if (!input) return { ok: true, value: undefined };
  const width = input.width;
  const height = input.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, blocker: { code: 'invalid-filter-mask', message: 'Smart Filter mask dimensions must be positive integers.' } };
  }
  const cells = width * height;
  if (!Number.isSafeInteger(cells) || cells > SMART_OBJECT_FILTER_LIMITS.maxFilterMaskCells) {
    return { ok: false, blocker: { code: 'filter-mask-too-large', message: `Smart Filter masks are limited to ${SMART_OBJECT_FILTER_LIMITS.maxFilterMaskCells.toLocaleString()} cells.` } };
  }
  if (!Array.isArray(input.alpha) || input.alpha.length !== cells) {
    return { ok: false, blocker: { code: 'invalid-filter-mask', message: 'Smart Filter masks must contain exactly one alpha value per cell.' } };
  }
  const alpha: number[] = [];
  for (const value of input.alpha) {
    if (!Number.isFinite(value)) {
      return { ok: false, blocker: { code: 'invalid-filter-mask', message: 'Smart Filter mask alpha values must be finite.' } };
    }
    alpha.push(Math.max(0, Math.min(255, Math.round(value))));
  }
  return { ok: true, value: { width, height, alpha } };
}

function cloneFilterStack(filters: readonly ImageLayerFilter[]): ImageLayerFilter[] {
  return filters.map((filter) => ({
    ...filter,
    mask: filter.mask ? { ...filter.mask, alpha: [...filter.mask.alpha] } : undefined,
  }));
}

function filterStacksEqual(left: readonly ImageLayerFilter[], right: readonly ImageLayerFilter[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
