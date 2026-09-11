import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
} from './paperDocument';
import {
  inferPaperDocumentImportFormat,
  parsePaperDocumentImportFile,
  type ImportedPaperTextBlock,
} from './paperDocumentFormats';
import {
  inferPaperAssistedLayoutSpreadsheetFormat,
  parsePaperAssistedLayoutDelimitedText,
  parsePaperAssistedLayoutXlsx,
} from './paperAssistedLayoutSpreadsheets';
import { cmykToRgb, parseHexColor, type PaperSwatch } from './paperSwatches';
import type {
  PaperDocument,
  PaperFrameKind,
  PaperShapeKind,
  PaperTextAlign,
} from '../types/paper';

/**
 * A deliberately inert boundary between an assisted-layout provider and Paper.
 *
 * Providers may propose this JSON, but they cannot provide HTML/CSS/JavaScript,
 * remote URLs, tool calls, or arbitrary PaperDocument fields. The proposal is
 * validated and then rebuilt with Paper's ordinary document constructors.
 */

export const PAPER_ASSISTED_LAYOUT_LIMITS = {
  maxSourceFiles: 64,
  maxSourceFileBytes: 16 * 1024 * 1024,
  maxSourceTotalBytes: 64 * 1024 * 1024,
  maxSourceBlocks: 20_000,
  maxSourceCharacters: 4_000_000,
  maxPages: 1_000,
  maxFramesPerPage: 500,
  maxFrames: 10_000,
  maxFrameCharacters: 200_000,
  maxPlanCharacters: 4_000_000,
  maxFonts: 32,
  maxSwatches: 128,
} as const;

export type PaperAssistedLayoutSourceFormat =
  | 'txt'
  | 'markdown'
  | 'rtf'
  | 'html'
  | 'docx'
  | 'csv'
  | 'tsv'
  | 'xlsx';
export type PaperAssistedLayoutSourceRole = 'heading' | 'paragraph' | 'table' | 'image';

export interface PaperAssistedLayoutSourceBlockV1 {
  id: string;
  order: number;
  role: PaperAssistedLayoutSourceRole;
  text: string;
}

export interface PaperAssistedLayoutSourceFileV1 {
  id: string;
  order: number;
  name: string;
  title: string;
  format: PaperAssistedLayoutSourceFormat;
  originalBytes: number;
  blocks: PaperAssistedLayoutSourceBlockV1[];
}

export interface PaperAssistedLayoutSourceBundleV1 {
  version: 1;
  id: string;
  files: PaperAssistedLayoutSourceFileV1[];
  totalCharacters: number;
}

export interface NormalizePaperAssistedLayoutSourcesOptions {
  /** Stable caller-owned identity used by source references in a generated plan. */
  bundleId?: string;
}

export type PaperAssistedLayoutColorV1 =
  | { kind: 'hex'; value: string }
  | { kind: 'swatch'; swatchId: string; tintPercent?: number };

export type PaperAssistedLayoutPaintV1 = PaperAssistedLayoutColorV1 | { kind: 'none' };

export interface PaperAssistedLayoutFontV1 {
  id: string;
  /** A local family name only, never a URL or @font-face rule. */
  family: string;
  fallback: 'sans-serif' | 'serif' | 'monospace';
}

export interface PaperAssistedLayoutRgbSwatchColorV1 {
  model: 'rgb';
  hex: string;
}

export interface PaperAssistedLayoutCmykSwatchColorV1 {
  model: 'cmyk';
  c: number;
  m: number;
  y: number;
  k: number;
}

export interface PaperAssistedLayoutSwatchV1 {
  id: string;
  name: string;
  type: 'process' | 'spot';
  color: PaperAssistedLayoutRgbSwatchColorV1 | PaperAssistedLayoutCmykSwatchColorV1;
  spotName?: string;
}

export type PaperAssistedLayoutFrameContentV1 =
  | { kind: 'literal'; text: string }
  | { kind: 'source-blocks'; bundleId: string; fileId: string; blockIds: string[] };

export interface PaperAssistedLayoutTypographyV1 {
  fontId?: string;
  fontSizePt?: number;
  leadingPt?: number;
  tracking?: number;
  align?: PaperTextAlign;
  hyphenate?: boolean;
  color?: PaperAssistedLayoutColorV1;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export interface PaperAssistedLayoutFrameStyleV1 {
  fill?: PaperAssistedLayoutPaintV1;
  fillOpacity?: number;
  stroke?: PaperAssistedLayoutPaintV1;
  strokeOpacity?: number;
  strokeWidthMm?: number;
  cornerRadiusMm?: number;
  opacity?: number;
  typography?: PaperAssistedLayoutTypographyV1;
}

export interface PaperAssistedLayoutFrameV1 {
  id: string;
  kind: Extract<PaperFrameKind, 'text' | 'image' | 'speechBubble' | 'thoughtBubble' | 'caption' | 'panel' | 'shape'>;
  label: string;
  geometry: {
    xMm: number;
    yMm: number;
    widthMm: number;
    heightMm: number;
    rotationDeg?: number;
  };
  locked?: boolean;
  columns?: number;
  shapeKind?: Exclude<PaperShapeKind, 'line'>;
  content?: PaperAssistedLayoutFrameContentV1;
  /** Optional inert prompt for an image placeholder. Media generation remains a separate explicit action. */
  mediaPrompt?: string;
  style?: PaperAssistedLayoutFrameStyleV1;
}

export interface PaperAssistedLayoutPageV1 {
  id: string;
  frames: PaperAssistedLayoutFrameV1[];
}

export interface PaperAssistedLayoutPlanV1 {
  version: 1;
  document: {
    id: string;
    title: string;
    page: {
      widthMm: number;
      heightMm: number;
      bleedMm: number;
      dpi: number;
    };
    marginsMm: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    background: PaperAssistedLayoutColorV1;
    fonts: PaperAssistedLayoutFontV1[];
    swatches: PaperAssistedLayoutSwatchV1[];
    pages: PaperAssistedLayoutPageV1[];
  };
}

export interface PaperAssistedLayoutValidationIssue {
  path: string;
  message: string;
}

export type PaperAssistedLayoutValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: PaperAssistedLayoutValidationIssue[] };

