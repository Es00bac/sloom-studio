import type { EditorVisualClip, TextClipEffect } from '../types/flow';
import { createEditorVisualClip } from './manualEditorState';
import {
  parseSrtCaptions,
  parseWebVttCaptions,
  serializeSrtCaptions,
  serializeWebVttCaptions,
  type CaptionCue,
} from './videoCaptions';

/** Semantic caption authoring with a deliberately bounded TTML interchange subset. */
export const VIDEO_CAPTION_AUTHORING_VERSION = 1 as const;
export const MAX_VIDEO_CAPTION_CUES = 20_000;
export const MAX_VIDEO_CAPTION_SOURCE_BYTES = 2 * 1024 * 1024;
export const VIDEO_CAPTION_DELIVERY_BOUNDARY = 'srt-vtt-and-bounded-ttml-text-only' as const;
// MH-087 supplies one native-CPU MP4/MOV `mov_text` mux.  This retained list is the wider
// broadcast/styled delivery boundary that the authoring interchange layer still cannot produce.
export const VIDEO_CAPTION_UNAVAILABLE_DELIVERIES = ['cea-608', 'cea-708', 'scc', 'styled-or-broadcast-caption-mux'] as const;

export type VideoCaptionFormat = 'srt' | 'vtt' | 'ttml';

export interface VideoCaptionStyle {
  fontFamily: string;
  fontSizePx: number;
  color: string;
  backgroundColor?: string;
  backgroundOpacityPercent: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right';
  effect: TextClipEffect;
}

export interface VideoCaptionPosition {
  xPercent: number;
  yPercent: number;
  anchor: 'top' | 'middle' | 'bottom';
}

export interface VideoSemanticCaptionCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  language?: string;
  speaker?: string;
  style?: Partial<VideoCaptionStyle>;
  position?: VideoCaptionPosition;
}

export interface VideoCaptionDocument {
  version: typeof VIDEO_CAPTION_AUTHORING_VERSION;
  id: string;
  language?: string;
  defaultStyle: VideoCaptionStyle;
  defaultPosition: VideoCaptionPosition;
  cues: VideoSemanticCaptionCue[];
}

export interface VideoCaptionInterchangeResult {
  data: string;
  mediaType: string;
  fileExtension: '.srt' | '.vtt' | '.ttml';
  warnings: string[];
}

export type VideoCaptionQcCode = 'cps' | 'line-length' | 'overlap' | 'gap' | 'unsafe-position';

export interface VideoCaptionQcIssue {
  code: VideoCaptionQcCode;
  severity: 'warning' | 'error';
  cueId: string;
  relatedCueId?: string;
  detail: string;
}

export interface VideoCaptionQcOptions {
  maxCharactersPerSecond?: number;
  maxCharactersPerLine?: number;
  minimumGapMs?: number;
  safeAreaPercent?: number;
}

export interface VideoCaptionFindReplaceResult {
  document: VideoCaptionDocument;
  replacementCount: number;
  changedCueIds: string[];
}

const DEFAULT_STYLE: VideoCaptionStyle = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSizePx: 54,
  color: '#ffffff',
  backgroundOpacityPercent: 0,
  fontWeight: 600,
  fontStyle: 'normal',
  textAlign: 'center',
  effect: 'shadow',
};

const DEFAULT_POSITION: VideoCaptionPosition = { xPercent: 50, yPercent: 85, anchor: 'bottom' };

export function createVideoCaptionDocument(input: {
  id: string;
  language?: string;
  cues?: VideoSemanticCaptionCue[];
  defaultStyle?: Partial<VideoCaptionStyle>;
  defaultPosition?: Partial<VideoCaptionPosition>;
}): VideoCaptionDocument {
  return normalizeVideoCaptionDocument({
    version: VIDEO_CAPTION_AUTHORING_VERSION,
    id: input.id,
    language: input.language,
    cues: input.cues,
    defaultStyle: input.defaultStyle,
    defaultPosition: input.defaultPosition,
  }, input.id);
}

