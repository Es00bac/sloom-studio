import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument, PaperFrame, PaperPage } from '../types/paper';
import {
  buildPaperPrintProductionMetadata,
  isPdfXProductionTarget,
} from './paperPrintProduction';
import { resolveTextFace } from './paperFontLibrary';
import { hasPaperAssetReference } from './paperAssetReferences';
import { isPaperManagedIccProfile } from './paperManagedIccProfiles';
import { collectPaperPlacedDocumentRasterizationIssues } from './paperPlacedDocumentRasterization';
import { buildPaperPlacedSourceItemMimeTypeLookup } from './paperPlacedPdf';
import { resolvePaperDocumentEffectiveTypographyForOutput } from './paperDocument';
import {
  buildPaperBarcodeGeometry,
  PAPER_EAN13_NOMINAL,
  paperBarcodePhysicalSizeStatus,
  paperBarcodeQuadsOverlap,
  paperBarcodeQuietZoneQuads,
  paperFrameCarriesPrintedInk,
  paperFrameInkQuad,
  type PaperBarcodeValueResolution,
} from './paperBarcode';
import { paperFrameLayerIsPrintable, paperParentPageIsApplied } from './paperLayers';
import { getPaperBubbleCompoundFallbackSegments } from './paperBubbleChains';

export type PaperPreflightSeverity = 'error' | 'warning' | 'info';
export type PaperPreflightProfileId = 'generic-pdf' | 'comic-print' | 'manga-print' | 'webtoon';
export type PaperPreflightCategory = 'document' | 'links' | 'fonts' | 'color' | 'production' | 'resolution' | 'text' | 'layout';

export interface PaperPreflightProfile {
  id: PaperPreflightProfileId;
  name: string;
  minBleedMm: number;
  minSafeMarginMm: number;
  minPrintPpi: number;
  warnRgbForPrint: boolean;
  requirePageMultipleOfFour: boolean;
}

export interface PaperPreflightIssue {
  id: string;
  /** Stable machine-readable blocker; unlike ordinary warnings, capability blockers cannot be overridden. */
  code?: string;
  severity: PaperPreflightSeverity;
  title: string;
  detail: string;
  pageNumber?: number;
  frameId?: string;
  category?: PaperPreflightCategory;
}

export type PaperLinkedAssetStatus = 'ok' | 'missing' | 'embedded' | 'unknown' | 'stale';

export interface PaperLinkedAssetInfo {
  id: string;
  status: PaperLinkedAssetStatus;
  sourceLabel: string;
  sourceId?: string;
  pageNumber: number;
  frameId: string;
  frameLabel: string;
  effectivePpi?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  detail: string;
}

export interface PaperPreflightReport {
  issues: PaperPreflightIssue[];
  counts: Record<PaperPreflightSeverity, number>;
  profile: PaperPreflightProfile;
  groups: Array<{ category: PaperPreflightCategory; issues: PaperPreflightIssue[] }>;
  fontInventory: PaperFontInventoryItem[];
  colorInventory: PaperColorInventoryItem[];
}

export type PaperPreflightStatusTone = 'ready' | 'info' | 'warning' | 'error';

export interface PaperPreflightStatusSummary {
  tone: PaperPreflightStatusTone;
  label: string;
  countsLabel: string;
  detail: string;
}

export interface PaperFontInventoryItem {
  family: string;
  usages: number;
  available?: boolean;
}

export interface PaperColorInventoryItem {
  value: string;
  usage: 'fill' | 'stroke' | 'text' | 'background';
  rgbLike: boolean;
  usages: number;
}

export const PAPER_PREFLIGHT_PROFILES: Record<PaperPreflightProfileId, PaperPreflightProfile> = {
  'generic-pdf': { id: 'generic-pdf', name: 'Generic PDF', minBleedMm: 3, minSafeMarginMm: 3, minPrintPpi: 150, warnRgbForPrint: false, requirePageMultipleOfFour: false },
  'comic-print': { id: 'comic-print', name: 'Comic Print', minBleedMm: 3, minSafeMarginMm: 5, minPrintPpi: 300, warnRgbForPrint: true, requirePageMultipleOfFour: true },
  'manga-print': { id: 'manga-print', name: 'Manga Print', minBleedMm: 3, minSafeMarginMm: 5, minPrintPpi: 300, warnRgbForPrint: true, requirePageMultipleOfFour: true },
  webtoon: { id: 'webtoon', name: 'Webtoon', minBleedMm: 0, minSafeMarginMm: 0, minPrintPpi: 96, warnRgbForPrint: false, requirePageMultipleOfFour: false },
};

