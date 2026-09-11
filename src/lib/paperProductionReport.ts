// Evidence report for a completed in-memory PDF/X transaction. This records what Sloom Studio verified
// structurally; it deliberately does not represent a third-party RIP or ISO conformance certification.

import type { PdfxExportResult, PdfxStandard } from './paperPdfxExport';
import type { PdfxValidationReport } from './paperPdfxValidate';
import type {
  PaperProductionImagePpi,
  PaperProductionIssue,
  PaperProductionPreflightReport,
} from './paperProductionPreflight';

export interface PaperProductionExportReport {
  standard: PdfxStandard;
  documentId: string;
  revision: number;
  assetIds: readonly string[];
  preflight: PaperProductionPreflightReport;
  validation: PdfxValidationReport;
  processObjects: readonly string[];
  spotPlates: readonly string[];
  embeddedFonts: readonly string[];
  flattenedObjects: readonly string[];
  overprintObjects: readonly string[];
  imagePpi: readonly PaperProductionImagePpi[];
  blockers: PaperProductionIssue[];
  warnings: PaperProductionIssue[];
  information: PaperProductionIssue[];
  pass: boolean;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function addIssue(target: PaperProductionIssue[], issue: PaperProductionIssue): void {
  const key = `${issue.code}:${issue.objectId ?? ''}:${issue.assetId ?? ''}:${issue.message}`;
  if (!target.some((candidate) => `${candidate.code}:${candidate.objectId ?? ''}:${candidate.assetId ?? ''}:${candidate.message}` === key)) {
    target.push(issue);
  }
}

export function createPaperProductionExportReport(input: {
  preflight: PaperProductionPreflightReport;
  result: PdfxExportResult;
  validation: PdfxValidationReport;
}): PaperProductionExportReport {
  const { preflight, result, validation } = input;
  const issues = [...preflight.issues];
  if (result.standard !== preflight.standard) {
    addIssue(issues, {
      code: 'WRONG_PDFX_STANDARD',
      severity: 'blocker',
      message: `The generator returned ${result.standard}, but this transaction requires ${preflight.standard}.`,
    });
  }
  if (result.approximateColor) {
    addIssue(issues, {
      code: 'APPROXIMATE_COLOR_TRANSFORM',
      severity: 'blocker',
      message: 'The generated PDF used an approximate RGB-to-CMYK transform instead of the selected exact ICC transform.',
      fixAction: 'manage-profile',
    });
  }
  for (const check of validation.checks.filter((candidate) => !candidate.pass)) {
    addIssue(issues, {
      code: `PDFX_VALIDATION_${check.id.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`,
      severity: 'blocker',
      message: check.detail ? `${check.label}: ${check.detail}` : check.label,
    });
  }

  const embeddedFontIds = new Set(result.nativeEvidence.embeddedFontIds);
  for (const fontId of preflight.expectedFontIds) {
    if (embeddedFontIds.has(fontId)) continue;
    addIssue(issues, {
      code: 'FONT_NOT_EMBEDDED',
      severity: 'blocker',
      message: `Managed font ${fontId} was expected in the native PDF output but is absent from export evidence.`,
      fixAction: 'manage-font',
    });
  }

  const spotPlates = new Set(result.nativeEvidence.spotPlates.map((plate) => plate.name));
  for (const spotName of preflight.requestedSpotNames) {
    if (spotPlates.has(spotName)) continue;
    addIssue(issues, {
      code: 'SPOT_NOT_PLATED',
      severity: 'blocker',
      message: `Requested spot ${spotName} is absent from the native separation evidence.`,
      fixAction: 'select-object',
    });
  }

  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const information = issues.filter((issue) => issue.severity === 'information');
  return {
    standard: preflight.standard,
    documentId: preflight.documentId,
    revision: preflight.revision,
    assetIds: [...preflight.assetIds],
    preflight,
    validation,
    processObjects: unique(result.nativeEvidence.processObjectIds),
    spotPlates: unique(result.nativeEvidence.spotPlates.map((plate) => plate.name)),
    embeddedFonts: unique(result.nativeEvidence.embeddedFontIds),
    flattenedObjects: unique(result.nativeEvidence.flattenedObjectIds.map((entry) => entry.objectId)),
    overprintObjects: unique(result.nativeEvidence.overprintObjectIds),
    imagePpi: (preflight.imagePpi ?? []).map((entry) => ({ ...entry })),
    blockers,
    warnings,
    information,
    pass: blockers.length === 0,
  };
}

export function formatProductionValidationStatus(report: PaperProductionExportReport): string {
  const label = report.standard === 'pdf-x-1a' ? 'PDF/X-1a' : 'PDF/X-4';
  if (!report.pass) {
    const summary = report.blockers.slice(0, 3).map((issue) => issue.message).join('; ');
    return `${label} export blocked: ${summary || 'production validation did not pass.'}`;
  }
  return `Structurally verified ${label} with Sloom Studio's internal checks; complete a press/RIP review before production.`;
}
