export type PaperAuditSeverity = 'critical' | 'high' | 'medium' | 'low';
export type PaperAuditStatus = 'reproduced' | 'fixed' | 'verified' | 'external-pending';

export interface PaperProductionAuditEntry {
  id: string;
  severity: PaperAuditSeverity;
  status: PaperAuditStatus;
  commercial: boolean;
  summary: string;
  evidence: string[];
  tests: string[];
}

export const PAPER_PROJECT_1_AUDIT: readonly PaperProductionAuditEntry[] = [
  { id: 'asset-inline-base64', severity: 'high', status: 'verified', commercial: false, summary: 'Strict Paper documents, project snapshots, and .slppr manifests hold content-addressed asset references; Base64/data URLs are legacy migration input or transient export boundaries only.', evidence: ['PaperDocumentAssets.migrateLegacyPaperDocumentAssets', 'PaperDocument.stripPaperRuntimeAssetData', 'SlpprFormat.v2 asset ZIP entries'], tests: ['contentAddressedAsset.test.ts', 'PaperDocumentAssets.test.ts', 'SlpprFormat.test.ts', 'paperDocument.test.ts'] },
  { id: 'font-system-authority', severity: 'critical', status: 'verified', commercial: true, summary: 'Strict PDF/X and print-ready output requires exact, rights-cleared managed faces and consumes the same deterministic composed glyph runs as the editor; browser/system names cannot authorize export.', evidence: ['paperManagedFonts.resolveExactPaperManagedFace', 'paperTextComposition.composePaperRichText', 'paperProductionPreflight'], tests: ['paperManagedFonts.test.ts', 'paperTextShaper.test.ts', 'paperTextComposition.test.ts', 'paperProductionPreflight.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'icc-profile-substitution', severity: 'critical', status: 'verified', commercial: true, summary: 'Strict PDF/X resolves only the selected, hash-verified managed ICC asset; no output-condition fallback remains.', evidence: ['paperManagedIccProfiles.resolveExactPaperOutputProfile', 'PaperIccProfileManager'], tests: ['paperManagedIccProfiles.test.ts', 'paperProductionPreflight.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'process-cmyk-roundtrip', severity: 'critical', status: 'verified', commercial: true, summary: 'Authored process CMYK and gray are emitted as native PDF operators from the frozen render plan; image conversion is limited to managed RGB artwork and never rewrites authored CMYK.', evidence: ['paperRenderPlan', 'paperPdfxNativeContent', 'paperInkLimit'], tests: ['paperRenderPlan.test.ts', 'paperPdfxNativeContent.test.ts', 'paperProductionPreflight.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'spot-rich-text-overclaim', severity: 'high', status: 'verified', commercial: true, summary: 'Strict preflight and export share a frozen render plan; requested named spots must appear in generated native evidence or PDF/X saving is blocked.', evidence: ['paperProductionPreflight', 'paperProductionReport', 'paperPdfxNativeContent'], tests: ['paperProductionPreflight.test.ts', 'paperProductionReport.test.ts', 'paperPdfxNativeContent.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'overprint-not-emitted', severity: 'high', status: 'verified', commercial: true, summary: 'Supported print nodes emit PDF ExtGState overprint operators and generated native evidence reports the preserved objects.', evidence: ['paperPdfxNativeContent.graphicsState', 'paperProductionReport.overprintObjects'], tests: ['paperPdfxNativeContent.test.ts', 'paperProductionReport.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'pdfx-download-after-failure', severity: 'critical', status: 'verified', commercial: true, summary: 'Strict PDF/X generation freezes inputs, preflights and validates in memory, and invokes the download adapter only for a passing saved transaction.', evidence: ['exportValidatedPaperPdfx', 'PaperWorkspaceUtils.exportPaperPdfxAndSave', 'paperPdfxValidate'], tests: ['paperProductionPreflight.test.ts', 'paperProductionReport.test.ts', 'PaperWorkspaceUtils.test.ts', 'paperProductionGolden.test.ts'] },
  { id: 'stability-provider-contract', severity: 'high', status: 'verified', commercial: false, summary: 'Paper validates Stability input limits, blocks an unconfigured BYOK provider before a paid call, and stores only verified binary provider output.', evidence: ['paperStabilityUpscale', 'paperStabilitySource', 'docs/audits/paper-stability-live-2026-07-14.md'], tests: ['paperStabilityUpscale.test.ts', 'paperStabilitySource.test.ts', 'paperProductionAudit.test.ts'] },
  { id: 'stability-effective-ppi', severity: 'critical', status: 'verified', commercial: true, summary: 'Paper records provider dimensions and achieved placed PPI without locally fitting Stability output; live Fast and Conservative results both replaced the frame and met the 300 PPI print target.', evidence: ['buildPaperManagedPrintUpscaledFramePatch', 'PaperStabilityPrintUpscaleEvidence', 'paperPreflight', 'docs/audits/paper-stability-live-2026-07-14.md'], tests: ['paperStabilityUpscale.test.ts', 'paperImageUpscale.test.ts', 'paperPreflight.test.ts', 'paperProductionAudit.test.ts'] },
] as const;

export function paperAuditEntry(id: string): PaperProductionAuditEntry | undefined {
  return PAPER_PROJECT_1_AUDIT.find((entry) => entry.id === id);
}
