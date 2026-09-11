import {
  normalizeVisualKeyframes,
} from './editorKeyframes';
import type { EditorVisualClip } from '../types/flow';

export const VISUAL_CLIP_PROPERTY_OPTIONS = [
  {
    key: 'position',
    label: 'Position',
    description: 'Canvas X and Y placement',
  },
  {
    key: 'scale',
    label: 'Size',
    description: 'Clip zoom / scale percentage',
  },
  {
    key: 'rotation',
    label: 'Rotation',
    description: 'Clip angle in degrees',
  },
  {
    key: 'opacity',
    label: 'Transparency',
    description: 'Clip opacity / fade value',
  },
] as const;

export type VisualClipCopiedProperty = typeof VISUAL_CLIP_PROPERTY_OPTIONS[number]['key'];

export type VisualClipPasteTarget = 'start' | 'end';

export interface VisualClipPropertyClipboard {
  sourceClipId: string;
  sourceLabel?: string;
  properties: VisualClipCopiedProperty[];
  values: {
    position?: { x: number; y: number };
    scalePercent?: number;
    rotationDeg?: number;
    opacityPercent?: number;
  };
}

export function copyVisualClipProperties(
  clip: EditorVisualClip,
  selectedProperties: VisualClipCopiedProperty[],
  sourceLabel?: string,
): VisualClipPropertyClipboard {
  const properties = normalizeCopiedProperties(selectedProperties);
  const values: VisualClipPropertyClipboard['values'] = {};

  if (properties.includes('position')) {
    values.position = {
      x: clip.positionX,
      y: clip.positionY,
    };
  }

  if (properties.includes('scale')) {
    values.scalePercent = clip.scalePercent;
  }

  if (properties.includes('rotation')) {
    values.rotationDeg = clip.rotationDeg;
  }

  if (properties.includes('opacity')) {
    values.opacityPercent = clip.opacityPercent;
  }

  return {
    sourceClipId: clip.id,
    sourceLabel,
    properties,
    values,
  };
}

export function pasteVisualClipProperties(
  clip: EditorVisualClip,
  clipboard: VisualClipPropertyClipboard,
  target: VisualClipPasteTarget,
): Partial<EditorVisualClip> {
  const keyframes = normalizeVisualKeyframes(clip);
  const targetIndex = target === 'start' ? 0 : keyframes.length - 1;

  if (!keyframes[targetIndex]) {
    return {};
  }

  const nextKeyframes = keyframes.map((keyframe, index) => {
    if (index !== targetIndex) {
      return keyframe;
    }

    const nextKeyframe = { ...keyframe };

    if (clipboard.properties.includes('position') && clipboard.values.position) {
      nextKeyframe.positionX = clipboard.values.position.x;
      nextKeyframe.positionY = clipboard.values.position.y;
    }

    if (clipboard.properties.includes('scale') && typeof clipboard.values.scalePercent === 'number') {
      nextKeyframe.scalePercent = clipboard.values.scalePercent;
    }

    if (clipboard.properties.includes('rotation') && typeof clipboard.values.rotationDeg === 'number') {
      nextKeyframe.rotationDeg = clipboard.values.rotationDeg;
    }

    if (clipboard.properties.includes('opacity') && typeof clipboard.values.opacityPercent === 'number') {
      nextKeyframe.opacityPercent = clipboard.values.opacityPercent;
    }

    return nextKeyframe;
  });

  return { keyframes: nextKeyframes };
}

export function getDefaultVisualClipPropertySelection(): VisualClipCopiedProperty[] {
  return VISUAL_CLIP_PROPERTY_OPTIONS.map((option) => option.key);
}

export function formatVisualClipPropertyList(properties: VisualClipCopiedProperty[]): string {
  const labels = VISUAL_CLIP_PROPERTY_OPTIONS
    .filter((option) => properties.includes(option.key))
    .map((option) => option.label.toLowerCase());

  return labels.length > 0 ? labels.join(', ') : 'no properties';
}

function normalizeCopiedProperties(properties: VisualClipCopiedProperty[]): VisualClipCopiedProperty[] {
  const validKeys = new Set<VisualClipCopiedProperty>(VISUAL_CLIP_PROPERTY_OPTIONS.map((option) => option.key));
  const normalized: VisualClipCopiedProperty[] = [];

  for (const property of properties) {
    if (!validKeys.has(property) || normalized.includes(property)) {
      continue;
    }

    normalized.push(property);
  }

  return normalized;
}
