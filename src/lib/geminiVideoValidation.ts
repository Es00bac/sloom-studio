import type { AspectRatio, VideoResolution } from '../types/flow';
import { NonRetryableError } from './exponentialBackoff';
import {
  supportsGeminiFrameConditioning,
  supportsGeminiImageToVideo,
  supportsGeminiReferenceImages,
  supportsGeminiVideoExtension,
} from './videoModelSupport';

interface GeminiVideoValidationInput {
  aspectRatio: AspectRatio;
  durationSeconds: number;
  videoResolution: VideoResolution;
  modelId: string;
  promptProvided: boolean;
  hasStartImage: boolean;
  hasEndImage: boolean;
  referenceImageCount: number;
  hasExtensionVideo: boolean;
}

export function validateGeminiVideoRequest(input: GeminiVideoValidationInput): void {
  if (input.aspectRatio === '1:1') {
    throw new NonRetryableError('Gemini Veo currently supports 16:9 or 9:16 output, not 1:1.');
  }

  if (input.referenceImageCount > 3) {
    throw new NonRetryableError('Gemini Veo supports up to three reference images per request.');
  }

  if ((input.videoResolution === '1080p' || input.videoResolution === '4k') && input.durationSeconds !== 8) {
    throw new NonRetryableError('Gemini Veo currently supports 1080p and 4k output only for 8-second videos.');
  }

  if (input.hasEndImage && !input.hasStartImage) {
    throw new NonRetryableError('Gemini Veo interpolation requires a start frame when an end frame is provided.');
  }

  if (input.referenceImageCount > 0 && (input.hasStartImage || input.hasEndImage || input.hasExtensionVideo)) {
    throw new NonRetryableError('Gemini Veo reference-image guidance cannot be combined with start/end frames or video extension in the same request.');
  }

  if (input.hasExtensionVideo && (input.hasStartImage || input.hasEndImage)) {
    throw new NonRetryableError('Gemini Veo video extension cannot be combined with start/end-frame image inputs.');
  }

  if (!input.promptProvided && !input.hasStartImage && !input.hasExtensionVideo) {
    throw new NonRetryableError('Gemini Veo needs either a prompt, a start image, or an extension video.');
  }

  if (input.referenceImageCount > 0 && !input.promptProvided) {
    throw new NonRetryableError('Gemini Veo reference-image guidance still requires a text prompt.');
  }

  if (input.hasStartImage && input.hasEndImage && input.durationSeconds !== 8) {
    throw new NonRetryableError('Gemini Veo interpolation currently requires an 8-second duration when both start and end frames are provided.');
  }

  if (input.hasExtensionVideo && input.durationSeconds !== 8) {
    throw new NonRetryableError('Gemini Veo video extension currently requires an 8-second duration.');
  }

  if (input.hasExtensionVideo && input.videoResolution !== '720p') {
    throw new NonRetryableError('Gemini Veo video extension currently supports 720p output only.');
  }

  if (input.referenceImageCount > 0 && input.durationSeconds !== 8) {
    throw new NonRetryableError('Gemini Veo reference-image guidance currently requires an 8-second duration.');
  }

  if (input.hasEndImage && !supportsGeminiFrameConditioning(input.modelId)) {
    throw new NonRetryableError('Start/end-frame video generation currently requires Veo 3.1 or Veo 3.1 Fast.');
  }

  if (input.hasStartImage && !supportsGeminiImageToVideo(input.modelId)) {
    throw new NonRetryableError('The selected Gemini video model does not currently support image-to-video generation.');
  }

  if (input.referenceImageCount > 0 && !supportsGeminiReferenceImages(input.modelId)) {
    throw new NonRetryableError('Reference-image guidance currently requires Veo 3.1 or Veo 3.1 Fast.');
  }

  if (input.hasExtensionVideo && !supportsGeminiVideoExtension(input.modelId)) {
    throw new NonRetryableError('Video extension currently requires Veo 3.1 or Veo 3.1 Fast.');
  }
}
