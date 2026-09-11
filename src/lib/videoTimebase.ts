/**
 * Exact, deterministic video timebase and timecode helpers.
 *
 * All persisted timing is expressed as integer frames plus a rational rate. Floating-point
 * frame rates are accepted only at the legacy boundary and immediately projected to a rational
 * representation. The helpers deliberately do not inspect media or perform I/O.
 */

export const MAX_VIDEO_TIMEBASE_COMPONENT = 1_000_000;
export const MAX_VIDEO_TIMECODE_HOURS = 99;
export const MAX_VIDEO_FRAME_INDEX = 9_000_000_000_000;

export type KnownVideoTimebaseId =
  | '23.976'
  | '24'
  | '25'
  | '29.97-df'
  | '29.97-ndf'
  | '30'
  | '50'
  | '59.94-df'
  | '59.94-ndf'
  | '60';

export interface VideoRationalTimebase {
  numerator: number;
  denominator: number;
  nominalFps: number;
  dropFrame: boolean;
}

export interface VideoTimecodeContext {
  timebase: VideoRationalTimebase;
  startFrame: number;
}

export type VideoFrameRounding = 'nearest' | 'floor' | 'ceil';
export type MixedRateConformPolicy = 'preserve-time' | 'preserve-frame-number' | 'reject';

export interface VideoSourceRecordMapping {
  sourceTimebase: VideoRationalTimebase;
  recordTimebase: VideoRationalTimebase;
  sourceStartFrame: number;
  recordStartFrame: number;
  conformPolicy?: MixedRateConformPolicy;
  rounding?: VideoFrameRounding;
}

export interface VideoConformResult {
  sourceFrames: number;
  recordFrames: number;
  exactRecordFrames: number;
  policy: MixedRateConformPolicy;
  rateChanged: boolean;
}

const KNOWN_VIDEO_TIMEBASES: Readonly<Record<KnownVideoTimebaseId, VideoRationalTimebase>> = {
  '23.976': Object.freeze({ numerator: 24_000, denominator: 1_001, nominalFps: 24, dropFrame: false }),
  '24': Object.freeze({ numerator: 24, denominator: 1, nominalFps: 24, dropFrame: false }),
  '25': Object.freeze({ numerator: 25, denominator: 1, nominalFps: 25, dropFrame: false }),
  '29.97-df': Object.freeze({ numerator: 30_000, denominator: 1_001, nominalFps: 30, dropFrame: true }),
  '29.97-ndf': Object.freeze({ numerator: 30_000, denominator: 1_001, nominalFps: 30, dropFrame: false }),
  '30': Object.freeze({ numerator: 30, denominator: 1, nominalFps: 30, dropFrame: false }),
  '50': Object.freeze({ numerator: 50, denominator: 1, nominalFps: 50, dropFrame: false }),
  '59.94-df': Object.freeze({ numerator: 60_000, denominator: 1_001, nominalFps: 60, dropFrame: true }),
  '59.94-ndf': Object.freeze({ numerator: 60_000, denominator: 1_001, nominalFps: 60, dropFrame: false }),
  '60': Object.freeze({ numerator: 60, denominator: 1, nominalFps: 60, dropFrame: false }),
};

export function getKnownVideoTimebase(id: KnownVideoTimebaseId): VideoRationalTimebase {
  return { ...KNOWN_VIDEO_TIMEBASES[id] };
}

export function createVideoTimebase(input: VideoRationalTimebase): VideoRationalTimebase {
  const numerator = positiveInteger(input.numerator, 'Timebase numerator');
  const denominator = positiveInteger(input.denominator, 'Timebase denominator');
  const nominalFps = positiveInteger(input.nominalFps, 'Nominal frame rate');
  const divisor = greatestCommonDivisor(numerator, denominator);
  const normalized = {
    numerator: numerator / divisor,
    denominator: denominator / divisor,
    nominalFps,
    dropFrame: Boolean(input.dropFrame),
  };

  if (normalized.dropFrame && !isSupportedDropFrameRate(normalized)) {
    throw new Error('Drop-frame timecode is supported only for 30000/1001 and 60000/1001 timebases.');
  }

  return normalized;
}

