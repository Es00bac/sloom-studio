import type { EditorAudioClip } from '../types/flow';

export const VIDEO_VOICEOVER_AUTHORING_VERSION = 1 as const;
export const MAX_VIDEO_VOICEOVER_PARAGRAPH_CHARACTERS = 5_000;
export const MAX_VIDEO_VOICEOVER_ALIGNMENT_CHARACTERS = 40_000;
export const MAX_VIDEO_VOICEOVER_ALIGNMENT_WORDS = 10_000;
export const MAX_VIDEO_VOICEOVER_ORIGINAL_REFERENCES = 256;
export const MAX_VIDEO_RANGE_SFX_PROMPT_CHARACTERS = 1_000;
export const MAX_VIDEO_RANGE_SFX_DURATION_MS = 30_000;
export const MAX_VIDEO_GENERATED_AUDIO_DURATION_MS = 10 * 60 * 1_000;
export const MAX_VIDEO_VOICEOVER_TIMELINE_MS = 12 * 60 * 60 * 1_000;

export interface VideoAudioProviderSelection {
  providerId: string;
  modelId: string;
}

export interface VideoVoiceoverParagraph {
  id: string;
  revision: number;
  text: string;
  languageCode: string;
  voiceId: string;
  originalReferenceIds: readonly string[];
  lastRequestId?: string;
}

export interface VideoVoiceoverTtsRequest {
  version: typeof VIDEO_VOICEOVER_AUTHORING_VERSION;
  kind: 'tts-with-timestamps';
  requestId: string;
  provider: Readonly<VideoAudioProviderSelection>;
  voiceId: string;
  paragraph: Readonly<VideoVoiceoverParagraph>;
  outputFormat: 'mp3' | 'wav';
  timestampGranularity: readonly ['character', 'word'];
  rightsAttestationId: string;
  billingConsentId: string;
  usageIntent: Readonly<{ unit: 'characters'; amount: number }>;
}

export interface VideoRangeSfxRequest {
  version: typeof VIDEO_VOICEOVER_AUTHORING_VERSION;
  kind: 'range-sfx';
  requestId: string;
  provider: Readonly<VideoAudioProviderSelection>;
  prompt: string;
  timelineStartMs: number;
  timelineEndMs: number;
  loop: boolean;
  outputFormat: 'mp3' | 'wav';
  rightsAttestationId: string;
  billingConsentId: string;
  originalReferenceIds: readonly string[];
  usageIntent: Readonly<{ unit: 'seconds'; amount: number }>;
}

export interface VideoVoiceoverRawAlignment {
  characters: readonly string[] | string;
  characterStartSeconds: readonly number[];
  characterEndSeconds: readonly number[];
  words?: readonly {
    text: string;
    startSeconds: number;
    endSeconds: number;
  }[];
}

export interface VideoVoiceoverAlignedCharacter {
  index: number;
  text: string;
  startMs: number;
  endMs: number;
}

export interface VideoVoiceoverAlignedWord {
  index: number;
  text: string;
  startCharacterIndex: number;
  endCharacterIndex: number;
  startMs: number;
  endMs: number;
}

export interface VideoVoiceoverAlignment {
  text: string;
  characters: readonly VideoVoiceoverAlignedCharacter[];
  words: readonly VideoVoiceoverAlignedWord[];
  durationMs: number;
}

export type VideoGeneratedAudioRole = 'voiceover' | 'range-sfx';

export interface VideoGeneratedAudioProvenance {
  version: typeof VIDEO_VOICEOVER_AUTHORING_VERSION;
  origin: 'generated';
  role: VideoGeneratedAudioRole;
  providerId: string;
  modelId: string;
  requestId: string;
  generatedAt: string;
  originalReferenceIds: readonly string[];
  rightsAttestationId: string;
  paragraphId?: string;
  paragraphRevision?: number;
  range?: Readonly<{ startMs: number; endMs: number }>;
}

export interface VideoGeneratedAudioAsset {
  id: string;
  sourceNodeId: string;
  label: string;
  durationMs: number;
  mimeType: 'audio/mpeg' | 'audio/wav';
  provenance: Readonly<VideoGeneratedAudioProvenance>;
}