export class PaperAssistedLayoutValidationError extends Error {
  readonly issues: PaperAssistedLayoutValidationIssue[];

  constructor(message: string, issues: PaperAssistedLayoutValidationIssue[]) {
    super(message);
    this.name = 'PaperAssistedLayoutValidationError';
    this.issues = issues;
  }
}

const SOURCE_FORMATS = new Set<PaperAssistedLayoutSourceFormat>([
  'txt', 'markdown', 'rtf', 'html', 'docx', 'csv', 'tsv', 'xlsx',
]);
const SOURCE_ROLES = new Set<PaperAssistedLayoutSourceRole>(['heading', 'paragraph', 'table', 'image']);
const FRAME_KINDS = new Set<PaperAssistedLayoutFrameV1['kind']>([
  'text', 'image', 'speechBubble', 'thoughtBubble', 'caption', 'panel', 'shape',
]);
const TEXT_FRAME_KINDS = new Set<PaperAssistedLayoutFrameV1['kind']>([
  'text', 'speechBubble', 'thoughtBubble', 'caption',
]);
const SHAPE_KINDS = new Set<PaperAssistedLayoutFrameV1['shapeKind']>([
  'polygon', 'ellipse', 'triangle', 'pentagon', 'hexagon',
]);
const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
const SAFE_FONT_FAMILY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,126}[\p{L}\p{N}]$/u;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FORBIDDEN_ACTIVE_CONTENT = /(?:<\s*\/?\s*script\b|\bjavascript\s*:|\bdata\s*:|\bfile\s*:|\b[a-z][a-z0-9+.-]*:\/\/|\burl\s*\()/i;

export async function normalizePaperAssistedLayoutSourceBundle(
  files: readonly File[],
  options: NormalizePaperAssistedLayoutSourcesOptions = {},
): Promise<PaperAssistedLayoutSourceBundleV1> {
  const bundleId = options.bundleId ?? 'source-bundle';
  const initialIssues: PaperAssistedLayoutValidationIssue[] = [];
  validateId(bundleId, '$.id', initialIssues);
  if (files.length === 0 || files.length > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFiles) {
    initialIssues.push({
      path: '$.files',
      message: `must contain 1-${PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFiles} files`,
    });
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceTotalBytes) {
    initialIssues.push({
      path: '$.files',
      message: `total source size exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceTotalBytes} bytes`,
    });
  }
  files.forEach((file, index) => {
    if (file.size > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFileBytes) {
      initialIssues.push({
        path: `$.files[${index}]`,
        message: `source file exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFileBytes} bytes`,
      });
    }
  });
  throwIfIssues('Invalid assisted-layout source bundle', initialIssues);

  const normalizedFiles: PaperAssistedLayoutSourceFileV1[] = [];
  let totalCharacters = 0;
  let totalBlocks = 0;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const spreadsheetFormat = inferPaperAssistedLayoutSpreadsheetFormat(file.name, file.type);
    if (spreadsheetFormat === 'unsupported-spreadsheet') {
      throw new PaperAssistedLayoutValidationError('Unsupported assisted-layout spreadsheet format', [{
        path: `$.files[${fileIndex}]`,
        message: 'legacy .xls and macro-enabled Excel files are not supported; save an inert copy as .xlsx, .csv, or .tsv',
      }]);
    }
    const inferredFormat = spreadsheetFormat ?? inferPaperDocumentImportFormat(file.name, file.type);
    if (!SOURCE_FORMATS.has(inferredFormat as PaperAssistedLayoutSourceFormat)) {
      throw new PaperAssistedLayoutValidationError('Unsupported assisted-layout source format', [{
        path: `$.files[${fileIndex}]`,
        message: `${inferredFormat} is layout/binary placement data, not an editable text source`,
      }]);
    }

    let imported: { title: string; blocks: ImportedPaperTextBlock[] };
    try {
      if (inferredFormat === 'csv' || inferredFormat === 'tsv') {
        imported = parsePaperAssistedLayoutDelimitedText(
          normalizePlainText(await file.text()),
          file.name,
          inferredFormat,
          PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters,
        );
      } else if (inferredFormat === 'xlsx') {
        imported = parsePaperAssistedLayoutXlsx(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
          PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters,
        );
      } else {
        // The existing Markdown/plain-text parsers intentionally stay small and
        // split on LF paragraphs. Canonicalize text line endings before calling
        // them so Windows-authored bundles produce the same blocks everywhere.
        const parseFile = inferredFormat === 'docx'
          ? file
          : new File([normalizePlainText(await file.text())], file.name, { type: file.type });
        const parsed = await parsePaperDocumentImportFile(parseFile);
        if (!('blocks' in parsed)) throw new Error('expected an editable text document');
        imported = parsed;
      }
    } catch (error) {
      if (error instanceof PaperAssistedLayoutValidationError) throw error;
      throw new PaperAssistedLayoutValidationError('Assisted-layout source could not be read safely', [{
        path: `$.files[${fileIndex}]`,
        message: error instanceof Error ? error.message : 'source parsing failed',
      }]);
    }

    const fileId = stableOrdinalId('source', fileIndex);
    const blocks = imported.blocks.map((block, blockIndex) => ({
      id: `${fileId}-block-${String(blockIndex + 1).padStart(4, '0')}`,
      order: blockIndex,
      role: block.role,
      text: normalizeImportedBlockText(block),
    }));
    totalBlocks += blocks.length;
    totalCharacters += blocks.reduce((sum, block) => sum + block.text.length, 0);
    if (totalBlocks > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceBlocks) {
      throw new PaperAssistedLayoutValidationError('Assisted-layout source bundle is too complex', [{
        path: '$.files',
        message: `source bundle exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceBlocks} blocks`,
      }]);
    }
    if (totalCharacters > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters) {
      throw new PaperAssistedLayoutValidationError('Assisted-layout source bundle is too large', [{
        path: '$.files',
        message: `source bundle exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters} characters`,
      }]);
    }

    normalizedFiles.push({
      id: fileId,
      order: fileIndex,
      name: normalizeSourceName(file.name),
      title: normalizePlainText(imported.title).slice(0, 512),
      format: inferredFormat as PaperAssistedLayoutSourceFormat,
      originalBytes: file.size,
      blocks,
    });
  }

  return {
    version: 1,
    id: bundleId,
    files: normalizedFiles,
    totalCharacters,
  };
}

