import { importFcpXmlSequence } from './fcpXmlInterchange';

export type ProfessionalInterchangeFormat = 'fcp7-xml' | 'cmx3600' | 'otio-json' | 'sloom-aaf-handoff';
export type ProfessionalTrackKind = 'video' | 'audio';

export interface ProfessionalSequenceClip {
  type: 'clip';
  id: string;
  name: string;
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  mediaReference?: string;
  enabled: boolean;
  speed: number;
}

export interface ProfessionalSequenceGap {
  type: 'gap';
  id: string;
  startMs: number;
  durationMs: number;
}

export type ProfessionalSequenceItem = ProfessionalSequenceClip | ProfessionalSequenceGap;

export interface ProfessionalSequenceTrack {
  id: string;
  name: string;
  kind: ProfessionalTrackKind;
  index: number;
  items: ProfessionalSequenceItem[];
}

export interface ProfessionalInterchangeSequence {
  name: string;
  frameRate: number;
  widthPx?: number;
  heightPx?: number;
  tracks: ProfessionalSequenceTrack[];
}

export interface ImportReportEntry {
  sourceId: string;
  message: string;
}

export interface ImportReport {
  format: ProfessionalInterchangeFormat;
  mapped: ImportReportEntry[];
  approximated: ImportReportEntry[];
  dropped: ImportReportEntry[];
}

export interface ProfessionalInterchangeImportResult {
  sequence: ProfessionalInterchangeSequence;
  report: ImportReport;
}

export interface ProfessionalInterchangeExportResult {
  data: string;
  mediaType: string;
  fileExtension: string;
  warnings: string[];
}

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 20_000;
const MAX_TRACKS = 256;
const MAX_JSON_DEPTH = 32;
const SUPPORTED_FRAME_RATES = [24, 25, 30] as const;
const SLOOM_AAF_HANDOFF_SCHEMA = 'sloom-aaf-handoff/v1';

export function importProfessionalFcp7Xml(xml: string): ProfessionalInterchangeImportResult {
  guardTextInput(xml, 'FCP7 XML');
  guardXmlDepth(xml);
  if (countOccurrences(xml, '<clipitem') > MAX_ITEMS) throw new Error(`FCP7 XML exceeds the ${MAX_ITEMS.toLocaleString()}-clip safety limit.`);
  if (countOccurrences(xml, '<track') > MAX_TRACKS) throw new Error(`FCP7 XML exceeds the ${MAX_TRACKS}-track safety limit.`);
  const parsed = importFcpXmlSequence(xml);
  const report: ImportReport = { format: 'fcp7-xml', mapped: [], approximated: [], dropped: [] };
  const tracks = new Map<string, ProfessionalSequenceTrack>();
  const append = (kind: ProfessionalTrackKind, clip: (typeof parsed.sequence.videoClips)[number], sourceIndex: number) => {
    const key = `${kind}:${clip.trackIndex}`;
    let track = tracks.get(key);
    if (!track) {
      if (tracks.size >= MAX_TRACKS) throw new Error(`FCP7 XML exceeds the ${MAX_TRACKS}-track safety limit.`);
      track = { id: key, name: `${kind === 'video' ? 'V' : 'A'}${clip.trackIndex + 1}`, kind, index: clip.trackIndex, items: [] };
      tracks.set(key, track);
    }
    const sourceId = `${kind}-clip-${sourceIndex + 1}`;
    const durationMs = Math.max(1, clip.sourceOutMs - clip.sourceInMs);
    track.items.push({
      type: 'clip', id: sourceId, name: clip.name, startMs: clip.startMs, durationMs,
      sourceInMs: clip.sourceInMs, ...(clip.pathUrl ? { mediaReference: clip.pathUrl } : {}), enabled: clip.enabled, speed: 1,
    });
    report.mapped.push({ sourceId, message: 'Mapped track, clip timing, source range, name, enabled state, and media reference.' });
    if (!clip.pathUrl) report.approximated.push({ sourceId, message: 'No pathurl was present; the clip will require relinking.' });
  };
  parsed.sequence.videoClips.forEach((clip, index) => append('video', clip, index));
  parsed.sequence.audioClips.forEach((clip, index) => append('audio', clip, index));
  parsed.warnings.forEach((warning, index) => report.dropped.push({ sourceId: `parser-warning-${index + 1}`, message: warning }));
  return {
    sequence: {
      name: parsed.sequence.name,
      frameRate: parsed.sequence.timebase,
      widthPx: parsed.sequence.widthPx,
      heightPx: parsed.sequence.heightPx,
      tracks: [...tracks.values()].sort(trackOrder),
    },
    report,
  };
}

