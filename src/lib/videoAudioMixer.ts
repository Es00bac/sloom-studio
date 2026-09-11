export interface VideoAudioSend {
  id: string;
  targetBusId: string;
  gainDb: number;
  preFader?: boolean;
}

export interface VideoAudioChannelMap {
  outputLayout: 'mono' | 'stereo' | '5.1' | '7.1';
  expressions: string[];
}

export interface VideoAudioTrackRoute {
  id: string;
  inputIndex: number;
  busId: string;
  gainDb: number;
  pan: number;
  mute?: boolean;
  channelMap?: VideoAudioChannelMap;
  sends?: VideoAudioSend[];
}

export interface VideoAudioBus {
  id: string;
  name: string;
  parentBusId?: string;
  gainDb: number;
  pan: number;
  mute?: boolean;
  solo?: boolean;
  channelMap?: VideoAudioChannelMap;
  sends?: VideoAudioSend[];
}

export interface VideoAudioMixerModel {
  version: 1;
  sampleRate: number;
  masterBusId: string;
  buses: VideoAudioBus[];
  tracks: VideoAudioTrackRoute[];
}

export interface VideoAudioRoutingNode {
  id: string;
  kind: 'input' | 'gain' | 'pan' | 'channel-map' | 'send' | 'bus' | 'meter' | 'output';
  parameters: Record<string, unknown>;
}

export interface VideoAudioRoutingEdge {
  from: string;
  to: string;
  role: 'main' | 'send' | 'meter';
}

export interface VideoWebAudioRoutingDescriptor {
  ok: true;
  nodes: VideoAudioRoutingNode[];
  edges: VideoAudioRoutingEdge[];
  metering: 'realtime-approximate';
  note: string;
}

export interface VideoAudioFfmpegPlan {
  ok: true;
  filterComplex: string;
  outputLabel: string;
  steps: Array<{ id: string; kind: 'volume' | 'pan' | 'channel-map' | 'asplit' | 'amix' | 'source'; expression: string }>;
}

export interface VideoAudioRoutingUnavailable {
  ok: false;
  reason: string;
  errors: string[];
}

