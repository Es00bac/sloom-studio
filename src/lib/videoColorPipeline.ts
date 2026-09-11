import {
  findMissingVideoCapabilities,
  type VideoProfessionalCapabilityId,
  type VideoProfessionalCapabilityProbe,
} from './videoProfessionalCapabilities';

export type VideoColorSpace =
  | 'srgb'
  | 'rec709'
  | 'display-p3'
  | 'rec2020-pq'
  | 'rec2020-hlg'
  | 'logc3'
  | 'slog3';

export interface VideoLutReference {
  id: string;
  name: string;
  uri: string;
  format: 'cube';
  size?: number;
  checksumSha256?: string;
}

export interface VideoSourceColorSettings {
  inputColorSpace?: VideoColorSpace;
  fullRange?: boolean;
  exposureOffsetStops?: number;
}

export interface VideoSequenceColorSettings {
  workingColorSpace?: VideoColorSpace;
  outputColorSpace?: VideoColorSpace;
  referenceWhiteNits?: number;
  hdrPeakNits?: number;
}

export interface VideoClipColorSettings {
  exposureStops?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  lut?: VideoLutReference | null;
  lutMix?: number;
}

export interface ResolvedVideoColorPipeline {
  source: Required<VideoSourceColorSettings>;
  sequence: Required<VideoSequenceColorSettings>;
  clip: Omit<Required<VideoClipColorSettings>, 'lut'> & { lut: VideoLutReference | null };
}

export type VideoColorStageKind = 'input-transform' | 'correction' | 'lut' | 'working-output';

export interface VideoColorStageDescriptor {
  kind: VideoColorStageKind;
  enabled: boolean;
  summary: string;
  parameters: Record<string, unknown>;
}

export interface VideoColorPreviewDescriptor {
  stages: VideoColorStageDescriptor[];
  renderer: 'webgpu' | 'cpu-approximate';
  displayColorSpace: 'rec709';
  toneMapping: {
    applied: boolean;
    sourceTransfer?: 'pq' | 'hlg';
    method?: 'bt2390-display-referred';
    note: string;
  };
}

export interface VideoColorFfmpegDescriptor {
  ok: true;
  filters: string[];
  requiredCapabilities: VideoProfessionalCapabilityId[];
  stages: VideoColorStageDescriptor[];
}

export interface VideoColorUnavailable {
  ok: false;
  reason: string;
  missingCapabilities: Array<{ id: VideoProfessionalCapabilityId; reason: string }>;
}

const DEFAULT_SOURCE: Required<VideoSourceColorSettings> = {
  inputColorSpace: 'rec709',
  fullRange: false,
  exposureOffsetStops: 0,
};

const DEFAULT_SEQUENCE: Required<VideoSequenceColorSettings> = {
  workingColorSpace: 'rec709',
  outputColorSpace: 'rec709',
  referenceWhiteNits: 100,
  hdrPeakNits: 1_000,
};

const DEFAULT_CLIP: Omit<Required<VideoClipColorSettings>, 'lut'> & { lut: null } = {
  exposureStops: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  tint: 0,
  lut: null,
  lutMix: 1,
};

export function resolveVideoColorPipeline(
  source: VideoSourceColorSettings = {},
  sequence: VideoSequenceColorSettings = {},
  clip: VideoClipColorSettings = {},
): ResolvedVideoColorPipeline {
  return {
    source: { ...DEFAULT_SOURCE, ...source },
    sequence: { ...DEFAULT_SEQUENCE, ...sequence },
    clip: { ...DEFAULT_CLIP, ...clip, lut: clip.lut ?? null },
  };
}

