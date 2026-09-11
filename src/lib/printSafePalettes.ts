// Curated print-safe CMYK palettes (docs/notes/836 follow-up). These are the "predefined safe color
// palettes" for the Image and Paper workspaces: every swatch is authored directly in CMYK press values
// (not RGB converted), so it is press-accurate by construction and stays inside sensible total-ink
// limits. They drop straight into the Paper swatch system (`PaperSwatch`) and back the CMYK color picker.
//
// Why authored-CMYK: the whole point of a "safe" palette is that the color a designer picks is the color
// that prints. Skin tones, rich blacks, and saturated brand colors are exactly where a naive RGB→CMYK
// conversion drifts or blows the ink limit — so we ship the known-good recipes instead.

import {
  cmykToRgb,
  totalInkPercent,
  type PaperCmyk,
  type PaperSwatch,
} from './paperSwatches';

export interface PrintSafeSwatchDef {
  name: string;
  cmyk: PaperCmyk;
  /** Spot/registration-style swatch that is intentionally high-ink (e.g. registration black). */
  registrationOnly?: boolean;
}

export interface PrintSafePalette {
  id: string;
  name: string;
  description: string;
  /** Suggested total-ink ceiling this palette was designed against (coated 300, uncoated/news 240). */
  inkLimitPercent: number;
  swatches: readonly PrintSafeSwatchDef[];
}

const c = (cyan: number, magenta: number, yellow: number, key: number): PaperCmyk => ({ c: cyan, m: magenta, y: yellow, k: key });