export interface VideoGeneratedAudioPlacementProposal {
  version: typeof VIDEO_VOICEOVER_AUTHORING_VERSION;
  kind: 'insert-generated-audio';
  baseSignature: string;
  preservedOriginalClipIds: readonly string[];
  generatedAsset: Readonly<VideoGeneratedAudioAsset>;
  addedClip: Readonly<EditorAudioClip>;
}

export type VideoGeneratedAudioPlacementResult =
  | { ok: true; audioClips: EditorAudioClip[]; addedClipId: string; preservedOriginalClipIds: readonly string[] }
  | { ok: false; reason: 'duplicate-clip-id' | 'invalid-placement' | 'stale-placement'; detail: string };

export function createVideoVoiceoverParagraph(input: {
  id: string;
  text: string;
  languageCode: string;
  voiceId: string;
  originalReferenceIds?: readonly string[];
}): VideoVoiceoverParagraph {
  return normalizeParagraph({ ...input, revision: 1 });
}

export function regenerateVideoVoiceoverParagraph(
  paragraph: VideoVoiceoverParagraph,
  input: { requestId: string; text?: string; languageCode?: string; voiceId?: string },
): VideoVoiceoverParagraph {
  const requestId = requiredText(input.requestId, 'Voiceover request id', 200);
  return normalizeParagraph({
    ...paragraph,
    revision: paragraph.revision + 1,
    text: input.text ?? paragraph.text,
    languageCode: input.languageCode ?? paragraph.languageCode,
    voiceId: input.voiceId ?? paragraph.voiceId,
    originalReferenceIds: paragraph.originalReferenceIds,
    lastRequestId: requestId,
  });
}

export function createVideoVoiceoverTtsRequest(input: {
  requestId: string;
  provider: VideoAudioProviderSelection;
  paragraph: VideoVoiceoverParagraph;
  outputFormat?: 'mp3' | 'wav';
  rightsAttestationId: string;
  billingConsentId: string;
}): VideoVoiceoverTtsRequest {
  const paragraph = normalizeParagraph(input.paragraph);
  const request: VideoVoiceoverTtsRequest = Object.freeze({
    version: VIDEO_VOICEOVER_AUTHORING_VERSION,
    kind: 'tts-with-timestamps',
    requestId: requiredText(input.requestId, 'Voiceover request id', 200),
    provider: Object.freeze(normalizeProvider(input.provider)),
    voiceId: paragraph.voiceId,
    paragraph: Object.freeze({ ...paragraph, originalReferenceIds: Object.freeze([...paragraph.originalReferenceIds]) }),
    outputFormat: input.outputFormat ?? 'mp3',
    timestampGranularity: Object.freeze(['character', 'word'] as const),
    rightsAttestationId: requiredText(input.rightsAttestationId, 'Rights attestation id', 200),
    billingConsentId: requiredText(input.billingConsentId, 'Billing consent id', 200),
    usageIntent: Object.freeze({ unit: 'characters', amount: paragraph.text.length }),
  });
  assertCredentialFreeVideoVoiceoverValue(request);
  return request;
}

export function createVideoRangeSfxRequest(input: {
  requestId: string;
  provider: VideoAudioProviderSelection;
  prompt: string;
  timelineStartMs: number;
  timelineEndMs: number;
  loop?: boolean;
  outputFormat?: 'mp3' | 'wav';
  rightsAttestationId: string;
  billingConsentId: string;
  originalReferenceIds?: readonly string[];
}): VideoRangeSfxRequest {
  const prompt = requiredText(input.prompt, 'Sound-effect prompt', MAX_VIDEO_RANGE_SFX_PROMPT_CHARACTERS);
  const durationMs = validateTimelineRange(input.timelineStartMs, input.timelineEndMs, MAX_VIDEO_RANGE_SFX_DURATION_MS, 'Sound-effect range');
  const request: VideoRangeSfxRequest = Object.freeze({
    version: VIDEO_VOICEOVER_AUTHORING_VERSION,
    kind: 'range-sfx',
    requestId: requiredText(input.requestId, 'Sound-effect request id', 200),
    provider: Object.freeze(normalizeProvider(input.provider)),
    prompt,
    timelineStartMs: input.timelineStartMs,
    timelineEndMs: input.timelineEndMs,
    loop: input.loop ?? false,
    outputFormat: input.outputFormat ?? 'mp3',
    rightsAttestationId: requiredText(input.rightsAttestationId, 'Rights attestation id', 200),
    billingConsentId: requiredText(input.billingConsentId, 'Billing consent id', 200),
    originalReferenceIds: Object.freeze(normalizeReferences(input.originalReferenceIds ?? [])),
    usageIntent: Object.freeze({ unit: 'seconds', amount: durationMs / 1_000 }),
  });
  assertCredentialFreeVideoVoiceoverValue(request);
  return request;
}