export function normalizeVideoCaptionDocument(value: unknown, fallbackId = 'captions'): VideoCaptionDocument {
  const input = isRecord(value) ? value : {};
  const id = optionalText(input.id, 300) ?? requiredText(fallbackId, 'caption document id', 300);
  const cues = Array.isArray(input.cues)
    ? input.cues.slice(0, MAX_VIDEO_CAPTION_CUES).map(normalizeCue).filter(isDefined)
    : [];
  return {
    version: VIDEO_CAPTION_AUTHORING_VERSION,
    id,
    language: normalizeLanguage(input.language),
    defaultStyle: normalizeStyle(input.defaultStyle, DEFAULT_STYLE),
    defaultPosition: normalizePosition(input.defaultPosition, DEFAULT_POSITION),
    cues: dedupeCues(cues),
  };
}

export function parseVideoCaptionDocument(
  source: string,
  format: VideoCaptionFormat,
  options: { id?: string; language?: string } = {},
): VideoCaptionDocument {
  assertCaptionSourceBound(source);
  const id = options.id ?? 'imported-captions';
  if (format === 'ttml') return parseBoundedTtml(source, id, options.language);
  const cues = format === 'srt' ? parseSrtCaptions(source) : parseWebVttCaptions(source);
  return createVideoCaptionDocument({
    id,
    language: options.language,
    cues: cues.slice(0, MAX_VIDEO_CAPTION_CUES).map((cue, index) => ({
      id: cue.id ?? `cue-${index + 1}`,
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
      language: options.language,
    })),
  });
}

export function serializeVideoCaptionDocument(
  document: VideoCaptionDocument,
  format: VideoCaptionFormat,
): VideoCaptionInterchangeResult {
  const normalized = normalizeVideoCaptionDocument(document, document.id);
  if (format === 'ttml') {
    return {
      data: serializeBoundedTtml(normalized),
      mediaType: 'application/ttml+xml',
      fileExtension: '.ttml',
      warnings: ['TTML export is a bounded text/style/position subset; regions, animations, profiles, and embedded broadcast captions are not emitted.'],
    };
  }
  const cues: CaptionCue[] = normalized.cues.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text }));
  const semanticWarning = normalized.cues.some((cue) => cue.language || cue.speaker || cue.style || cue.position)
    ? ['SRT/VTT does not retain all semantic speaker, style, language, or position metadata.']
    : [];
  return format === 'srt'
    ? { data: serializeSrtCaptions(cues), mediaType: 'application/x-subrip', fileExtension: '.srt', warnings: semanticWarning }
    : { data: serializeWebVttCaptions(cues), mediaType: 'text/vtt', fileExtension: '.vtt', warnings: semanticWarning };
}

export function splitVideoCaptionCue(
  document: VideoCaptionDocument,
  cueId: string,
  splitMs: number,
  nextCueId: string,
  textOffset?: number,
): VideoCaptionDocument {
  const cue = document.cues.find((candidate) => candidate.id === cueId);
  if (!cue) throw new Error('Caption cue was not found.');
  const split = Math.round(splitMs);
  if (split <= cue.startMs || split >= cue.endMs) throw new Error('Caption split must be inside the cue range.');
  if (document.cues.some((candidate) => candidate.id === nextCueId)) throw new Error('The new caption cue id is already in use.');
  const [leftText, rightText] = splitCaptionText(cue.text, (split - cue.startMs) / (cue.endMs - cue.startMs), textOffset);
  const nextCues = document.cues.flatMap((candidate) => candidate.id === cueId ? [
    { ...candidate, endMs: split, text: leftText },
    { ...candidate, id: requiredText(nextCueId, 'new caption cue id', 300), startMs: split, text: rightText },
  ] : [cloneCue(candidate)]);
  return { ...document, cues: sortCues(nextCues) };
}

export function mergeVideoCaptionCues(
  document: VideoCaptionDocument,
  firstCueId: string,
  secondCueId: string,
  separator = ' ',
): VideoCaptionDocument {
  const sorted = sortCues(document.cues);
  const firstIndex = sorted.findIndex((cue) => cue.id === firstCueId);
  if (firstIndex < 0 || sorted[firstIndex + 1]?.id !== secondCueId) {
    throw new Error('Caption merge requires consecutive cues in timeline order.');
  }
  const first = sorted[firstIndex];
  const second = sorted[firstIndex + 1];
  const merged = { ...first, endMs: second.endMs, text: `${first.text}${separator}${second.text}`.trim() };
  return { ...document, cues: [...sorted.slice(0, firstIndex), merged, ...sorted.slice(firstIndex + 2)].map(cloneCue) };
}