export function validateVideoLutReference(lut: VideoLutReference): string[] {
  const errors: string[] = [];
  if (!lut.id.trim()) errors.push('LUT id is required.');
  if (!lut.name.trim()) errors.push('LUT name is required.');
  if (!lut.uri.trim()) errors.push('LUT URI is required.');
  if (lut.format !== 'cube') errors.push('Only .cube LUT references are supported.');
  if (lut.size !== undefined && (!Number.isInteger(lut.size) || lut.size < 2 || lut.size > 65)) {
    errors.push('A 3D LUT size must be an integer from 2 through 65.');
  }
  if (lut.checksumSha256 !== undefined && !/^[a-f0-9]{64}$/iu.test(lut.checksumSha256)) {
    errors.push('LUT SHA-256 checksum must contain exactly 64 hexadecimal characters.');
  }
  return errors;
}

export function buildVideoColorStages(pipeline: ResolvedVideoColorPipeline): VideoColorStageDescriptor[] {
  const inputNeedsTransform = pipeline.source.inputColorSpace !== pipeline.sequence.workingColorSpace
    || pipeline.source.exposureOffsetStops !== 0;
  const correctionEnabled = pipeline.clip.exposureStops !== 0
    || pipeline.clip.contrast !== 1
    || pipeline.clip.saturation !== 1
    || pipeline.clip.temperature !== 0
    || pipeline.clip.tint !== 0;
  return [
    {
      kind: 'input-transform',
      enabled: inputNeedsTransform,
      summary: `${pipeline.source.inputColorSpace} to ${pipeline.sequence.workingColorSpace}`,
      parameters: { ...pipeline.source, workingColorSpace: pipeline.sequence.workingColorSpace },
    },
    {
      kind: 'correction',
      enabled: correctionEnabled,
      summary: correctionEnabled ? 'Per-clip primary correction' : 'No primary correction',
      parameters: { ...pipeline.clip, lut: undefined },
    },
    {
      kind: 'lut',
      enabled: pipeline.clip.lut !== null && pipeline.clip.lutMix > 0,
      summary: pipeline.clip.lut?.name ?? 'No LUT',
      parameters: { lut: pipeline.clip.lut, mix: pipeline.clip.lutMix },
    },
    {
      kind: 'working-output',
      enabled: pipeline.sequence.workingColorSpace !== pipeline.sequence.outputColorSpace,
      summary: `${pipeline.sequence.workingColorSpace} to ${pipeline.sequence.outputColorSpace}`,
      parameters: { ...pipeline.sequence },
    },
  ];
}

function hdrTransfer(space: VideoColorSpace): 'pq' | 'hlg' | undefined {
  if (space === 'rec2020-pq') return 'pq';
  if (space === 'rec2020-hlg') return 'hlg';
  return undefined;
}

export function buildVideoColorPreviewDescriptor(
  pipeline: ResolvedVideoColorPipeline,
  browser: { webGpu?: boolean } = {},
): VideoColorPreviewDescriptor {
  const transfer = hdrTransfer(pipeline.source.inputColorSpace)
    ?? hdrTransfer(pipeline.sequence.workingColorSpace)
    ?? hdrTransfer(pipeline.sequence.outputColorSpace);
  return {
    stages: buildVideoColorStages(pipeline),
    renderer: browser.webGpu === true ? 'webgpu' : 'cpu-approximate',
    displayColorSpace: 'rec709',
    toneMapping: transfer
      ? {
          applied: true,
          sourceTransfer: transfer,
          method: 'bt2390-display-referred',
          note: 'The editor preview is a tone-mapped Rec.709 representation; it is not an HDR reference monitor.',
        }
      : { applied: false, note: 'The Rec.709 preview does not require HDR tone mapping.' },
  };
}

interface FfmpegColorDescriptor {
  primaries: string;
  transfer: string;
  matrix: string;
}

