import type { SourceBinState, SourceBinLibraryItem } from '../store/sourceBinStore';
import type { PaperDocument, PaperFrame } from '../types/paper';
import {
  runGenerativeFill,
  type GenerativeFillProvider,
  type GenerativeFillRequest,
  type GenerativeFillResult,
} from './imageEditorAi';

export interface PaperImageQuickEditTarget {
  pageId: string;
  frameId: string;
  frame: PaperFrame;
  sourceItem: SourceBinLibraryItem;
  sourceUrl: string;
}

export interface PreparePaperImageQuickEditRequest {
  document: PaperDocument;
  pageId: string;
  frameId: string;
  sourceItems: readonly SourceBinLibraryItem[];
  prompt: string;
  provider: GenerativeFillProvider;
  model?: string;
  abortSignal?: AbortSignal;
}

export interface PreparedPaperImageQuickEdit {
  target: PaperImageQuickEditTarget;
  sourceItem: Parameters<SourceBinState['addAssetItem']>[0];
  modelUsed: string;
  approximateCostUsd?: number;
}

export interface PaperImageQuickEditDependencies {
  fetchImageBlob: (sourceUrl: string, signal?: AbortSignal) => Promise<Blob>;
  getImageDimensions: (blob: Blob) => Promise<{ width: number; height: number }>;
  buildFullImageMaskBlob: (dimensions: { width: number; height: number }) => Promise<Blob>;
  runGenerativeFill: (request: GenerativeFillRequest) => Promise<GenerativeFillResult>;
  blobToDataUrl: (blob: Blob) => Promise<string>;
  now: () => number;
}

export function resolvePaperImageQuickEditTarget({
  document,
  frameId,
  pageId,
  sourceItems,
}: Pick<PreparePaperImageQuickEditRequest, 'document' | 'frameId' | 'pageId' | 'sourceItems'>): PaperImageQuickEditTarget {
  const page = document.pages.find((candidate) => candidate.id === pageId);
  if (!page) throw new Error('The selected Paper page no longer exists.');

  const frame = page.frames.find((candidate) => candidate.id === frameId);
  if (!frame) throw new Error('The selected Paper frame no longer exists.');
  if (frame.kind !== 'image' && frame.asset?.kind !== 'image') {
    throw new Error('Quick image edit is only available for image frames.');
  }

  const sourceItem = sourceItems.find((item) => item.id === frame.asset?.sourceBinItemId);
  if (!sourceItem || sourceItem.kind !== 'image') {
    throw new Error('The selected Paper image is not linked to an image Source Library asset.');
  }

  const sourceUrl = sourceItem.assetUrl;
  if (!sourceUrl) {
    throw new Error('The selected Paper image has no editable bitmap URL.');
  }

  return { pageId, frameId, frame, sourceItem, sourceUrl };
}

export async function preparePaperImageQuickEdit(
  request: PreparePaperImageQuickEditRequest,
  dependencies: Partial<PaperImageQuickEditDependencies> = {},
): Promise<PreparedPaperImageQuickEdit> {
  const deps = { ...defaultPaperImageQuickEditDependencies, ...dependencies };
  const target = resolvePaperImageQuickEditTarget(request);
  const source = await deps.fetchImageBlob(target.sourceUrl, request.abortSignal);
  const sourceDimensions = await deps.getImageDimensions(source);
  const mask = await deps.buildFullImageMaskBlob(sourceDimensions);
  const result = await deps.runGenerativeFill({
    source,
    mask,
    prompt: buildPaperImageQuickEditPrompt(request.prompt),
    provider: request.provider,
    model: request.model,
    abortSignal: request.abortSignal,
  });
  const resultDimensions = await deps.getImageDimensions(result.png);
  const dataUrl = await deps.blobToDataUrl(result.png);
  const timestamp = deps.now();

  return {
    target,
    sourceItem: {
      label: buildPaperImageQuickEditLabel(target.sourceItem.label || target.frame.label, request.prompt),
      kind: 'image',
      mimeType: 'image/png',
      dataUrl,
      pixelWidth: resultDimensions.width,
      pixelHeight: resultDimensions.height,
      sourceKey: `paper-quick-edit:${target.frameId}:${target.sourceItem.id}:${timestamp}`,
      originNodeId: 'paper-image-quick-edit',
    },
    modelUsed: result.modelUsed,
    approximateCostUsd: result.approximateCostUsd,
  };
}

export function buildPaperImageQuickEditPrompt(prompt: string): string {
  const cleanPrompt = normalizePromptSnippet(prompt, 360);
  if (!cleanPrompt) {
    throw new Error('Describe the image edit before running quick edit.');
  }
  return [
    'Edit the entire source image according to this instruction:',
    cleanPrompt,
    'Preserve composition, identity, style, panel continuity, lighting, perspective, and readable text unless the instruction explicitly changes them.',
  ].join(' ');
}

export function buildPaperImageQuickEditLabel(originalLabel: string, prompt: string): string {
  const base = stripImageExtension(originalLabel.trim() || 'Paper image');
  const snippet = normalizePromptSnippet(prompt, 36) || 'prompt';
  const label = `${base} quick edit - ${snippet}.png`;
  return label.length <= 84 ? label : `${label.slice(0, 80).trimEnd()}.png`;
}

const defaultPaperImageQuickEditDependencies: PaperImageQuickEditDependencies = {
  fetchImageBlob: async (sourceUrl, signal) => {
    const response = await fetch(sourceUrl, { signal });
    if (!response.ok) {
      throw new Error(`Could not load the Paper image for quick edit (${response.status}).`);
    }
    return response.blob();
  },
  getImageDimensions: async (blob) => {
    const image = await createImageBitmap(blob);
    const dimensions = { width: image.width, height: image.height };
    image.close();
    return dimensions;
  },
  buildFullImageMaskBlob: async ({ width, height }) => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Failed to create the Paper quick-edit mask.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    return canvas.convertToBlob({ type: 'image/png' });
  },
  runGenerativeFill,
  blobToDataUrl,
  now: () => Date.now(),
};

function stripImageExtension(label: string): string {
  return label.replace(/\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i, '');
}

function normalizePromptSnippet(prompt: string, maxLength: number): string {
  const ascii = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w .,'"-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (ascii.length <= maxLength) return ascii;
  return ascii.slice(0, maxLength).trimEnd();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read edited Paper image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not encode edited Paper image.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}