export function rippleVideoCaptionCues(
  document: VideoCaptionDocument,
  fromMs: number,
  deltaMs: number,
): VideoCaptionDocument {
  if (!Number.isFinite(fromMs) || !Number.isFinite(deltaMs)) throw new Error('Caption ripple values must be finite.');
  const boundary = Math.max(0, Math.round(fromMs));
  const delta = Math.round(deltaMs);
  return {
    ...document,
    cues: sortCues(document.cues.map((cue) => {
      if (cue.startMs < boundary) return cloneCue(cue);
      const duration = cue.endMs - cue.startMs;
      const startMs = Math.max(0, cue.startMs + delta);
      return { ...cloneCue(cue), startMs, endMs: startMs + duration };
    })),
  };
}

export function findReplaceVideoCaptions(
  document: VideoCaptionDocument,
  find: string,
  replacement: string,
  options: { caseSensitive?: boolean; wholeWord?: boolean } = {},
): VideoCaptionFindReplaceResult {
  if (!find) throw new Error('Caption find text is required.');
  const flags = options.caseSensitive ? 'gu' : 'giu';
  const boundary = options.wholeWord ? '\\b' : '';
  const pattern = new RegExp(`${boundary}${escapeRegExp(find)}${boundary}`, flags);
  let replacementCount = 0;
  const changedCueIds: string[] = [];
  const cues = document.cues.map((cue) => {
    let cueCount = 0;
    const text = cue.text.replace(pattern, () => {
      cueCount += 1;
      return replacement;
    });
    if (cueCount === 0) return cloneCue(cue);
    replacementCount += cueCount;
    changedCueIds.push(cue.id);
    return { ...cloneCue(cue), text };
  });
  return { document: { ...document, cues }, replacementCount, changedCueIds };
}

export function analyzeVideoCaptionQc(
  document: VideoCaptionDocument,
  options: VideoCaptionQcOptions = {},
): VideoCaptionQcIssue[] {
  const maxCps = positiveOr(options.maxCharactersPerSecond, 20);
  const maxLine = Math.round(positiveOr(options.maxCharactersPerLine, 42));
  const minimumGapMs = Math.max(0, Math.round(options.minimumGapMs ?? 80));
  const safeArea = clamp(options.safeAreaPercent ?? 5, 0, 40);
  const issues: VideoCaptionQcIssue[] = [];
  const cues = sortCues(document.cues);
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const durationSeconds = (cue.endMs - cue.startMs) / 1_000;
    const characterCount = [...cue.text.replace(/\s/gu, '')].length;
    const cps = durationSeconds > 0 ? characterCount / durationSeconds : Number.POSITIVE_INFINITY;
    if (cps > maxCps) issues.push({ code: 'cps', severity: 'warning', cueId: cue.id, detail: `${cps.toFixed(1)} characters/second exceeds ${maxCps}.` });
    const longestLine = Math.max(...cue.text.split('\n').map((line) => [...line].length));
    if (longestLine > maxLine) issues.push({ code: 'line-length', severity: 'warning', cueId: cue.id, detail: `${longestLine} characters on one line exceeds ${maxLine}.` });
    const position = normalizePosition(cue.position, document.defaultPosition);
    if (position.xPercent < safeArea || position.xPercent > 100 - safeArea
      || position.yPercent < safeArea || position.yPercent > 100 - safeArea) {
      issues.push({ code: 'unsafe-position', severity: 'warning', cueId: cue.id, detail: `Caption anchor is outside the ${safeArea}% title-safe inset.` });
    }
    const previous = cues[index - 1];
    if (!previous) continue;
    if (cue.startMs < previous.endMs) {
      issues.push({ code: 'overlap', severity: 'error', cueId: cue.id, relatedCueId: previous.id, detail: `Cue overlaps ${previous.id} by ${previous.endMs - cue.startMs}ms.` });
    } else {
      const gap = cue.startMs - previous.endMs;
      if (gap > 0 && gap < minimumGapMs) {
        issues.push({ code: 'gap', severity: 'warning', cueId: cue.id, relatedCueId: previous.id, detail: `${gap}ms gap is shorter than ${minimumGapMs}ms.` });
      }
    }
  }
  return issues;
}