export function analyzePaperPreflight(
  document: PaperDocument,
  sourceItems: SourceBinLibraryItem[] = [],
  profileId: PaperPreflightProfileId = defaultPreflightProfileId(document),
): PaperPreflightReport {
  const profile = PAPER_PREFLIGHT_PROFILES[profileId] ?? PAPER_PREFLIGHT_PROFILES['generic-pdf'];
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const issues: PaperPreflightIssue[] = [];

  if (document.page.bleedMm < profile.minBleedMm) {
    issues.push(issue('warning', document.page.bleedMm <= 0 ? 'No bleed configured' : 'Bleed may be narrow', `${document.page.bleedMm} mm bleed is below the ${profile.minBleedMm} mm ${profile.name} target.`, { category: 'document' }));
  }

  const minMargin = Math.min(
    document.layout.marginsMm.top,
    document.layout.marginsMm.right,
    document.layout.marginsMm.bottom,
    document.layout.marginsMm.left,
  );
  if (minMargin < profile.minSafeMarginMm) {
    issues.push(issue('warning', 'Margins may be unsafe', `One or more margins are under ${profile.minSafeMarginMm} mm, which is risky for trim-safe lettering.`, { category: 'layout' }));
  }

  if (profile.requirePageMultipleOfFour && document.pages.length % 4 !== 0) {
    issues.push(issue('info', 'Comic page count is not printer-friendly', 'Saddle-stitched comic books are usually imposed in page counts divisible by 4.', { category: 'document' }));
  }

  const fontInventory = collectPaperFontInventory(document);
  const colorInventory = collectPaperColorInventory(document);
  issues.push(...analyzePrintProduction(document, colorInventory));
  if (!isPdfXProductionTarget(document.printProduction)) {
    for (const font of fontInventory) {
      if (font.available === false) {
        issues.push(issue('warning', 'Font may be unavailable', `${font.family} is referenced but not reported as available by the browser.`, { category: 'fonts' }));
      }
    }
  }
  if (isPdfXProductionTarget(document.printProduction)) {
    const strictFonts = collectStrictPdfxFontFaces(document);
    if (strictFonts.missing.size > 0) {
      issues.push(issue(
        'error',
        'PDF/X requires exact managed font faces',
        `${[...strictFonts.missing].join('; ')} must be imported or downloaded as an authorized managed face. Browser/system and bundled fallback fonts are not used for production PDF/X.`,
        { category: 'fonts' },
      ));
    } else if (strictFonts.managed.size > 0) {
      issues.push(issue(
        'info',
        'PDF/X will embed exact managed font faces',
        `${[...strictFonts.managed].join('; ')} will be embedded from managed binary assets. The export transaction verifies the generated font evidence before saving.`,
        { category: 'fonts' },
      ));
    }
  }
  if (profile.warnRgbForPrint) {
    for (const color of colorInventory.filter((entry) => entry.rgbLike)) {
      issues.push(issue('info', 'RGB color used for print', `${color.value} is used as ${color.usage}; confirm printer color conversion.`, { category: 'color' }));
    }
  }

  // Live print can preserve a PDF through <object>, but every browser raster route shares an
  // image-only adapter. Surface that boundary here, with the exact page/frame remediation, rather
  // than allowing a late HTMLImageElement decode failure during export. The current Source Library
  // items decide the media type of linked frames whose persisted metadata predates a replacement.
  for (const capabilityIssue of collectPaperPlacedDocumentRasterizationIssues(document, undefined, {
    resolveSourceItemMimeType: buildPaperPlacedSourceItemMimeTypeLookup(sourceItems),
  })) {
    issues.push(issue(
      'error',
      capabilityIssue.isPdf ? 'Placed PDF cannot be flattened in this build' : 'Placed document cannot be flattened in this build',
      capabilityIssue.message,
      {
        code: capabilityIssue.code,
        pageNumber: capabilityIssue.pageNumber,
        frameId: capabilityIssue.frameId,
        category: 'links',
      },
    ));
  }

  for (const page of document.pages) {
    for (const fallback of getPaperBubbleCompoundFallbackSegments(page.frames)) {
      issues.push(issue(
        'error',
        'Connected balloon outline could not be merged',
        'This same-speaker connector would fall back to overlapping shapes. Move an attachment, reduce the curve, or reset the connector to Organic before export.',
        {
          code: 'paper-bubble-compound-fallback',
          pageNumber: page.pageNumber,
          frameId: fallback.toFrameId,
          category: 'layout',
        },
      ));
    }
    for (const frame of page.frames) {
      issues.push(...analyzeFrame(page, frame, sourceById, profile));
    }
  }

  return {
    issues,
    counts: {
      error: issues.filter((candidate) => candidate.severity === 'error').length,
      warning: issues.filter((candidate) => candidate.severity === 'warning').length,
      info: issues.filter((candidate) => candidate.severity === 'info').length,
    },
    profile,
    groups: groupIssuesByCategory(issues),
    fontInventory,
    colorInventory,
  };
}