export function validatePaperAssistedLayoutSourceBundleV1(
  input: unknown,
): PaperAssistedLayoutValidationResult<PaperAssistedLayoutSourceBundleV1> {
  const issues: PaperAssistedLayoutValidationIssue[] = [];
  const root = expectRecord(input, '$', ['version', 'id', 'files', 'totalCharacters'], issues);
  if (!root) return { ok: false, issues };
  expectLiteral(root.version, 1, '$.version', issues);
  validateId(root.id, '$.id', issues);
  expectBoundedNumber(root.totalCharacters, '$.totalCharacters', issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters, true);

  const files = expectArray(root.files, '$.files', issues, 1, PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFiles);
  const fileIds = new Set<string>();
  const blockIds = new Set<string>();
  let computedCharacters = 0;
  let computedBlocks = 0;
  let computedBytes = 0;
  files?.forEach((candidate, fileIndex) => {
    const path = `$.files[${fileIndex}]`;
    const file = expectRecord(candidate, path, ['id', 'order', 'name', 'title', 'format', 'originalBytes', 'blocks'], issues);
    if (!file) return;
    validateUniqueId(file.id, `${path}.id`, fileIds, issues);
    expectLiteral(file.order, fileIndex, `${path}.order`, issues);
    expectString(file.name, `${path}.name`, issues, 1, 512);
    expectString(file.title, `${path}.title`, issues, 0, 512);
    if (typeof file.format !== 'string' || !SOURCE_FORMATS.has(file.format as PaperAssistedLayoutSourceFormat)) {
      issues.push({ path: `${path}.format`, message: 'must be a supported editable text format' });
    }
    const originalBytes = expectBoundedNumber(
      file.originalBytes,
      `${path}.originalBytes`,
      issues,
      0,
      PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceFileBytes,
      true,
    );
    computedBytes += originalBytes ?? 0;
    const blocks = expectArray(file.blocks, `${path}.blocks`, issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceBlocks);
    blocks?.forEach((blockCandidate, blockIndex) => {
      const blockPath = `${path}.blocks[${blockIndex}]`;
      const block = expectRecord(blockCandidate, blockPath, ['id', 'order', 'role', 'text'], issues);
      if (!block) return;
      validateUniqueId(block.id, `${blockPath}.id`, blockIds, issues);
      expectLiteral(block.order, blockIndex, `${blockPath}.order`, issues);
      if (typeof block.role !== 'string' || !SOURCE_ROLES.has(block.role as PaperAssistedLayoutSourceRole)) {
        issues.push({ path: `${blockPath}.role`, message: 'must be heading, paragraph, table, or image' });
      }
      const text = expectString(block.text, `${blockPath}.text`, issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters);
      computedCharacters += text?.length ?? 0;
      computedBlocks += 1;
    });
  });
  if (computedBytes > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceTotalBytes) {
    issues.push({ path: '$.files', message: 'total source byte size exceeds the bundle limit' });
  }
  if (computedBlocks > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceBlocks) {
    issues.push({ path: '$.files', message: 'source block count exceeds the bundle limit' });
  }
  if (computedCharacters > PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceCharacters) {
    issues.push({ path: '$.files', message: 'source character count exceeds the bundle limit' });
  }
  if (typeof root.totalCharacters === 'number' && root.totalCharacters !== computedCharacters) {
    issues.push({ path: '$.totalCharacters', message: `must equal computed source length ${computedCharacters}` });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: cloneJson(input) as PaperAssistedLayoutSourceBundleV1 };
}

