import {
  addFrameToPaperPage,
  addPaperPage,
  placeSourceAssetInPaperFrame,
  updatePaperDocumentSetup,
  updatePaperFrame,
} from './paperDocument';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import type {
  PaperDocument,
  PaperFrameKind,
  PaperFramePatch,
  PaperShapeKind,
  PaperTextAlign,
} from '../types/paper';

/**
 * Live layout agent protocol.
 *
 * A connected model (API provider or local CLI agent) proposes small, typed
 * operations that are validated and then applied to the OPEN Paper document,
 * one at a time, so a person can watch the layout being built. The boundary is
 * deliberately inert, matching `paperAssistedLayout.ts`: no HTML/CSS/JS, no
 * URLs, no tool calls, and no arbitrary PaperDocument fields. The model may
 * only create frames under the `agent-` ID namespace and may only modify or
 * remove frames it created during the session.
 */

export const PAPER_LIVE_AGENT_LIMITS = {
  maxOperationsPerTurn: 40,
  maxMessageCharacters: 1_000,
  maxTextCharacters: 100_000,
  maxResponseCharacters: 400_000,
  maxLabelCharacters: 256,
  maxMediaPromptCharacters: 4_000,
  maxSourceItemsListed: 200,
  maxSnapshotCharacters: 60_000,
} as const;

