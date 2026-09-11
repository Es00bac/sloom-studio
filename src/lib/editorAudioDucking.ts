export interface EditorAudioDuckingSettings {
  enabled: boolean;
  controlClipId?: string;
  depthPercent: number;
  thresholdDbfs: number;
  attackMs: number;
  releaseMs: number;
}

/**
 * Bounded side-chain settings for lowering one timeline clip while a second clip is active.
 * The native FFmpeg graph is authoritative; browser composition refuses this feature because
 * browser FFmpeg is intentionally not treated as a reliable side-chain execution environment.
 */
export const DEFAULT_EDITOR_AUDIO_DUCKING: EditorAudioDuckingSettings = {
  enabled: false,
  controlClipId: undefined,
  depthPercent: 60,
  thresholdDbfs: -30,
  attackMs: 10,
  releaseMs: 250,
};

export function normalizeEditorAudioDuckingSettings(value: unknown): EditorAudioDuckingSettings {
  const input = isRecord(value) ? value : {};
  const controlClipId = typeof input.controlClipId === 'string' && input.controlClipId.trim()
    ? input.controlClipId.trim()
    : undefined;

  return {
    enabled: input.enabled === true,
    controlClipId,
    depthPercent: boundedNumber(input.depthPercent, 0, 100, DEFAULT_EDITOR_AUDIO_DUCKING.depthPercent),
    // FFmpeg's sidechaincompress rejects values below approximately -60.2 dBFS.
    // Keep the persisted/UI contract inside the executable native range.
    thresholdDbfs: boundedNumber(input.thresholdDbfs, -60, -10, DEFAULT_EDITOR_AUDIO_DUCKING.thresholdDbfs),
    attackMs: boundedNumber(input.attackMs, 1, 200, DEFAULT_EDITOR_AUDIO_DUCKING.attackMs),
    releaseMs: boundedNumber(input.releaseMs, 10, 2_000, DEFAULT_EDITOR_AUDIO_DUCKING.releaseMs),
  };
}

export function hasEnabledEditorAudioDucking(value: unknown): boolean {
  return normalizeEditorAudioDuckingSettings(value).enabled;
}

/** Returns a stable FFmpeg side-chain filter for the target clip. */
export function buildEditorAudioDuckingFilter(value: unknown): string {
  const settings = normalizeEditorAudioDuckingSettings(value);
  return [
    'sidechaincompress=mode=downward:',
    `threshold=${dbToLinear(settings.thresholdDbfs).toFixed(6)}`,
    ':ratio=20',
    `:attack=${formatNumber(settings.attackMs)}`,
    `:release=${formatNumber(settings.releaseMs)}`,
    ':knee=1.995262',
    ':detection=rms:link=maximum:level_sc=1',
    `:mix=${(settings.depthPercent / 100).toFixed(3)}`,
  ].join('');
}

export interface EditorAudioDuckingGraphTrack {
  label: string;
  id?: string;
  audioDucking?: unknown;
}

/**
 * Builds the shared native side-chain graph. Every decoded pad is single-use in FFmpeg, so
 * control clips are split before padding and each target receives its own control leg. Padding
 * the control leg to the timeline prevents a short dialogue source from truncating the bed.
 */