export function videoTimebaseEquals(left: VideoRationalTimebase, right: VideoRationalTimebase): boolean {
  const a = createVideoTimebase(left);
  const b = createVideoTimebase(right);
  return a.numerator === b.numerator
    && a.denominator === b.denominator
    && a.nominalFps === b.nominalFps
    && a.dropFrame === b.dropFrame;
}

export function projectVideoTimebaseToLegacyFrameRate(timebase: VideoRationalTimebase): number {
  const normalized = createVideoTimebase(timebase);
  return Math.round((normalized.numerator / normalized.denominator) * 1_000) / 1_000;
}

export function projectLegacyFrameRateToVideoTimebase(
  frameRate: number,
  options: { dropFrame?: boolean } = {},
): VideoRationalTimebase {
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 240) {
    throw new Error('Legacy frame rate must be a finite number greater than zero and no more than 240.');
  }

  const dropFrame = Boolean(options.dropFrame);
  const known = legacyKnownRate(frameRate, dropFrame);
  if (known) return getKnownVideoTimebase(known);

  if (dropFrame) {
    throw new Error('Legacy drop-frame projection requires 29.97 or 59.94 fps.');
  }

  const denominator = 1_000;
  return createVideoTimebase({
    numerator: Math.round(frameRate * denominator),
    denominator,
    nominalFps: Math.max(1, Math.round(frameRate)),
    dropFrame: false,
  });
}

export function framesToSeconds(frames: number, timebase: VideoRationalTimebase): number {
  assertFrameNumber(frames, 'Frame count');
  const rate = createVideoTimebase(timebase);
  return (frames * rate.denominator) / rate.numerator;
}

export function secondsToFrames(
  seconds: number,
  timebase: VideoRationalTimebase,
  rounding: VideoFrameRounding = 'nearest',
): number {
  if (!Number.isFinite(seconds) || Math.abs(seconds) > MAX_VIDEO_FRAME_INDEX) {
    throw new Error('Seconds must be a bounded finite number.');
  }
  const rate = createVideoTimebase(timebase);
  return boundedFrame(roundFrame((seconds * rate.numerator) / rate.denominator, rounding));
}

export function convertFramesBetweenTimebases(
  frames: number,
  sourceTimebase: VideoRationalTimebase,
  targetTimebase: VideoRationalTimebase,
  rounding: VideoFrameRounding = 'nearest',
): number {
  assertFrameNumber(frames, 'Frame count');
  const source = createVideoTimebase(sourceTimebase);
  const target = createVideoTimebase(targetTimebase);
  const exact = frames
    * source.denominator
    * target.numerator
    / (source.numerator * target.denominator);
  return boundedFrame(roundFrame(exact, rounding));
}

export function conformMixedRateFrames({
  sourceFrames,
  sourceTimebase,
  recordTimebase,
  policy = 'preserve-time',
  rounding = 'nearest',
}: {
  sourceFrames: number;
  sourceTimebase: VideoRationalTimebase;
  recordTimebase: VideoRationalTimebase;
  policy?: MixedRateConformPolicy;
  rounding?: VideoFrameRounding;
}): VideoConformResult {
  assertFrameNumber(sourceFrames, 'Source frame count');
  const source = createVideoTimebase(sourceTimebase);
  const record = createVideoTimebase(recordTimebase);
  const rateChanged = source.numerator * record.denominator !== record.numerator * source.denominator;

  if (rateChanged && policy === 'reject') {
    throw new Error('Mixed-rate conform was rejected by policy.');
  }

  const exactRecordFrames = policy === 'preserve-time'
    ? sourceFrames * source.denominator * record.numerator / (source.numerator * record.denominator)
    : sourceFrames;

  return {
    sourceFrames,
    recordFrames: boundedFrame(roundFrame(exactRecordFrames, rounding)),
    exactRecordFrames,
    policy,
    rateChanged,
  };
}

