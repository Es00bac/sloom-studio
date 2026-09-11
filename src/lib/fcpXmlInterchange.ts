/**
 * Scoped Premiere interoperability via FCP7 XML (xmeml) — the interchange dialect Premiere Pro
 * itself imports and exports ("File > Export > Final Cut Pro XML"). Full .prproj fidelity is a
 * non-goal (undocumented gzipped XML); this maps the SEQUENCE ESSENTIALS both ways:
 * tracks, clips, timeline placement, source in/out, names, enabled state.
 *
 * Fidelity notes (documented, parity-ledger culture):
 * - Transforms/opacity/keyframes are NOT mapped in v1 (xmeml expresses them as effect filters;
 *   roadmap).
 * - Media references export as file paths (pathurl). Library items without an on-disk path
 *   (data:/blob: URLs) are exported with a placeholder name and listed in `warnings` — Premiere
 *   will prompt to relink, which is standard interchange behavior.
 * - Times are frame-quantized at the sequence timebase, like every xmeml consumer expects.
 */

export interface FcpXmlClip {
  name: string;
  trackIndex: number;
  startMs: number;
  sourceInMs: number;
  sourceOutMs: number;
  pathUrl?: string;
  enabled: boolean;
}

export interface FcpXmlSequence {
  name: string;
  timebase: number;
  widthPx: number;
  heightPx: number;
  videoClips: FcpXmlClip[];
  audioClips: FcpXmlClip[];
}

export interface FcpXmlExportResult {
  xml: string;
  warnings: string[];
}

function msToFrames(ms: number, timebase: number): number {
  return Math.max(0, Math.round((ms / 1000) * timebase));
}

function framesToMs(frames: number, timebase: number): number {
  return Math.max(0, Math.round((frames / Math.max(1, timebase)) * 1000));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toPathUrl(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://localhost${path.startsWith('/') ? '' : '/'}${encodeURI(path).replace(/#/g, '%23')}`;
}

function clipItemXml(
  clip: FcpXmlClip,
  index: number,
  timebase: number,
  mediaKind: 'video' | 'audio',
  warnings: string[],
): string {
  const start = msToFrames(clip.startMs, timebase);
  const inFrames = msToFrames(clip.sourceInMs, timebase);
  const outFrames = Math.max(inFrames + 1, msToFrames(clip.sourceOutMs, timebase));
  const end = start + (outFrames - inFrames);
  const id = `${mediaKind}-clip-${index + 1}`;
  let fileXml: string;
  if (clip.pathUrl) {
    fileXml = `<file id="file-${id}"><name>${escapeXml(clip.name)}</name><pathurl>${escapeXml(toPathUrl(clip.pathUrl))}</pathurl></file>`;
  } else {
    warnings.push(`Clip "${clip.name}" has no on-disk media path; Premiere will ask to relink it.`);
    fileXml = `<file id="file-${id}"><name>${escapeXml(clip.name)}</name></file>`;
  }
  return [
    `<clipitem id="${id}">`,
    `<name>${escapeXml(clip.name)}</name>`,
    `<enabled>${clip.enabled ? 'TRUE' : 'FALSE'}</enabled>`,
    `<rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>`,
    `<start>${start}</start>`,
    `<end>${end}</end>`,
    `<in>${inFrames}</in>`,
    `<out>${outFrames}</out>`,
    fileXml,
    '</clipitem>',
  ].join('');
}

function tracksXml(
  clips: FcpXmlClip[],
  timebase: number,
  mediaKind: 'video' | 'audio',
  warnings: string[],
): string {
  const maxTrack = clips.reduce((max, clip) => Math.max(max, clip.trackIndex), 0);
  const tracks: string[] = [];
  for (let track = 0; track <= maxTrack; track += 1) {
    const trackClips = clips
      .filter((clip) => clip.trackIndex === track)
      .sort((a, b) => a.startMs - b.startMs)
      .map((clip, index) => clipItemXml(clip, track * 1000 + index, timebase, mediaKind, warnings))
      .join('');
    tracks.push(`<track>${trackClips}</track>`);
  }
  return tracks.join('');
}

export function exportSequenceToFcpXml(sequence: FcpXmlSequence): FcpXmlExportResult {
  const warnings: string[] = [];
  const timebase = Math.max(1, Math.round(sequence.timebase));
  const allClips = [...sequence.videoClips, ...sequence.audioClips];
  const durationFrames = allClips.reduce((max, clip) => {
    const end = msToFrames(clip.startMs, timebase)
      + (msToFrames(clip.sourceOutMs, timebase) - msToFrames(clip.sourceInMs, timebase));
    return Math.max(max, end);
  }, 0);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    `<sequence id="sequence-1">`,
    `<name>${escapeXml(sequence.name)}</name>`,
    `<duration>${durationFrames}</duration>`,
    `<rate><timebase>${timebase}</timebase><ntsc>FALSE</ntsc></rate>`,
    '<media>',
    '<video>',
    `<format><samplecharacteristics><width>${Math.round(sequence.widthPx)}</width><height>${Math.round(sequence.heightPx)}</height></samplecharacteristics></format>`,
    tracksXml(sequence.videoClips, timebase, 'video', warnings),
    '</video>',
    '<audio>',
    tracksXml(sequence.audioClips, timebase, 'audio', warnings),
    '</audio>',
    '</media>',
    '</sequence>',
    '</xmeml>',
  ].join('');

  return { xml, warnings };
}

