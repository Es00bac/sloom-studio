// Maps a Paper frame's typography (CSS font-family stack + weight + style) to one of the bundled,
// embeddable SIL-OFL Liberation faces so PDF/X export can embed real vector text. Liberation Serif /
// Sans / Mono are metric-compatible with Times New Roman / Arial / Courier New — the substitutes a
// print shop expects when the exact foundry font can't be embedded. Framework-free + unit-testable;
// the actual .ttf bytes are fetched lazily via `resolveBundledAssetUrl` in the browser exporter.

export type LiberationFamily = 'serif' | 'sans' | 'mono';

export interface BundledFontFace {
  family: LiberationFamily;
  bold: boolean;
  italic: boolean;
  /** public/-relative URL of the .ttf (resolve via resolveBundledAssetUrl before fetching). */
  url: string;
  /** Stable id (the file basename) — use as the embed cache key. */
  id: string;
}

const SERIF_HINT = /(^|[^a-z])(serif|times|georgia|garamond|minion|palatino|book\s?antiqua|cambria|caslon|baskerville|didot|century|goudy|sabon|utopia|charter|lora|merriweather|playfair|noto\s?serif|source\s?serif|pt\s?serif)/;
const MONO_HINT = /(mono|courier|consol|menlo|monaco|inconsolata|fira\s?code|source\s?code|jetbrains|ibm\s?plex\s?mono|roboto\s?mono|space\s?mono|ubuntu\s?mono|code)/;

/** Classify a CSS font-family (or stack) into a bundled family, defaulting to sans. */
export function classifyFontFamily(cssFamily: string): LiberationFamily {
  const f = (cssFamily || '').toLowerCase();
  if (MONO_HINT.test(f)) return 'mono';
  // Only treat as serif when a serif hint is present AND it isn't explicitly a sans-serif face.
  if (SERIF_HINT.test(f) && !/sans/.test(f)) return 'serif';
  return 'sans';
}

// Display / decorative faces whose distinctive silhouette a plain Liberation text face CANNOT stand in
// for. Substituting these (e.g. a comic's Impact SFX → Liberation Sans) silently changes the artwork —
// exactly the "amateur" look we refuse to ship. Text in these must be RASTERIZED (real glyphs), not
// vector-substituted. The list is deliberately conservative: an un-listed display font simply keeps the
// prior behaviour (vector substitute, disclosed in preflight) — so this only ever improves fidelity.
const DISPLAY_FONT_HINT = /(impact|haettenschweiler|bebas|anton|bangers|badaboom|komika|luckiest|permanent\s?marker|lobster|pacifico|bungee|monoton|creepster|alfa\s?slab|titan\s?one|passion\s?one|archivo\s?black|black\s?ops|staatliches|shrikhand|righteous|bowlby|fredoka|sigmar|blackletter|fraktur|old\s?english|comic(\s|-)?(sans|neue))/;

/**
 * True when a CSS font-family names a display/decorative face Liberation can't faithfully substitute
 * (so its text should be rasterized to preserve the real glyphs, not embedded as a vector substitute).
 * Also true for the CSS generic decorative families `cursive` / `fantasy`.
 */
export function isDisplayFontFamily(cssFamily: string): boolean {
  const f = (cssFamily || '').toLowerCase();
  if (DISPLAY_FONT_HINT.test(f)) return true;
  return /(^|,)\s*(cursive|fantasy)\s*(,|$)/.test(f);
}

/** A CSS font-weight (keyword or numeric string) counts as bold at >= 600 / bold / bolder. */
export function isBoldWeight(weight: string | undefined): boolean {
  const w = (weight ?? '').trim().toLowerCase();
  if (w === 'bold' || w === 'bolder') return true;
  const n = Number.parseInt(w, 10);
  return Number.isFinite(n) && n >= 600;
}

const FAMILY_FILE: Record<LiberationFamily, string> = { serif: 'Serif', sans: 'Sans', mono: 'Mono' };

/** Resolve a frame's typography to the bundled Liberation face that best matches it. */
export function resolveBundledFontFace(typography: {
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
}): BundledFontFace {
  const family = classifyFontFamily(typography.fontFamily ?? '');
  const bold = isBoldWeight(typography.fontWeight);
  const italic = (typography.fontStyle ?? '').toLowerCase() === 'italic';
  const style = bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  const id = `Liberation${FAMILY_FILE[family]}-${style}`;
  return { family, bold, italic, url: `/fonts/liberation/${id}.ttf`, id };
}