export function normalizeVideoVoiceoverAlignment(
  expectedText: string,
  raw: VideoVoiceoverRawAlignment,
): VideoVoiceoverAlignment {
  const characters = typeof raw.characters === 'string' ? Array.from(raw.characters) : [...raw.characters];
  if (characters.length > MAX_VIDEO_VOICEOVER_ALIGNMENT_CHARACTERS) {
    throw new Error(`Voiceover alignment exceeds ${MAX_VIDEO_VOICEOVER_ALIGNMENT_CHARACTERS.toLocaleString()} characters.`);
  }
  if (characters.join('') !== expectedText) throw new Error('Voiceover alignment characters do not reproduce the authored paragraph exactly.');
  if (raw.characterStartSeconds.length !== characters.length || raw.characterEndSeconds.length !== characters.length) {
    throw new Error('Voiceover character alignment arrays must have equal lengths.');
  }
  let previousCharacterStartMs = -1;
  const normalizedCharacters: VideoVoiceoverAlignedCharacter[] = characters.map((text, index) => {
    if (!text) throw new Error(`Voiceover alignment character ${index + 1} is empty.`);
    const startMs = secondsToMilliseconds(raw.characterStartSeconds[index], `character ${index + 1} start`);
    const endMs = secondsToMilliseconds(raw.characterEndSeconds[index], `character ${index + 1} end`);
    if (endMs < startMs) throw new Error(`Voiceover alignment character ${index + 1} ends before it starts.`);
    if (startMs < previousCharacterStartMs) {
      throw new Error('Voiceover alignment character starts must be ordered.');
    }
    previousCharacterStartMs = startMs;
    return { index, text, startMs, endMs };
  });
  const words = raw.words
    ? normalizeSuppliedWords(raw.words, expectedText, normalizedCharacters)
    : deriveAlignedWords(normalizedCharacters);
  if (words.length > MAX_VIDEO_VOICEOVER_ALIGNMENT_WORDS) {
    throw new Error(`Voiceover alignment exceeds ${MAX_VIDEO_VOICEOVER_ALIGNMENT_WORDS.toLocaleString()} words.`);
  }
  return Object.freeze({
    text: expectedText,
    characters: normalizedCharacters.map((character) => Object.freeze(character)),
    words: words.map((word) => Object.freeze(word)),
    durationMs: normalizedCharacters.reduce((maximum, character) => Math.max(maximum, character.endMs), 0),
  });
}

export function createVideoGeneratedAudioProvenance(input: {
  role: VideoGeneratedAudioRole;
  provider: VideoAudioProviderSelection;
  requestId: string;
  generatedAt: string;
  originalReferenceIds?: readonly string[];
  rightsAttestationId: string;
  paragraph?: Pick<VideoVoiceoverParagraph, 'id' | 'revision'>;
  range?: { startMs: number; endMs: number };
}): VideoGeneratedAudioProvenance {
  const generatedAt = new Date(input.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) throw new Error('Generated-audio provenance needs a valid timestamp.');
  if (input.role === 'voiceover' && !input.paragraph) throw new Error('Voiceover provenance needs paragraph identity.');
  if (input.role === 'range-sfx' && !input.range) throw new Error('Range sound-effect provenance needs a timeline range.');
  if (input.range) validateTimelineRange(input.range.startMs, input.range.endMs, MAX_VIDEO_RANGE_SFX_DURATION_MS, 'Provenance range');
  const provider = normalizeProvider(input.provider);
  const provenance: VideoGeneratedAudioProvenance = Object.freeze({
    version: VIDEO_VOICEOVER_AUTHORING_VERSION,
    origin: 'generated',
    role: input.role,
    providerId: provider.providerId,
    modelId: provider.modelId,
    requestId: requiredText(input.requestId, 'Provider request id', 200),
    generatedAt: generatedAt.toISOString(),
    originalReferenceIds: Object.freeze(normalizeReferences(input.originalReferenceIds ?? [])),
    rightsAttestationId: requiredText(input.rightsAttestationId, 'Rights attestation id', 200),
    ...(input.paragraph ? { paragraphId: requiredText(input.paragraph.id, 'Paragraph id', 200), paragraphRevision: positiveInteger(input.paragraph.revision, 'Paragraph revision') } : {}),
    ...(input.range ? { range: Object.freeze({ startMs: input.range.startMs, endMs: input.range.endMs }) } : {}),
  });
  assertCredentialFreeVideoVoiceoverValue(provenance);
  return provenance;
}

