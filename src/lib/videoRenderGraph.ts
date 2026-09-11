import {
  findMissingVideoCapabilities,
  type VideoProfessionalCapabilityId,
  type VideoProfessionalCapabilityProbe,
} from './videoProfessionalCapabilities';

export type VideoRenderGraphNode =
  | VideoRenderSourceNode
  | VideoRenderTransformNode
  | VideoRenderCompositeNode
  | VideoRenderAdjustmentNode
  | VideoRenderColorNode
  | VideoRenderMaskNode
  | VideoRenderRetimeNode
  | VideoRenderAudioRouteNode;

interface VideoRenderNodeBase {
  id: string;
  requiredCapabilities?: VideoProfessionalCapabilityId[];
}

export interface VideoRenderSourceNode extends VideoRenderNodeBase {
  kind: 'source';
  sourceId: string;
  streamIndex: number;
  mediaKind: 'video' | 'audio';
}

export interface VideoRenderTransformNode extends VideoRenderNodeBase {
  kind: 'transform';
  input: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
  opacity: number;
}

export interface VideoRenderCompositeNode extends VideoRenderNodeBase {
  kind: 'composite';
  base: string;
  overlay: string;
  blendMode: 'normal' | 'multiply' | 'screen' | 'overlay' | 'difference';
  opacity: number;
}

export interface VideoRenderAdjustmentNode extends VideoRenderNodeBase {
  kind: 'adjustment';
  input: string;
  scope: { startSeconds: number; endSeconds: number };
  filters: Array<{ name: string; expression: string; capability?: VideoProfessionalCapabilityId }>;
}

export interface VideoRenderColorNode extends VideoRenderNodeBase {
  kind: 'color';
  input: string;
  inputTransform?: string;
  correction?: string;
  lutPath?: string;
  outputTransform?: string;
}

export interface VideoRenderMaskNode extends VideoRenderNodeBase {
  kind: 'mask';
  input: string;
  maskId: string;
  inverted: boolean;
}

export interface VideoRenderRetimeNode extends VideoRenderNodeBase {
  kind: 'retime';
  input: string;
  rate: number;
  interpolation: 'nearest' | 'blend' | 'optical-flow';
}

export interface VideoRenderAudioRouteNode extends VideoRenderNodeBase {
  kind: 'audio-route';
  input: string;
  busId: string;
  gainDb: number;
  pan: number;
}

export interface VideoRenderGraph {
  version: 1;
  nodes: VideoRenderGraphNode[];
  outputNodeIds: string[];
}

export interface VideoRenderGraphUnavailable {
  ok: false;
  reason: string;
  errors: string[];
  missingCapabilities: Array<{ id: VideoProfessionalCapabilityId; reason: string }>;
}

export interface VideoPreviewOperation {
  nodeId: string;
  kind: VideoRenderGraphNode['kind'];
  inputs: string[];
  parameters: Record<string, unknown>;
}

export interface VideoPreviewGraphDescriptor {
  ok: true;
  graphHash: string;
  operations: VideoPreviewOperation[];
  outputNodeIds: string[];
}

export interface VideoFfmpegGraphDescriptor {
  ok: true;
  graphHash: string;
  filterComplex: string;
  outputLabels: string[];
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(',')}}`;
}

/** Stable FNV-1a hash used for preview/render cache keys. */
export function hashVideoRenderGraph(graph: VideoRenderGraph): string {
  const serialized = stableSerialize(graph);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `vrg1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function nodeInputs(node: VideoRenderGraphNode): string[] {
  switch (node.kind) {
    case 'source': return [];
    case 'composite': return [node.base, node.overlay];
    default: return [node.input];
  }
}

export function getVideoRenderNodeCapabilityRequirements(
  node: VideoRenderGraphNode,
): VideoProfessionalCapabilityId[] {
  const requirements = [...(node.requiredCapabilities ?? [])];
  if (node.kind === 'color') {
    if (node.lutPath) requirements.push('lut3d');
    if (node.inputTransform || node.outputTransform) requirements.push('zscale');
  }
  if (node.kind === 'retime' && node.interpolation === 'optical-flow') requirements.push('minterpolate');
  if (node.kind === 'adjustment') {
    for (const filter of node.filters) if (filter.capability) requirements.push(filter.capability);
  }
  return [...new Set(requirements)];
}