export function validatePaperAssistedLayoutPlanV1(
  input: unknown,
): PaperAssistedLayoutValidationResult<PaperAssistedLayoutPlanV1> {
  const issues: PaperAssistedLayoutValidationIssue[] = [];
  const root = expectRecord(input, '$', ['version', 'document'], issues);
  if (!root) return { ok: false, issues };
  expectLiteral(root.version, 1, '$.version', issues);
  const document = expectRecord(
    root.document,
    '$.document',
    ['id', 'title', 'page', 'marginsMm', 'background', 'fonts', 'swatches', 'pages'],
    issues,
  );
  if (!document) return { ok: false, issues };

  validateId(document.id, '$.document.id', issues);
  expectSafeString(document.title, '$.document.title', issues, 1, 512);
  const page = expectRecord(document.page, '$.document.page', ['widthMm', 'heightMm', 'bleedMm', 'dpi'], issues);
  const widthMm = page ? expectBoundedNumber(page.widthMm, '$.document.page.widthMm', issues, 25, 2_500) : undefined;
  const heightMm = page ? expectBoundedNumber(page.heightMm, '$.document.page.heightMm', issues, 25, 5_000) : undefined;
  const bleedMm = page ? expectBoundedNumber(page.bleedMm, '$.document.page.bleedMm', issues, 0, 50) : undefined;
  if (page) expectBoundedNumber(page.dpi, '$.document.page.dpi', issues, 72, 2_400, true);

  const margins = expectRecord(document.marginsMm, '$.document.marginsMm', ['top', 'right', 'bottom', 'left'], issues);
  if (margins) {
    const top = expectBoundedNumber(margins.top, '$.document.marginsMm.top', issues, 0, 1_000);
    const right = expectBoundedNumber(margins.right, '$.document.marginsMm.right', issues, 0, 1_000);
    const bottom = expectBoundedNumber(margins.bottom, '$.document.marginsMm.bottom', issues, 0, 1_000);
    const left = expectBoundedNumber(margins.left, '$.document.marginsMm.left', issues, 0, 1_000);
    if (heightMm !== undefined && top !== undefined && bottom !== undefined && top + bottom >= heightMm) {
      issues.push({ path: '$.document.marginsMm', message: 'top and bottom margins must leave a positive content area' });
    }
    if (widthMm !== undefined && left !== undefined && right !== undefined && left + right >= widthMm) {
      issues.push({ path: '$.document.marginsMm', message: 'left and right margins must leave a positive content area' });
    }
  }

  const fontIds = validateFonts(document.fonts, issues);
  const swatchIds = validateSwatches(document.swatches, issues);
  validateColor(document.background, '$.document.background', issues, swatchIds, false);

  const pages = expectArray(document.pages, '$.document.pages', issues, 1, PAPER_ASSISTED_LAYOUT_LIMITS.maxPages);
  const pageIds = new Set<string>();
  const frameIds = new Set<string>();
  let frameCount = 0;
  let literalCharacterCount = 0;
  pages?.forEach((pageCandidate, pageIndex) => {
    const pagePath = `$.document.pages[${pageIndex}]`;
    const proposedPage = expectRecord(pageCandidate, pagePath, ['id', 'frames'], issues);
    if (!proposedPage) return;
    validateUniqueId(proposedPage.id, `${pagePath}.id`, pageIds, issues);
    const frames = expectArray(
      proposedPage.frames,
      `${pagePath}.frames`,
      issues,
      0,
      PAPER_ASSISTED_LAYOUT_LIMITS.maxFramesPerPage,
    );
    frameCount += frames?.length ?? 0;
    frames?.forEach((frameCandidate, frameIndex) => {
      const framePath = `${pagePath}.frames[${frameIndex}]`;
      const frame = expectRecord(
        frameCandidate,
        framePath,
        ['id', 'kind', 'label', 'geometry', 'locked', 'columns', 'shapeKind', 'content', 'mediaPrompt', 'style'],
        issues,
      );
      if (!frame) return;
      validateUniqueId(frame.id, `${framePath}.id`, frameIds, issues);
      expectSafeString(frame.label, `${framePath}.label`, issues, 1, 256);
      const kind = typeof frame.kind === 'string' && FRAME_KINDS.has(frame.kind as PaperAssistedLayoutFrameV1['kind'])
        ? frame.kind as PaperAssistedLayoutFrameV1['kind']
        : undefined;
      if (!kind) issues.push({ path: `${framePath}.kind`, message: 'must be a supported inert Paper frame kind' });
      const geometry = expectRecord(frame.geometry, `${framePath}.geometry`, ['xMm', 'yMm', 'widthMm', 'heightMm', 'rotationDeg'], issues);
      if (geometry && widthMm !== undefined && heightMm !== undefined && bleedMm !== undefined) {
        validateGeometry(geometry, framePath, widthMm, heightMm, bleedMm, issues);
      }
      if (frame.locked !== undefined && typeof frame.locked !== 'boolean') {
        issues.push({ path: `${framePath}.locked`, message: 'must be a boolean' });
      }
      if (frame.columns !== undefined) {
        expectBoundedNumber(frame.columns, `${framePath}.columns`, issues, 1, 12, true);
        if (kind && !TEXT_FRAME_KINDS.has(kind)) {
          issues.push({ path: `${framePath}.columns`, message: 'is only valid for text-bearing frames' });
        }
      }
      if (frame.shapeKind !== undefined) {
        if (typeof frame.shapeKind !== 'string' || !SHAPE_KINDS.has(frame.shapeKind as PaperAssistedLayoutFrameV1['shapeKind'])) {
          issues.push({ path: `${framePath}.shapeKind`, message: 'must be a supported closed shape' });
        }
        if (kind && kind !== 'shape') {
          issues.push({ path: `${framePath}.shapeKind`, message: 'is only valid for shape frames' });
        }
      }
      if (frame.content !== undefined) {
        literalCharacterCount += validateFrameContent(frame.content, `${framePath}.content`, issues);
        if (kind && !TEXT_FRAME_KINDS.has(kind)) {
          issues.push({ path: `${framePath}.content`, message: 'is only valid for text-bearing frames' });
        }
      }
      if (frame.mediaPrompt !== undefined) {
        const mediaPrompt = expectSafeString(frame.mediaPrompt, `${framePath}.mediaPrompt`, issues, 1, 4_000);
        if (kind && kind !== 'image') {
          issues.push({ path: `${framePath}.mediaPrompt`, message: 'is only valid for image placeholders' });
        }
        if (mediaPrompt && FORBIDDEN_ACTIVE_CONTENT.test(mediaPrompt)) {
          issues.push({ path: `${framePath}.mediaPrompt`, message: 'must not contain URLs, active content, or tool instructions' });
        }
      }
      if (frame.style !== undefined) {
        validateFrameStyle(frame.style, `${framePath}.style`, issues, fontIds, swatchIds, kind);
      }
    });
  });
  if (frameCount > PAPER_ASSISTED_LAYOUT_LIMITS.maxFrames) {
    issues.push({ path: '$.document.pages', message: `plan exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxFrames} frames` });
  }
  if (literalCharacterCount > PAPER_ASSISTED_LAYOUT_LIMITS.maxPlanCharacters) {
    issues.push({ path: '$.document.pages', message: `literal content exceeds ${PAPER_ASSISTED_LAYOUT_LIMITS.maxPlanCharacters} characters` });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: cloneJson(input) as PaperAssistedLayoutPlanV1 };
}

export function parsePaperAssistedLayoutPlanV1(input: unknown): PaperAssistedLayoutPlanV1 {
  const result = validatePaperAssistedLayoutPlanV1(input);
  if (!result.ok) {
    throw new PaperAssistedLayoutValidationError('Invalid Paper assisted-layout plan', result.issues);
  }
  return result.value;
}

