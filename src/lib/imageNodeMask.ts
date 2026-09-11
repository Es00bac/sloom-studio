import type { ImageProvider, NodeData } from '../types/flow';
import { supportsTrueMaskInpaint } from './imageModelSupport';

interface ResolveImageNodeMaskInputOptions {
  connectedMaskInput?: string;
  nodeData: NodeData;
}

export function normalizeMaskDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) ? trimmed : undefined;
}

export function canUsePaintedMaskForNode(nodeData: NodeData): boolean {
  const provider = (nodeData.provider as ImageProvider | undefined) ?? 'gemini';
  const modelId = typeof nodeData.modelId === 'string' ? nodeData.modelId : undefined;
  return supportsTrueMaskInpaint(provider, modelId);
}

export function resolveImageNodeMaskInput({
  connectedMaskInput,
  nodeData,
}: ResolveImageNodeMaskInputOptions): string | undefined {
  const connected = normalizeMaskDataUrl(connectedMaskInput);
  if (connected) {
    return connected;
  }

  if (!canUsePaintedMaskForNode(nodeData)) {
    return undefined;
  }

  return normalizeMaskDataUrl(nodeData.imagePaintedMaskDataUrl);
}
