// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { EditorAsset, EditorStageObject } from '../types/flow';
import {
  buildVisualClipFromEditorAsset,
  createComicDefaults,
  createEditorAsset,
  getEditorAssets,
  getProjectEditorAssets,
  migrateStageObjectsToEditorAssets,
} from './editorAssets';
import { getEditorVisualClips } from './manualEditorState';
import { renderTextCard } from './mediaComposition';
import type { NodeData } from '../types/flow';

describe('createEditorAsset', () => {
  it('creates reusable text and shape editor assets with stable defaults', () => {
    const text = createEditorAsset('text', { label: 'Lower third' });
    const shape = createEditorAsset('shape', { label: 'Box' });

    expect(text.kind).toBe('text');
    expect(text.label).toBe('Lower third');
    expect(text.textDefaults?.text).toBe('Text');
    expect(text.textDefaults?.fontWeight).toBe(400);
    expect(text.textDefaults?.fontStyle).toBe('normal');
    expect(shape.kind).toBe('shape');
    expect(shape.shapeDefaults?.shape).toBe('rectangle');
  });
});

describe('text asset typography (AUD-026)', () => {
  it('normalizes text defaults weight/style and drops invalid values', () => {
    const assets = getEditorAssets({
      editorAssets: [
        {
          id: 'text-1',
          kind: 'text',
          label: 'Title',
          createdAt: 1,
          updatedAt: 1,
          textDefaults: {
            text: 'Title',
            fontFamily: 'Inter',
            fontWeight: 700,
            fontStyle: 'italic',
            fontSizePx: 64,
            color: '#fff',
            textEffect: 'shadow',
            textBackgroundOpacityPercent: 0,
          },
        } as unknown as EditorAsset,
        {
          id: 'text-2',
          kind: 'text',
          label: 'Bad',
          createdAt: 1,
          updatedAt: 1,
          textDefaults: {
            text: 'Bad',
            fontFamily: 'Inter',
            fontWeight: 'heavy',
            fontStyle: 'oblique',
            fontSizePx: 64,
            color: '#fff',
            textEffect: 'shadow',
            textBackgroundOpacityPercent: 0,
          },
        } as unknown as EditorAsset,
      ],
    });

    expect(assets[0].textDefaults).toMatchObject({ fontWeight: 700, fontStyle: 'italic' });
    expect(assets[1].textDefaults).toMatchObject({ fontWeight: 400, fontStyle: 'normal' });
  });

  it('migrates stage text objects into text assets and clips carrying weight/style', () => {
    const object: EditorStageObject = {
      id: 'stage-text-1',
      kind: 'text',
      text: 'Hello',
      fontFamily: 'M PLUS 1',
      fontWeight: 700,
      fontStyle: 'italic',
      fontSizePx: 72,
      color: '#f8fafc',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      rotationDeg: 0,
      opacityPercent: 100,
      blendMode: 'normal',
    };

    const { assets, clips } = migrateStageObjectsToEditorAssets([object], { durationSeconds: 4, trackIndex: 0 });

    expect(assets[0].textDefaults).toMatchObject({ fontWeight: 700, fontStyle: 'italic' });
    expect(clips[0].textTypography).toMatchObject({ fontWeight: 700, fontStyle: 'italic' });
  });
});

describe('getEditorAssets', () => {
  it('normalizes unknown data and preserves valid assets', () => {
    const assets = getEditorAssets({
      editorAssets: [
        { id: 'bad' } as EditorAsset,
        createEditorAsset('text', { id: 'title-1', label: 'Title' }),
      ],
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]?.id).toBe('title-1');
  });
});