export function importCmx3600Edl(
  edl: string,
  options: { frameRate: 24 | 25 | 30 },
): ProfessionalInterchangeImportResult {
  guardTextInput(edl, 'CMX 3600 EDL');
  if (!SUPPORTED_FRAME_RATES.includes(options.frameRate)) throw new Error('CMX 3600 import supports non-drop 24, 25, or 30fps timelines.');
  if (/^FCM:\s*DROP FRAME/im.test(edl) || /\d{2}:\d{2}:\d{2};\d{2}/.test(edl)) {
    throw new Error('Drop-frame CMX 3600 is not supported; convert the list to non-drop frame before import.');
  }
  const lines = edl.replace(/\r/g, '').split('\n');
  const title = lines.find((line) => /^TITLE:/i.test(line))?.replace(/^TITLE:\s*/i, '').trim() || 'Imported EDL';
  const eventLines = lines.map((line, index) => ({ line: line.trim(), index })).filter(({ line }) => /^\d{3,6}\s/.test(line));
  if (eventLines.length > MAX_ITEMS) throw new Error(`CMX 3600 EDL exceeds the ${MAX_ITEMS.toLocaleString()}-event safety limit.`);
  const videoItems: ProfessionalSequenceItem[] = [];
  const audioItems: ProfessionalSequenceItem[] = [];
  const report: ImportReport = { format: 'cmx3600', mapped: [], approximated: [], dropped: [] };
  for (const eventLine of eventLines) {
    const fields = eventLine.line.split(/\s+/);
    const [eventNumber, reel, channel, transition, sourceIn, sourceOut, recordIn, recordOut] = fields;
    const sourceId = `event-${eventNumber}`;
    if (!eventNumber || !reel || !channel || !transition || !sourceIn || !sourceOut || !recordIn || !recordOut) {
      report.dropped.push({ sourceId, message: `Malformed event on line ${eventLine.index + 1}.` });
      continue;
    }
    if (transition.toUpperCase() !== 'C') {
      report.dropped.push({ sourceId, message: `Transition ${transition} is outside the supported cuts-only CMX subset.` });
      continue;
    }
    let sourceInMs: number;
    let sourceOutMs: number;
    let startMs: number;
    let endMs: number;
    try {
      sourceInMs = timecodeToMs(sourceIn, options.frameRate);
      sourceOutMs = timecodeToMs(sourceOut, options.frameRate);
      startMs = timecodeToMs(recordIn, options.frameRate);
      endMs = timecodeToMs(recordOut, options.frameRate);
    } catch (error) {
      report.dropped.push({ sourceId, message: error instanceof Error ? error.message : 'Invalid timecode.' });
      continue;
    }
    if (sourceOutMs <= sourceInMs || endMs <= startMs) {
      report.dropped.push({ sourceId, message: 'Event has a zero or negative source/record duration.' });
      continue;
    }
    const followingComments = collectFollowingComments(lines, eventLine.index + 1);
    const name = followingComments.clipName || reel;
    const clip: ProfessionalSequenceClip = {
      type: 'clip', id: sourceId, name, startMs, durationMs: endMs - startMs, sourceInMs,
      ...(followingComments.sourceFile ? { mediaReference: followingComments.sourceFile } : {}), enabled: true, speed: 1,
    };
    const normalizedChannel = channel.toUpperCase();
    if (normalizedChannel === 'V') videoItems.push(clip);
    else if (normalizedChannel === 'A' || normalizedChannel === 'A2' || normalizedChannel === 'AA') audioItems.push(clip);
    else {
      report.dropped.push({ sourceId, message: `Channel ${channel} is outside the supported V/A/AA CMX subset.` });
      continue;
    }
    report.mapped.push({ sourceId, message: 'Mapped cut event source and record timecodes.' });
    report.approximated.push({ sourceId, message: 'CMX 3600 has no portable bin identity or effect model; reel/name metadata is retained.' });
  }
  const tracks: ProfessionalSequenceTrack[] = [];
  if (videoItems.length) tracks.push({ id: 'video:0', name: 'V1', kind: 'video', index: 0, items: videoItems });
  if (audioItems.length) tracks.push({ id: 'audio:0', name: 'A1', kind: 'audio', index: 0, items: audioItems });
  return { sequence: { name: title, frameRate: options.frameRate, tracks }, report };
}

