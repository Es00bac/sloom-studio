// Standards-aware ISBN / EAN-13 barcode derivation for Paper print production.
//
// This module is the single deterministic source for ISBN-10/ISBN-13 validation, ISBN→EAN-13
// conversion (GS1 Bookland 978/979), EAN-13 module encoding (ISO/IEC 15420 / GS1 symbol
// specification), and physical symbol geometry. The editing canvas, print HTML, native PDF/X
// render plan, and both preflight systems consume the same pure functions, so every surface
// agrees on the exact bar pattern and physical size for one frame state.

import type { PaperFrame } from '../types/paper';

export type PaperBarcodeSymbology = 'ean13';

/** Retained, editable barcode payload for a `kind: 'barcode'` Paper frame. */
export interface PaperBarcodeSpec {
  symbology: PaperBarcodeSymbology;
  /**
   * The author's retained input. Accepts ISBN-10 (check digit derived when omitted or carried),
   * ISBN-13/EAN-13, or 12 digits without a check digit. Hyphens and spaces are ignored. The
   * canonical 13-digit encoding is always derived, never stored, so a correction to the check
   * math flows to every renderer without a migration.
   */
  value: string;
  /** Render the human-readable interpretation digits under the symbol (default true). */
  showHumanReadable: boolean;
}

/** GS1/ISO nominal EAN-13 dimensions at 100% magnification (GS1 General Specifications,
 *  EAN-13 symbol drawing: 37.29 × 25.93 mm at X = 0.330 mm). */
export const PAPER_EAN13_NOMINAL = {
  /** X dimension of one module. */
  moduleWidthMm: 0.33,
  /** Encoded modules: 3 guard + 42 left data + 5 center guard + 42 right data + 3 guard. */
  dataModuleCount: 95,
  leftQuietZoneModules: 11,
  rightQuietZoneModules: 7,
  /** 11 + 95 + 7. */
  totalModuleCount: 113,
  /** Data bar height (excluding the guard-bar extension into the digit zone). */
  barHeightMm: 22.85,
  /** Guard bars extend this far below the data bars (5 × X), into the human-readable zone. */
  guardExtensionMm: 1.65,
  /** Digit zone height below the data bars (25.93 nominal − 22.85 bars). */
  humanReadableZoneMm: 3.08,
  /** Full symbol height including the human-readable zone (GS1 nominal drawing). */
  symbolHeightMm: 25.93,
  /** Full symbol height with the human-readable zone turned off (bars + guard extension only);
   *  draft convenience — GS1 requires the HRI digits on a standards-conforming symbol. */
  barsOnlyHeightMm: 24.5,
  /** GS1 SC-2 magnification range permitted without a printer waiver. */
  minMagnification: 0.8,
  maxMagnification: 2,
  /** Nominal human-readable digit size in PostScript points at 100% magnification. */
  humanReadableFontPt: 8,
} as const;

