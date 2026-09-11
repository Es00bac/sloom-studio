// Strict, transaction-oriented production preflight. This is intentionally separate from the editable
// workspace checklist: a PDF/X handoff is blocked on missing managed inputs and on generated evidence.

import type { BinaryAssetId, BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type {
  PaperDocument,
  PaperFrame,
  PaperTypography,
} from '../types/paper';
import {
  canUseManagedFontForProduction,
  normalizePaperFontFamilyId,
  selectManagedFontFace,
} from './paperManagedFonts';
import { computeEffectivePaperFrame } from './paperDocument';
import {
  buildPaperBarcodeGeometry,
  paperBarcodePhysicalSizeStatus,
  paperBarcodeQuadsOverlap,
  paperBarcodeQuietZoneQuads,
  paperFrameCarriesPrintedInk,
  paperFrameInkQuad,
} from './paperBarcode';
import { normalizeFamilyName } from './paperFontLibrary';
import { paperFontObliqueAngleFromCss, paperFontStretchFromCss, paperFontStyleFromCss, paperFontWeightFromCss, paperFrameTextStyles } from './paperExactManagedFonts';
import { isPaperManagedIccProfile } from './paperManagedIccProfiles';
import { paperFrameLayerIsPrintable, paperParentPageIsApplied } from './paperLayers';
import { PAPER_OUTPUT_INTENT_PROFILES, normalizePaperPrintProductionSpec } from './paperPrintProduction';
import { paperPrintPaintTotalInk, type PaperPrintPaint } from './paperPrintPaint';
import type { PdfxExportResult, PdfxStandard } from './paperPdfxExport';
import type { PdfxValidationReport } from './paperPdfxValidate';
import type { PaperFlattenGroup, PaperRenderNode, PaperRenderPlan, PaperRenderTextNode } from './paperRenderPlan';
import { createPaperProductionExportReport, type PaperProductionExportReport } from './paperProductionReport';

export type PaperProductionSeverity = 'blocker' | 'warning' | 'information';

export interface PaperProductionIssue {
  code: string;
  severity: PaperProductionSeverity;
  message: string;
  pageId?: string;
  objectId?: string;
  assetId?: BinaryAssetId;
  fixAction?: 'select-object' | 'manage-font' | 'manage-profile' | 'relink-asset' | 'upscale-image';
}

export interface FrozenPaperProductionInput {
  document: PaperDocument;
  revision: number;
  assetIds: BinaryAssetId[];
}

export interface PaperProductionImagePpi {
  pageId: string;
  objectId: string;
  label: string;
  /** Zero means the placed image has no usable pixel dimensions. */
  effectivePpi: number;
  requiredPpi: number;
  printReady: boolean;
}

export interface PaperProductionPreflightReport {
  documentId: string;
  revision: number;
  standard: PdfxStandard;
  assetIds: BinaryAssetId[];
  /** Exact managed face ids expected to appear in native PDF evidence. */
  expectedFontIds: string[];
  /** Named spots requested by preserved-spot document paint. */
  requestedSpotNames: string[];
  /** Measured placed-image resolution used to make strict print readiness auditable. */
  imagePpi: PaperProductionImagePpi[];
  issues: PaperProductionIssue[];
  pass: boolean;
}

export interface PaperProductionPreflightOptions {
  standard: PdfxStandard;
  /** Verifies that a hash-addressed reference is available and matches in the active asset repository. */
  assetExists?: (reference: BinaryAssetRef) => Promise<boolean>;
  /** A just-compiled plan adds exact glyph, TAC, transparency, and spot-plateability checks. */
  renderPlan?: PaperRenderPlan;
  /** Defaults to the higher of the document setting and 300 PPI. */
  requiredPpi?: number;
  /** KDP page-raster preset resolves fonts/transparency before compiling PDF/X-1a. */
  allowFullPageFlatten?: boolean;
}

export interface ExportValidatedPaperPdfxDependencies extends PaperProductionPreflightOptions {
  generate: (document: PaperDocument) => Promise<PdfxExportResult>;
  validate: (bytes: Uint8Array, expected: { standard?: PdfxStandard }) => Promise<PdfxValidationReport>;
  download: (bytes: Uint8Array) => void | Promise<void>;
}

export type ValidatedPaperPdfxResult =
  | { status: 'saved'; bytes: Uint8Array; report: PaperProductionExportReport }
  | { status: 'blocked'; issues: PaperProductionIssue[]; report?: PaperProductionExportReport }
  | { status: 'cancelled' };

function cloneDocument(document: PaperDocument): PaperDocument {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(document);
  return JSON.parse(JSON.stringify(document)) as PaperDocument;
}

function documentContainers(document: PaperDocument): Array<{ id: string; frames: PaperFrame[] }> {
  const activeParentPages = document.parentPages.filter((parentPage) => (
    paperParentPageIsApplied(document, parentPage.id)
  ));
  return [...document.pages, ...activeParentPages].map((container) => ({
    id: container.id,
    frames: container.frames.filter((frame) => paperFrameLayerIsPrintable(document, frame)),
  }));
}

function textStyles(frame: PaperFrame): Array<{ text: string; typography: PaperTypography }> {
  return paperFrameTextStyles(frame);
}

function selectProductionManagedFont(
  typography: PaperTypography,
  document: Pick<PaperDocument, 'importedFonts'>,
) {
  const family = normalizeFamilyName(typography.fontFamily);
  const weight = paperFontWeightFromCss(typography.fontWeight);
  const fontStyle = paperFontStyleFromCss(typography.fontStyle);
  return {
    family,
    weight,
    fontStyle,
    selection: selectManagedFontFace(document.importedFonts ?? [], {
      familyId: normalizePaperFontFamilyId(family),
      weight,
      style: fontStyle,
      obliqueAngleDeg: paperFontObliqueAngleFromCss(typography.fontStyle),
      stretchPercent: paperFontStretchFromCss(typography.fontStretch),
    }),
  };
}

function assetReferences(document: PaperDocument): BinaryAssetRef[] {
  const references = new Map<BinaryAssetId, BinaryAssetRef>();
  const add = (reference: BinaryAssetRef | undefined) => {
    if (reference) references.set(reference.id, reference);
  };
  for (const container of documentContainers(document)) {
    for (const frame of container.frames) {
      if (frame.asset?.locator?.kind === 'managed') add(frame.asset.locator.ref);
    }
  }
  const outputFrames = documentContainers(document)
    .flatMap((container) => container.frames.map((frame) => computeEffectivePaperFrame(document, frame)));
  for (const frame of outputFrames) {
    for (const style of textStyles(frame)) {
      const { selection } = selectProductionManagedFont(style.typography, document);
      if (selection.status !== 'selected') continue;
      add(selection.face.fontAsset);
      add(selection.face.license?.textAsset);
    }
  }
  const selectedProfileId = normalizePaperPrintProductionSpec(document.printProduction).outputIntentProfileAssetId;
  for (const profile of (document.managedIccProfiles ?? []).filter((candidate) => candidate.id === selectedProfileId)) {
    if (isPaperManagedIccProfile(profile)) add(profile.asset);
  }
  return [...references.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function addIssue(issues: PaperProductionIssue[], issue: PaperProductionIssue): void {
  const key = [issue.code, issue.pageId ?? '', issue.objectId ?? '', issue.assetId ?? '', issue.message].join('|');
  if (!issues.some((candidate) => [candidate.code, candidate.pageId ?? '', candidate.objectId ?? '', candidate.assetId ?? '', candidate.message].join('|') === key)) {
    issues.push(issue);
  }
}

function expectedOutputCondition(document: PaperDocument): string | undefined {
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  return production.outputIntentProfileId === 'custom'
    ? production.customOutputIntentName.trim() || undefined
    : PAPER_OUTPUT_INTENT_PROFILES[production.outputIntentProfileId].printingCondition;
}

function collectRequestedSpotNames(document: PaperDocument): string[] {
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  if (production.spotColorPolicy !== 'preserve-named') return [];
  const spots = new Map((document.swatches ?? [])
    .filter((swatch) => swatch.type === 'spot')
    .map((swatch) => [swatch.id, swatch.spotName?.trim() || swatch.name]));
  const names = new Set<string>();
  for (const container of documentContainers(document)) {
    for (const frame of container.frames) {
      for (const id of [frame.fillSwatchId, frame.strokeSwatchId, frame.typography.colorSwatchId]) {
        const name = id ? spots.get(id) : undefined;
        if (name) names.add(name);
      }
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function spotNamesBySourceFrame(document: PaperDocument): Map<string, string[]> {
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  if (production.spotColorPolicy !== 'preserve-named') return new Map();
  const spots = new Map((document.swatches ?? [])
    .filter((swatch) => swatch.type === 'spot')
    .map((swatch) => [swatch.id, swatch.spotName?.trim() || swatch.name]));
  const output = new Map<string, string[]>();
  for (const container of documentContainers(document)) {
    for (const frame of container.frames) {
      const names = [frame.fillSwatchId, frame.strokeSwatchId, frame.typography.colorSwatchId]
        .flatMap((id) => id && spots.get(id) ? [spots.get(id)!] : []);
      if (names.length) output.set(frame.id, [...new Set(names)]);
    }
  }
  return output;
}

function effectivePpi(frame: PaperFrame): number | undefined {
  const width = frame.asset?.pixelWidth;
  const height = frame.asset?.pixelHeight;
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const widthIn = Math.max(0.01, frame.widthMm / 25.4);
  const heightIn = Math.max(0.01, frame.heightMm / 25.4);
  return Math.floor(Math.min(width / widthIn, height / heightIn));
}

function hasLiveFrameTransparency(frame: PaperFrame): boolean {
  const hasPaintedFill = frame.fillColor.trim().toLowerCase() !== 'transparent';
  const hasPaintedStroke = frame.strokeWidthMm > 0 && frame.strokeColor.trim().toLowerCase() !== 'transparent';
  return frame.opacity < 1
    || (hasPaintedFill && frame.fillOpacity < 1)
    || (hasPaintedStroke && frame.strokeOpacity < 1);
}

function inspectPaint(
  paint: PaperPrintPaint | undefined,
  objectId: string,
  pageId: string,
  totalInkLimitPercent: number,
  issues: PaperProductionIssue[],
): void {
  if (!paint) return;
  const totalInk = paperPrintPaintTotalInk(paint);
  if (totalInk === undefined || totalInk * 100 <= totalInkLimitPercent + 0.000001) return;
  addIssue(issues, {
    code: 'TOTAL_INK_LIMIT_EXCEEDED',
    severity: 'blocker',
    message: `${objectId} uses ${Math.round(totalInk * 10000) / 100}% total ink, above the ${totalInkLimitPercent}% production limit.`,
    pageId,
    objectId,
    fixAction: 'select-object',
  });
}

function inspectTextNode(node: PaperRenderTextNode, pageId: string, totalInkLimitPercent: number, issues: PaperProductionIssue[], expectedFontIds: Set<string>): void {
  for (const missing of node.composed.missingFaces) {
    addIssue(issues, {
      code: 'MISSING_MANAGED_FONT',
      severity: 'blocker',
      message: `${node.objectId} requires an exact managed ${missing.familyId} ${missing.weight}/${missing.style} face (${missing.reason}).`,
      pageId,
      objectId: node.objectId,
      fixAction: 'manage-font',
    });
  }
  for (const missing of node.composed.missingGlyphs) {
    addIssue(issues, {
      code: 'MISSING_MANAGED_GLYPH',
      severity: 'blocker',
      message: `${node.objectId} has no managed glyph for U+${missing.codePoint.toString(16).toUpperCase().padStart(4, '0')} in ${missing.faceId}.`,
      pageId,
      objectId: node.objectId,
      fixAction: 'manage-font',
    });
  }
  for (const line of node.composed.lines) {
    for (const run of line.runs) expectedFontIds.add(run.face.id);
  }
  for (const run of node.paints.runs) {
    inspectPaint(run.fill, node.objectId, pageId, totalInkLimitPercent, issues);
    inspectPaint(run.highlight, node.objectId, pageId, totalInkLimitPercent, issues);
  }
  for (const paragraph of node.paints.paragraphBoxes) {
    inspectPaint(paragraph.fill, node.objectId, pageId, totalInkLimitPercent, issues);
    for (const border of Object.values(paragraph.borders ?? {})) inspectPaint(border, node.objectId, pageId, totalInkLimitPercent, issues);
  }
  for (const paint of node.paints.emphasisMarks) inspectPaint(paint, node.objectId, pageId, totalInkLimitPercent, issues);
}

function inspectFlattenGroup(
  group: PaperFlattenGroup,
  pageId: string,
  spotsByFrame: ReadonlyMap<string, readonly string[]>,
  issues: PaperProductionIssue[],
): void {
  for (const sourceFrameId of group.sourceFrameIds) {
    for (const spotName of spotsByFrame.get(sourceFrameId) ?? []) {
      addIssue(issues, {
        code: 'UNPLATEABLE_REQUESTED_SPOT',
        severity: 'blocker',
        message: `${spotName} on ${sourceFrameId} would be flattened instead of emitted as a native separation plate.`,
        pageId,
        objectId: group.objectId,
        fixAction: 'select-object',
      });
    }
  }
}

function inspectRenderNodes(
  nodes: readonly PaperRenderNode[],
  pageId: string,
  standard: PdfxStandard,
  totalInkLimitPercent: number,
  spotsByFrame: ReadonlyMap<string, readonly string[]>,
  issues: PaperProductionIssue[],
  expectedFontIds: Set<string>,
): void {
  for (const node of nodes) {
    if (node.kind === 'path') {
      inspectPaint(node.fill, node.objectId, pageId, totalInkLimitPercent, issues);
      inspectPaint(node.stroke, node.objectId, pageId, totalInkLimitPercent, issues);
      const hasLiveTransparency = node.opacity < 1
        || (node.fill !== undefined && node.fillOpacity < 1)
        || (node.stroke !== undefined && node.strokeWidthPt > 0 && node.strokeOpacity < 1);
      if (standard === 'pdf-x-1a' && hasLiveTransparency) {
        addIssue(issues, {
          code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED',
          severity: 'blocker',
          message: `${node.objectId} contains live transparency that PDF/X-1a cannot retain.`,
          pageId,
          objectId: node.objectId,
          fixAction: 'select-object',
        });
      }
      continue;
    }
    if (node.kind === 'text') {
      inspectTextNode(node, pageId, totalInkLimitPercent, issues, expectedFontIds);
      if (standard === 'pdf-x-1a' && node.opacity < 1) {
        addIssue(issues, {
          code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED',
          severity: 'blocker',
          message: `${node.objectId} contains live text transparency that PDF/X-1a cannot retain.`,
          pageId,
          objectId: node.objectId,
          fixAction: 'select-object',
        });
      }
      continue;
    }
    if (node.kind === 'image') {
      if (standard === 'pdf-x-1a' && node.opacity < 1) {
        addIssue(issues, {
          code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED',
          severity: 'blocker',
          message: `${node.objectId} contains live image transparency that PDF/X-1a cannot retain.`,
          pageId,
          objectId: node.objectId,
          fixAction: 'select-object',
        });
      }
      continue;
    }
    inspectFlattenGroup(node, pageId, spotsByFrame, issues);
    inspectRenderNodes(node.children, pageId, standard, totalInkLimitPercent, spotsByFrame, issues, expectedFontIds);
  }
}

function generationFailureIssue(error: unknown): PaperProductionIssue {
  const message = error instanceof Error ? error.message : 'The PDF/X generator failed before validation.';
  const normalized = message.toLowerCase();
  if (normalized.includes('glyph')) {
    return { code: 'MISSING_MANAGED_GLYPH', severity: 'blocker', message, fixAction: 'manage-font' };
  }
  if (normalized.includes('font')) {
    return { code: 'MISSING_MANAGED_FONT', severity: 'blocker', message, fixAction: 'manage-font' };
  }
  if (normalized.includes('total ink')) {
    return { code: 'TOTAL_INK_LIMIT_EXCEEDED', severity: 'blocker', message, fixAction: 'select-object' };
  }
  if (normalized.includes('transparency')) {
    return { code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED', severity: 'blocker', message, fixAction: 'select-object' };
  }
  if (normalized.includes('profile')) {
    return { code: 'MISSING_EXACT_PROFILE', severity: 'blocker', message, fixAction: 'manage-profile' };
  }
  return { code: 'PDFX_GENERATION_FAILED', severity: 'blocker', message };
}

export function freezePaperProductionInput(document: PaperDocument): FrozenPaperProductionInput {
  const frozen = cloneDocument(document);
  return {
    document: frozen,
    revision: Number.isFinite(frozen.updatedAt) ? frozen.updatedAt : 0,
    assetIds: assetReferences(frozen).map((reference) => reference.id),
  };
}

async function preflightFrozenPaperProduction(
  frozen: FrozenPaperProductionInput,
  options: PaperProductionPreflightOptions,
): Promise<PaperProductionPreflightReport> {
  const { document } = frozen;
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  const issues: PaperProductionIssue[] = [];
  const expectedFontIds = new Set<string>();
  const requestedSpotNames = collectRequestedSpotNames(document);
  const imagePpi: PaperProductionImagePpi[] = [];
  const outputIntent = PAPER_OUTPUT_INTENT_PROFILES[production.outputIntentProfileId];
  const selectedProfileId = production.outputIntentProfileAssetId;
  const selectedProfile = selectedProfileId
    ? document.managedIccProfiles?.find((profile) => profile.id === selectedProfileId)
    : undefined;

  if (outputIntent.colorSpace !== 'cmyk') {
    addIssue(issues, {
      code: 'INVALID_OUTPUT_INTENT',
      severity: 'blocker',
      message: `${options.standard.toUpperCase()} requires an exact managed CMYK printer output profile.`,
      fixAction: 'manage-profile',
    });
  }
  if (!selectedProfileId) {
    addIssue(issues, {
      code: 'MISSING_EXACT_PROFILE',
      severity: 'blocker',
      message: 'No exact managed CMYK output profile is selected for this PDF/X export.',
      fixAction: 'manage-profile',
    });
  } else if (!selectedProfile || !isPaperManagedIccProfile(selectedProfile)) {
    addIssue(issues, {
      code: 'MISSING_EXACT_PROFILE',
      severity: 'blocker',
      message: `The selected managed output profile ${selectedProfileId} is unavailable in this document.`,
      assetId: selectedProfileId,
      fixAction: 'manage-profile',
    });
  } else if (expectedOutputCondition(document) && selectedProfile.outputConditionId !== expectedOutputCondition(document)) {
    addIssue(issues, {
      code: 'PROFILE_OUTPUT_CONDITION_MISMATCH',
      severity: 'blocker',
      message: `The selected profile targets ${selectedProfile.outputConditionId}, not ${expectedOutputCondition(document)}.`,
      assetId: selectedProfile.asset.id,
      fixAction: 'manage-profile',
    });
  }

  if (options.assetExists) {
    for (const reference of assetReferences(document)) {
      let available = false;
      try {
        available = await options.assetExists(reference);
      } catch {
        available = false;
      }
      if (!available) {
        addIssue(issues, {
          code: 'MISSING_MANAGED_ASSET',
          severity: 'blocker',
          message: `Managed asset ${reference.id} is unavailable or no longer matches its document reference.`,
          assetId: reference.id,
          fixAction: 'relink-asset',
        });
      }
    }
  }

  const requiredPpi = Math.max(300, Math.round(options.requiredPpi ?? document.page.dpi ?? 300));
  for (const container of documentContainers(document)) {
    for (const frame of container.frames) {
      if (!options.allowFullPageFlatten) {
        // Strict output paints the STYLE-effective face, so the gate must resolve
        // paragraph/character style typography exactly like render and exact-CSS collection do.
        for (const style of textStyles(computeEffectivePaperFrame(document, frame))) {
          const { family, weight, fontStyle, selection: selected } = selectProductionManagedFont(
            style.typography,
            document,
          );
          if (selected.status !== 'selected') {
            addIssue(issues, {
              code: 'MISSING_MANAGED_FONT',
              severity: 'blocker',
              message: `${frame.label} uses ${family || 'an unnamed family'} ${weight}/${fontStyle}, but no exact managed face is available.`,
              pageId: container.id,
              objectId: frame.id,
              fixAction: 'manage-font',
            });
          } else if (selected.face.format === 'collection') {
            addIssue(issues, {
              code: 'MISSING_MANAGED_FONT',
              severity: 'blocker',
              message: `${frame.label} uses ${selected.face.familyName} from a font collection; exact browser paint requires an extracted standalone .ttf or .otf face.`,
              pageId: container.id,
              objectId: frame.id,
              assetId: selected.face.fontAsset.id,
              fixAction: 'manage-font',
            });
          } else if (!canUseManagedFontForProduction(selected.face).allowed) {
            addIssue(issues, {
              code: 'MISSING_MANAGED_FONT',
              severity: 'blocker',
              message: `${frame.label} uses ${selected.face.familyName}, whose managed font rights do not permit this production output.`,
              pageId: container.id,
              objectId: frame.id,
              assetId: selected.face.fontAsset.id,
              fixAction: 'manage-font',
            });
          } else {
            expectedFontIds.add(selected.face.id);
          }
        }
      }

      if (frame.kind === 'image') {
        if (!frame.asset?.locator || frame.asset.locator.kind !== 'managed') {
          addIssue(issues, {
            code: 'MISSING_MANAGED_ASSET',
            severity: 'blocker',
            message: `${frame.label} is not backed by a managed binary asset for strict PDF/X export.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'relink-asset',
          });
        }
        const ppi = effectivePpi(frame);
        imagePpi.push({
          pageId: container.id,
          objectId: frame.id,
          label: frame.label,
          effectivePpi: ppi ?? 0,
          requiredPpi,
          printReady: ppi !== undefined && ppi >= requiredPpi,
        });
        if (ppi === undefined || ppi < requiredPpi) {
          addIssue(issues, {
            code: 'INSUFFICIENT_PPI',
            severity: options.allowFullPageFlatten ? 'warning' : 'blocker',
            message: options.allowFullPageFlatten
              ? `${frame.label} is ${ppi === undefined ? 'missing usable pixel dimensions' : `${ppi} effective PPI`}; the flattened KDP page is ${requiredPpi} DPI, but this source remains below the recommended placement resolution.`
              : `${frame.label} is ${ppi === undefined ? 'missing usable pixel dimensions' : `${ppi} effective PPI`}; strict PDF/X requires at least ${requiredPpi} PPI at placement.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'upscale-image',
          });
        }
      }

      if (frame.kind === 'barcode') {
        const geometry = buildPaperBarcodeGeometry(frame.barcode, frame.widthMm, frame.heightMm);
        if (geometry.resolution.status === 'invalid') {
          addIssue(issues, {
            code: 'BARCODE_VALUE_INVALID',
            severity: 'blocker',
            message: `${frame.label} does not resolve to a valid ISBN-10/ISBN-13/EAN-13 value, so no standards-correct symbol can be generated.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'select-object',
          });
        }
        if (geometry.resolution.status === 'valid' && !(frame.barcode?.showHumanReadable ?? true)) {
          addIssue(issues, {
            code: 'BARCODE_HRI_HIDDEN',
            severity: 'blocker',
            message: `${frame.label} hides the human-readable interpretation digits; GS1 requires all 13 digits to print below an EAN-13 symbol, so strict standards-aware export cannot proceed with them hidden.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'select-object',
          });
        }
        const size = paperBarcodePhysicalSizeStatus(geometry);
        if (!(frame.widthMm > 0 && frame.heightMm > 0) || !size.magnificationInRange) {
          addIssue(issues, {
            code: 'BARCODE_PHYSICAL_SIZE_INVALID',
            severity: 'blocker',
            message: `${frame.label} scales to ${Math.round(size.magnification * 100)}% magnification; GS1 permits 80-200% without a printer waiver.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'select-object',
          });
        } else if (!size.heightNominal) {
          addIssue(issues, {
            code: 'BARCODE_HEIGHT_TRUNCATED',
            severity: 'warning',
            message: `${frame.label} has ${geometry.barHeightMm.toFixed(2)} mm data bars, under the nominal proportion for its magnification; truncated symbols scan less reliably.`,
            pageId: container.id,
            objectId: frame.id,
            fixAction: 'select-object',
          });
        }
        const quietQuads = paperBarcodeQuietZoneQuads(frame);
        for (const other of container.frames) {
          if (other.id === frame.id || !paperFrameCarriesPrintedInk(other)) continue;
          const otherQuad = paperFrameInkQuad(other);
          if (quietQuads.some((quad) => paperBarcodeQuadsOverlap(quad, otherQuad))) {
            addIssue(issues, {
              code: 'BARCODE_QUIET_ZONE_INSUFFICIENT',
              severity: 'blocker',
              message: `${other.label || 'Another frame'} prints inside ${frame.label}'s reserved quiet zone; GS1 requires the ${size.leftQuietZoneMm.toFixed(2)} mm left and ${size.rightQuietZoneMm.toFixed(2)} mm right zones to stay clear of ink.`,
              pageId: container.id,
              objectId: frame.id,
              fixAction: 'select-object',
            });
          }
        }
      }

      if (options.standard === 'pdf-x-1a' && !options.allowFullPageFlatten && hasLiveFrameTransparency(frame)) {
        addIssue(issues, {
          code: 'PDFX1A_TRANSPARENCY_UNSUPPORTED',
          severity: 'blocker',
          message: `${frame.label} uses live opacity; PDF/X-1a requires an explicit flattening result before export.`,
          pageId: container.id,
          objectId: frame.id,
          fixAction: 'select-object',
        });
      }
    }
  }

  if (options.renderPlan) {
    if (options.renderPlan.documentId !== document.id || options.renderPlan.revision !== frozen.revision) {
      addIssue(issues, {
        code: 'STALE_RENDER_PLAN',
        severity: 'blocker',
        message: 'The generated render plan does not match the frozen document revision.',
      });
    } else {
      const spotsByFrame = spotNamesBySourceFrame(document);
      for (const page of options.renderPlan.pages) {
        const nodes = page.background ? [page.background, ...page.nodes] : page.nodes;
        inspectRenderNodes(nodes, page.pageId, options.standard, production.totalInkLimitPercent, spotsByFrame, issues, expectedFontIds);
      }
    }
  }

  const orderedIssues = issues.sort((left, right) => {
    const leftKey = `${left.severity}:${left.code}:${left.pageId ?? ''}:${left.objectId ?? ''}:${left.message}`;
    const rightKey = `${right.severity}:${right.code}:${right.pageId ?? ''}:${right.objectId ?? ''}:${right.message}`;
    return leftKey.localeCompare(rightKey);
  });
  return {
    documentId: document.id,
    revision: frozen.revision,
    standard: options.standard,
    assetIds: [...frozen.assetIds],
    expectedFontIds: [...expectedFontIds].sort(),
    requestedSpotNames,
    imagePpi: imagePpi.sort((left, right) => `${left.pageId}:${left.objectId}`.localeCompare(`${right.pageId}:${right.objectId}`)),
    issues: orderedIssues,
    pass: !orderedIssues.some((issue) => issue.severity === 'blocker'),
  };
}

export async function preflightPaperProduction(
  document: PaperDocument,
  options: PaperProductionPreflightOptions,
): Promise<PaperProductionPreflightReport> {
  return preflightFrozenPaperProduction(freezePaperProductionInput(document), options);
}

/**
 * Generate only after frozen-input preflight passes, then validate generated bytes/evidence before a download
 * callback is invoked. The callback is deliberately last so a failed PDF/X can never become a saved file.
 */
export async function exportValidatedPaperPdfx(
  document: PaperDocument,
  dependencies: ExportValidatedPaperPdfxDependencies,
): Promise<ValidatedPaperPdfxResult> {
  const frozen = freezePaperProductionInput(document);
  const initialPreflight = await preflightFrozenPaperProduction(frozen, dependencies);
  if (!initialPreflight.pass) return { status: 'blocked', issues: initialPreflight.issues };

  let result: PdfxExportResult;
  try {
    result = await dependencies.generate(frozen.document);
  } catch (error) {
    return { status: 'blocked', issues: [...initialPreflight.issues, generationFailureIssue(error)] };
  }

  const renderPlan = dependencies.renderPlan ?? result.renderPlan;
  const finalPreflight = renderPlan
    ? await preflightFrozenPaperProduction(frozen, { ...dependencies, renderPlan })
    : initialPreflight;
  let validation: PdfxValidationReport;
  try {
    validation = await dependencies.validate(result.bytes, { standard: dependencies.standard });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The internal PDF/X structural validator failed.';
    return {
      status: 'blocked',
      issues: [...finalPreflight.issues, { code: 'PDFX_VALIDATION_FAILED', severity: 'blocker', message }],
    };
  }

  const report = createPaperProductionExportReport({ preflight: finalPreflight, result, validation });
  if (!report.pass) return { status: 'blocked', issues: report.blockers, report };
  await dependencies.download(result.bytes);
  return { status: 'saved', bytes: result.bytes, report };
}
