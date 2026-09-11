import type { VideoReferenceType } from '../types/flow';
import { NonRetryableError } from './exponentialBackoff';

/**
 * AUD-011 canonical numbered reference-group model.
 *
 * Image and Video generation expose numbered `Reference N` handles that accept one image-like
 * connection plus any number of textual/JSON guidance connections. The runtime used to flatten
 * the images into an ordered URL list and pour the guidance into the global prompt, destroying
 * the slot association ("preserve logo" belongs to Reference 1's shirt art, not to the request
 * as a whole). This module is the single bounded representation of that association; the store
 * resolves authored edges into it, the execution fingerprint hashes it, provider adapters
 * serialize it, and the backend-proxy DTO transports it.
 */
export interface FlowReferenceGroup {
  /** 1-based numbered slot: `Reference N` as the user sees it. */
  slot: number;
  /** The slot's single permitted image (its connection group allows at most one), if connected. */
  imageUrl?: string;
  /** Ordered textual guidance authored onto this numbered slot. */
  descriptions: string[];
  /** Ordered JSON guidance, deterministically serialized (sorted object keys). */
  jsonGuidance: string[];
  /** Video slots carry the authored asset/style reference type; image slots omit it. */
  referenceType?: VideoReferenceType;
}

export const IMAGE_REFERENCE_SLOT_COUNT = 14;

export const VIDEO_REFERENCE_HANDLES = [
  'video-reference-1',
  'video-reference-2',
  'video-reference-3',
] as const;

const IMAGE_REFERENCE_HANDLE_PATTERN = /^image-reference-(\d+)$/;
const VIDEO_REFERENCE_HANDLE_PATTERN = /^video-reference-([1-3])$/;

/** Maps a numbered reference target handle to its 1-based slot for the node type that owns it. */
export function referenceSlotNumberForHandle(
  nodeType: string | undefined,
  targetHandle: string | null | undefined,
): number | undefined {
  if (!targetHandle) return undefined;
  if (nodeType === 'imageGen') {
    const match = IMAGE_REFERENCE_HANDLE_PATTERN.exec(targetHandle);
    if (!match) return undefined;
    const slot = Number(match[1]);
    return Number.isInteger(slot) && slot >= 1 && slot <= IMAGE_REFERENCE_SLOT_COUNT ? slot : undefined;
  }
  if (nodeType === 'videoGen') {
    const match = VIDEO_REFERENCE_HANDLE_PATTERN.exec(targetHandle);
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

export function referenceGroupHasGuidance(group: FlowReferenceGroup): boolean {
  return group.descriptions.length > 0 || group.jsonGuidance.length > 0;
}

/**
 * Deterministic JSON guidance serialization: object keys are sorted recursively so the same
 * authored guidance always yields the same bytes (stable fingerprints, stable provider prompts),
 * and no string coercion path can produce `[object Object]`. A string input is treated as JSON
 * source when it parses; otherwise it travels verbatim.
 */
export function stableReferenceGuidanceJson(value: unknown): string {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return value;
    }
  }
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object') {
      return entry === undefined ? null : entry;
    }
    if (Array.isArray(entry)) {
      return entry.map(normalize);
    }
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
  };
  return JSON.stringify(normalize(source));
}

function formatGuidanceEntries(group: FlowReferenceGroup): string {
  return [
    ...group.descriptions,
    ...group.jsonGuidance.map((json) => `JSON guidance: ${json}`),
  ].join(' | ');
}

/**
 * Adjacency serialization for multimodal-part providers (Gemini/Vertex `parts`, Omni media
 * `instruction`): the returned text is placed immediately before the group's own image so the
 * association is explicit and positional at the same time.
 */
export function formatReferenceGroupInstruction(group: FlowReferenceGroup): string {
  const typeLabel = group.referenceType ? ` (${group.referenceType} reference)` : '';
  return `Reference ${group.slot}${typeLabel}: ${formatGuidanceEntries(group)}`;
}

/**
 * Prompt-block serialization for providers whose only text channel is the prompt itself
 * (OpenAI images.edit, Atlas native, BFL, Local/Open, Veo). Each line names the visible
 * `Reference N` slot and the provable position of its image in the request's ordered image
 * sequence, so association survives even a single-string transport.
 */
export function buildReferenceGuidancePromptBlock(
  groups: readonly FlowReferenceGroup[],
  imagePositionLabel: (group: FlowReferenceGroup, imageOrdinal: number) => string | undefined,
): string | undefined {
  let imageOrdinal = 0;
  const lines: string[] = [];
  for (const group of groups) {
    const ordinal = group.imageUrl ? ++imageOrdinal : imageOrdinal;
    if (!referenceGroupHasGuidance(group)) continue;
    const position = group.imageUrl ? imagePositionLabel(group, ordinal) : undefined;
    lines.push(`Reference ${group.slot}${position ? ` (${position})` : ''}: ${formatGuidanceEntries(group)}`);
  }
  if (lines.length === 0) return undefined;
  return `REFERENCE IMAGE GUIDANCE:\n${lines.join('\n')}`;
}

