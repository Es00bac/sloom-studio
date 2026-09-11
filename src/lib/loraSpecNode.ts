// LoRA Spec node: builds the `loras` JSON that FLUX LoRA models (black-forest-labs/flux-kontext-dev-lora,
// flux-dev-lora) accept. Schema (verified 2026-06-30 against the live Atlas LoraWeight schema): an array
// (max 3) of { path: string (URL/path, required), scale: number 0–4, default 1 }.
import type { NodeData } from '../types/flow';

export interface LoraEntry {
  path: string;
  scale: number;
}

export const MAX_LORA_ENTRIES = 3;
export const DEFAULT_LORA_SCALE = 1;
export const MIN_LORA_SCALE = 0;
export const MAX_LORA_SCALE = 4;

export function clampLoraScale(value: unknown): number {
  const scale = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(scale)) return DEFAULT_LORA_SCALE;
  return Math.max(MIN_LORA_SCALE, Math.min(MAX_LORA_SCALE, scale));
}

export function normalizeLoraEntries(value: unknown): LoraEntry[] {
  if (!Array.isArray(value)) return [];
  const out: LoraEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    out.push({
      path: typeof record.path === 'string' ? record.path : '',
      scale: clampLoraScale(record.scale),
    });
    if (out.length >= MAX_LORA_ENTRIES) break;
  }
  return out;
}

/** Only entries with a real path become weights the model will accept; scale is clamped to the schema range. */
export function buildLoraWeights(entries: LoraEntry[]): Array<{ path: string; scale: number }> {
  return entries
    .filter((entry) => entry.path.trim().length > 0)
    .slice(0, MAX_LORA_ENTRIES)
    .map((entry) => ({ path: entry.path.trim(), scale: clampLoraScale(entry.scale) }));
}

/** The JSON string the image node's LoRA field / Atlas `loras` body accepts, or '' when there's nothing valid. */
export function buildLoraWeightsJson(value: NodeData['loraEntries'] | unknown): string {
  const weights = buildLoraWeights(normalizeLoraEntries(value));
  return weights.length > 0 ? JSON.stringify(weights) : '';
}
