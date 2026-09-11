import type {
  EditorAsset,
  EditorComicDefaults,
  EditorAssetKind,
  EditorStageObject,
  EditorTextDefaults,
  EditorShapeDefaults,
  EditorVisualClip,
  NodeData,
  TextClipEffect,
} from '../types/flow';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { createEditorVisualClip } from './manualEditorState';
import { normalizeFontWeight } from './formatFontFamily';
import { normalizeBundledFontFaceState, normalizeBundledFontFaceStateForTypography } from './bundledFontLibrary';

export interface CreateEditorAssetOptions {
  id?: string;
  label?: string;
  imageSourceId?: string;
  createdAt?: number;
  comicKind?: 'speech-bubble' | 'thought-bubble' | 'caption';
}

export function getEditorAssets(nodeData: Partial<NodeData>): EditorAsset[] {
  const value = nodeData.editorAssets;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((asset) => normalizeEditorAsset(asset));
}

export function getProjectEditorAssets(
  editorAssets: EditorAsset[],
  sourceItems: SourceBinLibraryItem[],
): EditorAsset[] {
  const representedImageSourceIds = new Set(
    editorAssets.flatMap((asset) => (
      asset.kind === 'image' && asset.imageSourceId ? [asset.imageSourceId] : []
    )),
  );
  const existingAssetIds = new Set(editorAssets.map((asset) => asset.id));
  const sourceEditorAssets = sourceItems.flatMap<EditorAsset>((item) => {
    const assetId = `asset-source-${item.id}`;

    if (existingAssetIds.has(assetId)) {
      return [];
    }

    if (item.kind === 'text') {
      const text = item.text?.trim();

      if (!text) {
        return [];
      }

      existingAssetIds.add(assetId);
      return [{
        id: assetId,
        kind: 'text',
        label: item.label,
        createdAt: item.createdAt,
        updatedAt: item.createdAt,
        textDefaults: {
          ...createTextDefaults(),
          text,
        },
      }];
    }

    if (item.kind !== 'image' || !item.assetUrl || representedImageSourceIds.has(item.id)) {
      return [];
    }

    existingAssetIds.add(assetId);
    representedImageSourceIds.add(item.id);
    return [{
      id: assetId,
      kind: 'image',
      label: item.label,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      imageSourceId: item.id,
    }];
  });

  return [...editorAssets, ...sourceEditorAssets];
}

export function createComicDefaults(comicKind: 'speech-bubble' | 'thought-bubble' | 'caption'): EditorComicDefaults {
  return {
    comicKind,
    text: comicKind === 'caption' ? 'MEANWHILE…' : comicKind === 'thought-bubble' ? 'Hmm…' : 'Speech',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSizePx: 64,
    textColor: '#181b20',
    fillColor: comicKind === 'caption' ? '#fef3c7' : '#ffffff',
    strokeColor: '#181b20',
    strokeWidthPx: 6,
    tailAngleDeg: 115,
    tailLengthPx: 90,
    lineHeightPercent: 120,
    letterSpacingPx: 0,
    textAlign: comicKind === 'caption' ? 'left' : 'center',
  };
}

