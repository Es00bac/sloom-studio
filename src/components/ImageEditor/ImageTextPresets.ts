import type {
  DocumentViewport,
  ImageLayer,
  ImageLayerEffect,
  TextLayerStyle,
} from '../../types/imageEditor';
import { docRectToScreen, type Size } from './viewport';
import {
  DEFAULT_IMAGE_TEXT_STYLE,
  normalizeImageTextStyle,
  serializeImageTextCharacterStyle,
  serializeImageTextParagraphStyle,
  serializeImageTextStylePackage,
  updateTextLayerFromStyle,
  type ImageTextCharacterStyleDescriptor,
  type ImageTextParagraphStyleDescriptor,
} from './ImageTextLayer';
import { resolveImageLayerTransformOrigin } from './ImageLayerTransform';

export type ImageTextPresetId = 'title' | 'subtitle' | 'coverTitle' | 'comicCaption' | 'comicSfx';
export type ImageTextStylePresetId = 'posterBlock' | 'editorialItalic' | 'captionSmallCaps' | 'creditLine';

export interface ImageTextPreset {
  id: ImageTextPresetId;
  label: string;
  style: Partial<TextLayerStyle>;
  effects: ImageLayerEffect[];
}

export interface ImageTextStylePreset {
  id: ImageTextStylePresetId;
  label: string;
  style: Partial<TextLayerStyle>;
}

export interface ImageTextStylePresetDescriptor {
  presetId: ImageTextStylePresetId;
  label: string;
  previewId: string;
  previewSignature: string;
  characterStyle: ImageTextCharacterStyleDescriptor;
  paragraphStyle: ImageTextParagraphStyleDescriptor;
  portability: ImageTextStylePresetPortabilityDescriptor;
}

export interface ImageTextStylePresetPortabilityDescriptor {
  status: 'portable-with-font-fallbacks';
  preserves: Array<'font-family-stack' | 'character-style' | 'paragraph-style' | 'opentype-feature-intent'>;
  caveats: string[];
}

export interface ImageTextEditOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg: number;
  transformOriginX: number;
  transformOriginY: number;
}

export const IMAGE_TEXT_PRESETS: ImageTextPreset[] = [
  {
    id: 'title',
    label: 'Title',
    style: {
      content: 'TITLE',
      fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
      fontSize: 92,
      fontWeight: '900',
      letterSpacing: 1,
      color: '#fff7d6',
      lineHeight: 0.95,
      align: 'center',
      verticalAlign: 'middle',
      warp: 'none',
    },
    effects: [
      strokeEffect('title-stroke', '#141318', 7),
      shadowEffect('title-shadow', '#000000', 0.7, 55, 14, 16),
    ],
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    style: {
      content: 'Subtitle',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 42,
      fontWeight: '700',
      letterSpacing: 0,
      color: '#e0f2fe',
      lineHeight: 1.05,
      align: 'center',
      verticalAlign: 'middle',
      warp: 'none',
    },
    effects: [
      shadowEffect('subtitle-shadow', '#020617', 0.62, 60, 8, 10),
    ],
  },
  {
    id: 'coverTitle',
    label: 'Cover',
    style: {
      content: 'COVER TITLE',
      fontFamily: 'Bebas Neue, Impact, Arial Black, sans-serif',
      fontSize: 118,
      fontWeight: '900',
      letterSpacing: 3,
      color: '#fef3c7',
      lineHeight: 0.9,
      align: 'center',
      verticalAlign: 'middle',
      warp: 'arc',
    },
    effects: [
      strokeEffect('cover-stroke', '#2f1b09', 9),
      glowEffect('cover-glow', '#f59e0b', 0.38, 18),
      shadowEffect('cover-shadow', '#000000', 0.76, 70, 18, 22),
    ],
  },
  {
    id: 'comicCaption',
    label: 'Caption',
    style: {
      content: 'Caption text',
      fontFamily: 'Comic Neue, Inter, system-ui, sans-serif',
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: 0,
      color: '#111827',
      lineHeight: 1.15,
      align: 'left',
      verticalAlign: 'top',
      boxWidth: 420,
      wrap: true,
      warp: 'none',
    },
    effects: [
      strokeEffect('caption-light-border', '#f8fafc', 3),
    ],
  },
  {
    id: 'comicSfx',
    label: 'Comic SFX',
    style: {
      content: 'KAPOW!',
      fontFamily: 'Impact, Bangers, Arial Black, sans-serif',
      fontSize: 86,
      fontWeight: '900',
      letterSpacing: 2,
      color: '#facc15',
      lineHeight: 0.92,
      align: 'center',
      verticalAlign: 'middle',
      warp: 'flag',
    },
    effects: [
      strokeEffect('sfx-black-stroke', '#111111', 8),
      strokeEffect('sfx-white-stroke', '#ffffff', 3),
      shadowEffect('sfx-shadow', '#7f1d1d', 0.7, 35, 10, 8),
    ],
  },
];