export interface FcpXmlImportResult {
  sequence: FcpXmlSequence;
  warnings: string[];
}

export function importFcpXmlSequence(xml: string): FcpXmlImportResult {
  const warnings: string[] = [];
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('This file is not valid XML.');
  }
  const sequenceEl = doc.querySelector('xmeml sequence');
  if (!sequenceEl) {
    throw new Error('No <sequence> found — export the sequence from Premiere via File > Export > Final Cut Pro XML.');
  }
  const timebase = Number(sequenceEl.querySelector(':scope > rate > timebase')?.textContent ?? '30') || 30;
  const name = sequenceEl.querySelector(':scope > name')?.textContent?.trim() || 'Imported Sequence';
  const widthPx = Number(sequenceEl.querySelector('video format samplecharacteristics width')?.textContent ?? '1920') || 1920;
  const heightPx = Number(sequenceEl.querySelector('video format samplecharacteristics height')?.textContent ?? '1080') || 1080;

  const readTracks = (mediaKind: 'video' | 'audio'): FcpXmlClip[] => {
    const clips: FcpXmlClip[] = [];
    const tracks = sequenceEl.querySelectorAll(`media > ${mediaKind} > track`);
    tracks.forEach((trackEl, trackIndex) => {
      trackEl.querySelectorAll(':scope > clipitem').forEach((item) => {
        const start = Number(item.querySelector(':scope > start')?.textContent ?? 'NaN');
        const inFrames = Number(item.querySelector(':scope > in')?.textContent ?? 'NaN');
        const outFrames = Number(item.querySelector(':scope > out')?.textContent ?? 'NaN');
        if (!Number.isFinite(start) || !Number.isFinite(inFrames) || !Number.isFinite(outFrames)) {
          warnings.push(`Skipped a ${mediaKind} clip with non-numeric timing.`);
          return;
        }
        const pathUrl = item.querySelector(':scope > file > pathurl')?.textContent?.trim() || undefined;
        clips.push({
          name: item.querySelector(':scope > name')?.textContent?.trim() || 'Clip',
          trackIndex,
          startMs: framesToMs(start, timebase),
          sourceInMs: framesToMs(inFrames, timebase),
          sourceOutMs: framesToMs(Math.max(outFrames, inFrames + 1), timebase),
          pathUrl,
          enabled: (item.querySelector(':scope > enabled')?.textContent?.trim().toUpperCase() ?? 'TRUE') !== 'FALSE',
        });
      });
    });
    return clips;
  };

  return {
    sequence: {
      name,
      timebase,
      widthPx,
      heightPx,
      videoClips: readTracks('video'),
      audioClips: readTracks('audio'),
    },
    warnings,
  };
}
