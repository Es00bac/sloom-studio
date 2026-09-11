import type { EditorProfessionalWorkflowState, VideoSemanticCaptionTrack } from '../types/videoProduction';
import type { VideoExportPresetOption } from './videoPremiereParity';
import { serializeSrtCaptions } from './videoCaptions';

/**
 * The deliberately small delivery boundary for MH-087.  FFmpeg's `mov_text` muxer produces an
 * ISO-base-media timed-text stream inside an MP4 or MOV; it is an embedded delivery track, not a
 * CEA-608/708, SCC, or certified broadcast-caption workflow.
 */
export const VIDEO_CAPTION_EMBEDDING_FORMAT = 'mov_text' as const;
export const VIDEO_CAPTION_EMBEDDING_INPUT_NAME = 'sequence-embedded-captions.srt' as const;
export const MAX_VIDEO_EMBEDDED_CAPTION_CUES = 5_000;
export const MAX_VIDEO_EMBEDDED_CAPTION_BYTES = 512 * 1024;
export const MAX_VIDEO_EMBEDDED_CAPTION_CUE_CHARACTERS = 500;
export const MAX_VIDEO_EMBEDDED_CAPTION_CUE_DURATION_MS = 60_000;

export interface VideoCaptionEmbeddingIntent {
  enabled: boolean;
  /** The selected semantic track. Omitted means the first retained track. */
  trackId?: string;
}

export interface VideoCaptionEmbeddingPlan {
  format: typeof VIDEO_CAPTION_EMBEDDING_FORMAT;
  inputName: typeof VIDEO_CAPTION_EMBEDDING_INPUT_NAME;
  /** UTF-8 SRT supplied to FFmpeg only for this render; it is not a separate delivered sidecar. */
  srt: string;
  language: string;
  trackId: string;
  cueCount: number;
  /** The authoring overlay style intentionally is not encoded by SRT → mov_text. */
  styleBoundary: 'plain-timing-and-text-only';
}

export type VideoCaptionEmbeddingResolution =
  | { ok: true; value?: VideoCaptionEmbeddingPlan }
  | { ok: false; reason: string };

export function getVideoCaptionEmbeddingIntent(
  state: Pick<EditorProfessionalWorkflowState, 'captionEmbedding'>,
): VideoCaptionEmbeddingIntent {
  return state.captionEmbedding?.enabled
    ? { enabled: true, ...(state.captionEmbedding.trackId ? { trackId: state.captionEmbedding.trackId } : {}) }
    : { enabled: false };
}

/**
 * Produces the only caption input the sequence encoders are allowed to mux.  Keeping all
 * validation here means state loaded from a hand-edited project cannot reach FFmpeg as an
 * unbounded, malformed, styled, or timing-ambiguous subtitle input.
 */
