import type { CaptionCue } from './videoCaptions';

export const TRANSCRIPTION_OUTPUT_HANDLES = {
  text: 'transcript-text',
  timed: 'timed-transcript',
  vtt: 'captions-vtt',
  srt: 'captions-srt',
} as const;

export interface TimedTranscriptWordV1 {
  text: string;
  startMs?: number;
  endMs?: number;
  type: 'word' | 'spacing' | 'audio_event' | 'unknown';
  speakerId?: string;
  channelIndex?: number;
  logprob?: number;
  alignmentLoss?: number;
}

export interface TimedTranscriptV1 {
  version: 1;
  provider: 'elevenlabs';
  modelId: 'scribe_v2' | 'forced_alignment';
  operation?: 'transcribe' | 'align';
  text: string;
  languageCode?: string;
  languageProbability?: number;
  words: TimedTranscriptWordV1[];
  alignmentLoss?: number;
}

interface ScribeWordLike {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  type?: unknown;
  speaker_id?: unknown;
  channel_index?: unknown;
  logprob?: unknown;
}

interface ScribeResponseLike {
  text?: unknown;
  language_code?: unknown;
  language_probability?: unknown;
  words?: unknown;
}

interface ForcedAlignmentItemLike {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  loss?: unknown;
}

interface ForcedAlignmentResponseLike {
  characters?: unknown;
  words?: unknown;
  loss?: unknown;
}

export function normalizeElevenLabsScribeResponse(payload: unknown): TimedTranscriptV1 {
  if (!isRecord(payload)) {
    throw new Error('ElevenLabs transcription returned an invalid response.');
  }

  const response = payload as ScribeResponseLike;
  const words = Array.isArray(response.words)
    ? response.words.flatMap((item) => normalizeScribeWord(item))
    : [];
  const explicitText = typeof response.text === 'string' ? response.text.trim() : '';
  const derivedText = words.map((word) => word.text).join('').trim();
  const text = explicitText || derivedText;

  if (!text) {
    throw new Error('ElevenLabs transcription completed without transcript text.');
  }

  return {
    version: 1,
    provider: 'elevenlabs',
    modelId: 'scribe_v2',
    operation: 'transcribe',
    text,
    ...(typeof response.language_code === 'string' && response.language_code.trim()
      ? { languageCode: response.language_code.trim() }
      : {}),
    ...(finiteNumber(response.language_probability) !== undefined
      ? { languageProbability: finiteNumber(response.language_probability) }
      : {}),
    words,
  };
}

export function normalizeElevenLabsForcedAlignmentResponse(
  payload: unknown,
  exactText: string,
): TimedTranscriptV1 {
  if (!isRecord(payload) || !exactText) {
    throw new Error('ElevenLabs forced alignment returned an invalid response.');
  }

  const response = payload as ForcedAlignmentResponseLike;
  const characters = Array.isArray(response.characters)
    ? response.characters.flatMap((item) => normalizeAlignmentCharacter(item))
    : [];
  const words = characters.length > 0
    ? reconcileAlignedCharactersWithExactText(characters, exactText)
    : normalizeAlignmentWords(response.words, exactText);

  if (words.length === 0) {
    throw new Error('ElevenLabs forced alignment completed without timing data.');
  }

  return {
    version: 1,
    provider: 'elevenlabs',
    modelId: 'forced_alignment',
    operation: 'align',
    text: exactText,
    words,
    ...(finiteNumber(response.loss) !== undefined ? { alignmentLoss: finiteNumber(response.loss) } : {}),
  };
}