export function mapSourceFrameToRecordFrame(
  sourceFrame: number,
  mapping: VideoSourceRecordMapping,
): number {
  const sourceOffset = boundedFrame(sourceFrame - boundedFrame(mapping.sourceStartFrame));
  const conformed = conformMixedRateFrames({
    sourceFrames: sourceOffset,
    sourceTimebase: mapping.sourceTimebase,
    recordTimebase: mapping.recordTimebase,
    policy: mapping.conformPolicy,
    rounding: mapping.rounding,
  });
  return boundedFrame(mapping.recordStartFrame + conformed.recordFrames);
}

export function mapRecordFrameToSourceFrame(
  recordFrame: number,
  mapping: VideoSourceRecordMapping,
): number {
  const policy = mapping.conformPolicy ?? 'preserve-time';
  const recordOffset = boundedFrame(recordFrame - boundedFrame(mapping.recordStartFrame));
  const conformed = conformMixedRateFrames({
    sourceFrames: recordOffset,
    sourceTimebase: mapping.recordTimebase,
    recordTimebase: mapping.sourceTimebase,
    policy,
    rounding: mapping.rounding,
  });
  return boundedFrame(mapping.sourceStartFrame + conformed.recordFrames);
}

export function createVideoTimecodeContext({
  timebase,
  startTimecode = '00:00:00:00',
}: {
  timebase: VideoRationalTimebase;
  startTimecode?: string;
}): VideoTimecodeContext {
  const normalized = createVideoTimebase(timebase);
  const normalizedStart = normalized.dropFrame && startTimecode === '00:00:00:00'
    ? '00:00:00;00'
    : startTimecode;
  return {
    timebase: normalized,
    startFrame: parseVideoTimecode(normalizedStart, normalized),
  };
}

export function timelineFrameToRecordTimecode(timelineFrame: number, context: VideoTimecodeContext): string {
  assertFrameNumber(timelineFrame, 'Timeline frame');
  return formatVideoTimecode(boundedFrame(context.startFrame + timelineFrame), context.timebase);
}

export function recordTimecodeToTimelineFrame(recordTimecode: string, context: VideoTimecodeContext): number {
  return boundedFrame(parseVideoTimecode(recordTimecode, context.timebase) - context.startFrame);
}

export function parseVideoTimecode(value: string, timebase: VideoRationalTimebase): number {
  const normalized = createVideoTimebase(timebase);
  const match = /^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/.exec(value.trim());
  if (!match) throw new Error('Timecode must use HH:MM:SS:FF or HH:MM:SS;FF.');

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const separator = match[4];
  const frame = Number(match[5]);

  if (hours > MAX_VIDEO_TIMECODE_HOURS || minutes > 59 || seconds > 59 || frame >= normalized.nominalFps) {
    throw new Error('Timecode component is outside the selected timebase.');
  }
  if (normalized.dropFrame !== (separator === ';')) {
    throw new Error(normalized.dropFrame
      ? 'Drop-frame timecode must use a semicolon before frames.'
      : 'Non-drop-frame timecode must use a colon before frames.');
  }

  const totalMinutes = hours * 60 + minutes;
  const nominalFrames = ((hours * 3_600 + minutes * 60 + seconds) * normalized.nominalFps) + frame;
  if (!normalized.dropFrame) return boundedFrame(nominalFrames);

  const dropFrames = dropFrameCount(normalized);
  if (minutes % 10 !== 0 && seconds === 0 && frame < dropFrames) {
    throw new Error('Timecode names a frame number omitted by drop-frame counting.');
  }
  return boundedFrame(nominalFrames - dropFrames * (totalMinutes - Math.floor(totalMinutes / 10)));
}

