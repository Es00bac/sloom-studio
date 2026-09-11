import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type {
  PaperDocument,
  PaperFrame,
  PaperFrameAsset,
  PaperFrameKind,
  PaperFramePatch,
  PaperGuide,
  PaperPage,
  PaperPagePreset,
  PaperPageSpec,
  PaperBackgroundSpec,
  PaperBaselineGridSpec,
  PaperCharacterStyle,
  PaperTypography,
  PaperObjectStyle,
  PaperParagraphStyle,
  PaperParentPage,
  PaperImportedFont,
  PaperManagedIccProfile,
  PaperStyleCatalogs,
  PaperTextWrap,
  PaperParagraphBorderEdge,
  PaperTextRun,
} from '../types/paper';
import { isBinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { sanitizePaperReviewComments } from './paperReviewComments';
import { getPaperAuthoredNotesForPage, normalizePaperAuthoredNotes, paperAuthoredNoteNumber } from './paperAuthoredNotes';
import {
  normalizePaperGrepStyleRules,
  normalizePaperNestedStyleSteps,
} from './paperGrepStyles';
import {
  buildPaperImageRenderStyle,
  paperTextVerticalAlignToJustifyContent,
  resolvePaperTextBox,
} from './paperLayoutTools';
import { buildPaperBubblePath, resolveBubbleTailCurveHandle } from './paperBubblePaths';
import {
  getPaperBubbleCompoundFallbackSegments,
  getPaperCompoundBubbleFrameIds,
  paperBubbleCompoundStrokeDasharray,
} from './paperBubbleChains';
import { createPaperCanvasMeasurer } from './paperCanvasMeasurer';
import { resolvePaperThreadedFrames } from './paperThreadFlow';
import { resolvePaperBaselineLeadingPt, resolvePaperBaselineTopInsetMm } from './paperBaselineGrid';
import { paperComicSfxDesignToDataUrl } from './paperComicSfx';
import { normalizePaperTable } from './paperTables';
import { flattenPaperRichText, normalizePaperRichText } from './paperRichText';
import { paperEmphasisMarkToCss, paperInlineTextToHtml } from './paperJapaneseText';
import {
  appendPaperTextEffectTransform,
  buildPaperTextPaintEffectCssText,
} from './paperTextEffects';
import {
  buildPaperPrintProductionMetadata,
  DEFAULT_PAPER_PRINT_PRODUCTION,
  normalizePaperPrintProductionSpec,
  type PaperPrintProductionPatch,
  type PaperPrintProductionMetadata,
} from './paperPrintProduction';
import {
  buildPaperFrameAssetFromSourceItem,
  resolvePaperFrameAssetUrl,
} from './paperAssetReferences';
import { classifyPaperPlacedPdf, isPaperPdfMimeType } from './paperPlacedPdf';
import { isPaperManagedIccProfile } from './paperManagedIccProfiles';
import {
  buildPaperCanvasBubbleConnectorLayers,
  buildPaperCanvasFrameLayers,
} from './paperCanvasStacking';
import { resolvePaperColumnGutterMm } from './paperColumns';
import { buildPaperPrintSheetPlan, paperPointsToMm, type PaperPrintSheetPlan } from './paperPrintMarks';
import { buildPaperBarcodeGeometry, normalizePaperBarcodeSpec, PAPER_EAN13_NOMINAL } from './paperBarcode';
import {
  normalizePaperTextConditions,
  normalizePaperTextVariables,
  resolvePaperFramesTextTemplates,
} from './paperTextVariables';
import { normalizePaperDataMergeSource } from './paperDataMerge';
import { normalizePaperAnchoredObjects, resolvePaperAnchoredObjectFrames } from './paperAnchoredObjects';
import { normalizePaperPublicationReferences, resolvePaperPublicationFrames } from './paperPublicationReferences';
import { normalizePaperTrackChanges } from './paperTrackChanges';
import {
  DEFAULT_PAPER_LAYER,
  PAPER_DEFAULT_LAYER_ID,
  normalizePaperLayers,
  paperFrameLayerIsLocked,
  paperFrameLayerIsPrintable,
  paperFrameLayerIsVisible,
  paperParentPageIsApplied,
  resolveDefaultPaperLayerId,
  sortPaperFramesByLayer,
} from './paperLayers';

const DEFAULT_DPI = 300;

export const PAPER_PAGE_PRESETS: Record<PaperPagePreset, PaperPageSpec> = {
  custom: { preset: 'custom', widthMm: 215.9, heightMm: 279.4, bleedMm: 3, dpi: DEFAULT_DPI },
  'us-letter': { preset: 'us-letter', widthMm: 215.9, heightMm: 279.4, bleedMm: 3, dpi: DEFAULT_DPI },
  'us-legal': { preset: 'us-legal', widthMm: 215.9, heightMm: 355.6, bleedMm: 3, dpi: DEFAULT_DPI },
  tabloid: { preset: 'tabloid', widthMm: 279.4, heightMm: 431.8, bleedMm: 3, dpi: DEFAULT_DPI },
  a4: { preset: 'a4', widthMm: 210, heightMm: 297, bleedMm: 3, dpi: DEFAULT_DPI },
  a5: { preset: 'a5', widthMm: 148, heightMm: 210, bleedMm: 3, dpi: DEFAULT_DPI },
  'square-8': { preset: 'square-8', widthMm: 203.2, heightMm: 203.2, bleedMm: 3, dpi: DEFAULT_DPI },
  'comic-book': { preset: 'comic-book', widthMm: 170, heightMm: 260, bleedMm: 3.175, dpi: DEFAULT_DPI },
  'manga-digest': { preset: 'manga-digest', widthMm: 127, heightMm: 190.5, bleedMm: 3, dpi: DEFAULT_DPI },
  'webtoon-panel': { preset: 'webtoon-panel', widthMm: 100, heightMm: 178, bleedMm: 0, dpi: DEFAULT_DPI },
};

/**
 * Print-safe sans stack. Paper is a print module: text must render as the SAME concrete font in the
 * live editor and in the SVG-foreignObject export raster. The `system-ui` keyword does not guarantee
 * that — Chromium resolves it through a platform path that differs between the DOM and a rasterized
 * <foreignObject> (it can even fall back to a serif), which is why text that fits on screen could
 * reflow/clip on export. These are concrete, fontconfig-resolvable families ending in the `sans-serif`
 * generic (which resolves consistently in both contexts). Arial and Liberation Sans are metric-
 * compatible, so a layout made on Linux (Liberation Sans) matches Windows (Arial).
 */
export const PAPER_SAFE_SANS = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, "Noto Sans", "DejaVu Sans", sans-serif';

/**
 * Make a stored font stack deterministic for print. Strips the non-deterministic `system-ui` /
 * `ui-sans-serif` keywords (which resolve differently in the DOM vs the export raster) and substitutes
 * the concrete safe-sans chain, while leaving any real leading font (an imported font, Georgia, etc.)
 * and the `serif`/`monospace`/`sans-serif` generics intact — those already resolve identically in both
 * paths via fontconfig. Applied at the frame-normalize chokepoint (editor + export read the result) and
 * again in the exporter as belt-and-suspenders.
 */
export function resolvePaperFontFamily(family: string | undefined): string {
  if (!family || !family.trim()) return PAPER_SAFE_SANS;
  if (!/\b(system-ui|ui-sans-serif)\b/i.test(family)) return family;
  const safeCore = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, "Noto Sans", "DejaVu Sans"';
  const seen = new Set<string>();
  const out: string[] = [];
  let injected = false;
  for (const raw of family.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    if (/^(system-ui|ui-sans-serif)$/i.test(token)) {
      if (!injected) { out.push(safeCore); injected = true; }
      continue;
    }
    const key = token.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(token); }
  }
  return out.join(', ');
}

export const DEFAULT_PAPER_TYPOGRAPHY: PaperTypography = {
  fontFamily: PAPER_SAFE_SANS,
  fontSizePt: 10,
  leadingPt: 13,
  tracking: 0,
  fontKerning: 'auto',
  align: 'left',
  hyphenate: true,
  alignToBaselineGrid: false,
  color: '#111827',
  fontWeight: '400',
  fontStyle: 'normal',
  firstLineIndentMm: 0,
  alignLast: 'auto',
  smallCaps: false,
  numericStyle: 'normal',
  dropCapLines: 0,
  spaceBeforeMm: 0,
  spaceAfterMm: 0,
  lineBreak: 'auto',
};

export const DEFAULT_PAPER_BACKGROUND: PaperBackgroundSpec = {
  type: 'solid',
  color: '#ffffff',
  fromColor: '#ffffff',
  toColor: '#ffffff',
  angleDeg: 90,
  radialShape: 'ellipse',
};

export const DEFAULT_PAPER_STYLES: PaperStyleCatalogs = {
  // Authoring automation arrays stay explicit (empty) so created and parsed documents share one
  // stable authored-content fingerprint.
  grepStyleRules: [],
  nestedStyleSteps: [],
  paragraph: [
    // Document presets (word-processor feel) — plug into the paragraph-style dropdown + applyPaperParagraphStyle.
    { id: 'para-title', name: 'Title', typography: { fontFamily: 'Georgia, serif', fontSizePt: 26, leadingPt: 30, align: 'left', fontWeight: '700', hyphenate: false, spaceAfterMm: 3 } },
    { id: 'para-heading-1', name: 'Heading 1', typography: { fontFamily: 'Georgia, serif', fontSizePt: 18, leadingPt: 22, align: 'left', fontWeight: '700', hyphenate: false, spaceBeforeMm: 3, spaceAfterMm: 1.5 } },
    { id: 'para-heading-2', name: 'Heading 2', typography: { fontFamily: 'Georgia, serif', fontSizePt: 14, leadingPt: 18, align: 'left', fontWeight: '700', hyphenate: false, spaceBeforeMm: 2.5, spaceAfterMm: 1 } },
    { id: 'para-body', name: 'Body', typography: { fontFamily: 'Georgia, serif', fontSizePt: 10.5, leadingPt: 14, align: 'left', fontWeight: '400', hyphenate: true } },
    { id: 'para-quote', name: 'Quote', typography: { fontFamily: 'Georgia, serif', fontSizePt: 10.5, leadingPt: 14, align: 'left', fontWeight: '400', fontStyle: 'italic', hyphenate: true, firstLineIndentMm: 6 } },
    // Comic presets (comic-book layout) — the original defaults, unchanged.
    { id: 'para-comic-dialogue', name: 'Comic Dialogue', typography: { fontFamily: PAPER_SAFE_SANS, fontSizePt: 9.5, leadingPt: 11.5, align: 'center', fontWeight: '600', hyphenate: false } },
    { id: 'para-caption', name: 'Caption', typography: { fontFamily: 'Georgia, serif', fontSizePt: 9, leadingPt: 12, align: 'left', fontWeight: '700', hyphenate: true } },
    { id: 'para-sfx', name: 'SFX Display', typography: { fontFamily: 'Impact, Haettenschweiler, sans-serif', fontSizePt: 18, leadingPt: 18, align: 'center', fontWeight: '700', hyphenate: false } },
  ],
  character: [
    { id: 'char-emphasis', name: 'Emphasis', typography: { fontStyle: 'italic', fontWeight: '700' } },
    { id: 'char-whisper', name: 'Whisper', typography: { fontSizePt: 8, tracking: 80, fontStyle: 'italic' } },
  ],
  object: [
    { id: 'obj-panel-frame', name: 'Panel Frame', frame: { fillColor: 'transparent', strokeColor: '#111827', strokeWidthMm: 0.6, strokeStyle: 'solid', cornerRadiusMm: 0, opacity: 1 } },
    { id: 'obj-caption-box', name: 'Caption Box', frame: { fillColor: '#fff4bf', fillOpacity: 1, strokeColor: '#111827', strokeWidthMm: 0.3, cornerRadiusMm: 1.5, opacity: 1 } },
    { id: 'obj-dialogue-bubble', name: 'Dialogue Bubble', frame: { fillColor: '#ffffff', fillOpacity: 1, strokeColor: '#111827', strokeWidthMm: 0.35, cornerRadiusMm: 100, textBoxXPercent: 12, textBoxYPercent: 18, textBoxWidthPercent: 76, textBoxHeightPercent: 50, textVerticalAlign: 'middle' } },
  ],
};

type PaperFrameDraft = Partial<Omit<PaperFrame, 'typography'>> & {
  typography?: Partial<PaperTypography>;
} & Pick<PaperFrame, 'kind' | 'xMm' | 'yMm' | 'widthMm' | 'heightMm'>;

/** Every PaperFrame key must be named by the normalizer, including optional persisted controls. */
type ExhaustivePaperFrameKeys = Record<keyof PaperFrame, unknown>;

export interface PaperPrintHtmlOptions {
  mediaBox?: 'bleed' | 'trim';
  includeScreenGuides?: boolean;
  resolveAssetUrl?: (frame: PaperFrame) => string | undefined;
  /** Exact managed faces for an isolated browser/Electron document. */
  fontFaceCss?: string;
  /** False for isolated content rasters: PDF/X adds production marks natively from the same sheet plan. */
  includeProductionMarks?: boolean;
}

export function createDefaultPaperDocument({
  title = 'Untitled Paper Document',
  preset = 'us-letter',
  dpi = DEFAULT_DPI,
}: {
  title?: string;
  preset?: PaperPagePreset;
  dpi?: number;
} = {}): PaperDocument {
  const now = Date.now();
  const presetPage = PAPER_PAGE_PRESETS[preset] ?? PAPER_PAGE_PRESETS['us-letter'];
  const page = {
    ...presetPage,
    dpi: normalizeDpi(dpi),
  };
  const firstPage = createPaperPage(1, page);

  return {
    id: makeId('paper'),
    title,
    page,
    accessibility: { language: 'en' },
    layout: {
      marginsMm: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
      columns: { count: 2, gutterMm: 5 },
      grid: { enabled: true, sizeMm: 5, subdivisions: 5 },
      baselineGrid: { startMm: 12.7, incrementMm: 4.6 },
    },
    background: DEFAULT_PAPER_BACKGROUND,
    printProduction: DEFAULT_PAPER_PRINT_PRODUCTION,
    layers: [{ ...DEFAULT_PAPER_LAYER }],
    view: {
      showRulers: true,
      showGrid: true,
      showBaselineGrid: false,
      showGuides: true,
      showTextBaselines: false,
      showFrameEdges: false,
      showBleed: true,
      showSpreads: false,
      startOnRight: true,
      // rtlBinding omitted → 'auto': right-to-left when the doc has vertical (縦書き) text, else left-to-right.
      snapToGuides: false,
      snapToGrid: false,
    },
    parentPages: [createPaperParentPage('A-Parent', page)],
    styles: DEFAULT_PAPER_STYLES,
    textVariables: [],
    textConditions: [],
    authoredNotes: [],
    pages: [firstPage],
    createdAt: now,
    updatedAt: now,
  };
}

export function paperPixelsFromMm(mm: number, dpi: number): number {
  return Math.round((Math.max(0, mm) / 25.4) * normalizeDpi(dpi));
}

/** Replace the document's GREP-style rules and/or nested-style steps with sanitized values. */
export function updatePaperStyleAutomation(
  doc: PaperDocument,
  patch: { grepStyleRules?: unknown; nestedStyleSteps?: unknown },
): PaperDocument {
  return touch({
    ...doc,
    styles: {
      ...doc.styles,
      ...(patch.grepStyleRules !== undefined ? { grepStyleRules: normalizePaperGrepStyleRules(patch.grepStyleRules) } : {}),
      ...(patch.nestedStyleSteps !== undefined ? { nestedStyleSteps: normalizePaperNestedStyleSteps(patch.nestedStyleSteps) } : {}),
    },
  });
}

