// Bounded, pure document text-variable and conditional-text resolution for Paper. Values affect only
// derived canvas/export copies: authored frame text and rich runs remain exactly as the user entered them.

import type {
  PaperDocument,
  PaperFrame,
  PaperRichParagraph,
  PaperTextCondition,
  PaperTextRun,
  PaperTextVariable,
} from '../types/paper';
import { hasPaperFolioToken, resolvePaperFolioText, resolvePaperRichTextFolios } from './paperFolios';
import { flattenPaperRichText } from './paperRichText';

export const PAPER_TEXT_TEMPLATE_LIMITS = {
  maxVariables: 64,
  maxConditions: 64,
  maxNameLength: 48,
  maxValueLength: 4_096,
  maxTotalValueLength: 65_536,
  maxSourceLength: 32_768,
  maxOutputLength: 131_072,
  maxTags: 512,
  maxConditionDepth: 8,
} as const;

export interface PaperTextTemplateContext {
  textVariables?: readonly PaperTextVariable[];
  textConditions?: readonly PaperTextCondition[];
  pageNumber?: number;
  pageCount?: number;
}

type SourceSegment = { type: 'source'; start: number; end: number };
type ReplacementSegment = { type: 'replacement'; styleOffset: number; text: string };
type TemplateSegment = SourceSegment | ReplacementSegment;

type TemplateNode =
  | SourceSegment
  | { type: 'variable'; start: number; end: number; name: string }
  | {
    type: 'condition';
    start: number;
    end: number;
    name: string;
    enabled: TemplateNode[];
    disabled?: TemplateNode[];
  };

type StopTag = 'else' | 'end';

interface ParsedSequence {
  nodes: TemplateNode[];
  cursor: number;
  stop?: { type: StopTag; start: number; end: number };
  overflow?: boolean;
}

interface ParsedTag {
  type: 'variable' | 'condition' | StopTag | 'invalid';
  name?: string;
  end: number;
}

interface ParseState {
  tags: number;
}

interface ResolvedTemplate {
  segments: TemplateSegment[];
  changed: boolean;
}

const TEMPLATE_NAME = /^[a-z][a-z0-9_-]*$/;

/** Normalize one user-facing variable/condition key. Names are case-insensitive in source, stored lowercase. */
export function normalizePaperTextTemplateName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // The accepted grammar is ASCII-only, so reject oversized input before trim/lowercase have to
  // allocate a second attacker-controlled string.
  if (value.length > PAPER_TEXT_TEMPLATE_LIMITS.maxNameLength) return undefined;
  const name = value.trim().toLowerCase();
  return name.length > 0 && name.length <= PAPER_TEXT_TEMPLATE_LIMITS.maxNameLength && TEMPLATE_NAME.test(name)
    ? name
    : undefined;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Keep normal printable Unicode plus tab/newline/carriage-return. A loop avoids a control-character
  // regex, which lint correctly treats as too easy to misuse in a persisted-text boundary. Stop as
  // soon as the retained value reaches its cap: a corrupt persisted catalog must not cause us to
  // materialize or scan an arbitrarily large replacement string.
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) {
      if (result.length + character.length > maxLength) break;
      result += character;
      if (result.length === maxLength) break;
    }
  }
  return result;
}

function cleanId(value: unknown, fallback: string, used: Set<string>): string {
  const proposed = typeof value === 'string'
    ? value.slice(0, 192).trim().replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96)
    : '';
  const base = proposed || fallback;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