export const IMAGE_TEXT_STYLE_PRESETS: ImageTextStylePreset[] = [
  {
    id: 'posterBlock',
    label: 'Poster Block',
    style: {
      fontFamily: 'Impact, Haettenschweiler, Arial Black, sans-serif',
      fontWeight: '900',
      fontStyle: 'normal',
      fontSize: 84,
      fontKerning: 'normal',
      fontVariantCaps: 'normal',
      letterSpacing: 2,
      baselineShift: 0,
      align: 'center',
      lineHeight: 0.94,
    },
  },
  {
    id: 'editorialItalic',
    label: 'Editorial Italic',
    style: {
      fontFamily: 'Cormorant Garamond, Georgia, serif',
      fontWeight: '600',
      fontStyle: 'italic',
      fontSize: 48,
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      letterSpacing: 1,
      baselineShift: 0,
      align: 'center',
      lineHeight: 1.08,
    },
  },
  {
    id: 'captionSmallCaps',
    label: 'Caption Caps',
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: '700',
      fontStyle: 'normal',
      fontSize: 28,
      fontKerning: 'auto',
      fontVariantCaps: 'all-small-caps',
      letterSpacing: 1.5,
      baselineShift: 0,
      align: 'left',
      lineHeight: 1.18,
    },
  },
  {
    id: 'creditLine',
    label: 'Credit Line',
    style: {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: '500',
      fontStyle: 'normal',
      fontSize: 18,
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      letterSpacing: 3,
      baselineShift: 0,
      align: 'center',
      lineHeight: 1.25,
    },
  },
];

export function getImageTextPreset(id: ImageTextPresetId): ImageTextPreset {
  return IMAGE_TEXT_PRESETS.find((preset) => preset.id === id) ?? IMAGE_TEXT_PRESETS[0];
}

export function getImageTextStylePreset(id: ImageTextStylePresetId): ImageTextStylePreset {
  return IMAGE_TEXT_STYLE_PRESETS.find((preset) => preset.id === id) ?? IMAGE_TEXT_STYLE_PRESETS[0];
}

export function applyImageTextPresetToStyle(
  current: TextLayerStyle,
  presetId: ImageTextPresetId,
): Partial<TextLayerStyle> {
  const preset = getImageTextPreset(presetId);
  return {
    ...preset.style,
    content: current.content.trim() && current.content !== 'Text'
      ? current.content
      : preset.style.content,
  };
}

export function applyImageTextStylePresetToStyle(
  current: TextLayerStyle,
  presetId: ImageTextStylePresetId,
): Partial<TextLayerStyle> {
  const preset = getImageTextStylePreset(presetId);
  return {
    ...current,
    ...preset.style,
  };
}