export function validateVideoRenderGraph(graph: VideoRenderGraph): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id.trim()) errors.push('Every render node must have a non-empty id.');
    if (nodeIds.has(node.id)) errors.push(`Duplicate render node id '${node.id}'.`);
    nodeIds.add(node.id);
    if (node.kind === 'retime' && (!Number.isFinite(node.rate) || node.rate <= 0)) {
      errors.push(`Retime node '${node.id}' must use a finite rate greater than zero.`);
    }
    if (node.kind === 'transform') {
      if (![node.x, node.y, node.rotationDegrees, node.opacity].every(Number.isFinite)
        || !Number.isFinite(node.scaleX) || !Number.isFinite(node.scaleY) || node.scaleX <= 0 || node.scaleY <= 0) {
        errors.push(`Transform node '${node.id}' requires finite values and positive scale.`);
      }
      if (node.opacity < 0 || node.opacity > 1) errors.push(`Transform node '${node.id}' opacity must be from 0 through 1.`);
    }
    if (node.kind === 'composite' && (!Number.isFinite(node.opacity) || node.opacity < 0 || node.opacity > 1)) {
      errors.push(`Composite node '${node.id}' opacity must be from 0 through 1.`);
    }
    if (node.kind === 'adjustment' && node.scope.endSeconds <= node.scope.startSeconds) {
      errors.push(`Adjustment node '${node.id}' has an empty or reversed scope.`);
    }
  }
  for (const node of graph.nodes) {
    for (const input of nodeInputs(node)) {
      if (!nodeIds.has(input)) errors.push(`Node '${node.id}' references missing input '${input}'.`);
    }
  }
  for (const output of graph.outputNodeIds) {
    if (!nodeIds.has(output)) errors.push(`Graph output '${output}' does not exist.`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push(`Render graph contains a cycle at '${id}'.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const node = byId.get(id);
    if (node) for (const input of nodeInputs(node)) visit(input);
    visiting.delete(id);
    visited.add(id);
  };
  for (const output of graph.outputNodeIds) visit(output);
  return [...new Set(errors)];
}

function orderVideoRenderNodes(graph: VideoRenderGraph): VideoRenderGraphNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered: VideoRenderGraphNode[] = [];
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    for (const input of nodeInputs(node)) visit(input);
    visited.add(id);
    ordered.push(node);
  };
  for (const output of graph.outputNodeIds) visit(output);
  return ordered;
}

function unavailableForGraph(
  graph: VideoRenderGraph,
  probe: VideoProfessionalCapabilityProbe,
): VideoRenderGraphUnavailable | undefined {
  const errors = validateVideoRenderGraph(graph);
  const requirements = graph.nodes.flatMap(getVideoRenderNodeCapabilityRequirements);
  const missing = findMissingVideoCapabilities(probe, requirements);
  if (errors.length === 0 && missing.length === 0) return undefined;
  return {
    ok: false,
    reason: errors[0] ?? missing.map(({ reason }) => reason).join(' '),
    errors,
    missingCapabilities: missing.map(({ id, reason }) => ({ id, reason })),
  };
}

export function compileVideoPreviewDescriptor(
  graph: VideoRenderGraph,
  probe: VideoProfessionalCapabilityProbe,
): VideoPreviewGraphDescriptor | VideoRenderGraphUnavailable {
  const unavailable = unavailableForGraph(graph, probe);
  if (unavailable) return unavailable;
  const operations = orderVideoRenderNodes(graph).map((node): VideoPreviewOperation => {
    const { id, kind, requiredCapabilities: _requirements, ...parameters } = node;
    return { nodeId: id, kind, inputs: nodeInputs(node), parameters };
  });
  return { ok: true, graphHash: hashVideoRenderGraph(graph), operations, outputNodeIds: [...graph.outputNodeIds] };
}

function ffmpegEscape(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
}

function cleanLabel(id: string): string {
  return `n_${id.replace(/[^a-z0-9_]/giu, '_')}`;
}

export function compileVideoFfmpegFilterGraph(
  graph: VideoRenderGraph,
  probe: VideoProfessionalCapabilityProbe,
): VideoFfmpegGraphDescriptor | VideoRenderGraphUnavailable {
  const unavailable = unavailableForGraph(graph, probe);
  if (unavailable) return unavailable;
  const filters: string[] = [];
  for (const node of orderVideoRenderNodes(graph)) {
    const output = cleanLabel(node.id);
    if (node.kind === 'source') {
      filters.push(`[${node.streamIndex}:${node.mediaKind === 'video' ? 'v' : 'a'}]${node.mediaKind === 'video' ? 'null' : 'anull'}[${output}]`);
      continue;
    }
    const inputs = nodeInputs(node).map((id) => `[${cleanLabel(id)}]`).join('');
    switch (node.kind) {
      case 'transform':
        filters.push(`${inputs}scale=iw*${node.scaleX}:ih*${node.scaleY},rotate=${node.rotationDegrees}*PI/180:c=black@0,pad=iw+${Math.abs(node.x)}:ih+${Math.abs(node.y)}:${Math.max(0, node.x)}:${Math.max(0, node.y)}:color=black@0,colorchannelmixer=aa=${node.opacity}[${output}]`);
        break;
      case 'composite':
        filters.push(`${inputs}blend=all_mode=${node.blendMode}:all_opacity=${node.opacity}[${output}]`);
        break;
      case 'adjustment': {
        const enable = `enable='between(t,${node.scope.startSeconds},${node.scope.endSeconds})'`;
        const chain = node.filters.map(({ expression }) => `${expression}:${enable}`).join(',') || 'null';
        filters.push(`${inputs}${chain}[${output}]`);
        break;
      }
      case 'color': {
        const chain = [node.inputTransform, node.correction, node.lutPath ? `lut3d=file='${ffmpegEscape(node.lutPath)}'` : undefined, node.outputTransform]
          .filter((entry): entry is string => Boolean(entry));
        filters.push(`${inputs}${chain.join(',') || 'null'}[${output}]`);
        break;
      }
      case 'mask':
        filters.push(`${inputs}[mask_${cleanLabel(node.maskId)}]alphamerge[${output}]`);
        break;
      case 'retime': {
        const interpolation = node.interpolation === 'optical-flow' ? `minterpolate=fps=source_fps/${node.rate},` : '';
        filters.push(`${inputs}${interpolation}setpts=PTS/${node.rate}[${output}]`);
        break;
      }
      case 'audio-route': {
        const right = Math.min(1, Math.max(0, (node.pan + 1) / 2));
        const left = 1 - right;
        filters.push(`${inputs}volume=${node.gainDb}dB,pan=stereo|c0=${left.toFixed(4)}*c0|c1=${right.toFixed(4)}*c1[${output}]`);
        break;
      }
    }
  }
  return {
    ok: true,
    graphHash: hashVideoRenderGraph(graph),
    filterComplex: filters.join(';'),
    outputLabels: graph.outputNodeIds.map(cleanLabel),
  };
}