export function buildEditorAudioDuckingGraph(
  tracks: readonly EditorAudioDuckingGraphTrack[],
  timelineDurationSeconds: number,
): { filterParts: string[]; audioLabels: string[] } {
  const seenClipIds = new Set<string>();
  for (const track of tracks) {
    if (!track.id) continue;
    if (seenClipIds.has(track.id)) {
      throw new Error(`Audio clip identity ${track.id} is duplicated; auto-ducking cannot choose a control source safely.`);
    }
    seenClipIds.add(track.id);
  }
  const availableClipIds = new Set(tracks.flatMap((track) => track.id ? [track.id] : []));
  const plans = tracks.map((track, index) => {
    const settings = normalizeEditorAudioDuckingSettings(track.audioDucking);
    if (!settings.enabled) {
      return { track, index, settings, controlLabel: undefined };
    }
    const control = resolveEditorAudioDuckingControl(settings, track.id, availableClipIds);
    if (!control.ok) {
      throw new Error(`Cannot render auto-ducking for ${track.id ?? `audio clip ${index + 1}`}: ${control.reason}`);
    }
    const controlTrack = tracks.find((candidate) => candidate.id === control.controlClipId);
    if (!controlTrack) {
      throw new Error(`Cannot render auto-ducking for ${track.id ?? `audio clip ${index + 1}`}: control clip label is unavailable.`);
    }
    return { track, index, settings, controlLabel: controlTrack.label };
  });

  const controlUseCounts = new Map<string, number>();
  for (const plan of plans) {
    if (plan.controlLabel) {
      controlUseCounts.set(plan.controlLabel, (controlUseCounts.get(plan.controlLabel) ?? 0) + 1);
    }
  }

  const filterParts: string[] = [];
  const mainLabels = new Map<string, string>();
  const paddedControlLabels = new Map<string, string>();
  for (const track of tracks) {
    const controlUseCount = controlUseCounts.get(track.label) ?? 0;
    if (controlUseCount === 0) {
      mainLabels.set(track.label, track.label);
      continue;
    }
    const mainLabel = `${track.label}main`;
    const controlLabel = `${track.label}control`;
    mainLabels.set(track.label, mainLabel);
    filterParts.push(`[${track.label}]asplit=2[${mainLabel}][${controlLabel}]`);
    const paddedLabel = `${track.label}pad`;
    filterParts.push(`[${controlLabel}]apad=whole_dur=${formatGraphSeconds(timelineDurationSeconds)}[${paddedLabel}]`);
    if (controlUseCount === 1) {
      paddedControlLabels.set(track.label, paddedLabel);
      continue;
    }
    const splitLabels = Array.from({ length: controlUseCount }, (_, index) => `${paddedLabel}${index}`);
    filterParts.push(`[${paddedLabel}]asplit=${controlUseCount}${splitLabels.map((label) => `[${label}]`).join('')}`);
    paddedControlLabels.set(track.label, splitLabels.join('|'));
  }

  const controlLegIndexes = new Map<string, number>();
  const audioLabels: string[] = [];
  for (const plan of plans) {
    if (!plan.controlLabel) {
      audioLabels.push(`[${mainLabels.get(plan.track.label) ?? plan.track.label}]`);
      continue;
    }
    const controlIndex = controlLegIndexes.get(plan.controlLabel) ?? 0;
    controlLegIndexes.set(plan.controlLabel, controlIndex + 1);
    const controlPad = paddedControlLabels.get(plan.controlLabel);
    if (!controlPad) {
      throw new Error(`Cannot render auto-ducking for ${plan.track.id ?? `audio clip ${plan.index + 1}`}: padded control clip is unavailable.`);
    }
    const controlInput = controlPad.includes('|')
      ? controlPad.split('|')[controlIndex]
      : controlPad;
    const duckedLabel = `${plan.track.label}duck`;
    filterParts.push(`[${mainLabels.get(plan.track.label) ?? plan.track.label}][${controlInput}]${buildEditorAudioDuckingFilter(plan.settings)}[${duckedLabel}]`);
    audioLabels.push(`[${duckedLabel}]`);
  }

  return { filterParts, audioLabels };
}

/**
 * Side-chain settings are only executable when the selected control is another enabled clip.
 * This keeps stale/deleted references and self-references fail-closed before FFmpeg starts.
 */
export function resolveEditorAudioDuckingControl(
  value: unknown,
  targetClipId: string | undefined,
  availableClipIds: ReadonlySet<string>,
): { ok: true; controlClipId: string } | { ok: false; reason: string } {
  const settings = normalizeEditorAudioDuckingSettings(value);
  if (!settings.enabled) return { ok: true, controlClipId: '' };
  if (!settings.controlClipId) return { ok: false, reason: 'Auto-ducking needs a control clip.' };
  if (settings.controlClipId === targetClipId) return { ok: false, reason: 'A clip cannot duck from itself.' };
  if (!availableClipIds.has(settings.controlClipId)) {
    return { ok: false, reason: 'The selected auto-duck control clip is unavailable or disabled.' };
  }
  return { ok: true, controlClipId: settings.controlClipId };
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

function formatGraphSeconds(value: number): string {
  return Number.isFinite(value) ? Math.max(0, value).toFixed(3) : '0.000';
}

function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