export function collectPaperLinkedAssets(
  document: PaperDocument,
  sourceItems: SourceBinLibraryItem[] = [],
): PaperLinkedAssetInfo[] {
  const sourceById = new Map(sourceItems.map((item) => [item.id, item]));
  const assets: PaperLinkedAssetInfo[] = [];

  for (const page of document.pages) {
    for (const frame of page.frames) {
      if (!['image', 'document'].includes(frame.kind) || !frame.asset) continue;
      assets.push(resolveLinkedAssetInfo(page, frame, sourceById));
    }
  }

  return assets;
}

export function summarizePreflightForExport(report: Pick<PaperPreflightReport, 'issues' | 'counts'>): string | undefined {
  const blockingCount = report.counts.error + report.counts.warning;
  if (blockingCount <= 0) return undefined;

  const parts = [
    report.counts.error ? `${report.counts.error} error${report.counts.error === 1 ? '' : 's'}` : '',
    report.counts.warning ? `${report.counts.warning} warning${report.counts.warning === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const notable = report.issues
    .filter((issue) => issue.severity !== 'info')
    .slice(0, 5)
    .map((issue) => `- ${issue.pageNumber ? `Page ${issue.pageNumber}: ` : ''}${issue.title}`)
    .join('\n');

  return `Preflight found ${parts.join(' and ')}.\n\n${notable}${report.issues.length > 5 ? '\n- More issues in the Paper inspector.' : ''}`;
}

export function summarizePaperPreflightStatus(report: Pick<PaperPreflightReport, 'issues' | 'counts'>): PaperPreflightStatusSummary {
  const countsLabel = [
    formatIssueCount(report.counts.error, 'error'),
    formatIssueCount(report.counts.warning, 'warning'),
    formatIssueCount(report.counts.info, 'info'),
  ].filter(Boolean).join(', ') || '0 issues';

  if (report.counts.error > 0) {
    return {
      tone: 'error',
      label: formatIssueCount(report.counts.error, 'error'),
      countsLabel,
      detail: buildPersistentPreflightDetail(report, 'error'),
    };
  }

  if (report.counts.warning > 0) {
    return {
      tone: 'warning',
      label: formatIssueCount(report.counts.warning, 'warning'),
      countsLabel,
      detail: buildPersistentPreflightDetail(report, 'warning'),
    };
  }

  if (report.counts.info > 0) {
    return {
      tone: 'info',
      label: 'Info only',
      countsLabel,
      detail: buildPersistentPreflightDetail(report, 'info'),
    };
  }

  return {
    tone: 'ready',
    label: 'Ready',
    countsLabel,
    detail: 'No Paper preflight issues detected.',
  };
}

function buildPersistentPreflightDetail(
  report: Pick<PaperPreflightReport, 'issues' | 'counts'>,
  severity: PaperPreflightSeverity,
): string {
  const firstIssue = report.issues.find((issue) => issue.severity === severity) ?? report.issues[0];
  const countSummary = [
    formatIssueCount(report.counts.error, 'error'),
    formatIssueCount(report.counts.warning, 'warning'),
    formatIssueCount(report.counts.info, 'info'),
  ].filter(Boolean).join(' and ');
  const prefix = `Preflight found ${countSummary}.`;
  if (!firstIssue) return prefix;
  return `${prefix} First: ${firstIssue.pageNumber ? `Page ${firstIssue.pageNumber}: ` : ''}${firstIssue.title}.`;
}

function formatIssueCount(count: number, noun: PaperPreflightSeverity): string {
  if (count <= 0) return '';
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function analyzeFrame(page: PaperPage, frame: PaperFrame, sourceById: Map<string, SourceBinLibraryItem>, profile: PaperPreflightProfile): PaperPreflightIssue[] {
  const issues: PaperPreflightIssue[] = [];
  const base = { pageNumber: page.pageNumber, frameId: frame.id };

  if (frame.kind === 'document') {
    const asset = frame.asset;
    if (!hasPaperAssetReference(asset) || !asset) {
      issues.push(issue('error', 'Empty document frame', `${frame.label} has no linked document.`, { ...base, category: 'links' }));
    } else {
      const linkedAsset = resolveLinkedAssetInfo(page, frame, sourceById);
      if (asset.sourceBinItemId && !sourceById.has(asset.sourceBinItemId)) {
        issues.push(issue('error', 'Missing linked document', `${asset.label || frame.label} is not present in the Source bin.`, { ...base, category: 'links' }));
      }
      if (linkedAsset.status === 'unknown') {
        issues.push(issue('info', 'Document link tracked', `${asset.label || frame.label} is linked for package/preflight tracking.`, { ...base, category: 'links' }));
      }
    }
  }

  if (frame.kind === 'image') {
    const asset = frame.asset;
    if (!hasPaperAssetReference(asset) || !asset) {
      issues.push(issue('error', 'Empty image frame', `${frame.label} has no linked art.`, { ...base, category: 'links' }));
    } else {
      const linkedAsset = resolveLinkedAssetInfo(page, frame, sourceById);
      if (asset.sourceBinItemId && !sourceById.has(asset.sourceBinItemId)) {
        issues.push(issue('error', 'Missing linked asset', `${asset.label || frame.label} is not present in the Source bin.`, { ...base, category: 'links' }));
      }
      const stabilityUpscale = asset.printUpscale?.provider === 'stability' ? asset.printUpscale : undefined;
      if (stabilityUpscale && linkedAsset.effectivePpi !== undefined) {
        const requiredPpi = Math.max(profile.minPrintPpi, stabilityUpscale.requiredPpi);
        if (linkedAsset.effectivePpi < requiredPpi) {
          issues.push(issue(
            'warning',
            'Stability image remains below print PPI',
            `${asset.label || frame.label} is ${linkedAsset.effectivePpi} effective PPI from Stability ${stabilityUpscale.mode}; ${requiredPpi} PPI is required for this document.`,
            { ...base, category: 'resolution' },
          ));
        } else {
          issues.push(issue(
            'info',
            'Stability image meets current print PPI',
            `${asset.label || frame.label} is ${linkedAsset.effectivePpi} effective PPI from Stability ${stabilityUpscale.mode}.`,
            { ...base, category: 'resolution' },
          ));
        }
      } else if (linkedAsset.effectivePpi === undefined) {
        issues.push(issue('info', 'Image resolution unknown', `${asset.label || frame.label} has no pixel dimensions available for DPI validation.`, { ...base, category: 'resolution' }));
      } else if (linkedAsset.effectivePpi < profile.minPrintPpi) {
        issues.push(issue('warning', 'Image resolution is low', `${asset.label || frame.label} is about ${linkedAsset.effectivePpi} effective PPI.`, { ...base, category: 'resolution' }));
      }
    }
  }

  if (['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind)) {
    const text = frame.text?.trim() ?? '';
    if (!text) {
      issues.push(issue('warning', 'Empty text frame', `${frame.label} has no lettering or caption text.`, { ...base, category: 'text' }));
    }
    if (looksOverset(frame, text)) {
      issues.push(issue('warning', 'Possible overset text', `${frame.label} may contain more text than its frame can comfortably hold.`, { ...base, category: 'text' }));
    }
  }

  if (frame.kind === 'panel' && !frame.asset && !frame.fillGradient && frame.fillColor === 'transparent') {
    issues.push(issue('info', 'Empty panel placeholder', `${frame.label} is a panel frame without art or fill.`, { ...base, category: 'layout' }));
  }

  if (frame.kind === 'barcode') {
    issues.push(...analyzeBarcodeFrame(page, frame));
  }

  return issues;
}

/** ISBN/EAN physical checks: value validity, GS1 magnification window, truncation, and quiet zone. */
function analyzeBarcodeFrame(page: PaperPage, frame: PaperFrame): PaperPreflightIssue[] {
  const issues: PaperPreflightIssue[] = [];
  const base = { pageNumber: page.pageNumber, frameId: frame.id };
  const geometry = buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm);
  const size = paperBarcodePhysicalSizeStatus(geometry);

  if (geometry.resolution.status === 'invalid') {
    issues.push(issue(
      'error',
      'Barcode value is not a valid ISBN or EAN-13',
      `${frame.label}: ${barcodeInvalidDetail(geometry.resolution)}. Enter an ISBN-10, an ISBN-13, or 12 digits to derive the check digit.`,
      { ...base, code: 'paper-barcode-value-invalid', category: 'layout' },
    ));
  } else if (!geometry.resolution.bookland) {
    issues.push(issue(
      'info',
      'Barcode is a general EAN-13, not an ISBN',
      `${frame.label} encodes ${geometry.resolution.ean13}; the prefix is outside the 978/979 ISBN range, so it scans as a general EAN-13.`,
      { ...base, category: 'layout' },
    ));
  }
  if (geometry.resolution.status === 'valid' && !(frame.barcode?.showHumanReadable ?? true)) {
    issues.push(issue(
      'warning',
      'Barcode human-readable digits are hidden',
      `${frame.label} omits the human-readable interpretation digits; GS1 requires all 13 digits below an EAN-13 symbol, so this cannot be a standards-ready strict export. Show the digits for print.`,
      { ...base, code: 'paper-barcode-hri-hidden', category: 'layout' },
    ));
  }

  if (frame.widthMm <= 0 || frame.heightMm <= 0) {
    issues.push(issue(
      'error',
      'Barcode frame has no physical size',
      `${frame.label} has a zero or negative width/height, so no EAN modules can be placed.`,
      { ...base, code: 'paper-barcode-physical-size', category: 'layout' },
    ));
    return issues;
  }

  if (!size.magnificationInRange) {
    issues.push(issue(
      'error',
      'Barcode magnification is outside the GS1 80-200% range',
      `${frame.label} scales to ${Math.round(size.magnification * 100)}% magnification; GS1 permits 80-200% without a printer waiver. Use an inspector preset to restore a standard size.`,
      { ...base, code: 'paper-barcode-magnification', category: 'layout' },
    ));
  } else if (!size.heightNominal) {
    const nominalBarHeightMm = PAPER_EAN13_NOMINAL.barHeightMm * (size.magnification > 0 ? size.magnification : 0);
    issues.push(issue(
      'warning',
      'Barcode height is truncated',
      `${frame.label} has ${geometry.barHeightMm.toFixed(2)} mm data bars, under the ${nominalBarHeightMm.toFixed(2)} mm nominal proportion; truncated symbols scan less reliably.`,
      { ...base, code: 'paper-barcode-truncated-height', category: 'layout' },
    ));
  }

  const quietQuads = paperBarcodeQuietZoneQuads(frame);
  for (const other of page.frames) {
    if (other.id === frame.id || !paperFrameCarriesPrintedInk(other)) continue;
    const otherQuad = paperFrameInkQuad(other);
    if (quietQuads.some((quad) => paperBarcodeQuadsOverlap(quad, otherQuad))) {
      issues.push(issue(
        'warning',
        'Barcode quiet zone is obstructed',
        `${other.label || 'Another frame'} prints inside ${frame.label}'s reserved quiet zone (${size.leftQuietZoneMm.toFixed(2)} mm left, ${size.rightQuietZoneMm.toFixed(2)} mm right at this size). Keep both zones clear of ink for reliable scanning.`,
        { ...base, code: 'paper-barcode-quiet-zone-obstructed', category: 'layout' },
      ));
    }
  }

  return issues;
}