export function exportCmx3600Edl(sequence: ProfessionalInterchangeSequence): ProfessionalInterchangeExportResult {
  const frameRate = assertSupportedFrameRate(sequence.frameRate);
  const warnings: string[] = [];
  const clips = sequence.tracks.flatMap((track) => track.items.flatMap((item) => item.type === 'clip' ? [{ track, item }] : []));
  if (clips.length > 999_999 || clips.length > MAX_ITEMS) throw new Error('Sequence has too many clips for bounded CMX 3600 export.');
  const lines = [`TITLE: ${sequence.name.replace(/[\r\n]+/g, ' ')}`, 'FCM: NON-DROP FRAME', ''];
  clips.sort((a, b) => a.item.startMs - b.item.startMs || trackOrder(a.track, b.track));
  clips.forEach(({ track, item }, index) => {
    const number = String(index + 1).padStart(3, '0');
    const reel = sanitizeReel(item.name);
    const channel = track.kind === 'video' ? 'V' : 'A';
    const sourceOut = item.sourceInMs + item.durationMs * Math.abs(item.speed || 1);
    lines.push(`${number}  ${reel.padEnd(8)} ${channel.padEnd(5)} C        ${msToTimecode(item.sourceInMs, frameRate)} ${msToTimecode(sourceOut, frameRate)} ${msToTimecode(item.startMs, frameRate)} ${msToTimecode(item.startMs + item.durationMs, frameRate)}`);
    lines.push(`* FROM CLIP NAME: ${item.name.replace(/[\r\n]+/g, ' ')}`);
    if (item.mediaReference) lines.push(`* SOURCE FILE: ${item.mediaReference.replace(/[\r\n]+/g, ' ')}`);
    if (track.index > 0) warnings.push(`Clip "${item.name}" from ${track.name} was flattened into CMX's single ${channel} event list.`);
    if (item.speed !== 1) warnings.push(`Clip "${item.name}" speed was represented through its source timecode span; no motion-effect metadata was emitted.`);
    lines.push('');
  });
  return { data: lines.join('\n'), mediaType: 'text/plain', fileExtension: '.edl', warnings };
}

export function exportOtioJson(sequence: ProfessionalInterchangeSequence): ProfessionalInterchangeExportResult {
  const frameRate = finitePositive(sequence.frameRate, 'OTIO frame rate');
  const children = sequence.tracks.map((track) => ({
    OTIO_SCHEMA: 'Track.1',
    name: track.name,
    kind: track.kind === 'video' ? 'Video' : 'Audio',
    metadata: { sloom_track_id: track.id, sloom_track_index: track.index },
    children: track.items.map((item) => item.type === 'gap'
      ? { OTIO_SCHEMA: 'Gap.1', name: item.id, source_range: otioRange(item.startMs, item.durationMs, frameRate) }
      : {
          OTIO_SCHEMA: 'Clip.2', name: item.name,
          metadata: { sloom_item_id: item.id, sloom_timeline_start_ms: item.startMs, sloom_enabled: item.enabled },
          source_range: otioRange(item.sourceInMs, item.durationMs * Math.abs(item.speed || 1), frameRate),
          media_reference: item.mediaReference
            ? { OTIO_SCHEMA: 'ExternalReference.1', target_url: item.mediaReference }
            : { OTIO_SCHEMA: 'MissingReference.1' },
          effects: item.speed === 1 ? [] : [{ OTIO_SCHEMA: 'LinearTimeWarp.1', time_scalar: item.speed }],
        }),
  }));
  const payload = { OTIO_SCHEMA: 'Timeline.1', name: sequence.name, metadata: { sloom_frame_rate: frameRate }, tracks: { OTIO_SCHEMA: 'Stack.1', children } };
  return { data: JSON.stringify(payload, null, 2), mediaType: 'application/vnd.pixar.opentimelineio+json', fileExtension: '.otio', warnings: [] };
}