export function appendReferenceGuidanceBlockToPrompt(prompt: string, block: string | undefined): string {
  const trimmed = prompt.trim();
  if (!block) return prompt;
  if (!trimmed) return prompt;
  return `${trimmed}\n\n${block}`;
}

/** Backend-proxy DTO bounds. Generous for real authored guidance, hard against runaway payloads. */
export const PROXY_REFERENCE_GROUP_LIMITS = {
  maxGroups: IMAGE_REFERENCE_SLOT_COUNT,
  maxGuidanceEntriesPerSlot: 16,
  maxDescriptionLength: 20_000,
  maxJsonLength: 65_536,
  maxJsonDepth: 16,
} as const;

function jsonDepth(value: unknown, depth = 1): number {
  if (value === null || typeof value !== 'object') return depth;
  const nested = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  let max = depth;
  for (const entry of nested) {
    max = Math.max(max, jsonDepth(entry, depth + 1));
    if (max > PROXY_REFERENCE_GROUP_LIMITS.maxJsonDepth) return max;
  }
  return max;
}

function rejectProxyGroups(reason: string): never {
  throw new NonRetryableError(`Backend proxy reference groups were rejected before submission: ${reason}`);
}

/**
 * Rebuilds `referenceGroups` for the backend-proxy execution DTO from an explicit allowlist —
 * never by copying the incoming objects — so a stray or credential-shaped key can never reach
 * the wire, and bounds every count, string, and JSON depth BEFORE any network or provider work.
 * Returns undefined when the context carries no groups; throws a non-retryable diagnostic on
 * any malformed or oversized payload.
 */
export function sanitizeReferenceGroupsForProxy(value: unknown): FlowReferenceGroup[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) rejectProxyGroups('the value is not an array');
  if (value.length > PROXY_REFERENCE_GROUP_LIMITS.maxGroups) {
    rejectProxyGroups(`more than ${PROXY_REFERENCE_GROUP_LIMITS.maxGroups} numbered slots`);
  }

  let previousSlot = 0;
  const sanitized: FlowReferenceGroup[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      rejectProxyGroups('a group entry is not an object');
    }
    const record = entry as Record<string, unknown>;
    const slot = record.slot;
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 1 || slot > IMAGE_REFERENCE_SLOT_COUNT) {
      rejectProxyGroups('a slot number is out of range');
    }
    if (slot <= previousSlot) rejectProxyGroups('slot numbers must be strictly ascending');
    previousSlot = slot;

    const imageUrl = record.imageUrl;
    if (imageUrl !== undefined && typeof imageUrl !== 'string') {
      rejectProxyGroups(`Reference ${slot} carries a non-string image`);
    }

    const descriptions = record.descriptions;
    const jsonGuidance = record.jsonGuidance;
    if (!Array.isArray(descriptions) || !Array.isArray(jsonGuidance)) {
      rejectProxyGroups(`Reference ${slot} guidance lists are malformed`);
    }
    if (descriptions.length + jsonGuidance.length > PROXY_REFERENCE_GROUP_LIMITS.maxGuidanceEntriesPerSlot) {
      rejectProxyGroups(`Reference ${slot} exceeds ${PROXY_REFERENCE_GROUP_LIMITS.maxGuidanceEntriesPerSlot} guidance entries`);
    }
    for (const description of descriptions) {
      if (typeof description !== 'string' || description.length > PROXY_REFERENCE_GROUP_LIMITS.maxDescriptionLength) {
        rejectProxyGroups(`Reference ${slot} has an invalid or oversized description`);
      }
    }
    for (const json of jsonGuidance) {
      if (typeof json !== 'string' || json.length > PROXY_REFERENCE_GROUP_LIMITS.maxJsonLength) {
        rejectProxyGroups(`Reference ${slot} has an invalid or oversized JSON guidance entry`);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        rejectProxyGroups(`Reference ${slot} JSON guidance is not valid JSON`);
      }
      if (jsonDepth(parsed) > PROXY_REFERENCE_GROUP_LIMITS.maxJsonDepth) {
        rejectProxyGroups(`Reference ${slot} JSON guidance nests deeper than ${PROXY_REFERENCE_GROUP_LIMITS.maxJsonDepth} levels`);
      }
    }

    const referenceType = record.referenceType;
    if (referenceType !== undefined && referenceType !== 'asset' && referenceType !== 'style') {
      rejectProxyGroups(`Reference ${slot} has an unknown reference type`);
    }

    sanitized.push({
      slot,
      ...(typeof imageUrl === 'string' ? { imageUrl } : {}),
      descriptions: [...(descriptions as string[])],
      jsonGuidance: [...(jsonGuidance as string[])],
      ...(referenceType !== undefined ? { referenceType: referenceType as VideoReferenceType } : {}),
    });
  }

  return sanitized;
}