function barcodeInvalidDetail(resolution: Extract<PaperBarcodeValueResolution, { status: 'invalid' }>): string {
  switch (resolution.reason) {
    case 'empty':
      return 'No ISBN has been entered yet';
    case 'bad-characters':
      return 'The value contains characters that cannot form an ISBN or EAN-13';
    case 'bad-length':
      return 'Enter 9 or 10 characters (ISBN-10), 12 digits, or 13 digits (ISBN-13)';
    case 'isbn10-check-digit':
      return `The ISBN-10 check character should be ${resolution.expectedCheckCharacter}`;
    case 'ean13-check-digit':
      return `The ISBN-13/EAN-13 check digit should be ${resolution.expectedCheckCharacter}`;
  }
}

function resolveLinkedAssetInfo(
  page: PaperPage,
  frame: PaperFrame,
  sourceById: Map<string, SourceBinLibraryItem>,
): PaperLinkedAssetInfo {
  const asset = frame.asset;
  const sourceItem = asset?.sourceBinItemId ? sourceById.get(asset.sourceBinItemId) : undefined;
  const sourceWithMetadata = sourceItem as (SourceBinLibraryItem & Partial<PixelMetadata>) | undefined;
  const pixelWidth = firstPositiveNumber(asset?.pixelWidth, sourceWithMetadata?.pixelWidth, sourceWithMetadata?.widthPx, sourceWithMetadata?.width);
  const pixelHeight = firstPositiveNumber(asset?.pixelHeight, sourceWithMetadata?.pixelHeight, sourceWithMetadata?.heightPx, sourceWithMetadata?.height);
  const effectivePpi = pixelWidth && pixelHeight
    ? Math.round(Math.min(pixelWidth / Math.max(0.1, frame.widthMm / 25.4), pixelHeight / Math.max(0.1, frame.heightMm / 25.4)))
    : undefined;
  const sourceLabel = asset?.label || sourceItem?.label || frame.label;
  const status = resolveLinkedAssetStatus(frame, sourceItem, effectivePpi);

  return {
    id: `${page.id}-${frame.id}-${asset?.sourceBinItemId ?? 'embedded'}`,
    status,
    sourceLabel,
    sourceId: asset?.sourceBinItemId,
    pageNumber: page.pageNumber,
    frameId: frame.id,
    frameLabel: frame.label,
    effectivePpi,
    pixelWidth,
    pixelHeight,
    detail: linkedAssetDetail(status, effectivePpi, pixelWidth, pixelHeight),
  };
}