export function updatePaperDocumentSetup(
  doc: PaperDocument,
  patch: {
    preset?: PaperPagePreset;
    widthMm?: number;
    heightMm?: number;
    dpi?: number;
    bleedMm?: number;
    marginsMm?: Partial<PaperDocument['layout']['marginsMm']>;
    columns?: Partial<PaperDocument['layout']['columns']>;
    grid?: Partial<PaperDocument['layout']['grid']>;
    baselineGrid?: Partial<PaperDocument['layout']['baselineGrid']>;
    background?: Partial<PaperDocument['background']>;
    printProduction?: PaperPrintProductionPatch;
    managedIccProfiles?: PaperDocument['managedIccProfiles'];
    accessibility?: Partial<PaperDocument['accessibility']>;
    textVariables?: ReadonlyArray<NonNullable<PaperDocument['textVariables']>[number]>;
    textConditions?: ReadonlyArray<NonNullable<PaperDocument['textConditions']>[number]>;
    dataMerge?: unknown;
    anchoredObjects?: unknown;
    publicationReferences?: unknown;
    trackChanges?: unknown;
  },
): PaperDocument {
  const preset = patch.preset ?? doc.page.preset;
  const presetPage = preset !== 'custom'
    ? PAPER_PAGE_PRESETS[preset] ?? PAPER_PAGE_PRESETS['us-letter']
    : undefined;
  const page: PaperPageSpec = {
    preset,
    widthMm: clampMm(patch.widthMm ?? presetPage?.widthMm ?? doc.page.widthMm, 25, 2500),
    heightMm: clampMm(patch.heightMm ?? presetPage?.heightMm ?? doc.page.heightMm, 25, 5000),
    bleedMm: clampMm(patch.bleedMm ?? presetPage?.bleedMm ?? doc.page.bleedMm, 0, 50),
    dpi: normalizeDpi(patch.dpi ?? presetPage?.dpi ?? doc.page.dpi),
  };
  const layout = {
    marginsMm: {
      ...doc.layout.marginsMm,
      ...patch.marginsMm,
    },
    columns: {
      ...doc.layout.columns,
      ...patch.columns,
    },
    grid: {
      ...doc.layout.grid,
      ...patch.grid,
    },
    baselineGrid: {
      ...(doc.layout.baselineGrid ?? { startMm: 12.7, incrementMm: 4.6 }),
      ...patch.baselineGrid,
    },
  };

  layout.marginsMm = {
    top: clampMm(layout.marginsMm.top, 0, page.heightMm / 2),
    right: clampMm(layout.marginsMm.right, 0, page.widthMm / 2),
    bottom: clampMm(layout.marginsMm.bottom, 0, page.heightMm / 2),
    left: clampMm(layout.marginsMm.left, 0, page.widthMm / 2),
  };
  layout.columns = {
    count: Math.max(1, Math.min(24, Math.round(layout.columns.count))),
    gutterMm: clampMm(layout.columns.gutterMm, 0, page.widthMm / 2),
  };
  layout.grid = {
    enabled: Boolean(layout.grid.enabled),
    sizeMm: clampMm(layout.grid.sizeMm, 0.5, 100),
    subdivisions: Math.max(1, Math.min(32, Math.round(layout.grid.subdivisions))),
  };
  layout.baselineGrid = {
    startMm: clampMm(layout.baselineGrid.startMm, 0, page.heightMm),
    incrementMm: clampMm(layout.baselineGrid.incrementMm, 0.5, 100),
  };
  const background = normalizePaperBackground({
    ...(doc.background ?? DEFAULT_PAPER_BACKGROUND),
    ...patch.background,
  });
  const printProduction = normalizePaperPrintProductionSpec({
    ...(doc.printProduction ?? DEFAULT_PAPER_PRINT_PRODUCTION),
    ...patch.printProduction,
    marks: {
      ...(doc.printProduction?.marks ?? DEFAULT_PAPER_PRINT_PRODUCTION.marks),
      ...patch.printProduction?.marks,
    },
    jobInfo: {
      ...(doc.printProduction?.jobInfo ?? DEFAULT_PAPER_PRINT_PRODUCTION.jobInfo),
      ...patch.printProduction?.jobInfo,
    },
  });
  const managedIccProfiles = 'managedIccProfiles' in patch
    ? patch.managedIccProfiles
    : doc.managedIccProfiles;
  const accessibility = normalizePaperAccessibility({
    ...(doc.accessibility ?? { language: 'en' }),
    ...patch.accessibility,
  });
  const textVariables = 'textVariables' in patch
    ? normalizePaperTextVariables(patch.textVariables) ?? []
    : doc.textVariables;
  const textConditions = 'textConditions' in patch
    ? normalizePaperTextConditions(patch.textConditions) ?? []
    : doc.textConditions;
  const dataMergeProvided = 'dataMerge' in patch;
  // Unlike the list fields above, an explicitly provided but unnormalizable value (null, undefined,
  // empty object) must CLEAR the previous source instead of silently no-oping via the base spread.
  const dataMerge = dataMergeProvided
    ? normalizePaperDataMergeSource(patch.dataMerge)
    : doc.dataMerge;
  const anchoredObjects = 'anchoredObjects' in patch
    ? normalizePaperAnchoredObjects(patch.anchoredObjects)
    : doc.anchoredObjects;
  const publicationReferences = 'publicationReferences' in patch
    ? normalizePaperPublicationReferences(patch.publicationReferences)
    : doc.publicationReferences;
  const trackChanges = 'trackChanges' in patch ? normalizePaperTrackChanges(patch.trackChanges) : doc.trackChanges;

  const updated = touch({
    ...doc,
    page,
    layout,
    background,
    printProduction,
    accessibility,
    ...(managedIccProfiles !== undefined ? { managedIccProfiles } : {}),
    ...(textVariables !== undefined ? { textVariables } : {}),
    ...(textConditions !== undefined ? { textConditions } : {}),
    ...(dataMerge !== undefined ? { dataMerge } : {}),
    ...(anchoredObjects !== undefined ? { anchoredObjects } : {}),
    ...(publicationReferences !== undefined ? { publicationReferences } : {}),
    ...(trackChanges !== undefined ? { trackChanges } : {}),
    pages: doc.pages.map((paperPage) => ({
      ...paperPage,
      guides: updateDefaultGuidesForPage(paperPage.guides, page),
    })),
  });
  if (!dataMergeProvided || dataMerge !== undefined) return updated;
  const { dataMerge: _clearedDataMerge, ...withoutDataMerge } = updated;
  return withoutDataMerge;
}

export function createPaperPage(pageNumber: number, pageSpec: PaperPageSpec): PaperPage {
  return {
    id: makeId(`page-${pageNumber}`),
    pageNumber,
    frames: [],
    guides: defaultGuidesForPage(pageSpec),
  };
}

export function createPaperParentPage(name: string, pageSpec: PaperPageSpec): PaperParentPage {
  return {
    id: makeId('parent-page'),
    name: name.trim() || 'A-Parent',
    frames: [],
    guides: defaultGuidesForPage(pageSpec),
  };
}

export function addPaperParentPage(doc: PaperDocument, name = `Parent ${doc.parentPages.length + 1}`): PaperDocument {
  return touch({ ...doc, parentPages: [...doc.parentPages, createPaperParentPage(name, doc.page)] });
}

export function updatePaperParentPage(doc: PaperDocument, parentPageId: string, patch: Partial<Pick<PaperParentPage, 'name' | 'frames' | 'guides'>>): PaperDocument {
  return touch({
    ...doc,
    parentPages: doc.parentPages.map((parent) => parent.id === parentPageId ? { ...parent, ...patch } : parent),
  });
}

export function deletePaperParentPage(doc: PaperDocument, parentPageId: string): PaperDocument {
  const parentPages = doc.parentPages.filter((parent) => parent.id !== parentPageId);
  return touch({
    ...doc,
    parentPages,
    pages: doc.pages.map((page) => page.parentPageId === parentPageId ? { ...page, parentPageId: undefined } : page),
  });
}

export function assignPaperParentPage(doc: PaperDocument, pageId: string, parentPageId: string | undefined): PaperDocument {
  const resolvedParentId = parentPageId && doc.parentPages.some((parent) => parent.id === parentPageId) ? parentPageId : undefined;
  return touch({
    ...doc,
    pages: doc.pages.map((page) => page.id === pageId ? { ...page, parentPageId: resolvedParentId } : page),
  });
}

export function addFrameToPaperParentPage(
  doc: PaperDocument,
  parentPageId: string,
  frame: PaperFrameDraft,
): { document: PaperDocument; frameId: string } {
  const parent = doc.parentPages.find((candidate) => candidate.id === parentPageId);
  const frameId = frame.id ?? makeId('parent-frame');
  const nextFrame = createPaperFrame({
    ...frame,
    id: frameId,
    layerId: frame.layerId ?? resolveDefaultPaperLayerId(doc),
    locked: true,
    zIndex: frame.zIndex ?? nextPaperFrameZIndex(parent?.frames ?? []),
  });
  return {
    document: updatePaperParentPage(doc, parentPageId, {
      frames: (parent?.frames ?? []).concat(nextFrame),
    }),
    frameId,
  };
}

export function resolvePaperPageInheritedFrames(doc: PaperDocument, page: PaperPage): PaperFrame[] {
  const parent = page.parentPageId ? doc.parentPages.find((candidate) => candidate.id === page.parentPageId) : undefined;
  if (!parent) return [];
  return parent.frames.map((frame) => ({
    ...frame,
    id: `inherited-${parent.id}-${frame.id}-${page.id}`,
    parentPageId: parent.id,
    parentFrameId: frame.id,
    inherited: true,
    locked: true,
    label: `${frame.label} (${parent.name})`,
    zIndex: frame.zIndex - 100000,
  }));
}

export function resolvePaperPageInheritedGuides(doc: PaperDocument, page: PaperPage): PaperGuide[] {
  const parent = page.parentPageId ? doc.parentPages.find((candidate) => candidate.id === page.parentPageId) : undefined;
  if (!parent) return [];
  return parent.guides.map((guide) => ({ ...guide, id: `inherited-${parent.id}-${guide.id}-${page.id}`, label: guide.label ? `${guide.label} (${parent.name})` : parent.name }));
}

export function detachInheritedPaperFrame(doc: PaperDocument, pageId: string, inheritedFrameId: string): { document: PaperDocument; frameId?: string } {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  if (!page) return { document: doc };
  const inherited = resolvePaperPageInheritedFrames(doc, page).find((frame) => frame.id === inheritedFrameId || frame.parentFrameId === inheritedFrameId);
  if (!inherited) return { document: doc };
  const localFrame = {
    ...inherited,
    id: makeId('frame-override'),
    inherited: false,
    locked: false,
    parentFrameId: inherited.parentFrameId,
    parentPageId: inherited.parentPageId,
    label: inherited.label.replace(/ \([^)]*\)$/, ' override'),
    zIndex: inherited.zIndex + 100000,
  };
  return addFrameToPaperPage(doc, pageId, localFrame);
}

export function resolvePaperPageFramesForCanvas(doc: PaperDocument, page: PaperPage): PaperFrame[] {
  const effectiveFrames = [...resolvePaperPageInheritedFrames(doc, page), ...page.frames]
    .map((frame) => computeEffectivePaperFrame(doc, frame));
  const resolvedFrames = resolvePaperPublicationFrames(
    resolvePaperAnchoredObjectFrames(doc, page, effectiveFrames), doc,
  );
  return sortPaperFramesByLayer(doc, resolvedFrames.filter((frame) => paperFrameLayerIsVisible(doc, frame)));
}

export function resolvePaperPageFramesForOutput(doc: PaperDocument, page: PaperPage): PaperFrame[] {
  const effectiveFrames = [...resolvePaperPageInheritedFrames(doc, page), ...page.frames]
    .map((frame) => computeEffectivePaperFrame(doc, frame));
  const resolvedFrames = resolvePaperPublicationFrames(
    resolvePaperAnchoredObjectFrames(doc, page, effectiveFrames), doc,
  );
  return sortPaperFramesByLayer(doc, resolvedFrames.filter((frame) => paperFrameLayerIsPrintable(doc, frame)));
}

export function applyPaperParagraphStyle(doc: PaperDocument, pageId: string, frameId: string, styleId: string | undefined): PaperDocument {
  return updatePaperFrame(doc, pageId, frameId, { paragraphStyleId: styleId });
}

export function applyPaperCharacterStyle(doc: PaperDocument, pageId: string, frameId: string, styleId: string | undefined): PaperDocument {
  return updatePaperFrame(doc, pageId, frameId, { characterStyleId: styleId });
}

export function applyPaperObjectStyle(doc: PaperDocument, pageId: string, frameId: string, styleId: string | undefined): PaperDocument {
  return updatePaperFrame(doc, pageId, frameId, { objectStyleId: styleId });
}

export function redefinePaperStyleFromFrame(doc: PaperDocument, frame: PaperFrame, kind: 'paragraph' | 'character' | 'object'): PaperDocument {
  if (kind === 'paragraph' && frame.paragraphStyleId) {
    return touch({ ...doc, styles: { ...doc.styles, paragraph: doc.styles.paragraph.map((style) => style.id === frame.paragraphStyleId ? { ...style, typography: { ...frame.typography }, columns: frame.columns } : style) } });
  }
  if (kind === 'character' && frame.characterStyleId) {
    return touch({ ...doc, styles: { ...doc.styles, character: doc.styles.character.map((style) => style.id === frame.characterStyleId ? { ...style, typography: { ...frame.typography } } : style) } });
  }
  if (kind === 'object' && frame.objectStyleId) {
    const objectPatch = pickObjectStyleFrame(frame);
    return touch({ ...doc, styles: { ...doc.styles, object: doc.styles.object.map((style) => style.id === frame.objectStyleId ? { ...style, frame: objectPatch } : style) } });
  }
  return doc;
}

export function clearPaperFrameStyleLinks(doc: PaperDocument, pageId: string, frameId: string): PaperDocument {
  return updatePaperFrame(doc, pageId, frameId, { paragraphStyleId: undefined, characterStyleId: undefined, objectStyleId: undefined });
}

export function clearPaperFrameLocalOverrides(doc: PaperDocument, pageId: string, frameId: string): PaperDocument {
  const page = doc.pages.find((candidate) => candidate.id === pageId);
  const frame = page?.frames.find((candidate) => candidate.id === frameId);
  if (!frame) return doc;
  const effective = computeEffectivePaperFrame(doc, { ...createPaperFrame(frame), ...frame });
  return updatePaperFrame(doc, pageId, frameId, {
    typography: effective.typography,
    columns: effective.columns,
    ...pickObjectStyleFrame(effective),
  });
}

/** True when any text-bearing frame is set 縦書き (vertical-rl) — the signal that a document is Japanese/manga. */
export function documentHasVerticalText(document: Pick<PaperDocument, 'pages'>): boolean {
  return document.pages.some((page) =>
    page.frames.some((frame) => frame.typography?.writingMode === 'vertical-rl'),
  );
}

/** Resolve the effective binding direction: an explicit `view.rtlBinding` wins; otherwise it auto-derives —
 * right-to-left (右綴じ) when the document has vertical (縦書き) text, left-to-right for a Western document. */
export function effectiveRtlBinding(document: Pick<PaperDocument, 'pages' | 'view'>): boolean {
  return document.view.rtlBinding ?? documentHasVerticalText(document);
}

/**
 * Export-only effective-style projection. Paragraph/character styles supply effective typography
 * OVER frame typography at render time, so exact managed-font collection, aliasing, CSS, and
 * preflight must observe the same faces the output will actually paint. This bakes that
 * typography (and paragraph columns) into each frame and CLEARS the paragraph/character links so
 * a later computeEffectivePaperFrame pass cannot re-apply raw style families over managed-font
 * aliases. Object styles carry no typography and keep resolving at render. The authored document
 * is never mutated; untouched frames keep their identity.
 */
export function resolvePaperDocumentEffectiveTypography(document: PaperDocument): PaperDocument {
  const bakeFrame = (frame: PaperFrame): PaperFrame => {
    if (!frame.paragraphStyleId && !frame.characterStyleId) return frame;
    const effective = computeEffectivePaperFrame(document, { ...frame, objectStyleId: undefined });
    return {
      ...effective,
      objectStyleId: frame.objectStyleId,
      paragraphStyleId: undefined,
      characterStyleId: undefined,
    };
  };
  const bakeContainer = <T extends { frames: PaperFrame[] }>(container: T): T => {
    const frames = container.frames.map(bakeFrame);
    return frames.some((frame, index) => frame !== container.frames[index])
      ? { ...container, frames }
      : container;
  };
  const pages = document.pages.map(bakeContainer);
  const parentPages = document.parentPages.map(bakeContainer);
  const unchanged = pages.every((page, index) => page === document.pages[index])
    && parentPages.every((page, index) => page === document.parentPages[index]);
  return unchanged ? document : { ...document, pages, parentPages };
}

/**
 * Export-only effective-style projection for printable content. Hidden and non-printing frames
 * remain the authored objects, including their style links and managed-font references. Besides
 * avoiding needless work, that boundary is important for strict output: an invalid managed face
 * used exclusively by excluded content must not block a different, printable exact face.
 */