export const PAPER_LIVE_AGENT_ID_PATTERN = /^agent-[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const SAFE_FONT_FAMILY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,126}[\p{L}\p{N}]$/u;
const FORBIDDEN_ACTIVE_CONTENT = /(?:<\s*\/?\s*script\b|\bjavascript\s*:|\bdata\s*:|\bfile\s*:|\b[a-z][a-z0-9+.-]*:\/\/|\burl\s*\()/i;

const FRAME_KINDS = new Set<PaperLiveAgentFrameKind>([
  'text', 'image', 'speechBubble', 'thoughtBubble', 'caption', 'panel', 'shape',
]);
const TEXT_FRAME_KINDS = new Set<PaperLiveAgentFrameKind>([
  'text', 'speechBubble', 'thoughtBubble', 'caption',
]);
const ASSET_FRAME_KINDS = new Set<PaperLiveAgentFrameKind>(['image', 'panel']);
const SHAPE_KINDS = new Set<Exclude<PaperShapeKind, 'line'>>([
  'polygon', 'ellipse', 'triangle', 'pentagon', 'hexagon',
]);

type PaperLiveAgentFrameKind = Extract<
  PaperFrameKind,
  'text' | 'image' | 'speechBubble' | 'thoughtBubble' | 'caption' | 'panel' | 'shape'
>;

export interface PaperLiveAgentGeometry {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotationDeg?: number;
}

export interface PaperLiveAgentTypography {
  fontFamily?: string;
  fontSizePt?: number;
  leadingPt?: number;
  tracking?: number;
  align?: PaperTextAlign;
  hyphenate?: boolean;
  color?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
}

export interface PaperLiveAgentStyle {
  fill?: { kind: 'hex'; value: string } | { kind: 'none' };
  fillOpacity?: number;
  stroke?: { kind: 'hex'; value: string } | { kind: 'none' };
  strokeOpacity?: number;
  strokeWidthMm?: number;
  cornerRadiusMm?: number;
  opacity?: number;
  typography?: PaperLiveAgentTypography;
}

export interface PaperLiveAgentFramePatch {
  label?: string;
  geometry?: PaperLiveAgentGeometry;
  text?: string;
  columns?: number;
  locked?: boolean;
  mediaPrompt?: string;
  style?: PaperLiveAgentStyle;
}

export type PaperLiveAgentOperation =
  | { op: 'addPage'; id: string }
  | {
      op: 'addFrame';
      id: string;
      pageId: string;
      kind: PaperLiveAgentFrameKind;
      label: string;
      geometry: PaperLiveAgentGeometry;
      text?: string;
      columns?: number;
      shapeKind?: Exclude<PaperShapeKind, 'line'>;
      mediaPrompt?: string;
      style?: PaperLiveAgentStyle;
    }
  | { op: 'updateFrame'; frameId: string; patch: PaperLiveAgentFramePatch }
  | { op: 'removeFrame'; frameId: string }
  | { op: 'placeSourceAsset'; frameId: string; sourceItemId: string }
  | { op: 'setBackground'; color: string }
  | { op: 'setMargins'; margins: { top: number; right: number; bottom: number; left: number } };

export interface PaperLiveAgentTurn {
  status: 'working' | 'done' | 'blocked';
  message?: string;
  operations: PaperLiveAgentOperation[];
}

export interface PaperLiveAgentIssue {
  path: string;
  message: string;
}

export class PaperLiveAgentValidationError extends Error {
  readonly issues: PaperLiveAgentIssue[];

  constructor(message: string, issues: PaperLiveAgentIssue[]) {
    super(message);
    this.name = 'PaperLiveAgentValidationError';
    this.issues = issues;
  }
}

/**
 * Session-owned context threading agent state across operations and turns.
 * `pageAliases` maps agent-proposed page aliases to real document page IDs;
 * `ownedFrameIds` is the set of frames the agent created and may modify.
 */
export interface PaperLiveAgentContext {
  ownedFrameIds: Set<string>;
  pageAliases: Map<string, string>;
  resolveSourceItem: (sourceItemId: string) => SourceBinLibraryItem | undefined;
}

export function createPaperLiveAgentContext(
  resolveSourceItem: PaperLiveAgentContext['resolveSourceItem'],
): PaperLiveAgentContext {
  return { ownedFrameIds: new Set(), pageAliases: new Map(), resolveSourceItem };
}

export interface PaperLiveAgentApplyResult {
  document: PaperDocument;
  changed: boolean;
  /** Human-readable one-line summary for the live activity log. */
  summary: string;
  /** Real document page ID created or referenced by an addPage/addFrame op. */
  pageId?: string;
  frameId?: string;
}

/**
 * Strictly parses one model response. Like the assisted-layout parser, this
 * deliberately does not unwrap code fences, repair syntax, or accept partial
 * turns: a malformed response becomes issues fed back to the model.
 */
export function parsePaperLiveAgentTurn(responseText: string): PaperLiveAgentTurn {
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new PaperLiveAgentValidationError('The layout agent returned an empty response.', [
      { path: '$', message: 'response is empty' },
    ]);
  }
  if (trimmed.length > PAPER_LIVE_AGENT_LIMITS.maxResponseCharacters) {
    throw new PaperLiveAgentValidationError('The layout agent response is too large.', [
      { path: '$', message: `exceeds ${PAPER_LIVE_AGENT_LIMITS.maxResponseCharacters} characters` },
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new PaperLiveAgentValidationError('The layout agent must return one JSON turn without commentary or code fences.', [
      { path: '$', message: 'response is not valid JSON' },
    ]);
  }

  const issues: PaperLiveAgentIssue[] = [];
  const root = expectRecord(parsed, '$', ['status', 'message', 'operations'], issues);
  if (!root) throw new PaperLiveAgentValidationError('Invalid layout-agent turn', issues);
  if (root.status !== 'working' && root.status !== 'done' && root.status !== 'blocked') {
    issues.push({ path: '$.status', message: 'must be working, done, or blocked' });
  }
  if (root.message !== undefined) {
    expectSafeString(root.message, '$.message', issues, 1, PAPER_LIVE_AGENT_LIMITS.maxMessageCharacters);
  }
  const operations = expectArray(root.operations, '$.operations', issues, 0, PAPER_LIVE_AGENT_LIMITS.maxOperationsPerTurn);
  operations?.forEach((operation, index) => validateOperation(operation, `$.operations[${index}]`, issues));

  if (issues.length > 0) throw new PaperLiveAgentValidationError('Invalid layout-agent turn', issues);
  return cloneJson(parsed) as PaperLiveAgentTurn;
}

function validateOperation(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  const operation = expectRecord(value, path, [
    'op', 'id', 'pageId', 'kind', 'label', 'geometry', 'text', 'columns', 'shapeKind',
    'mediaPrompt', 'style', 'frameId', 'patch', 'sourceItemId', 'color', 'margins',
  ], issues);
  if (!operation) return;
  switch (operation.op) {
    case 'addPage':
      validateAgentId(operation.id, `${path}.id`, issues);
      return;
    case 'addFrame': {
      validateAgentId(operation.id, `${path}.id`, issues);
      expectPageReference(operation.pageId, `${path}.pageId`, issues);
      const kind = typeof operation.kind === 'string' && FRAME_KINDS.has(operation.kind as PaperLiveAgentFrameKind)
        ? operation.kind as PaperLiveAgentFrameKind
        : undefined;
      if (!kind) issues.push({ path: `${path}.kind`, message: 'must be a supported Paper frame kind' });
      expectSafeString(operation.label, `${path}.label`, issues, 1, PAPER_LIVE_AGENT_LIMITS.maxLabelCharacters);
      validateGeometry(operation.geometry, `${path}.geometry`, issues);
      if (operation.text !== undefined) {
        expectSafeString(operation.text, `${path}.text`, issues, 0, PAPER_LIVE_AGENT_LIMITS.maxTextCharacters);
        if (kind && !TEXT_FRAME_KINDS.has(kind)) {
          issues.push({ path: `${path}.text`, message: 'is only valid for text-bearing frames' });
        }
      }
      if (operation.columns !== undefined) {
        expectBoundedNumber(operation.columns, `${path}.columns`, issues, 1, 12, true);
        if (kind && !TEXT_FRAME_KINDS.has(kind)) {
          issues.push({ path: `${path}.columns`, message: 'is only valid for text-bearing frames' });
        }
      }
      if (operation.shapeKind !== undefined) {
        if (typeof operation.shapeKind !== 'string' || !SHAPE_KINDS.has(operation.shapeKind as Exclude<PaperShapeKind, 'line'>)) {
          issues.push({ path: `${path}.shapeKind`, message: 'must be a supported closed shape' });
        }
        if (kind && kind !== 'shape') {
          issues.push({ path: `${path}.shapeKind`, message: 'is only valid for shape frames' });
        }
      }
      validateMediaPrompt(operation.mediaPrompt, `${path}.mediaPrompt`, issues, kind);
      if (operation.style !== undefined) validateStyle(operation.style, `${path}.style`, issues, kind);
      return;
    }
    case 'updateFrame':
      validateOwnedFrameReference(operation.frameId, `${path}.frameId`, issues);
      validateFramePatch(operation.patch, `${path}.patch`, issues);
      return;
    case 'removeFrame':
      validateOwnedFrameReference(operation.frameId, `${path}.frameId`, issues);
      return;
    case 'placeSourceAsset':
      validateOwnedFrameReference(operation.frameId, `${path}.frameId`, issues);
      // Source item IDs come from the Source Library, not the agent namespace; authorization is
      // enforced at apply time because only snapshot-listed items resolve.
      validateAgentId(operation.sourceItemId, `${path}.sourceItemId`, issues, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
      return;
    case 'setBackground':
      validateHex(operation.color, `${path}.color`, issues);
      return;
    case 'setMargins': {
      const margins = expectRecord(operation.margins, `${path}.margins`, ['top', 'right', 'bottom', 'left'], issues);
      if (!margins) return;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        expectBoundedNumber(margins[side], `${path}.margins.${side}`, issues, 0, 1_000);
      }
      return;
    }
    default:
      issues.push({ path: `${path}.op`, message: 'must be addPage, addFrame, updateFrame, removeFrame, placeSourceAsset, setBackground, or setMargins' });
  }
}

function validateFramePatch(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  const patch = expectRecord(value, path, ['label', 'geometry', 'text', 'columns', 'locked', 'mediaPrompt', 'style'], issues);
  if (!patch) return;
  if (patch.label !== undefined) expectSafeString(patch.label, `${path}.label`, issues, 1, PAPER_LIVE_AGENT_LIMITS.maxLabelCharacters);
  if (patch.geometry !== undefined) validateGeometry(patch.geometry, `${path}.geometry`, issues);
  if (patch.text !== undefined) expectSafeString(patch.text, `${path}.text`, issues, 0, PAPER_LIVE_AGENT_LIMITS.maxTextCharacters);
  if (patch.columns !== undefined) expectBoundedNumber(patch.columns, `${path}.columns`, issues, 1, 12, true);
  if (patch.locked !== undefined && typeof patch.locked !== 'boolean') {
    issues.push({ path: `${path}.locked`, message: 'must be a boolean' });
  }
  validateMediaPrompt(patch.mediaPrompt, `${path}.mediaPrompt`, issues, undefined);
  if (patch.style !== undefined) validateStyle(patch.style, `${path}.style`, issues, undefined);
}

function validateMediaPrompt(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
  kind: PaperLiveAgentFrameKind | undefined,
): void {
  if (value === undefined) return;
  expectSafeString(value, path, issues, 1, PAPER_LIVE_AGENT_LIMITS.maxMediaPromptCharacters);
  if (kind && kind !== 'image') {
    issues.push({ path, message: 'is only valid for image placeholders' });
  }
}

function validateGeometry(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  const geometry = expectRecord(value, path, ['xMm', 'yMm', 'widthMm', 'heightMm', 'rotationDeg'], issues);
  if (!geometry) return;
  expectBoundedNumber(geometry.xMm, `${path}.xMm`, issues, -50, 2_600);
  expectBoundedNumber(geometry.yMm, `${path}.yMm`, issues, -50, 5_100);
  expectBoundedNumber(geometry.widthMm, `${path}.widthMm`, issues, 0.1, 2_600);
  expectBoundedNumber(geometry.heightMm, `${path}.heightMm`, issues, 0.1, 5_100);
  if (geometry.rotationDeg !== undefined) {
    expectBoundedNumber(geometry.rotationDeg, `${path}.rotationDeg`, issues, -360, 360);
  }
}

function validateStyle(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
  kind: PaperLiveAgentFrameKind | undefined,
): void {
  const style = expectRecord(value, path, [
    'fill', 'fillOpacity', 'stroke', 'strokeOpacity', 'strokeWidthMm', 'cornerRadiusMm', 'opacity', 'typography',
  ], issues);
  if (!style) return;
  if (style.fill !== undefined) validatePaint(style.fill, `${path}.fill`, issues);
  if (style.stroke !== undefined) validatePaint(style.stroke, `${path}.stroke`, issues);
  for (const key of ['fillOpacity', 'strokeOpacity', 'opacity'] as const) {
    if (style[key] !== undefined) expectBoundedNumber(style[key], `${path}.${key}`, issues, 0, 1);
  }
  if (style.strokeWidthMm !== undefined) expectBoundedNumber(style.strokeWidthMm, `${path}.strokeWidthMm`, issues, 0, 50);
  if (style.cornerRadiusMm !== undefined) expectBoundedNumber(style.cornerRadiusMm, `${path}.cornerRadiusMm`, issues, 0, 1_000);
  if (style.typography !== undefined) {
    if (kind && !TEXT_FRAME_KINDS.has(kind)) {
      issues.push({ path: `${path}.typography`, message: 'is only valid for text-bearing frames' });
    }
    validateTypography(style.typography, `${path}.typography`, issues);
  }
}

function validatePaint(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  const paint = expectRecord(value, path, ['kind', 'value'], issues);
  if (!paint) return;
  if (paint.kind === 'hex') {
    validateHex(paint.value, `${path}.value`, issues);
  } else if (paint.kind !== 'none') {
    issues.push({ path: `${path}.kind`, message: 'must be hex or none' });
  }
}

function validateTypography(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  const typography = expectRecord(value, path, [
    'fontFamily', 'fontSizePt', 'leadingPt', 'tracking', 'align', 'hyphenate', 'color', 'fontWeight', 'fontStyle',
  ], issues);
  if (!typography) return;
  if (typography.fontFamily !== undefined) {
    const family = expectSafeString(typography.fontFamily, `${path}.fontFamily`, issues, 1, 128);
    if (family && !SAFE_FONT_FAMILY_PATTERN.test(family)) {
      issues.push({ path: `${path}.fontFamily`, message: 'must be a local family name without CSS syntax' });
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
  if (typography.color !== undefined) validateHex(typography.color, `${path}.color`, issues);
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

/**
 * Applies one validated operation to a document. Pure: returns a new document
 * (or the same reference when nothing changed) plus a log summary. Alias and
 * ownership bookkeeping updates the supplied session context.
 */
export function applyPaperLiveAgentOperation(
  document: PaperDocument,
  operation: PaperLiveAgentOperation,
  context: PaperLiveAgentContext,
): PaperLiveAgentApplyResult {
  switch (operation.op) {
    case 'addPage': {
      if (context.pageAliases.has(operation.id)) {
        return unchanged(document, `Page alias ${operation.id} already exists; ignored.`);
      }
      const before = document.pages[document.pages.length - 1]?.id;
      const next = addPaperPage(document);
      const created = next.pages.find((page) => page.id !== before && !document.pages.some((p) => p.id === page.id));
      const pageId = created?.id ?? next.pages[next.pages.length - 1]?.id;
      if (!pageId) return unchanged(document, 'Could not add a page.');
      context.pageAliases.set(operation.id, pageId);
      return { document: next, changed: true, summary: `Added page ${next.pages.length}.`, pageId };
    }
    case 'addFrame': {
      const pageId = resolvePageId(document, operation.pageId, context);
      if (!pageId) return unchanged(document, `Skipped frame ${operation.id}: unknown page ${operation.pageId}.`);
      if (findFrame(document, operation.id)) {
        return unchanged(document, `Skipped frame ${operation.id}: ID already exists.`);
      }
      const { document: next, frameId } = addFrameToPaperPage(document, pageId, {
        id: operation.id,
        kind: operation.kind,
        label: operation.label,
        xMm: operation.geometry.xMm,
        yMm: operation.geometry.yMm,
        widthMm: operation.geometry.widthMm,
        heightMm: operation.geometry.heightMm,
        rotationDeg: operation.geometry.rotationDeg ?? 0,
        columns: operation.columns ?? 1,
        shapeKind: operation.shapeKind,
        text: operation.text,
        generatedMediaPrompt: operation.mediaPrompt,
        ...styleToFrameDraft(operation.style),
      });
      if (next === document || !frameId) return unchanged(document, `Could not add frame ${operation.id}.`);
      context.ownedFrameIds.add(frameId);
      return {
        document: next,
        changed: true,
        summary: `Added ${operation.kind} “${operation.label}” on page ${pageNumberOf(next, pageId)}.`,
        pageId,
        frameId,
      };
    }
    case 'updateFrame': {
      const located = locateOwnedFrame(document, operation.frameId, context);
      if (!located) return unchanged(document, `Skipped update: ${operation.frameId} is not an agent-owned frame.`);
      const patch = framePatchToPaperPatch(operation.patch);
      const next = updatePaperFrame(document, located.pageId, located.frame.id, patch);
      if (next === document) return unchanged(document, `No change for “${located.frame.label}”.`);
      return {
        document: next,
        changed: true,
        summary: `Updated “${operation.patch.label ?? located.frame.label}” on page ${pageNumberOf(next, located.pageId)}.`,
        pageId: located.pageId,
        frameId: located.frame.id,
      };
    }
    case 'removeFrame': {
      const located = locateOwnedFrame(document, operation.frameId, context);
      if (!located) return unchanged(document, `Skipped removal: ${operation.frameId} is not an agent-owned frame.`);
      const next = {
        ...document,
        pages: document.pages.map((page) =>
          page.id === located.pageId
            ? { ...page, frames: page.frames.filter((frame) => frame.id !== located.frame.id) }
            : page),
        updatedAt: Date.now(),
      };
      context.ownedFrameIds.delete(located.frame.id);
      return {
        document: next,
        changed: true,
        summary: `Removed “${located.frame.label}” from page ${pageNumberOf(next, located.pageId)}.`,
        pageId: located.pageId,
        frameId: located.frame.id,
      };
    }
    case 'placeSourceAsset': {
      const located = locateOwnedFrame(document, operation.frameId, context);
      if (!located) return unchanged(document, `Skipped asset placement: ${operation.frameId} is not an agent-owned frame.`);
      if (!ASSET_FRAME_KINDS.has(located.frame.kind as PaperLiveAgentFrameKind)) {
        return unchanged(document, `Skipped asset placement: “${located.frame.label}” cannot hold a source asset.`);
      }
      const item = context.resolveSourceItem(operation.sourceItemId);
      if (!item) return unchanged(document, `Skipped asset placement: unknown source item ${operation.sourceItemId}.`);
      const next = placeSourceAssetInPaperFrame(document, { pageId: located.pageId, frameId: located.frame.id, item });
      if (next === document) return unchanged(document, `Could not place ${item.label ?? operation.sourceItemId}.`);
      return {
        document: next,
        changed: true,
        summary: `Placed “${item.label ?? operation.sourceItemId}” in “${located.frame.label}”.`,
        pageId: located.pageId,
        frameId: located.frame.id,
      };
    }
    case 'setBackground': {
      const css = operation.color.toLowerCase();
      const next = updatePaperDocumentSetup(document, {
        background: { type: 'solid', color: css, fromColor: css, toColor: css },
      });
      if (next === document) return unchanged(document, 'Background already matches.');
      return { document: next, changed: true, summary: `Set the page background to ${css}.` };
    }
    case 'setMargins': {
      const next = updatePaperDocumentSetup(document, { marginsMm: { ...operation.margins } });
      if (next === document) return unchanged(document, 'Margins already match.');
      return {
        document: next,
        changed: true,
        summary: `Set margins to ${operation.margins.top}/${operation.margins.right}/${operation.margins.bottom}/${operation.margins.left} mm.`,
      };
    }
  }
}

/** Serializes the compact document context the model sees each turn. */
export function buildPaperLiveAgentSnapshot(
  document: PaperDocument,
  context: PaperLiveAgentContext,
  sourceItems: Array<{ id: string; label: string; kind: string }>,
): string {
  const lines: string[] = [
    `DOCUMENT title=${JSON.stringify(document.title)}`,
    `PAGE size=${document.page.widthMm}x${document.page.heightMm}mm bleed=${document.page.bleedMm}mm dpi=${document.page.dpi}`,
    `MARGINS top=${document.layout.marginsMm.top} right=${document.layout.marginsMm.right} bottom=${document.layout.marginsMm.bottom} left=${document.layout.marginsMm.left}`,
    `BACKGROUND ${document.background.color}`,
  ];
  document.pages.forEach((page, pageIndex) => {
    lines.push(`PAGE[${pageIndex + 1}] id=${page.id} frames=${page.frames.length}`);
    for (const frame of page.frames) {
      const owned = context.ownedFrameIds.has(frame.id);
      const textPreview = typeof frame.text === 'string' && frame.text.trim()
        ? ` text=${JSON.stringify(frame.text.replace(/\s+/g, ' ').trim().slice(0, 80))}`
        : '';
      const asset = frame.asset ? ` asset=${JSON.stringify(frame.asset.label)}` : '';
      lines.push(
        `  FRAME id=${frame.id} kind=${frame.kind} label=${JSON.stringify(frame.label)}`
        + ` geo=${frame.xMm},${frame.yMm},${frame.widthMm}x${frame.heightMm}mm`
        + `${owned ? ' agent-owned' : ''}${asset}${textPreview}`,
      );
    }
  });
  if (sourceItems.length > 0) {
    lines.push('SOURCE_ITEMS (place with placeSourceAsset; only these IDs are valid):');
    sourceItems.slice(0, PAPER_LIVE_AGENT_LIMITS.maxSourceItemsListed).forEach((item) => {
      lines.push(`  SRC id=${item.id} kind=${item.kind} label=${JSON.stringify(item.label)}`);
    });
  }
  const snapshot = lines.join('\n');
  return snapshot.length <= PAPER_LIVE_AGENT_LIMITS.maxSnapshotCharacters
    ? snapshot
    : `${snapshot.slice(0, PAPER_LIVE_AGENT_LIMITS.maxSnapshotCharacters)}\n…snapshot truncated…`;
}

function styleToFrameDraft(style: PaperLiveAgentStyle | undefined): Partial<PaperFramePatch> {
  if (!style) return {};
  return {
    ...(style.fill ? { fillColor: paintCss(style.fill) } : {}),
    ...(style.fillOpacity !== undefined ? { fillOpacity: style.fillOpacity } : {}),
    ...(style.stroke ? { strokeColor: paintCss(style.stroke) } : {}),
    ...(style.strokeOpacity !== undefined ? { strokeOpacity: style.strokeOpacity } : {}),
    ...(style.strokeWidthMm !== undefined ? { strokeWidthMm: style.strokeWidthMm } : {}),
    ...(style.cornerRadiusMm !== undefined ? { cornerRadiusMm: style.cornerRadiusMm } : {}),
    ...(style.opacity !== undefined ? { opacity: style.opacity } : {}),
    ...(style.typography ? { typography: typographyToPaperPatch(style.typography) } : {}),
  };
}

function framePatchToPaperPatch(patch: PaperLiveAgentFramePatch): PaperFramePatch {
  return {
    ...(patch.label !== undefined ? { label: patch.label } : {}),
    ...(patch.geometry ? {
      xMm: patch.geometry.xMm,
      yMm: patch.geometry.yMm,
      widthMm: patch.geometry.widthMm,
      heightMm: patch.geometry.heightMm,
      rotationDeg: patch.geometry.rotationDeg ?? 0,
    } : {}),
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.columns !== undefined ? { columns: patch.columns } : {}),
    ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
    ...(patch.mediaPrompt !== undefined ? { generatedMediaPrompt: patch.mediaPrompt } : {}),
    ...styleToFrameDraft(patch.style),
  };
}

function typographyToPaperPatch(typography: PaperLiveAgentTypography): PaperFramePatch['typography'] {
  return {
    ...(typography.fontFamily !== undefined ? { fontFamily: typography.fontFamily } : {}),
    ...(typography.fontSizePt !== undefined ? { fontSizePt: typography.fontSizePt } : {}),
    ...(typography.leadingPt !== undefined ? { leadingPt: typography.leadingPt } : {}),
    ...(typography.tracking !== undefined ? { tracking: typography.tracking } : {}),
    ...(typography.align !== undefined ? { align: typography.align } : {}),
    ...(typography.hyphenate !== undefined ? { hyphenate: typography.hyphenate } : {}),
    ...(typography.color !== undefined ? { color: typography.color.toLowerCase() } : {}),
    ...(typography.fontWeight !== undefined ? { fontWeight: String(typography.fontWeight) } : {}),
    ...(typography.fontStyle !== undefined ? { fontStyle: typography.fontStyle } : {}),
  };
}

function paintCss(paint: { kind: 'hex'; value: string } | { kind: 'none' }): string {
  return paint.kind === 'none' ? 'transparent' : paint.value.toLowerCase();
}

function resolvePageId(
  document: PaperDocument,
  reference: string,
  context: PaperLiveAgentContext,
): string | undefined {
  const alias = context.pageAliases.get(reference);
  if (alias && document.pages.some((page) => page.id === alias)) return alias;
  return document.pages.some((page) => page.id === reference) ? reference : undefined;
}

function findFrame(document: PaperDocument, frameId: string) {
  return document.pages.some((page) => page.frames.some((frame) => frame.id === frameId));
}

function locateOwnedFrame(
  document: PaperDocument,
  frameId: string,
  context: PaperLiveAgentContext,
): { pageId: string; frame: PaperDocument['pages'][number]['frames'][number] } | undefined {
  if (!context.ownedFrameIds.has(frameId)) return undefined;
  for (const page of document.pages) {
    const frame = page.frames.find((candidate) => candidate.id === frameId);
    if (frame) return { pageId: page.id, frame };
  }
  return undefined;
}

function pageNumberOf(document: PaperDocument, pageId: string): number {
  return document.pages.findIndex((page) => page.id === pageId) + 1;
}

function unchanged(document: PaperDocument, summary: string): PaperLiveAgentApplyResult {
  return { document, changed: false, summary };
}

function validateAgentId(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
  pattern: RegExp = PAPER_LIVE_AGENT_ID_PATTERN,
): void {
  if (typeof value !== 'string' || !pattern.test(value)) {
    issues.push({ path, message: 'must be a safe session ID (letters, numbers, . _ : -)' });
  }
}

function validateOwnedFrameReference(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  if (typeof value !== 'string' || !PAPER_LIVE_AGENT_ID_PATTERN.test(value)) {
    issues.push({ path, message: 'must reference an agent-created frame ID (agent-…)' });
  }
}

function expectPageReference(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || FORBIDDEN_ACTIVE_CONTENT.test(value)) {
    issues.push({ path, message: 'must be a page ID from the snapshot or an agent page alias' });
  }
}

function validateHex(value: unknown, path: string, issues: PaperLiveAgentIssue[]): void {
  if (typeof value !== 'string' || !HEX_PATTERN.test(value)) {
    issues.push({ path, message: 'must be a six-digit hexadecimal color' });
  }
}

function expectRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: PaperLiveAgentIssue[],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, message: 'must be a plain object' });
    return undefined;
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push({ path: `${path}.${key}`, message: 'is not allowed by the protocol' });
  }
  return value as Record<string, unknown>;
}

function expectArray(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
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

function expectSafeString(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
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
  if (FORBIDDEN_ACTIVE_CONTENT.test(value)) {
    issues.push({ path, message: 'must not contain URLs, URL-bearing CSS, or script markup' });
  }
  return value;
}

function expectBoundedNumber(
  value: unknown,
  path: string,
  issues: PaperLiveAgentIssue[],
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

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
