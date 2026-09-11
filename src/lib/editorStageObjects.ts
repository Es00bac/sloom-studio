import type {
  EditorStageBlendMode,
  EditorStageObject,
  EditorStageObjectKind,
  NodeData,
} from '../types/flow';
import { normalizeFontWeight } from './formatFontFamily';
import { normalizeBundledFontFaceState, normalizeBundledFontFaceStateForTypography } from './bundledFontLibrary';

export interface StageCanvasSize {
  width: number;
  height: number;
}

const STAGE_BLEND_MODES: EditorStageBlendMode[] = [
  'normal',
  'screen',
  'multiply',
  'overlay',
  'lighten',
  'darken',
  'color-dodge',
  'color-burn',
];

export function getEditorStageObjects(nodeData: Partial<NodeData>): EditorStageObject[] {
  const value = nodeData.editorStageObjects;

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap<EditorStageObject>((object) => {
    if (!isRecord(object) || typeof object.id !== 'string') {
      return [];
    }

    const base = {
      id: object.id,
      x: normalizeNumber(object.x, 0),
      y: normalizeNumber(object.y, 0),
      width: Math.max(8, normalizeNumber(object.width, 320)),
      height: Math.max(8, normalizeNumber(object.height, 120)),
      rotationDeg: normalizeNumber(object.rotationDeg, 0),
      opacityPercent: normalizePercent(object.opacityPercent, 100),
      blendMode: normalizeStageObjectBlendMode(object.blendMode),
    };

    if (object.kind === 'text') {
      const initialManagedFaceState = normalizeBundledFontFaceState(object.managedFace, object.managedFaceIssue);
      const fontStyle = object.fontStyle === 'italic' || (object.fontStyle === 'oblique' && initialManagedFaceState.managedFace?.style === 'oblique')
        ? object.fontStyle
        : 'normal';
      const fontFamily = typeof object.fontFamily === 'string' ? object.fontFamily : 'Inter, system-ui, sans-serif';
      const fontWeight = normalizeFontWeight(object.fontWeight);
      const managedFaceState = normalizeBundledFontFaceStateForTypography(
        object.managedFace,
        object.managedFaceIssue,
        { family: fontFamily, weight: fontWeight, style: fontStyle },
      );
      return [{
        ...base,
        kind: 'text',
        text: typeof object.text === 'string' ? object.text : 'Text',
        fontFamily,
        fontWeight,
        fontStyle,
        managedFace: managedFaceState.managedFace,
        managedFaceIssue: managedFaceState.managedFaceIssue,
        fontSizePx: Math.max(8, normalizeNumber(object.fontSizePx, 64)),
        color: normalizeColor(object.color, '#f8fafc'),
      } satisfies EditorStageObject];
    }

    if (object.kind === 'speech-bubble' || object.kind === 'thought-bubble' || object.kind === 'caption') {
      return [{
        ...base,
        kind: object.kind,
        text: typeof object.text === 'string' ? object.text : '',
        fontFamily: typeof object.fontFamily === 'string' ? object.fontFamily : 'Inter, system-ui, sans-serif',
        fontSizePx: Math.max(8, normalizeNumber(object.fontSizePx, 40)),
        textColor: normalizeColor(object.textColor, '#181b20'),
        fillColor: normalizeColor(object.fillColor, object.kind === 'caption' ? '#fef3c7' : '#ffffff'),
        strokeColor: normalizeColor(object.strokeColor, '#181b20'),
        strokeWidthPx: Math.max(0, normalizeNumber(object.strokeWidthPx, 4)),
        tailAngleDeg: normalizeNumber(object.tailAngleDeg, 115),
        tailLengthPx: Math.max(0, normalizeNumber(object.tailLengthPx, 90)),
        lineHeightPercent: Math.max(80, Math.min(240, normalizeNumber(object.lineHeightPercent, 120))),
        letterSpacingPx: Math.max(-4, Math.min(24, normalizeNumber(object.letterSpacingPx, 0))),
        textAlign: object.textAlign === 'left' || object.textAlign === 'right' ? object.textAlign : 'center',
      } satisfies EditorStageObject];
    }

    if (object.kind === 'rectangle') {
      return [{
        ...base,
        kind: 'rectangle',
        fillColor: normalizeColor(object.fillColor, '#0ea5e9'),
        borderColor: normalizeColor(object.borderColor, '#f8fafc'),
        borderWidth: Math.max(0, normalizeNumber(object.borderWidth, 2)),
        cornerRadius: Math.max(0, normalizeNumber(object.cornerRadius, 18)),
      } satisfies EditorStageObject];
    }

    return [];
  });
}

export function createEditorStageObject(
  kind: EditorStageObjectKind,
  canvas: StageCanvasSize,
): EditorStageObject {
  if (kind === 'text') {
    const width = Math.round(canvas.width * 0.4);
    const height = Math.max(80, Math.round(canvas.height * 0.1667));

    return {
      id: createStageObjectId('text'),
      kind: 'text',
      x: Math.round((canvas.width - width) / 2),
      y: Math.round((canvas.height - height) / 2),
      width,
      height,
      rotationDeg: 0,
      opacityPercent: 100,
      blendMode: 'normal',
      text: 'Text',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 400,
      fontStyle: 'normal',
      fontSizePx: 72,
      color: '#f8fafc',
    };
  }

  if (kind === 'speech-bubble' || kind === 'thought-bubble' || kind === 'caption') {
    const width = Math.round(canvas.width * (kind === 'caption' ? 0.34 : 0.3));
    const height = Math.round(canvas.height * (kind === 'caption' ? 0.12 : 0.18));

    return {
      id: createStageObjectId(kind),
      kind,
      x: Math.round(canvas.width * 0.08),
      y: Math.round(canvas.height * 0.08),
      width,
      height,
      rotationDeg: 0,
      opacityPercent: 100,
      blendMode: 'normal',
      text: kind === 'caption' ? 'MEANWHILE…' : kind === 'thought-bubble' ? 'Hmm…' : 'Speech',
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSizePx: Math.max(24, Math.round(canvas.height * 0.037)),
      textColor: '#181b20',
      fillColor: kind === 'caption' ? '#fef3c7' : '#ffffff',
      strokeColor: '#181b20',
      strokeWidthPx: 4,
      tailAngleDeg: 115,
      tailLengthPx: Math.round(canvas.height * 0.09),
      lineHeightPercent: 120,
      letterSpacingPx: 0,
      textAlign: kind === 'caption' ? 'left' : 'center',
    };
  }

  const width = Math.round(canvas.width * 0.3);
  const height = Math.round(canvas.height * 0.2778);

  return {
    id: createStageObjectId('shape'),
    kind: 'rectangle',
    x: Math.round((canvas.width - width) / 2),
    y: Math.round((canvas.height - height) / 2),
    width,
    height,
    rotationDeg: 0,
    opacityPercent: 80,
    blendMode: 'normal',
    fillColor: '#0ea5e9',
    borderColor: '#f8fafc',
    borderWidth: 2,
    cornerRadius: 18,
  };
}

export function normalizeStageObjectBlendMode(value: unknown): EditorStageBlendMode {
  return STAGE_BLEND_MODES.includes(value as EditorStageBlendMode)
    ? value as EditorStageBlendMode
    : 'normal';
}

export function getStageObjectBlendModes(): EditorStageBlendMode[] {
  return [...STAGE_BLEND_MODES];
}

function createStageObjectId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function normalizePercent(value: unknown, fallback: number): number {
  return Math.max(0, Math.min(100, normalizeNumber(value, fallback)));
}

function normalizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