export function buildVideoGeneratedAudioPlacementProposal(input: {
  existingAudioClips: readonly EditorAudioClip[];
  generatedAsset: VideoGeneratedAudioAsset;
  clipId: string;
  trackIndex: number;
  startMs: number;
  volumePercent?: number;
  busId?: string;
}): VideoGeneratedAudioPlacementProposal {
  validateGeneratedAsset(input.generatedAsset);
  const clipId = requiredText(input.clipId, 'Generated clip id', 200);
  if (input.existingAudioClips.some((clip) => clip.id === clipId)) throw new Error(`Audio clip id '${clipId}' already exists.`);
  if (!Number.isInteger(input.trackIndex) || input.trackIndex < 0 || input.trackIndex >= 64) throw new Error('Generated audio needs a track from 1 through 64.');
  validateTimelineRange(input.startMs, input.startMs + input.generatedAsset.durationMs, MAX_VIDEO_GENERATED_AUDIO_DURATION_MS, 'Generated audio placement');
  const clip: EditorAudioClip = Object.freeze({
    id: clipId,
    sourceNodeId: input.generatedAsset.sourceNodeId,
    offsetMs: input.startMs,
    sourceInMs: 0,
    sourceOutMs: input.generatedAsset.durationMs,
    trackIndex: input.trackIndex,
    volumePercent: clamp(input.volumePercent ?? 100, 0, 150),
    enabled: true,
    professional: { pan: 0, ...(input.busId?.trim() ? { busId: input.busId.trim() } : {}) },
  });
  const proposal: VideoGeneratedAudioPlacementProposal = Object.freeze({
    version: VIDEO_VOICEOVER_AUTHORING_VERSION,
    kind: 'insert-generated-audio',
    baseSignature: audioTimelineSignature(input.existingAudioClips),
    preservedOriginalClipIds: Object.freeze(input.existingAudioClips.map((existing) => existing.id)),
    generatedAsset: Object.freeze({ ...input.generatedAsset, provenance: Object.freeze({ ...input.generatedAsset.provenance }) }),
    addedClip: clip,
  });
  assertCredentialFreeVideoVoiceoverValue(proposal);
  return proposal;
}

export function applyVideoGeneratedAudioPlacement(
  existingAudioClips: readonly EditorAudioClip[],
  proposal: VideoGeneratedAudioPlacementProposal,
): VideoGeneratedAudioPlacementResult {
  if (proposal.version !== VIDEO_VOICEOVER_AUTHORING_VERSION || proposal.baseSignature !== audioTimelineSignature(existingAudioClips)) {
    return { ok: false, reason: 'stale-placement', detail: 'Audio clips changed after the generated placement was planned.' };
  }
  if (existingAudioClips.some((clip) => clip.id === proposal.addedClip.id)) {
    return { ok: false, reason: 'duplicate-clip-id', detail: `Audio clip id '${proposal.addedClip.id}' already exists.` };
  }
  if (proposal.addedClip.sourceNodeId !== proposal.generatedAsset.sourceNodeId) {
    return { ok: false, reason: 'invalid-placement', detail: 'Generated clip source does not match its generated asset.' };
  }
  const clonedOriginals = existingAudioClips.map(cloneAudioClip);
  const audioClips = [...clonedOriginals, cloneAudioClip(proposal.addedClip)].sort(
    (left, right) => left.offsetMs - right.offsetMs || left.trackIndex - right.trackIndex || left.id.localeCompare(right.id),
  );
  return {
    ok: true,
    audioClips,
    addedClipId: proposal.addedClip.id,
    preservedOriginalClipIds: proposal.preservedOriginalClipIds,
  };
}