export function projectVideoCaptionsToTextClips(
  document: VideoCaptionDocument,
  options: { trackIndex?: number; sourceNodeId?: string } = {},
): EditorVisualClip[] {
  const trackIndex = clampInteger(options.trackIndex ?? 0, 0, 63);
  const sourceNodeId = options.sourceNodeId ?? `caption-document:${document.id}`;
  return sortCues(document.cues).map((cue) => {
    const style = normalizeStyle(cue.style, document.defaultStyle);
    const position = normalizePosition(cue.position, document.defaultPosition);
    const generated = createEditorVisualClip(sourceNodeId, 'text', {
      trackIndex,
      startMs: cue.startMs,
      durationSeconds: (cue.endMs - cue.startMs) / 1_000,
      textContent: cue.text,
      textFontFamily: style.fontFamily,
      textSizePx: style.fontSizePx,
      textColor: style.color,
      textEffect: style.effect,
      textBackgroundOpacityPercent: style.backgroundOpacityPercent,
      positionX: position.xPercent - 50,
      positionY: position.yPercent - 50,
      textTypography: { fontWeight: style.fontWeight, fontStyle: style.fontStyle, textAlign: style.textAlign },
      transitionDurationMs: 0,
    });
    return { ...generated, id: `caption-${cue.id}` };
  });
}

function parseBoundedTtml(source: string, id: string, fallbackLanguage?: string): VideoCaptionDocument {
  const rootLanguage = matchAttribute(source.match(/<tt\b([^>]*)>/iu)?.[1] ?? '', 'xml:lang') ?? fallbackLanguage;
  const cues: VideoSemanticCaptionCue[] = [];
  const paragraphPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/giu;
  let match: RegExpExecArray | null;
  while ((match = paragraphPattern.exec(source)) && cues.length < MAX_VIDEO_CAPTION_CUES) {
    const attributes = match[1];
    const begin = parseTtmlTime(matchAttribute(attributes, 'begin'));
    const end = parseTtmlTime(matchAttribute(attributes, 'end'));
    if (begin === undefined || end === undefined || end <= begin) continue;
    const cueId = matchAttribute(attributes, 'xml:id') ?? `cue-${cues.length + 1}`;
    const text = decodeXmlText(match[2]);
    if (!text) continue;
    const origin = parseTtmlOrigin(matchAttribute(attributes, 'tts:origin'));
    cues.push({
      id: cueId,
      startMs: begin,
      endMs: end,
      text,
      language: matchAttribute(attributes, 'xml:lang') ?? rootLanguage,
      speaker: matchAttribute(attributes, 'data-speaker'),
      style: parseTtmlStyle(attributes),
      position: origin,
    });
  }
  return createVideoCaptionDocument({ id, language: rootLanguage, cues });
}