export function createEditorAsset(
  kind: EditorAssetKind,
  options: CreateEditorAssetOptions = {},
): EditorAsset {
  const now = options.createdAt ?? Date.now();
  const id = options.id ?? `asset-${kind}-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const base = {
    id,
    kind,
    label: options.label ?? defaultAssetLabel(kind),
    createdAt: now,
    updatedAt: now,
  };

  if (kind === 'text') {
    return {
      ...base,
      textDefaults: createTextDefaults(),
    };
  }

  if (kind === 'shape') {
    return {
      ...base,
      shapeDefaults: createShapeDefaults(),
    };
  }

  if (kind === 'comic') {
    return {
      ...base,
      comicDefaults: createComicDefaults(options.comicKind ?? 'speech-bubble'),
    };
  }

  return {
    ...base,
    imageSourceId: options.imageSourceId,
  };
}

export function migrateStageObjectsToEditorAssets(
  stageObjects: EditorStageObject[],
  options: { durationSeconds: number; trackIndex: number },
): { assets: EditorAsset[]; clips: EditorVisualClip[] } {
  const assets: EditorAsset[] = [];
  const clips: EditorVisualClip[] = [];

  for (const object of stageObjects) {
    const assetId = `asset-${object.id}`;
    const createdAt = Date.now();

    if (object.kind === 'text') {
      const textDefaults: EditorTextDefaults = {
        text: object.text,
        fontFamily: object.fontFamily,
        fontWeight: object.fontWeight ?? 400,
        fontStyle: object.fontStyle ?? 'normal',
        managedFace: object.managedFace,
        managedFaceIssue: object.managedFaceIssue,
        fontSizePx: object.fontSizePx,
        color: object.color,
        textEffect: 'shadow',
        textBackgroundOpacityPercent: 0,
      };

      assets.push({
        id: assetId,
        kind: 'text',
        label: object.text || 'Text',
        createdAt,
        updatedAt: createdAt,
        textDefaults,
      });
      clips.push({
        ...createEditorVisualClip(assetId, 'text', {
          trackIndex: options.trackIndex,
          durationSeconds: options.durationSeconds,
          positionX: object.x,
          positionY: object.y,
          rotationDeg: object.rotationDeg,
          opacityPercent: object.opacityPercent,
          textContent: textDefaults.text,
          textFontFamily: textDefaults.fontFamily,
          textSizePx: textDefaults.fontSizePx,
          textColor: textDefaults.color,
          textEffect: textDefaults.textEffect,
          textBackgroundOpacityPercent: textDefaults.textBackgroundOpacityPercent,
          textTypography: {
            fontWeight: textDefaults.fontWeight,
            fontStyle: textDefaults.fontStyle,
            managedFace: textDefaults.managedFace,
            managedFaceIssue: textDefaults.managedFaceIssue,
          },
        }),
        id: `visual-${object.id}`,
      });
      continue;
    }

    if (object.kind === 'speech-bubble' || object.kind === 'thought-bubble' || object.kind === 'caption') {
      // Legacy motion-comic stage objects migrate into comic assets + clips, mirroring how
      // addComicStageObject creates them fresh — every styling field maps 1:1.
      const comicDefaults: EditorComicDefaults = {
        comicKind: object.kind,
        text: object.text,
        fontFamily: object.fontFamily,
        fontSizePx: object.fontSizePx,
        textColor: object.textColor,
        fillColor: object.fillColor,
        strokeColor: object.strokeColor,
        strokeWidthPx: object.strokeWidthPx,
        tailAngleDeg: object.tailAngleDeg,
        tailLengthPx: object.tailLengthPx,
        lineHeightPercent: object.lineHeightPercent,
        letterSpacingPx: object.letterSpacingPx,
        textAlign: object.textAlign,
      };

      assets.push({
        id: assetId,
        kind: 'comic',
        label: object.text
          || (object.kind === 'thought-bubble' ? 'Thought Bubble' : object.kind === 'caption' ? 'Caption' : 'Speech Bubble'),
        createdAt,
        updatedAt: createdAt,
        comicDefaults,
      });
      clips.push({
        ...createEditorVisualClip(assetId, 'comic', {
          trackIndex: options.trackIndex,
          durationSeconds: options.durationSeconds,
          positionX: object.x,
          positionY: object.y,
          rotationDeg: object.rotationDeg,
          opacityPercent: object.opacityPercent,
          comicKind: object.kind,
          comicTailAngleDeg: object.tailAngleDeg,
          comicTailLengthPx: object.tailLengthPx,
          comicLineHeightPercent: object.lineHeightPercent,
          comicLetterSpacingPx: object.letterSpacingPx,
          comicTextAlign: object.textAlign,
          textContent: object.text,
          textFontFamily: object.fontFamily,
          textSizePx: object.fontSizePx,
          textColor: object.textColor,
          shapeFillColor: object.fillColor,
          shapeBorderColor: object.strokeColor,
          shapeBorderWidth: object.strokeWidthPx,
        }),
        id: `visual-${object.id}`,
      });
      continue;
    }

    if (object.kind !== 'rectangle') {
      continue;
    }

    const shapeDefaults: EditorShapeDefaults = {
      shape: 'rectangle',
      fillColor: object.fillColor,
      borderColor: object.borderColor,
      borderWidth: object.borderWidth,
      cornerRadius: object.cornerRadius,
    };

    assets.push({
      id: assetId,
      kind: 'shape',
      label: 'Rectangle',
      createdAt,
      updatedAt: createdAt,
      shapeDefaults,
    });
    clips.push({
      ...createEditorVisualClip(assetId, 'shape', {
        trackIndex: options.trackIndex,
        durationSeconds: options.durationSeconds,
        positionX: object.x,
        positionY: object.y,
        rotationDeg: object.rotationDeg,
        opacityPercent: object.opacityPercent,
        shapeFillColor: shapeDefaults.fillColor,
        shapeBorderColor: shapeDefaults.borderColor,
        shapeBorderWidth: shapeDefaults.borderWidth,
        shapeCornerRadius: shapeDefaults.cornerRadius,
      }),
      id: `visual-${object.id}`,
    });
  }

  return { assets, clips };
}

export function buildVisualClipFromEditorAsset(
  asset: EditorAsset,
  options: { trackIndex: number; startMs: number; durationSeconds?: number },
): EditorVisualClip {
  const sourceKind =
    asset.kind === 'shape'
      ? 'shape'
      : asset.kind === 'image'
        ? 'image'
        : asset.kind === 'comic'
          ? 'comic'
          : 'text';
  const sourceNodeId = asset.kind === 'image' ? asset.imageSourceId ?? asset.id : asset.id;
  const assetDefaults = projectEditorAssetDefaultsToVisualClip(asset);

  return createEditorVisualClip(sourceNodeId, sourceKind, {
    ...assetDefaults,
    trackIndex: options.trackIndex,
    startMs: options.startMs,
    durationSeconds: options.durationSeconds ?? 4,
  });
}

/**
 * Project reusable asset defaults onto a fresh timeline clip. Keep this mapping in one place so
 * every placement/re-placement route receives the same saved styling, while caller-owned placement
 * coordinates and duration remain authoritative in `buildVisualClipFromEditorAsset`.
 */
function projectEditorAssetDefaultsToVisualClip(asset: EditorAsset): Partial<EditorVisualClip> {
  if (asset.kind === 'text' && asset.textDefaults) {
    return {
      textContent: asset.textDefaults.text,
      textFontFamily: asset.textDefaults.fontFamily,
      textSizePx: asset.textDefaults.fontSizePx,
      textColor: asset.textDefaults.color,
      textEffect: asset.textDefaults.textEffect,
      textBackgroundOpacityPercent: asset.textDefaults.textBackgroundOpacityPercent,
      textTypography: {
        fontWeight: asset.textDefaults.fontWeight,
        fontStyle: asset.textDefaults.fontStyle,
        managedFace: asset.textDefaults.managedFace,
        managedFaceIssue: asset.textDefaults.managedFaceIssue,
      },
    };
  }

  if (asset.kind === 'shape' && asset.shapeDefaults) {
    return {
      shapeFillColor: asset.shapeDefaults.fillColor,
      shapeBorderColor: asset.shapeDefaults.borderColor,
      shapeBorderWidth: asset.shapeDefaults.borderWidth,
      shapeCornerRadius: asset.shapeDefaults.cornerRadius,
    };
  }

  if (asset.kind === 'comic' && asset.comicDefaults) {
    return {
      comicKind: asset.comicDefaults.comicKind,
      comicTailAngleDeg: asset.comicDefaults.tailAngleDeg,
      comicTailLengthPx: asset.comicDefaults.tailLengthPx,
      comicLineHeightPercent: asset.comicDefaults.lineHeightPercent,
      comicLetterSpacingPx: asset.comicDefaults.letterSpacingPx,
      comicTextAlign: asset.comicDefaults.textAlign,
      textContent: asset.comicDefaults.text,
      textFontFamily: asset.comicDefaults.fontFamily,
      textSizePx: asset.comicDefaults.fontSizePx,
      textColor: asset.comicDefaults.textColor,
      shapeFillColor: asset.comicDefaults.fillColor,
      shapeBorderColor: asset.comicDefaults.strokeColor,
      shapeBorderWidth: asset.comicDefaults.strokeWidthPx,
    };
  }

  return {};
}

function normalizeEditorAsset(value: unknown): EditorAsset[] {
  if (!isRecord(value) || typeof value.id !== 'string') {
    return [];
  }

  const createdAt = normalizeNumber(value.createdAt, Date.now());
  const updatedAt = normalizeNumber(value.updatedAt, createdAt);
  const label = typeof value.label === 'string' ? value.label : undefined;

  if (value.kind === 'text') {
    const defaults = isRecord(value.textDefaults) ? value.textDefaults : {};
    const initialManagedFaceState = normalizeBundledFontFaceState(defaults.managedFace, defaults.managedFaceIssue);
    const fontFamily = typeof defaults.fontFamily === 'string'
      ? defaults.fontFamily
      : 'Inter, system-ui, sans-serif';
    const fontWeight = normalizeFontWeight(defaults.fontWeight);
    const fontStyle = defaults.fontStyle === 'italic' || (defaults.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
      ? defaults.fontStyle
      : 'normal';
    const managedFaceState = normalizeBundledFontFaceStateForTypography(
      defaults.managedFace,
      defaults.managedFaceIssue,
      { family: fontFamily, weight: fontWeight, style: fontStyle },
    );

    return [{
      id: value.id,
      kind: 'text',
      label: label ?? 'Text',
      createdAt,
      updatedAt,
      textDefaults: {
        text: typeof defaults.text === 'string' ? defaults.text : 'Text',
        fontFamily,
        fontWeight,
        fontStyle,
        managedFace: managedFaceState.managedFace,
        managedFaceIssue: managedFaceState.managedFaceIssue,
        fontSizePx: Math.max(8, normalizeNumber(defaults.fontSizePx, 72)),
        color: normalizeColor(defaults.color, '#f8fafc'),
        textEffect: normalizeTextEffect(defaults.textEffect),
        textBackgroundOpacityPercent: normalizePercent(defaults.textBackgroundOpacityPercent, 0),
      },
    }];
  }

  if (value.kind === 'shape') {
    const defaults = isRecord(value.shapeDefaults) ? value.shapeDefaults : {};

    return [{
      id: value.id,
      kind: 'shape',
      label: label ?? 'Rectangle',
      createdAt,
      updatedAt,
      shapeDefaults: {
        shape: 'rectangle',
        fillColor: normalizeColor(defaults.fillColor, '#0ea5e9'),
        borderColor: normalizeColor(defaults.borderColor, '#f8fafc'),
        borderWidth: Math.max(0, normalizeNumber(defaults.borderWidth, 2)),
        cornerRadius: Math.max(0, normalizeNumber(defaults.cornerRadius, 18)),
      },
    }];
  }

  if (value.kind === 'comic') {
    const defaults = isRecord(value.comicDefaults) ? value.comicDefaults : {};
    const comicKind = normalizeComicKind(defaults.comicKind);
    const fallback = createComicDefaults(comicKind);

    return [{
      id: value.id,
      kind: 'comic',
      label: label ?? defaultComicAssetLabel(comicKind),
      createdAt,
      updatedAt,
      comicDefaults: {
        comicKind,
        text: typeof defaults.text === 'string' ? defaults.text : fallback.text,
        fontFamily: typeof defaults.fontFamily === 'string' ? defaults.fontFamily : fallback.fontFamily,
        fontSizePx: Math.max(8, normalizeFiniteNumber(defaults.fontSizePx, fallback.fontSizePx)),
        textColor: normalizeColor(defaults.textColor, fallback.textColor),
        fillColor: normalizeColor(defaults.fillColor, fallback.fillColor),
        strokeColor: normalizeColor(defaults.strokeColor, fallback.strokeColor),
        strokeWidthPx: Math.max(0, normalizeFiniteNumber(defaults.strokeWidthPx, fallback.strokeWidthPx)),
        tailAngleDeg: normalizeFiniteNumber(defaults.tailAngleDeg, fallback.tailAngleDeg),
        tailLengthPx: Math.max(0, normalizeFiniteNumber(defaults.tailLengthPx, fallback.tailLengthPx)),
        lineHeightPercent: Math.max(0, normalizeFiniteNumber(defaults.lineHeightPercent, fallback.lineHeightPercent)),
        letterSpacingPx: normalizeFiniteNumber(defaults.letterSpacingPx, fallback.letterSpacingPx),
        textAlign: normalizeComicTextAlign(defaults.textAlign, fallback.textAlign),
      },
    }];
  }

  if (value.kind === 'image' && typeof value.imageSourceId === 'string') {
    return [{
      id: value.id,
      kind: 'image',
      label: label ?? 'Image',
      createdAt,
      updatedAt,
      imageSourceId: value.imageSourceId,
    }];
  }

  return [];
}

function createTextDefaults(): EditorTextDefaults {
  return {
    text: 'Text',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSizePx: 72,
    color: '#f8fafc',
    textEffect: 'shadow',
    textBackgroundOpacityPercent: 0,
  };
}

function createShapeDefaults(): EditorShapeDefaults {
  return {
    shape: 'rectangle',
    fillColor: '#0ea5e9',
    borderColor: '#f8fafc',
    borderWidth: 2,
    cornerRadius: 18,
  };
}

function defaultAssetLabel(kind: EditorAssetKind): string {
  if (kind === 'comic') return 'Speech Bubble';
  return kind === 'text' ? 'Text' : kind === 'shape' ? 'Rectangle' : 'Image';
}

function defaultComicAssetLabel(kind: EditorComicDefaults['comicKind']): string {
  return kind === 'caption' ? 'Caption' : kind === 'thought-bubble' ? 'Thought Bubble' : 'Speech Bubble';
}

function normalizeComicKind(value: unknown): EditorComicDefaults['comicKind'] {
  return value === 'thought-bubble' || value === 'caption' ? value : 'speech-bubble';
}

function normalizeComicTextAlign(
  value: unknown,
  fallback: EditorComicDefaults['textAlign'],
): EditorComicDefaults['textAlign'] {
  return value === 'left' || value === 'center' || value === 'right' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizePercent(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : fallback;
}

function normalizeTextEffect(value: unknown): TextClipEffect {
  return value === 'none' || value === 'shadow' || value === 'glow' || value === 'outline'
    ? value
    : 'shadow';
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