/** Reject accidental credentials even when a caller circumvents the exported TypeScript contracts. */
export function assertCredentialFreeVideoVoiceoverValue(value: unknown): void {
  const seen = new Set<unknown>();
  let entries = 0;
  const visit = (candidate: unknown, depth: number): void => {
    if (candidate === null || typeof candidate !== 'object') return;
    if (depth > 12 || entries > 20_000) throw new Error('Voiceover contract exceeds the credential audit bound.');
    if (seen.has(candidate)) throw new Error('Voiceover contracts must be acyclic and JSON-safe.');
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item) => visit(item, depth + 1));
    } else {
      for (const [key, child] of Object.entries(candidate)) {
        entries += 1;
        if (/(?:api.?key|authorization|credential|password|secret|token)/iu.test(key)) {
          throw new Error(`Voiceover contracts cannot contain credential field '${key}'.`);
        }
        visit(child, depth + 1);
      }
    }
    seen.delete(candidate);
  };
  visit(value, 0);
}

function normalizeParagraph(input: {
  id: string;
  revision: number;
  text: string;
  languageCode: string;
  voiceId: string;
  originalReferenceIds?: readonly string[];
  lastRequestId?: string;
}): VideoVoiceoverParagraph {
  const text = requiredText(input.text, 'Voiceover paragraph', MAX_VIDEO_VOICEOVER_PARAGRAPH_CHARACTERS, false);
  return {
    id: requiredText(input.id, 'Voiceover paragraph id', 200),
    revision: positiveInteger(input.revision, 'Voiceover paragraph revision'),
    text,
    languageCode: requiredText(input.languageCode, 'Voiceover language code', 32),
    voiceId: requiredText(input.voiceId, 'Voiceover voice id', 200),
    originalReferenceIds: normalizeReferences(input.originalReferenceIds ?? []),
    ...(input.lastRequestId ? { lastRequestId: requiredText(input.lastRequestId, 'Voiceover request id', 200) } : {}),
  };
}

function normalizeProvider(provider: VideoAudioProviderSelection): VideoAudioProviderSelection {
  return {
    providerId: requiredText(provider.providerId, 'Audio provider id', 100),
    modelId: requiredText(provider.modelId, 'Audio model id', 200),
  };
}

function normalizeReferences(references: readonly string[]): string[] {
  if (references.length > MAX_VIDEO_VOICEOVER_ORIGINAL_REFERENCES) {
    throw new Error(`Generated audio may reference at most ${MAX_VIDEO_VOICEOVER_ORIGINAL_REFERENCES} originals.`);
  }
  const normalized = references.map((reference) => requiredText(reference, 'Original reference id', 200));
  if (new Set(normalized).size !== normalized.length) throw new Error('Generated-audio original references must be unique.');
  return normalized;
}

function normalizeSuppliedWords(
  words: NonNullable<VideoVoiceoverRawAlignment['words']>,
  _expectedText: string,
  characters: readonly VideoVoiceoverAlignedCharacter[],
): VideoVoiceoverAlignedWord[] {
  if (words.length > MAX_VIDEO_VOICEOVER_ALIGNMENT_WORDS) throw new Error('Voiceover supplied word alignment exceeds the word limit.');
  let searchOffset = 0;
  return words.map((word, index) => {
    const text = requiredText(word.text, `Aligned word ${index + 1}`, 500, false);
    const wordCharacters = Array.from(text);
    const startCharacterIndex = findCharacterSequence(characters, wordCharacters, searchOffset);
    if (startCharacterIndex < 0) throw new Error(`Aligned word ${index + 1} does not match the authored paragraph.`);
    const endCharacterIndex = startCharacterIndex + wordCharacters.length;
    searchOffset = endCharacterIndex;
    const startMs = secondsToMilliseconds(word.startSeconds, `word ${index + 1} start`);
    const endMs = secondsToMilliseconds(word.endSeconds, `word ${index + 1} end`);
    if (endMs <= startMs) throw new Error(`Aligned word ${index + 1} needs positive duration.`);
    const characterStart = characters[startCharacterIndex]?.startMs;
    const characterEnd = characters[endCharacterIndex - 1]?.endMs;
    if (characterStart === undefined || characterEnd === undefined || startMs > characterEnd || endMs < characterStart) {
      throw new Error(`Aligned word ${index + 1} does not overlap its character timing.`);
    }
    return { index, text, startCharacterIndex, endCharacterIndex, startMs, endMs };
  });
}