/** Persisted-editor shape accepted by the bounded main-output mixer bridge. */
export interface VideoAudioMixerBusInput {
  id: string;
  name?: string;
  kind?: 'submix' | 'master';
  outputBusId?: string;
  gainDb?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

/** A timeline clip's one permitted main-output route. Sends and channel maps stay unsupported here. */
export interface VideoAudioMixerTrackInput {
  id: string;
  pan?: number;
  busId?: string;
}

export interface VideoAudioMixerResolvedRoute {
  id: string;
  inputIndex: number;
  gainDb: number;
  pan: number;
  audible: boolean;
  busPath: string[];
}

export interface VideoAudioMixerRoutingPlan {
  ok: true;
  model: VideoAudioMixerModel;
  routes: VideoAudioMixerResolvedRoute[];
}

export interface VideoAudioMixerFfmpegGraph {
  ok: true;
  filterParts: string[];
  outputLabel?: string;
  activeTrackIds: string[];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

export function createDefaultVideoAudioMixer(trackIds: readonly string[] = []): VideoAudioMixerModel {
  return {
    version: 1,
    sampleRate: 48_000,
    masterBusId: 'master',
    buses: [{ id: 'master', name: 'Master', gainDb: 0, pan: 0 }],
    tracks: trackIds.map((id, inputIndex) => ({ id, inputIndex, busId: 'master', gainDb: 0, pan: 0 })),
  };
}

export function normalizeVideoAudioMixer(
  model: VideoAudioMixerModel | null | undefined,
  defaultTrackIds: readonly string[] = [],
): VideoAudioMixerModel {
  if (!model) return createDefaultVideoAudioMixer(defaultTrackIds);
  return {
    ...model,
    sampleRate: Number.isFinite(model.sampleRate) && model.sampleRate > 0 ? Math.round(model.sampleRate) : 48_000,
    buses: model.buses.map((bus) => ({ ...bus, gainDb: clamp(bus.gainDb, -96, 24), pan: clamp(bus.pan, -1, 1), sends: bus.sends?.map((send) => ({ ...send })) })),
    tracks: model.tracks.map((track) => ({ ...track, gainDb: clamp(track.gainDb, -96, 24), pan: clamp(track.pan, -1, 1), sends: track.sends?.map((send) => ({ ...send })) })),
  };
}

export function validateVideoAudioMixer(model: VideoAudioMixerModel): string[] {
  const errors: string[] = [];
  if (model.buses.length > 32) errors.push('Audio routing is limited to 32 buses.');
  if (model.tracks.length > 64) errors.push('Audio routing is limited to 64 active timeline clips.');
  const busIds = new Set<string>();
  for (const bus of model.buses) {
    if (!bus.id.trim()) errors.push('Every audio bus must have a non-empty id.');
    if (busIds.has(bus.id)) errors.push(`Duplicate audio bus id '${bus.id}'.`);
    busIds.add(bus.id);
  }
  if (!busIds.has(model.masterBusId)) errors.push(`Master bus '${model.masterBusId}' does not exist.`);
  const trackIds = new Set<string>();
  for (const track of model.tracks) {
    if (!track.id.trim()) errors.push('Every audio track route must have a non-empty id.');
    if (trackIds.has(track.id)) errors.push(`Duplicate audio track route id '${track.id}'.`);
    trackIds.add(track.id);
    if (!busIds.has(track.busId)) errors.push(`Track '${track.id}' routes to unknown bus '${track.busId}'.`);
  }
  for (const bus of model.buses) {
    if (bus.parentBusId && !busIds.has(bus.parentBusId)) errors.push(`Bus '${bus.id}' routes to unknown parent '${bus.parentBusId}'.`);
    if (bus.id === model.masterBusId && bus.parentBusId) errors.push('The master bus cannot route to a parent bus.');
    for (const send of bus.sends ?? []) {
      if (!busIds.has(send.targetBusId)) errors.push(`Send '${send.id}' targets unknown bus '${send.targetBusId}'.`);
      if (send.targetBusId === bus.id) errors.push(`Bus '${bus.id}' cannot send to itself.`);
    }
  }
  for (const track of model.tracks) {
    for (const send of track.sends ?? []) {
      if (!busIds.has(send.targetBusId)) errors.push(`Send '${send.id}' targets unknown bus '${send.targetBusId}'.`);
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const bus of model.buses) {
    adjacency.set(bus.id, [
      ...(bus.parentBusId ? [bus.parentBusId] : []),
      ...(bus.sends ?? []).map(({ targetBusId }) => targetBusId),
    ]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push(`Audio bus routing contains a cycle at '${id}'.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of busIds) visit(id);
  return [...new Set(errors)];
}

/**
 * Converts the editor's compact persisted bus/clip records into the one-main-output
 * model that both Program playback and sequence export consume. It deliberately
 * does not manufacture sends, channel maps, meters, or effect returns.
 */
export function createVideoAudioMixerRoutingModel({
  buses,
  tracks,
}: {
  buses?: readonly VideoAudioMixerBusInput[] | null;
  tracks: readonly VideoAudioMixerTrackInput[];
}): VideoAudioMixerModel {
  const sourceBuses = Array.isArray(buses) && buses.length > 0
    ? buses
    : [{ id: 'master', name: 'Master', kind: 'master' as const, gainDb: 0, pan: 0 }];

  return {
    version: 1,
    sampleRate: 48_000,
    masterBusId: 'master',
    buses: sourceBuses.map((bus) => ({
      id: typeof bus?.id === 'string' ? bus.id.trim().slice(0, 128) : '',
      name: typeof bus?.name === 'string' ? bus.name.trim().slice(0, 128) || 'Unnamed bus' : 'Unnamed bus',
      parentBusId: bus?.kind === 'master'
        ? undefined
        : typeof bus?.outputBusId === 'string' && bus.outputBusId.trim()
          ? bus.outputBusId.trim().slice(0, 128)
          : 'master',
      gainDb: clamp(bus?.gainDb ?? 0, -96, 24),
      pan: clamp(bus?.pan ?? 0, -1, 1),
      mute: bus?.muted === true,
      solo: bus?.solo === true,
    })),
    tracks: tracks.map((track, inputIndex) => ({
      id: typeof track?.id === 'string' ? track.id.trim().slice(0, 128) : '',
      inputIndex,
      busId: typeof track?.busId === 'string' && track.busId.trim()
        ? track.busId.trim().slice(0, 128)
        : 'master',
      gainDb: 0,
      pan: clamp(track?.pan ?? 0, -1, 1),
    })),
  };
}

/** Resolves each clip's main-output bus path once, refusing invalid or cyclic saved state. */
export function resolveVideoAudioMixerRoutes(
  modelInput: VideoAudioMixerModel | null | undefined,
  defaultTrackIds: readonly string[] = [],
): VideoAudioMixerRoutingPlan | VideoAudioRoutingUnavailable {
  const model = normalizeVideoAudioMixer(modelInput, defaultTrackIds);
  const errors = validateVideoAudioMixer(model);
  if (errors.length > 0) return { ok: false, reason: errors[0] ?? 'Invalid audio routing.', errors };

  const busById = new Map(model.buses.map((bus) => [bus.id, bus]));
  const soloBusIds = new Set(model.buses.filter((bus) => bus.solo === true).map((bus) => bus.id));
  const routes = model.tracks.map((track) => {
    const busPath: string[] = [];
    let current = busById.get(track.busId);
    while (current) {
      busPath.push(current.id);
      current = current.parentBusId ? busById.get(current.parentBusId) : undefined;
    }
    const muted = track.mute === true || busPath.some((id) => busById.get(id)?.mute === true);
    const admittedBySolo = soloBusIds.size === 0 || busPath.some((id) => soloBusIds.has(id));
    const gainDb = clamp(
      track.gainDb + busPath.reduce((sum, id) => sum + (busById.get(id)?.gainDb ?? 0), 0),
      -96,
      24,
    );
    const pan = clamp(
      track.pan + busPath.reduce((sum, id) => sum + (busById.get(id)?.pan ?? 0), 0),
      -1,
      1,
    );
    return {
      id: track.id,
      inputIndex: track.inputIndex,
      gainDb,
      pan,
      audible: !muted && admittedBySolo,
      busPath,
    } satisfies VideoAudioMixerResolvedRoute;
  });
  return { ok: true, model, routes };
}

/**
 * Applies the resolved one-main-output routes to already-trimmed/delayed input
 * labels. The caller owns source processing and final output encoding; this
 * helper owns only persisted bus gain/pan/mute/solo semantics.
 */
export function buildVideoAudioMixerFfmpegGraph({
  model,
  inputs,
}: {
  model: VideoAudioMixerModel | null | undefined;
  inputs: readonly { id: string; label: string }[];
}): VideoAudioMixerFfmpegGraph | VideoAudioRoutingUnavailable {
  const routing = resolveVideoAudioMixerRoutes(model);
  if (!routing.ok) return routing;
  const labelByTrackId = new Map(inputs.map((input) => [input.id, input.label]));
  const duplicateInputIds = inputs.filter((input, index) => inputs.findIndex((candidate) => candidate.id === input.id) !== index);
  if (duplicateInputIds.length > 0) {
    return {
      ok: false,
      reason: 'Audio mixer input ids must be unique.',
      errors: ['Audio mixer input ids must be unique.'],
    };
  }
  const missingInput = routing.routes.find((route) => !labelByTrackId.has(route.id));
  if (missingInput) {
    return {
      ok: false,
      reason: `Audio mixer track '${missingInput.id}' has no prepared input.`,
      errors: [`Audio mixer track '${missingInput.id}' has no prepared input.`],
    };
  }
  const filterParts: string[] = [];
  const activeLabels: string[] = [];
  const activeTrackIds: string[] = [];
  for (const route of routing.routes) {
    const inputLabel = labelByTrackId.get(route.id);
    if (!inputLabel || !route.audible) continue;
    const outputLabel = `mixer_track_${route.inputIndex}`;
    const coefficients = panCoefficients(route.pan);
    filterParts.push(
      `[${inputLabel}]aformat=channel_layouts=stereo,volume=${route.gainDb.toFixed(3)}dB,pan=stereo|c0=${coefficients.left.toFixed(6)}*c0|c1=${coefficients.right.toFixed(6)}*c1[${outputLabel}]`,
    );
    activeLabels.push(`[${outputLabel}]`);
    activeTrackIds.push(route.id);
  }
  if (activeLabels.length === 0) {
    return { ok: true, filterParts, activeTrackIds };
  }
  if (activeLabels.length === 1) {
    filterParts.push(`${activeLabels[0]}anull[mixer_mix]`);
  } else {
    filterParts.push(`${activeLabels.join('')}amix=inputs=${activeLabels.length}:duration=longest,dropout_transition=0[mixer_mix]`);
  }
  return { ok: true, filterParts, outputLabel: 'mixer_mix', activeTrackIds };
}

function panCoefficients(pan: number): { left: number; right: number } {
  const normalized = clamp(pan, -1, 1);
  return {
    left: normalized <= 0 ? 1 : 1 - normalized,
    right: normalized >= 0 ? 1 : 1 + normalized,
  };
}

export function compileVideoWebAudioRouting(
  modelInput: VideoAudioMixerModel | null | undefined,
  defaultTrackIds: readonly string[] = [],
): VideoWebAudioRoutingDescriptor | VideoAudioRoutingUnavailable {
  const model = normalizeVideoAudioMixer(modelInput, defaultTrackIds);
  const errors = validateVideoAudioMixer(model);
  if (errors.length > 0) return { ok: false, reason: errors[0] ?? 'Invalid audio routing.', errors };
  const nodes: VideoAudioRoutingNode[] = [];
  const edges: VideoAudioRoutingEdge[] = [];
  for (const track of model.tracks) {
    const input = `track:${track.id}:input`;
    const gain = `track:${track.id}:gain`;
    const pan = `track:${track.id}:pan`;
    nodes.push({ id: input, kind: 'input', parameters: { inputIndex: track.inputIndex } });
    nodes.push({ id: gain, kind: 'gain', parameters: { gainDb: track.mute ? -96 : track.gainDb } });
    nodes.push({ id: pan, kind: 'pan', parameters: panCoefficients(track.pan) });
    edges.push({ from: input, to: gain, role: 'main' }, { from: gain, to: pan, role: 'main' }, { from: pan, to: `bus:${track.busId}`, role: 'main' });
    for (const send of track.sends ?? []) {
      const sendId = `track:${track.id}:send:${send.id}`;
      nodes.push({ id: sendId, kind: 'send', parameters: { gainDb: send.gainDb, preFader: send.preFader === true } });
      edges.push({ from: send.preFader ? input : pan, to: sendId, role: 'send' }, { from: sendId, to: `bus:${send.targetBusId}`, role: 'send' });
    }
  }
  for (const bus of model.buses) {
    const id = `bus:${bus.id}`;
    nodes.push({ id, kind: 'bus', parameters: { name: bus.name, gainDb: bus.mute ? -96 : bus.gainDb, pan: bus.pan } });
    nodes.push({ id: `${id}:meter`, kind: 'meter', parameters: { accuracy: 'approximate' } });
    edges.push({ from: id, to: `${id}:meter`, role: 'meter' });
    if (bus.parentBusId) edges.push({ from: id, to: `bus:${bus.parentBusId}`, role: 'main' });
    for (const send of bus.sends ?? []) {
      const sendId = `${id}:send:${send.id}`;
      nodes.push({ id: sendId, kind: 'send', parameters: { gainDb: send.gainDb, preFader: send.preFader === true } });
      edges.push({ from: id, to: sendId, role: 'send' }, { from: sendId, to: `bus:${send.targetBusId}`, role: 'send' });
    }
  }
  nodes.push({ id: 'output', kind: 'output', parameters: { sampleRate: model.sampleRate } });
  edges.push({ from: `bus:${model.masterBusId}`, to: 'output', role: 'main' });
  return {
    ok: true,
    nodes,
    edges,
    metering: 'realtime-approximate',
    note: 'Realtime Web Audio meters are decimated editorial guidance; offline EBU R128 analysis is authoritative.',
  };
}

function safeLabel(value: string): string {
  return value.replace(/[^a-z0-9_]/giu, '_');
}

function channelMapExpression(map: VideoAudioChannelMap | undefined): string | undefined {
  return map ? `pan=${map.outputLayout}|${map.expressions.join('|')}` : undefined;
}

export function compileVideoAudioFfmpegPlan(
  modelInput: VideoAudioMixerModel | null | undefined,
  defaultTrackIds: readonly string[] = [],
): VideoAudioFfmpegPlan | VideoAudioRoutingUnavailable {
  const model = normalizeVideoAudioMixer(modelInput, defaultTrackIds);
  const errors = validateVideoAudioMixer(model);
  if (errors.length > 0) return { ok: false, reason: errors[0] ?? 'Invalid audio routing.', errors };
  const steps: VideoAudioFfmpegPlan['steps'] = [];
  const filters: string[] = [];
  const busInputs = new Map(model.buses.map(({ id }) => [id, [] as string[]]));

  for (const track of model.tracks) {
    const name = safeLabel(track.id);
    const processed = `track_${name}`;
    const coefficients = panCoefficients(track.pan);
    const chain = [
      `volume=${track.mute ? '-96' : track.gainDb}dB`,
      channelMapExpression(track.channelMap),
      `pan=stereo|c0=${coefficients.left.toFixed(6)}*c0|c1=${coefficients.right.toFixed(6)}*c1`,
    ].filter((entry): entry is string => Boolean(entry));
    filters.push(`[${track.inputIndex}:a]${chain.join(',')}[${processed}]`);
    steps.push({ id: processed, kind: 'volume', expression: chain.join(',') });
    const sends = track.sends ?? [];
    if (sends.length > 0) {
      const outputs = [`${processed}_main`, ...sends.map((send) => `${processed}_send_${safeLabel(send.id)}`)];
      const expression = `[${processed}]asplit=${outputs.length}${outputs.map((id) => `[${id}]`).join('')}`;
      filters.push(expression);
      steps.push({ id: `${processed}_split`, kind: 'asplit', expression });
      busInputs.get(track.busId)?.push(`[${outputs[0]}]`);
      sends.forEach((send, index) => {
        const sendOut = `${outputs[index + 1]}_gain`;
        filters.push(`[${outputs[index + 1]}]volume=${send.gainDb}dB[${sendOut}]`);
        busInputs.get(send.targetBusId)?.push(`[${sendOut}]`);
      });
    } else {
      busInputs.get(track.busId)?.push(`[${processed}]`);
    }
  }

  // Compile the complete parent/send DAG source-to-destination, so all inputs
  // have labels before their destination bus is mixed.
  const outgoing = new Map(model.buses.map((bus) => [bus.id, [
    ...(bus.parentBusId ? [bus.parentBusId] : []),
    ...(bus.sends ?? []).map(({ targetBusId }) => targetBusId),
  ]]));
  const indegree = new Map(model.buses.map(({ id }) => [id, 0]));
  for (const targets of outgoing.values()) {
    for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }
  const byId = new Map(model.buses.map((bus) => [bus.id, bus]));
  const queue = [...model.buses].filter(({ id }) => indegree.get(id) === 0).sort((a, b) => a.id.localeCompare(b.id));
  const orderedBuses: VideoAudioBus[] = [];
  while (queue.length > 0) {
    const bus = queue.shift();
    if (!bus) break;
    orderedBuses.push(bus);
    for (const target of outgoing.get(bus.id) ?? []) {
      const next = (indegree.get(target) ?? 1) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const targetBus = byId.get(target);
        if (targetBus) {
          queue.push(targetBus);
          queue.sort((a, b) => a.id.localeCompare(b.id));
        }
      }
    }
  }
  for (const bus of orderedBuses) {
    const inputs = busInputs.get(bus.id) ?? [];
    const mixed = `bus_${safeLabel(bus.id)}_mix`;
    if (inputs.length === 0) {
      const expression = `anullsrc=r=${model.sampleRate}:cl=stereo`;
      filters.push(`${expression}[${mixed}]`);
      steps.push({ id: mixed, kind: 'source', expression });
    } else if (inputs.length === 1) {
      filters.push(`${inputs[0]}anull[${mixed}]`);
    } else {
      const expression = `amix=inputs=${inputs.length}:normalize=0:dropout_transition=0`;
      filters.push(`${inputs.join('')}${expression}[${mixed}]`);
      steps.push({ id: mixed, kind: 'amix', expression });
    }
    const output = `bus_${safeLabel(bus.id)}_post`;
    const coefficients = panCoefficients(bus.pan);
    const expression = [
      `volume=${bus.mute ? '-96' : bus.gainDb}dB`,
      channelMapExpression(bus.channelMap),
      `pan=stereo|c0=${coefficients.left.toFixed(6)}*c0|c1=${coefficients.right.toFixed(6)}*c1`,
    ].filter((entry): entry is string => Boolean(entry)).join(',');
    filters.push(`[${mixed}]${expression}[${output}]`);
    steps.push({ id: output, kind: 'pan', expression });
    const routes: Array<{ label: string; targetBusId?: string; send?: VideoAudioSend }> = [
      ...(bus.parentBusId ? [{ label: `${output}_main`, targetBusId: bus.parentBusId }] : []),
      ...(bus.sends ?? []).map((send) => ({ label: `${output}_send_${safeLabel(send.id)}`, targetBusId: send.targetBusId, send })),
      ...(bus.id === model.masterBusId ? [{ label: `bus_${safeLabel(bus.id)}` }] : []),
    ];
    if (routes.length === 1) {
      filters.push(`[${output}]anull[${routes[0]?.label}]`);
    } else if (routes.length > 1) {
      const split = `asplit=${routes.length}${routes.map(({ label }) => `[${label}]`).join('')}`;
      filters.push(`[${output}]${split}`);
      steps.push({ id: `${output}_split`, kind: 'asplit', expression: split });
    }
    for (const route of routes) {
      if (!route.targetBusId) continue;
      if (route.send) {
        const sendOutput = `${route.label}_gain`;
        filters.push(`[${route.label}]volume=${route.send.gainDb}dB[${sendOutput}]`);
        busInputs.get(route.targetBusId)?.push(`[${sendOutput}]`);
      } else {
        busInputs.get(route.targetBusId)?.push(`[${route.label}]`);
      }
    }
  }
  return { ok: true, filterComplex: filters.join(';'), outputLabel: `bus_${safeLabel(model.masterBusId)}`, steps };
}

export interface VideoAudioMeterPolicy {
  mode: 'realtime-approximate';
  updateHz: number;
  samplesPerWindow: number;
  note: string;
}

export function buildVideoAudioMeterPolicy(sampleRate = 48_000, requestedUpdateHz = 30): VideoAudioMeterPolicy {
  const updateHz = clamp(Math.round(requestedUpdateHz), 5, 60);
  return {
    mode: 'realtime-approximate',
    updateHz,
    samplesPerWindow: Math.max(128, Math.round(sampleRate / updateHz)),
    note: 'Realtime peak/RMS meters are decimated and approximate; use offline EBU R128 analysis for delivery decisions.',
  };
}

export interface VideoEbur128Result {
  integratedLufs: number;
  loudnessRangeLu?: number;
  thresholdLufs?: number;
  truePeakDbfs?: number;
  authority: 'offline-authoritative';
}

/**
 * The complete first-pass `loudnorm=print_format=json` result required by
 * FFmpeg's measured second pass. An EBU R128 summary is useful delivery
 * evidence, but it does not contain the offset and cannot safely stand in for
 * this record.
 */
export interface VideoLoudnormAnalysisResult {
  integratedLufs: number;
  loudnessRangeLu: number;
  thresholdLufs: number;
  truePeakDbfs: number;
  offsetGainDb: number;
  authority: 'offline-authoritative';
}

function lastNumberMatch(text: string, expression: RegExp): number | undefined {
  const matches = [...text.matchAll(expression)];
  const value = matches.at(-1)?.[1];
  if (!value || /^-?inf$/iu.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseVideoEbur128Output(text: string): VideoEbur128Result | null {
  const integratedLufs = lastNumberMatch(text, /^\s*I:\s*(-?(?:inf|\d+(?:\.\d+)?))\s*LUFS/imug);
  if (integratedLufs === undefined) return null;
  return {
    integratedLufs,
    loudnessRangeLu: lastNumberMatch(text, /^\s*LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/imug),
    thresholdLufs: lastNumberMatch(text, /^\s*Threshold:\s*(-?\d+(?:\.\d+)?)\s*LUFS/imug),
    truePeakDbfs: lastNumberMatch(text, /^\s*(?:Peak|True peak):\s*(-?\d+(?:\.\d+)?)\s*dBFS/imug),
    authority: 'offline-authoritative',
  };
}

function finiteJsonNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parses the final JSON block printed by FFmpeg loudnorm's first pass. */
export function parseVideoLoudnormAnalysisOutput(text: string): VideoLoudnormAnalysisResult | null {
  const blocks = text.match(/\{[\s\S]*?\}/gu) ?? [];
  for (const block of blocks.reverse()) {
    try {
      const value: unknown = JSON.parse(block);
      if (!value || typeof value !== 'object') continue;
      const result = value as Record<string, unknown>;
      const integratedLufs = finiteJsonNumber(result.input_i);
      const loudnessRangeLu = finiteJsonNumber(result.input_lra);
      const truePeakDbfs = finiteJsonNumber(result.input_tp);
      const thresholdLufs = finiteJsonNumber(result.input_thresh);
      const offsetGainDb = finiteJsonNumber(result.target_offset);
      if ([integratedLufs, loudnessRangeLu, truePeakDbfs, thresholdLufs, offsetGainDb].some((entry) => entry === undefined)) continue;
      return {
        integratedLufs: integratedLufs as number,
        loudnessRangeLu: loudnessRangeLu as number,
        truePeakDbfs: truePeakDbfs as number,
        thresholdLufs: thresholdLufs as number,
        offsetGainDb: offsetGainDb as number,
        authority: 'offline-authoritative',
      };
    } catch {
      // FFmpeg writes progress and diagnostics around the JSON. Ignore blocks
      // that are not its measurement payload.
    }
  }
  return null;
}

export interface VideoLoudnessNormalizationPlan {
  analysisFilter: string;
  renderFilter?: string;
  status: 'analysis-required' | 'ready-for-authoritative-render';
  target: { integratedLufs: number; loudnessRangeLu: number; truePeakDbfs: number };
  note: string;
}

export function buildVideoLoudnessNormalizationPlan(
  target: Partial<VideoLoudnessNormalizationPlan['target']> = {},
  measured?: VideoLoudnormAnalysisResult | null,
): VideoLoudnessNormalizationPlan {
  const resolvedTarget = {
    integratedLufs: clamp(target.integratedLufs ?? -23, -70, -5),
    loudnessRangeLu: clamp(target.loudnessRangeLu ?? 7, 1, 50),
    truePeakDbfs: clamp(target.truePeakDbfs ?? -1, -9, 0),
  };
  const prefix = `loudnorm=I=${resolvedTarget.integratedLufs}:LRA=${resolvedTarget.loudnessRangeLu}:TP=${resolvedTarget.truePeakDbfs}`;
  return {
    analysisFilter: `${prefix}:print_format=json`,
    renderFilter: measured
      ? `${prefix}:measured_I=${measured.integratedLufs}:measured_LRA=${measured.loudnessRangeLu}:measured_TP=${measured.truePeakDbfs}:measured_thresh=${measured.thresholdLufs}:offset=${measured.offsetGainDb}:linear=true`
      : undefined,
    status: measured ? 'ready-for-authoritative-render' : 'analysis-required',
    target: resolvedTarget,
    note: 'A complete offline loudnorm first pass supplies the measured second pass; realtime meters and EBU R128 summaries are editorial/delivery evidence, not a render input.',
  };
}