export function timedTranscriptToCaptionCues(transcript: TimedTranscriptV1): CaptionCue[] {
  const cues: CaptionCue[] = [];
  let text = '';
  let startMs: number | undefined;
  let endMs: number | undefined;
  let speakerId: string | undefined;

  const flush = () => {
    const cueText = normalizeCueText(text);
    if (cueText && startMs !== undefined && endMs !== undefined && endMs > startMs) {
      cues.push({ startMs, endMs, text: cueText });
    }
    text = '';
    startMs = undefined;
    endMs = undefined;
    speakerId = undefined;
  };

  for (const word of transcript.words) {
    if (word.type === 'spacing') {
      if (text) text += word.text;
      continue;
    }

    if (word.startMs === undefined || word.endMs === undefined || word.endMs <= word.startMs) {
      if (text) text += word.text;
      continue;
    }

    const speakerChanged = Boolean(text && word.speakerId && speakerId && word.speakerId !== speakerId);
    const wouldBeTooLong = text.trim().length > 0 && `${text}${word.text}`.trim().length > 84;
    const wouldRunTooLong = startMs !== undefined && word.endMs - startMs > 6_000;
    const gapIsLarge = endMs !== undefined && word.startMs - endMs > 900;

    if (speakerChanged || wouldBeTooLong || wouldRunTooLong || gapIsLarge) flush();

    startMs ??= word.startMs;
    endMs = Math.max(endMs ?? word.endMs, word.endMs);
    speakerId ??= word.speakerId;
    text += word.text;

    if (/[.!?。！？][”’"']?$/.test(word.text.trim()) && text.trim().length >= 24) flush();
  }

  flush();
  return cues;
}

function normalizeScribeWord(value: unknown): TimedTranscriptWordV1[] {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text) return [];
  const raw = value as ScribeWordLike;
  const start = finiteNumber(raw.start);
  const end = finiteNumber(raw.end);
  const rawType = typeof raw.type === 'string' ? raw.type : 'unknown';
  const type: TimedTranscriptWordV1['type'] = rawType === 'word' || rawType === 'spacing' || rawType === 'audio_event'
    ? rawType
    : 'unknown';

  return [{
    text: value.text,
    type,
    ...(start !== undefined ? { startMs: Math.max(0, Math.round(start * 1_000)) } : {}),
    ...(end !== undefined ? { endMs: Math.max(0, Math.round(end * 1_000)) } : {}),
    ...(typeof raw.speaker_id === 'string' && raw.speaker_id ? { speakerId: raw.speaker_id } : {}),
    ...(finiteNumber(raw.channel_index) !== undefined ? { channelIndex: finiteNumber(raw.channel_index) } : {}),
    ...(finiteNumber(raw.logprob) !== undefined ? { logprob: finiteNumber(raw.logprob) } : {}),
  }];
}

function normalizeAlignmentCharacter(value: unknown): TimedTranscriptWordV1[] {
  if (!isRecord(value) || typeof value.text !== 'string' || value.text.length === 0) return [];
  const item = value as ForcedAlignmentItemLike;
  const start = finiteNumber(item.start);
  const end = finiteNumber(item.end);
  return [{
    text: value.text,
    type: /^\s+$/.test(value.text) ? 'spacing' : 'word',
    ...(start !== undefined ? { startMs: Math.max(0, Math.round(start * 1_000)) } : {}),
    ...(end !== undefined ? { endMs: Math.max(0, Math.round(end * 1_000)) } : {}),
    ...(finiteNumber(item.loss) !== undefined ? { alignmentLoss: Math.max(0, finiteNumber(item.loss) ?? 0) } : {}),
  }];
}

function reconcileAlignedCharactersWithExactText(
  aligned: TimedTranscriptWordV1[],
  exactText: string,
): TimedTranscriptWordV1[] {
  const providerText = aligned.map((item) => item.text).join('');
  if (providerText === exactText) return aligned;

  const reconciled: TimedTranscriptWordV1[] = [];
  let providerIndex = 0;
  for (const character of exactText) {
    const candidate = aligned[providerIndex];
    if (candidate?.text === character) {
      reconciled.push(candidate);
      providerIndex += 1;
    } else {
      reconciled.push({ text: character, type: /^\s$/.test(character) ? 'spacing' : 'unknown' });
    }
  }
  return reconciled;
}

function normalizeAlignmentWords(value: unknown, exactText: string): TimedTranscriptWordV1[] {
  if (!Array.isArray(value)) return [];
  const output: TimedTranscriptWordV1[] = [];
  let cursor = 0;
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.text !== 'string' || raw.text.length === 0) continue;
    const item = raw as ForcedAlignmentItemLike;
    const foundAt = exactText.indexOf(raw.text, cursor);
    if (foundAt > cursor) {
      output.push({ text: exactText.slice(cursor, foundAt), type: 'spacing' });
    }
    const start = finiteNumber(item.start);
    const end = finiteNumber(item.end);
    output.push({
      text: raw.text,
      type: 'word',
      ...(start !== undefined ? { startMs: Math.max(0, Math.round(start * 1_000)) } : {}),
      ...(end !== undefined ? { endMs: Math.max(0, Math.round(end * 1_000)) } : {}),
      ...(finiteNumber(item.loss) !== undefined ? { alignmentLoss: Math.max(0, finiteNumber(item.loss) ?? 0) } : {}),
    });
    cursor = foundAt >= 0 ? foundAt + raw.text.length : cursor;
  }
  if (cursor < exactText.length) output.push({ text: exactText.slice(cursor), type: 'spacing' });
  return output;
}

function normalizeCueText(value: string): string {
  return value
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
