import { formatFontFamily } from './formatFontFamily';
import { PAPER_SCREEN_PX_PER_MM } from './paperLayoutTools';
import type { PaperTextMeasurer } from './paperTextFlow';

const PT_TO_PX = 96 / 72;
const CSS_MEASUREMENT_CACHE_LIMIT = 128;
const NAMED_STRETCH_VALUES = new Set([
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'normal',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
]);

type ExtendedCanvasTextContext = CanvasRenderingContext2D & {
  fontStretch?: string;
  fontVariationSettings?: string;
};

type CanvasTextProperty = 'fontKerning' | 'fontStretch' | 'fontVariationSettings';

interface CanvasTextPropertySupport {
  fontKerning: boolean | undefined;
  fontStretch: boolean | undefined;
  fontVariationSettings: boolean | undefined;
}

interface NormalizedRequestedValue {
  css: string;
  identity: string;
  valid: boolean;
}

interface ObservedFontState {
  available: boolean | undefined;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safePxPerMm(value: number): number {
  const resolved = finiteNumber(value, PAPER_SCREEN_PX_PER_MM);
  return resolved > 0 ? resolved : PAPER_SCREEN_PX_PER_MM > 0 ? PAPER_SCREEN_PX_PER_MM : 1;
}

function finiteWidth(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : Math.max(0, finiteNumber(fallback, 0));
}

function currentDocument(): Document | undefined {
  try {
    return typeof document === 'undefined' ? undefined : document;
  } catch {
    return undefined;
  }
}

function safeFontFamily(fontFamily: unknown): string {
  try {
    return formatFontFamily(typeof fontFamily === 'string' && fontFamily.trim() ? fontFamily : 'sans-serif');
  } catch {
    return 'sans-serif';
  }
}

function safeString(value: unknown, fallback: string): string {
  try {
    return typeof value === 'string' && value ? value : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStretch(value: unknown): NormalizedRequestedValue {
  if (value == null) return { css: 'normal', identity: 'default:normal', valid: true };
  if (typeof value !== 'string') return { css: 'normal', identity: `invalid:${typeof value}`, valid: false };
  const trimmed = value.trim().toLowerCase();
  if (NAMED_STRETCH_VALUES.has(trimmed)) return { css: trimmed, identity: `named:${trimmed}`, valid: true };
  const percentage = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(trimmed);
  if (percentage && Number.isFinite(Number(percentage[1])) && Number(percentage[1]) > 0) {
    return { css: trimmed, identity: `percentage:${trimmed}`, valid: true };
  }
  return { css: 'normal', identity: `invalid:${trimmed}`, valid: false };
}

function normalizeKerning(value: unknown): NormalizedRequestedValue {
  if (value == null) return { css: 'auto', identity: 'default:auto', valid: true };
  if (value === 'auto' || value === 'normal' || value === 'none') {
    return { css: value, identity: `named:${value}`, valid: true };
  }
  return { css: 'auto', identity: `invalid:${safeString(value, typeof value)}`, valid: false };
}

function normalizeVariationSettings(value: unknown): NormalizedRequestedValue {
  if (value == null) return { css: 'normal', identity: 'default:normal', valid: true };
  let entries: Array<[string, unknown]>;
  try {
    if (typeof value !== 'object') {
      return { css: 'normal', identity: `invalid:${typeof value}`, valid: false };
    }
    entries = Object.entries(value as Record<string, unknown>);
  } catch {
    return { css: 'normal', identity: 'invalid:unreadable', valid: false };
  }

  let valid = true;
  const accepted: Array<[string, number]> = [];
  const identity: string[] = [];
  for (const [tag, coordinate] of entries) {
    const coordinateIdentity = typeof coordinate === 'number'
      ? Number.isNaN(coordinate) ? 'NaN' : String(coordinate)
      : `${typeof coordinate}:${safeString(coordinate, '')}`;
    identity.push(`${JSON.stringify(tag)}=${coordinateIdentity}`);
    if (!/^[\x20-\x7e]{4}$/.test(tag) || typeof coordinate !== 'number' || !Number.isFinite(coordinate)) {
      valid = false;
      continue;
    }
    accepted.push([tag, coordinate]);
  }
  accepted.sort(([left], [right]) => left.localeCompare(right));
  identity.sort();
  return {
    css: accepted.length > 0
      ? accepted.map(([tag, coordinate]) => `${JSON.stringify(tag)} ${coordinate}`).join(', ')
      : 'normal',
    identity: `entries:${identity.join('|')}`,
    valid,
  };
}

function safePropertyPresence(target: object, property: PropertyKey): boolean | undefined {
  try {
    return property in target;
  } catch {
    return undefined;
  }
}

function canonicalizeFontShorthand(ownerDocument: Document, value: string): string | undefined {
  try {
    const probe = ownerDocument.createElement('span');
    const style = probe.style;
    if (!style || safePropertyPresence(style, 'font') !== true) return undefined;
    if (!Reflect.set(style, 'font', '')) return undefined;
    if (!Reflect.set(style, 'font', value)) return undefined;
    const canonical = Reflect.get(style, 'font');
    if (typeof canonical !== 'string' || !canonical.trim()) return undefined;
    // A second detached CSSOM round trip makes the accepted equivalence contract explicit: both inputs must
    // converge to the same stable browser serialization, not merely to a one-off adapter transformation.
    if (!Reflect.set(style, 'font', '')) return undefined;
    if (!Reflect.set(style, 'font', canonical)) return undefined;
    return Reflect.get(style, 'font') === canonical ? canonical : undefined;
  } catch {
    return undefined;
  }
}

function verifyNativeFontShorthand(
  context: CanvasRenderingContext2D,
  ownerDocument: Document,
  requestedFont: string,
): boolean {
  if (safePropertyPresence(context, 'font') !== true) return false;
  try {
    if (!Reflect.set(context, 'font', requestedFont)) return false;
    const observedFont = Reflect.get(context, 'font');
    if (typeof observedFont !== 'string' || !observedFont.trim()) return false;
    if (observedFont === requestedFont) return true;
    const requestedCanonical = canonicalizeFontShorthand(ownerDocument, requestedFont);
    const observedCanonical = canonicalizeFontShorthand(ownerDocument, observedFont);
    return requestedCanonical != null
      && observedCanonical != null
      && requestedCanonical === observedCanonical;
  } catch {
    return false;
  }
}

function verifyNativeProperty(
  context: ExtendedCanvasTextContext,
  property: CanvasTextProperty,
  requestedValue: string,
  alternateValue: string,
): boolean {
  try {
    if (!Reflect.set(context, property, alternateValue)) return false;
    if (Reflect.get(context, property) !== alternateValue) return false;
    if (!Reflect.set(context, property, requestedValue)) return false;
    return Reflect.get(context, property) === requestedValue;
  } catch {
    return false;
  }
}

function safeRemoveProbe(probe: HTMLElement, body: HTMLElement): void {
  try {
    probe.remove();
    return;
  } catch {
    // Some DOM adapters expose remove() but throw. Fall through to the owning body without masking failures.
  }
  try {
    body.removeChild(probe);
  } catch {
    // Cleanup is best-effort because a platform cleanup failure must not replace the deterministic fallback.
  }
}

function measureWithCssProbe(
  ownerDocument: Document,
  text: string,
  style: {
    fontFamily: string;
    fontSizePx: number;
    fontWeight: string;
    fontStyle: string;
    fontStretch: string;
    fontVariationSettings: string;
    fontKerning: string;
    tracking: number;
  },
): number | undefined {
  let body: HTMLElement;
  let probe: HTMLElement | undefined;
  try {
    body = ownerDocument.body;
    if (!body) return undefined;
    probe = ownerDocument.createElement('span');
    if (!probe.style || typeof probe.getBoundingClientRect !== 'function') return undefined;
    probe.textContent = text;
    Object.assign(probe.style, {
      position: 'absolute',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      left: '-100000px',
      top: '0',
      fontFamily: style.fontFamily,
      fontSize: `${style.fontSizePx}px`,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      fontStretch: style.fontStretch,
      fontVariationSettings: style.fontVariationSettings,
      fontKerning: style.fontKerning,
      letterSpacing: `${style.tracking / 1000}em`,
    });
  } catch {
    if (probe && body!) safeRemoveProbe(probe, body);
    return undefined;
  }

  try {
    body.appendChild(probe);
  } catch {
    // appendChild can throw after an adapter has linked the node. Always attempt cleanup in that case too.
    safeRemoveProbe(probe, body);
    return undefined;
  }

  try {
    const width = probe.getBoundingClientRect().width;
    return Number.isFinite(width) && width >= 0 ? width : undefined;
  } catch {
    return undefined;
  } finally {
    safeRemoveProbe(probe, body);
  }
}

/**
 * A `PaperTextMeasurer` backed by a shared 2D canvas context, returning text widths in mm at the
 * unzoomed screen scale (matching the renderer's `fontSizePt * 96/72` px sizing). Falls back to a
 * rough average-character estimate where no exact platform measurement is safely observable.
 */
export function createPaperCanvasMeasurer(pxPerMm = PAPER_SCREEN_PX_PER_MM): PaperTextMeasurer {
  let context: CanvasRenderingContext2D | null | undefined;
  let contextDocument: Document | undefined;
  let propertySupport: CanvasTextPropertySupport | undefined;
  const cssMeasurementCache = new Map<string, number>();
  let cachedFontSet: FontFaceSet | undefined;
  let cachedFontsReady: Promise<FontFaceSet> | undefined;
  let cachedFontsStatus: FontFaceSetLoadStatus | undefined;
  let cachedFontsSize: number | undefined;
  let fontStateEpoch = 0;
  const unitsPerMm = safePxPerMm(pxPerMm);

  const clearFontState = (): void => {
    cssMeasurementCache.clear();
    cachedFontSet = undefined;
    cachedFontsReady = undefined;
    cachedFontsStatus = undefined;
    cachedFontsSize = undefined;
    fontStateEpoch += 1;
  };

  const getContext = (): CanvasRenderingContext2D | null => {
    const ownerDocument = currentDocument();
    if (ownerDocument !== contextDocument) {
      contextDocument = ownerDocument;
      context = undefined;
      propertySupport = undefined;
      clearFontState();
    }
    if (context) return context;
    if (!ownerDocument) {
      context = null;
      return null;
    }
    try {
      context = ownerDocument.createElement('canvas').getContext('2d');
      if (context) {
        const extended = context as ExtendedCanvasTextContext;
        propertySupport = {
          fontKerning: safePropertyPresence(extended, 'fontKerning'),
          fontStretch: safePropertyPresence(extended, 'fontStretch'),
          fontVariationSettings: safePropertyPresence(extended, 'fontVariationSettings'),
        };
      }
      return context;
    } catch {
      // Do not cache transient platform exceptions; a later healthy call must get a fresh context attempt.
      context = undefined;
      propertySupport = undefined;
      return null;
    }
  };

  const observeFontState = (
    ownerDocument: Document,
    fontQuery: string,
    text: string,
  ): ObservedFontState | undefined => {
    try {
      const fontSet = ownerDocument.fonts;
      const fontsReady = fontSet?.ready;
      const fontsStatus = fontSet?.status;
      const fontsSize = fontSet?.size;
      let available: boolean | undefined;
      if (fontSet) {
        const check = fontSet.check;
        available = typeof check === 'function' ? check.call(fontSet, fontQuery, text) : undefined;
      }
      if (fontSet !== cachedFontSet || fontsReady !== cachedFontsReady
        || fontsStatus !== cachedFontsStatus || fontsSize !== cachedFontsSize) {
        cssMeasurementCache.clear();
        cachedFontSet = fontSet;
        cachedFontsReady = fontsReady;
        cachedFontsStatus = fontsStatus;
        cachedFontsSize = fontsSize;
        fontStateEpoch += 1;
      }
      return { available };
    } catch {
      // No cache entry is trustworthy while font lifecycle state cannot be observed.
      clearFontState();
      return undefined;
    }
  };

  return (text, spec) => {
    const safeText = typeof text === 'string' ? text : '';
    const fontSizePt = Math.max(0, finiteNumber(spec.fontSizePt, 0));
    const fontSizePx = fontSizePt * PT_TO_PX;
    const tracking = finiteNumber(spec.tracking, 0);
    const trackingPx = Math.max(0, safeText.length - 1) * (tracking / 1000) * fontSizePx;
    const approximatePx = Math.max(0, safeText.length * fontSizePx * 0.5 + trackingPx);
    const approximateMm = finiteWidth(approximatePx / unitsPerMm, 0);
    const ctx = getContext();
    if (!ctx) return approximateMm;

    const fontFamily = safeFontFamily(spec.fontFamily);
    const fontWeight = safeString(spec.fontWeight, '400');
    const fontStyle = safeString(spec.fontStyle, 'normal');
    const stretch = normalizeStretch(spec.fontStretch);
    const variation = normalizeVariationSettings(spec.fontVariationSettings);
    const kerning = normalizeKerning(spec.fontKerning);
    const fallbackModes: string[] = [];
    const extended = ctx as ExtendedCanvasTextContext;
    const stylePrefix = fontStyle !== 'normal' ? `${fontStyle} ` : '';
    const stretchPrefix = spec.fontStretch != null ? `${stretch.css} ` : '';
    const requestedFont = `${stylePrefix}${fontWeight} ${stretchPrefix}${fontSizePx}px ${fontFamily}`;
    if (!contextDocument || !verifyNativeFontShorthand(ctx, contextDocument, requestedFont)) {
      fallbackModes.push('font-shorthand-rejected');
    }

    if (!stretch.valid) {
      fallbackModes.push('stretch-invalid');
    } else if (stretch.identity.startsWith('percentage:')) {
      // Canvas exposes named stretch values on the shipping DOM surface. A reflected percentage assignment is
      // not sufficient proof that it affected glyph advances, so percentage requests stay on exact CSS layout.
      fallbackModes.push('stretch-percentage-css');
    } else if (propertySupport?.fontStretch === true) {
      if (!verifyNativeProperty(extended, 'fontStretch', stretch.css, stretch.css === 'normal' ? 'condensed' : 'normal')) {
        fallbackModes.push('stretch-rejected');
      }
    } else if (spec.fontStretch != null || propertySupport?.fontStretch === undefined) {
      fallbackModes.push(propertySupport?.fontStretch === undefined ? 'stretch-unobservable' : 'stretch-missing');
    }

    if (!variation.valid) {
      fallbackModes.push('variation-invalid');
    } else if (propertySupport?.fontVariationSettings === true) {
      if (!verifyNativeProperty(
        extended,
        'fontVariationSettings',
        variation.css,
        variation.css === 'normal' ? '"wght" 123' : 'normal',
      )) {
        fallbackModes.push('variation-rejected');
      }
    } else if (spec.fontVariationSettings != null || propertySupport?.fontVariationSettings === undefined) {
      fallbackModes.push(propertySupport?.fontVariationSettings === undefined ? 'variation-unobservable' : 'variation-missing');
    }

    if (!kerning.valid) {
      fallbackModes.push('kerning-invalid');
    } else if (propertySupport?.fontKerning === true) {
      if (!verifyNativeProperty(
        extended,
        'fontKerning',
        kerning.css,
        kerning.css === 'none' ? 'normal' : 'none',
      )) {
        fallbackModes.push('kerning-rejected');
      }
    } else if (spec.fontKerning != null || propertySupport?.fontKerning === undefined) {
      fallbackModes.push(propertySupport?.fontKerning === undefined ? 'kerning-unobservable' : 'kerning-missing');
    }

    if (fallbackModes.length > 0 && contextDocument) {
      const fontQuery = `${fontStyle} ${fontWeight} ${stretch.css} ${fontSizePx}px ${fontFamily}`;
      const fontState = observeFontState(contextDocument, fontQuery, safeText);
      if (!fontState) return approximateMm;
      const cssKey = JSON.stringify([
        fallbackModes.join(','),
        fontStateEpoch,
        fontState.available,
        safeText,
        fontFamily,
        fontSizePx,
        fontWeight,
        fontStyle,
        stretch.identity,
        stretch.css,
        variation.identity,
        variation.css,
        kerning.identity,
        kerning.css,
        tracking,
      ]);
      const cachedWidth = cssMeasurementCache.get(cssKey);
      if (cachedWidth != null) {
        cssMeasurementCache.delete(cssKey);
        cssMeasurementCache.set(cssKey, cachedWidth);
        return finiteWidth(cachedWidth / unitsPerMm, approximateMm);
      }
      const cssWidth = measureWithCssProbe(contextDocument, safeText, {
        fontFamily,
        fontSizePx,
        fontWeight,
        fontStyle,
        fontStretch: stretch.css,
        fontVariationSettings: variation.css,
        fontKerning: kerning.css,
        tracking,
      });
      if (cssWidth != null) {
        if (cssMeasurementCache.size >= CSS_MEASUREMENT_CACHE_LIMIT) {
          const oldestKey = cssMeasurementCache.keys().next().value;
          if (oldestKey != null) cssMeasurementCache.delete(oldestKey);
        }
        cssMeasurementCache.set(cssKey, cssWidth);
        return finiteWidth(cssWidth / unitsPerMm, approximateMm);
      }
      return approximateMm;
    }

    try {
      const measured = ctx.measureText(safeText).width + trackingPx;
      return finiteWidth(measured / unitsPerMm, approximateMm);
    } catch {
      return approximateMm;
    }
  };
}
