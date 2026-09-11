/**
 * Runtime feature discovery for professional video tools.
 *
 * This module deliberately parses caller-supplied probe output. It never starts
 * FFmpeg itself, which keeps discovery deterministic and safe in the renderer.
 */

export type VideoProfessionalCapabilityId =
  | 'lut3d'
  | 'zscale'
  | 'colorspace'
  | 'ebur128'
  | 'minterpolate'
  | 'vidstab-detect'
  | 'vidstab-transform'
  | 'vidstab'
  | 'aaf';

export interface VideoBrowserCapabilityFlags {
  webAudio?: boolean;
  offscreenCanvas?: boolean;
  webCodecs?: boolean;
  webGpu?: boolean;
}

export interface VideoCapabilityProbeInput {
  ffmpegFiltersText?: string;
  ffmpegEncodersText?: string;
  browser?: VideoBrowserCapabilityFlags;
}

export interface VideoCapabilitySupport {
  id: VideoProfessionalCapabilityId;
  supported: boolean;
  reason: string;
  source: 'ffmpeg-filter' | 'application' | 'aggregate';
}

export interface VideoProfessionalCapabilityProbe {
  capabilities: Record<VideoProfessionalCapabilityId, VideoCapabilitySupport>;
  browser: Required<VideoBrowserCapabilityFlags>;
  encoders: string[];
  filters: string[];
}

const FILTER_CAPABILITIES: ReadonlyArray<{
  id: Exclude<VideoProfessionalCapabilityId, 'vidstab' | 'aaf'>;
  filterName: string;
  description: string;
}> = [
  { id: 'lut3d', filterName: 'lut3d', description: '3D LUT processing' },
  { id: 'zscale', filterName: 'zscale', description: 'high-quality color-space and transfer conversion' },
  { id: 'colorspace', filterName: 'colorspace', description: 'FFmpeg color-space conversion' },
  { id: 'ebur128', filterName: 'ebur128', description: 'EBU R128 loudness analysis' },
  { id: 'minterpolate', filterName: 'minterpolate', description: 'motion-interpolated retiming' },
  { id: 'vidstab-detect', filterName: 'vidstabdetect', description: 'video stabilization analysis' },
  { id: 'vidstab-transform', filterName: 'vidstabtransform', description: 'video stabilization rendering' },
];

function parseFfmpegNames(text: string | undefined): string[] {
  if (!text) return [];
  const names = new Set<string>();
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('--') || /^(Filters|Encoders):?$/iu.test(line)) continue;
    const columns = line.split(/\s+/u);
    // FFmpeg listings begin with a compact flag column. Be tolerant of callers
    // supplying just one name per line as well.
    const candidate = columns.length > 1 && /^[.A-Z]{3,8}$/u.test(columns[0] ?? '')
      ? columns[1]
      : columns[0];
    if (candidate && /^[a-z0-9][a-z0-9_-]*$/iu.test(candidate)) names.add(candidate.toLowerCase());
  }
  return [...names].sort();
}

export function probeVideoProfessionalCapabilities(
  input: VideoCapabilityProbeInput,
): VideoProfessionalCapabilityProbe {
  const filters = parseFfmpegNames(input.ffmpegFiltersText);
  const filterSet = new Set(filters);
  const encoders = parseFfmpegNames(input.ffmpegEncodersText);
  const entries = {} as Record<VideoProfessionalCapabilityId, VideoCapabilitySupport>;

  for (const capability of FILTER_CAPABILITIES) {
    const supported = filterSet.has(capability.filterName);
    entries[capability.id] = {
      id: capability.id,
      supported,
      source: 'ffmpeg-filter',
      reason: supported
        ? `FFmpeg filter '${capability.filterName}' is available for ${capability.description}.`
        : `This FFmpeg build does not expose the '${capability.filterName}' filter required for ${capability.description}.`,
    };
  }

  const stabilizationSupported = entries['vidstab-detect'].supported && entries['vidstab-transform'].supported;
  entries.vidstab = {
    id: 'vidstab',
    supported: stabilizationSupported,
    source: 'aggregate',
    reason: stabilizationSupported
      ? 'Both vidstabdetect and vidstabtransform are available.'
      : 'Stabilization requires both FFmpeg vidstabdetect and vidstabtransform filters.',
  };
  entries.aaf = {
    id: 'aaf',
    supported: false,
    source: 'application',
    reason: 'AAF interchange is not implemented by Sloom Video; FFmpeg encoder availability does not provide an AAF project interchange writer.',
  };

  return {
    capabilities: entries,
    browser: {
      webAudio: input.browser?.webAudio === true,
      offscreenCanvas: input.browser?.offscreenCanvas === true,
      webCodecs: input.browser?.webCodecs === true,
      webGpu: input.browser?.webGpu === true,
    },
    encoders,
    filters,
  };
}

export function getVideoCapabilitySupport(
  probe: VideoProfessionalCapabilityProbe,
  id: VideoProfessionalCapabilityId,
): VideoCapabilitySupport {
  return probe.capabilities[id];
}

export function findMissingVideoCapabilities(
  probe: VideoProfessionalCapabilityProbe,
  requirements: readonly VideoProfessionalCapabilityId[],
): VideoCapabilitySupport[] {
  return [...new Set(requirements)]
    .map((id) => probe.capabilities[id])
    .filter((capability) => !capability.supported);
}