export interface ConvertPaperAssistedLayoutPlanOptions {
  sources?: PaperAssistedLayoutSourceBundleV1;
  /** Defaults to zero so equal plans produce byte-for-byte equal document state. */
  timestamp?: number;
}

export function convertPaperAssistedLayoutPlanToDocument(
  input: unknown,
  options: ConvertPaperAssistedLayoutPlanOptions = {},
): PaperDocument {
  const plan = parsePaperAssistedLayoutPlanV1(input);
  const timestamp = options.timestamp ?? 0;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new PaperAssistedLayoutValidationError('Invalid assisted-layout conversion options', [{
      path: '$options.timestamp',
      message: 'must be a finite non-negative number',
    }]);
  }
  const sources = options.sources ? parseSourceBundle(options.sources) : undefined;
  const sourceIndex = sources ? buildSourceIndex(sources) : undefined;
  const swatches = plan.document.swatches.map(convertSwatch);
  const swatchById = new Map(swatches.map((swatch) => [swatch.id, swatch]));
  const fontById = new Map(plan.document.fonts.map((font) => [font.id, font]));
  const pageSpec: PaperDocument['page'] = {
    preset: 'custom',
    widthMm: plan.document.page.widthMm,
    heightMm: plan.document.page.heightMm,
    bleedMm: plan.document.page.bleedMm,
    dpi: plan.document.page.dpi,
  };
  const background = resolveColor(plan.document.background, swatchById);
  const baseDocument = createDefaultPaperDocument({
    title: plan.document.title,
    preset: 'custom',
    dpi: pageSpec.dpi,
  });
  let document: PaperDocument = {
    ...baseDocument,
    id: plan.document.id,
    title: plan.document.title,
    page: pageSpec,
    layout: {
      ...baseDocument.layout,
      marginsMm: { ...plan.document.marginsMm },
    },
    background: {
      type: 'solid',
      color: background.css,
      fromColor: background.css,
      toColor: background.css,
      angleDeg: 90,
      radialShape: 'ellipse',
    },
    swatches,
    parentPages: [{ id: `${plan.document.id}-parent`, name: 'A-Parent', frames: [], guides: [] }],
    pages: plan.document.pages.map((page, index) => ({
      id: page.id,
      pageNumber: index + 1,
      frames: [],
      guides: [],
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  plan.document.pages.forEach((page) => {
    page.frames.forEach((frame, frameIndex) => {
      const fill = frame.style?.fill ? resolvePaint(frame.style.fill, swatchById) : undefined;
      const stroke = frame.style?.stroke ? resolvePaint(frame.style.stroke, swatchById) : undefined;
      const textColor = frame.style?.typography?.color
        ? resolveColor(frame.style.typography.color, swatchById)
        : undefined;
      const font = frame.style?.typography?.fontId
        ? fontById.get(frame.style.typography.fontId)
        : undefined;
      const typography = frame.style?.typography;
      const content = resolveFrameContent(frame.content, sources, sourceIndex);
      const draft: Parameters<typeof addFrameToPaperPage>[2] = {
        id: frame.id,
        kind: frame.kind,
        label: frame.label,
        xMm: frame.geometry.xMm,
        yMm: frame.geometry.yMm,
        widthMm: frame.geometry.widthMm,
        heightMm: frame.geometry.heightMm,
        rotationDeg: frame.geometry.rotationDeg ?? 0,
        locked: frame.locked ?? false,
        columns: frame.columns ?? 1,
        shapeKind: frame.shapeKind,
        text: content,
        generatedMediaPrompt: frame.mediaPrompt,
        zIndex: frameIndex,
        fillColor: fill?.css,
        fillSwatchId: fill?.swatchId,
        fillTintPercent: fill?.tintPercent,
        fillOpacity: frame.style?.fillOpacity,
        strokeColor: stroke?.css,
        strokeSwatchId: stroke?.swatchId,
        strokeTintPercent: stroke?.tintPercent,
        strokeOpacity: frame.style?.strokeOpacity,
        strokeWidthMm: frame.style?.strokeWidthMm,
        cornerRadiusMm: frame.style?.cornerRadiusMm,
        opacity: frame.style?.opacity,
        // Do not spread undefined properties over Paper's typography
        // defaults: every emitted key here was explicitly proposed.
        typography: typography ? {
          ...(font ? { fontFamily: `"${font.family}", ${font.fallback}` } : {}),
          ...(typography.fontSizePt !== undefined ? { fontSizePt: typography.fontSizePt } : {}),
          ...(typography.leadingPt !== undefined ? { leadingPt: typography.leadingPt } : {}),
          ...(typography.tracking !== undefined ? { tracking: typography.tracking } : {}),
          ...(typography.align !== undefined ? { align: typography.align } : {}),
          ...(typography.hyphenate !== undefined ? { hyphenate: typography.hyphenate } : {}),
          ...(textColor ? { color: textColor.css } : {}),
          ...(textColor?.swatchId ? { colorSwatchId: textColor.swatchId } : {}),
          ...(typography.fontWeight !== undefined ? { fontWeight: String(typography.fontWeight) } : {}),
          ...(typography.fontStyle !== undefined ? { fontStyle: typography.fontStyle } : {}),
        } : undefined,
      };
      document = addFrameToPaperPage(document, page.id, draft).document;
    });
  });

  return { ...document, createdAt: timestamp, updatedAt: timestamp };
}

function validateFonts(value: unknown, issues: PaperAssistedLayoutValidationIssue[]): Set<string> {
  const ids = new Set<string>();
  const fonts = expectArray(value, '$.document.fonts', issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxFonts);
  fonts?.forEach((candidate, index) => {
    const path = `$.document.fonts[${index}]`;
    const font = expectRecord(candidate, path, ['id', 'family', 'fallback'], issues);
    if (!font) return;
    validateUniqueId(font.id, `${path}.id`, ids, issues);
    const family = expectSafeString(font.family, `${path}.family`, issues, 1, 128);
    if (family && !SAFE_FONT_FAMILY_PATTERN.test(family)) {
      issues.push({ path: `${path}.family`, message: 'must be a local family name without CSS syntax' });
    }
    if (!['sans-serif', 'serif', 'monospace'].includes(String(font.fallback))) {
      issues.push({ path: `${path}.fallback`, message: 'must be sans-serif, serif, or monospace' });
    }
  });
  return ids;
}

function validateSwatches(value: unknown, issues: PaperAssistedLayoutValidationIssue[]): Set<string> {
  const ids = new Set<string>();
  const swatches = expectArray(value, '$.document.swatches', issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxSwatches);
  swatches?.forEach((candidate, index) => {
    const path = `$.document.swatches[${index}]`;
    const swatch = expectRecord(candidate, path, ['id', 'name', 'type', 'color', 'spotName'], issues);
    if (!swatch) return;
    validateUniqueId(swatch.id, `${path}.id`, ids, issues);
    expectSafeString(swatch.name, `${path}.name`, issues, 1, 128);
    if (swatch.type !== 'process' && swatch.type !== 'spot') {
      issues.push({ path: `${path}.type`, message: 'must be process or spot' });
    }
    if (swatch.type === 'spot') {
      expectSafeString(swatch.spotName, `${path}.spotName`, issues, 1, 128);
    } else if (swatch.spotName !== undefined) {
      issues.push({ path: `${path}.spotName`, message: 'is only valid for spot swatches' });
    }
    const color = expectRecord(swatch.color, `${path}.color`, ['model', 'hex', 'c', 'm', 'y', 'k'], issues);
    if (!color) return;
    if (color.model === 'rgb') {
      disallowKeys(color, `${path}.color`, ['model', 'hex'], issues);
      validateHex(color.hex, `${path}.color.hex`, issues);
    } else if (color.model === 'cmyk') {
      disallowKeys(color, `${path}.color`, ['model', 'c', 'm', 'y', 'k'], issues);
      for (const channel of ['c', 'm', 'y', 'k'] as const) {
        expectBoundedNumber(color[channel], `${path}.color.${channel}`, issues, 0, 100);
      }
    } else {
      issues.push({ path: `${path}.color.model`, message: 'must be rgb or cmyk' });
    }
  });
  return ids;
}

function validateGeometry(
  geometry: Record<string, unknown>,
  framePath: string,
  pageWidthMm: number,
  pageHeightMm: number,
  bleedMm: number,
  issues: PaperAssistedLayoutValidationIssue[],
): void {
  const path = `${framePath}.geometry`;
  const x = expectBoundedNumber(geometry.xMm, `${path}.xMm`, issues, -bleedMm, pageWidthMm + bleedMm);
  const y = expectBoundedNumber(geometry.yMm, `${path}.yMm`, issues, -bleedMm, pageHeightMm + bleedMm);
  const width = expectBoundedNumber(geometry.widthMm, `${path}.widthMm`, issues, 0.1, pageWidthMm + bleedMm * 2);
  const height = expectBoundedNumber(geometry.heightMm, `${path}.heightMm`, issues, 0.1, pageHeightMm + bleedMm * 2);
  if (geometry.rotationDeg !== undefined) {
    expectBoundedNumber(geometry.rotationDeg, `${path}.rotationDeg`, issues, -360, 360);
  }
  if (x !== undefined && width !== undefined && x + width > pageWidthMm + bleedMm) {
    issues.push({ path, message: 'frame extends beyond the horizontal page-plus-bleed bounds' });
  }
  if (y !== undefined && height !== undefined && y + height > pageHeightMm + bleedMm) {
    issues.push({ path, message: 'frame extends beyond the vertical page-plus-bleed bounds' });
  }
}

function validateFrameContent(value: unknown, path: string, issues: PaperAssistedLayoutValidationIssue[]): number {
  const content = expectRecord(value, path, ['kind', 'text', 'bundleId', 'fileId', 'blockIds'], issues);
  if (!content) return 0;
  if (content.kind === 'literal') {
    disallowKeys(content, path, ['kind', 'text'], issues);
    const text = expectSafeString(content.text, `${path}.text`, issues, 0, PAPER_ASSISTED_LAYOUT_LIMITS.maxFrameCharacters);
    return text?.length ?? 0;
  }
  if (content.kind === 'source-blocks') {
    disallowKeys(content, path, ['kind', 'bundleId', 'fileId', 'blockIds'], issues);
    validateId(content.bundleId, `${path}.bundleId`, issues);
    validateId(content.fileId, `${path}.fileId`, issues);
    const blockIds = expectArray(content.blockIds, `${path}.blockIds`, issues, 1, PAPER_ASSISTED_LAYOUT_LIMITS.maxSourceBlocks);
    const seen = new Set<string>();
    blockIds?.forEach((blockId, index) => validateUniqueId(blockId, `${path}.blockIds[${index}]`, seen, issues));
    return 0;
  }
  issues.push({ path: `${path}.kind`, message: 'must be literal or source-blocks' });
  return 0;
}

function validateFrameStyle(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  fontIds: ReadonlySet<string>,
  swatchIds: ReadonlySet<string>,
  frameKind: PaperAssistedLayoutFrameV1['kind'] | undefined,
): void {
  const style = expectRecord(
    value,
    path,
    ['fill', 'fillOpacity', 'stroke', 'strokeOpacity', 'strokeWidthMm', 'cornerRadiusMm', 'opacity', 'typography'],
    issues,
  );
  if (!style) return;
  if (style.fill !== undefined) validateColor(style.fill, `${path}.fill`, issues, swatchIds, true);
  if (style.stroke !== undefined) validateColor(style.stroke, `${path}.stroke`, issues, swatchIds, true);
  for (const opacity of ['fillOpacity', 'strokeOpacity', 'opacity'] as const) {
    if (style[opacity] !== undefined) expectBoundedNumber(style[opacity], `${path}.${opacity}`, issues, 0, 1);
  }
  if (style.strokeWidthMm !== undefined) expectBoundedNumber(style.strokeWidthMm, `${path}.strokeWidthMm`, issues, 0, 50);
  if (style.cornerRadiusMm !== undefined) expectBoundedNumber(style.cornerRadiusMm, `${path}.cornerRadiusMm`, issues, 0, 1_000);
  if (style.typography !== undefined) {
    if (frameKind && !TEXT_FRAME_KINDS.has(frameKind)) {
      issues.push({ path: `${path}.typography`, message: 'is only valid for text-bearing frames' });
    }
    validateTypography(style.typography, `${path}.typography`, issues, fontIds, swatchIds);
  }
}

function validateTypography(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  fontIds: ReadonlySet<string>,
  swatchIds: ReadonlySet<string>,
): void {
  const typography = expectRecord(
    value,
    path,
    ['fontId', 'fontSizePt', 'leadingPt', 'tracking', 'align', 'hyphenate', 'color', 'fontWeight', 'fontStyle'],
    issues,
  );
  if (!typography) return;
  if (typography.fontId !== undefined) {
    if (typeof typography.fontId !== 'string' || !fontIds.has(typography.fontId)) {
      issues.push({ path: `${path}.fontId`, message: 'must reference a declared local font' });
    }
  }
  if (typography.fontSizePt !== undefined) expectBoundedNumber(typography.fontSizePt, `${path}.fontSizePt`, issues, 1, 1_000);
  if (typography.leadingPt !== undefined) expectBoundedNumber(typography.leadingPt, `${path}.leadingPt`, issues, 1, 2_000);
  if (typography.tracking !== undefined) expectBoundedNumber(typography.tracking, `${path}.tracking`, issues, -1_000, 1_000);
  if (typography.align !== undefined && !['left', 'center', 'right', 'justify'].includes(String(typography.align))) {
    issues.push({ path: `${path}.align`, message: 'must be left, center, right, or justify' });
  }
  if (typography.hyphenate !== undefined && typeof typography.hyphenate !== 'boolean') {
    issues.push({ path: `${path}.hyphenate`, message: 'must be a boolean' });
  }
  if (typography.color !== undefined) validateColor(typography.color, `${path}.color`, issues, swatchIds, false);
  if (typography.fontWeight !== undefined) {
    const weight = expectBoundedNumber(typography.fontWeight, `${path}.fontWeight`, issues, 100, 900, true);
    if (weight !== undefined && weight % 100 !== 0) {
      issues.push({ path: `${path}.fontWeight`, message: 'must be a 100-step CSS weight' });
    }
  }
  if (typography.fontStyle !== undefined && typography.fontStyle !== 'normal' && typography.fontStyle !== 'italic') {
    issues.push({ path: `${path}.fontStyle`, message: 'must be normal or italic' });
  }
}

function validateColor(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  swatchIds: ReadonlySet<string>,
  allowNone: boolean,
): void {
  const color = expectRecord(value, path, ['kind', 'value', 'swatchId', 'tintPercent'], issues);
  if (!color) return;
  if (color.kind === 'hex') {
    disallowKeys(color, path, ['kind', 'value'], issues);
    validateHex(color.value, `${path}.value`, issues);
  } else if (color.kind === 'swatch') {
    disallowKeys(color, path, ['kind', 'swatchId', 'tintPercent'], issues);
    if (typeof color.swatchId !== 'string' || !swatchIds.has(color.swatchId)) {
      issues.push({ path: `${path}.swatchId`, message: 'must reference a declared swatch' });
    }
    if (color.tintPercent !== undefined) expectBoundedNumber(color.tintPercent, `${path}.tintPercent`, issues, 0, 100);
  } else if (color.kind === 'none' && allowNone) {
    disallowKeys(color, path, ['kind'], issues);
  } else {
    issues.push({ path: `${path}.kind`, message: allowNone ? 'must be hex, swatch, or none' : 'must be hex or swatch' });
  }
}

function expectRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: PaperAssistedLayoutValidationIssue[],
): Record<string, unknown> | undefined {
  if (!isPlainRecord(value)) {
    issues.push({ path, message: 'must be a plain object' });
    return undefined;
  }
  disallowKeys(value, path, allowedKeys, issues);
  return value;
}

function disallowKeys(
  value: Record<string, unknown>,
  path: string,
  allowedKeys: readonly string[],
  issues: PaperAssistedLayoutValidationIssue[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path: `${path}.${key}`, message: 'is not allowed by the v1 schema' });
  }
}