export function formatVideoTimecode(
  frameIndex: number,
  timebase: VideoRationalTimebase,
  options: { wrap24Hours?: boolean } = {},
): string {
  const normalized = createVideoTimebase(timebase);
  let frameNumber = boundedFrame(frameIndex);
  if (frameNumber < 0) throw new Error('Timecode frame index cannot be negative.');

  const framesPer24Hours = framesInDropFrameHours(normalized, 24);
  if (options.wrap24Hours) frameNumber %= framesPer24Hours;

  let timecodeFrameNumber = frameNumber;
  if (normalized.dropFrame) {
    const dropFrames = dropFrameCount(normalized);
    const framesPerMinute = normalized.nominalFps * 60 - dropFrames;
    const framesPer10Minutes = normalized.nominalFps * 600 - dropFrames * 9;
    const tenMinuteBlocks = Math.floor(frameNumber / framesPer10Minutes);
    const framesIntoBlock = frameNumber % framesPer10Minutes;
    const additionalDrops = framesIntoBlock >= dropFrames
      ? dropFrames * Math.floor((framesIntoBlock - dropFrames) / framesPerMinute)
      : 0;
    timecodeFrameNumber += dropFrames * 9 * tenMinuteBlocks + additionalDrops;
  }

  const frames = timecodeFrameNumber % normalized.nominalFps;
  const totalSeconds = Math.floor(timecodeFrameNumber / normalized.nominalFps);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  if (hours > MAX_VIDEO_TIMECODE_HOURS) {
    throw new Error(`Timecode exceeds the ${MAX_VIDEO_TIMECODE_HOURS}-hour display limit.`);
  }

  const separator = normalized.dropFrame ? ';' : ':';
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${separator}${pad2(frames)}`;
}

function framesInDropFrameHours(timebase: VideoRationalTimebase, hours: number): number {
  if (!timebase.dropFrame) return timebase.nominalFps * 3_600 * hours;
  const totalMinutes = hours * 60;
  return timebase.nominalFps * 60 * totalMinutes
    - dropFrameCount(timebase) * (totalMinutes - Math.floor(totalMinutes / 10));
}

function isSupportedDropFrameRate(timebase: VideoRationalTimebase): boolean {
  return (timebase.numerator === 30_000 && timebase.denominator === 1_001 && timebase.nominalFps === 30)
    || (timebase.numerator === 60_000 && timebase.denominator === 1_001 && timebase.nominalFps === 60);
}

function dropFrameCount(timebase: VideoRationalTimebase): number {
  if (!timebase.dropFrame) return 0;
  return timebase.nominalFps === 60 ? 4 : 2;
}

function legacyKnownRate(frameRate: number, dropFrame: boolean): KnownVideoTimebaseId | undefined {
  const approximately = (value: number) => Math.abs(frameRate - value) < 0.002;
  if (approximately(24_000 / 1_001)) return dropFrame ? undefined : '23.976';
  if (approximately(30_000 / 1_001)) return dropFrame ? '29.97-df' : '29.97-ndf';
  if (approximately(60_000 / 1_001)) return dropFrame ? '59.94-df' : '59.94-ndf';
  if (approximately(24)) return dropFrame ? undefined : '24';
  if (approximately(25)) return dropFrame ? undefined : '25';
  if (approximately(30)) return dropFrame ? undefined : '30';
  if (approximately(50)) return dropFrame ? undefined : '50';
  if (approximately(60)) return dropFrame ? undefined : '60';
  return undefined;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_VIDEO_TIMEBASE_COMPONENT) {
    throw new Error(`${label} must be a positive safe integer no greater than ${MAX_VIDEO_TIMEBASE_COMPONENT}.`);
  }
  return value;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function assertFrameNumber(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_VIDEO_FRAME_INDEX) {
    throw new Error(`${label} must be a bounded safe integer.`);
  }
}

function boundedFrame(value: number): number {
  assertFrameNumber(value, 'Frame value');
  return value;
}

function roundFrame(value: number, rounding: VideoFrameRounding): number {
  if (rounding === 'floor') return Math.floor(value);
  if (rounding === 'ceil') return Math.ceil(value);
  return Math.round(value);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