/**
 * A deliberately non-binary handoff envelope for workflows that need to take a bounded Sloom
 * timeline to a separate AAF authoring system and later restore it here. Its OTIO payload keeps
 * the existing hardened timeline reader authoritative. It is never named, parsed, or offered as
 * an AAF file: arbitrary `.aaf` remains a fail-closed binary-format refusal below.
 */
export function exportSloomAafHandoff(sequence: ProfessionalInterchangeSequence): ProfessionalInterchangeExportResult {
  const otio = exportOtioJson(sequence);
  const payload = {
    schema: SLOOM_AAF_HANDOFF_SCHEMA,
    kind: 'sloom-aaf-handoff',
    timeline: JSON.parse(otio.data) as unknown,
    limitations: [
      'This is a Sloom JSON handoff manifest, not an AAF binary.',
      'It retains the supported OTIO timeline subset only; it does not embed media, AAF metadata, effects, or broadcaster delivery profiles.',
      'Use external AAF authoring software to create a real AAF when that downstream system requires one.',
    ],
  };
  const data = JSON.stringify(payload, null, 2);
  guardTextInput(data, 'Sloom AAF handoff manifest');
  return {
    data,
    mediaType: 'application/vnd.sloom.aaf-handoff+json',
    fileExtension: '.sloom-aaf.json',
    warnings: [...payload.limitations],
  };
}