function expectArray(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  minLength: number,
  maxLength: number,
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: 'must be an array' });
    return undefined;
  }
  if (value.length < minLength || value.length > maxLength) {
    issues.push({ path, message: `must contain ${minLength}-${maxLength} items` });
  }
  return value;
}

function expectString(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof value !== 'string') {
    issues.push({ path, message: 'must be a string' });
    return undefined;
  }
  if (value.length < minLength || value.length > maxLength) {
    issues.push({ path, message: `must contain ${minLength}-${maxLength} characters` });
  }
  return value;
}

function expectSafeString(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  minLength: number,
  maxLength: number,
): string | undefined {
  const text = expectString(value, path, issues, minLength, maxLength);
  if (text !== undefined && FORBIDDEN_ACTIVE_CONTENT.test(text)) {
    issues.push({ path, message: 'must not contain URLs, URL-bearing CSS, or script markup' });
  }
  return text;
}

function expectBoundedNumber(
  value: unknown,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
  min: number,
  max: number,
  integer = false,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push({ path, message: 'must be a finite number' });
    return undefined;
  }
  if (value < min || value > max || (integer && !Number.isInteger(value))) {
    issues.push({ path, message: `must be ${integer ? 'an integer ' : ''}between ${min} and ${max}` });
  }
  return value;
}