export function resolvePaperDocumentEffectiveTypographyForOutput(document: PaperDocument): PaperDocument {
  const bakeFrame = (frame: PaperFrame): PaperFrame => {
    if (!paperFrameLayerIsPrintable(document, frame)) return frame;
    if (!frame.paragraphStyleId && !frame.characterStyleId) return frame;
    const effective = computeEffectivePaperFrame(document, { ...frame, objectStyleId: undefined });
    return {
      ...effective,
      objectStyleId: frame.objectStyleId,
      paragraphStyleId: undefined,
      characterStyleId: undefined,
    };
  };
  const bakeContainer = <T extends { frames: PaperFrame[] }>(container: T): T => {
    const frames = container.frames.map(bakeFrame);
    return frames.some((frame, index) => frame !== container.frames[index])
      ? { ...container, frames }
      : container;
  };
  const pages = document.pages.map(bakeContainer);
  const parentPages = document.parentPages.map((parentPage) => (
    paperParentPageIsApplied(document, parentPage.id) ? bakeContainer(parentPage) : parentPage
  ));
  const unchanged = pages.every((page, index) => page === document.pages[index])
    && parentPages.every((page, index) => page === document.parentPages[index]);
  return unchanged ? document : { ...document, pages, parentPages };
}

export function computeEffectivePaperFrame(doc: Pick<PaperDocument, 'styles'>, frame: PaperFrame): PaperFrame {
  const paragraph = resolveParagraphStyle(doc.styles, frame.paragraphStyleId);
  const character = resolveCharacterStyle(doc.styles, frame.characterStyleId);
  const object = resolveObjectStyle(doc.styles, frame.objectStyleId);
  return {
    ...frame,
    ...object?.frame,
    typography: {
      ...frame.typography,
      ...paragraph?.typography,
      ...character?.typography,
    },
    columns: paragraph?.columns ?? frame.columns,
  };
}

export function addPaperPage(doc: PaperDocument): PaperDocument {
  const pages = [
    ...doc.pages,
    createPaperPage(doc.pages.length + 1, doc.page),
  ];

  return touch({ ...doc, pages });
}

export function duplicatePaperPage(doc: PaperDocument, pageId: string): PaperDocument {
  const source = doc.pages.find((page) => page.id === pageId);
  if (!source) return doc;

  const clone: PaperPage = {
    ...source,
    id: makeId('page-copy'),
    pageNumber: doc.pages.length + 1,
    frames: source.frames.map((frame, index) => ({
      ...frame,
      id: makeId(`frame-copy-${index}`),
      label: `${frame.label} copy`,
    })),
    guides: source.guides.map((guide) => ({ ...guide, id: makeId('guide-copy') })),
  };

  return touch({ ...doc, pages: [...doc.pages, clone] });
}

export function removePaperPage(doc: PaperDocument, pageId: string): PaperDocument {
  if (doc.pages.length <= 1) return doc;
  const pages = renumberPages(doc.pages.filter((page) => page.id !== pageId));
  return touch({ ...doc, pages });
}

export function addFrameToPaperPage(
  doc: PaperDocument,
  pageId: string,
  frame: PaperFrameDraft,
): { document: PaperDocument; frameId: string } {
  const targetPage = doc.pages.find((page) => page.id === pageId);
  const frameId = frame.id ?? makeId('frame');
  const nextFrame = createPaperFrame({
    ...frame,
    id: frameId,
    layerId: frame.layerId ?? resolveDefaultPaperLayerId(doc),
    zIndex: frame.zIndex ?? nextPaperFrameZIndex(targetPage?.frames ?? []),
  });
  const pages = doc.pages.map((page) =>
    page.id === pageId
      ? { ...page, frames: [...page.frames, nextFrame] }
      : page,
  );

  return { document: touch({ ...doc, pages }), frameId };
}

export function nextPaperFrameZIndex(frames: PaperFrame[]): number {
  if (frames.length === 0) return 0;
  return Math.max(...frames.map((frame) => Number.isFinite(frame.zIndex) ? frame.zIndex : 0)) + 1;
}

export function updatePaperFrame(
  doc: PaperDocument,
  pageId: string,
  frameId: string,
  patch: PaperFramePatch,
): PaperDocument {
  let changed = false;
  const pages = doc.pages.map((page) => {
    if (page.id !== pageId) return page;

    let pageChanged = false;
    const frames = page.frames.map((frame) => {
      if (frame.id !== frameId) return frame;
      if (paperFrameLayerIsLocked(doc, frame)) return frame;
      const nextFrame = patchPaperFrame(frame, patch);
      if (nextFrame === frame) return frame;
      pageChanged = true;
      changed = true;
      return nextFrame;
    });

    if (!pageChanged) return page;
    return {
      ...page,
      frames,
    };
  });

  return changed ? touch({ ...doc, pages }) : doc;
}

function patchPaperFrame(frame: PaperFrame, patch: PaperFramePatch): PaperFrame {
  const { typography, ...framePatch } = patch;
  const patchesFillSwatch = Object.prototype.hasOwnProperty.call(framePatch, 'fillSwatchId');
  const patchesStrokeSwatch = Object.prototype.hasOwnProperty.call(framePatch, 'strokeSwatchId');
  const frameChanged = hasShallowPatchChange(frame, framePatch);
  const typographyChanged = typography ? hasShallowPatchChange(frame.typography, typography) : false;

  if (!frameChanged && !typographyChanged) return frame;

  const next: PaperFrame = {
    ...frame,
    ...framePatch,
    typography: typographyChanged
      ? { ...frame.typography, ...typography }
      : frame.typography,
  };
  // Alt text is persisted user content, so keep programmatic patches subject to the same bounded
  // normalization as frame construction and imported documents (the Inspector's maxLength is not a trust boundary).
  if (Object.prototype.hasOwnProperty.call(framePatch, 'altText')) {
    next.altText = typeof framePatch.altText === 'string' && framePatch.altText.trim()
      ? framePatch.altText.trim().replace(/\s+/g, ' ').slice(0, 1000)
      : undefined;
  }
  // Changing the fill by any path OTHER than applying a swatch drops the durable spot-swatch link, so it
  // can never point at a swatch the fill no longer matches.
  if (framePatch.fillColor !== undefined && framePatch.fillSwatchId === undefined) {
    next.fillSwatchId = undefined;
    next.fillTintPercent = undefined;
  } else if (framePatch.fillSwatchId !== undefined && framePatch.fillTintPercent === undefined) {
    next.fillTintPercent = undefined;
  }
  if (framePatch.fillTintPercent !== undefined) {
    next.fillTintPercent = next.fillSwatchId ? normalizePaperTintPercent(framePatch.fillTintPercent) : undefined;
  } else if (patchesFillSwatch && !next.fillSwatchId) {
    next.fillTintPercent = undefined;
  }
  // Same for the stroke's durable spot-swatch link.
  if (framePatch.strokeColor !== undefined && framePatch.strokeSwatchId === undefined) {
    next.strokeSwatchId = undefined;
    next.strokeTintPercent = undefined;
  } else if (framePatch.strokeSwatchId !== undefined && framePatch.strokeTintPercent === undefined) {
    next.strokeTintPercent = undefined;
  }
  if (framePatch.strokeTintPercent !== undefined) {
    next.strokeTintPercent = next.strokeSwatchId ? normalizePaperTintPercent(framePatch.strokeTintPercent) : undefined;
  } else if (patchesStrokeSwatch && !next.strokeSwatchId) {
    next.strokeTintPercent = undefined;
  }
  // Same for the text colour. Typography patches are usually spread (`{...typo, color}`), so — unlike the
  // flat fill patch — the stale colorSwatchId rides along. Drop it whenever the colour actually changes,
  // UNLESS the patch explicitly assigns a *different* swatch (i.e. the user picked a new one).
  if (typography && typography.color !== undefined && !Object.is(typography.color, frame.typography.color)) {
    const assignsNewSwatch =
      typography.colorSwatchId !== undefined && !Object.is(typography.colorSwatchId, frame.typography.colorSwatchId);
    if (!assignsNewSwatch) next.typography = { ...next.typography, colorSwatchId: undefined };
  }
  // Keep `text` and `richText` consistent. Editing the plain text of a rich frame replaces its content, so
  // the old runs are dropped (text becomes authoritative again) — unless the same patch also sets richText.
  if (framePatch.text !== undefined && framePatch.richText === undefined && frame.richText) {
    next.richText = undefined;
  }
  // Patching richText makes it authoritative: normalize it and re-flatten `text` to match, unless the patch
  // supplied its own text alongside (the editor commits both together).
  if (framePatch.richText !== undefined) {
    const normalized = normalizePaperRichText(framePatch.richText);
    next.richText = normalized;
    if (framePatch.text === undefined) next.text = normalized ? flattenPaperRichText(normalized) : (frame.text ?? '');
  }
  return next;
}

function hasShallowPatchChange<T extends object>(current: T, patch: Partial<T>): boolean {
  return Object.entries(patch).some(([key, value]) => !Object.is(current[key as keyof T], value));
}

export function placeSourceAssetInPaperFrame(
  doc: PaperDocument,
  {
    pageId,
    frameId,
    item,
  }: {
    pageId: string;
    frameId: string;
    item: SourceBinLibraryItem;
  },
): PaperDocument {
  const pages = doc.pages.map((page) => {
    if (page.id !== pageId) return page;

    return {
      ...page,
      frames: page.frames.map((frame) =>
        frame.id === frameId
          ? placeAssetInFrame(frame, item)
          : frame,
      ),
    };
  });

  return touch({ ...doc, pages });
}

export function exportPaperDocumentToPrintHtml(
  doc: PaperDocument,
  options: PaperPrintHtmlOptions = {},
): string {
  const page = normalizePageSpec(doc.page);
  const backgroundCss = paperDocumentBackgroundCss(doc.background);
  const mediaBox = options.mediaBox ?? 'bleed';
  const useBleedMediaBox = mediaBox === 'bleed';
  const includeProductionMarks = useBleedMediaBox && options.includeProductionMarks !== false;
  const printSheet = includeProductionMarks ? buildPaperPrintSheetPlan(page, doc.printProduction) : undefined;
  const contentBleedMm = useBleedMediaBox ? page.bleedMm : 0;
  const bleedBoxLeftMm = printSheet ? paperPointsToMm(printSheet.bleedBox.xPt) : 0;
  const bleedBoxTopMm = printSheet ? paperPointsToMm(printSheet.bleedBox.yTopPt) : 0;
  const bleedBoxWidthMm = page.widthMm + contentBleedMm * 2;
  const bleedBoxHeightMm = page.heightMm + contentBleedMm * 2;
  const sheetWidthMm = printSheet ? paperPointsToMm(printSheet.mediaBox.widthPt) : bleedBoxWidthMm;
  const sheetHeightMm = printSheet ? paperPointsToMm(printSheet.mediaBox.heightPt) : bleedBoxHeightMm;
  const pages = doc.pages.map((paperPage) => renderPrintPage(doc, paperPage, page, {
    resolveAssetUrl: options.resolveAssetUrl,
    bleedBoxLeftMm,
    bleedBoxTopMm,
    bleedBoxWidthMm,
    bleedBoxHeightMm,
    pageOffsetMm: contentBleedMm,
    printSheet,
  })).join('\n');
  const productionMeta = buildPaperPrintProductionMetadata(doc);
  const screenGuideCss = options.includeScreenGuides ? `
@media screen {
  .paper-page::after {
    content: "";
    position: absolute;
    inset: ${formatMm(doc.layout.marginsMm.top)} ${formatMm(doc.layout.marginsMm.right)} ${formatMm(doc.layout.marginsMm.bottom)} ${formatMm(doc.layout.marginsMm.left)};
    border: 0.2mm dashed rgba(6, 182, 212, 0.5);
    pointer-events: none;
  }
}` : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="signal-loom-paper-dpi" content="${page.dpi}" />
${renderPrintProductionMetaTags(productionMeta)}
<title>${escapeHtml(doc.title)}</title>
<style>
${options.fontFaceCss ?? ''}
@page {
  size: ${formatMm(sheetWidthMm)} ${formatMm(sheetHeightMm)};
  margin: 0;
  bleed: ${formatMm(page.bleedMm)};
  marks: none;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #d1d5db; color: #111827; }
html, body { width: ${formatMm(sheetWidthMm)}; min-height: ${formatMm(sheetHeightMm)}; }
body { font-family: ${PAPER_SAFE_SANS}; }
.paper-sheet {
  position: relative;
  width: ${formatMm(sheetWidthMm)};
  height: ${formatMm(sheetHeightMm)};
  margin: 0;
  overflow: hidden;
  background: #ffffff;
  page-break-after: always;
}
.paper-bleed {
  position: absolute;
  left: ${formatMm(bleedBoxLeftMm)};
  top: ${formatMm(bleedBoxTopMm)};
  width: ${formatMm(bleedBoxWidthMm)};
  height: ${formatMm(bleedBoxHeightMm)};
  overflow: visible;
  background: ${backgroundCss};
}
.paper-page {
  position: absolute;
  left: ${formatMm(contentBleedMm)};
  top: ${formatMm(contentBleedMm)};
  width: ${formatMm(page.widthMm)};
  height: ${formatMm(page.heightMm)};
  overflow: visible;
  background: ${backgroundCss};
}
.frame { position: absolute; margin: 0; overflow: visible; }
.frame-content { position: absolute; inset: 0; overflow: hidden; }
.frame img { width: 100%; height: 100%; display: block; object-position: center; transform-origin: center; }
.frame-text-content, .frame-speechBubble, .frame-thoughtBubble {
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.frame-speechBubble, .frame-thoughtBubble {
  background: white;
  border: 0.45mm solid #111827;
  border-radius: 50%;
  padding: 4mm;
}
.frame-thoughtBubble {
  border-style: dashed;
}
.bubble-tail {
  position: absolute;
  pointer-events: none;
}
.bubble-tail-speech {
  width: 7mm;
  height: 7mm;
  transform: translate(-50%, -50%) rotate(45deg);
  border-right: 0.45mm solid #111827;
  border-bottom: 0.45mm solid #111827;
  background: white;
}
.bubble-tail-thought, .bubble-tail-thought-small {
  transform: translate(-50%, -50%);
  border: 0.45mm solid #111827;
  border-radius: 50%;
  background: white;
}
.bubble-tail-thought { width: 4mm; height: 4mm; }
.bubble-tail-thought-small { width: 2.5mm; height: 2.5mm; }
/* No .frame-caption box: a caption's fill, border, corner radius and padding are painted
   per-frame by .frame-content (printFrameContentStyle). A duplicate border plus 2.5mm padding
   here double-outlined captions and shrank the text box so captions that fit in the editor
   wrapped and clipped on export. */
.frame-panel {
  border: 0.6mm solid #111827;
  background: transparent;
}
.paper-dropcap::first-letter {
  float: left;
  font-size: calc(var(--sl-dropcap-lines, 3) * 1em);
  line-height: 0.78;
  padding-right: 0.08em;
  padding-top: 0.02em;
  font-weight: 600;
}
${screenGuideCss}
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

function renderPrintProductionMetaTags(metadata: PaperPrintProductionMetadata): string {
  const entries: Array<[string, string | number | boolean | undefined]> = [
    ['signal-loom-paper-pdf-standard', metadata.pdfStandard],
    ['signal-loom-paper-output-intent-profile', metadata.outputIntentProfileId],
    ['signal-loom-paper-output-intent-label', metadata.outputIntentLabel],
    ['signal-loom-paper-output-intent-color-space', metadata.outputIntentColorSpace],
    ['signal-loom-paper-output-condition', metadata.outputCondition],
    ['signal-loom-paper-output-intent-registry', metadata.outputIntentRegistryName],
    ['signal-loom-paper-total-ink-limit', metadata.totalInkLimitPercent],
    ['signal-loom-paper-black-policy', metadata.blackPolicy],
    ['signal-loom-paper-spot-color-policy', metadata.spotColorPolicy],
    ['signal-loom-paper-overprint-preview', metadata.overprintPreview],
    ['signal-loom-paper-browser-pdf-press-certified', metadata.browserPdfIsPressCertified],
    ['signal-loom-paper-crop-marks', metadata.marks.cropMarks],
    ['signal-loom-paper-registration-marks', metadata.marks.registrationMarks],
    ['signal-loom-paper-color-bars', metadata.marks.colorBars],
    ['signal-loom-paper-slug-area-mm', metadata.marks.slugAreaMm],
    ['signal-loom-paper-job-name', metadata.jobInfo.jobName],
    ['signal-loom-paper-job-number', metadata.jobInfo.jobNumber],
    ['signal-loom-paper-client', metadata.jobInfo.client],
    ['signal-loom-paper-author', metadata.jobInfo.author],
    ['signal-loom-paper-job-notes', metadata.jobInfo.notes],
  ];

  return entries
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([name, value]) => `<meta name="${name}" content="${escapeHtml(String(value))}" />`)
    .join('\n');
}

export function serializePaperDocument(doc: PaperDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

type LegacyPaperFrameAsset = PaperFrameAsset & { src?: unknown };
type LegacyPaperImportedFont = Partial<PaperImportedFont> & {
  assetRef?: unknown;
  dataBase64?: unknown;
};

function sanitizeParsedPaperFrameAsset(value: unknown): PaperFrameAsset | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const asset = value as LegacyPaperFrameAsset;
  const { src: _legacySource, locator, ...metadata } = asset;
  if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
    return metadata as PaperFrameAsset;
  }

  const candidate = locator as Record<string, unknown>;
  if (candidate.kind === 'managed' && isBinaryAssetRef(candidate.ref)) {
    return { ...metadata, locator: { kind: 'managed', ref: candidate.ref } } as PaperFrameAsset;
  }
  if (
    candidate.kind === 'external'
    && typeof candidate.url === 'string'
    && !/^(?:data:|blob:)/i.test(candidate.url)
  ) {
    return { ...metadata, locator: { kind: 'external', url: candidate.url } } as PaperFrameAsset;
  }

  return metadata as PaperFrameAsset;
}

function sanitizeParsedPaperImportedFonts(value: unknown): PaperImportedFont[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const font = entry as LegacyPaperImportedFont;
    if (isBinaryAssetRef(font.fontAsset)) {
      const { dataBase64: _legacyBytes, assetRef: _legacyAssetRef, fontAsset, ...metadata } = font;
      return [{ ...metadata, fontAsset } as PaperImportedFont];
    }
    // Keep a reference-only historical record until its restore boundary converts it to a modern managed
    // face. Inline bytes deliberately remain rejected here.
    if (!isBinaryAssetRef(font.assetRef)) return [];
    const { dataBase64: _legacyBytes, ...legacyMetadata } = font;
    return [legacyMetadata as unknown as PaperImportedFont];
  });
}