export function importOtioJson(json: string): ProfessionalInterchangeImportResult {
  guardTextInput(json, 'OTIO JSON');
  let root: unknown;
  try { root = JSON.parse(json); } catch { throw new Error('OTIO input is not valid JSON.'); }
  guardJsonDepth(root);
  if (!isRecord(root) || root.OTIO_SCHEMA !== 'Timeline.1' || !isRecord(root.tracks) || root.tracks.OTIO_SCHEMA !== 'Stack.1' || !Array.isArray(root.tracks.children)) {
    throw new Error('OTIO JSON must contain a Timeline.1 with a Stack.1 tracks collection.');
  }
  if (root.tracks.children.length > MAX_TRACKS) throw new Error(`OTIO JSON exceeds the ${MAX_TRACKS}-track safety limit.`);
  const report: ImportReport = { format: 'otio-json', mapped: [], approximated: [], dropped: [] };
  const frameRate = readPositiveNumber(isRecord(root.metadata) ? root.metadata.sloom_frame_rate : undefined) ?? 24;
  let itemCount = 0;
  const tracks: ProfessionalSequenceTrack[] = [];
  root.tracks.children.forEach((rawTrack, trackIndex) => {
    if (!isRecord(rawTrack) || rawTrack.OTIO_SCHEMA !== 'Track.1' || !Array.isArray(rawTrack.children)) {
      report.dropped.push({ sourceId: `track-${trackIndex + 1}`, message: 'Only Track.1 children are supported.' });
      return;
    }
    const kind: ProfessionalTrackKind = rawTrack.kind === 'Audio' ? 'audio' : 'video';
    const items: ProfessionalSequenceItem[] = [];
    let cursorMs = 0;
    rawTrack.children.forEach((rawItem, itemIndex) => {
      itemCount += 1;
      if (itemCount > MAX_ITEMS) throw new Error(`OTIO JSON exceeds the ${MAX_ITEMS.toLocaleString()}-item safety limit.`);
      const sourceId = `track-${trackIndex + 1}-item-${itemIndex + 1}`;
      if (!isRecord(rawItem) || (rawItem.OTIO_SCHEMA !== 'Clip.2' && rawItem.OTIO_SCHEMA !== 'Gap.1')) {
        report.dropped.push({ sourceId, message: 'Only Clip.2 and Gap.1 items are supported.' });
        return;
      }
      const range = readOtioRange(rawItem.source_range, frameRate);
      if (!range) {
        report.dropped.push({ sourceId, message: 'Item has a missing or invalid source_range.' });
        return;
      }
      if (rawItem.OTIO_SCHEMA === 'Gap.1') {
        items.push({ type: 'gap', id: stringValue(rawItem.name) || sourceId, startMs: cursorMs, durationMs: range.durationMs });
        cursorMs += range.durationMs;
        report.mapped.push({ sourceId, message: 'Mapped gap duration.' });
        return;
      }
      const effects = Array.isArray(rawItem.effects) ? rawItem.effects : [];
      const linear = effects.find((effect) => isRecord(effect) && effect.OTIO_SCHEMA === 'LinearTimeWarp.1');
      const speed = isRecord(linear) ? readPositiveNumber(linear.time_scalar) ?? 1 : 1;
      effects.forEach((effect, effectIndex) => {
        if (!isRecord(effect) || effect.OTIO_SCHEMA !== 'LinearTimeWarp.1') {
          report.dropped.push({ sourceId: `${sourceId}-effect-${effectIndex + 1}`, message: 'Only LinearTimeWarp.1 effects are supported.' });
        }
      });
      const metadata = isRecord(rawItem.metadata) ? rawItem.metadata : {};
      const explicitStart = readNonNegativeNumber(metadata.sloom_timeline_start_ms);
      const durationMs = range.durationMs / speed;
      const mediaReference = isRecord(rawItem.media_reference) && rawItem.media_reference.OTIO_SCHEMA === 'ExternalReference.1'
        ? stringValue(rawItem.media_reference.target_url) : undefined;
      items.push({
        type: 'clip', id: stringValue(metadata.sloom_item_id) || sourceId, name: stringValue(rawItem.name) || 'Clip',
        startMs: explicitStart ?? cursorMs, durationMs, sourceInMs: range.startMs,
        ...(mediaReference ? { mediaReference } : {}), enabled: metadata.sloom_enabled !== false, speed,
      });
      cursorMs = Math.max(cursorMs, (explicitStart ?? cursorMs) + durationMs);
      report.mapped.push({ sourceId, message: 'Mapped clip, source range, media reference, and supported linear time warp.' });
      if (explicitStart !== undefined) report.approximated.push({ sourceId, message: 'Sloom timeline placement metadata overrides OTIO sequential placement.' });
    });
    const metadata = isRecord(rawTrack.metadata) ? rawTrack.metadata : {};
    tracks.push({
      id: stringValue(metadata.sloom_track_id) || `${kind}:${trackIndex}`,
      name: stringValue(rawTrack.name) || `${kind === 'video' ? 'V' : 'A'}${trackIndex + 1}`,
      kind, index: Math.max(0, Math.floor(readNonNegativeNumber(metadata.sloom_track_index) ?? trackIndex)), items,
    });
  });
  return { sequence: { name: stringValue(root.name) || 'Imported OTIO', frameRate, tracks: tracks.sort(trackOrder) }, report };
}

export function importSloomAafHandoff(json: string): ProfessionalInterchangeImportResult {
  guardTextInput(json, 'Sloom AAF handoff manifest');
  let root: unknown;
  try { root = JSON.parse(json); } catch { throw new Error('Sloom AAF handoff manifest is not valid JSON.'); }
  guardJsonDepth(root);
  if (!isRecord(root) || root.schema !== SLOOM_AAF_HANDOFF_SCHEMA || root.kind !== 'sloom-aaf-handoff' || !isRecord(root.timeline)) {
    throw new Error('Sloom AAF handoff manifest must contain the exact supported wrapper schema and an OTIO timeline payload.');
  }
  const imported = importOtioJson(JSON.stringify(root.timeline));
  return {
    ...imported,
    report: {
      ...imported.report,
      format: 'sloom-aaf-handoff',
      approximated: [{
        sourceId: 'sloom-aaf-handoff',
        message: 'Restored the bounded Sloom OTIO timeline payload. This manifest is not an AAF binary and contains no embedded media or AAF metadata.',
      }, ...imported.report.approximated],
    },
  };
}

export function getAafInterchangeAvailability(): { available: false; reason: string; recommendation: string } {
  return {
    available: false,
    reason: 'AAF parsing and writing are not implemented; AAF is a complex binary interchange format and is never treated as JSON or XML.',
    recommendation: 'Use FCP7 XML, CMX 3600 EDL, or the supported OTIO JSON subset.',
  };
}

