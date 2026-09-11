import type { EnvelopeItem, ResultType } from '../types/flow';

export type FlowPrimitiveKind = Extract<ResultType, 'text' | 'number' | 'boolean' | 'json'>;
export type EnvelopeItemKind = ResultType | 'mixed';

const PRIMITIVE_KINDS = new Set<string>(['text', 'number', 'boolean', 'json']);
const RESULT_KINDS = new Set<string>([
  'text',
  'number',
  'boolean',
  'json',
  'image',
  'video',
  'audio',
  'package',
  'list',
  'envelope',
]);

export function isFlowPrimitiveKind(value: unknown): value is FlowPrimitiveKind {
  return typeof value === 'string' && PRIMITIVE_KINDS.has(value);
}

export function isFlowResultKind(value: unknown): value is ResultType {
  return typeof value === 'string' && RESULT_KINDS.has(value);
}

export function normalizeEnvelopeItemKind(value: unknown): EnvelopeItemKind {
  if (value === 'mixed') {
    return 'mixed';
  }
  return isFlowResultKind(value) ? value : 'mixed';
}

export function isFixedEnvelopeItemKind(value: unknown): value is ResultType {
  return isFlowResultKind(value);
}

export function getDefaultMimeTypeForFlowKind(kind: ResultType): string {
  switch (kind) {
    case 'image':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'package':
      return 'application/zip';
    case 'number':
    case 'text':
      return 'text/plain';
    case 'boolean':
      return 'application/x.boolean';
    case 'json':
    case 'list':
    case 'envelope':
      return 'application/json';
  }
}

export function serializeManualEnvelopeValue(kind: ResultType, value: unknown): string {
  if (kind === 'boolean') {
    return parseBooleanLike(value) ? 'true' : 'false';
  }

  if (kind === 'number') {
    const numberValue = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isFinite(numberValue) ? String(numberValue) : '0';
  }

  if (kind === 'json') {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value ?? {});
  }

  return String(value ?? '');
}

export function parseManualEnvelopeValue(
  kind: ResultType,
  rawValue: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (kind === 'number') {
    const value = Number(rawValue.trim());
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, error: 'Enter a finite number.' };
  }

  if (kind === 'boolean') {
    return { ok: true, value: parseBooleanLike(rawValue) };
  }

  if (kind === 'json') {
    try {
      return { ok: true, value: JSON.parse(rawValue) };
    } catch {
      return { ok: false, error: 'Enter valid JSON.' };
    }
  }

  return { ok: true, value: rawValue };
}

export function createManualEnvelopeItem({
  id,
  index,
  kind,
  label,
  value,
}: {
  id?: string;
  index: number;
  kind: ResultType;
  label?: string;
  value?: unknown;
}): EnvelopeItem {
  return {
    id: id ?? `manual-envelope-item-${index}`,
    index,
    kind,
    label: label?.trim() || `${capitalize(kind)} ${index + 1}`,
    value: serializeManualEnvelopeValue(kind, value ?? defaultValueForKind(kind)),
    mimeType: getDefaultMimeTypeForFlowKind(kind),
  };
}

function defaultValueForKind(kind: ResultType): unknown {
  if (kind === 'number') return 0;
  if (kind === 'boolean') return false;
  if (kind === 'json') return {};
  return '';
}

function parseBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