/** Keeps only typed managed ICC metadata; profile bytes always stay in the asset repository. */
function sanitizeParsedPaperManagedIccProfiles(value: unknown): PaperManagedIccProfile[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry) => {
    if (!isPaperManagedIccProfile(entry)) return [];
    return [{
      id: entry.id,
      asset: { ...entry.asset },
      description: entry.description,
      deviceClass: entry.deviceClass,
      colorSpace: entry.colorSpace,
      pcs: entry.pcs,
      outputConditionId: entry.outputConditionId,
      ...(entry.registryName ? { registryName: entry.registryName } : {}),
      source: { ...entry.source },
    }];
  });
}

/** Keep semantic language metadata small and usable by PDF readers. */
export function normalizePaperAccessibility(value: unknown): PaperDocument['accessibility'] {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<PaperDocument['accessibility']>).language
    : undefined;
  const language = typeof candidate === 'string' ? candidate.trim().replace(/_/g, '-').toLowerCase() : '';
  return {
    language: /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language) && language.length <= 35 ? language : 'en',
  };
}

function sanitizeParsedPaperFrame(frame: PaperFrame, layers: readonly { id: string }[]): PaperFrame {
  const validLayerIds = new Set(layers.map((layer) => layer.id));
  const layerId = frame.layerId && validLayerIds.has(frame.layerId)
    ? frame.layerId
    : layers[0]?.id ?? PAPER_DEFAULT_LAYER_ID;
  return createPaperFrame({
    ...frame,
    layerId,
    asset: sanitizeParsedPaperFrameAsset(frame.asset),
    kind: frame.kind,
    xMm: frame.xMm,
    yMm: frame.yMm,
    widthMm: frame.widthMm,
    heightMm: frame.heightMm,
  });
}

export function parsePaperDocument(json: string): PaperDocument {
  const parsed = JSON.parse(json) as PaperDocument;
  if (!parsed || !Array.isArray(parsed.pages) || !parsed.page) {
    throw new Error('The selected file is not a Sloom Studio Paper document.');
  }
  const pageSpec = normalizePageSpec(parsed.page);
  const layers = normalizePaperLayers(parsed.layers);
  return {
    ...parsed,
    page: pageSpec,
    accessibility: normalizePaperAccessibility(parsed.accessibility),
    layout: {
      ...parsed.layout,
      baselineGrid: parsed.layout?.baselineGrid ?? { startMm: 12.7, incrementMm: 4.6 },
    },
    view: {
      showRulers: parsed.view?.showRulers ?? true,
      showGrid: parsed.view?.showGrid ?? true,
      showBaselineGrid: parsed.view?.showBaselineGrid ?? false,
      showGuides: parsed.view?.showGuides ?? true,
      showTextBaselines: parsed.view?.showTextBaselines ?? false,
      showFrameEdges: parsed.view?.showFrameEdges ?? false,
      showBleed: parsed.view?.showBleed ?? true,
      showSpreads: parsed.view?.showSpreads ?? false,
      startOnRight: parsed.view?.startOnRight ?? true,
      // Preserve undefined ('auto'); only a saved true/false pins the binding explicitly.
      rtlBinding: parsed.view?.rtlBinding,
      snapToGuides: parsed.view?.snapToGuides ?? false,
      snapToGrid: parsed.view?.snapToGrid ?? false,
    },
    printProduction: normalizePaperPrintProductionSpec(parsed.printProduction),
    layers,
    parentPages: Array.isArray(parsed.parentPages)
      ? parsed.parentPages.map((parent) => ({
        ...parent,
        frames: Array.isArray(parent.frames) ? parent.frames.map((frame) => sanitizeParsedPaperFrame(frame, layers)) : [],
      }))
      : [createPaperParentPage('A-Parent', pageSpec)],
    styles: normalizePaperStyles(parsed.styles),
    textVariables: normalizePaperTextVariables(parsed.textVariables),
    textConditions: normalizePaperTextConditions(parsed.textConditions),
    dataMerge: normalizePaperDataMergeSource(parsed.dataMerge),
    anchoredObjects: normalizePaperAnchoredObjects(parsed.anchoredObjects),
    publicationReferences: normalizePaperPublicationReferences(parsed.publicationReferences),
    trackChanges: normalizePaperTrackChanges(parsed.trackChanges),
    importedFonts: sanitizeParsedPaperImportedFonts(parsed.importedFonts),
    managedIccProfiles: sanitizeParsedPaperManagedIccProfiles(parsed.managedIccProfiles),
    reviewComments: sanitizePaperReviewComments(parsed.reviewComments),
    authoredNotes: normalizePaperAuthoredNotes(parsed.authoredNotes),
    pages: parsed.pages.map((page) => ({
      ...page,
      parentPageId: page.parentPageId,
      frames: Array.isArray(page.frames) ? page.frames.map((frame) => sanitizeParsedPaperFrame(frame, layers)) : [],
      guides: Array.isArray(page.guides) ? page.guides : defaultGuidesForPage(pageSpec),
    })),
  };
}

export function paperDocumentBackgroundCss(background: Partial<PaperBackgroundSpec> | undefined): string {
  const normalized = normalizePaperBackground(background);
  if (normalized.type === 'linear-gradient') {
    return `linear-gradient(${normalized.angleDeg}deg, ${normalized.fromColor}, ${normalized.toColor})`;
  }
  if (normalized.type === 'radial-gradient') {
    return `radial-gradient(${normalized.radialShape}, ${normalized.fromColor}, ${normalized.toColor})`;
  }
  return normalized.color;
}

function normalizePaperBackground(background: Partial<PaperBackgroundSpec> | undefined): PaperBackgroundSpec {
  const merged = {
    ...DEFAULT_PAPER_BACKGROUND,
    ...background,
  };
  const type = isPaperBackgroundType(merged.type) ? merged.type : DEFAULT_PAPER_BACKGROUND.type;

  return {
    type,
    color: normalizeCssColor(merged.color, DEFAULT_PAPER_BACKGROUND.color),
    fromColor: normalizeCssColor(merged.fromColor, DEFAULT_PAPER_BACKGROUND.fromColor),
    toColor: normalizeCssColor(merged.toColor, DEFAULT_PAPER_BACKGROUND.toColor),
    angleDeg: normalizeBackgroundAngle(merged.angleDeg),
    radialShape: merged.radialShape === 'circle' ? 'circle' : 'ellipse',
  };
}

function normalizePaperStyles(styles: PaperStyleCatalogs | undefined): PaperStyleCatalogs {
  return {
    paragraph: mergeStyles(DEFAULT_PAPER_STYLES.paragraph, styles?.paragraph),
    character: mergeStyles(DEFAULT_PAPER_STYLES.character, styles?.character),
    object: mergeStyles(DEFAULT_PAPER_STYLES.object, styles?.object),
    grepStyleRules: normalizePaperGrepStyleRules(styles?.grepStyleRules),
    nestedStyleSteps: normalizePaperNestedStyleSteps(styles?.nestedStyleSteps),
  };
}

function mergeStyles<T extends { id: string }>(defaults: T[], styles: T[] | undefined): T[] {
  const byId = new Map(defaults.map((style) => [style.id, style]));
  for (const style of styles ?? []) byId.set(style.id, { ...byId.get(style.id), ...style });
  return [...byId.values()];
}

function resolveParagraphStyle(styles: PaperStyleCatalogs, styleId: string | undefined): PaperParagraphStyle | undefined {
  return resolveStyle(styles.paragraph, styleId);
}

function resolveCharacterStyle(styles: PaperStyleCatalogs, styleId: string | undefined): PaperCharacterStyle | undefined {
  return resolveStyle(styles.character, styleId);
}

function resolveObjectStyle(styles: PaperStyleCatalogs, styleId: string | undefined): PaperObjectStyle | undefined {
  return resolveStyle(styles.object, styleId);
}

function resolveStyle<T extends { id: string; basedOnId?: string }>(styles: T[], styleId: string | undefined, seen = new Set<string>()): T | undefined {
  if (!styleId || seen.has(styleId)) return undefined;
  const style = styles.find((candidate) => candidate.id === styleId);
  if (!style) return undefined;
  if (!style.basedOnId) return style;
  seen.add(styleId);
  const base = resolveStyle(styles, style.basedOnId, seen);
  if (!base) return style;
  if ('typography' in style) {
    const baseTypography = (base as unknown as PaperParagraphStyle | PaperCharacterStyle).typography;
    const styleTypography = (style as unknown as PaperParagraphStyle | PaperCharacterStyle).typography;
    return { ...base, ...style, typography: { ...baseTypography, ...styleTypography } } as T;
  }
  if ('frame' in style) {
    const baseFrame = (base as unknown as PaperObjectStyle).frame;
    const styleFrame = (style as unknown as PaperObjectStyle).frame;
    return { ...base, ...style, frame: { ...baseFrame, ...styleFrame } } as T;
  }
  return { ...base, ...style };
}

function pickObjectStyleFrame(frame: PaperFrame): PaperObjectStyle['frame'] {
  return {
    fillColor: frame.fillColor,
    fillTintPercent: frame.fillTintPercent,
    fillOpacity: frame.fillOpacity,
    fillGradient: frame.fillGradient,
    strokeColor: frame.strokeColor,
    strokeTintPercent: frame.strokeTintPercent,
    strokeOpacity: frame.strokeOpacity,
    strokeWidthMm: frame.strokeWidthMm,
    strokeStyle: frame.strokeStyle,
    cornerRadiusMm: frame.cornerRadiusMm,
    opacity: frame.opacity,
    textBoxXPercent: frame.textBoxXPercent,
    textBoxYPercent: frame.textBoxYPercent,
    textBoxWidthPercent: frame.textBoxWidthPercent,
    textBoxHeightPercent: frame.textBoxHeightPercent,
    textVerticalAlign: frame.textVerticalAlign,
  };
}

function createPaperFrame(frame: PaperFrameDraft): PaperFrame {
  const kind = normalizePaperFrameKind(frame.kind);
  const label = frame.label ?? defaultFrameLabel(kind);
  const textBox = resolvePaperTextBox({
    kind,
    textBoxXPercent: frame.textBoxXPercent,
    textBoxYPercent: frame.textBoxYPercent,
    textBoxWidthPercent: frame.textBoxWidthPercent,
    textBoxHeightPercent: frame.textBoxHeightPercent,
    textRotationDeg: frame.textRotationDeg,
    textVerticalAlign: frame.textVerticalAlign,
  });

  // Inline rich text (optional). When present it is authoritative and `text` is kept as its flattened
  // plaintext, so every plain-text consumer (search, threading, legacy export) still works unchanged.
  const richText = frame.richText ? normalizePaperRichText(frame.richText) : undefined;

  // Keep this construction exhaustive: `PaperFrameDraft` accepts every persisted PaperFrame field, and
  // normalizing a loaded frame must never silently discard an authored optional control.
  return {
    id: frame.id ?? makeId('frame'),
    kind,
    label,
    xMm: frame.xMm,
    yMm: frame.yMm,
    widthMm: frame.widthMm,
    heightMm: frame.heightMm,
    rotationDeg: frame.rotationDeg ?? 0,
    locked: frame.locked ?? false,
    layerId: frame.layerId ?? PAPER_DEFAULT_LAYER_ID,
    text: richText ? flattenPaperRichText(richText) : (frame.text ?? defaultTextForKind(kind)),
    altText: typeof frame.altText === 'string' && frame.altText.trim()
      ? frame.altText.trim().replace(/\s+/g, ' ').slice(0, 1000)
      : undefined,
    generatedMediaPrompt: typeof frame.generatedMediaPrompt === 'string' && frame.generatedMediaPrompt.trim()
      ? frame.generatedMediaPrompt.trim()
      : undefined,
    richText,
    asset: frame.asset,
    fit: frame.fit ?? 'contain',
    imageScale: frame.imageScale ?? 1,
    imageOffsetXPercent: frame.imageOffsetXPercent ?? 0,
    imageOffsetYPercent: frame.imageOffsetYPercent ?? 0,
    imageRotationDeg: frame.imageRotationDeg ?? 0,
    imageFlipX: frame.imageFlipX ?? false,
    imageFlipY: frame.imageFlipY ?? false,
    // Default to a single column so body text vectorizes (real embedded, selectable type in PDF/X) by
    // default — matching InDesign/Affinity. Multi-column is still available on demand (it rasterizes, since
    // the linear vector-text engine doesn't flow columns).
    columns: frame.columns ?? 1,
    columnGutterMm: frame.columnGutterMm,
    columnRule: frame.columnRule,
    columnBalance: frame.columnBalance,
    threadId: frame.threadId,
    threadOrder: frame.threadOrder,
    // Normalize the font stack for print determinism: strip `system-ui` (resolves differently in the
    // export raster than the editor) down to a concrete installed chain, so editor and export match.
    typography: { ...DEFAULT_PAPER_TYPOGRAPHY, ...frame.typography, fontFamily: resolvePaperFontFamily(frame.typography?.fontFamily) },
    fillColor: frame.fillColor ?? defaultFillForKind(kind),
    fillSwatchId: frame.fillSwatchId,
    fillTintPercent: normalizePaperTintPercent(frame.fillTintPercent),
    fillOpacity: frame.fillOpacity ?? 1,
    fillGradient: frame.fillGradient,
    // A plain text frame is a document paragraph — borderless by default, like Word/InDesign body text. Comic
    // kinds (panel/caption/bubble) keep their visible stroke. The non-printing "Frame Edges" view toggle keeps
    // borderless frames easy to see/grab. (Only affects NEW frames; saved frames store explicit values.)
    // A barcode frame's stroke colour is the bar-ink reference. Its default width is zero so no
    // frame border surrounds the symbol.
    strokeColor: frame.strokeColor ?? (kind === 'text' ? 'transparent' : kind === 'barcode' ? '#000000' : '#111827'),
    strokeSwatchId: frame.strokeSwatchId,
    strokeTintPercent: normalizePaperTintPercent(frame.strokeTintPercent),
    strokeOpacity: frame.strokeOpacity ?? 1,
    strokeWidthMm: frame.strokeWidthMm ?? (kind === 'image' ? 0.2 : kind === 'text' || kind === 'barcode' ? 0 : 0.35),
    strokeStyle: frame.strokeStyle ?? 'solid',
    cornerRadiusMm: frame.cornerRadiusMm ?? defaultCornerRadiusForKind(kind),
    opacity: frame.opacity ?? 1,
    textBoxXPercent: textBox.xPercent,
    textBoxYPercent: textBox.yPercent,
    textBoxWidthPercent: textBox.widthPercent,
    textBoxHeightPercent: textBox.heightPercent,
    textRotationDeg: textBox.rotationDeg,
    textVerticalAlign: textBox.verticalAlign,
    textStrokeColor: frame.textStrokeColor,
    textStrokeWidthMm: frame.textStrokeWidthMm,
    textShadowColor: frame.textShadowColor,
    textShadowOffsetXMm: frame.textShadowOffsetXMm,
    textShadowOffsetYMm: frame.textShadowOffsetYMm,
    textShadowBlurMm: frame.textShadowBlurMm,
    textSkewXDeg: frame.textSkewXDeg,
    textSkewYDeg: frame.textSkewYDeg,
    textScaleX: frame.textScaleX,
    textScaleY: frame.textScaleY,
    textArcPercent: frame.textArcPercent,
    bubbleShape: frame.bubbleShape ?? (kind === 'speechBubble' ? 'organic' : kind === 'thoughtBubble' ? 'cloud' : undefined),
    bubbleWarp: frame.bubbleWarp ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 0.18 : undefined),
    bubbleWarpLeft: frame.bubbleWarpLeft,
    bubbleWarpRight: frame.bubbleWarpRight,
    bubbleWarpTop: frame.bubbleWarpTop,
    bubbleWarpBottom: frame.bubbleWarpBottom,
    bubblePinchXPercent: frame.bubblePinchXPercent ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 58 : undefined),
    bubblePinchYPercent: frame.bubblePinchYPercent ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 75 : undefined),
    bubbleTailWidthPercent: frame.bubbleTailWidthPercent ?? (kind === 'speechBubble' ? 18 : kind === 'thoughtBubble' ? 12 : undefined),
    bubbleTailCurvePercent: frame.bubbleTailCurvePercent ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 55 : undefined),
    bubbleChainId: frame.bubbleChainId,
    bubbleChainOrder: frame.bubbleChainOrder,
    bubbleConnectorStyle: frame.bubbleConnectorStyle,
    bubbleConnectorAnchor: frame.bubbleConnectorAnchor,
    bubbleConnectorGeometry: sanitizePaperBubbleConnectorGeometry(frame.bubbleConnectorGeometry),
    comicSfxDesign: frame.comicSfxDesign,
    shapeKind: frame.shapeKind ?? (kind === 'shape' ? 'triangle' : undefined),
    vertices: frame.vertices ?? defaultVerticesForKind(kind, frame.shapeKind),
    textWrap: sanitizePaperTextWrap(frame.textWrap),
    table: frame.table ? normalizePaperTable(frame.table) : undefined,
    barcode: normalizeBarcodeField(kind, frame.barcode),
    hyperlink: typeof frame.hyperlink === 'string' && frame.hyperlink.trim() ? frame.hyperlink.trim() : undefined,
    tailXPercent: frame.tailXPercent ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 72 : undefined),
    tailYPercent: frame.tailYPercent ?? (kind === 'speechBubble' || kind === 'thoughtBubble' ? 92 : undefined),
    zIndex: frame.zIndex ?? 0,
    paragraphStyleId: frame.paragraphStyleId,
    characterStyleId: frame.characterStyleId,
    objectStyleId: frame.objectStyleId,
    parentPageId: frame.parentPageId,
    parentFrameId: frame.parentFrameId,
    inherited: frame.inherited ?? false,
  } satisfies ExhaustivePaperFrameKeys;
}