function serializeBoundedTtml(document: VideoCaptionDocument): string {
  const language = document.language ? ` xml:lang="${escapeXml(document.language)}"` : '';
  const body = document.cues.map((cue) => {
    const style = normalizeStyle(cue.style, document.defaultStyle);
    const position = normalizePosition(cue.position, document.defaultPosition);
    const cueLanguage = cue.language ? ` xml:lang="${escapeXml(cue.language)}"` : '';
    const speaker = cue.speaker ? ` data-speaker="${escapeXml(cue.speaker)}"` : '';
    const attributes = [
      `xml:id="${escapeXml(cue.id)}"`,
      `begin="${formatTtmlTime(cue.startMs)}"`,
      `end="${formatTtmlTime(cue.endMs)}"`,
      `tts:fontFamily="${escapeXml(style.fontFamily)}"`,
      `tts:fontSize="${style.fontSizePx}px"`,
      `tts:color="${style.color}"`,
      `tts:textAlign="${style.textAlign}"`,
      `tts:origin="${position.xPercent}% ${position.yPercent}%"`,
    ].join(' ');
    return `      <p ${attributes}${cueLanguage}${speaker}>${escapeXml(cue.text).replaceAll('\n', '<br/>')}</p>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling"${language}>\n  <body>\n    <div>\n${body}\n    </div>\n  </body>\n</tt>\n`;
}

function parseTtmlStyle(attributes: string): Partial<VideoCaptionStyle> | undefined {
  const fontFamily = matchAttribute(attributes, 'tts:fontFamily');
  const fontSize = matchAttribute(attributes, 'tts:fontSize');
  const color = matchAttribute(attributes, 'tts:color');
  const textAlign = matchAttribute(attributes, 'tts:textAlign');
  const style: Partial<VideoCaptionStyle> = {};
  if (fontFamily) style.fontFamily = fontFamily;
  if (fontSize && /^\d+(?:\.\d+)?px$/u.test(fontSize)) style.fontSizePx = Number.parseFloat(fontSize);
  if (color && normalizeColor(color)) style.color = normalizeColor(color);
  if (textAlign === 'left' || textAlign === 'center' || textAlign === 'right') style.textAlign = textAlign;
  return Object.keys(style).length ? style : undefined;
}

function normalizeCue(value: unknown): VideoSemanticCaptionCue | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalText(value.id, 300);
  const text = optionalText(value.text, 10_000);
  const startMs = finiteInteger(value.startMs);
  const endMs = finiteInteger(value.endMs);
  if (!id || !text || startMs < 0 || endMs <= startMs) return undefined;
  return {
    id,
    startMs,
    endMs,
    text,
    language: normalizeLanguage(value.language),
    speaker: optionalText(value.speaker, 200),
    style: isRecord(value.style) ? normalizePartialStyle(value.style) : undefined,
    position: isRecord(value.position) ? normalizePosition(value.position, DEFAULT_POSITION) : undefined,
  };
}

function normalizeStyle(value: unknown, fallback: VideoCaptionStyle): VideoCaptionStyle {
  const input = isRecord(value) ? value : {};
  return {
    fontFamily: optionalText(input.fontFamily, 500) ?? fallback.fontFamily,
    fontSizePx: clamp(numberOr(input.fontSizePx, fallback.fontSizePx), 8, 400),
    color: normalizeColor(input.color) ?? fallback.color,
    backgroundColor: normalizeColor(input.backgroundColor) ?? fallback.backgroundColor,
    backgroundOpacityPercent: clamp(numberOr(input.backgroundOpacityPercent, fallback.backgroundOpacityPercent), 0, 100),
    fontWeight: clampInteger(input.fontWeight ?? fallback.fontWeight, 100, 900),
    fontStyle: input.fontStyle === 'italic' ? 'italic' : fallback.fontStyle,
    textAlign: input.textAlign === 'left' || input.textAlign === 'right' || input.textAlign === 'center' ? input.textAlign : fallback.textAlign,
    effect: input.effect === 'none' || input.effect === 'outline' || input.effect === 'shadow' ? input.effect : fallback.effect,
  };
}

function normalizePartialStyle(value: Record<string, unknown>): Partial<VideoCaptionStyle> {
  const normalized = normalizeStyle(value, DEFAULT_STYLE);
  const result: Partial<VideoCaptionStyle> = {};
  if (value.fontFamily !== undefined) result.fontFamily = normalized.fontFamily;
  if (value.fontSizePx !== undefined) result.fontSizePx = normalized.fontSizePx;
  if (value.color !== undefined) result.color = normalized.color;
  if (value.backgroundColor !== undefined) result.backgroundColor = normalized.backgroundColor;
  if (value.backgroundOpacityPercent !== undefined) result.backgroundOpacityPercent = normalized.backgroundOpacityPercent;
  if (value.fontWeight !== undefined) result.fontWeight = normalized.fontWeight;
  if (value.fontStyle !== undefined) result.fontStyle = normalized.fontStyle;
  if (value.textAlign !== undefined) result.textAlign = normalized.textAlign;
  if (value.effect !== undefined) result.effect = normalized.effect;
  return result;
}

function normalizePosition(value: unknown, fallback: VideoCaptionPosition): VideoCaptionPosition {
  const input = isRecord(value) ? value : {};
  return {
    xPercent: clamp(numberOr(input.xPercent, fallback.xPercent), 0, 100),
    yPercent: clamp(numberOr(input.yPercent, fallback.yPercent), 0, 100),
    anchor: input.anchor === 'top' || input.anchor === 'middle' || input.anchor === 'bottom' ? input.anchor : fallback.anchor,
  };
}

function splitCaptionText(text: string, ratio: number, explicitOffset?: number): [string, string] {
  const boundedOffset = explicitOffset === undefined
    ? Math.round(text.length * clamp(ratio, 0, 1))
    : clampInteger(explicitOffset, 1, Math.max(1, text.length - 1));
  let offset = boundedOffset;
  if (explicitOffset === undefined) {
    const candidates = [...text.matchAll(/\s+/gu)].map((match) => match.index ?? 0).filter((index) => index > 0 && index < text.length);
    if (candidates.length) offset = candidates.reduce((best, candidate) => Math.abs(candidate - boundedOffset) < Math.abs(best - boundedOffset) ? candidate : best);
  }
  const left = text.slice(0, offset).trim();
  const right = text.slice(offset).trim();
  if (!left || !right) throw new Error('Caption split must leave text on both cues.');
  return [left, right];
}

function parseTtmlTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = /^(\d+(?:\.\d+)?)s$/u.exec(value);
  if (seconds) return Math.round(Number(seconds[1]) * 1_000);
  const clock = /^(\d{1,3}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u.exec(value);
  if (!clock) return undefined;
  return (Number(clock[1]) * 3_600 + Number(clock[2]) * 60 + Number(clock[3])) * 1_000
    + Number((clock[4] ?? '0').padEnd(3, '0').slice(0, 3));
}

function formatTtmlTime(value: number): string {
  const ms = Math.max(0, Math.round(value));
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1_000);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms % 1_000).padStart(3, '0')}`;
}

function parseTtmlOrigin(value: string | undefined): VideoCaptionPosition | undefined {
  const match = value ? /^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/u.exec(value.trim()) : undefined;
  return match ? normalizePosition({ xPercent: Number(match[1]), yPercent: Number(match[2]), anchor: 'bottom' }, DEFAULT_POSITION) : undefined;
}

function matchAttribute(attributes: string, name: string): string | undefined {
  const escaped = escapeRegExp(name);
  const match = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'iu').exec(attributes);
  return match ? decodeXmlEntities(match[1] ?? match[2] ?? '') : undefined;
}

function decodeXmlText(value: string): string {
  return decodeXmlEntities(value.replace(/<br\s*\/?\s*>/giu, '\n').replace(/<[^>]+>/gu, '')).trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function assertCaptionSourceBound(source: string): void {
  if (new TextEncoder().encode(source).byteLength > MAX_VIDEO_CAPTION_SOURCE_BYTES) {
    throw new Error(`Caption input exceeds the ${MAX_VIDEO_CAPTION_SOURCE_BYTES} byte limit.`);
  }
}

function dedupeCues(cues: VideoSemanticCaptionCue[]): VideoSemanticCaptionCue[] {
  const seen = new Set<string>();
  return sortCues(cues.filter((cue) => {
    if (seen.has(cue.id)) return false;
    seen.add(cue.id);
    return true;
  })).slice(0, MAX_VIDEO_CAPTION_CUES);
}

function sortCues(cues: readonly VideoSemanticCaptionCue[]): VideoSemanticCaptionCue[] {
  return cues.map(cloneCue).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id));
}

function cloneCue(cue: VideoSemanticCaptionCue): VideoSemanticCaptionCue {
  return { ...cue, style: cue.style ? { ...cue.style } : undefined, position: cue.position ? { ...cue.position } : undefined };
}

function normalizeLanguage(value: unknown): string | undefined {
  const language = optionalText(value, 35);
  return language && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(language) ? language : undefined;
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/u.test(color) ? color : undefined;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : -1;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampInteger(value: unknown, minimum: number, maximum: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : minimum;
  return Math.max(minimum, Math.min(maximum, number));
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) || undefined : undefined;
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = optionalText(value, maxLength);
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