/** Fail-closed persistence normalization for the document variable catalog. Invalid and duplicate names drop. */
export function normalizePaperTextVariables(value: unknown): PaperTextVariable[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const variables: PaperTextVariable[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  let totalValueLength = 0;

  for (const item of value) {
    if (variables.length >= PAPER_TEXT_TEMPLATE_LIMITS.maxVariables) break;
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : undefined;
    const name = normalizePaperTextTemplateName(raw?.name);
    const variableValue = cleanText(raw?.value, PAPER_TEXT_TEMPLATE_LIMITS.maxValueLength);
    if (!name || variableValue === undefined || names.has(name)) continue;
    if (totalValueLength + variableValue.length > PAPER_TEXT_TEMPLATE_LIMITS.maxTotalValueLength) break;
    names.add(name);
    totalValueLength += variableValue.length;
    variables.push({
      id: cleanId(raw?.id, `text-variable-${name}`, ids),
      name,
      value: variableValue,
    });
  }
  return variables;
}

/** Fail-closed persistence normalization for the named conditional-text catalog. */
export function normalizePaperTextConditions(value: unknown): PaperTextCondition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const conditions: PaperTextCondition[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();

  for (const item of value) {
    if (conditions.length >= PAPER_TEXT_TEMPLATE_LIMITS.maxConditions) break;
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : undefined;
    const name = normalizePaperTextTemplateName(raw?.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    conditions.push({
      id: cleanId(raw?.id, `text-condition-${name}`, ids),
      name,
      // Missing/untrusted state is false so a malformed persisted condition never publishes optional text.
      enabled: raw?.enabled === true,
    });
  }
  return conditions;
}

function parseTag(source: string, start: number): ParsedTag | undefined {
  const close = source.indexOf('}}', start + 2);
  if (close < 0) return undefined;
  const content = source.slice(start + 2, close).trim();
  const variable = /^var\s*:\s*([a-z][a-z0-9_-]*)$/i.exec(content);
  if (variable) return { type: 'variable', name: variable[1].toLowerCase(), end: close + 2 };
  const condition = /^if\s*:\s*([a-z][a-z0-9_-]*)$/i.exec(content);
  if (condition) return { type: 'condition', name: condition[1].toLowerCase(), end: close + 2 };
  if (/^else$/i.test(content)) return { type: 'else', end: close + 2 };
  if (/^(?:\/if|end)$/i.test(content)) return { type: 'end', end: close + 2 };
  return { type: 'invalid', end: close + 2 };
}

function parseSequence(source: string, start: number, depth: number, state: ParseState, stopAtConditionBoundary: boolean): ParsedSequence {
  if (depth > PAPER_TEXT_TEMPLATE_LIMITS.maxConditionDepth) {
    return { nodes: [{ type: 'source', start, end: source.length }], cursor: source.length, overflow: true };
  }
  const nodes: TemplateNode[] = [];
  let cursor = start;
  let sourceStart = start;
  const flushSource = (end: number) => {
    if (end > sourceStart) nodes.push({ type: 'source', start: sourceStart, end });
  };

  while (cursor < source.length) {
    const tagStart = source.indexOf('{{', cursor);
    if (tagStart < 0) {
      flushSource(source.length);
      return { nodes, cursor: source.length };
    }
    const tag = parseTag(source, tagStart);
    if (!tag) {
      flushSource(source.length);
      return { nodes, cursor: source.length };
    }
    state.tags += 1;
    if (state.tags > PAPER_TEXT_TEMPLATE_LIMITS.maxTags) {
      return { nodes: [{ type: 'source', start, end: source.length }], cursor: source.length, overflow: true };
    }
    if (tag.type === 'invalid') {
      cursor = tag.end;
      continue;
    }
    if (tag.type === 'else' || tag.type === 'end') {
      if (stopAtConditionBoundary) {
        flushSource(tagStart);
        return { nodes, cursor: tag.end, stop: { type: tag.type, start: tagStart, end: tag.end } };
      }
      cursor = tag.end;
      continue;
    }
    if (tag.type === 'variable') {
      flushSource(tagStart);
      nodes.push({ type: 'variable', start: tagStart, end: tag.end, name: tag.name! });
      cursor = tag.end;
      sourceStart = cursor;
      continue;
    }

    flushSource(tagStart);
    const enabled = parseSequence(source, tag.end, depth + 1, state, true);
    if (enabled.overflow || !enabled.stop) {
      return { nodes: [{ type: 'source', start, end: source.length }], cursor: source.length, overflow: enabled.overflow };
    }
    let disabled: TemplateNode[] | undefined;
    let end = enabled.stop.end;
    if (enabled.stop.type === 'else') {
      const parsedDisabled = parseSequence(source, enabled.stop.end, depth + 1, state, true);
      if (parsedDisabled.overflow || !parsedDisabled.stop || parsedDisabled.stop.type !== 'end') {
        return { nodes: [{ type: 'source', start, end: source.length }], cursor: source.length, overflow: parsedDisabled.overflow };
      }
      disabled = parsedDisabled.nodes;
      end = parsedDisabled.stop.end;
    }
    nodes.push({ type: 'condition', start: tagStart, end, name: tag.name!, enabled: enabled.nodes, disabled });
    cursor = end;
    sourceStart = cursor;
  }
  flushSource(source.length);
  return { nodes, cursor: source.length };
}

function templateMaps(context: Pick<PaperTextTemplateContext, 'textVariables' | 'textConditions'>): {
  variables: Map<string, string>;
  conditions: Map<string, boolean>;
} {
  const variables = new Map((normalizePaperTextVariables(context.textVariables) ?? []).map((entry) => [entry.name, entry.value]));
  const conditions = new Map((normalizePaperTextConditions(context.textConditions) ?? []).map((entry) => [entry.name, entry.enabled]));
  return { variables, conditions };
}

function resolveSegments(source: string, context: Pick<PaperTextTemplateContext, 'textVariables' | 'textConditions'>): ResolvedTemplate {
  if (!source || source.length > PAPER_TEXT_TEMPLATE_LIMITS.maxSourceLength || !source.includes('{{')) {
    return { segments: [{ type: 'source', start: 0, end: source.length }], changed: false };
  }
  const parsed = parseSequence(source, 0, 0, { tags: 0 }, false);
  if (parsed.overflow) return { segments: [{ type: 'source', start: 0, end: source.length }], changed: false };
  const { variables, conditions } = templateMaps(context);
  const segments: TemplateSegment[] = [];
  let outputLength = 0;
  let changed = false;
  let overflow = false;
  const append = (segment: TemplateSegment) => {
    const length = segment.type === 'source' ? segment.end - segment.start : segment.text.length;
    if (outputLength + length > PAPER_TEXT_TEMPLATE_LIMITS.maxOutputLength) {
      overflow = true;
      return;
    }
    outputLength += length;
    segments.push(segment);
  };
  const visit = (nodes: readonly TemplateNode[]) => {
    for (const node of nodes) {
      if (overflow) return;
      if (node.type === 'source') {
        append(node);
      } else if (node.type === 'variable') {
        const value = variables.get(node.name);
        if (value === undefined) append({ type: 'source', start: node.start, end: node.end });
        else {
          append({ type: 'replacement', styleOffset: node.start, text: value });
          changed = true;
        }
      } else {
        const enabled = conditions.get(node.name);
        if (enabled === undefined) append({ type: 'source', start: node.start, end: node.end });
        else {
          changed = true;
          visit(enabled ? node.enabled : node.disabled ?? []);
        }
      }
    }
  };
  visit(parsed.nodes);
  return overflow
    ? { segments: [{ type: 'source', start: 0, end: source.length }], changed: false }
    : { segments, changed };
}

function segmentsToText(source: string, segments: readonly TemplateSegment[]): string {
  return segments.map((segment) => (
    segment.type === 'source' ? source.slice(segment.start, segment.end) : segment.text
  )).join('');
}

function appendOriginalRunRange(output: PaperTextRun[], runs: readonly PaperTextRun[], start: number, end: number): void {
  if (end <= start) return;
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = runStart + run.text.length;
    cursor = runEnd;
    const from = Math.max(start, runStart);
    const to = Math.min(end, runEnd);
    if (to > from) output.push({ ...run, text: run.text.slice(from - runStart, to - runStart) });
  }
}

function runAtOffset(runs: readonly PaperTextRun[], offset: number): PaperTextRun {
  let cursor = 0;
  for (const run of runs) {
    const end = cursor + run.text.length;
    if (offset < end) return run;
    cursor = end;
  }
  return runs[runs.length - 1] ?? { text: '' };
}

/** Resolve variable and conditional markup in plain text. Unknown or malformed markup remains literal. */
export function resolvePaperTextTemplates(
  source: string,
  context: Pick<PaperTextTemplateContext, 'textVariables' | 'textConditions'>,
): string {
  const resolved = resolveSegments(source, context);
  return resolved.changed ? segmentsToText(source, resolved.segments) : source;
}

/** Resolve markup across rich-run boundaries while keeping source-run styles and the authored rich source intact. */
export function resolvePaperRichTextTemplates<T extends PaperRichParagraph>(
  paragraphs: readonly T[] | undefined,
  context: Pick<PaperTextTemplateContext, 'textVariables' | 'textConditions'>,
): T[] | undefined {
  if (!paragraphs) return undefined;
  return paragraphs.map((paragraph) => {
    const source = paragraph.runs.map((run) => run.text).join('');
    const resolved = resolveSegments(source, context);
    const listMarker = paragraph.listMarker
      ? resolvePaperTextTemplates(paragraph.listMarker, context)
      : paragraph.listMarker;
    if (!resolved.changed && listMarker === paragraph.listMarker) {
      return { ...paragraph, runs: paragraph.runs.map((run) => ({ ...run })) } as T;
    }
    const runs: PaperTextRun[] = [];
    for (const segment of resolved.segments) {
      if (segment.type === 'source') appendOriginalRunRange(runs, paragraph.runs, segment.start, segment.end);
      else runs.push({ ...runAtOffset(paragraph.runs, segment.styleOffset), text: segment.text });
    }
    return {
      ...paragraph,
      ...(listMarker !== undefined ? { listMarker } : {}),
      runs: runs.length ? runs : [{ text: '' }],
    } as T;
  });
}

/** Resolve one derived display/output frame. Page folios run last so variable values can contain folio markers. */
export function resolvePaperFrameTextTemplates(
  frame: PaperFrame,
  context: PaperTextTemplateContext,
): PaperFrame {
  const textContext = { textVariables: context.textVariables, textConditions: context.textConditions };
  const hasPageContext = context.pageNumber !== undefined && context.pageCount !== undefined;
  if (frame.richText?.length) {
    const carriesTemplateMarkup = frame.richText.some((paragraph) => (
      paragraph.listMarker?.includes('{{') || paragraph.runs.some((run) => run.text.includes('{{'))
    ));
    const carriesFolio = hasPageContext && (carriesTemplateMarkup || frame.richText.some((paragraph) => (
      hasPaperFolioToken(paragraph.listMarker) || paragraph.runs.some((run) => hasPaperFolioToken(run.text))
    )));
    if (!carriesTemplateMarkup && !carriesFolio) return frame;
    let richText = carriesTemplateMarkup
      ? resolvePaperRichTextTemplates(frame.richText, textContext)
      : frame.richText;
    if (carriesFolio) richText = resolvePaperRichTextFolios(richText, context.pageNumber!, context.pageCount!);
    const text = flattenPaperRichText(richText);
    return { ...frame, richText, text };
  }
  const authoredText = frame.text ?? '';
  const carriesTemplateMarkup = authoredText.includes('{{');
  const carriesFolio = hasPageContext && (carriesTemplateMarkup || hasPaperFolioToken(authoredText));
  if (!carriesTemplateMarkup && !carriesFolio) return frame;
  let text = carriesTemplateMarkup ? resolvePaperTextTemplates(authoredText, textContext) : authoredText;
  if (carriesFolio) text = resolvePaperFolioText(text, context.pageNumber!, context.pageCount!);
  return text === authoredText ? frame : { ...frame, text };
}

/** Resolve a page's frames before threaded layout. The returned array is display-only and never persisted. */
export function resolvePaperFramesTextTemplates(
  frames: readonly PaperFrame[],
  document: Pick<PaperDocument, 'textVariables' | 'textConditions' | 'pages'>,
  pageNumber: number,
): PaperFrame[] {
  const context: PaperTextTemplateContext = {
    textVariables: document.textVariables,
    textConditions: document.textConditions,
    pageNumber,
    pageCount: document.pages.length,
  };
  return frames.map((frame) => resolvePaperFrameTextTemplates(frame, context));
}

/** Resolve catalog tokens in a document copy without page-specific folios (used by preflight/font collectors). */
export function resolvePaperDocumentTextTemplates(document: PaperDocument): PaperDocument {
  const variables = normalizePaperTextVariables(document.textVariables) ?? [];
  const conditions = normalizePaperTextConditions(document.textConditions) ?? [];
  if (!variables.length && !conditions.length) return document;
  const context = { textVariables: variables, textConditions: conditions };
  const mapContainer = <T extends { frames: PaperFrame[] }>(container: T): T => {
    const frames = container.frames.map((frame) => resolvePaperFrameTextTemplates(frame, context));
    return frames.some((frame, index) => frame !== container.frames[index]) ? { ...container, frames } : container;
  };
  const pages = document.pages.map(mapContainer);
  const parentPages = document.parentPages.map(mapContainer);
  const changed = pages.some((page, index) => page !== document.pages[index])
    || parentPages.some((page, index) => page !== document.parentPages[index]);
  return changed ? { ...document, pages, parentPages } : document;
}