function sanitizePaperBubbleConnectorGeometry(
  value: PaperFrame['bubbleConnectorGeometry'],
): PaperFrame['bubbleConnectorGeometry'] {
  if (!value || typeof value !== 'object') return undefined;
  const required = [
    value.fromAngleDeg,
    value.toAngleDeg,
    value.control1AlongPercent,
    value.control1OffsetPercent,
    value.control2AlongPercent,
    value.control2OffsetPercent,
    value.widthMm,
    value.taperPercent,
  ];
  if (required.some((candidate) => typeof candidate !== 'number' || !Number.isFinite(candidate))) return undefined;
  const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;
  const bounded = (candidate: number, min: number, max: number) => Math.max(min, Math.min(max, candidate));
  return {
    fromAngleDeg: normalizeAngle(value.fromAngleDeg),
    toAngleDeg: normalizeAngle(value.toAngleDeg),
    control1AlongPercent: bounded(value.control1AlongPercent, -50, 150),
    control1OffsetPercent: bounded(value.control1OffsetPercent, -100, 100),
    control2AlongPercent: bounded(value.control2AlongPercent, -50, 150),
    control2OffsetPercent: bounded(value.control2OffsetPercent, -100, 100),
    widthMm: bounded(value.widthMm, 0.8, 50),
    taperPercent: bounded(value.taperPercent, 0, 100),
  };
}

function normalizePaperFrameKind(kind: unknown): PaperFrameKind {
  switch (kind) {
    case 'speech':
      return 'speechBubble';
    case 'thought':
      return 'thoughtBubble';
    case 'text':
    case 'image':
    case 'document':
    case 'speechBubble':
    case 'thoughtBubble':
    case 'caption':
    case 'panel':
    case 'shape':
    case 'barcode':
      return kind;
    default:
      return 'text';
  }
}

function normalizeBarcodeField(kind: PaperFrameKind, value: unknown): PaperFrame['barcode'] {
  const sanitized = normalizePaperBarcodeSpec(value);
  if (sanitized) return sanitized;
  return kind === 'barcode'
    ? { symbology: 'ean13', value: '', showHumanReadable: true }
    : undefined;
}

function placeAssetInFrame(frame: PaperFrame, item: SourceBinLibraryItem): PaperFrame {
  if ((item.kind === 'text' || item.kind === 'document') && ['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind) && item.text) {
    return {
      ...frame,
      text: item.text ?? item.label,
      asset: {
        ...buildPaperFrameAssetFromSourceItem(item),
        text: item.text,
      },
    };
  }

  if (item.kind === 'image') {
    const imageMetadata = item as SourceBinLibraryItem & Partial<{
      pixelWidth: number;
      pixelHeight: number;
      widthPx: number;
      heightPx: number;
      width: number;
      height: number;
    }>;
    return {
      ...frame,
      kind: frame.kind === 'panel' ? 'image' : frame.kind,
      label: frame.label || item.label,
      asset: {
        ...buildPaperFrameAssetFromSourceItem(item),
        pixelWidth: firstPositiveNumber(imageMetadata.pixelWidth, imageMetadata.widthPx, imageMetadata.width),
        pixelHeight: firstPositiveNumber(imageMetadata.pixelHeight, imageMetadata.heightPx, imageMetadata.height),
      },
    };
  }

  if (item.kind === 'document') {
    return {
      ...frame,
      kind: frame.kind === 'image' || frame.kind === 'panel' ? 'document' : frame.kind,
      label: frame.label || item.label,
      text: item.text ?? frame.text,
      asset: {
        ...buildPaperFrameAssetFromSourceItem(item),
        text: item.text,
        // A filename is a legacy fallback only. Never persist `format: pdf` for a proven image
        // replacement whose old Source Library label happened to retain a .pdf suffix.
        format: isPaperPdfMimeType(item.mimeType?.split(';', 1)[0]?.trim().toLowerCase()) ? 'pdf' : undefined,
      },
    };
  }

  return frame;
}

function firstPositiveNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function renderPrintPage(
  doc: PaperDocument,
  page: PaperPage,
  pageSpec: PaperPageSpec,
  options: {
    resolveAssetUrl?: (frame: PaperFrame) => string | undefined;
    bleedBoxLeftMm: number;
    bleedBoxTopMm: number;
    bleedBoxWidthMm: number;
    bleedBoxHeightMm: number;
    pageOffsetMm: number;
    printSheet?: PaperPrintSheetPlan;
  },
): string {
  const outputFrames = resolvePaperThreadedFrames(
    resolvePaperFramesTextTemplates(resolvePaperPageFramesForOutput(doc, page), doc, page.pageNumber),
    createPaperCanvasMeasurer(),
  );
  const connectors = renderPrintBubbleConnectors(outputFrames, pageSpec);
  const compoundBubbleFrameIds = getPaperCompoundBubbleFrameIds(outputFrames);
  // The live canvas maps the document's relative z-order into a positive local stacking context. Print HTML
  // must do the same: inherited parent-page frames deliberately carry very low document z-indexes, and a raw
  // negative CSS z-index puts them behind the opaque page background instead of beneath local page artwork.
  const frames = buildPaperCanvasFrameLayers(outputFrames)
    .map(({ frame, canvasZIndex }) => ({ ...frame, zIndex: canvasZIndex }))
    .map((frame) => renderPrintFrame(doc, frame, options.resolveAssetUrl, {
      suppressBubbleShape: compoundBubbleFrameIds.has(frame.id),
    }))
    .join('\n');
  const authoredNotes = renderPaperAuthoredNotes(doc, page);
  const productionMarks = renderPaperProductionMarksHtml(options.printSheet);

  return `<section class="paper-sheet" data-page="${page.pageNumber}" data-trim-width="${formatMm(pageSpec.widthMm)}" data-trim-height="${formatMm(pageSpec.heightMm)}" data-bleed="${formatMm(pageSpec.bleedMm)}" data-bleed-box="${formatMm(options.bleedBoxLeftMm)} ${formatMm(options.bleedBoxTopMm)} ${formatMm(options.bleedBoxWidthMm)} ${formatMm(options.bleedBoxHeightMm)}">
<div class="paper-bleed">
<div class="paper-page">
${connectors}
${frames}
${authoredNotes}
</div>
</div>
${productionMarks}
</section>`;
}

function renderPaperAuthoredNotes(doc: PaperDocument, page: PaperPage): string {
  const footnotes = getPaperAuthoredNotesForPage(doc, page.id, 'footnote');
  const endnotes = page.pageNumber === doc.pages.length
    // Endnotes are collected at the end of the document even when their reference is on an
    // earlier page. The stored page/frame remains the source anchor for editing and numbering.
    ? normalizePaperAuthoredNotes(doc.authoredNotes).filter((note) => note.kind === 'endnote')
    : [];
  const notes = [...footnotes, ...endnotes];
  if (!notes.length) return '';
  const entries = notes.map((note) => {
    const number = paperAuthoredNoteNumber(doc, note);
    const typeLabel = note.kind === 'footnote' ? 'Footnote' : 'Endnote';
    return `<div class="paper-authored-note" data-paper-note-id="${escapeHtml(note.id)}" data-paper-note-kind="${note.kind}"><sup>${number}</sup> <strong>${typeLabel}</strong> ${escapeHtml(note.body)}</div>`;
  }).join('\n');
  const left = doc.layout.marginsMm.left;
  const width = Math.max(25, doc.page.widthMm - doc.layout.marginsMm.left - doc.layout.marginsMm.right);
  const maxHeight = Math.max(8, Math.min(doc.page.heightMm * 0.3, 80));
  return `<aside class="paper-authored-notes" data-paper-authored-notes="true" style="position:absolute;left:${formatMm(left)};bottom:${formatMm(doc.layout.marginsMm.bottom)};width:${formatMm(width)};max-height:${formatMm(maxHeight)}mm;overflow:hidden;border-top:0.2mm solid #6b7280;padding-top:1.5mm;font:7.5pt/1.25 ${PAPER_SAFE_SANS};color:#111827;white-space:pre-wrap;">${entries}</aside>`;
}

function renderPaperProductionMarksHtml(sheet: PaperPrintSheetPlan | undefined): string {
  if (!sheet || (!sheet.cropMarks.length && !sheet.registrationMarks.length && !sheet.colorBars.length && !sheet.slugBox)) return '';
  const cropLines = sheet.cropMarks.map((mark) => (
    `<line data-production-mark="${escapeHtml(mark.id)}" x1="${mark.x1Pt}" y1="${mark.y1TopPt}" x2="${mark.x2Pt}" y2="${mark.y2TopPt}" stroke="#000000" stroke-width="${mark.strokeWidthPt}" />`
  )).join('\n');
  const registrationMarks = sheet.registrationMarks.map((mark) => [
    `<circle data-production-mark="${escapeHtml(mark.id)}:circle" data-registration-cmyk="1 1 1 1" cx="${mark.centerXPt}" cy="${mark.centerYTopPt}" r="${mark.radiusPt}" fill="none" stroke="#111111" stroke-width="${mark.strokeWidthPt}" />`,
    `<line data-production-mark="${escapeHtml(mark.id)}:horizontal" x1="${mark.centerXPt - mark.crossArmPt}" y1="${mark.centerYTopPt}" x2="${mark.centerXPt + mark.crossArmPt}" y2="${mark.centerYTopPt}" stroke="#111111" stroke-width="${mark.strokeWidthPt}" />`,
    `<line data-production-mark="${escapeHtml(mark.id)}:vertical" x1="${mark.centerXPt}" y1="${mark.centerYTopPt - mark.crossArmPt}" x2="${mark.centerXPt}" y2="${mark.centerYTopPt + mark.crossArmPt}" stroke="#111111" stroke-width="${mark.strokeWidthPt}" />`,
  ].join('\n')).join('\n');
  const colorBars = sheet.colorBars.map((patch) => (
    `<rect data-production-mark="${escapeHtml(patch.id)}" data-process-cmyk="${patch.cmyk.c} ${patch.cmyk.m} ${patch.cmyk.y} ${patch.cmyk.k}" x="${patch.rect.xPt}" y="${patch.rect.yTopPt}" width="${patch.rect.widthPt}" height="${patch.rect.heightPt}" fill="${paperCmykPreviewCss(patch.cmyk)}" />`
  )).join('\n');
  const svgContent = `${cropLines}${registrationMarks}${colorBars}`;
  const svg = svgContent
    ? `<svg class="paper-production-marks" aria-hidden="true" viewBox="0 0 ${sheet.mediaBox.widthPt} ${sheet.mediaBox.heightPt}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;">${svgContent}</svg>`
    : '';
  const slug = sheet.slugBox
    ? `<div class="paper-slug-area" data-slug-area-mm="${paperPointsToMm(sheet.slugBox.heightPt)}" style="position:absolute;left:${formatMm(paperPointsToMm(sheet.slugBox.xPt))};top:${formatMm(paperPointsToMm(sheet.slugBox.yTopPt))};width:${formatMm(paperPointsToMm(sheet.slugBox.widthPt))};height:${formatMm(paperPointsToMm(sheet.slugBox.heightPt))};overflow:hidden;padding:1.5mm 0;box-sizing:border-box;font:7pt/1.25 Arial,sans-serif;color:#111111;white-space:pre-wrap;pointer-events:none;">${escapeHtml(sheet.slugText ?? '')}</div>`
    : '';
  return `${svg}${slug}`;
}

function paperCmykPreviewCss(color: { c: number; m: number; y: number; k: number }): string {
  const channel = (primary: number, black: number) => Math.round(255 * (1 - Math.min(1, primary)) * (1 - Math.min(1, black)));
  return `rgb(${channel(color.c, color.k)}, ${channel(color.m, color.k)}, ${channel(color.y, color.k)})`;
}

export function renderPrintBubbleConnectors(frames: PaperFrame[], pageSpec: PaperPageSpec): string {
  const connectorLayers = buildPaperCanvasBubbleConnectorLayers(frames);
  if (!connectorLayers.length) return '';
  const framesById = new Map(frames.map((frame) => [frame.id, frame]));
  const compoundFallbackIds = new Set(getPaperBubbleCompoundFallbackSegments(frames).map((segment) => segment.id));

  return connectorLayers.map(({ canvasZIndex, compoundShapes, segments }) => {
    const compoundBody = compoundShapes.map((shape) => {
      const sourceFrame = framesById.get(shape.sourceFrameId);
      const dasharray = paperBubbleCompoundStrokeDasharray(sourceFrame?.strokeStyle);
      const dashAttribute = dasharray ? ` stroke-dasharray="${dasharray}"` : '';
      return `<path data-paper-bubble-compound-id="${escapeHtml(shape.id)}" data-paper-bubble-compound-members="${escapeHtml(shape.memberFrameIds.join(' '))}" d="${escapeHtml(shape.path)}" fill="${escapeHtml(sourceFrame?.fillColor ?? '#ffffff')}" fill-opacity="${clampUnit(sourceFrame?.fillOpacity ?? 1)}" stroke="${escapeHtml(sourceFrame?.strokeColor ?? '#111827')}" stroke-opacity="${clampUnit(sourceFrame?.strokeOpacity ?? 1)}" stroke-width="${formatSvgNumber(Math.max(0.25, sourceFrame?.strokeWidthMm ?? 0.35))}"${dashAttribute} stroke-linejoin="round" />`;
    }).join('\n');
    const segmentBody = segments.map((segment) => {
      const fromFrame = framesById.get(segment.fromFrameId);
      const stroke = escapeHtml(fromFrame?.strokeColor ?? '#111827');
      const strokeWidth = Math.max(0.25, fromFrame?.strokeWidthMm ?? 0.35);
      const connectorData = `data-paper-bubble-connector-id="${escapeHtml(segment.id)}" data-paper-bubble-connector-style="${segment.style}"`;
      if (segment.style === 'bridge') {
        const points = segment.bridgePolygon
          .map((point) => `${formatSvgNumber(point.xMm)},${formatSvgNumber(point.yMm)}`)
          .join(' ');
        const fallbackData = compoundFallbackIds.has(segment.id) ? ' data-paper-bubble-compound-fallback="true"' : '';
        const dasharray = paperBubbleCompoundStrokeDasharray(fromFrame?.strokeStyle);
        const dashAttribute = dasharray ? ` stroke-dasharray="${dasharray}"` : '';
        return `<polygon ${connectorData}${fallbackData} points="${points}" fill="${escapeHtml(fromFrame?.fillColor ?? '#ffffff')}" fill-opacity="${clampUnit(fromFrame?.fillOpacity ?? 1)}" stroke="${stroke}" stroke-width="${formatSvgNumber(strokeWidth)}"${dashAttribute} stroke-linejoin="round" />`;
      }
      if (segment.style === 'thought-dots') {
        return `<g ${connectorData}>${segment.dots.map((dot, index) => (
          `<circle cx="${formatSvgNumber(dot.xMm)}" cy="${formatSvgNumber(dot.yMm)}" r="${formatSvgNumber(Math.max(0.8, strokeWidth * (2.6 - index * 0.18)))}" fill="${stroke}" opacity="0.88" />`
        )).join('\n')}</g>`;
      }
      if (segment.style === 'tail') {
        return `<path ${connectorData} d="M ${formatSvgNumber(segment.from.xMm)} ${formatSvgNumber(segment.from.yMm)} Q ${formatSvgNumber(segment.control.xMm)} ${formatSvgNumber(segment.control.yMm)} ${formatSvgNumber(segment.to.xMm)} ${formatSvgNumber(segment.to.yMm)}" fill="none" stroke="${stroke}" stroke-width="${formatSvgNumber(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" />`;
      }
      return `<line ${connectorData} x1="${formatSvgNumber(segment.from.xMm)}" y1="${formatSvgNumber(segment.from.yMm)}" x2="${formatSvgNumber(segment.to.xMm)}" y2="${formatSvgNumber(segment.to.yMm)}" stroke="${stroke}" stroke-width="${formatSvgNumber(strokeWidth)}" stroke-linecap="round" />`;
    }).join('\n');
    const body = [compoundBody, segmentBody].filter(Boolean).join('\n');

    return `<svg class="paper-bubble-connectors" data-paper-canvas-z-index="${canvasZIndex}" viewBox="0 0 ${formatSvgNumber(pageSpec.widthMm)} ${formatSvgNumber(pageSpec.heightMm)}" preserveAspectRatio="none" style="position:absolute; inset:0; overflow:visible; z-index:${canvasZIndex}; pointer-events:none;">
${body}
</svg>`;
  }).join('\n');
}

export function renderPrintFrame(
  doc: PaperDocument,
  frame: PaperFrame,
  resolveAssetUrl?: (frame: PaperFrame) => string | undefined,
  options: { suppressBubbleShape?: boolean } = {},
): string {
  frame = computeEffectivePaperFrame(doc, frame);
  const outerStyle = printFrameOuterStyle(frame);
  const baselineGrid = frame.typography.alignToBaselineGrid && frame.typography.writingMode !== 'vertical-rl'
    ? doc.layout.baselineGrid
    : undefined;
  const contentStyle = printFrameContentStyle(frame, baselineGrid);
  const assetUrl = resolveAssetUrl?.(frame)
    ?? resolvePaperFrameAssetUrl(frame.asset)
    ?? (frame.comicSfxDesign ? paperComicSfxDesignToDataUrl(frame.comicSfxDesign) : undefined);

  if (frame.kind === 'shape') {
    return renderPrintShapeFrame(outerStyle, frame);
  }

  if (frame.kind === 'barcode') {
    return renderPrintBarcodeFrame(outerStyle, frame);
  }

  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') {
    const bubbleVertical = frame.typography.writingMode === 'vertical-rl';
    const bubbleText = renderPrintFrameInlineText(frame, bubbleVertical);
    const shape = options.suppressBubbleShape ? '' : renderPrintBubbleSvg(frame);
    return `<div class="frame frame-${frame.kind}" style="${escapeHtml(`${outerStyle}; background: transparent; border: 0; padding: 0;`)}">${shape}${renderPrintTextBox(frame, bubbleText, '', baselineGrid)}</div>`;
  }

  const placedPdf = classifyPaperPlacedPdf(frame);
  if (placedPdf.isPdf) {
    return `<figure class="frame frame-document" style="${escapeHtml(outerStyle)}">
  <div class="frame-content" style="${escapeHtml(contentStyle)}">${renderPrintPdfFrameContent(frame, assetUrl, placedPdf.canEmbedForLivePrint)}</div>
</figure>`;
  }

  // Replacement flows deliberately preserve frame geometry and may retain a historic document
  // label. A proven PNG/JPEG/SVG must nevertheless paint through the normal image renderer.
  if (placedPdf.isImage && assetUrl) {
    return `<figure class="frame frame-image" style="${escapeHtml(outerStyle)}">
  <div class="frame-content" style="${escapeHtml(contentStyle)}">${renderPrintImageFrameContent(frame, assetUrl)}</div>
</figure>`;
  }

  if (isShapedContentFrame(frame)) {
    return renderPrintShapedContentFrame(outerStyle, frame, assetUrl);
  }

  if (frame.kind === 'document') {
    return `<figure class="frame frame-document" style="${escapeHtml(outerStyle)}">
  <div class="frame-content" style="${escapeHtml(contentStyle)}">${renderPrintDocumentFrameContent(frame, assetUrl)}</div>
</figure>`;
  }

  if (frame.kind === 'image' && assetUrl) {
    return `<figure class="frame frame-image" style="${escapeHtml(outerStyle)}">
  <div class="frame-content" style="${escapeHtml(contentStyle)}">${renderPrintImageFrameContent(frame, assetUrl)}</div>
</figure>`;
  }

  const text = renderPrintFrameInlineText(frame, frame.typography.writingMode === 'vertical-rl');
  const columnStyle = printFrameColumnStyle(frame);

  return `<div class="frame frame-${frame.kind}" style="${escapeHtml(outerStyle)}">
  <div class="frame-content" style="${escapeHtml(`${contentStyle}; ${columnStyle}`)}"><div class="frame-text-content" style="${escapeHtml(printTextEffectInlineStyle(frame))}">${text}</div></div>
</div>`;
}

