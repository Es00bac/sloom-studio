import type { ColorSwatchUsageMode, NodeData } from '../types/flow';

export const DEFAULT_COLOR_SWATCH_DRAFT_COLOR = '#38BDF8';

export interface ColorSwatchUsageOption {
  id: ColorSwatchUsageMode;
  label: string;
  instruction: string;
}

export const COLOR_SWATCH_USAGE_OPTIONS: ColorSwatchUsageOption[] = [
  {
    id: 'primary',
    label: 'Primary palette',
    instruction: 'Use these colors primarily and keep generated media aligned with this palette.',
  },
  {
    id: 'theme',
    label: 'Mood / theme',
    instruction: 'Follow this palette as the overall mood and theme while allowing supporting neutrals.',
  },
  {
    id: 'brand',
    label: 'Brand colors',
    instruction: 'Treat these as brand colors; keep accents and key subjects consistent with this palette.',
  },
  {
    id: 'grade',
    label: 'Lighting / grade',
    instruction: 'Use these colors as the color grade and lighting direction for the scene.',
  },
];

const COLOR_SWATCH_USAGE_IDS = new Set<ColorSwatchUsageMode>(
  COLOR_SWATCH_USAGE_OPTIONS.map((option) => option.id),
);

type ColorSwatchPromptData = Pick<
  NodeData,
  'colorSwatchColors' | 'colorSwatchUsageMode'
>;

export function isColorSwatchUsageMode(value: unknown): value is ColorSwatchUsageMode {
  return typeof value === 'string' && COLOR_SWATCH_USAGE_IDS.has(value as ColorSwatchUsageMode);
}

export function resolveColorSwatchUsageMode(value: unknown): ColorSwatchUsageMode {
  return isColorSwatchUsageMode(value) ? value : 'primary';
}

export function getColorSwatchUsageOption(value: unknown): ColorSwatchUsageOption {
  const mode = resolveColorSwatchUsageMode(value);
  return COLOR_SWATCH_USAGE_OPTIONS.find((option) => option.id === mode) ?? COLOR_SWATCH_USAGE_OPTIONS[0];
}

export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const raw = match[1].toUpperCase();
  const expanded = raw.length === 3
    ? raw.split('').map((char) => `${char}${char}`).join('')
    : raw;

  return `#${expanded}`;
}

export function normalizeColorSwatchColors(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const colors: string[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    const color = normalizeHexColor(candidate);
    if (!color || seen.has(color)) {
      continue;
    }
    colors.push(color);
    seen.add(color);
  }

  return colors;
}

export function formatColorSwatchPrompt(data: ColorSwatchPromptData): string {
  const colors = normalizeColorSwatchColors(data.colorSwatchColors);
  if (colors.length === 0) {
    return '';
  }

  const option = getColorSwatchUsageOption(data.colorSwatchUsageMode);
  return `Color swatch: ${colors.join(', ')}. ${option.instruction}`;
}

// ---- Color Swatch node (labelled subset fed by Color Palette color handles) ----

export interface ColorSwatchListEntry {
  /** Stable key: `${sourcePaletteNodeId}:${sourceHandleId}`. */
  key: string;
  /** Live hex color resolved from the connected Color Palette. */
  color: string;
  /** User label for this entry (e.g. "hair", "skin", "shirt"). */
  label: string;
}

interface ColorSwatchListNodeLike {
  id: string;
  data: Pick<NodeData, 'colorSwatchEntryLabels'>;
}
interface PaletteNodeLike {
  id: string;
  type?: string;
  data: Pick<NodeData, 'colorSwatchColors'>;
}
interface ColorEdgeLike {
  source: string;
  sourceHandle?: string | null;
  target: string;
}

/** Build a stable per-color source handle id for the Color Palette node. */
export function paletteColorHandleId(index: number): string {
  return `palette-color-${index}`;
}

/**
 * Resolve a Color Swatch node's entries from the graph: each incoming edge from a Color Palette color
 * handle becomes a `{ live color, label }` entry. The swatch is a labelled SUBSET — only connected
 * colors appear, and a color the user removes from the palette simply drops out.
 */
export function resolveColorSwatchListEntries(
  node: ColorSwatchListNodeLike,
  nodes: ReadonlyArray<PaletteNodeLike>,
  edges: ReadonlyArray<ColorEdgeLike>,
): ColorSwatchListEntry[] {
  const labels = node.data.colorSwatchEntryLabels ?? {};
  const entries: ColorSwatchListEntry[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    if (edge.target !== node.id) continue;
    const handle = edge.sourceHandle ?? '';
    const match = /^palette-color-(\d+)$/.exec(handle);
    if (!match) continue;
    const source = nodes.find((candidate) => candidate.id === edge.source);
    if (!source || source.type !== 'colorSwatchNode') continue;
    const color = normalizeColorSwatchColors(source.data.colorSwatchColors)[Number(match[1])];
    if (!color) continue;
    const key = `${edge.source}:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ key, color, label: typeof labels[key] === 'string' ? labels[key] : '' });
  }

  return entries;
}

export function formatColorSwatchListPrompt(
  node: ColorSwatchListNodeLike,
  nodes: ReadonlyArray<PaletteNodeLike>,
  edges: ReadonlyArray<ColorEdgeLike>,
): string {
  const entries = resolveColorSwatchListEntries(node, nodes, edges);
  if (entries.length === 0) {
    return '';
  }
  const parts = entries.map((entry) => (entry.label.trim() ? `${entry.label.trim()}: ${entry.color}` : entry.color));
  return `Color swatch — ${parts.join(', ')}.`;
}

export function resolveColorSwatchDraftColor(value: unknown): string {
  return normalizeHexColor(value) ?? DEFAULT_COLOR_SWATCH_DRAFT_COLOR;
}

export function resolveColorSwatchSelectedIndex(value: unknown, colorCount: number): number | undefined {
  if (!Number.isInteger(value) || colorCount <= 0) {
    return undefined;
  }

  const index = Number(value);
  return index >= 0 && index < colorCount ? index : undefined;
}