describe('getProjectEditorAssets', () => {
  it('surfaces saved source-bin images as editor assets', () => {
    const textAsset = createEditorAsset('text', { id: 'title-1', label: 'Title' });
    const assets = getProjectEditorAssets([textAsset], [
      {
        id: 'source-image-1',
        label: 'Generated frame',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'blob:generated-frame',
        createdAt: 10,
      },
      {
        id: 'source-video-1',
        label: 'Generated clip',
        kind: 'video',
        mimeType: 'video/mp4',
        assetUrl: 'blob:generated-clip',
        createdAt: 20,
      },
    ]);

    expect(assets).toEqual([
      textAsset,
      {
        id: 'asset-source-source-image-1',
        kind: 'image',
        label: 'Generated frame',
        createdAt: 10,
        updatedAt: 10,
        imageSourceId: 'source-image-1',
      },
    ]);
  });

  it('does not duplicate source-bin images already represented by explicit editor assets', () => {
    const imageAsset = createEditorAsset('image', {
      id: 'asset-image-1',
      label: 'Imported image',
      imageSourceId: 'source-image-1',
      createdAt: 30,
    });
    const assets = getProjectEditorAssets([imageAsset], [
      {
        id: 'source-image-1',
        label: 'Imported image',
        kind: 'image',
        mimeType: 'image/png',
        assetUrl: 'blob:imported-image',
        createdAt: 10,
      },
    ]);

    expect(assets).toEqual([imageAsset]);
  });

  it('surfaces saved source-bin text as editor assets', () => {
    const assets = getProjectEditorAssets([], [
      {
        id: 'source-text-1',
        label: 'Generated caption',
        kind: 'text',
        text: 'Generated caption text',
        createdAt: 40,
      },
    ]);

    expect(assets).toEqual([
      expect.objectContaining({
        id: 'asset-source-source-text-1',
        kind: 'text',
        label: 'Generated caption',
        createdAt: 40,
        updatedAt: 40,
        textDefaults: expect.objectContaining({
          text: 'Generated caption text',
        }),
      }),
    ]);
  });
});

describe('migrateStageObjectsToEditorAssets', () => {
  it('turns old stage text and rectangles into editor assets and timeline clips', () => {
    const oldObjects: EditorStageObject[] = [
      {
        id: 'stage-text',
        kind: 'text',
        x: 100,
        y: 80,
        width: 420,
        height: 120,
        rotationDeg: 5,
        opacityPercent: 75,
        blendMode: 'normal',
        text: 'Hello',
        fontFamily: 'Inter',
        fontSizePx: 64,
        color: '#ffffff',
      },
      {
        id: 'stage-rect',
        kind: 'rectangle',
        x: 20,
        y: 30,
        width: 320,
        height: 180,
        rotationDeg: 0,
        opacityPercent: 60,
        blendMode: 'screen',
        fillColor: '#0ea5e9',
        borderColor: '#ffffff',
        borderWidth: 2,
        cornerRadius: 12,
      },
    ];

    const migrated = migrateStageObjectsToEditorAssets(oldObjects, {
      durationSeconds: 4,
      trackIndex: 0,
    });

    expect(migrated.assets.map((asset) => asset.kind)).toEqual(['text', 'shape']);
    expect(migrated.clips).toHaveLength(2);
    expect(migrated.clips[0]).toMatchObject({
      sourceNodeId: 'asset-stage-text',
      sourceKind: 'text',
      positionX: 100,
      positionY: 80,
      opacityPercent: 75,
    });
    expect(migrated.clips[1]).toMatchObject({
      sourceNodeId: 'asset-stage-rect',
      sourceKind: 'shape',
      opacityPercent: 60,
    });
  });

  it('migrates legacy comic stage objects into comic assets and clips (styling 1:1)', () => {
    const migrated = migrateStageObjectsToEditorAssets([
      {
        id: 'stage-bubble',
        kind: 'speech-bubble',
        x: 40,
        y: 60,
        width: 300,
        height: 160,
        rotationDeg: 0,
        opacityPercent: 90,
        blendMode: 'normal',
        text: 'Look out!',
        fontFamily: 'Inter',
        fontSizePx: 28,
        textColor: '#111111',
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidthPx: 3,
        tailAngleDeg: 120,
        tailLengthPx: 46,
        lineHeightPercent: 120,
        letterSpacingPx: 0.5,
        textAlign: 'center',
      },
    ], { durationSeconds: 4, trackIndex: 0 });

    expect(migrated.assets).toHaveLength(1);
    expect(migrated.assets[0]).toMatchObject({
      kind: 'comic',
      label: 'Look out!',
      comicDefaults: expect.objectContaining({
        comicKind: 'speech-bubble',
        tailAngleDeg: 120,
        textAlign: 'center',
      }),
    });
    expect(migrated.clips[0]).toMatchObject({
      sourceNodeId: 'asset-stage-bubble',
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      comicTailAngleDeg: 120,
      comicTailLengthPx: 46,
      textContent: 'Look out!',
      shapeFillColor: '#ffffff',
      shapeBorderColor: '#000000',
      positionX: 40,
      positionY: 60,
      opacityPercent: 90,
    });
  });

  it('returns an empty migration for already migrated projects', () => {
    const migrated = migrateStageObjectsToEditorAssets([], { durationSeconds: 4, trackIndex: 0 });

    expect(migrated.assets).toEqual([]);
    expect(migrated.clips).toEqual([]);
  });
});