/**
 * A frame's inline text content for print/export HTML: rich runs when `richText` carries real content
 * (same gate the live canvas uses — `PaperInlineText`/`PaperRichTextView` in PaperWorkspace.tsx), otherwise
 * the flattened plain text exactly as before (byte-identical — no regression for any non-rich frame).
 */
function renderPrintFrameInlineText(frame: PaperFrame, vertical: boolean): string {
  if (frame.richText && frame.richText.length > 0) {
    return renderPrintRichParagraphs(frame, vertical);
  }
  const content = paperInlineTextToHtml(frame.text ?? frame.asset?.text ?? '', vertical, escapeHtml);
  const dropCapLines = paperFrameOwnsStoryOpening(frame)
    ? normalizedPrintDropCapLines(frame.typography.dropCapLines)
    : 0;
  return dropCapLines
    ? `<div class="paper-dropcap" style="--sl-dropcap-lines: ${dropCapLines}">${content}</div>`
    : content;
}

function normalizedPrintDropCapLines(value: number | undefined): number {
  return value && value >= 2 ? Math.min(8, Math.round(value)) : 0;
}

function paperFrameOwnsStoryOpening(frame: PaperFrame): boolean {
  return !frame.threadId || (frame.threadOrder ?? 1) <= 1;
}

const MM_PER_PT = 25.4 / 72;

/** Inline CSS for one rich-text run in print/export HTML — field-for-field mirror of `paperRunReactStyle`
 * (the live canvas render in PaperWorkspace.tsx), so a run looks identical on screen and on the exported
 * page. Only fields the run overrides are emitted; everything else inherits the frame's `textStyle`. */
function printRunInlineStyle(run: PaperTextRun): string {
  const parts: string[] = [];
  if (run.fontFamily) parts.push(`font-family: ${resolvePaperFontFamily(run.fontFamily)}`);
  if (run.fontWeight) parts.push(`font-weight: ${run.fontWeight}`);
  if (run.fontStyle) parts.push(`font-style: ${run.fontStyle}`);
  if (run.fontStretch) parts.push(`font-stretch: ${run.fontStretch}`);
  if (run.fontVariationSettings) parts.push(`font-variation-settings: ${paperFontVariationSettingsToCss(run.fontVariationSettings)}`);
  if (run.fontKerning) parts.push(`font-kerning: ${run.fontKerning}`);
  if (run.color) parts.push(`color: ${run.color}`);
  if (run.highlight) {
    parts.push(`background-color: ${run.highlight}`, 'border-radius: 1px', '-webkit-box-decoration-break: clone', 'box-decoration-break: clone');
  }
  if (run.tracking != null) parts.push(`letter-spacing: ${run.tracking / 1000}em`);
  if (run.smallCaps != null) parts.push(`font-variant-caps: ${run.smallCaps ? 'small-caps' : 'normal'}`);
  if (run.numericStyle) parts.push(`font-variant-numeric: ${paperNumericStyleToCss(run.numericStyle) ?? 'normal'}`);
  if (run.textOrientation) parts.push(`text-orientation: ${run.textOrientation}`);
  if (run.emphasis) parts.push(`text-emphasis: ${paperEmphasisMarkToCss(run.emphasis) ?? 'none'}`);
  if (run.leadingPt != null) parts.push(`line-height: ${run.leadingPt}pt`);
  const decorations: string[] = [];
  if (run.underline) decorations.push('underline');
  if (run.strike) decorations.push('line-through');
  if (decorations.length) parts.push(`text-decoration: ${decorations.join(' ')}`);
  if (run.vertAlign === 'super' || run.vertAlign === 'sub') {
    parts.push(`vertical-align: ${run.vertAlign}`);
    parts.push(`font-size: ${run.fontSizePt ? `${run.fontSizePt}pt` : '0.7em'}`);
  } else if (run.fontSizePt) {
    parts.push(`font-size: ${run.fontSizePt}pt`);
  }
  return parts.join('; ');
}

function printBorderEdgeCss(edge: PaperParagraphBorderEdge | undefined): string | undefined {
  return edge ? `${formatMm(edge.widthPt * MM_PER_PT)} solid ${edge.color}` : undefined;
}

/**
 * Render one frame's `richText` paragraphs as print/export HTML — field-for-field mirror of
 * `PaperRichTextView` (the live canvas render in PaperWorkspace.tsx): per-run style spans (bold/italic/size/
 * colour/tracking/small-caps/underline/strike/super-sub/highlight/link), per-paragraph align, space-before/
 * after, left/right/hanging/first-line indents, hanging list markers, drop caps, shading, and borders — so
 * exported PDF/PNG show exactly what the workspace shows. Only called when `frame.richText` has real content.
 */
function renderPrintRichParagraphs(frame: PaperFrame, vertical: boolean): string {
  const paragraphs = frame.richText ?? [];
  // A merged callout (every paragraph shares a border/shading) renders as ONE continuous box: the border/
  // padding apply only at the outer edges, not around every paragraph — matches PaperRichTextView exactly.
  const continuousBox = paragraphs.length > 1 && paragraphs.every((p) => p.borders || p.shading);

  return paragraphs.map((paragraph, index) => {
    const isFirstPara = index === 0;
    const isLastPara = index === paragraphs.length - 1;
    // A frame-level drop cap is an opening treatment, not a command to capitalize every paragraph.
    // Later paragraphs may still opt in explicitly, including inside a threaded continuation.
    const inheritedDropCapLines = isFirstPara && paperFrameOwnsStoryOpening(frame)
      ? frame.typography.dropCapLines
      : 0;
    const dropCapLines = normalizedPrintDropCapLines(paragraph.dropCapLines ?? inheritedDropCapLines);
    const leftIndentMm = Math.max(0, paragraph.leftIndentMm ?? 0);
    const rightIndentMm = Math.max(0, paragraph.rightIndentMm ?? 0);
    const hangingMm = Math.max(0, paragraph.hangingIndentMm ?? 0);
    const markerPadMm = paragraph.listMarker ? 4.5 : 0;
    const firstLineMm = paragraph.firstLineIndentMm ?? 0;

    // Indent priority: list bullet > hanging indent > positive first-line indent (matches the editor/canvas).
    let indentLeftMm = leftIndentMm;
    let textIndentCss: string | undefined;
    if (paragraph.listMarker) { indentLeftMm = leftIndentMm + markerPadMm; textIndentCss = `-${formatMm(markerPadMm)}`; }
    else if (hangingMm > 0) { textIndentCss = `-${formatMm(hangingMm)}`; }
    else if (firstLineMm !== 0) { textIndentCss = `${formatMm(firstLineMm)} each-line`; }

    // Paragraph borders + shading. Inside a continuous callout, top padding/stroke belongs to the first
    // paragraph only and bottom to the last, so the paragraphs read as one box (matches PaperRichTextView).
    const borders = paragraph.borders;
    const borderPadMm = borders?.paddingPt ? borders.paddingPt * MM_PER_PT : borders ? 2 : 0;
    const padTopMm = continuousBox && !isFirstPara ? 0 : borderPadMm;
    const padBottomMm = continuousBox && !isLastPara ? 0 : borderPadMm;
    const topBorder = borders && !(continuousBox && !isFirstPara) ? printBorderEdgeCss(borders.top) : undefined;
    const bottomBorder = borders && !(continuousBox && !isLastPara) ? printBorderEdgeCss(borders.bottom) : undefined;
    const leftBorder = borders ? printBorderEdgeCss(borders.left) : undefined;
    const rightBorder = borders ? printBorderEdgeCss(borders.right) : undefined;

    const style = [
      paragraph.spaceBeforeMm ? `margin-top: ${formatMm(paragraph.spaceBeforeMm)}` : '',
      paragraph.spaceAfterMm ? `margin-bottom: ${formatMm(paragraph.spaceAfterMm)}` : '',
      paragraph.align ? `text-align: ${paragraph.align}` : '',
      paragraph.alignLast && paragraph.alignLast !== 'auto' ? `text-align-last: ${paragraph.alignLast}` : '',
      paragraph.leadingPt != null ? `line-height: ${paragraph.leadingPt}pt` : '',
      paragraph.hyphenate != null ? `hyphens: ${paragraph.hyphenate ? 'auto' : 'manual'}` : '',
      paragraph.lineBreak && paragraph.lineBreak !== 'auto' ? `text-wrap-style: ${paragraph.lineBreak}` : '',
      paragraph.lineBreakStrict != null ? `line-break: ${paragraph.lineBreakStrict ? 'strict' : 'auto'}` : '',
      (indentLeftMm + borderPadMm) ? `padding-left: ${formatMm(indentLeftMm + borderPadMm)}` : '',
      (rightIndentMm + borderPadMm) ? `padding-right: ${formatMm(rightIndentMm + borderPadMm)}` : '',
      padTopMm ? `padding-top: ${formatMm(padTopMm)}` : '',
      padBottomMm ? `padding-bottom: ${formatMm(padBottomMm)}` : '',
      textIndentCss ? `text-indent: ${textIndentCss}` : '',
      paragraph.shading ? `background: ${paragraph.shading}` : '',
      topBorder ? `border-top: ${topBorder}` : '',
      leftBorder ? `border-left: ${leftBorder}` : '',
      bottomBorder ? `border-bottom: ${bottomBorder}` : '',
      rightBorder ? `border-right: ${rightBorder}` : '',
      dropCapLines ? `--sl-dropcap-lines: ${dropCapLines}` : '',
    ].filter(Boolean).join('; ');

    const hasText = paragraph.runs.some((run) => run.text.length > 0);
    const marker = paragraph.listMarker ? `<span>${escapeHtml(paragraph.listMarker)} </span>` : '';
    const runsHtml = hasText
      ? paragraph.runs.map((run) => renderPrintRichRun(run, vertical)).join('')
      : '&#160;';
    const className = dropCapLines ? ' class="paper-dropcap"' : '';

    return `<div${className} style="${escapeHtml(style)}">${marker}${runsHtml}</div>`;
  }).join('\n');
}

