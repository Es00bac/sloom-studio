import type { EditorVisualClip } from '../types/flow';
import { createEditorVisualClip } from './manualEditorState';

export interface CaptionCue {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
}

export type CaptionFormat = 'srt' | 'vtt';

const DEFAULT_CAPTION_STYLE = {
  textFontFamily: 'Inter, system-ui, sans-serif',
  textSizePx: 54,
  textColor: '#ffffff',
  textEffect: 'shadow' as const,
  textBackgroundOpacityPercent: 0,
};

export function parseSrtCaptions(source: string): CaptionCue[] {
  return parseCaptionBlocks(source.replace(/^\uFEFF/, ''), /-->/, parseSrtTimecode);
}

export function parseWebVttCaptions(source: string): CaptionCue[] {
  const withoutBom = source.replace(/^\uFEFF/, '');
  const body = withoutBom.replace(/^WEBVTT[^\n]*(?:\n|$)/i, '');
  return parseCaptionBlocks(body, /-->/, parseVttTimecode);
}

export function parseCaptionText(source: string, formatHint?: CaptionFormat): CaptionCue[] {
  if (formatHint === 'srt') return parseSrtCaptions(source);
  if (formatHint === 'vtt') return parseWebVttCaptions(source);
  return /^\uFEFF?WEBVTT/i.test(source) ? parseWebVttCaptions(source) : parseSrtCaptions(source);
}

export function serializeSrtCaptions(cues: CaptionCue[]): string {
  return normalizeCaptionCues(cues)
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTimecode(cue.startMs)} --> ${formatSrtTimecode(cue.endMs)}`,
      cue.text,
    ].join('\n'))
    .join('\n\n') + '\n';
}

export function serializeWebVttCaptions(cues: CaptionCue[]): string {
  return 'WEBVTT\n\n' + normalizeCaptionCues(cues)
    .map((cue) => `${formatVttTimecode(cue.startMs)} --> ${formatVttTimecode(cue.endMs)}\n${cue.text}`)
    .join('\n\n') + '\n';
}

export function captionCuesToTextClips(
  cues: CaptionCue[],
  options: { trackIndex?: number; sourceNodeId?: string } = {},
): EditorVisualClip[] {
  const sourceNodeId = options.sourceNodeId ?? 'imported-captions';
  const trackIndex = options.trackIndex ?? 0;

  return normalizeCaptionCues(cues).map((cue) => createEditorVisualClip(sourceNodeId, 'text', {
    trackIndex,
    startMs: cue.startMs,
    durationSeconds: Math.max(0.1, (cue.endMs - cue.startMs) / 1000),
    textContent: cue.text,
    positionY: 36,
    ...DEFAULT_CAPTION_STYLE,
    transitionDurationMs: 0,
  })).map((clip, index) => ({
    ...clip,
    id: `caption-${Date.now()}-${index}`,
  }));
}

export function textClipsToCaptionCues(clips: EditorVisualClip[]): CaptionCue[] {
  return normalizeCaptionCues(
    clips
      .filter((clip) => clip.sourceKind === 'text' && (clip.textContent ?? '').trim())
      .map((clip) => ({
        id: clip.id,
        startMs: clip.startMs,
        endMs: clip.startMs + Math.max(100, Math.round((clip.durationSeconds ?? 4) * 1000)),
        text: (clip.textContent ?? '').trim(),
      })),
  );
}

/**
 * Reconstructs the known spoken script for forced alignment without carrying caption
 * timecodes or cue boundaries into the provider request. English-like cues need an
 * inserted word separator; Japanese, Chinese, and Korean cue boundaries generally do
 * not. The authored cue text itself is otherwise preserved.
 */
export function captionCuesToAlignmentText(cues: CaptionCue[]): string {
  const cueTexts = normalizeCaptionCues(cues)
    .map((cue) => cue.text.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  return cueTexts.reduce((script, cueText) => {
    if (!script) return cueText;
    return `${script}${alignmentCueSeparator(script, cueText)}${cueText}`;
  }, '');
}

export function getCaptionFormatFromFileName(fileName: string): CaptionFormat | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.srt')) return 'srt';
  if (lower.endsWith('.vtt') || lower.endsWith('.webvtt')) return 'vtt';
  return undefined;
}

const CJK_SCRIPT_PATTERN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const CLOSING_PUNCTUATION_PATTERN = /^[,.;:!?%\]\)}〉》」』】、。！？：；]/u;
const OPENING_PUNCTUATION_PATTERN = /[(\[{〈《「『【]$/u;

function alignmentCueSeparator(previous: string, next: string): '' | ' ' {
  if (
    CJK_SCRIPT_PATTERN.test(previous)
    || CJK_SCRIPT_PATTERN.test(next)
    || CLOSING_PUNCTUATION_PATTERN.test(next)
    || OPENING_PUNCTUATION_PATTERN.test(previous)
  ) {
    return '';
  }
  return ' ';
}

function parseCaptionBlocks(
  source: string,
  markerPattern: RegExp,
  parseTimecode: (value: string) => number | undefined,
): CaptionCue[] {
  const blocks = source
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const cues: CaptionCue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((line) => line.trimEnd());
    const timeLineIndex = lines.findIndex((line) => markerPattern.test(line));

    if (timeLineIndex < 0) continue;

    const [startRaw, endAndSettingsRaw] = lines[timeLineIndex].split(/\s+-->\s+/, 2);
    const endRaw = endAndSettingsRaw?.split(/\s+/, 1)[0];
    const startMs = parseTimecode(startRaw);
    const endMs = parseTimecode(endRaw ?? '');

    if (startMs == null || endMs == null || endMs <= startMs) continue;

    const id = timeLineIndex > 0 ? lines.slice(0, timeLineIndex).join(' ').trim() : undefined;
    const text = lines.slice(timeLineIndex + 1).join('\n').trim();

    if (!text) continue;

    cues.push({ id, startMs, endMs, text });
  }

  return normalizeCaptionCues(cues);
}

function normalizeCaptionCues(cues: CaptionCue[]): CaptionCue[] {
  return cues
    .filter((cue) => Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) && cue.endMs > cue.startMs && cue.text.trim())
    .map((cue) => ({
      ...cue,
      startMs: Math.max(0, Math.round(cue.startMs)),
      endMs: Math.max(0, Math.round(cue.endMs)),
      text: cue.text.trim(),
    }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

function parseSrtTimecode(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2}):(\d{2}),(\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  return timePartsToMs(match[1], match[2], match[3], match[4]);
}

function parseVttTimecode(value: string): number | undefined {
  const match = /^(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{1,3})$/.exec(value.trim());
  if (!match) return undefined;
  return timePartsToMs(match[1] ?? '0', match[2], match[3], match[4]);
}

function timePartsToMs(hours: string, minutes: string, seconds: string, millis: string): number {
  const normalizedMillis = millis.padEnd(3, '0').slice(0, 3);
  return (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 + Number(normalizedMillis);
}

function formatSrtTimecode(ms: number): string {
  return formatTimecode(ms, ',');
}

function formatVttTimecode(ms: number): string {
  return formatTimecode(ms, '.');
}

function formatTimecode(ms: number, separator: ',' | '.'): string {
  const safeMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(safeMs / 3_600_000);
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1000);
  const millis = safeMs % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${separator}${String(millis).padStart(3, '0')}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