describe('text asset typography normalization (AUD-026)', () => {
  it('clamps out-of-range text weights during normalization', () => {
    const assets = getEditorAssets({
      editorAssets: [
        {
          id: 'text-heavy',
          kind: 'text',
          label: 'Heavy',
          createdAt: 1,
          updatedAt: 1,
          textDefaults: {
            text: 'Heavy',
            fontFamily: 'Inter',
            fontWeight: 1200,
            fontStyle: 'normal',
            fontSizePx: 64,
            color: '#fff',
            textEffect: 'shadow',
            textBackgroundOpacityPercent: 0,
          },
        } as unknown as EditorAsset,
        {
          id: 'text-light',
          kind: 'text',
          label: 'Light',
          createdAt: 1,
          updatedAt: 1,
          textDefaults: {
            text: 'Light',
            fontFamily: 'Inter',
            fontWeight: -100,
            fontStyle: 'normal',
            fontSizePx: 64,
            color: '#fff',
            textEffect: 'shadow',
            textBackgroundOpacityPercent: 0,
          },
        } as unknown as EditorAsset,
      ],
    });

    expect(assets[0].textDefaults?.fontWeight).toBe(1000);
    expect(assets[1].textDefaults?.fontWeight).toBe(1);
  });
});

class ExportTestContext {
  font = '';
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  shadowColor = '';
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  textAlign = 'left';
  textBaseline = 'alphabetic';
  fontKerning: string | undefined;
  letterSpacing: string | undefined;

  measureText() {
    return { width: 50 };
  }

  fillText() {}
  strokeText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
}

class ExportTestCanvas {
  context = new ExportTestContext();
  width = 0;
  height = 0;

  getContext() {
    return this.context;
  }

  toDataURL() {
    return 'data:image/png;base64,stub';
  }
}

describe('buildVisualClipFromEditorAsset persistence and export boundaries', () => {
  it('copies text asset weight/style into clip typography', () => {
    const asset = createEditorAsset('text', { label: 'Title' });
    asset.textDefaults = {
      ...asset.textDefaults!,
      fontFamily: 'M PLUS 1, sans-serif',
      fontWeight: 700,
      fontStyle: 'italic',
    };

    const clip = buildVisualClipFromEditorAsset(asset, { trackIndex: 1, startMs: 250 });

    expect(clip.textFontFamily).toBe('M PLUS 1, sans-serif');
    expect(clip.textTypography).toEqual({ fontWeight: 700, fontStyle: 'italic' });
  });

  it('survives persisted-data normalization through getEditorVisualClips', () => {
    const asset = createEditorAsset('text', { label: 'Title' });
    asset.textDefaults = {
      ...asset.textDefaults!,
      fontFamily: 'Source Sans 3, sans-serif',
      fontWeight: 600,
      fontStyle: 'italic',
    };

    const clip = buildVisualClipFromEditorAsset(asset, { trackIndex: 0, startMs: 0 });
    const normalized = getEditorVisualClips({
      editorVisualClips: [clip],
    } as Partial<NodeData> as NodeData);

    expect(normalized[0].textFontFamily).toBe('Source Sans 3, sans-serif');
    expect(normalized[0].textTypography).toEqual({ fontWeight: 600, fontStyle: 'italic' });
  });

  it('is consumed by the text-clip export card with family/weight/style intact', async () => {
    const asset = createEditorAsset('text', { label: 'Title' });
    asset.textDefaults = {
      ...asset.textDefaults!,
      fontFamily: 'M PLUS 1, sans-serif',
      fontWeight: 700,
      fontStyle: 'italic',
    };

    const clip = buildVisualClipFromEditorAsset(asset, { trackIndex: 0, startMs: 0 });
    const normalized = getEditorVisualClips({
      editorVisualClips: [clip],
    } as Partial<NodeData> as NodeData)[0];

    const canvas = new ExportTestCanvas();
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement);

    await renderTextCard({
      text: normalized.textContent ?? 'Text',
      fontFamily: normalized.textFontFamily,
      fontSizePx: normalized.textSizePx,
      color: normalized.textColor,
      effect: normalized.textEffect,
      opacityPercent: 100,
      typography: normalized.textTypography,
    });

    expect(canvas.context.font).toContain('italic');
    expect(canvas.context.font).toContain('700');
    expect(canvas.context.font).toContain('"M PLUS 1"');
    vi.restoreAllMocks();
  });
});