function findCharacterSequence(
  characters: readonly VideoVoiceoverAlignedCharacter[],
  expected: readonly string[],
  startIndex: number,
): number {
  for (let index = startIndex; index <= characters.length - expected.length; index += 1) {
    if (expected.every((character, offset) => characters[index + offset]?.text === character)) return index;
  }
  return -1;
}

function deriveAlignedWords(characters: readonly VideoVoiceoverAlignedCharacter[]): VideoVoiceoverAlignedWord[] {
  const words: VideoVoiceoverAlignedWord[] = [];
  let start: number | undefined;
  for (let index = 0; index <= characters.length; index += 1) {
    const character = characters[index];
    const isWordCharacter = character !== undefined && !/^\s+$/u.test(character.text);
    if (isWordCharacter && start === undefined) start = index;
    if (isWordCharacter || start === undefined) continue;
    const slice = characters.slice(start, index);
    words.push({
      index: words.length,
      text: slice.map((entry) => entry.text).join(''),
      startCharacterIndex: start,
      endCharacterIndex: index,
      startMs: slice[0]!.startMs,
      endMs: slice.at(-1)!.endMs,
    });
    start = undefined;
  }
  return words;
}

function validateGeneratedAsset(asset: VideoGeneratedAudioAsset): void {
  requiredText(asset.id, 'Generated asset id', 200);
  requiredText(asset.sourceNodeId, 'Generated asset source id', 200);
  requiredText(asset.label, 'Generated asset label', 300);
  if (!Number.isFinite(asset.durationMs) || asset.durationMs <= 0 || asset.durationMs > MAX_VIDEO_GENERATED_AUDIO_DURATION_MS) {
    throw new Error(`Generated audio duration must be no more than ${MAX_VIDEO_GENERATED_AUDIO_DURATION_MS / 1_000} seconds.`);
  }
  if (asset.mimeType !== 'audio/mpeg' && asset.mimeType !== 'audio/wav') throw new Error('Generated audio must be MP3 or WAV.');
  if (asset.provenance.origin !== 'generated') throw new Error('Generated audio needs generated provenance.');
  assertCredentialFreeVideoVoiceoverValue(asset.provenance);
}

function validateTimelineRange(startMs: number, endMs: number, maximumDurationMs: number, label: string): number {
  const durationMs = endMs - startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs
    || endMs > MAX_VIDEO_VOICEOVER_TIMELINE_MS || durationMs > maximumDurationMs) {
    throw new Error(`${label} must be positive, finite, within the feature timeline, and no longer than ${maximumDurationMs / 1_000} seconds.`);
  }
  return durationMs;
}

function requiredText(value: string, label: string, maximumLength: number, trim = true): string {
  const normalized = trim ? value.trim() : value;
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > maximumLength) throw new Error(`${label} exceeds ${maximumLength.toLocaleString()} characters.`);
  return normalized;
}

function secondsToMilliseconds(value: number | undefined, label: string): number {
  if (!Number.isFinite(value) || (value ?? -1) < 0) throw new Error(`Voiceover ${label} is invalid.`);
  return Math.round(value! * 1_000 * 1_000) / 1_000;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function cloneAudioClip(clip: EditorAudioClip): EditorAudioClip {
  return {
    ...clip,
    professional: clip.professional ? { ...clip.professional } : undefined,
    audioProcessing: clip.audioProcessing ? { ...clip.audioProcessing } : undefined,
  };
}

function audioTimelineSignature(clips: readonly EditorAudioClip[]): string {
  const material = clips.map((clip) => [clip.id, clip.sourceNodeId, clip.offsetMs, clip.sourceInMs, clip.sourceOutMs, clip.trackIndex])
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
  let hash = 0x811c9dc5;
  const serialized = JSON.stringify(material);
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