function expectLiteral(
  value: unknown,
  literal: string | number,
  path: string,
  issues: PaperAssistedLayoutValidationIssue[],
): void {
  if (value !== literal) issues.push({ path, message: `must equal ${JSON.stringify(literal)}` });
}

function validateId(value: unknown, path: string, issues: PaperAssistedLayoutValidationIssue[]): value is string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    issues.push({ path, message: 'must be a local ID beginning with a letter and containing only letters, numbers, _ or -' });
    return false;
  }
  return true;
}

function validateUniqueId(
  value: unknown,
  path: string,
  ids: Set<string>,
  issues: PaperAssistedLayoutValidationIssue[],
): void {
  if (!validateId(value, path, issues)) return;
  if (ids.has(value)) issues.push({ path, message: `duplicates ID ${value}` });
  ids.add(value);
}

function validateHex(value: unknown, path: string, issues: PaperAssistedLayoutValidationIssue[]): value is string {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value)) {
    issues.push({ path, message: 'must be a six-digit hexadecimal color' });
    return false;
  }
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeImportedBlockText(block: ImportedPaperTextBlock): string {
  if (block.role === 'table' && block.table) {
    return normalizePlainText(block.table.cells.map((row) => row.join('\t')).join('\n'));
  }
  return normalizePlainText(block.text);
}