describe('reusable comic asset placement (AUD-035)', () => {
  it.each([
    {
      label: 'speech bubble',
      defaults: {
        comicKind: 'speech-bubble' as const,
        text: 'Stored speech',
        fontFamily: 'Bangers, sans-serif',
        fontSizePx: 58,
        textColor: '#102030',
        fillColor: '#fefefe',
        strokeColor: '#405060',
        strokeWidthPx: 7,
        tailAngleDeg: 142,
        tailLengthPx: 73,
        lineHeightPercent: 133,
        letterSpacingPx: 2.5,
        textAlign: 'right' as const,
      },
    },
    {
      label: 'caption with intentional empty and zero values',
      defaults: {
        comicKind: 'caption' as const,
        text: '',
        fontFamily: '',
        fontSizePx: 24,
        textColor: '#000000',
        fillColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidthPx: 0,
        tailAngleDeg: 0,
        tailLengthPx: 0,
        lineHeightPercent: 0,
        letterSpacingPx: 0,
        textAlign: 'left' as const,
      },
    },
  ])('normalizes and reapplies every stored default for a $label without mutating the asset', ({ defaults }) => {
    const [asset] = getEditorAssets({
      editorAssets: [{
        id: `saved-${defaults.comicKind}`,
        kind: 'comic',
        label: 'Saved comic',
        createdAt: 10,
        updatedAt: 20,
        comicDefaults: defaults,
      }],
    });
    const beforePlacement = structuredClone(asset);

    const first = buildVisualClipFromEditorAsset(asset, {
      trackIndex: 0,
      startMs: 0,
      durationSeconds: 0,
    });
    const second = buildVisualClipFromEditorAsset(asset, {
      trackIndex: 3,
      startMs: 8750,
      durationSeconds: 6,
    });
    const expectedComicProjection = {
      sourceNodeId: asset.id,
      sourceKind: 'comic',
      comicKind: defaults.comicKind,
      comicTailAngleDeg: defaults.tailAngleDeg,
      comicTailLengthPx: defaults.tailLengthPx,
      comicLineHeightPercent: defaults.lineHeightPercent,
      comicLetterSpacingPx: defaults.letterSpacingPx,
      comicTextAlign: defaults.textAlign,
      textContent: defaults.text,
      textFontFamily: defaults.fontFamily,
      textSizePx: defaults.fontSizePx,
      textColor: defaults.textColor,
      shapeFillColor: defaults.fillColor,
      shapeBorderColor: defaults.strokeColor,
      shapeBorderWidth: defaults.strokeWidthPx,
    };

    expect(asset.comicDefaults).toEqual(defaults);
    expect(first).toMatchObject({
      ...expectedComicProjection,
      trackIndex: 0,
      startMs: 0,
      durationSeconds: 0,
      reversePlayback: false,
    });
    expect(second).toMatchObject({
      ...expectedComicProjection,
      trackIndex: 3,
      startMs: 8750,
      durationSeconds: 6,
      reversePlayback: false,
    });
    expect(second.id).not.toBe(first.id);
    expect(asset).toEqual(beforePlacement);
  });

  it('keeps a legacy comic asset with absent defaults and applies the declared speech defaults', () => {
    const [asset] = getEditorAssets({
      editorAssets: [{
        id: 'legacy-comic',
        kind: 'comic',
        label: 'Legacy comic',
        createdAt: 1,
        updatedAt: 2,
      } as EditorAsset],
    });

    expect(asset).toMatchObject({
      id: 'legacy-comic',
      kind: 'comic',
      comicDefaults: createComicDefaults('speech-bubble'),
    });
    expect(buildVisualClipFromEditorAsset(asset, { trackIndex: 2, startMs: 400 })).toMatchObject({
      sourceKind: 'comic',
      comicKind: 'speech-bubble',
      textContent: 'Speech',
      textColor: '#181b20',
      shapeFillColor: '#ffffff',
      shapeBorderColor: '#181b20',
      shapeBorderWidth: 6,
      comicTailAngleDeg: 115,
      comicTailLengthPx: 90,
    });
  });
});