export function buildImageTextStylePresetDescriptor(
  current: TextLayerStyle,
  presetId: ImageTextStylePresetId,
): ImageTextStylePresetDescriptor {
  const preset = getImageTextStylePreset(presetId);
  const normalizedStyle = normalizeImageTextStyle(applyImageTextStylePresetToStyle(current, presetId));
  const stylePackage = serializeImageTextStylePackage(normalizedStyle);
  const previewId = `image-text-style-preset:${preset.id}`;

  return {
    presetId: preset.id,
    label: preset.label,
    previewId,
    previewSignature: `image-text-style-preset:v1:${JSON.stringify({
      presetId: preset.id,
      label: preset.label,
      styleSignature: stylePackage.preview.signature,
    })}`,
    characterStyle: serializeImageTextCharacterStyle(normalizedStyle),
    paragraphStyle: serializeImageTextParagraphStyle(normalizedStyle),
    portability: {
      status: 'portable-with-font-fallbacks',
      preserves: ['font-family-stack', 'character-style', 'paragraph-style', 'opentype-feature-intent'],
      caveats: [
        'Preset portability depends on installed fonts; fallback family stack is retained.',
        'Native PSD editable text preset roundtrip is not supported.',
      ],
    },
  };
}

export function applyImageTextPresetToLayer(layer: ImageLayer, presetId: ImageTextPresetId): ImageLayer {
  const preset = getImageTextPreset(presetId);
  const nextLayer = updateTextLayerFromStyle(
    layer,
    applyImageTextPresetToStyle(layer.text ?? DEFAULT_IMAGE_TEXT_STYLE, presetId),
  );
  return {
    ...nextLayer,
    effects: cloneEffects(preset.effects),
  };
}

export function getImageTextEditOverlayBounds(
  layer: ImageLayer,
  viewport: DocumentViewport,
  view?: Size,
): ImageTextEditOverlayBounds | null {
  if (!layer.text || !layer.bitmap) return null;
  const rect = docRectToScreen({
    x: layer.x,
    y: layer.y,
    width: layer.bitmap.width,
    height: layer.bitmap.height,
  }, viewport, view);
  const origin = resolveImageLayerTransformOrigin(layer);

  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(36, rect.width),
    height: Math.max(24, rect.height),
    rotationDeg: layer.rotationDeg ?? 0,
    transformOriginX: origin.x,
    transformOriginY: origin.y,
  };
}

/**
 * Whether a blur out of the on-canvas text editor should be treated as transient focus loss
 * (refocus the editor) rather than a click-away commit. The pointer gesture that *places* a new
 * text layer finishes just after the editor opens and can pull focus to <body> (relatedTarget
 * null); during that brief "just opened" window we must not commit-then-discard the freshly
 * placed empty layer — that made the Type tool look completely dead. Focus landing on a real
 * control (an HTMLElement) is always a genuine blur and should commit.
 */
export function shouldRefocusTextEditorOnBlur(
  justOpened: boolean,
  nextFocusTarget: EventTarget | null,
): boolean {
  return justOpened && !(nextFocusTarget instanceof HTMLElement);
}

export function imageTextLayerContainsPoint(
  layer: ImageLayer,
  point: { x: number; y: number },
): boolean {
  if (!layer.text || !layer.bitmap) return false;
  return (
    point.x >= layer.x &&
    point.y >= layer.y &&
    point.x <= layer.x + layer.bitmap.width &&
    point.y <= layer.y + layer.bitmap.height
  );
}

function cloneEffects(effects: ImageLayerEffect[]): ImageLayerEffect[] {
  return effects.map((effect) => ({ ...effect, id: `${effect.id}-${Date.now()}-${Math.floor(Math.random() * 1000)}` }));
}

function strokeEffect(id: string, color: string, size: number): ImageLayerEffect {
  return {
    id,
    kind: 'stroke',
    enabled: true,
    color,
    opacity: 1,
    size,
    position: 'outside',
  };
}

function shadowEffect(
  id: string,
  color: string,
  opacity: number,
  angle: number,
  distance: number,
  size: number,
): ImageLayerEffect {
  return {
    id,
    kind: 'dropShadow',
    enabled: true,
    color,
    opacity,
    angle,
    distance,
    size,
  };
}

function glowEffect(id: string, color: string, opacity: number, size: number): ImageLayerEffect {
  return {
    id,
    kind: 'outerGlow',
    enabled: true,
    color,
    opacity,
    size,
  };
}