function normalizePlainText(value: string): string {
  const normalized = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n');
  return Array.from(normalized, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isAllowedWhitespace = character === '\n' || character === '\t';
    const isControl = codePoint < 32 || codePoint === 127;
    return isControl && !isAllowedWhitespace ? '' : character;
  }).join('');
}

function normalizeSourceName(value: string): string {
  const basename = value.replaceAll('\\', '/').split('/').pop() ?? 'source.txt';
  return normalizePlainText(basename).slice(0, 512) || 'source.txt';
}

function stableOrdinalId(prefix: string, index: number): string {
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

function throwIfIssues(message: string, issues: PaperAssistedLayoutValidationIssue[]): void {
  if (issues.length > 0) throw new PaperAssistedLayoutValidationError(message, issues);
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function parseSourceBundle(input: unknown): PaperAssistedLayoutSourceBundleV1 {
  const result = validatePaperAssistedLayoutSourceBundleV1(input);
  if (!result.ok) {
    throw new PaperAssistedLayoutValidationError('Invalid Paper assisted-layout source bundle', result.issues);
  }
  return result.value;
}

function buildSourceIndex(bundle: PaperAssistedLayoutSourceBundleV1): Map<string, Map<string, string>> {
  return new Map(bundle.files.map((file) => [
    file.id,
    new Map(file.blocks.map((block) => [block.id, block.text])),
  ]));
}

function resolveFrameContent(
  content: PaperAssistedLayoutFrameContentV1 | undefined,
  sources: PaperAssistedLayoutSourceBundleV1 | undefined,
  sourceIndex: Map<string, Map<string, string>> | undefined,
): string | undefined {
  if (!content) return undefined;
  if (content.kind === 'literal') return content.text;
  if (!sources || !sourceIndex) {
    throw new PaperAssistedLayoutValidationError('Assisted-layout plan requires a source bundle', [{
      path: '$options.sources',
      message: `is required to resolve source file ${content.fileId}`,
    }]);
  }
  if (sources.id !== content.bundleId) {
    throw new PaperAssistedLayoutValidationError('Assisted-layout source bundle does not match the plan', [{
      path: '$options.sources.id',
      message: `expected ${content.bundleId}`,
    }]);
  }
  const blocks = sourceIndex.get(content.fileId);
  if (!blocks) {
    throw new PaperAssistedLayoutValidationError('Assisted-layout plan references a missing source file', [{
      path: '$options.sources.files',
      message: `does not contain ${content.fileId}`,
    }]);
  }
  return content.blockIds.map((blockId) => {
    const text = blocks.get(blockId);
    if (text === undefined) {
      throw new PaperAssistedLayoutValidationError('Assisted-layout plan references a missing source block', [{
        path: '$options.sources.files',
        message: `does not contain ${blockId} in ${content.fileId}`,
      }]);
    }
    return text;
  }).join('\n\n');
}

function convertSwatch(swatch: PaperAssistedLayoutSwatchV1): PaperSwatch {
  const rgb = swatch.color.model === 'rgb'
    ? parseHexColor(swatch.color.hex) ?? { r: 0, g: 0, b: 0 }
    : cmykToRgb(swatch.color);
  return {
    id: swatch.id,
    name: swatch.name,
    type: swatch.type,
    model: swatch.color.model,
    rgb,
    ...(swatch.color.model === 'cmyk' ? {
      cmyk: {
        c: swatch.color.c,
        m: swatch.color.m,
        y: swatch.color.y,
        k: swatch.color.k,
      },
    } : {}),
    ...(swatch.type === 'spot' ? { spotName: swatch.spotName } : {}),
  };
}

function resolvePaint(
  paint: PaperAssistedLayoutPaintV1,
  swatches: ReadonlyMap<string, PaperSwatch>,
): { css: string; swatchId?: string; tintPercent?: number } {
  if (paint.kind === 'none') return { css: 'transparent' };
  return resolveColor(paint, swatches);
}

function resolveColor(
  color: PaperAssistedLayoutColorV1,
  swatches: ReadonlyMap<string, PaperSwatch>,
): { css: string; swatchId?: string; tintPercent?: number } {
  if (color.kind === 'hex') return { css: color.value.toLowerCase() };
  const swatch = swatches.get(color.swatchId);
  if (!swatch) throw new Error(`Validated swatch ${color.swatchId} is missing.`);
  const tint = color.tintPercent ?? 100;
  const rgb = swatch.rgb;
  const mix = (channel: number) => Math.round(255 + (channel - 255) * (tint / 100));
  return {
    css: `rgb(${mix(rgb.r)}, ${mix(rgb.g)}, ${mix(rgb.b)})`,
    swatchId: swatch.id,
    tintPercent: color.tintPercent,
  };
}
