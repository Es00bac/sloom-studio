import type { PaperFrame, PaperFrameKind, PaperFramePatch } from '../types/paper';

/**
 * Bounded, device-local Paper object snippets (MH-073).
 *
 * Snippets contain authored frame data, not project/document identity. Asset-bearing
 * frames are deliberately refused: a local library must never create a dangling or
 * misleading cross-project byte reference. Users can still copy those frames through
 * the ordinary document clipboard when they remain in the same project.
 */

export const PAPER_OBJECT_LIBRARY_MAX_ITEMS = 200;
export const PAPER_OBJECT_LIBRARY_MAX_NAME_LENGTH = 80;
export const PAPER_OBJECT_LIBRARY_MAX_DESCRIPTION_LENGTH = 240;

const REUSABLE_KINDS: ReadonlySet<PaperFrameKind> = new Set([
  'text',
  'caption',
  'speechBubble',
  'thoughtBubble',
  'panel',
  'shape',
]);

export interface PaperObjectLibraryItem {
  id: string;
  name: string;
  description?: string;
  kind: PaperFrameKind;
  createdAt: number;
  updatedAt: number;
  frame: PaperFrame;
}

export interface PaperObjectLibrarySaveInput {
  name: string;
  description?: string;
  now?: number;
  id?: string;
}

export interface PaperObjectLibraryPlacementOptions {
  xMm?: number;
  yMm?: number;
  layerId?: string;
  label?: string;
}

export interface PaperObjectLibraryValidation {
  ok: boolean;
  reason?: string;
}

function clone<T>(value: T): T {
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function makeId(): string {
  return `paper-object-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.floor(Math.random() * 100000)}`}`;
}

export function validatePaperObjectLibraryFrame(frame: PaperFrame): PaperObjectLibraryValidation {
  if (!frame || typeof frame !== 'object') return { ok: false, reason: 'A Paper frame is required.' };
  if (!REUSABLE_KINDS.has(frame.kind)) {
    return { ok: false, reason: 'Image and document frames stay linked to their source project and cannot become local snippets.' };
  }
  if (frame.asset) {
    return { ok: false, reason: 'Asset-bearing frames cannot become snippets without copying project bytes.' };
  }
  if (![frame.xMm, frame.yMm, frame.widthMm, frame.heightMm].every(finite)) {
    return { ok: false, reason: 'The frame has invalid geometry.' };
  }
  return { ok: true };
}

/** Store a detached authored copy, retaining no live object identity. */
export function createPaperObjectLibraryItem(
  frame: PaperFrame,
  input: PaperObjectLibrarySaveInput,
): PaperObjectLibraryItem | undefined {
  if (!validatePaperObjectLibraryFrame(frame).ok) return undefined;
  const name = cleanText(input.name, PAPER_OBJECT_LIBRARY_MAX_NAME_LENGTH);
  if (!name) return undefined;
  const now = finite(input.now) ? input.now : Date.now();
  const description = cleanText(input.description, PAPER_OBJECT_LIBRARY_MAX_DESCRIPTION_LENGTH);
  return {
    id: cleanText(input.id, 160) ?? makeId(),
    name,
    ...(description ? { description } : {}),
    kind: frame.kind,
    createdAt: now,
    updatedAt: now,
    frame: clone(frame),
  };
}

/**
 * Materialize a snippet as an add-frame patch. Document-local identity, placement,
 * locking, parentage, and threading are never copied into another document.
 */
export function materializePaperObjectLibraryItem(
  item: PaperObjectLibraryItem,
  options: PaperObjectLibraryPlacementOptions = {},
): { kind: PaperFrameKind; patch: PaperFramePatch } | undefined {
  if (!validatePaperObjectLibraryFrame(item.frame).ok) return undefined;
  const {
    id: _id,
    xMm: sourceX,
    yMm: sourceY,
    layerId: _sourceLayer,
    locked: _locked,
    inherited: _inherited,
    parentPageId: _parentPageId,
    parentFrameId: _parentFrameId,
    threadId: _threadId,
    threadOrder: _threadOrder,
    zIndex: _zIndex,
    bubbleChainId: _bubbleChainId,
    bubbleChainOrder: _bubbleChainOrder,
    bubbleConnectorGeometry: _bubbleConnectorGeometry,
    ...authored
  } = clone(item.frame);
  return {
    kind: item.kind,
    patch: {
      ...authored,
      xMm: finite(options.xMm) ? options.xMm : sourceX + 4,
      yMm: finite(options.yMm) ? options.yMm : sourceY + 4,
      ...(options.layerId ? { layerId: options.layerId } : {}),
      ...(options.label ? { label: cleanText(options.label, 160) } : {}),
      locked: false,
      inherited: false,
    },
  };
}

/** Most recently updated item first; duplicate IDs are collapsed deterministically. */
export function normalizePaperObjectLibraryItems(value: unknown): PaperObjectLibraryItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: PaperObjectLibraryItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const id = cleanText(record.id, 160);
    const name = cleanText(record.name, PAPER_OBJECT_LIBRARY_MAX_NAME_LENGTH);
    const kind = record.kind;
    const frame = record.frame;
    if (!id || !name || typeof kind !== 'string' || !frame || typeof frame !== 'object' || seen.has(id)) continue;
    const candidate = frame as PaperFrame;
    if (candidate.kind !== kind || !validatePaperObjectLibraryFrame(candidate).ok) continue;
    if (!finite(record.createdAt) || !finite(record.updatedAt)) continue;
    seen.add(id);
    const description = cleanText(record.description, PAPER_OBJECT_LIBRARY_MAX_DESCRIPTION_LENGTH);
    items.push({
      id,
      name,
      ...(description ? { description } : {}),
      kind: candidate.kind,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      frame: clone(candidate),
    });
  }
  return items
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, PAPER_OBJECT_LIBRARY_MAX_ITEMS);
}

export function upsertPaperObjectLibraryItem(
  items: readonly PaperObjectLibraryItem[],
  next: PaperObjectLibraryItem,
): PaperObjectLibraryItem[] {
  return normalizePaperObjectLibraryItems([next, ...items.filter((item) => item.id !== next.id)]);
}

export function removePaperObjectLibraryItem(
  items: readonly PaperObjectLibraryItem[],
  id: string,
): PaperObjectLibraryItem[] {
  return items.filter((item) => item.id !== id);
}

export function searchPaperObjectLibrary(
  items: readonly PaperObjectLibraryItem[],
  query = '',
): PaperObjectLibraryItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => !needle || `${item.name} ${item.description ?? ''} ${item.kind}`.toLowerCase().includes(needle));
}