export function buildVideoCaptionEmbeddingPlan(input: {
  workflow: Pick<EditorProfessionalWorkflowState, 'captionEmbedding' | 'captionTracks' | 'timebase'>;
  exportPreset: Pick<VideoExportPresetOption, 'container' | 'extension' | 'imageSequence'>;
  frameRate: number;
}): VideoCaptionEmbeddingResolution {
  const intent = getVideoCaptionEmbeddingIntent(input.workflow);
  if (!intent.enabled) return { ok: true };

  const preset = input.exportPreset;
  if (preset.imageSequence || !['mp4', 'mov'].includes(preset.extension.toLowerCase())) {
    return { ok: false, reason: 'Embedded captions require an MP4 or MOV video delivery preset; image, WebM, and other outputs remain sidecar-only.' };
  }

  const timebaseRate = input.workflow.timebase.numerator / input.workflow.timebase.denominator;
  if (input.workflow.timebase.dropFrame || ![24, 25, 30].includes(timebaseRate)) {
    return { ok: false, reason: 'Embedded captions support only 24, 25, or 30 fps non-drop sequence timebases.' };
  }
  if (!Number.isFinite(input.frameRate) || Math.abs(input.frameRate - timebaseRate) > 0.0001) {
    return { ok: false, reason: 'Embedded captions require the delivery frame rate to match the selected sequence timebase.' };
  }

  const track = findSelectedTrack(input.workflow.captionTracks, intent.trackId);
  if (!track) return { ok: false, reason: 'Choose a retained primary caption track before enabling embedded delivery.' };
  if (track.cues.length === 0) return { ok: false, reason: 'Embedded caption delivery requires at least one caption cue.' };
  if (track.cues.length > MAX_VIDEO_EMBEDDED_CAPTION_CUES) {
    return { ok: false, reason: `Embedded caption delivery is limited to ${MAX_VIDEO_EMBEDDED_CAPTION_CUES.toLocaleString()} cues.` };
  }

  const language = normalizeMovTextLanguage(track.language);
  if (!language) return { ok: false, reason: 'Embedded captions require a three-letter lowercase ISO language code or "und".' };

  let previousEndMs = -1;
  for (const cue of [...track.cues].sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id))) {
    const text = cue.text.trim();
    if (!text || text.length > MAX_VIDEO_EMBEDDED_CAPTION_CUE_CHARACTERS) {
      return { ok: false, reason: `Caption ${cue.id} must contain 1–${MAX_VIDEO_EMBEDDED_CAPTION_CUE_CHARACTERS} plain-text characters.` };
    }
    if (hasUnsupportedCaptionControlCharacter(text) || /<\/?[A-Za-z][^>]*>/u.test(text)) {
      return { ok: false, reason: `Caption ${cue.id} contains styling markup or control characters that mov_text delivery does not preserve.` };
    }
    if (text.split('\n').length > 2) {
      return { ok: false, reason: `Caption ${cue.id} exceeds the two-line plain-text delivery limit.` };
    }
    if (!isFrameAligned(cue.startMs, timebaseRate) || !isFrameAligned(cue.endMs, timebaseRate)) {
      return { ok: false, reason: `Caption ${cue.id} must begin and end on a ${timebaseRate} fps frame boundary.` };
    }
    if (cue.endMs <= cue.startMs || cue.endMs - cue.startMs > MAX_VIDEO_EMBEDDED_CAPTION_CUE_DURATION_MS) {
      return { ok: false, reason: `Caption ${cue.id} must have a positive duration of ${MAX_VIDEO_EMBEDDED_CAPTION_CUE_DURATION_MS / 1_000} seconds or less.` };
    }
    if (cue.startMs < previousEndMs) {
      return { ok: false, reason: `Caption ${cue.id} overlaps an earlier cue; overlapping timed-text cues are refused.` };
    }
    previousEndMs = cue.endMs;
  }

  const srt = serializeSrtCaptions(track.cues.map((cue) => ({
    id: cue.id,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text.trim(),
  })));
  const byteLength = new TextEncoder().encode(srt).byteLength;
  if (byteLength > MAX_VIDEO_EMBEDDED_CAPTION_BYTES) {
    return { ok: false, reason: `Embedded caption text exceeds the ${Math.floor(MAX_VIDEO_EMBEDDED_CAPTION_BYTES / 1024)} KiB delivery limit.` };
  }

  return {
    ok: true,
    value: {
      format: VIDEO_CAPTION_EMBEDDING_FORMAT,
      inputName: VIDEO_CAPTION_EMBEDDING_INPUT_NAME,
      srt,
      language,
      trackId: track.id,
      cueCount: track.cues.length,
      styleBoundary: 'plain-timing-and-text-only',
    },
  };
}

function findSelectedTrack(
  tracks: readonly VideoSemanticCaptionTrack[],
  trackId: string | undefined,
): VideoSemanticCaptionTrack | undefined {
  return trackId ? tracks.find((track) => track.id === trackId) : tracks[0];
}

function normalizeMovTextLanguage(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized === 'und' || /^[a-z]{3}$/u.test(normalized) ? normalized : undefined;
}

function isFrameAligned(milliseconds: number, frameRate: number): boolean {
  const frame = milliseconds * frameRate / 1_000;
  return Number.isFinite(frame) && Math.abs(frame - Math.round(frame)) < 0.0001;
}

function hasUnsupportedCaptionControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 0 || (codePoint >= 1 && codePoint <= 8) || codePoint === 11 || codePoint === 12 || (codePoint >= 14 && codePoint <= 31)) {
      return true;
    }
  }
  return false;
}