function ffmpegColorDescriptor(space: VideoColorSpace): FfmpegColorDescriptor {
  switch (space) {
    case 'srgb': return { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'gbr' };
    case 'display-p3': return { primaries: 'smpte432', transfer: 'iec61966-2-1', matrix: 'gbr' };
    case 'rec2020-pq': return { primaries: 'bt2020', transfer: 'smpte2084', matrix: 'bt2020nc' };
    case 'rec2020-hlg': return { primaries: 'bt2020', transfer: 'arib-std-b67', matrix: 'bt2020nc' };
    // zscale cannot natively decode camera log curves. These descriptors retain
    // their gamut only; production log decoding should be supplied as an input
    // technical LUT before using this compiler.
    case 'logc3': return { primaries: 'bt709', transfer: 'linear', matrix: 'bt709' };
    case 'slog3': return { primaries: 'bt2020', transfer: 'linear', matrix: 'bt2020nc' };
    case 'rec709': return { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' };
  }
}

function zscaleTransform(input: VideoColorSpace, output: VideoColorSpace): string {
  const from = ffmpegColorDescriptor(input);
  const to = ffmpegColorDescriptor(output);
  return `zscale=primariesin=${from.primaries}:transferin=${from.transfer}:matrixin=${from.matrix}:primaries=${to.primaries}:transfer=${to.transfer}:matrix=${to.matrix}`;
}

function escapeFfmpegPath(path: string): string {
  return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

export function compileVideoColorFfmpegFilters(
  pipeline: ResolvedVideoColorPipeline,
  probe: VideoProfessionalCapabilityProbe,
): VideoColorFfmpegDescriptor | VideoColorUnavailable {
  const stages = buildVideoColorStages(pipeline);
  const requirements: VideoProfessionalCapabilityId[] = [];
  if (stages[0]?.enabled || stages[3]?.enabled) requirements.push('zscale');
  if (stages[2]?.enabled) requirements.push('lut3d');
  const missing = findMissingVideoCapabilities(probe, requirements);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: missing.map(({ reason }) => reason).join(' '),
      missingCapabilities: missing.map(({ id, reason }) => ({ id, reason })),
    };
  }

  const filters: string[] = [];
  if (stages[0]?.enabled) {
    filters.push(zscaleTransform(pipeline.source.inputColorSpace, pipeline.sequence.workingColorSpace));
    if (pipeline.source.exposureOffsetStops !== 0) {
      filters.push(`exposure=exposure=${pipeline.source.exposureOffsetStops.toFixed(4)}`);
    }
  }
  if (stages[1]?.enabled) {
    const exposureBrightness = Math.pow(2, pipeline.clip.exposureStops) - 1;
    filters.push(`eq=brightness=${exposureBrightness.toFixed(4)}:contrast=${pipeline.clip.contrast.toFixed(4)}:saturation=${pipeline.clip.saturation.toFixed(4)}`);
    if (pipeline.clip.temperature !== 0 || pipeline.clip.tint !== 0) {
      filters.push(`colorbalance=rs=${(pipeline.clip.temperature / 200).toFixed(4)}:bs=${(-pipeline.clip.temperature / 200).toFixed(4)}:gm=${(pipeline.clip.tint / 200).toFixed(4)}`);
    }
  }
  if (stages[2]?.enabled && pipeline.clip.lut) {
    filters.push(`lut3d=file='${escapeFfmpegPath(pipeline.clip.lut.uri)}':interp=tetrahedral`);
  }
  if (stages[3]?.enabled) {
    const transfer = hdrTransfer(pipeline.sequence.workingColorSpace);
    if (transfer && pipeline.sequence.outputColorSpace === 'rec709') {
      const working = ffmpegColorDescriptor(pipeline.sequence.workingColorSpace);
      filters.push(`zscale=primariesin=${working.primaries}:transferin=${working.transfer}:matrixin=${working.matrix}:transfer=linear:npl=${pipeline.sequence.hdrPeakNits},tonemap=tonemap=bt2390:desat=0,zscale=primariesin=bt2020:transferin=linear:matrixin=bt2020nc:primaries=bt709:transfer=bt709:matrix=bt709`);
    } else {
      filters.push(zscaleTransform(pipeline.sequence.workingColorSpace, pipeline.sequence.outputColorSpace));
    }
  }
  return { ok: true, filters, requiredCapabilities: [...new Set(requirements)], stages };
}