function renderPrintRichRun(run: PaperTextRun, vertical: boolean): string {
  const inner = paperInlineTextToHtml(run.text, vertical, escapeHtml);
  const style = printRunInlineStyle(run);
  if (run.link) {
    return `<a href="${escapeHtml(run.link)}" style="${escapeHtml(style)}">${inner}</a>`;
  }
  return style ? `<span style="${escapeHtml(style)}">${inner}</span>` : `<span>${inner}</span>`;
}

function printFrameOuterStyle(frame: PaperFrame): string {
  return [
    `left: ${formatMm(frame.xMm)}`,
    `top: ${formatMm(frame.yMm)}`,
    `width: ${formatMm(frame.widthMm)}`,
    `height: ${formatMm(frame.heightMm)}`,
    `z-index: ${frame.zIndex}`,
    `transform: rotate(${frame.rotationDeg}deg)`,
    `opacity: ${clampUnit(frame.opacity)}`,
  ].join('; ');
}

function printFrameContentStyle(frame: PaperFrame, baselineGrid?: PaperBaselineGridSpec): string {
  const contentPaddingMm = printFrameContentPaddingMm(frame);
  const baselineLeadingPt = resolvePaperBaselineLeadingPt(frame.typography.leadingPt, baselineGrid);
  const baselineTopInsetMm = resolvePaperBaselineTopInsetMm(frame.yMm + contentPaddingMm, baselineLeadingPt, baselineGrid);
  const style = [
    `position: absolute`,
    `inset: 0`,
    `overflow: hidden`,
    `background: ${frameFillCss(frame)}`,
    `border: ${formatMm(frame.strokeWidthMm)} ${frame.strokeStyle} ${colorWithOpacity(frame.strokeColor, frame.strokeOpacity)}`,
    `border-radius: ${formatMm(frame.cornerRadiusMm)}`,
    `padding: ${formatMm(contentPaddingMm)}`,
    baselineTopInsetMm ? `padding-top: ${formatMm(contentPaddingMm + baselineTopInsetMm)}` : '',
    textStyle(frame, baselineGrid),
  ];

  if (frame.kind === 'caption') {
    const verticalAlignFlex = paperTextVerticalAlignToJustifyContent(frame.textVerticalAlign);
    const vertical = frame.typography.writingMode === 'vertical-rl';
    style.push(
      'display: flex',
      'flex-direction: column',
      `justify-content: ${vertical ? 'center' : verticalAlignFlex}`,
      ...(vertical ? [`align-items: ${verticalAlignFlex}`] : []),
    );
  }

  return style.join('; ');
}

function renderPrintShapedContentFrame(
  style: string,
  frame: PaperFrame,
  assetUrl?: string,
): string {
  const clipPath = printClipPathForFrame(frame);
  const columnStyle = printFrameColumnStyle(frame);
  const innerStyle = [
    'position: absolute',
    'inset: 0',
    'overflow: hidden',
    `clip-path: ${clipPath}`,
    `background: ${frameFillCss(frame)}`,
    `padding: ${formatMm(printFrameContentPaddingMm(frame))}`,
    frame.kind === 'image' || frame.kind === 'panel' ? '' : textStyle(frame),
    columnStyle,
  ].filter(Boolean).join('; ');

  const content = frame.kind === 'image' && assetUrl
    ? renderPrintImageFrameContent(frame, assetUrl)
    : frame.kind === 'panel'
      ? ''
      : renderPrintFrameInlineText(frame, frame.typography.writingMode === 'vertical-rl');

  return `<div class="frame frame-${frame.kind}" style="${escapeHtml(`${style}; background: transparent; border: 0; overflow: visible;`)}">
  <div class="frame-content" style="${escapeHtml(innerStyle)}">${content}</div>
  ${renderPrintFrameShapeStrokeSvg(frame)}
</div>`;
}

/** Deterministic print/export SVG for one retained ISBN/EAN-13 barcode frame. */
function renderPrintBarcodeFrame(style: string, frame: PaperFrame): string {
  const geometry = buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm);
  const moduleWidthMm = geometry.moduleWidthMm > 0 ? geometry.moduleWidthMm : PAPER_EAN13_NOMINAL.totalModuleCount;
  const heightModules = formatSvgNumber(Math.max(0, frame.heightMm) / moduleWidthMm);
  const barColor = escapeHtml(frame.strokeColor);
  const plate = `<rect x="0" y="0" width="${PAPER_EAN13_NOMINAL.totalModuleCount}" height="${heightModules}" fill="${escapeHtml(svgFillForFrame(frame))}" fill-opacity="${svgFillOpacity(frame)}" />`;
  const bars = geometry.bars
    .map((bar) => `<rect x="${formatSvgNumber(bar.xMm / moduleWidthMm)}" y="0" width="${formatSvgNumber(bar.widthMm / moduleWidthMm)}" height="${formatSvgNumber(bar.heightMm / moduleWidthMm)}" fill="${barColor}" />`)
    .join('');
  const fontModules = formatSvgNumber(geometry.humanReadableFontPt * (25.4 / 72) / moduleWidthMm);
  const baselineModules = formatSvgNumber((Math.max(0, frame.heightMm) - 0.35 * geometry.moduleWidthMm) / moduleWidthMm);
  const digits = geometry.humanReadableGroups
    .map((group) => `<text x="${formatSvgNumber(group.centerMm / moduleWidthMm)}" y="${baselineModules}" text-anchor="middle" font-family="'DejaVu Sans Mono', 'Courier New', monospace" font-size="${fontModules}" fill="${barColor}">${group.text}</text>`)
    .join('');
  return `<figure class="frame frame-barcode" style="${escapeHtml(`${style}; background: transparent; border: 0;`)}">
  <svg viewBox="0 0 ${PAPER_EAN13_NOMINAL.totalModuleCount} ${heightModules}" preserveAspectRatio="none" width="100%" height="100%">
    ${plate}${bars}${digits}
  </svg>
</figure>`;
}

function renderPrintShapeFrame(style: string, frame: PaperFrame): string {
  const fill = frame.shapeKind === 'line' ? 'none' : escapeHtml(svgFillForFrame(frame));
  const stroke = escapeHtml(frame.strokeColor);
  const strokeWidth = formatMm(frame.strokeWidthMm);
  const strokeDasharray = svgDashArray(frame);
  const common = `fill="${fill}" fill-opacity="${svgFillOpacity(frame)}" stroke="${stroke}" stroke-opacity="${clampUnit(frame.strokeOpacity)}" stroke-width="${strokeWidth}" stroke-dasharray="${strokeDasharray}" vector-effect="non-scaling-stroke"`;
  let svgShape = '';

  if (frame.shapeKind === 'ellipse') {
    svgShape = `<ellipse cx="50" cy="50" rx="48" ry="48" ${common} />`;
  } else if (frame.shapeKind === 'line') {
    svgShape = `<line x1="0" y1="50" x2="100" y2="50" ${common} stroke-linecap="round" />`;
  } else {
    const shapeVertices = frame.vertices?.length
      ? frame.vertices
      : (defaultVerticesForKind('shape', frame.shapeKind) ?? []);
    const points = formatSvgPoints(shapeVertices);
    svgShape = `<polygon points="${points}" ${common} stroke-linejoin="round" />`;
  }

  return `<figure class="frame frame-shape" style="${escapeHtml(`${style}; background: transparent; border: 0;`)}">
  <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
    ${renderSvgGradientDef(frame)}
    ${svgShape}
  </svg>
</figure>`;
}

function renderPrintImageFrameContent(frame: PaperFrame, assetUrl: string): string {
  const imageStyle = buildPaperImageRenderStyle(frame);
  const style = `position: ${imageStyle.position}; width: ${imageStyle.width}; height: ${imageStyle.height}; max-width: ${imageStyle.maxWidth}; max-height: ${imageStyle.maxHeight}; left: ${imageStyle.left}; top: ${imageStyle.top}; object-fit: ${imageStyle.objectFit}; object-position: ${imageStyle.objectPosition}; transform: ${imageStyle.transform}; transform-origin: ${imageStyle.transformOrigin};`;
  return `<img alt="${escapeHtml(frame.asset?.label ?? frame.label)}" src="${escapeHtml(assetUrl)}" style="${escapeHtml(style)}" />`;
}

function renderPrintDocumentFrameContent(frame: PaperFrame, _assetUrl?: string): string {
  const label = escapeHtml(frame.asset?.label ?? frame.label);
  return `<div class="paper-document-placeholder" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:0.35mm dashed #64748b;background:#f8fafc;color:#334155;text-align:center;padding:3mm;">Linked document: ${label}</div>`;
}

function renderPrintPdfFrameContent(frame: PaperFrame, assetUrl: string | undefined, canEmbedForLivePrint: boolean): string {
  const label = escapeHtml(frame.asset?.label ?? frame.label);
  if (canEmbedForLivePrint && assetUrl) {
    return `<object data="${escapeHtml(assetUrl)}" type="application/pdf" width="100%" height="100%"><span>PDF-capable print viewer required for ${label}</span></object>`;
  }
  return `<div class="paper-document-placeholder" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;border:0.35mm dashed #64748b;background:#f8fafc;color:#334155;text-align:center;padding:3mm;">PDF asset unavailable: relink ${label} to a PDF URL before live print.</div>`;
}

function renderPrintFrameShapeStrokeSvg(frame: PaperFrame): string {
  const stroke = escapeHtml(frame.strokeColor);
  const strokeWidth = formatMm(frame.strokeWidthMm);
  const common = `fill="none" stroke="${stroke}" stroke-opacity="${clampUnit(frame.strokeOpacity)}" stroke-width="${strokeWidth}" stroke-dasharray="${svgDashArray(frame)}" vector-effect="non-scaling-stroke"`;
  let svgShape = '';

  if (isFrameShapeKindEnabled(frame) && frame.shapeKind === 'ellipse') {
    svgShape = `<ellipse cx="50" cy="50" rx="48" ry="48" ${common} />`;
  } else if (isFrameShapeKindEnabled(frame) && frame.shapeKind === 'line') {
    svgShape = `<line x1="0" y1="50" x2="100" y2="50" ${common} stroke-linecap="round" />`;
  } else {
    const points = formatSvgPoints(printEditableVerticesForFrame(frame) ?? defaultPrintShapeVerticesForFrame(frame) ?? []);
    svgShape = `<polygon points="${points}" ${common} stroke-linejoin="round" />`;
  }

  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" style="position: absolute; inset: 0; pointer-events: none; overflow: visible;">
    ${svgShape}
  </svg>`;
}

function renderPrintBubbleSvg(frame: PaperFrame): string {
  const fill = svgFillForFrame(frame);
  const stroke = escapeHtml(frame.strokeColor);
  const strokeWidth = formatMm(frame.strokeWidthMm);
  const path = buildPaperBubblePath(frame);
  const bounds = printBubbleShapeBounds(frame);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatSvgNumber(bounds.minX)} ${formatSvgNumber(bounds.minY)} ${formatSvgNumber(bounds.width)} ${formatSvgNumber(bounds.height)}" preserveAspectRatio="none" overflow="visible">
  ${renderSvgGradientDef(frame)}
  <path d="${path}" fill="${escapeHtml(fill)}" fill-opacity="${svgFillOpacity(frame)}" stroke="${stroke}" stroke-opacity="${clampUnit(frame.strokeOpacity)}" stroke-width="${strokeWidth}" stroke-dasharray="${svgDashArray(frame)}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
</svg>`;
  const style = [
    'position: absolute',
    `left: ${formatPercent(bounds.minX)}`,
    `top: ${formatPercent(bounds.minY)}`,
    `width: ${formatPercent(bounds.width)}`,
    `height: ${formatPercent(bounds.height)}`,
    'max-width: none',
    'max-height: none',
    'pointer-events: none',
  ].join('; ');

  return `<img class="paper-bubble-shape" alt="" src="${escapeHtml(svgToDataUrl(svg))}" style="${escapeHtml(style)}" />`;
}

function printBubbleShapeBounds(frame: PaperFrame): { minX: number; minY: number; width: number; height: number } {
  const tailX = finiteOr(frame.tailXPercent, 72);
  const tailY = finiteOr(frame.tailYPercent, 92);
  const pinchX = finiteOr(frame.bubblePinchXPercent, 58);
  const pinchY = finiteOr(frame.bubblePinchYPercent, 75);
  const curveHandle = resolveBubbleTailCurveHandle(frame);
  const strokePadding = Math.max(4, finiteOr(frame.strokeWidthMm, 0.35) * 8);
  const bodyOvershoot = frame.kind === 'thoughtBubble' ? 7 : 5;
  const minX = Math.min(-bodyOvershoot, tailX, pinchX, curveHandle.x) - strokePadding;
  const maxX = Math.max(100 + bodyOvershoot, tailX, pinchX, curveHandle.x) + strokePadding;
  const minY = Math.min(-bodyOvershoot, tailY, pinchY, curveHandle.y) - strokePadding;
  const maxY = Math.max(100 + bodyOvershoot, tailY, pinchY, curveHandle.y) + strokePadding;

  return {
    minX: roundPercent(minX),
    minY: roundPercent(minY),
    width: roundPercent(maxX - minX),
    height: roundPercent(maxY - minY),
  };
}

function printFrameContentPaddingMm(frame: PaperFrame): number {
  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble' || frame.kind === 'shape') return 0;
  // Keep continuous imported callouts aligned with the editor: when every rich paragraph paints a shading or
  // border, its box is the frame's visual edge rather than an inset rectangle inside that frame.
  if (frame.richText?.length && frame.richText.every((paragraph) => paragraph.borders || paragraph.shading)) return 0;
  return 2;
}

/**
 * The physical text content box shared by print HTML and managed glyph composition. Coordinates are local to
 * the frame, in millimetres. Keeping this geometry here prevents the editor and export paths from inventing
 * subtly different bubble/text insets.
 */
export function resolvePaperFrameTextContentBoxMm(frame: PaperFrame): {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
} {
  if (frame.kind === 'speechBubble' || frame.kind === 'thoughtBubble') {
    const textBox = resolvePaperTextBox(frame);
    return {
      xMm: frame.widthMm * textBox.xPercent / 100,
      yMm: frame.heightMm * textBox.yPercent / 100,
      widthMm: frame.widthMm * textBox.widthPercent / 100,
      heightMm: frame.heightMm * textBox.heightPercent / 100,
    };
  }
  const paddingMm = printFrameContentPaddingMm(frame);
  return {
    xMm: paddingMm,
    yMm: paddingMm,
    widthMm: Math.max(0, frame.widthMm - paddingMm * 2),
    heightMm: Math.max(0, frame.heightMm - paddingMm * 2),
  };
}

