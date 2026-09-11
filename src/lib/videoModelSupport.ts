import type { SelectOption, VideoTargetHandle } from '../types/flow';
import { getVideoModelSupport } from './modelContracts/videoModelContracts';

const GEMINI_VIDEO_MODEL_ALIASES = new Map<string, string>([
  ['gemini-omni', 'gemini-omni-flash-preview'],
  ['gemini-omni-flash', 'gemini-omni-flash-preview'],
  ['veo-3.1', 'veo-3.1-generate-preview'],
  ['veo-3.1-preview', 'veo-3.1-generate-preview'],
  ['veo-3.1-fast', 'veo-3.1-fast-generate-preview'],
  ['veo-3.1-fast-preview', 'veo-3.1-fast-generate-preview'],
  ['veo-3.1-lite', 'veo-3.1-lite-generate-preview'],
  ['veo-3.1-lite-preview', 'veo-3.1-lite-generate-preview'],
  ['veo-3', 'veo-3.0-generate-001'],
  ['veo-3-preview', 'veo-3.0-generate-001'],
  ['veo-3-generate-preview', 'veo-3.0-generate-001'],
  ['veo-3-fast', 'veo-3.0-fast-generate-001'],
  ['veo-3-fast-preview', 'veo-3.0-fast-generate-001'],
  ['veo-3-fast-generate-preview', 'veo-3.0-fast-generate-001'],
]);

export function normalizeGeminiVideoModelId(modelId: string | undefined): string {
  const trimmed = (modelId ?? '').trim();

  if (!trimmed) {
    return '';
  }

  return GEMINI_VIDEO_MODEL_ALIASES.get(trimmed.toLowerCase()) ?? trimmed;
}

export function isGeminiOmniModelId(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId).toLowerCase();
  return normalized.startsWith('gemini-') && normalized.includes('omni');
}

export function supportsGeminiImageToVideo(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId);
  return Boolean(normalized) && getVideoModelSupport('gemini', normalized).imageToVideo;
}

export function supportsGeminiFrameConditioning(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId);
  return Boolean(normalized) && getVideoModelSupport('gemini', normalized).interpolation;
}

export function supportsGeminiReferenceImages(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId);
  return Boolean(normalized) && getVideoModelSupport('gemini', normalized).referenceImages;
}

export function supportsGeminiVideoExtension(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId);
  return Boolean(normalized) && getVideoModelSupport('gemini', normalized).videoExtension;
}

export function supportsGeminiAdvancedVideoConditioning(modelId: string | undefined): boolean {
  const normalized = normalizeGeminiVideoModelId(modelId);
  return supportsGeminiFrameConditioning(normalized) || supportsGeminiReferenceImages(normalized) || supportsGeminiVideoExtension(normalized);
}

export function filterGeminiVideoModelsForConditioning(options: SelectOption[]): SelectOption[] {
  return options.filter((option) => supportsGeminiAdvancedVideoConditioning(option.value));
}

export function isExplicitVideoFrameHandle(
  handle: VideoTargetHandle | string | undefined,
): handle is Exclude<VideoTargetHandle, 'video-prompt'> {
  return handle === 'video-start-frame' || handle === 'video-end-frame';
}

export function isVideoReferenceHandle(
  handle: VideoTargetHandle | string | undefined,
): handle is Extract<VideoTargetHandle, 'video-reference-1' | 'video-reference-2' | 'video-reference-3'> {
  return handle === 'video-reference-1' || handle === 'video-reference-2' || handle === 'video-reference-3';
}

export function isVideoImageConditioningHandle(
  handle: VideoTargetHandle | string | undefined,
): handle is Exclude<VideoTargetHandle, 'video-prompt' | 'video-source-video'> {
  return isExplicitVideoFrameHandle(handle) || isVideoReferenceHandle(handle);
}

export function isVideoExtensionHandle(
  handle: VideoTargetHandle | string | undefined,
): handle is Extract<VideoTargetHandle, 'video-source-video'> {
  return handle === 'video-source-video';
}
