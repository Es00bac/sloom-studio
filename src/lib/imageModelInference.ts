import type {
  FirstClassImageProviderId,
  ImageModelCapabilities,
  ImageModelOperation,
  ImageNodeVisibleControl,
} from './imageProviderCapabilities';

export interface InferredImageModel {
  /** Slug-based inference is a UI fallback, never provider capability evidence. */
  confidence: 'unverified';
  label: string;
  capabilities: ImageModelCapabilities;
  supportedOperations: ImageModelOperation[];
  visibleControls: ImageNodeVisibleControl[];
}

const BASE_CAPS: ImageModelCapabilities = {
  textToImage: false, imageToImage: false, promptEdit: false, maskInpaint: false,
  outpaint: false, erase: false, searchReplace: false, searchRecolor: false,
  removeBackground: false, replaceBackgroundRelight: false, upscale: false,
  referenceImages: false, maxReferenceImages: 0, exactColorControl: false,
  typography: false, textInImageEditing: false, localEndpoint: false,
  customDimensions: false,
};

interface VendorHint {
  match: RegExp;
  maxReferenceImages?: number;
  typography?: boolean;
  textInImageEditing?: boolean;
  maskInpaint?: boolean;
  exactColorControl?: boolean;
  /** Model takes an arbitrary `size`/`width`×`height` rather than fixed aspect-ratio presets. */
  customDimensions?: boolean;
}

// Per-vendor capability hints. `find` returns the FIRST match, so MORE-SPECIFIC patterns come first
// (`flux-2` before `flux`, `nano-banana-pro` before `nano-banana`, `seedream-v4+` before `seedream`).
// Reference maxima are the array `maxItems` verified live against each model's Atlas OpenAPI schema
// (`static.atlascloud.ai/model/schema/*`, 2026-06-28) — NOT guesses — so cards expose what the model
// actually accepts instead of the conservative default. `customDimensions` marks `size`-based models
// (arbitrary W×H) vs aspect-ratio-preset models (nano-banana, grok, imagen) which take `aspect_ratio`.
const VENDOR_HINTS: VendorHint[] = [
  // Black Forest Labs FLUX.2 — multi-reference editing, `images[]` up to 8 (flux-2-pro/edit, flux-2-flex/edit).
  { match: /flux-?2/, maxReferenceImages: 8, typography: true, textInImageEditing: true, exactColorControl: true, customDimensions: true },
  // FLUX Kontext (incl. -lora) — up to 4 reference images.
  { match: /kontext/, maxReferenceImages: 4, typography: true, textInImageEditing: true, exactColorControl: true, customDimensions: true },
  // FLUX.1 (schnell/dev/dev-lora) — generation/inpaint only, no multi-reference; arbitrary size.
  { match: /flux/, typography: true, exactColorControl: true, customDimensions: true },
  // Google nano-banana — aspect-ratio presets (no arbitrary size). Pro=10, v2/v3=14 reference images.
  { match: /nano-banana-pro/, maxReferenceImages: 10, typography: true, textInImageEditing: true },
  { match: /nano-banana/, maxReferenceImages: 14, typography: true, textInImageEditing: true },
  // Google Imagen — aspect-ratio presets, generation-focused.
  { match: /imagen/, customDimensions: false },
  // ByteDance Seedream v4+ — `images[]` up to 10; v5.0-lite edit = 2.
  { match: /seedream-v(?:[4-9]|\d\d)/, maxReferenceImages: 10, textInImageEditing: true, customDimensions: true },
  { match: /seedream/, maxReferenceImages: 2, customDimensions: true },
  // Alibaba Qwen image — edit-plus / 2.0-pro accept up to 3 reference images.
  { match: /qwen/, maxReferenceImages: 3, typography: true, textInImageEditing: true, maskInpaint: true, customDimensions: true },
  // OpenAI GPT Image — 1.5/edit up to 10, 1/edit up to 4 (+ alpha mask). Use the broad upper bound.
  { match: /gpt-image-1(?:[./]|-mini|$)/, maxReferenceImages: 4, textInImageEditing: true, maskInpaint: true, customDimensions: true },
  { match: /gpt-image/, maxReferenceImages: 10, typography: true, textInImageEditing: true, maskInpaint: true, customDimensions: true },
  // Microsoft MAI Image — single source image edit (no multi-reference array).
  { match: /mai-image/, typography: true, textInImageEditing: true, customDimensions: true },
  // Alibaba Wan image — pro/image-edit `images[]` up to 9.
  { match: /wan-?2/, maxReferenceImages: 9, textInImageEditing: true, customDimensions: true },
  // xAI Grok Imagine — `image_urls[]` up to 8 (aspect-ratio presets + resolution tier).
  { match: /grok-imagine/, maxReferenceImages: 8 },
  // Youchuan v8.1 — blend/style-transfer accept up to 5 images.
  { match: /youchuan/, maxReferenceImages: 5, customDimensions: true },
];