function renderPrintTextBox(frame: PaperFrame, content: string, extraStyle = '', baselineGrid?: PaperBaselineGridSpec): string {
  const textBox = resolvePaperTextBox(frame);
  // Same axis handling as the on-canvas bubble (paperTextBoxReactStyle): horizontal maps vertical-align to
  // justify-content; Japanese 縦書き rotates the flex axes, so center the columns horizontally and map
  // vertical-align to align-items instead — otherwise a vertical bubble's text jams to one side.
  const vertical = frame.typography.writingMode === 'vertical-rl';
  const verticalAlignFlex = paperTextVerticalAlignToJustifyContent(textBox.verticalAlign);
  const baselineLeadingPt = resolvePaperBaselineLeadingPt(frame.typography.leadingPt, baselineGrid);
  const baselineTopInsetMm = resolvePaperBaselineTopInsetMm(
    frame.yMm + frame.heightMm * textBox.yPercent / 100,
    baselineLeadingPt,
    baselineGrid,
  );
  const style = [
    `position: absolute`,
    `left: ${formatPercent(textBox.xPercent)}`,
    `top: ${formatPercent(textBox.yPercent)}`,
    `width: ${formatPercent(textBox.widthPercent)}`,
    `height: ${formatPercent(textBox.heightPercent)}`,
    `z-index: 1`,
    `overflow: hidden`,
    baselineTopInsetMm ? `padding-top: ${formatMm(baselineTopInsetMm)}` : '',
    baselineTopInsetMm ? 'box-sizing: border-box' : '',
    `transform: ${appendPaperTextEffectTransform(`rotate(${formatDeg(textBox.rotationDeg)})`, frame)}`,
    `transform-origin: center`,
    `display: flex`,
    `flex-direction: column`,
    `justify-content: ${vertical ? 'center' : verticalAlignFlex}`,
    vertical ? `align-items: ${verticalAlignFlex}` : '',
    textStyle(frame, baselineGrid),
    extraStyle,
  ].filter(Boolean).join('; ');

  // Wrap the content in one inner block so <ruby> is not blockified into separate flex items (which would scatter
  // vertical furigana across columns). Mirrors the on-canvas PaperBubbleText structure.
  return `<div class="paper-text-box" style="${escapeHtml(style)}"><div style="white-space: pre-wrap; overflow-wrap: break-word">${content}</div></div>`;
}

function textStyle(frame: PaperFrame, baselineGrid?: PaperBaselineGridSpec): string {
  // Japanese 縦書き / kinsoku / 圏点 must survive export exactly as on canvas (they inherit to the text content).
  const vertical = frame.typography.writingMode === 'vertical-rl';
  const emphasis = paperEmphasisMarkToCss(frame.typography.emphasis);
  return [
    `font-family: ${resolvePaperFontFamily(frame.typography.fontFamily)}`,
    `font-size: ${frame.typography.fontSizePt}pt`,
    `line-height: ${resolvePaperBaselineLeadingPt(frame.typography.leadingPt, baselineGrid)}pt`,
    `letter-spacing: ${frame.typography.tracking / 1000}em`,
    `font-kerning: ${frame.typography.fontKerning ?? 'auto'}`,
    `text-align: ${frame.typography.align}`,
    `hyphens: ${frame.typography.hyphenate ? 'auto' : 'manual'}`,
    `color: ${frame.typography.color}`,
    `font-weight: ${frame.typography.fontWeight}`,
    `font-style: ${frame.typography.fontStyle}`,
    frame.typography.fontStretch ? `font-stretch: ${frame.typography.fontStretch}` : '',
    frame.typography.fontVariationSettings ? `font-variation-settings: ${paperFontVariationSettingsToCss(frame.typography.fontVariationSettings)}` : '',
    frame.typography.firstLineIndentMm ? `text-indent: ${formatMm(frame.typography.firstLineIndentMm)} each-line` : '',
    frame.typography.alignLast && frame.typography.alignLast !== 'auto' ? `text-align-last: ${frame.typography.alignLast}` : '',
    frame.typography.smallCaps ? 'font-variant-caps: small-caps' : '',
    paperNumericStyleToCss(frame.typography.numericStyle) ? `font-variant-numeric: ${paperNumericStyleToCss(frame.typography.numericStyle)}` : '',
    frame.typography.lineBreak && frame.typography.lineBreak !== 'auto' ? `text-wrap-style: ${frame.typography.lineBreak}` : '',
    vertical ? 'writing-mode: vertical-rl' : '',
    vertical ? `text-orientation: ${frame.typography.textOrientation ?? 'mixed'}` : '',
    (frame.typography.lineBreakStrict ?? vertical) ? 'line-break: strict' : '',
    emphasis ? `text-emphasis: ${emphasis}` : '',
    buildPaperTextPaintEffectCssText(frame),
  ].filter(Boolean).join('; ');
}

function paperFontVariationSettingsToCss(settings: Record<string, number>): string {
  return Object.entries(settings)
    .filter(([tag, value]) => /^[ -~]{4}$/.test(tag) && Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([tag, value]) => `"${tag}" ${value}`)
    .join(', ');
}

function paperNumericStyleToCss(style: PaperTypography['numericStyle']): string | undefined {
  switch (style) {
    case 'oldstyle':
      return 'oldstyle-nums';
    case 'lining':
      return 'lining-nums';
    case 'tabular':
      return 'tabular-nums';
    default:
      return undefined;
  }
}

function printFrameColumnStyle(frame: PaperFrame): string {
  const columns = frame.kind === 'text' ? Math.max(1, Math.round(frame.columns || 1)) : 1;
  if (columns <= 1) return '';
  return [
    `column-count: ${columns}`,
    `column-gap: ${formatMm(resolvePaperColumnGutterMm(frame))}`,
    `column-fill: ${frame.columnBalance ? 'balance' : 'auto'}`,
    frame.columnRule ? `column-rule: 0.2mm solid ${frame.strokeColor}` : '',
  ].filter(Boolean).join('; ');
}

function printTextEffectInlineStyle(frame: PaperFrame): string {
  const transform = appendPaperTextEffectTransform(undefined, frame);
  if (!transform) return '';
  return `display: block; transform: ${transform}; transform-origin: center`;
}

function defaultGuidesForPage(page: PaperPageSpec): PaperGuide[] {
  return [
    { id: makeId('guide'), orientation: 'vertical', positionMm: page.widthMm / 2, label: 'Center vertical' },
    { id: makeId('guide'), orientation: 'horizontal', positionMm: page.heightMm / 2, label: 'Center horizontal' },
  ];
}

function updateDefaultGuidesForPage(guides: PaperGuide[], page: PaperPageSpec): PaperGuide[] {
  const customGuides = guides.filter((guide) => !guide.label?.startsWith('Center '));
  return [...defaultGuidesForPage(page), ...customGuides];
}

function normalizePageSpec(page: PaperPageSpec): PaperPageSpec {
  return {
    ...page,
    dpi: normalizeDpi(page.dpi),
  };
}

function renumberPages(pages: PaperPage[]): PaperPage[] {
  return pages.map((page, index) => ({ ...page, pageNumber: index + 1 }));
}

function touch(doc: PaperDocument): PaperDocument {
  return { ...doc, updatedAt: Date.now() };
}

function normalizeDpi(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DPI;
  return Math.max(72, Math.min(2400, Math.round(value)));
}

function normalizeBackgroundAngle(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PAPER_BACKGROUND.angleDeg;
  const normalized = value % 360;
  return Number(normalized.toFixed(3));
}

function isPaperBackgroundType(value: unknown): value is PaperBackgroundSpec['type'] {
  return value === 'solid' || value === 'linear-gradient' || value === 'radial-gradient';
}

function normalizeCssColor(value: string | undefined, fallback: string): string {
  const color = value?.trim();
  if (!color) return fallback;
  if (color === 'transparent') return color;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(color)) return color;
  if (/^(rgba?|hsla?)\([0-9\s.,%+-]+\)$/i.test(color)) return color;
  return fallback;
}

function clampMm(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.max(min, Math.min(max, value)) * 1000) / 1000;
}

function defaultFrameLabel(kind: PaperFrameKind): string {
  switch (kind) {
    case 'text':
      return 'Text Frame';
    case 'image':
      return 'Image Frame';
    case 'document':
      return 'Document Frame';
    case 'speechBubble':
      return 'Speech Bubble';
    case 'thoughtBubble':
      return 'Thought Bubble';
    case 'caption':
      return 'Caption';
    case 'panel':
      return 'Comic Panel';
    case 'shape':
      return 'Polygon Shape';
    case 'barcode':
      return 'ISBN Barcode';
  }
}

function defaultTextForKind(kind: PaperFrameKind): string | undefined {
  switch (kind) {
    case 'speechBubble':
      return 'Speech text';
    case 'thoughtBubble':
      return 'Thought text';
    case 'caption':
      return 'Narration caption';
    case 'text':
      return 'Body copy';
    default:
      return undefined;
  }
}

function defaultFillForKind(kind: PaperFrameKind): string {
  if (kind === 'caption') return '#fff4bf';
  if (kind === 'panel' || kind === 'image') return 'transparent';
  // A document text frame has no fill (text flows over the page, like Word/InDesign body text). Speech/thought
  // bubbles still fall through to the white fallback below.
  if (kind === 'text') return 'transparent';
  if (kind === 'document') return '#f8fafc';
  if (kind === 'shape') return '#e0f2fe';
  if (kind === 'barcode') return '#ffffff';
  return '#ffffff';
}

function defaultCornerRadiusForKind(kind: PaperFrameKind): number {
  if (kind === 'speechBubble' || kind === 'thoughtBubble') return 100;
  if (kind === 'caption') return 1.5;
  return 0;
}

function sanitizePaperTextWrap(value: PaperFrame['textWrap']): PaperTextWrap | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const modes: PaperTextWrap['mode'][] = ['none', 'boundingBox', 'jumpObject', 'contour'];
  const mode = modes.includes(value.mode) ? value.mode : 'none';
  if (mode === 'none') return undefined;
  const standoffMm = Number.isFinite(value.standoffMm) ? Math.max(0, value.standoffMm) : 0;
  const contourSource = value.contourSource === 'vertices' || value.contourSource === 'frameShape'
    ? value.contourSource
    : undefined;
  return { mode, standoffMm, contourSource };
}

function defaultVerticesForKind(kind: PaperFrameKind, shapeKind: PaperFrame['shapeKind']): PaperFrame['vertices'] {
  if (kind === 'panel') {
    return [
      { xPercent: 0, yPercent: 0 },
      { xPercent: 100, yPercent: 0 },
      { xPercent: 100, yPercent: 100 },
      { xPercent: 0, yPercent: 100 },
    ];
  }
  if (kind !== 'shape') return undefined;
  if (shapeKind === 'line') {
    return [
      { xPercent: 0, yPercent: 50 },
      { xPercent: 100, yPercent: 50 },
    ];
  }
  if (shapeKind === 'ellipse') return undefined;
  if (shapeKind === 'pentagon') {
    return [
      { xPercent: 50, yPercent: 0 },
      { xPercent: 98, yPercent: 36 },
      { xPercent: 80, yPercent: 100 },
      { xPercent: 20, yPercent: 100 },
      { xPercent: 2, yPercent: 36 },
    ];
  }
  if (shapeKind === 'hexagon') {
    return [
      { xPercent: 25, yPercent: 0 },
      { xPercent: 75, yPercent: 0 },
      { xPercent: 100, yPercent: 50 },
      { xPercent: 75, yPercent: 100 },
      { xPercent: 25, yPercent: 100 },
      { xPercent: 0, yPercent: 50 },
    ];
  }
  return [
    { xPercent: 50, yPercent: 0 },
    { xPercent: 100, yPercent: 100 },
    { xPercent: 0, yPercent: 100 },
  ];
}

function isShapedContentFrame(frame: PaperFrame): boolean {
  return frame.kind !== 'shape'
    && frame.kind !== 'speechBubble'
    && frame.kind !== 'thoughtBubble'
    && Boolean(printClipPathForFrame(frame));
}

function printClipPathForFrame(frame: PaperFrame): string | undefined {
  const vertices = printEditableVerticesForFrame(frame);
  if (vertices && vertices.length >= 3) {
    return `polygon(${vertices.map((vertex) => `${formatPercent(vertex.xPercent)} ${formatPercent(vertex.yPercent)}`).join(', ')})`;
  }
  if (!isFrameShapeKindEnabled(frame)) return undefined;
  if (frame.shapeKind === 'ellipse') return 'ellipse(50% 50% at 50% 50%)';
  if (frame.shapeKind === 'triangle') return 'polygon(50% 0%, 100% 100%, 0% 100%)';
  if (frame.shapeKind === 'pentagon') return 'polygon(50% 0%, 98% 36%, 80% 100%, 20% 100%, 2% 36%)';
  if (frame.shapeKind === 'hexagon') return 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
  return undefined;
}

function printEditableVerticesForFrame(frame: PaperFrame): PaperFrame['vertices'] {
  if (frame.kind === 'caption') {
    return frame.vertices && frame.vertices.length >= 3 && !isDefaultShapeTriangleVertices(frame.vertices)
      ? frame.vertices
      : undefined;
  }
  if (frame.kind === 'panel' || frame.kind === 'image') {
    return frame.vertices && frame.vertices.length >= 3 ? frame.vertices : undefined;
  }
  return undefined;
}

function defaultPrintShapeVerticesForFrame(frame: PaperFrame): PaperFrame['vertices'] {
  if (!isFrameShapeKindEnabled(frame)) return undefined;
  return defaultVerticesForKind('shape', frame.shapeKind);
}

function isFrameShapeKindEnabled(frame: PaperFrame): boolean {
  return frame.kind === 'panel' || frame.kind === 'image';
}

function isDefaultShapeTriangleVertices(vertices: NonNullable<PaperFrame['vertices']>): boolean {
  return vertices.length === 3
    && vertices[0].xPercent === 50
    && vertices[0].yPercent === 0
    && vertices[1].xPercent === 100
    && vertices[1].yPercent === 100
    && vertices[2].xPercent === 0
    && vertices[2].yPercent === 100;
}

export function formatMm(value: number): string {
  return `${Number(value.toFixed(3))}mm`;
}

function formatPercent(value: number): string {
  return `${Number(value.toFixed(3))}%`;
}

function formatSvgNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function formatDeg(value: number): string {
  return `${Number(value.toFixed(3))}deg`;
}

function frameFillCss(frame: PaperFrame): string {
  if (frame.fillGradient) {
    return `linear-gradient(${frame.fillGradient.angleDeg}deg, ${frame.fillGradient.fromColor}, ${frame.fillGradient.toColor})`;
  }
  return colorWithOpacity(frame.fillColor, frame.fillOpacity);
}

function svgFillForFrame(frame: PaperFrame): string {
  if (frame.fillGradient) return `url(#${svgGradientId(frame.id)})`;
  return colorWithOpacity(frame.fillColor, frame.fillOpacity);
}

function svgFillOpacity(frame: PaperFrame): number {
  return frame.fillGradient ? clampUnit(frame.fillOpacity) : 1;
}

function renderSvgGradientDef(frame: PaperFrame): string {
  if (!frame.fillGradient) return '';
  const vector = gradientVector(frame.fillGradient.angleDeg);
  const id = escapeHtml(svgGradientId(frame.id));
  return `<defs><linearGradient id="${id}" x1="${vector.x1}%" y1="${vector.y1}%" x2="${vector.x2}%" y2="${vector.y2}%"><stop offset="0%" stop-color="${escapeHtml(frame.fillGradient.fromColor)}" /><stop offset="100%" stop-color="${escapeHtml(frame.fillGradient.toColor)}" /></linearGradient></defs>`;
}

function svgGradientId(id: string): string {
  return `paper-gradient-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

function gradientVector(angleDeg: number): { x1: number; y1: number; x2: number; y2: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  return {
    x1: Number((50 - x * 50).toFixed(3)),
    y1: Number((50 - y * 50).toFixed(3)),
    x2: Number((50 + x * 50).toFixed(3)),
    y2: Number((50 + y * 50).toFixed(3)),
  };
}

function colorWithOpacity(color: string, opacity: number): string {
  if (color === 'transparent') return color;
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const alpha = clampUnit(opacity);
  if (alpha >= 1) return color;
  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function formatSvgPoints(vertices: NonNullable<PaperFrame['vertices']>): string {
  return vertices.map((vertex) => `${Number(vertex.xPercent.toFixed(3))},${Number(vertex.yPercent.toFixed(3))}`).join(' ');
}

function svgDashArray(frame: PaperFrame): string {
  if (frame.strokeStyle === 'dashed') return '5 4';
  if (frame.strokeStyle === 'dotted') return '1 3';
  return 'none';
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function clampUnit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(1, Number(value)));
}

function normalizePaperTintPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, Math.round(value * 1000) / 1000));
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function roundPercent(value: number): number {
  return Number(value.toFixed(3));
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`}`;
}