/** Nominal full symbol size in millimetres for one magnification. */
export function paperBarcodeSymbolSizeMm(magnification: number, showHumanReadable: boolean): { widthMm: number; heightMm: number } {
  const scale = Number.isFinite(magnification) && magnification > 0 ? magnification : 1;
  return {
    widthMm: round2(PAPER_EAN13_NOMINAL.totalModuleCount * PAPER_EAN13_NOMINAL.moduleWidthMm * scale),
    heightMm: round2(
      (showHumanReadable ? PAPER_EAN13_NOMINAL.symbolHeightMm : PAPER_EAN13_NOMINAL.barsOnlyHeightMm) * scale,
    ),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Strip separators and keep only digits plus a single trailing ISBN-10 'X' check character. */
export function sanitizePaperBarcodeInput(raw: string): string {
  const stripped = (raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  return /^[0-9]+X?$/.test(stripped) ? stripped.slice(0, 17) : '';
}

/** EAN-13/ISBN-13 modulo-10 check digit for the first twelve digits. */
export function ean13CheckDigit(firstTwelve: string): number | undefined {
  if (!/^\d{12}$/.test(firstTwelve)) return undefined;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    sum += Number(firstTwelve[index]) * (index % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/** ISBN-10 modulo-11 check character ('0'-'9' or 'X') for the first nine digits. */
export function isbn10CheckCharacter(firstNine: string): string | undefined {
  if (!/^\d{9}$/.test(firstNine)) return undefined;
  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(firstNine[index]) * (10 - index);
  }
  const remainder = sum % 11;
  if (remainder === 0) return '0';
  const check = 11 - remainder;
  return check === 10 ? 'X' : String(check);
}

export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  return isbn10CheckCharacter(value.slice(0, 9)) === value[9];
}

export function isValidEan13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/** Convert a valid ISBN-10 to its Bookland ISBN-13 (978 prefix, recomputed check digit). */
export function isbn10ToEan13(value: string): string | undefined {
  if (!isValidIsbn10(value)) return undefined;
  const body = `978${value.slice(0, 9)}`;
  return `${body}${ean13CheckDigit(body)}`;
}

export type PaperBarcodeInputKind = 'isbn10' | 'isbn13' | 'ean12';

export type PaperBarcodeValueResolution =
  | {
      status: 'valid';
      ean13: string;
      inputKind: PaperBarcodeInputKind;
      /** True when the stored input did not carry a final check digit and one was derived. */
      derivedCheckDigit: boolean;
      /** True when the EAN prefix is the GS1 Bookland range 978/979 used by ISBNs. */
      bookland: boolean;
    }
  | {
      status: 'invalid';
      reason: 'empty' | 'bad-characters' | 'bad-length' | 'isbn10-check-digit' | 'ean13-check-digit';
      /** The check character the entered digits actually require, when computable. */
      expectedCheckCharacter?: string;
    };

/**
 * Resolve the retained author input to a canonical EAN-13 payload. 12 digits and 9 digits derive
 * their check digit; a carried ISBN-10 check digit or EAN-13 check digit must be correct.
 */
export function resolvePaperBarcodeValue(raw: string): PaperBarcodeValueResolution {
  const sanitized = (raw ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  if (!sanitized) return { status: 'invalid', reason: 'empty' };
  if (!/^[0-9]+X?$/.test(sanitized) || (sanitized.endsWith('X') && sanitized.length !== 10)) {
    return { status: 'invalid', reason: 'bad-characters' };
  }
  if (sanitized.length === 9) {
    const derived = isbn10CheckCharacter(sanitized);
    const converted = isbn10ToEan13(`${sanitized}${derived}`);
    if (!derived || !converted) return { status: 'invalid', reason: 'bad-length' };
    return { status: 'valid', ean13: converted, inputKind: 'isbn10', derivedCheckDigit: true, bookland: true };
  }
  if (sanitized.length === 10) {
    if (isValidIsbn10(sanitized)) {
      const converted = isbn10ToEan13(sanitized);
      if (converted) return { status: 'valid', ean13: converted, inputKind: 'isbn10', derivedCheckDigit: false, bookland: true };
    }
    const expected = isbn10CheckCharacter(sanitized.slice(0, 9));
    return expected
      ? { status: 'invalid', reason: 'isbn10-check-digit', expectedCheckCharacter: expected }
      : { status: 'invalid', reason: 'bad-characters' };
  }
  if (sanitized.length === 12) {
    const derived = ean13CheckDigit(sanitized);
    if (derived === undefined) return { status: 'invalid', reason: 'bad-length' };
    return { status: 'valid', ean13: `${sanitized}${derived}`, inputKind: 'ean12', derivedCheckDigit: true, bookland: isBookland(sanitized) };
  }
  if (sanitized.length === 13) {
    if (isValidEan13(sanitized)) {
      return { status: 'valid', ean13: sanitized, inputKind: 'isbn13', derivedCheckDigit: false, bookland: isBookland(sanitized) };
    }
    const expected = ean13CheckDigit(sanitized.slice(0, 12));
    return expected === undefined
      ? { status: 'invalid', reason: 'bad-length' }
      : { status: 'invalid', reason: 'ean13-check-digit', expectedCheckCharacter: String(expected) };
  }
  return { status: 'invalid', reason: 'bad-length' };
}

function isBookland(twelveOrThirteen: string): boolean {
  return twelveOrThirteen.startsWith('978') || twelveOrThirteen.startsWith('979');
}

// --- EAN-13 module encoding --------------------------------------------------------------------------------
// Left (A) patterns for digits 0-9 from ISO/IEC 15420. The G (B) pattern is the reverse of the
// A pattern complemented, and the right (C) pattern is the A pattern complemented, so only the A
// table is stored and the derived tables are locked by the golden vectors in paperBarcode.test.ts.

const EAN13_LEFT_PATTERNS = [
  '0001101', // 0
  '0011001', // 1
  '0010011', // 2
  '0111101', // 3
  '0100011', // 4
  '0110001', // 5
  '0101111', // 6
  '0111011', // 7
  '0110111', // 8
  '0001011', // 9
] as const;

/** Parity (L/G) selection for data positions 2-7, selected by digit 1. */
const EAN13_PARITY_PATTERNS = [
  'LLLLLL', // 0
  'LLGLGG', // 1
  'LLGGLG', // 2
  'LLGGGL', // 3
  'LGLLGG', // 4
  'LGGLLG', // 5
  'LGGGLL', // 6
  'LGLGLG', // 7
  'LGLGGL', // 8
  'LGGLGL', // 9
] as const;

function complementPattern(pattern: string): string {
  return pattern.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0'));
}

function reversePattern(pattern: string): string {
  return [...pattern].reverse().join('');
}

function leftPattern(digit: number): string {
  return EAN13_LEFT_PATTERNS[digit];
}

function guardPattern(digit: number): string {
  return complementPattern(reversePattern(EAN13_LEFT_PATTERNS[digit]));
}

function rightPattern(digit: number): string {
  return complementPattern(EAN13_LEFT_PATTERNS[digit]);
}

/** The 95 encoded modules (true = bar) for a valid 13-digit EAN, or undefined when invalid. */
export function encodeEan13Modules(ean13: string): boolean[] | undefined {
  if (!isValidEan13(ean13)) return undefined;
  const modules: boolean[] = [];
  const push = (pattern: string) => {
    for (const bit of pattern) modules.push(bit === '1');
  };
  push('101'); // left guard
  const parity = EAN13_PARITY_PATTERNS[Number(ean13[0])];
  for (let index = 1; index <= 6; index += 1) {
    const digit = Number(ean13[index]);
    push(parity[index - 1] === 'L' ? leftPattern(digit) : guardPattern(digit));
  }
  push('01010'); // center guard
  for (let index = 7; index <= 12; index += 1) {
    push(rightPattern(Number(ean13[index])));
  }
  push('101'); // right guard
  return modules.length === PAPER_EAN13_NOMINAL.dataModuleCount ? modules : undefined;
}

/** Data-module index ranges that belong to the taller guard bars (left, center, right). */
const EAN13_GUARD_MODULE_RANGES: Array<[number, number]> = [
  [0, 2],
  [45, 49],
  [90, 94],
];

function isGuardModule(moduleIndex: number): boolean {
  return EAN13_GUARD_MODULE_RANGES.some(([start, end]) => moduleIndex >= start && moduleIndex <= end);
}

// --- Physical geometry ----------------------------------------------------------------------

export interface PaperBarcodeBarRect {
  /** Frame-local millimetres from the frame's left edge (the outer edge of the left quiet zone). */
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  guard: boolean;
}

export interface PaperBarcodeGeometry {
  resolution: PaperBarcodeValueResolution;
  /** Millimetre width of one module: the frame width divided by the full 113-module symbol. */
  moduleWidthMm: number;
  /** moduleWidthMm / 0.33 — the GS1 magnification this placement produces. */
  magnification: number;
  leftQuietZoneMm: number;
  rightQuietZoneMm: number;
  /** Data bar height; when HRI is on this excludes the reserved digit zone. */
  barHeightMm: number;
  guardBarHeightMm: number;
  humanReadableZoneMm: number;
  /** Derived bar rectangles, merged runs of dark modules, in deterministic order. */
  bars: PaperBarcodeBarRect[];
  /** Human-readable digit groups with frame-local centres, in GS1 EAN-13 placement. */
  humanReadableGroups: Array<{ text: string; centerMm: number }>;
  humanReadableFontPt: number;
}

export function buildPaperBarcodeGeometry(
  spec: PaperBarcodeSpec | undefined,
  widthMm: number,
  heightMm: number,
): PaperBarcodeGeometry {
  const safeWidth = Number.isFinite(widthMm) && widthMm > 0 ? widthMm : 0;
  const safeHeight = Number.isFinite(heightMm) && heightMm > 0 ? heightMm : 0;
  const moduleWidthMm = safeWidth / PAPER_EAN13_NOMINAL.totalModuleCount;
  const magnification = moduleWidthMm / PAPER_EAN13_NOMINAL.moduleWidthMm;
  const showHumanReadable = spec?.showHumanReadable ?? true;
  const humanReadableZoneMm = showHumanReadable
    ? PAPER_EAN13_NOMINAL.humanReadableZoneMm * magnification
    : 0;
  // Hiding the HRI is allowed only as a non-strict authoring draft, but it must not change the
  // symbol's bar geometry. Keep the guard-extension band reserved so ordinary bars never grow to
  // the full frame height and erase the required five-module guard extension.
  const reservedBelowDataBarsMm = showHumanReadable
    ? humanReadableZoneMm
    : PAPER_EAN13_NOMINAL.guardExtensionMm * magnification;
  const barHeightMm = Math.max(0, safeHeight - reservedBelowDataBarsMm);
  const guardBarHeightMm = Math.min(
    safeHeight,
    Math.max(barHeightMm, barHeightMm + PAPER_EAN13_NOMINAL.guardExtensionMm * magnification),
  );

  const resolution = resolvePaperBarcodeValue(spec?.value ?? '');
  const modules = resolution.status === 'valid' ? encodeEan13Modules(resolution.ean13) : undefined;
  const bars: PaperBarcodeBarRect[] = [];
  if (modules) {
    let runStart = -1;
    for (let index = 0; index <= modules.length; index += 1) {
      const dark = index < modules.length && modules[index];
      if (dark && runStart < 0) {
        runStart = index;
        continue;
      }
      if (!dark && runStart >= 0) {
        const guard = isGuardModule(runStart);
        bars.push({
          xMm: moduleMm(PAPER_EAN13_NOMINAL.leftQuietZoneModules + runStart, moduleWidthMm),
          yMm: 0,
          widthMm: moduleMm(index - runStart, moduleWidthMm),
          heightMm: guard ? guardBarHeightMm : barHeightMm,
          guard,
        });
        runStart = -1;
      }
    }
  }

  const humanReadableGroups: Array<{ text: string; centerMm: number }> = [];
  if (resolution.status === 'valid' && showHumanReadable) {
    const { ean13 } = resolution;
    const centerOfModuleSpan = (startModule: number, count: number) => moduleMm(startModule + count / 2, moduleWidthMm);
    humanReadableGroups.push(
      // Digit 1 sits inside the left quiet zone; digits 2-7 centre under the left data area
      // between the guards; digits 8-13 centre under the right data area.
      { text: ean13[0], centerMm: centerOfModuleSpan(0, PAPER_EAN13_NOMINAL.leftQuietZoneModules) },
      { text: ean13.slice(1, 7), centerMm: centerOfModuleSpan(14, 42) },
      { text: ean13.slice(7, 13), centerMm: centerOfModuleSpan(61, 42) },
    );
  }

  return {
    resolution,
    moduleWidthMm,
    magnification,
    leftQuietZoneMm: moduleMm(PAPER_EAN13_NOMINAL.leftQuietZoneModules, moduleWidthMm),
    rightQuietZoneMm: moduleMm(PAPER_EAN13_NOMINAL.rightQuietZoneModules, moduleWidthMm),
    barHeightMm,
    guardBarHeightMm,
    humanReadableZoneMm,
    bars,
    humanReadableGroups,
    humanReadableFontPt: PAPER_EAN13_NOMINAL.humanReadableFontPt * magnification,
  };
}

function moduleMm(modules: number, moduleWidthMm: number): number {
  return Number((modules * moduleWidthMm).toFixed(6));
}

// --- Preflight measurements ------------------------------------------------------------------

export interface PaperBarcodePhysicalSizeStatus {
  magnification: number;
  /** GS1 SC-2 80-200% magnification window is satisfied. */
  magnificationInRange: boolean;
  /** Bar height meets the nominal proportion for this magnification (not truncated). */
  heightNominal: boolean;
  leftQuietZoneMm: number;
  rightQuietZoneMm: number;
}

export function paperBarcodePhysicalSizeStatus(geometry: PaperBarcodeGeometry): PaperBarcodePhysicalSizeStatus {
  return {
    magnification: geometry.magnification,
    magnificationInRange: geometry.magnification >= PAPER_EAN13_NOMINAL.minMagnification - 1e-9
      && geometry.magnification <= PAPER_EAN13_NOMINAL.maxMagnification + 1e-9,
    heightNominal: geometry.barHeightMm + 1e-6
      >= PAPER_EAN13_NOMINAL.barHeightMm * (Number.isFinite(geometry.magnification) && geometry.magnification > 0 ? geometry.magnification : 0),
    leftQuietZoneMm: geometry.leftQuietZoneMm,
    rightQuietZoneMm: geometry.rightQuietZoneMm,
  };
}

export interface PaperBarcodeQuad {
  points: Array<{ xMm: number; yMm: number }>;
}

function localRectToPageQuad(
  frame: Pick<PaperFrame, 'xMm' | 'yMm' | 'widthMm' | 'heightMm' | 'rotationDeg'>,
  rect: { xMm: number; yMm: number; widthMm: number; heightMm: number },
): PaperBarcodeQuad {
  const radians = ((Number.isFinite(frame.rotationDeg) ? frame.rotationDeg : 0) % 360) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const centerX = frame.xMm + frame.widthMm / 2;
  const centerY = frame.yMm + frame.heightMm / 2;
  return {
    points: [
      { xMm: rect.xMm, yMm: rect.yMm },
      { xMm: rect.xMm + rect.widthMm, yMm: rect.yMm },
      { xMm: rect.xMm + rect.widthMm, yMm: rect.yMm + rect.heightMm },
      { xMm: rect.xMm, yMm: rect.yMm + rect.heightMm },
    ].map((point) => {
      const localX = point.xMm - frame.widthMm / 2;
      const localY = point.yMm - frame.heightMm / 2;
      return {
        xMm: Number((centerX + localX * cos - localY * sin).toFixed(6)),
        yMm: Number((centerY + localX * sin + localY * cos).toFixed(6)),
      };
    }),
  };
}

/** Page-space quads of the barcode frame's reserved quiet zones (left, then right). */
export function paperBarcodeQuietZoneQuads(frame: PaperFrame): PaperBarcodeQuad[] {
  const moduleWidthMm = (Number.isFinite(frame.widthMm) && frame.widthMm > 0 ? frame.widthMm : 0)
    / PAPER_EAN13_NOMINAL.totalModuleCount;
  return [
    localRectToPageQuad(frame, {
      xMm: 0,
      yMm: 0,
      widthMm: moduleMm(PAPER_EAN13_NOMINAL.leftQuietZoneModules, moduleWidthMm),
      heightMm: frame.heightMm,
    }),
    localRectToPageQuad(frame, {
      xMm: moduleMm(PAPER_EAN13_NOMINAL.leftQuietZoneModules + PAPER_EAN13_NOMINAL.dataModuleCount, moduleWidthMm),
      yMm: 0,
      widthMm: moduleMm(PAPER_EAN13_NOMINAL.rightQuietZoneModules, moduleWidthMm),
      heightMm: frame.heightMm,
    }),
  ];
}

/** Page-space quad of another frame's full rectangle, honouring its own rotation. */
export function paperFrameInkQuad(frame: PaperFrame): PaperBarcodeQuad {
  return localRectToPageQuad(frame, { xMm: 0, yMm: 0, widthMm: frame.widthMm, heightMm: frame.heightMm });
}

/** Separating-axis intersection test for two convex quads. */
export function paperBarcodeQuadsOverlap(left: PaperBarcodeQuad, right: PaperBarcodeQuad): boolean {
  const polygons = [left.points, right.points];
  for (const points of polygons) {
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      const axisX = -(next.yMm - current.yMm);
      const axisY = next.xMm - current.xMm;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const point of left.points) {
        const projection = point.xMm * axisX + point.yMm * axisY;
        minA = Math.min(minA, projection);
        maxA = Math.max(maxA, projection);
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const point of right.points) {
        const projection = point.xMm * axisX + point.yMm * axisY;
        minB = Math.min(minB, projection);
        maxB = Math.max(maxB, projection);
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/** True when the frame paints ink that could interfere with a neighbouring barcode scan. */
export function paperFrameCarriesPrintedInk(frame: Pick<PaperFrame, 'kind' | 'text' | 'fillColor' | 'fillOpacity' | 'strokeColor' | 'strokeOpacity' | 'strokeWidthMm' | 'asset' | 'fillGradient' | 'comicSfxDesign'>): boolean {
  const visibleColor = (color: string | undefined, opacity: number) => Boolean(
    color && color.trim() && color.trim().toLowerCase() !== 'transparent' && opacity > 0,
  );
  if (visibleColor(frame.fillColor, frame.fillOpacity)) return true;
  if (visibleColor(frame.strokeColor, frame.strokeOpacity) && frame.strokeWidthMm > 0) return true;
  if (frame.fillGradient) return true;
  if (frame.comicSfxDesign) return true;
  if (frame.kind === 'image' && frame.asset) return true;
  if (frame.kind === 'document' && frame.asset) return true;
  if (['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind) && frame.text?.trim()) return true;
  return false;
}

/** Sanitize a persisted/edited barcode spec. Returns undefined for non-barcode garbage. */
export function normalizePaperBarcodeSpec(value: unknown): PaperBarcodeSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<PaperBarcodeSpec>;
  if (candidate.symbology !== 'ean13') return undefined;
  const raw = typeof candidate.value === 'string' ? candidate.value : '';
  return {
    symbology: 'ean13',
    value: raw.slice(0, 32),
    showHumanReadable: candidate.showHumanReadable !== false,
  };
}