export function importAaf(): never {
  throw new Error(getAafInterchangeAvailability().reason);
}

function guardTextInput(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} input is empty.`);
  if (new TextEncoder().encode(value).byteLength > MAX_INPUT_BYTES) throw new Error(`${label} exceeds the 5 MiB safety limit.`);
}

function guardJsonDepth(value: unknown, depth = 0, seen = new Set<unknown>()): void {
  if (depth > MAX_JSON_DEPTH) throw new Error(`OTIO JSON exceeds the maximum nesting depth of ${MAX_JSON_DEPTH}.`);
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) guardJsonDepth(child, depth + 1, seen);
}

function guardXmlDepth(value: string): void {
  let depth = 0;
  const tags = value.match(/<[^>]+>/g) ?? [];
  for (const tag of tags) {
    if (/^<\//.test(tag)) depth = Math.max(0, depth - 1);
    else if (!/^<\?|^<!/.test(tag) && !/\/>$/.test(tag)) {
      depth += 1;
      if (depth > 64) throw new Error('FCP7 XML exceeds the maximum nesting depth of 64.');
    }
  }
}

function otioRange(startMs: number, durationMs: number, rate: number): Record<string, unknown> {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: { OTIO_SCHEMA: 'RationalTime.1', value: (startMs / 1000) * rate, rate },
    duration: { OTIO_SCHEMA: 'RationalTime.1', value: (durationMs / 1000) * rate, rate },
  };
}

function readOtioRange(value: unknown, fallbackRate: number): { startMs: number; durationMs: number } | undefined {
  if (!isRecord(value) || value.OTIO_SCHEMA !== 'TimeRange.1') return undefined;
  const start = readRationalTime(value.start_time, fallbackRate);
  const duration = readRationalTime(value.duration, fallbackRate);
  if (start === undefined || duration === undefined || duration <= 0) return undefined;
  return { startMs: start, durationMs: duration };
}

function readRationalTime(value: unknown, fallbackRate: number): number | undefined {
  if (!isRecord(value) || value.OTIO_SCHEMA !== 'RationalTime.1') return undefined;
  const amount = readNonNegativeNumber(value.value);
  const rate = readPositiveNumber(value.rate) ?? fallbackRate;
  return amount === undefined ? undefined : Math.round((amount / rate) * 1000);
}

function timecodeToMs(value: string, frameRate: number): number {
  const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid non-drop timecode "${value}".`);
  const [, hours, minutes, seconds, frames] = match.map(Number);
  if (minutes > 59 || seconds > 59 || frames >= frameRate) throw new Error(`Out-of-range timecode "${value}".`);
  return Math.round((((hours * 60 + minutes) * 60 + seconds) + frames / frameRate) * 1000);
}

function msToTimecode(ms: number, frameRate: number): string {
  const totalFrames = Math.max(0, Math.round((ms / 1000) * frameRate));
  const frames = totalFrames % frameRate;
  const totalSeconds = Math.floor(totalFrames / frameRate);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
}

function assertSupportedFrameRate(value: number): 24 | 25 | 30 {
  const rounded = Math.round(value) as 24 | 25 | 30;
  if (!SUPPORTED_FRAME_RATES.includes(rounded) || Math.abs(value - rounded) > 0.001) {
    throw new Error('CMX 3600 export supports non-drop 24, 25, or 30fps timelines.');
  }
  return rounded;
}

function collectFollowingComments(lines: string[], start: number): { clipName?: string; sourceFile?: string } {
  const result: { clipName?: string; sourceFile?: string } = {};
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('*')) break;
    if (/^\* FROM CLIP NAME:/i.test(line)) result.clipName = line.replace(/^\* FROM CLIP NAME:\s*/i, '').trim();
    if (/^\* SOURCE FILE:/i.test(line)) result.sourceFile = line.replace(/^\* SOURCE FILE:\s*/i, '').trim();
  }
  return result;
}

function sanitizeReel(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 8);
  return cleaned || 'AX';
}

function trackOrder(a: ProfessionalSequenceTrack, b: ProfessionalSequenceTrack): number {
  return (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1) || a.index - b.index || a.id.localeCompare(b.id);
}

function countOccurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 240) throw new Error(`${label} must be greater than zero and no more than 240.`);
  return value;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