export const PRINT_SAFE_PALETTES: readonly PrintSafePalette[] = [
  {
    id: 'cmyk-process',
    name: 'CMYK Process',
    description: 'The process primaries, secondaries, and even tints — the building blocks of every separation.',
    inkLimitPercent: 300,
    swatches: [
      { name: 'Cyan', cmyk: c(100, 0, 0, 0) },
      { name: 'Magenta', cmyk: c(0, 100, 0, 0) },
      { name: 'Yellow', cmyk: c(0, 0, 100, 0) },
      { name: 'Black (K)', cmyk: c(0, 0, 0, 100) },
      { name: 'Process Red', cmyk: c(0, 100, 100, 0) },
      { name: 'Process Green', cmyk: c(100, 0, 100, 0) },
      { name: 'Process Blue', cmyk: c(100, 100, 0, 0) },
      { name: 'Cyan 50%', cmyk: c(50, 0, 0, 0) },
      { name: 'Magenta 50%', cmyk: c(0, 50, 0, 0) },
      { name: 'Yellow 50%', cmyk: c(0, 0, 50, 0) },
      { name: 'Black 50%', cmyk: c(0, 0, 0, 50) },
    ],
  },
  {
    id: 'rich-blacks-neutrals',
    name: 'Rich Blacks & Neutrals',
    description: 'Press-correct blacks and a neutral gray ramp. Registration black is for crop marks only.',
    inkLimitPercent: 300,
    swatches: [
      { name: 'Registration Black', cmyk: c(100, 100, 100, 100), registrationOnly: true },
      { name: 'Rich Black', cmyk: c(60, 40, 40, 100) },
      { name: 'Cool Black', cmyk: c(60, 0, 0, 100) },
      { name: 'Warm Black', cmyk: c(0, 40, 40, 100) },
      { name: 'Designer Black', cmyk: c(40, 30, 20, 100) },
      { name: 'Flat Black (100K)', cmyk: c(0, 0, 0, 100) },
      { name: 'Gray 80', cmyk: c(0, 0, 0, 80) },
      { name: 'Gray 60', cmyk: c(0, 0, 0, 60) },
      { name: 'Gray 40', cmyk: c(0, 0, 0, 40) },
      { name: 'Gray 20', cmyk: c(0, 0, 0, 20) },
      { name: 'Gray 10', cmyk: c(0, 0, 0, 10) },
    ],
  },
  {
    id: 'skin-tones',
    name: 'Print-Safe Skin Tones',
    description: 'Standard CMYK skin recipes — the tones that drift worst under naive RGB conversion.',
    inkLimitPercent: 300,
    swatches: [
      { name: 'Porcelain', cmyk: c(0, 10, 15, 0) },
      { name: 'Light', cmyk: c(0, 18, 24, 2) },
      { name: 'Fair', cmyk: c(3, 24, 32, 4) },
      { name: 'Medium', cmyk: c(5, 28, 38, 7) },
      { name: 'Olive', cmyk: c(12, 28, 45, 12) },
      { name: 'Tan', cmyk: c(10, 35, 48, 12) },
      { name: 'Bronze', cmyk: c(18, 42, 52, 20) },
      { name: 'Deep', cmyk: c(20, 45, 55, 25) },
      { name: 'Rich', cmyk: c(30, 55, 60, 45) },
      { name: 'Ebony', cmyk: c(40, 60, 60, 60) },
    ],
  },
  {
    id: 'coated-vibrants',
    name: 'Coated Vibrants',
    description: 'Saturated colors that stay inside a coated-stock gamut — vivid without going out of range.',
    inkLimitPercent: 300,
    swatches: [
      { name: 'Sky', cmyk: c(70, 15, 0, 0) },
      { name: 'Cobalt', cmyk: c(95, 70, 0, 0) },
      { name: 'Teal', cmyk: c(80, 0, 40, 0) },
      { name: 'Leaf', cmyk: c(65, 0, 100, 0) },
      { name: 'Sun', cmyk: c(0, 20, 95, 0) },
      { name: 'Tangerine', cmyk: c(0, 55, 95, 0) },
      { name: 'Crimson', cmyk: c(10, 100, 80, 5) },
      { name: 'Plum', cmyk: c(45, 85, 10, 10) },
    ],
  },
  {
    id: 'newsprint-safe',
    name: 'Newsprint-Safe',
    description: 'Muted colors kept under a 240% ink limit for uncoated/newsprint presses.',
    inkLimitPercent: 240,
    swatches: [
      { name: 'News Black', cmyk: c(0, 0, 0, 90) },
      { name: 'News Gray', cmyk: c(0, 0, 0, 45) },
      { name: 'News Blue', cmyk: c(70, 30, 0, 10) },
      { name: 'News Red', cmyk: c(0, 75, 65, 10) },
      { name: 'News Green', cmyk: c(60, 5, 70, 15) },
      { name: 'News Gold', cmyk: c(5, 25, 80, 5) },
      { name: 'News Brown', cmyk: c(20, 45, 60, 30) },
    ],
  },
];

export function findPrintSafePalette(id: string): PrintSafePalette | undefined {
  return PRINT_SAFE_PALETTES.find((palette) => palette.id === id);
}

let paletteSwatchCounterFallback = 0;
function makeSwatchId(paletteId: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  const rand = cryptoObj?.randomUUID ? cryptoObj.randomUUID().slice(0, 8) : (paletteSwatchCounterFallback += 1).toString(36);
  return `swatch-${paletteId}-${slug}-${rand}`;
}

/** Convert a palette to document swatches (authored CMYK → `PaperSwatch`, press values preserved). */
export function paletteToPaperSwatches(palette: PrintSafePalette): PaperSwatch[] {
  return palette.swatches.map((swatch) => ({
    id: makeSwatchId(palette.id, swatch.name),
    name: swatch.name,
    type: 'process',
    model: 'cmyk',
    rgb: cmykToRgb(swatch.cmyk),
    cmyk: swatch.cmyk,
  }));
}

/** Swatches whose total ink exceeds the palette's limit (registration swatches are exempt/expected). */
export function overInkSwatches(palette: PrintSafePalette): PrintSafeSwatchDef[] {
  return palette.swatches.filter((swatch) => !swatch.registrationOnly && totalInkPercent(swatch.cmyk) > palette.inkLimitPercent);
}