export interface VideoRgbaFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface VideoScopeBin {
  x: number;
  y: number;
  count: number;
}

export interface VideoScopeResult {
  sampleCount: number;
  sampleStride: number;
  histogram: number[];
  waveform: { width: number; height: number; bins: VideoScopeBin[] };
  rgbParade: { width: number; height: number; red: VideoScopeBin[]; green: VideoScopeBin[]; blue: VideoScopeBin[] };
  vectorscope: { size: number; bins: VideoScopeBin[] };
}

function incrementBin(map: Map<number, number>, index: number): void {
  map.set(index, (map.get(index) ?? 0) + 1);
}

function materializeBins(map: Map<number, number>, width: number): VideoScopeBin[] {
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, count]) => ({ x: index % width, y: Math.floor(index / width), count }));
}

/** Computes bounded, deterministic scopes directly from RGBA bytes without DOM/canvas access. */
export function computeVideoScopes(frame: VideoRgbaFrame, maxSamples = 65_536): VideoScopeResult {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0) {
    throw new Error('Scope input dimensions must be positive integers.');
  }
  if (frame.data.length < frame.width * frame.height * 4) throw new Error('Scope RGBA input is shorter than its dimensions require.');
  const boundedMax = Number.isFinite(maxSamples) ? Math.max(1, Math.floor(maxSamples)) : 65_536;
  const stride = Math.max(1, Math.ceil((frame.width * frame.height) / boundedMax));
  const histogram = Array.from({ length: 256 }, () => 0);
  const waveform = new Map<number, number>();
  const red = new Map<number, number>();
  const green = new Map<number, number>();
  const blue = new Map<number, number>();
  const vectorscope = new Map<number, number>();
  const waveformWidth = 256;
  const scopeHeight = 128;
  const vectorSize = 64;
  let sampleCount = 0;

  for (let pixel = 0; pixel < frame.width * frame.height; pixel += stride) {
      const x = pixel % frame.width;
      const offset = pixel * 4;
      const r = frame.data[offset] ?? 0;
      const g = frame.data[offset + 1] ?? 0;
      const b = frame.data[offset + 2] ?? 0;
      const luma = Math.max(0, Math.min(255, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)));
      histogram[luma] = (histogram[luma] ?? 0) + 1;
      const sx = Math.min(waveformWidth - 1, Math.floor((x / Math.max(1, frame.width - 1)) * waveformWidth));
      const sy = scopeHeight - 1 - Math.round((luma / 255) * (scopeHeight - 1));
      incrementBin(waveform, sy * waveformWidth + sx);
      incrementBin(red, (scopeHeight - 1 - Math.round((r / 255) * (scopeHeight - 1))) * waveformWidth + sx);
      incrementBin(green, (scopeHeight - 1 - Math.round((g / 255) * (scopeHeight - 1))) * waveformWidth + sx);
      incrementBin(blue, (scopeHeight - 1 - Math.round((b / 255) * (scopeHeight - 1))) * waveformWidth + sx);
      const cb = Math.max(0, Math.min(1, 0.5 + (b - luma) / 510));
      const cr = Math.max(0, Math.min(1, 0.5 + (r - luma) / 510));
      const vx = Math.round(cb * (vectorSize - 1));
      const vy = vectorSize - 1 - Math.round(cr * (vectorSize - 1));
      incrementBin(vectorscope, vy * vectorSize + vx);
      sampleCount += 1;
  }

  return {
    sampleCount,
    sampleStride: stride,
    histogram,
    waveform: { width: waveformWidth, height: scopeHeight, bins: materializeBins(waveform, waveformWidth) },
    rgbParade: {
      width: waveformWidth,
      height: scopeHeight,
      red: materializeBins(red, waveformWidth),
      green: materializeBins(green, waveformWidth),
      blue: materializeBins(blue, waveformWidth),
    },
    vectorscope: { size: vectorSize, bins: materializeBins(vectorscope, vectorSize) },
  };
}