interface SlugOperation {
  operations: ImageModelOperation[];
  isEdit: boolean;
  hasReferences: boolean;
  mask: boolean;
  outpaint: boolean;
  removeBackground: boolean;
  upscale: boolean;
}

function operationFromSlug(id: string): SlugOperation {
  const base = {
    operations: ['text-to-image'] as ImageModelOperation[],
    isEdit: false, hasReferences: false, mask: false, outpaint: false, removeBackground: false, upscale: false,
  };
  const rawSeg = id.split('/').pop() ?? id;
  // Strip variant/tier/date suffixes so the operation keyword is visible:
  // `edit-developer`, `edit-sequential`, `text-to-image-max`, `edit-plus-20251215`, …
  const seg = rawSeg
    .replace(/-\d{6,}$/, '')
    .replace(/-(developer|preview|fast|turbo|hd|max|plus|ultra|lite|pro|sequential|mini|flash|\d+(?:\.\d+)?b)$/g, '')
    .replace(/-(developer|preview|fast|turbo|hd|max|plus|ultra|lite|pro|sequential|mini|flash)$/g, '');

  if (/reference-to-image/.test(seg)) return { ...base, operations: ['image-edit'], isEdit: true, hasReferences: true };
  if (/(^|[-/])(inpaint|fill)$/.test(seg)) return { ...base, operations: ['mask-inpaint'], isEdit: true, mask: true };
  if (/outpaint/.test(seg)) return { ...base, operations: ['outpaint'], isEdit: true, outpaint: true };
  if (/remove-background/.test(seg)) return { ...base, operations: ['remove-background'], isEdit: true, removeBackground: true };
  if (/upscale/.test(seg)) return { ...base, operations: ['upscale'], isEdit: true, upscale: true };
  // Reference-style multi-image edits (blend/style-transfer/image-to-image as well as plain edit).
  if (/(^|[-/])(edit|image-edit|blend|style-transfer|image-to-image)$/.test(seg)) {
    return { ...base, operations: ['image-edit'], isEdit: true };
  }
  return base;
}

function deriveControls(caps: ImageModelCapabilities, isEdit: boolean): ImageNodeVisibleControl[] {
  const controls: ImageNodeVisibleControl[] = ['prompt'];
  if (!isEdit) controls.push('aspectRatio', 'steps', 'seed');
  if (caps.customDimensions) controls.push('dimensions');
  if (caps.imageToImage || caps.promptEdit || caps.maskInpaint) controls.push('sourceImage');
  if (caps.maskInpaint) controls.push('mask');
  if (caps.referenceImages) controls.push('referenceImages');
  if (caps.outpaint) controls.push('outpaintMargins');
  if (caps.exactColorControl) controls.push('exactColorPrompt');
  if (caps.textInImageEditing) controls.push('textEditPrompt');
  controls.push('outputFormat');
  return controls;
}

function prettyLabel(modelId: string): string {
  const parts = modelId.split('/').filter(Boolean);
  const titled = parts.map((p) => p.replace(/[-_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
  return titled.join(' · ') || modelId;
}

export function inferImageModelCapabilities(
  _provider: FirstClassImageProviderId,
  modelId: string,
): InferredImageModel {
  const id = modelId.trim().toLowerCase();
  const op = operationFromSlug(id);
  const hint = VENDOR_HINTS.find((h) => h.match.test(id));
  const refMax = hint?.maxReferenceImages ?? 0;

  const capabilities: ImageModelCapabilities = { ...BASE_CAPS };
  if (op.isEdit) {
    capabilities.imageToImage = true;
    capabilities.promptEdit = true;
  } else {
    capabilities.textToImage = true;
  }
  if (op.mask) capabilities.maskInpaint = true;
  if (op.outpaint) capabilities.outpaint = true;
  if (op.removeBackground) capabilities.removeBackground = true;
  if (op.upscale) capabilities.upscale = true;

  if (op.hasReferences || (op.isEdit && refMax > 0)) {
    capabilities.referenceImages = true;
    capabilities.maxReferenceImages = Math.max(1, refMax || 1);
  }

  if (hint) {
    if (hint.typography) capabilities.typography = true;
    if (hint.textInImageEditing && op.isEdit) capabilities.textInImageEditing = true;
    if (hint.exactColorControl) capabilities.exactColorControl = true;
    if (hint.maskInpaint && op.isEdit && !op.outpaint) capabilities.maskInpaint = true;
    // `customDimensions` is meaningful for any operation that produces an image (generation or edit).
    if (hint.customDimensions) capabilities.customDimensions = true;
  }

  const operations = new Set<ImageModelOperation>(op.operations);
  if (capabilities.maskInpaint && !operations.has('mask-inpaint')) operations.add('mask-inpaint');

  return {
    confidence: 'unverified',
    label: prettyLabel(modelId),
    capabilities,
    supportedOperations: [...operations],
    visibleControls: deriveControls(capabilities, op.isEdit),
  };
}