interface PixelMetadata {
  pixelWidth: number;
  pixelHeight: number;
  widthPx: number;
  heightPx: number;
  width: number;
  height: number;
}

function resolveLinkedAssetStatus(
  frame: PaperFrame,
  sourceItem: SourceBinLibraryItem | undefined,
  effectivePpi: number | undefined,
): PaperLinkedAssetStatus {
  if (frame.asset?.sourceBinItemId && !sourceItem) return frame.asset.locator ? 'stale' : 'missing';
  if (!frame.asset?.sourceBinItemId && frame.asset?.locator) return 'embedded';
  if (effectivePpi === undefined) return 'unknown';
  return 'ok';
}

function linkedAssetDetail(
  status: PaperLinkedAssetStatus,
  effectivePpi: number | undefined,
  pixelWidth: number | undefined,
  pixelHeight: number | undefined,
): string {
  if (status === 'missing') return 'Missing from Source Library.';
  if (status === 'stale') return 'Source Library item is missing, but embedded image data is present.';
  if (status === 'embedded') return 'Embedded image without a live Source Library link.';
  if (effectivePpi !== undefined) return `${pixelWidth} x ${pixelHeight}px, ${effectivePpi} effective PPI.`;
  return 'Linked, but pixel dimensions are unknown.';
}

function firstPositiveNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function looksOverset(frame: PaperFrame, text: string): boolean {
  if (!text) return false;
  const fontSizeMm = Math.max(1, frame.typography.fontSizePt * 0.352778);
  const lineHeightMm = Math.max(fontSizeMm, frame.typography.leadingPt * 0.352778);
  const columns = Math.max(1, Math.round(frame.columns || 1));
  const averageCharsPerLine = Math.max(8, Math.floor((frame.widthMm / columns) / (fontSizeMm * 0.48)));
  const estimatedLines = Math.ceil(text.length / averageCharsPerLine);
  const availableLines = Math.max(1, Math.floor(frame.heightMm / lineHeightMm) * columns);
  return estimatedLines > availableLines;
}

/** Production PDF/X may only use an exact managed face; this never treats browser availability as authority. */
function collectStrictPdfxFontFaces(document: PaperDocument): { managed: Set<string>; missing: Set<string> } {
  const managed = new Set<string>();
  const missing = new Set<string>();
  const effectiveDocument = resolvePaperDocumentEffectiveTypographyForOutput(document);
  const activeParentPages = effectiveDocument.parentPages.filter((parentPage) => (
    paperParentPageIsApplied(effectiveDocument, parentPage.id)
  ));
  for (const page of [...effectiveDocument.pages, ...activeParentPages]) {
    for (const frame of page.frames) {
      if (!paperFrameLayerIsPrintable(effectiveDocument, frame)) continue;
      if (!['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind)) continue;
      const runs = frame.richText?.length
        ? frame.richText.flatMap((paragraph) => paragraph.runs.map((run) => ({
          text: run.text,
          fontFamily: run.fontFamily ?? frame.typography.fontFamily,
          fontWeight: run.fontWeight ?? frame.typography.fontWeight,
          fontStyle: run.fontStyle ?? frame.typography.fontStyle,
        })))
        : [{
          text: frame.text ?? '',
          fontFamily: frame.typography.fontFamily,
          fontWeight: frame.typography.fontWeight,
          fontStyle: frame.typography.fontStyle,
        }];
      for (const run of runs) {
        if (!run.text.trim()) continue;
        const resolved = resolveTextFace(run, effectiveDocument.importedFonts);
        if (resolved.embeddedReal) managed.add(resolved.familyName);
        else missing.add(run.fontFamily.trim() || 'Unnamed font');
      }
    }
  }
  return { managed, missing };
}

function issue(
  severity: PaperPreflightSeverity,
  title: string,
  detail: string,
  context: Partial<Pick<PaperPreflightIssue, 'code' | 'pageNumber' | 'frameId' | 'category'>> = {},
): PaperPreflightIssue {
  return {
    id: `${severity}-${context.pageNumber ?? 'doc'}-${context.frameId ?? title}-${title}`,
    severity,
    title,
    detail,
    category: context.category ?? 'document',
    ...context,
  };
}

export function collectPaperFontInventory(document: PaperDocument): PaperFontInventoryItem[] {
  const fonts = new Map<string, PaperFontInventoryItem>();
  for (const page of document.pages) {
    for (const frame of page.frames) {
      const family = frame.typography.fontFamily.trim();
      if (!family) continue;
      const existing = fonts.get(family) ?? { family, usages: 0, available: browserCanCheckFont(family) };
      existing.usages += 1;
      fonts.set(family, existing);
    }
  }
  return [...fonts.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function collectPaperColorInventory(document: PaperDocument): PaperColorInventoryItem[] {
  const colors = new Map<string, PaperColorInventoryItem>();
  const add = (value: string | undefined, usage: PaperColorInventoryItem['usage']) => {
    if (!value || value === 'transparent') return;
    const key = `${usage}:${value}`;
    const existing = colors.get(key) ?? { value, usage, rgbLike: isRgbLike(value), usages: 0 };
    existing.usages += 1;
    colors.set(key, existing);
  };
  add(document.background.color, 'background');
  add(document.background.fromColor, 'background');
  add(document.background.toColor, 'background');
  for (const page of document.pages) {
    for (const frame of page.frames) {
      add(frame.fillColor, 'fill');
      add(frame.fillGradient?.fromColor, 'fill');
      add(frame.fillGradient?.toColor, 'fill');
      add(frame.strokeColor, 'stroke');
      add(frame.typography.color, 'text');
    }
  }
  return [...colors.values()].sort((a, b) => a.value.localeCompare(b.value));
}

function groupIssuesByCategory(issues: PaperPreflightIssue[]): PaperPreflightReport['groups'] {
  const categories: PaperPreflightCategory[] = ['document', 'links', 'fonts', 'color', 'production', 'resolution', 'text', 'layout'];
  return categories.map((category) => ({ category, issues: issues.filter((issue) => issue.category === category) })).filter((group) => group.issues.length > 0);
}

/** True when the document actually USES (not merely defines) a named spot swatch in a frame colour —
 * either as a fill (fillSwatchId) or as a text colour (typography.colorSwatchId). */
function documentUsesSpotColor(document: PaperDocument): boolean {
  const spotIds = new Set((document.swatches ?? []).filter((swatch) => swatch.type === 'spot').map((swatch) => swatch.id));
  if (spotIds.size === 0) return false;
  for (const page of document.pages) {
    for (const frame of page.frames) {
      // The durable link: a fill applied from a spot swatch records its id in fillSwatchId, and text colour
      // from a spot swatch records typography.colorSwatchId (the CSS colour is only an RGB preview and can't
      // identify the swatch).
      if (frame.fillSwatchId && spotIds.has(frame.fillSwatchId)) return true;
      if (frame.strokeSwatchId && spotIds.has(frame.strokeSwatchId)) return true;
      if (frame.typography?.colorSwatchId && spotIds.has(frame.typography.colorSwatchId)) return true;
    }
  }
  return false;
}

/** Names requested for preservation. Final /Separation evidence is checked by the export transaction. */
function collectRequestedSpotNames(document: PaperDocument): string[] {
  const spots = new Map((document.swatches ?? [])
    .filter((swatch) => swatch.type === 'spot')
    .map((swatch) => [swatch.id, swatch.spotName?.trim() || swatch.name]));
  const names = new Set<string>();
  for (const page of [...document.pages, ...document.parentPages]) {
    for (const frame of page.frames) {
      for (const swatchId of [frame.fillSwatchId, frame.strokeSwatchId, frame.typography.colorSwatchId]) {
        const name = swatchId ? spots.get(swatchId) : undefined;
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function analyzePrintProduction(
  document: PaperDocument,
  colorInventory: PaperColorInventoryItem[],
): PaperPreflightIssue[] {
  const issues: PaperPreflightIssue[] = [];
  const production = buildPaperPrintProductionMetadata(document);
  const hasRgbColors = colorInventory.some((entry) => entry.rgbLike);

  if (!isPdfXProductionTarget(production) && production.outputIntentColorSpace === 'rgb') {
    return issues;
  }

  if (isPdfXProductionTarget(production) && production.outputIntentColorSpace !== 'cmyk') {
    issues.push(issue('error', 'PDF/X target needs a press output intent', `${production.pdfStandard.toUpperCase()} output should use a printer ICC/output-intent profile, not ${production.outputIntentLabel}.`, { category: 'production' }));
  }

  if (isPdfXProductionTarget(production) && production.outputIntentProfileId === 'custom' && !production.customOutputIntentName.trim()) {
    issues.push(issue('error', 'Custom output intent is unnamed', 'Name the custom press ICC/output-intent profile before exporting a printer handoff package.', { category: 'production' }));
  }

  if (isPdfXProductionTarget(production) && production.outputIntentColorSpace === 'cmyk') {
    const selectedProfileId = production.outputIntentProfileAssetId;
    const expectedOutputCondition = production.outputIntentProfileId === 'custom'
      ? production.customOutputIntentName.trim()
      : production.outputCondition;
    const selectedProfile = selectedProfileId
      ? (document.managedIccProfiles ?? []).find((profile) => profile.id === selectedProfileId)
      : undefined;
    if (!selectedProfileId) {
      issues.push(issue('error', 'Exact managed CMYK profile is required', `${production.pdfStandard.toUpperCase()} cannot use an inferred, bundled, or substitute profile. Import and select the exact CMYK printer ICC for ${production.outputIntentLabel}.`, { category: 'production' }));
    } else if (!selectedProfile || !isPaperManagedIccProfile(selectedProfile)) {
      issues.push(issue('error', 'Selected managed CMYK profile is unavailable', `The selected ICC asset ${selectedProfileId} is not available in this document. Re-import the exact printer profile before exporting.`, { category: 'production' }));
    } else if (expectedOutputCondition && selectedProfile.outputConditionId !== expectedOutputCondition) {
      issues.push(issue('error', 'Managed ICC output condition does not match', `The selected profile is recorded for ${selectedProfile.outputConditionId}, but this document targets ${expectedOutputCondition}. Select the exact matching profile instead of substituting it.`, { category: 'production' }));
    } else {
      issues.push(issue('info', 'PDF/X export embeds a real ICC output intent', `${production.pdfStandard.toUpperCase()} will use the selected exact ${selectedProfile.description} ICC for ${selectedProfile.outputConditionId}. The save transaction performs internal structural checks; complete an external press/RIP review before production.`, { category: 'production' }));
    }
  }

  if (production.outputIntentColorSpace === 'cmyk' && hasRgbColors) {
    issues.push(issue('warning', 'RGB colors need CMYK proofing', `${production.outputIntentLabel} is a CMYK press target, but editable Paper colors are CSS/RGB values. Check separations, rich black, and total ink coverage in a print-production tool before press handoff.`, { category: 'color' }));
  }

  if (documentUsesSpotColor(document)) {
    if (production.spotColorPolicy === 'preserve-named') {
      const requested = collectRequestedSpotNames(document);
      if (requested.length > 0) {
        issues.push(issue('info', 'Spot colors requested for native plates', `${requested.join('; ')} are requested for native /Separation output. The strict export transaction blocks saving unless the generated evidence contains every requested plate.`, { category: 'color' }));
      }
    } else if (production.spotColorPolicy === 'warn') {
      issues.push(issue('warning', 'Named spot colors will convert to process', `Spot inks convert to process CMYK — not kept as separate plates. Set the spot policy to "preserve named" to export solid spot fills as real /Separation plates.`, { category: 'color' }));
    }
    // 'convert-process': the user explicitly chose conversion — no warning.
  }

  if (production.totalInkLimitPercent > 340 && production.outputIntentColorSpace === 'cmyk') {
    issues.push(issue('warning', 'Total ink limit is high', `${production.totalInkLimitPercent}% total area coverage can exceed many coated/uncoated press targets. Confirm the limit with the print provider.`, { category: 'production' }));
  }

  return issues;
}

function defaultPreflightProfileId(document: PaperDocument): PaperPreflightProfileId {
  if (document.page.preset === 'webtoon-panel') return 'webtoon';
  if (document.page.preset === 'manga-digest') return 'manga-print';
  if (document.page.preset === 'comic-book') return 'comic-print';
  return 'generic-pdf';
}

function browserCanCheckFont(family: string): boolean | undefined {
  const fonts = globalThis.document?.fonts;
  if (!fonts?.check) return undefined;
  const firstFamily = family.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  try {
    return fonts.check(`12px "${firstFamily}"`);
  } catch {
    return undefined;
  }
}

function isRgbLike(value: string): boolean {
  return /^#|^rgba?\(/i.test(value.trim());
}
