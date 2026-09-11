export type NativeRenderExecutionBackend = 'cpu' | 'amd-vaapi' | 'nvidia-nvenc' | 'intel-qsv';
export interface NativeSequencePresetMapping {
  videoCodecArgs: string[];
  notes: string[];
}

type NativeSequenceOutputFilter = 'yuv420p' | 'yuv422p' | 'yuva420p' | 'nv12-hwupload';

type NativeSequenceOutputPreset = {
  nativeMapping?: Partial<Record<NativeRenderExecutionBackend, { outputFilter?: NativeSequenceOutputFilter }>>;
};

const CPU_THREAD_ARGS = ['-threads', '0', '-filter_threads', '0', '-filter_complex_threads', '0'] as const;
const VAAPI_DEVICE_PATH = '/dev/dri/renderD128';

export function getNativeRenderThreadArgs(): string[] {
  return [...CPU_THREAD_ARGS];
}

export function getNativeSequenceCommandPrefix(backend: NativeRenderExecutionBackend): string[] {
  if (backend === 'amd-vaapi') {
    return ['-vaapi_device', VAAPI_DEVICE_PATH, ...CPU_THREAD_ARGS];
  }

  return [...CPU_THREAD_ARGS];
}

export function getNativeSequencePixelFormatFilter(
  backend: NativeRenderExecutionBackend,
  preset?: NativeSequenceOutputPreset | NativeSequenceOutputFilter,
): string {
  const configured = typeof preset === 'string'
    ? preset
    : preset?.nativeMapping?.[backend]?.outputFilter;
  const outputFilter = configured ?? (backend === 'amd-vaapi' ? 'nv12-hwupload' : 'yuv420p');
  return outputFilter === 'nv12-hwupload' ? 'format=nv12,hwupload' : `format=${outputFilter}`;
}

export function getNativeSequenceOutputFilter(
  finalBaseLabel: string,
  backend: NativeRenderExecutionBackend,
  preset?: NativeSequenceOutputPreset | NativeSequenceOutputFilter,
): string {
  return `[${finalBaseLabel}]${getNativeSequencePixelFormatFilter(backend, preset)}[vout]`;
}

export function getNativeSequenceEncoderArgs(
  backend: NativeRenderExecutionBackend,
  preset?: {
    crf?: number;
    audioCodecArgs?: string[];
    nativeMapping?: Partial<Record<NativeRenderExecutionBackend, { videoCodecArgs: string[] }>>;
  },
): string[] {
  const mappedArgs = preset?.nativeMapping?.[backend]?.videoCodecArgs;

  if (mappedArgs) {
    return [...mappedArgs];
  }

  if (backend === 'amd-vaapi') {
    const qp = preset?.crf != null ? Math.max(16, Math.min(30, Math.round(preset.crf + 1))) : 20;
    return ['-c:v', 'h264_vaapi', '-qp', String(qp)];
  }

  if (backend === 'nvidia-nvenc') {
    const cq = preset?.crf != null ? Math.max(16, Math.min(35, Math.round(preset.crf))) : 23;
    return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-cq', String(cq), '-pix_fmt', 'yuv420p'];
  }

  if (backend === 'intel-qsv') {
    const quality = preset?.crf != null ? Math.max(16, Math.min(35, Math.round(preset.crf))) : 23;
    return ['-c:v', 'h264_qsv', '-global_quality', String(quality), '-pix_fmt', 'nv12'];
  }

  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(preset?.crf ?? 23), '-pix_fmt', 'yuv420p'];
}

export function describeNativeSequencePresetMapping(
  backend: NativeRenderExecutionBackend,
  preset: {
    crf?: number;
    profile?: string;
    label?: string;
    nativeMapping?: Partial<Record<NativeRenderExecutionBackend, { videoCodecArgs: string[]; notes: string[] }>>;
  },
): NativeSequencePresetMapping {
  const mapped = preset.nativeMapping?.[backend];

  if (mapped) {
    return {
      videoCodecArgs: [...mapped.videoCodecArgs],
      notes: [...mapped.notes],
    };
  }

  if (backend === 'amd-vaapi') {
    return {
      videoCodecArgs: getNativeSequenceEncoderArgs(backend, preset),
      notes: [
        `${preset.label ?? 'Preset'} mapped to h264_vaapi hardware output.`,
        'CRF/profile are normalized to VAAPI QP because libx264 profile controls are not accepted by h264_vaapi.',
      ],
    };
  }

  if (backend === 'nvidia-nvenc') {
    return {
      videoCodecArgs: getNativeSequenceEncoderArgs(backend, preset),
      notes: [`${preset.label ?? 'Preset'} mapped to NVIDIA NVENC H.264 hardware output.`],
    };
  }

  if (backend === 'intel-qsv') {
    return {
      videoCodecArgs: getNativeSequenceEncoderArgs(backend, preset),
      notes: [`${preset.label ?? 'Preset'} mapped to Intel Quick Sync H.264 hardware output.`],
    };
  }

  return {
    videoCodecArgs: getNativeSequenceEncoderArgs(backend, preset),
    notes: [`${preset.label ?? 'Preset'} mapped to native CPU libx264 CRF output.`],
  };
}

export function getVaapiDevicePath(): string {
  return VAAPI_DEVICE_PATH;
}
