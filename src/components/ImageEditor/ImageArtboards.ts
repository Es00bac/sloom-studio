import type {
  ImageColorProofIntent,
  ImageColorProofMode,
  ImageArtboardMetadata,
  ImageArtboardPageMetadata,
  ImageArtboardPagePreset,
  ImageArtboardsMetadata,
  ImageDocument,
} from '../../types/imageEditor';

const MM_PER_INCH = 25.4;
const DEFAULT_IMAGE_ARTBOARD_DPI = 300;
const DEFAULT_IMAGE_ARTBOARD_BLEED_MM = 3;
const DEFAULT_IMAGE_ARTBOARD_SAFE_AREA_MM = 3;
const DEFAULT_IMAGE_ARTBOARD_PROOF_LABEL = 'Screen review';

export const IMAGE_ARTBOARD_PAGE_PRESETS: Array<{
  value: ImageArtboardPagePreset;
  label: string;
  widthMm: number;
  heightMm: number;
}> = [
  { value: 'custom', label: 'Custom', widthMm: 0, heightMm: 0 },
  { value: 'us-letter', label: 'US Letter', widthMm: 215.9, heightMm: 279.4 },
  { value: 'us-legal', label: 'US Legal', widthMm: 215.9, heightMm: 355.6 },
  { value: 'tabloid', label: 'Tabloid', widthMm: 279.4, heightMm: 431.8 },
  { value: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { value: 'a5', label: 'A5', widthMm: 148, heightMm: 210 },
  { value: 'comic-book', label: 'Comic Book', widthMm: 171.45, heightMm: 263.525 },
];

export interface ImageArtboardPrintBounds {
  trimWidthPx: number;
  trimHeightPx: number;
  bleedWidthPx: number;
  bleedHeightPx: number;
  bleedInsetPx: number;
}

export interface ImageArtboardPrintStatus {
  id: string;
  name: string;
  proofLabel: string;
  pageLabel: string;
  targetDpi: number;
  actualPpi: number;
  bounds: ImageArtboardPrintBounds;
  warnings: string[];
}

export interface ImageArtboardsPrintStatus {
  activeArtboardId: string | null;
  artboards: ImageArtboardPrintStatus[];
  warnings: string[];
}

export interface ImageArtboardDocumentRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

export interface ImageArtboardPrintProofChecks {
  trimInsideDocument: boolean;
  safeAreaInsideTrim: boolean;
  bleedInsideDocument: boolean;
  meetsTargetDpi: boolean;
}

export interface ImageArtboardPageBoxDescriptor {
  label: string;
  documentRect: ImageArtboardDocumentRect;
  clipped: boolean;
}

export interface ImageArtboardPageBoxes {
  mediaBox: ImageArtboardPageBoxDescriptor;
  bleedBox: ImageArtboardPageBoxDescriptor;
  trimBox: ImageArtboardPageBoxDescriptor;
  safeBox: ImageArtboardPageBoxDescriptor;
}

export interface ImageArtboardPrintProofDescriptor {
  id: string;
  name: string;
  proofLabel: string;
  pageLabel: string;
  targetDpi: number;
  actualPpi: number;
  bounds: ImageArtboardPrintBounds;
  trim: {
    documentRect: ImageArtboardDocumentRect;
    targetWidthPx: number;
    targetHeightPx: number;
  };
  safeArea: {
    insetMm: number;
    insetPx: number;
    documentRect: ImageArtboardDocumentRect;
  };
  bleed: {
    insetMm: number;
    insetPx: number;
    requestedDocumentRect: ImageArtboardDocumentRect;
    clippedDocumentRect: ImageArtboardDocumentRect;
  };
  pageBoxes: ImageArtboardPageBoxes;
  checks: ImageArtboardPrintProofChecks;
  warnings: string[];
}

export interface ImageArtboardLayoutEntry {
  id: string;
  name: string;
  sourceIndex: number;
  layoutOrder: number;
  active: boolean;
  proofLabel: string;
  pageLabel: string;
  page: ImageArtboardPageMetadata;
  documentRect: ImageArtboardDocumentRect;
  printBounds: ImageArtboardPrintBounds;
  proof: ImageArtboardPrintProofDescriptor;
  warnings: string[];
}

export interface ImageArtboardsLayoutPlan {
  activeArtboardId: string | null;
  documentRect: ImageArtboardDocumentRect;
  artboards: ImageArtboardLayoutEntry[];
  warnings: string[];
}

export interface ImageArtboardExportPlanEntry {
  id: string;
  name: string;
  sequence: number;
  filenameStem: string;
  groupKey: string;
  groupLabel: string;
  preview: ImageArtboardPreviewDescriptor;
  layout: ImageArtboardLayoutEntry;
  proof: ImageArtboardPrintProofDescriptor;
  warnings: string[];
}

export interface ImageArtboardBatchExportGroup {
  key: string;
  label: string;
  proofLabel: string;
  pageLabel: string;
  targetDpi: number;
  bleedMm: number;
  artboards: ImageArtboardExportPlanEntry[];
  warnings: string[];
}

export interface ImageArtboardsExportPlan {
  activeArtboardId: string | null;
  artboards: ImageArtboardExportPlanEntry[];
  groups: ImageArtboardBatchExportGroup[];
  previewSignature: string;
  printProduction: ImageArtboardPrintProductionDescriptor;
  warnings: string[];
}

export interface ImageArtboardPreviewDescriptor {
  id: string;
  signature: string;
  label: string;
  trimCssRect: ImageArtboardPreviewRect;
  bleedCssRect: ImageArtboardPreviewRect;
}

export interface ImageArtboardPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageArtboardUnsupportedProductionFeature {
  supported: false;
  warnings: string[];
}

export interface ImageArtboardPrintProductionDescriptor {
  pageCount: number;
  supportsMultiArtboardExport: boolean;
  unsupported: {
    imposition: ImageArtboardUnsupportedProductionFeature;
    packageForPrint: ImageArtboardUnsupportedProductionFeature;
  };
}

export interface ImageArtboardReadinessChecks {
  trimReady: boolean;
  bleedReady: boolean;
  safeAreaReady: boolean;
  dpiReady: boolean;
  printReady: boolean;
}

export type ImageArtboardReadinessBlockerCode =
  | 'missing-artboard-metadata'
  | 'invalid-artboard-metadata'
  | 'artboard-trim-outside-document'
  | 'artboard-bleed-outside-document'
  | 'artboard-safe-box-outside-document';

export interface ImageArtboardReadinessBlocker {
  code: ImageArtboardReadinessBlockerCode;
  severity: 'blocker';
  summary: string;
}

export interface ImageArtboardSuitabilitySummary {
  export: string;
  proof: string;
}

export interface ImageArtboardReadinessExportName {
  filenameStem: string;
  recommendedBasename: string;
  recommendedExtensions: string[];
}

export interface ImageArtboardHandoffReadiness {
  ready: boolean;
  mode: string;
  warnings: string[];
}

export interface ImageArtboardActionReadiness {
  ready: boolean;
  mode: string;
  warnings: string[];
}

export interface ImageArtboardActionSuitability {
  recordable: boolean;
  replaySafe: boolean;
  descriptor: ImageArtboardActionReadiness;
}

export interface ImageArtboardsActionSuitability {
  recordable: ImageArtboardActionReadiness;
}

export interface ImageArtboardBatchOperationReadiness {
  ready: boolean;
  mode: string;
  warnings: string[];
}

export interface ImageArtboardBatchSuitability {
  exportSelected: ImageArtboardBatchOperationReadiness;
  printProof: ImageArtboardBatchOperationReadiness;
}

export type ImageArtboardBatchExportFormat = 'png' | 'jpg' | 'webp';
export type ImageArtboardBatchExportDisposition = 'export-print-proof' | 'export-review-only' | 'blocked';

export interface ImageArtboardBatchExportPlanItem {
  artboardId: string;
  sequence: number;
  filenameStem: string;
  recommendedBasename: string;
  resolvedBasename: string;
  filenamePolicy: ImageArtboardFilenameCollisionPolicy;
  formats: ImageArtboardBatchExportFormat[];
  outputs: ImageArtboardBatchExportOutput[];
  exportReady: boolean;
  printProofReady: boolean;
  disposition: ImageArtboardBatchExportDisposition;
  warnings: string[];
  signature: string;
}

export interface ImageArtboardBatchExportOutput {
  format: ImageArtboardBatchExportFormat;
  filename: string;
}

export interface ImageArtboardBatchExportPlanGroup {
  key: string;
  label: string;
  itemIds: string[];
  exportableCount: number;
  printProofReadyCount: number;
}

export interface ImageArtboardsBatchExportPlanDescriptor {
  mode: 'batch-export-artboards';
  formats: ImageArtboardBatchExportFormat[];
  outputPattern: '{basename}.{ext}';
  totalCount: number;
  exportableCount: number;
  printProofReadyCount: number;
  blockedCount: number;
  groups: ImageArtboardBatchExportPlanGroup[];
  items: ImageArtboardBatchExportPlanItem[];
  warnings: string[];
  signature: string;
}

export interface ImageArtboardFilenameCollisionPolicy {
  strategy: 'sequence-prefix-then-numeric-suffix';
  candidateBasename: string;
  resolvedBasename: string;
  collisionIndex: number;
  reservedBasenames: string[];
  warnings: string[];
  signature: string;
}

export interface ImageArtboardRasterExportBounds {
  sourceTrimRect: ImageArtboardDocumentRect;
  sourceBleedRect: ImageArtboardDocumentRect;
  outputTrimSizePx: { width: number; height: number };
  outputBleedSizePx: { width: number; height: number };
  bleedClipped: boolean;
  trimScale: { x: number; y: number };
  cropPolicy: 'clip-bleed-to-document-pixels';
  backgroundPolicy: 'transparent-extended-bleed-required';
  signature: string;
}

export interface ImageArtboardProofProfileDescriptor {
  mode: ImageColorProofMode;
  intent: ImageColorProofIntent;
  profileLabel: string | null;
  embeddedIccProfile: false;
  conversionApplied: false;
  warnings: string[];
  signature: string;
}

export type ImageArtboardUnsupportedStateCode =
  | 'auto-bleed-extension'
  | 'image-slices'
  | 'printer-marks-pdfx'
  | 'true-contract-proof';

export interface ImageArtboardUnsupportedState {
  code: ImageArtboardUnsupportedStateCode;
  supported: false;
  severity: 'unsupported';
  message: string;
}

export interface ImageArtboardPrintExportReadinessEntry {
  id: string;
  name: string;
  sequence: number;
  active: boolean;
  proofLabel: string;
  pageLabel: string;
  bounds: {
    trim: ImageArtboardDocumentRect;
    bleed: ImageArtboardDocumentRect;
    safeArea: ImageArtboardDocumentRect;
  };
  exportBounds: ImageArtboardRasterExportBounds;
  pageBoxes: ImageArtboardPageBoxes;
  readiness: ImageArtboardReadinessChecks;
  blockers: ImageArtboardReadinessBlocker[];
  suitability: ImageArtboardSuitabilitySummary;
  exportName: ImageArtboardReadinessExportName;
  filenamePolicy: ImageArtboardFilenameCollisionPolicy;
  handoff: {
    paper: ImageArtboardHandoffReadiness;
    sourceBin: ImageArtboardHandoffReadiness;
    packageForPrint: ImageArtboardHandoffReadiness;
  };
  actions: ImageArtboardActionSuitability;
  batch: ImageArtboardBatchSuitability;
  warnings: string[];
  signature: string;
}

export interface ImageArtboardsPrintExportReadinessOptions {
  reservedBasenames?: string[];
}

export interface ImageArtboardsPrintExportReadiness {
  summary: {
    artboardCount: number;
    blockedArtboardCount: number;
    activeArtboardId: string | null;
    documentBounds: ImageArtboardDocumentRect;
    combinedTrimBounds: ImageArtboardDocumentRect;
    combinedBleedBounds: ImageArtboardDocumentRect;
  };
  artboards: ImageArtboardPrintExportReadinessEntry[];
  handoff: {
    paper: ImageArtboardHandoffReadiness & { pageCount: number };
    sourceBin: ImageArtboardHandoffReadiness & { assetCount: number };
    packageForPrint: ImageArtboardHandoffReadiness;
  };
  proofProfile: ImageArtboardProofProfileDescriptor;
  actions: ImageArtboardsActionSuitability;
  batch: {
    exportAll: ImageArtboardBatchOperationReadiness;
    printProof: ImageArtboardBatchOperationReadiness;
  };
  batchPlan: ImageArtboardsBatchExportPlanDescriptor;
  unsupportedStates: ImageArtboardUnsupportedState[];
  caveats: {
    imposition: ImageArtboardUnsupportedProductionFeature;
    nativePsdArtboards: ImageArtboardUnsupportedProductionFeature;
  };
  warnings: string[];
  signature: string;
}

type UnknownArtboardsMetadata = Partial<ImageArtboardsMetadata> | null | undefined;
type UnknownArtboardMetadata = Partial<ImageArtboardMetadata> | null | undefined;

interface ImageArtboardMetadataDiagnostics {
  missingArtboardMetadataIds: Set<string>;
  invalidArtboardMetadataIds: Set<string>;
}

const IMAGE_ARTBOARD_BATCH_EXPORT_FORMATS: ImageArtboardBatchExportFormat[] = ['png', 'jpg', 'webp'];

export function getImageArtboardsMetadata(doc: ImageDocument): ImageArtboardsMetadata {
  return normalizeImageArtboardsMetadata(doc, doc.metadata?.artboards);
}

export function normalizeImageArtboardsMetadata(
  doc: Pick<ImageDocument, 'width' | 'height' | 'metadata'>,
  metadata: UnknownArtboardsMetadata,
): ImageArtboardsMetadata {
  const rawArtboards = Array.isArray(metadata?.artboards) ? metadata.artboards : [];
  const artboards = rawArtboards.length > 0
    ? rawArtboards.map((artboard, index) => normalizeImageArtboard(doc, artboard, index))
    : [createImageArtboardFromDocument(doc, 0)];
  const activeArtboardId = typeof metadata?.activeArtboardId === 'string'
    && artboards.some((artboard) => artboard.id === metadata.activeArtboardId)
    ? metadata.activeArtboardId
    : artboards[0]?.id;

  return {
    ...(activeArtboardId ? { activeArtboardId } : {}),
    artboards,
  };
}

export function createImageArtboardFromDocument(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  index: number,
): ImageArtboardMetadata {
  const id = `artboard-${index + 1}`;
  return {
    id,
    name: `Artboard ${index + 1}`,
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    proofLabel: DEFAULT_IMAGE_ARTBOARD_PROOF_LABEL,
    page: {
      preset: 'custom',
      widthMm: pixelsToMm(doc.width, DEFAULT_IMAGE_ARTBOARD_DPI),
      heightMm: pixelsToMm(doc.height, DEFAULT_IMAGE_ARTBOARD_DPI),
      bleedMm: DEFAULT_IMAGE_ARTBOARD_BLEED_MM,
      dpi: DEFAULT_IMAGE_ARTBOARD_DPI,
    },
  };
}

export function applyImageArtboardsMetadata(
  doc: ImageDocument,
  metadata: UnknownArtboardsMetadata,
): ImageDocument {
  const artboards = normalizeImageArtboardsMetadata(doc, metadata);
  const current = normalizeImageArtboardsMetadata(doc, doc.metadata?.artboards);
  if (JSON.stringify(current) === JSON.stringify(artboards)) return doc;

  return {
    ...doc,
    dirty: true,
    metadata: {
      ...doc.metadata,
      artboards,
    },
  };
}

export function buildImageArtboardsPrintStatus(doc: ImageDocument): ImageArtboardsPrintStatus {
  const metadata = getImageArtboardsMetadata(doc);
  const artboards = metadata.artboards.map((artboard) => buildImageArtboardPrintStatus(doc, artboard));

  return {
    activeArtboardId: metadata.activeArtboardId ?? null,
    artboards,
    warnings: artboards.flatMap((artboard) => artboard.warnings),
  };
}

export function buildImageArtboardPrintStatus(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  artboard: ImageArtboardMetadata,
): ImageArtboardPrintStatus {
  const proof = buildImageArtboardPrintProofDescriptor(doc, artboard);

  return {
    id: artboard.id,
    name: artboard.name,
    proofLabel: proof.proofLabel,
    pageLabel: proof.pageLabel,
    targetDpi: artboard.page.dpi,
    actualPpi: proof.actualPpi,
    bounds: proof.bounds,
    warnings: proof.warnings,
  };
}

export function buildImageArtboardPrintProofDescriptor(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  artboard: ImageArtboardMetadata,
): ImageArtboardPrintProofDescriptor {
  const bounds = computeImageArtboardPrintBounds(artboard.page);
  const actualPpi = computeImageArtboardActualPpi(artboard);
  const proofLabel = artboard.proofLabel?.trim() || DEFAULT_IMAGE_ARTBOARD_PROOF_LABEL;
  const pageLabel = getImageArtboardPageLabel(artboard.page);
  const trimRect = createImageArtboardDocumentRect(
    artboard.x,
    artboard.y,
    artboard.width,
    artboard.height,
  );
  const safeInsetPx = Math.min(
    mmToPixelsAllowZero(DEFAULT_IMAGE_ARTBOARD_SAFE_AREA_MM, artboard.page.dpi),
    Math.floor(Math.min(trimRect.width, trimRect.height) / 2),
  );
  const safeRect = createImageArtboardDocumentRect(
    trimRect.x + safeInsetPx,
    trimRect.y + safeInsetPx,
    Math.max(0, trimRect.width - safeInsetPx * 2),
    Math.max(0, trimRect.height - safeInsetPx * 2),
  );
  const bleedInsetPx = mmToPixelsAllowZero(artboard.page.bleedMm, artboard.page.dpi);
  const requestedBleedRect = createImageArtboardDocumentRect(
    trimRect.x - bleedInsetPx,
    trimRect.y - bleedInsetPx,
    trimRect.width + bleedInsetPx * 2,
    trimRect.height + bleedInsetPx * 2,
  );
  const clippedBleedRect = clipImageArtboardDocumentRect(requestedBleedRect, doc);
  const checks: ImageArtboardPrintProofChecks = {
    trimInsideDocument: isImageArtboardRectInsideDocument(trimRect, doc),
    safeAreaInsideTrim: isImageArtboardRectInsideRect(safeRect, trimRect) && safeRect.width > 0 && safeRect.height > 0,
    bleedInsideDocument: isImageArtboardRectInsideDocument(requestedBleedRect, doc),
    meetsTargetDpi: actualPpi >= artboard.page.dpi,
  };
  const pageBoxes = buildImageArtboardPageBoxes(doc, trimRect, safeRect, requestedBleedRect, clippedBleedRect, checks);

  return {
    id: artboard.id,
    name: artboard.name,
    proofLabel,
    pageLabel,
    targetDpi: artboard.page.dpi,
    actualPpi,
    bounds,
    trim: {
      documentRect: trimRect,
      targetWidthPx: bounds.trimWidthPx,
      targetHeightPx: bounds.trimHeightPx,
    },
    safeArea: {
      insetMm: DEFAULT_IMAGE_ARTBOARD_SAFE_AREA_MM,
      insetPx: safeInsetPx,
      documentRect: safeRect,
    },
    bleed: {
      insetMm: artboard.page.bleedMm,
      insetPx: bleedInsetPx,
      requestedDocumentRect: requestedBleedRect,
      clippedDocumentRect: clippedBleedRect,
    },
    pageBoxes,
    checks,
    warnings: buildImageArtboardPrintProofWarnings(artboard, actualPpi, checks),
  };
}

export function buildImageArtboardsLayoutPlan(doc: ImageDocument): ImageArtboardsLayoutPlan {
  const metadata = getImageArtboardsMetadata(doc);
  const plannedArtboards = metadata.artboards
    .map((artboard, sourceIndex) => ({
      artboard,
      sourceIndex,
      proof: buildImageArtboardPrintProofDescriptor(doc, artboard),
    }))
    .sort(compareImageArtboardPlanningEntries);
  const artboards = plannedArtboards.map(({ artboard, sourceIndex, proof }, index) => ({
    id: artboard.id,
    name: artboard.name,
    sourceIndex,
    layoutOrder: index + 1,
    active: artboard.id === metadata.activeArtboardId,
    proofLabel: proof.proofLabel,
    pageLabel: proof.pageLabel,
    page: { ...artboard.page },
    documentRect: proof.trim.documentRect,
    printBounds: proof.bounds,
    proof,
    warnings: proof.warnings,
  }));

  return {
    activeArtboardId: metadata.activeArtboardId ?? null,
    documentRect: createImageArtboardDocumentRect(0, 0, doc.width, doc.height),
    artboards,
    warnings: uniqueWarnings(artboards.flatMap((artboard) => artboard.warnings)),
  };
}

export function buildImageArtboardsExportPlan(doc: ImageDocument): ImageArtboardsExportPlan {
  const layoutPlan = buildImageArtboardsLayoutPlan(doc);
  const padWidth = Math.max(2, String(layoutPlan.artboards.length).length);
  const artboards = layoutPlan.artboards.map((layout, index) => {
    const sequence = index + 1;
    const groupLabel = buildImageArtboardExportGroupLabel(layout.proof);
    return {
      id: layout.id,
      name: layout.name,
      sequence,
      filenameStem: `${String(sequence).padStart(padWidth, '0')}-${slugifyImageArtboardName(layout.name || layout.id)}`,
      groupKey: buildImageArtboardExportGroupKey(layout.proof),
      groupLabel,
      preview: buildImageArtboardPreviewDescriptor(layout, sequence, padWidth),
      layout,
      proof: layout.proof,
      warnings: layout.warnings,
    };
  });
  const groups = buildImageArtboardExportGroups(artboards);
  const printProduction = buildImageArtboardPrintProductionDescriptor(artboards.length);

  return {
    activeArtboardId: layoutPlan.activeArtboardId,
    artboards,
    groups,
    previewSignature: buildImageArtboardsPreviewSignature(doc, layoutPlan.artboards),
    printProduction,
    warnings: uniqueWarnings([
      ...artboards.flatMap((artboard) => artboard.warnings),
      ...buildImageArtboardProductionWarnings(),
    ]),
  };
}

export function buildImageArtboardsPrintExportReadiness(
  doc: ImageDocument,
  options: ImageArtboardsPrintExportReadinessOptions = {},
): ImageArtboardsPrintExportReadiness {
  const exportPlan = buildImageArtboardsExportPlan(doc);
  const documentBounds = createImageArtboardDocumentRect(0, 0, doc.width, doc.height);
  const metadataDiagnostics = analyzeImageArtboardMetadata(doc);
  const proofProfile = buildImageArtboardProofProfileDescriptor(doc);
  const unsupportedStates = buildImageArtboardUnsupportedStates();
  const filenameResolver = createImageArtboardFilenameResolver(options.reservedBasenames);
  const artboards = exportPlan.artboards.map((entry) => {
    const baseReadiness = buildImageArtboardReadinessChecks(entry.proof);
    const blockers = buildImageArtboardReadinessBlockers(doc, entry, metadataDiagnostics);
    const readiness = blockers.length > 0
      ? { ...baseReadiness, printReady: false }
      : baseReadiness;
    const exportName = buildImageArtboardReadinessExportName(entry);
    const filenamePolicy = resolveImageArtboardFilename(filenameResolver, exportName.recommendedBasename);
    const exportBounds = buildImageArtboardRasterExportBounds(entry.proof);
    const paperHandoff = buildImageArtboardPaperHandoffReadiness(readiness);
    const sourceBinHandoff = buildImageArtboardSourceBinHandoffReadiness(readiness);
    const packageHandoff = buildImageArtboardPackageHandoffReadiness();
    const actions = buildImageArtboardActionSuitability(readiness);
    const batch = buildImageArtboardBatchSuitability(readiness);
    const suitability = buildImageArtboardSuitabilitySummary(entry.proof, blockers, readiness);
    const warnings = uniqueWarnings([
      ...entry.warnings,
      ...paperHandoff.warnings,
      ...sourceBinHandoff.warnings,
      ...packageHandoff.warnings,
      ...actions.descriptor.warnings,
      ...batch.exportSelected.warnings,
      ...batch.printProof.warnings,
      ...filenamePolicy.warnings,
    ]);
    const active = entry.id === exportPlan.activeArtboardId;

    return {
      id: entry.id,
      name: entry.name,
      sequence: entry.sequence,
      active,
      proofLabel: entry.proof.proofLabel,
      pageLabel: entry.proof.pageLabel,
      bounds: {
        trim: entry.proof.trim.documentRect,
        bleed: entry.proof.bleed.clippedDocumentRect,
        safeArea: entry.proof.safeArea.documentRect,
      },
      exportBounds,
      pageBoxes: entry.proof.pageBoxes,
      readiness,
      blockers,
      suitability,
      exportName,
      filenamePolicy,
      handoff: {
        paper: paperHandoff,
        sourceBin: sourceBinHandoff,
        packageForPrint: packageHandoff,
      },
      actions,
      batch,
      warnings,
      signature: buildImageArtboardReadinessEntrySignature(entry, readiness, paperHandoff, sourceBinHandoff, packageHandoff),
    };
  });
  const paperWarnings = uniqueWarnings(artboards.flatMap((artboard) => artboard.handoff.paper.warnings));
  const sourceBinWarnings = uniqueWarnings(artboards.flatMap((artboard) => artboard.handoff.sourceBin.warnings));
  const packageWarnings = ['Package for Print is planning-only: fonts, linked assets, ICC profiles, and packaged output folders are not collected.'];
  const actionReadiness = buildImageArtboardsActionSuitability();
  const batchReadiness = buildImageArtboardsBatchReadiness(artboards);
  const batchPlan = buildImageArtboardsBatchExportPlan(exportPlan, artboards);
  const nativePsdArtboards = buildImageArtboardNativePsdArtboardCaveat();
  const imposition = buildImageArtboardImpositionCaveat();
  const warnings = uniqueWarnings([
    ...exportPlan.warnings,
    ...paperWarnings,
    ...sourceBinWarnings,
    ...packageWarnings,
    ...proofProfile.warnings,
    ...actionReadiness.recordable.warnings,
    ...batchReadiness.exportAll.warnings,
    ...batchReadiness.printProof.warnings,
    ...batchPlan.warnings,
    ...unsupportedStates.map((state) => state.message),
    ...imposition.warnings,
    ...nativePsdArtboards.warnings,
  ]);

  return {
    summary: {
      artboardCount: artboards.length,
      blockedArtboardCount: artboards.filter((artboard) => artboard.blockers.length > 0).length,
      activeArtboardId: exportPlan.activeArtboardId,
      documentBounds,
      combinedTrimBounds: combineImageArtboardDocumentRects(artboards.map((artboard) => artboard.bounds.trim)),
      combinedBleedBounds: combineImageArtboardDocumentRects(artboards.map((artboard) => artboard.bounds.bleed)),
    },
    artboards,
    handoff: {
      paper: {
        ready: artboards.every((artboard) => artboard.handoff.paper.ready),
        mode: 'export-artboards-as-paper-page-assets',
        pageCount: artboards.length,
        warnings: paperWarnings,
      },
      sourceBin: {
        ready: artboards.every((artboard) => artboard.handoff.sourceBin.ready),
        mode: 'register-flattened-artboard-assets',
        assetCount: artboards.length,
        warnings: sourceBinWarnings,
      },
      packageForPrint: {
        ready: false,
        mode: 'manual-package-required',
        warnings: packageWarnings,
      },
    },
    proofProfile,
    actions: actionReadiness,
    batch: batchReadiness,
    batchPlan,
    unsupportedStates,
    caveats: {
      imposition,
      nativePsdArtboards,
    },
    warnings,
    signature: buildImageArtboardsReadinessSignature(doc, exportPlan.artboards, artboards, proofProfile, unsupportedStates),
  };
}

export function computeImageArtboardPrintBounds(page: ImageArtboardPageMetadata): ImageArtboardPrintBounds {
  const trimWidthPx = mmToPixels(page.widthMm, page.dpi);
  const trimHeightPx = mmToPixels(page.heightMm, page.dpi);
  const bleedInsetPx = mmToPixels(page.bleedMm, page.dpi);

  return {
    trimWidthPx,
    trimHeightPx,
    bleedWidthPx: trimWidthPx + bleedInsetPx * 2,
    bleedHeightPx: trimHeightPx + bleedInsetPx * 2,
    bleedInsetPx,
  };
}

export function getImageArtboardPageLabel(page: ImageArtboardPageMetadata): string {
  const preset = IMAGE_ARTBOARD_PAGE_PRESETS.find((item) => item.value === page.preset);
  return preset?.label ?? 'Custom';
}

export function mmToPixels(mm: number, dpi: number): number {
  return Math.max(1, Math.round((Math.max(0, mm) / MM_PER_INCH) * Math.max(1, dpi)));
}

export function pixelsToMm(pixels: number, dpi: number): number {
  return roundNumber((Math.max(1, pixels) / Math.max(1, dpi)) * MM_PER_INCH, 4);
}

function normalizeImageArtboard(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  artboard: UnknownArtboardMetadata,
  index: number,
): ImageArtboardMetadata {
  const width = positiveInteger(artboard?.width, doc.width);
  const height = positiveInteger(artboard?.height, doc.height);
  const page = normalizeImageArtboardPage(
    artboard?.page,
    width,
    height,
  );

  return {
    id: typeof artboard?.id === 'string' && artboard.id.trim() ? artboard.id : `artboard-${index + 1}`,
    name: typeof artboard?.name === 'string' && artboard.name.trim() ? artboard.name.trim() : `Artboard ${index + 1}`,
    x: integerValue(artboard?.x, 0),
    y: integerValue(artboard?.y, 0),
    width,
    height,
    proofLabel: typeof artboard?.proofLabel === 'string' && artboard.proofLabel.trim()
      ? artboard.proofLabel.trim()
      : DEFAULT_IMAGE_ARTBOARD_PROOF_LABEL,
    page,
  };
}

function normalizeImageArtboardPage(
  page: Partial<ImageArtboardPageMetadata> | undefined,
  artboardWidth: number,
  artboardHeight: number,
): ImageArtboardPageMetadata {
  const dpi = positiveInteger(page?.dpi, DEFAULT_IMAGE_ARTBOARD_DPI);
  const preset = isImageArtboardPagePreset(page?.preset) ? page.preset : 'custom';
  const presetSize = IMAGE_ARTBOARD_PAGE_PRESETS.find((item) => item.value === preset);
  const widthMm = preset !== 'custom' && presetSize
    ? presetSize.widthMm
    : positiveNumber(page?.widthMm, pixelsToMm(artboardWidth, dpi));
  const heightMm = preset !== 'custom' && presetSize
    ? presetSize.heightMm
    : positiveNumber(page?.heightMm, pixelsToMm(artboardHeight, dpi));

  return {
    preset,
    widthMm: roundNumber(widthMm, 4),
    heightMm: roundNumber(heightMm, 4),
    bleedMm: roundNumber(nonNegativeNumber(page?.bleedMm, DEFAULT_IMAGE_ARTBOARD_BLEED_MM), 4),
    dpi,
  };
}

function isImageArtboardPagePreset(value: unknown): value is ImageArtboardPagePreset {
  return IMAGE_ARTBOARD_PAGE_PRESETS.some((preset) => preset.value === value);
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(1, Math.round(fallback));
  return Math.max(1, Math.round(value));
}

function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function integerValue(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.round(fallback);
  return Math.round(value);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function computeImageArtboardActualPpi(artboard: ImageArtboardMetadata): number {
  const actualPpiX = Math.round(artboard.width / (artboard.page.widthMm / MM_PER_INCH));
  const actualPpiY = Math.round(artboard.height / (artboard.page.heightMm / MM_PER_INCH));
  return Math.max(1, Math.min(actualPpiX, actualPpiY));
}

function buildImageArtboardPrintProofWarnings(
  artboard: ImageArtboardMetadata,
  actualPpi: number,
  checks: ImageArtboardPrintProofChecks,
): string[] {
  const warnings: string[] = [];

  if (artboard.page.bleedMm <= 0) {
    warnings.push('Bleed is 0 mm; edge-to-edge trims may expose white edges.');
  }
  if (artboard.page.dpi < 300) {
    warnings.push(`Target DPI is ${artboard.page.dpi}; 300 DPI remains the safer print baseline.`);
  }
  if (!checks.meetsTargetDpi) {
    warnings.push(`Artboard pixels resolve to ${actualPpi} PPI at the requested page size, below the ${artboard.page.dpi} DPI target.`);
  }
  if (!checks.trimInsideDocument) {
    warnings.push('Artboard bounds extend beyond the current Image document pixels.');
  }
  if (!checks.safeAreaInsideTrim) {
    warnings.push('Safe area collapses inside this artboard; keep important content farther from trim or enlarge the artboard.');
  }
  if (artboard.page.bleedMm > 0 && !checks.bleedInsideDocument) {
    warnings.push('Bleed area extends beyond the current Image document pixels; export will need clipping or extended edges.');
  }

  return warnings;
}

function buildImageArtboardExportGroups(
  artboards: ImageArtboardExportPlanEntry[],
): ImageArtboardBatchExportGroup[] {
  const groupMap = new Map<string, ImageArtboardBatchExportGroup>();

  for (const artboard of artboards) {
    const existing = groupMap.get(artboard.groupKey);
    if (existing) {
      existing.artboards.push(artboard);
      existing.warnings = uniqueWarnings([...existing.warnings, ...artboard.warnings]);
      continue;
    }

    groupMap.set(artboard.groupKey, {
      key: artboard.groupKey,
      label: artboard.groupLabel,
      proofLabel: artboard.proof.proofLabel,
      pageLabel: artboard.proof.pageLabel,
      targetDpi: artboard.proof.targetDpi,
      bleedMm: artboard.proof.bleed.insetMm,
      artboards: [artboard],
      warnings: uniqueWarnings(artboard.warnings),
    });
  }

  return Array.from(groupMap.values());
}

function buildImageArtboardPreviewDescriptor(
  layout: ImageArtboardLayoutEntry,
  sequence: number,
  padWidth: number,
): ImageArtboardPreviewDescriptor {
  const sequenceLabel = String(sequence).padStart(padWidth, '0');
  const slug = slugifyImageArtboardName(layout.name || layout.id);

  return {
    id: `artboard-preview-${sequenceLabel}-${slug}`,
    signature: [
      layout.id,
      sequenceLabel,
      `${layout.documentRect.x},${layout.documentRect.y},${layout.documentRect.width}x${layout.documentRect.height}`,
      layout.page.preset,
      `${layout.page.dpi}dpi`,
      `${formatMillimeters(layout.page.bleedMm)}mm`,
      slugifyImageArtboardName(layout.proofLabel),
    ].join('|'),
    label: `${sequenceLabel} ${layout.name || layout.id} - ${layout.proofLabel}`,
    trimCssRect: toImageArtboardPreviewRect(layout.proof.trim.documentRect),
    bleedCssRect: toImageArtboardPreviewRect(layout.proof.bleed.clippedDocumentRect),
  };
}

function toImageArtboardPreviewRect(rect: ImageArtboardDocumentRect): ImageArtboardPreviewRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function buildImageArtboardsPreviewSignature(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  artboards: ImageArtboardLayoutEntry[],
): string {
  return [
    `artboards:v1|${doc.width}x${doc.height}`,
    ...artboards.map((artboard) => [
      `${artboard.id}@${artboard.documentRect.x},${artboard.documentRect.y},${artboard.documentRect.width}x${artboard.documentRect.height}`,
      artboard.page.preset,
      artboard.page.dpi,
      formatMillimeters(artboard.page.bleedMm),
    ].join('/')),
  ].join('|');
}

function buildImageArtboardPrintProductionDescriptor(
  pageCount: number,
): ImageArtboardPrintProductionDescriptor {
  return {
    pageCount,
    supportsMultiArtboardExport: pageCount > 1,
    unsupported: {
      imposition: {
        supported: false,
        warnings: ['Printer spreads, n-up layouts, and booklet imposition are not generated by Image artboard export planning.'],
      },
      packageForPrint: {
        supported: false,
        warnings: ['Image artboard planning does not collect fonts, linked assets, ICC profiles, or packaged print folders.'],
      },
    },
  };
}

function buildImageArtboardProductionWarnings(): string[] {
  return [
    'Unsupported: printer spreads, n-up layouts, and booklet imposition are planning-only gaps.',
    'Unsupported: packaged print handoff must be assembled outside Image artboard export planning.',
  ];
}

function buildImageArtboardReadinessChecks(
  proof: ImageArtboardPrintProofDescriptor,
): ImageArtboardReadinessChecks {
  const bleedReady = proof.bleed.insetMm > 0 && proof.checks.bleedInsideDocument;
  const dpiReady = proof.checks.meetsTargetDpi && proof.targetDpi >= DEFAULT_IMAGE_ARTBOARD_DPI;

  return {
    trimReady: proof.checks.trimInsideDocument,
    bleedReady,
    safeAreaReady: proof.checks.safeAreaInsideTrim,
    dpiReady,
    printReady: proof.checks.trimInsideDocument && bleedReady && proof.checks.safeAreaInsideTrim && dpiReady,
  };
}

function buildImageArtboardPageBoxes(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  trimRect: ImageArtboardDocumentRect,
  safeRect: ImageArtboardDocumentRect,
  requestedBleedRect: ImageArtboardDocumentRect,
  clippedBleedRect: ImageArtboardDocumentRect,
  checks: ImageArtboardPrintProofChecks,
): ImageArtboardPageBoxes {
  return {
    mediaBox: {
      label: 'Media Box',
      documentRect: clippedBleedRect,
      clipped: !rectsMatch(requestedBleedRect, clippedBleedRect),
    },
    bleedBox: {
      label: 'Bleed Box',
      documentRect: requestedBleedRect,
      clipped: !checks.bleedInsideDocument,
    },
    trimBox: {
      label: 'Trim Box',
      documentRect: trimRect,
      clipped: !checks.trimInsideDocument,
    },
    safeBox: {
      label: 'Safe Box',
      documentRect: safeRect,
      clipped: !isImageArtboardRectInsideDocument(safeRect, doc),
    },
  };
}

function analyzeImageArtboardMetadata(doc: ImageDocument): ImageArtboardMetadataDiagnostics {
  const rawArtboards = Array.isArray(doc.metadata?.artboards?.artboards) ? doc.metadata.artboards.artboards : [];
  const missingArtboardMetadataIds = new Set<string>();
  const invalidArtboardMetadataIds = new Set<string>();

  if (rawArtboards.length === 0) {
    missingArtboardMetadataIds.add(createImageArtboardFromDocument(doc, 0).id);
    return {
      missingArtboardMetadataIds,
      invalidArtboardMetadataIds,
    };
  }

  rawArtboards.forEach((artboard, index) => {
    const normalizedId = typeof artboard?.id === 'string' && artboard.id.trim()
      ? artboard.id.trim()
      : `artboard-${index + 1}`;
    if (isInvalidRawArtboardMetadata(artboard)) {
      invalidArtboardMetadataIds.add(normalizedId);
    }
  });

  return {
    missingArtboardMetadataIds,
    invalidArtboardMetadataIds,
  };
}

function isInvalidRawArtboardMetadata(artboard: UnknownArtboardMetadata): boolean {
  if (!artboard) return true;
  if (!isFiniteNumber(artboard.x) || !isFiniteNumber(artboard.y)) return true;
  if (!isPositiveFiniteNumber(artboard.width) || !isPositiveFiniteNumber(artboard.height)) return true;
  if (!artboard.page) return true;
  return !isPositiveFiniteNumber(artboard.page.widthMm)
    || !isPositiveFiniteNumber(artboard.page.heightMm)
    || !isPositiveFiniteNumber(artboard.page.dpi)
    || !isFiniteNumber(artboard.page.bleedMm)
    || artboard.page.bleedMm < 0;
}

function buildImageArtboardReadinessBlockers(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  entry: ImageArtboardExportPlanEntry,
  diagnostics: ImageArtboardMetadataDiagnostics,
): ImageArtboardReadinessBlocker[] {
  const blockers: ImageArtboardReadinessBlocker[] = [];

  if (diagnostics.missingArtboardMetadataIds.has(entry.id)) {
    blockers.push({
      code: 'missing-artboard-metadata',
      severity: 'blocker',
      summary: 'Print/export proofing is blocked until explicit artboard metadata is confirmed instead of relying on the whole-document fallback artboard.',
    });
    return blockers;
  }
  if (diagnostics.invalidArtboardMetadataIds.has(entry.id)) {
    blockers.push({
      code: 'invalid-artboard-metadata',
      severity: 'blocker',
      summary: 'Print/export proofing is blocked until invalid artboard geometry or page metadata is corrected.',
    });
    return blockers;
  }
  if (!entry.proof.checks.trimInsideDocument) {
    blockers.push({
      code: 'artboard-trim-outside-document',
      severity: 'blocker',
      summary: 'Trim Box extends outside the current Image document bounds.',
    });
  }
  if (entry.proof.bleed.insetMm > 0 && !entry.proof.checks.bleedInsideDocument) {
    blockers.push({
      code: 'artboard-bleed-outside-document',
      severity: 'blocker',
      summary: 'Bleed Box extends outside the current Image document bounds and would export clipped edges.',
    });
  }
  if (!isImageArtboardRectInsideDocument(entry.proof.safeArea.documentRect, doc)) {
    blockers.push({
      code: 'artboard-safe-box-outside-document',
      severity: 'blocker',
      summary: 'Safe Box extends outside the current Image document bounds.',
    });
  }

  return blockers;
}

function buildImageArtboardSuitabilitySummary(
  proof: ImageArtboardPrintProofDescriptor,
  blockers: ImageArtboardReadinessBlocker[],
  readiness: ImageArtboardReadinessChecks,
): ImageArtboardSuitabilitySummary {
  const blockerCodes = new Set(blockers.map((blocker) => blocker.code));
  const proofLabel = proof.proofLabel;

  if (blockerCodes.has('missing-artboard-metadata')) {
    return {
      export: 'Blocked for export proofing until explicit artboard metadata is confirmed.',
      proof: `${proofLabel} proof is blocked until explicit artboard metadata is confirmed.`,
    };
  }

  if (blockerCodes.has('artboard-trim-outside-document') || blockerCodes.has('artboard-bleed-outside-document')) {
    return {
      export: 'Flattened export remains possible, but Trim Box and Bleed Box blockers must be resolved first.',
      proof: `${proofLabel} is flagged because trim or bleed boxes fall outside the Image document.`,
    };
  }

  if (readiness.printReady) {
    return {
      export: 'Export-ready with Trim Box, Bleed Box, and Media Box aligned for deterministic proof output.',
      proof: `${proofLabel} is ready for trim, bleed, and DPI checks.`,
    };
  }

  return {
    export: 'Flattened export is available, but bleed coverage or DPI readiness still needs review.',
    proof: `${proofLabel} remains review-only until bleed coverage and DPI readiness pass.`,
  };
}

function buildImageArtboardReadinessExportName(
  entry: ImageArtboardExportPlanEntry,
): ImageArtboardReadinessExportName {
  return {
    filenameStem: entry.filenameStem,
    recommendedBasename: [
      entry.filenameStem,
      slugifyImageArtboardName(entry.proof.pageLabel),
      `${entry.proof.targetDpi}dpi`,
      `${formatMillimeters(entry.proof.bleed.insetMm)}mm-bleed`,
    ].join('-'),
    recommendedExtensions: ['png', 'jpg', 'webp'],
  };
}

function buildImageArtboardRasterExportBounds(
  proof: ImageArtboardPrintProofDescriptor,
): ImageArtboardRasterExportBounds {
  const sourceTrimRect = proof.trim.documentRect;
  const sourceBleedRect = proof.bleed.clippedDocumentRect;
  const outputTrimSizePx = {
    width: proof.bounds.trimWidthPx,
    height: proof.bounds.trimHeightPx,
  };
  const outputBleedSizePx = {
    width: proof.bounds.bleedWidthPx,
    height: proof.bounds.bleedHeightPx,
  };
  const trimScale = {
    x: roundNumber(sourceTrimRect.width / outputTrimSizePx.width, 4),
    y: roundNumber(sourceTrimRect.height / outputTrimSizePx.height, 4),
  };
  const bleedClipped = proof.pageBoxes.bleedBox.clipped || proof.pageBoxes.mediaBox.clipped;

  return {
    sourceTrimRect,
    sourceBleedRect,
    outputTrimSizePx,
    outputBleedSizePx,
    bleedClipped,
    trimScale,
    cropPolicy: 'clip-bleed-to-document-pixels',
    backgroundPolicy: 'transparent-extended-bleed-required',
    signature: [
      'artboard-export-bounds:v1',
      `trim=${sourceTrimRect.x},${sourceTrimRect.y},${sourceTrimRect.width}x${sourceTrimRect.height}`,
      `bleed=${sourceBleedRect.x},${sourceBleedRect.y},${sourceBleedRect.width}x${sourceBleedRect.height}`,
      `out=${outputTrimSizePx.width}x${outputTrimSizePx.height}/${outputBleedSizePx.width}x${outputBleedSizePx.height}`,
      `scale=${formatMillimeters(trimScale.x)}x${formatMillimeters(trimScale.y)}`,
      `clipped=${bleedClipped}`,
    ].join('|'),
  };
}

function buildImageArtboardProofProfileDescriptor(
  doc: ImageDocument,
): ImageArtboardProofProfileDescriptor {
  const colorProof = doc.metadata?.colorProof;
  const mode = colorProof?.mode ?? 'rgb';
  const intent = colorProof?.intent ?? 'screen-rgb';
  const profileLabel = colorProof?.profileLabel?.trim() || null;
  const warnings: string[] = [];

  if (profileLabel) {
    warnings.push(`${profileLabel} is recorded as artboard proof intent metadata only; ICC conversion and embedding are not applied to artboard exports.`);
  }
  if (mode === 'cmyk-soft-proof') {
    warnings.push('CMYK soft proof remains a preview/metadata state; artboard exports are flattened RGB derivatives, not process-color separations.');
  }

  return {
    mode,
    intent,
    profileLabel,
    embeddedIccProfile: false,
    conversionApplied: false,
    warnings,
    signature: [
      'artboard-proof-profile:v1',
      `mode=${mode}`,
      `intent=${intent}`,
      `profile=${profileLabel ?? 'none'}`,
      'embedded=false',
      'conversion=false',
    ].join('|'),
  };
}

function buildImageArtboardUnsupportedStates(): ImageArtboardUnsupportedState[] {
  return [
    {
      code: 'auto-bleed-extension',
      supported: false,
      severity: 'unsupported',
      message: 'Automatic bleed pixel extension is unsupported; Image measures bleed boxes but does not synthesize extended edge content.',
    },
    {
      code: 'image-slices',
      supported: false,
      severity: 'unsupported',
      message: 'Slice-based web export is unsupported for Image artboards; use deterministic batch artboard outputs instead.',
    },
    {
      code: 'printer-marks-pdfx',
      supported: false,
      severity: 'unsupported',
      message: 'Printer marks, output intents, and PDF/X files are not generated by Image artboard export planning.',
    },
    {
      code: 'true-contract-proof',
      supported: false,
      severity: 'unsupported',
      message: 'True contract proof output and hardware-calibrated profile conversion require external prepress tooling.',
    },
  ];
}

interface ImageArtboardFilenameResolver {
  usedBasenameKeys: Set<string>;
  reservedBasenames: string[];
}

function createImageArtboardFilenameResolver(
  reservedBasenames: readonly string[] | undefined,
): ImageArtboardFilenameResolver {
  const reserved = uniqueWarnings((reservedBasenames ?? [])
    .map((basename) => basename.trim())
    .filter(Boolean));

  return {
    usedBasenameKeys: new Set(reserved.map((basename) => normalizeImageArtboardBasenameKey(basename))),
    reservedBasenames: reserved,
  };
}

function resolveImageArtboardFilename(
  resolver: ImageArtboardFilenameResolver,
  candidateBasename: string,
): ImageArtboardFilenameCollisionPolicy {
  const normalizedCandidate = candidateBasename.trim() || 'artboard';
  let resolvedBasename = normalizedCandidate;
  let collisionIndex = 0;

  if (resolver.usedBasenameKeys.has(normalizeImageArtboardBasenameKey(resolvedBasename))) {
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const nextBasename = `${normalizedCandidate}-${suffix}`;
      if (!resolver.usedBasenameKeys.has(normalizeImageArtboardBasenameKey(nextBasename))) {
        resolvedBasename = nextBasename;
        collisionIndex = suffix;
        break;
      }
    }
  }

  resolver.usedBasenameKeys.add(normalizeImageArtboardBasenameKey(resolvedBasename));
  const warnings = collisionIndex > 0
    ? [`Resolved duplicate artboard export basename "${normalizedCandidate}" to "${resolvedBasename}".`]
    : [];

  return {
    strategy: 'sequence-prefix-then-numeric-suffix',
    candidateBasename: normalizedCandidate,
    resolvedBasename,
    collisionIndex,
    reservedBasenames: [...resolver.reservedBasenames],
    warnings,
    signature: [
      'artboard-filename:v1',
      `candidate=${normalizedCandidate}`,
      `resolved=${resolvedBasename}`,
      `collision=${collisionIndex}`,
      `reserved=${resolver.reservedBasenames.join(',') || 'none'}`,
    ].join('|'),
  };
}

function normalizeImageArtboardBasenameKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildImageArtboardPaperHandoffReadiness(
  readiness: ImageArtboardReadinessChecks,
): ImageArtboardHandoffReadiness {
  const warnings: string[] = [];
  if (!readiness.trimReady) {
    warnings.push('Paper handoff needs artboard trim bounds inside the Image document.');
  }
  if (!readiness.safeAreaReady) {
    warnings.push('Paper handoff keeps this artboard planning-only until a usable safe area is available.');
  }
  if (readiness.trimReady && readiness.safeAreaReady && !readiness.printReady) {
    warnings.push('Paper handoff should treat this artboard as review-only until bleed coverage and 300 DPI print readiness pass.');
  }

  return {
    ready: readiness.printReady,
    mode: 'export-artboard-as-paper-page-asset',
    warnings,
  };
}

function buildImageArtboardSourceBinHandoffReadiness(
  readiness: ImageArtboardReadinessChecks,
): ImageArtboardHandoffReadiness {
  const warnings = [
    'Source Bin handoff should register a flattened artboard asset plus artboard metadata; it does not preserve native multi-artboard editability.',
  ];
  if (!readiness.trimReady) {
    warnings.push('Source Bin handoff needs trim bounds inside the Image document before a flattened asset can be registered safely.');
  }

  return {
    ready: readiness.trimReady,
    mode: 'flattened-artboard-asset',
    warnings,
  };
}

function buildImageArtboardPackageHandoffReadiness(): ImageArtboardHandoffReadiness {
  return {
    ready: false,
    mode: 'manual-package-required',
    warnings: ['Package for Print is planning-only: fonts, linked assets, ICC profiles, and packaged output folders are not collected.'],
  };
}

function buildImageArtboardActionSuitability(
  readiness: ImageArtboardReadinessChecks,
): ImageArtboardActionSuitability {
  return {
    recordable: readiness.trimReady,
    replaySafe: readiness.trimReady,
    descriptor: buildImageArtboardsActionReadiness(),
  };
}

function buildImageArtboardsActionReadiness(): ImageArtboardActionReadiness {
  return {
    ready: true,
    mode: 'record-artboard-export-settings',
    warnings: ['Actions can replay deterministic artboard export settings, but cannot record arbitrary manual imposition or package-for-print steps.'],
  };
}

function buildImageArtboardsActionSuitability(): ImageArtboardsActionSuitability {
  return {
    recordable: buildImageArtboardsActionReadiness(),
  };
}

function buildImageArtboardBatchSuitability(
  readiness: ImageArtboardReadinessChecks,
): ImageArtboardBatchSuitability {
  return {
    exportSelected: {
      ready: readiness.trimReady,
      mode: 'batch-export-selected-artboards',
      warnings: readiness.trimReady
        ? []
        : ['Batch export should skip this artboard until trim bounds are inside the Image document.'],
    },
    printProof: {
      ready: readiness.printReady,
      mode: 'batch-print-proof-ready-artboards',
      warnings: readiness.printReady
        ? []
        : ['Batch print proof should skip or flag this artboard until bleed and DPI readiness pass.'],
    },
  };
}

function buildImageArtboardsBatchReadiness(
  artboards: ImageArtboardPrintExportReadinessEntry[],
): {
  exportAll: ImageArtboardBatchOperationReadiness;
  printProof: ImageArtboardBatchOperationReadiness;
} {
  const exportAllReady = artboards.every((artboard) => artboard.batch.exportSelected.ready);
  const printProofReady = artboards.every((artboard) => artboard.batch.printProof.ready);

  return {
    exportAll: {
      ready: exportAllReady,
      mode: 'batch-export-all-artboards',
      warnings: exportAllReady ? [] : ['Batch export contains artboards with unsafe trim bounds.'],
    },
    printProof: {
      ready: printProofReady,
      mode: 'batch-print-proof-ready-artboards',
      warnings: printProofReady ? [] : ['Batch print proof contains artboards that are not fully print ready.'],
    },
  };
}

function buildImageArtboardsBatchExportPlan(
  exportPlan: ImageArtboardsExportPlan,
  readinessEntries: ImageArtboardPrintExportReadinessEntry[],
): ImageArtboardsBatchExportPlanDescriptor {
  const readinessById = new Map(readinessEntries.map((entry) => [entry.id, entry]));
  const items = exportPlan.artboards.map((entry) => {
    const readiness = readinessById.get(entry.id);
    const exportReady = readiness?.batch.exportSelected.ready === true;
    const printProofReady = readiness?.batch.printProof.ready === true;
    const warnings = uniqueWarnings([
      ...(readiness?.batch.exportSelected.warnings ?? []),
      ...(readiness?.batch.printProof.warnings ?? []),
      ...(readiness?.filenamePolicy.warnings ?? []),
    ]);
    const disposition: ImageArtboardBatchExportDisposition = !exportReady
      ? 'blocked'
      : printProofReady
        ? 'export-print-proof'
        : 'export-review-only';
    const recommendedBasename = readiness?.exportName.recommendedBasename
      ?? [
        entry.filenameStem,
        slugifyImageArtboardName(entry.proof.pageLabel),
        `${entry.proof.targetDpi}dpi`,
        `${formatMillimeters(entry.proof.bleed.insetMm)}mm-bleed`,
      ].join('-');
    const filenamePolicy = readiness?.filenamePolicy
      ?? resolveImageArtboardFilename(createImageArtboardFilenameResolver([]), recommendedBasename);
    const resolvedBasename = filenamePolicy.resolvedBasename;

    return {
      artboardId: entry.id,
      sequence: entry.sequence,
      filenameStem: entry.filenameStem,
      recommendedBasename,
      resolvedBasename,
      filenamePolicy,
      formats: [...IMAGE_ARTBOARD_BATCH_EXPORT_FORMATS],
      outputs: IMAGE_ARTBOARD_BATCH_EXPORT_FORMATS.map((format) => ({
        format,
        filename: `${resolvedBasename}.${format}`,
      })),
      exportReady,
      printProofReady,
      disposition,
      warnings,
      signature: [
        'artboard-batch-item:v1',
        entry.id,
        `seq=${entry.sequence}`,
        `basename=${resolvedBasename}`,
        `export=${exportReady}`,
        `printProof=${printProofReady}`,
      ].join('|'),
    };
  });
  const itemById = new Map(items.map((item) => [item.artboardId, item]));
  const groups = exportPlan.groups.map((group) => {
    const groupItems = group.artboards
      .map((entry) => itemById.get(entry.id))
      .filter((item): item is ImageArtboardBatchExportPlanItem => Boolean(item));

    return {
      key: [
        `proof=${slugifyImageArtboardName(group.proofLabel)}`,
        `page=${group.pageLabel.toLowerCase()}`,
        `dpi=${group.targetDpi}`,
        `bleed=${formatMillimeters(group.bleedMm)}mm`,
      ].join('|'),
      label: group.label,
      itemIds: groupItems.map((item) => item.artboardId),
      exportableCount: groupItems.filter((item) => item.exportReady).length,
      printProofReadyCount: groupItems.filter((item) => item.printProofReady).length,
    };
  });
  const exportableCount = items.filter((item) => item.exportReady).length;
  const printProofReadyCount = items.filter((item) => item.printProofReady).length;
  const blockedCount = items.filter((item) => !item.exportReady).length;

  return {
    mode: 'batch-export-artboards',
    formats: [...IMAGE_ARTBOARD_BATCH_EXPORT_FORMATS],
    outputPattern: '{basename}.{ext}',
    totalCount: items.length,
    exportableCount,
    printProofReadyCount,
    blockedCount,
    groups,
    items,
    warnings: uniqueWarnings(items.flatMap((item) => item.warnings)),
    signature: [
      'image-artboard-batch-export:v1',
      `items=${items.length}`,
      `exportable=${exportableCount}`,
      `printProof=${printProofReadyCount}`,
      `blocked=${blockedCount}`,
      ...items.map((item) => `${item.artboardId}:${item.sequence}:${item.exportReady}:${item.printProofReady}`),
    ].join('|'),
  };
}

function buildImageArtboardImpositionCaveat(): ImageArtboardUnsupportedProductionFeature {
  return {
    supported: false,
    warnings: ['Printer spreads, n-up layouts, signatures, and booklet imposition are not generated by Image artboard planning.'],
  };
}

function buildImageArtboardNativePsdArtboardCaveat(): ImageArtboardUnsupportedProductionFeature {
  return {
    supported: false,
    warnings: ['Native multi-page PSD/artboard constructs are unsupported; Sloom Studio preserves artboard intent as metadata and flattened/exported artboard outputs.'],
  };
}

function buildImageArtboardReadinessEntrySignature(
  entry: ImageArtboardExportPlanEntry,
  readiness: ImageArtboardReadinessChecks,
  paperHandoff: ImageArtboardHandoffReadiness,
  sourceBinHandoff: ImageArtboardHandoffReadiness,
  packageHandoff: ImageArtboardHandoffReadiness,
): string {
  return [
    `artboard:${entry.id}`,
    `order=${entry.sequence}`,
    `rect=${entry.proof.trim.documentRect.x},${entry.proof.trim.documentRect.y},${entry.proof.trim.documentRect.width}x${entry.proof.trim.documentRect.height}`,
    `page=${entry.proof.pageLabel.toLowerCase()}`,
    `dpi=${entry.proof.targetDpi}`,
    `bleed=${formatMillimeters(entry.proof.bleed.insetMm)}mm`,
    `print=${readiness.printReady}`,
    `paper=${paperHandoff.ready}`,
    `sourceBin=${sourceBinHandoff.ready}`,
    `package=${packageHandoff.ready}`,
  ].join('|');
}

function buildImageArtboardsReadinessSignature(
  doc: Pick<ImageDocument, 'width' | 'height'>,
  exportEntries: ImageArtboardExportPlanEntry[],
  readinessEntries: ImageArtboardPrintExportReadinessEntry[],
  proofProfile: ImageArtboardProofProfileDescriptor,
  unsupportedStates: ImageArtboardUnsupportedState[],
): string {
  return [
    `artboard-readiness:v2|${doc.width}x${doc.height}`,
    `profile=${proofProfile.signature}`,
    `unsupported=${unsupportedStates.map((state) => state.code).join(',') || 'none'}`,
    ...exportEntries.map((entry, index) => {
      const readiness = readinessEntries[index]?.readiness;
      const filenamePolicy = readinessEntries[index]?.filenamePolicy;
      return [
        `${entry.id}@${entry.proof.trim.documentRect.x},${entry.proof.trim.documentRect.y},${entry.proof.trim.documentRect.width}x${entry.proof.trim.documentRect.height}`,
        entry.layout.page.preset,
        `${entry.proof.targetDpi}dpi`,
        `${formatMillimeters(entry.proof.bleed.insetMm)}mm`,
        slugifyImageArtboardName(entry.proof.proofLabel),
        `ready=${readiness?.printReady === true}`,
        `file=${filenamePolicy?.resolvedBasename ?? entry.filenameStem}`,
      ].join('|');
    }),
  ].join('|');
}

function buildImageArtboardExportGroupKey(proof: ImageArtboardPrintProofDescriptor): string {
  return [
    `proof=${slugifyImageArtboardName(proof.proofLabel)}`,
    `page=${proof.pageLabel.toLowerCase()}`,
    `size=${formatMillimeters(proof.bounds.trimWidthPx)}x${formatMillimeters(proof.bounds.trimHeightPx)}px`,
    `dpi=${proof.targetDpi}`,
    `bleed=${formatMillimeters(proof.bleed.insetMm)}mm`,
  ].join('|');
}

function buildImageArtboardExportGroupLabel(proof: ImageArtboardPrintProofDescriptor): string {
  return `${proof.proofLabel} - ${proof.pageLabel} - ${proof.targetDpi} DPI - ${formatMillimeters(proof.bleed.insetMm)} mm bleed`;
}

function compareImageArtboardPlanningEntries(
  left: { artboard: ImageArtboardMetadata; sourceIndex: number },
  right: { artboard: ImageArtboardMetadata; sourceIndex: number },
): number {
  return compareNumbers(left.artboard.y, right.artboard.y)
    || compareNumbers(left.artboard.x, right.artboard.x)
    || compareStrings(left.artboard.name, right.artboard.name)
    || compareStrings(left.artboard.id, right.artboard.id)
    || compareNumbers(left.sourceIndex, right.sourceIndex);
}

function createImageArtboardDocumentRect(
  x: number,
  y: number,
  width: number,
  height: number,
): ImageArtboardDocumentRect {
  return {
    x,
    y,
    width,
    height,
    right: x + width,
    bottom: y + height,
  };
}

function clipImageArtboardDocumentRect(
  rect: ImageArtboardDocumentRect,
  doc: Pick<ImageDocument, 'width' | 'height'>,
): ImageArtboardDocumentRect {
  const x = clampNumber(rect.x, 0, doc.width);
  const y = clampNumber(rect.y, 0, doc.height);
  const right = clampNumber(rect.right, 0, doc.width);
  const bottom = clampNumber(rect.bottom, 0, doc.height);
  return createImageArtboardDocumentRect(x, y, Math.max(0, right - x), Math.max(0, bottom - y));
}

function combineImageArtboardDocumentRects(
  rects: ImageArtboardDocumentRect[],
): ImageArtboardDocumentRect {
  if (rects.length === 0) return createImageArtboardDocumentRect(0, 0, 0, 0);

  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return createImageArtboardDocumentRect(x, y, right - x, bottom - y);
}

function isImageArtboardRectInsideDocument(
  rect: ImageArtboardDocumentRect,
  doc: Pick<ImageDocument, 'width' | 'height'>,
): boolean {
  return rect.x >= 0
    && rect.y >= 0
    && rect.right <= doc.width
    && rect.bottom <= doc.height;
}

function isImageArtboardRectInsideRect(
  inner: ImageArtboardDocumentRect,
  outer: ImageArtboardDocumentRect,
): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.right <= outer.right
    && inner.bottom <= outer.bottom;
}

function mmToPixelsAllowZero(mm: number, dpi: number): number {
  return Math.max(0, Math.round((Math.max(0, mm) / MM_PER_INCH) * Math.max(1, dpi)));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function rectsMatch(left: ImageArtboardDocumentRect, right: ImageArtboardDocumentRect): boolean {
  return left.x === right.x
    && left.y === right.y
    && left.width === right.width
    && left.height === right.height
    && left.right === right.right
    && left.bottom === right.bottom;
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareStrings(left: string, right: string): number {
  const normalizedLeft = left.trim().toLowerCase();
  const normalizedRight = right.trim().toLowerCase();
  if (normalizedLeft === normalizedRight) return 0;
  return normalizedLeft < normalizedRight ? -1 : 1;
}

function slugifyImageArtboardName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'artboard';
}

function formatMillimeters(value: number): string {
  return String(roundNumber(value, 4)).replace(/\.0+$/, '');
}

function uniqueWarnings(warnings: string[]): string[] {
  return Array.from(new Set(warnings));
}
