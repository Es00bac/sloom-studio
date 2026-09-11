import { describe, expect, it } from 'vitest';
import {
  createEditorStageObject,
  getEditorStageObjects,
  normalizeStageObjectBlendMode,
} from './editorStageObjects';
import type { NodeData } from '../types/flow';

describe('getEditorStageObjects', () => {
  it('normalizes text and rectangle stage objects from saved composition data', () => {
    const objects = getEditorStageObjects({
      editorStageObjects: [
        {
          id: 'text-1',
          kind: 'text',
          x: 120,
          y: 80,
          width: 420,
          height: 120,
          rotationDeg: 15,
          opacityPercent: 65,
          blendMode: 'screen',
          text: 'Title',
          fontFamily: 'Georgia',
          fontSizePx: 72,
          color: '#f8fafc',
        },
        {
          id: 'shape-1',
          kind: 'rectangle',
          x: 40,
          y: 50,
          width: 300,
          height: 180,
          rotationDeg: -8,
          opacityPercent: 50,
          fillColor: '#0ea5e9',
          borderColor: '#ffffff',
          borderWidth: 6,
          cornerRadius: 24,
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect(objects).toMatchObject([
      {
        id: 'text-1',
        kind: 'text',
        x: 120,
        blendMode: 'screen',
        text: 'Title',
        fontWeight: 400,
        fontStyle: 'normal',
      },
      {
        id: 'shape-1',
        kind: 'rectangle',
        borderWidth: 6,
        cornerRadius: 24,
      },
    ]);
  });

  it('normalizes explicit text weight and style and drops invalid values (AUD-026)', () => {
    const objects = getEditorStageObjects({
      editorStageObjects: [
        {
          id: 'text-bold',
          kind: 'text',
          text: 'Bold',
          fontWeight: 700,
          fontStyle: 'italic',
        },
        {
          id: 'text-invalid',
          kind: 'text',
          text: 'Invalid',
          fontWeight: 'heavy',
          fontStyle: 'oblique',
        },
      ],
    } as Partial<NodeData> as NodeData);

    const bold = objects.find((o) => o.id === 'text-bold');
    const invalid = objects.find((o) => o.id === 'text-invalid');

    expect(bold).toMatchObject({ fontWeight: 700, fontStyle: 'italic' });
    expect(invalid).toMatchObject({ fontWeight: 400, fontStyle: 'normal' });
  });
});

describe('createEditorStageObject', () => {
  it('creates centered text and rectangle objects using the current canvas size', () => {
    const textObject = createEditorStageObject('text', { width: 1280, height: 720 });
    const rectangleObject = createEditorStageObject('rectangle', { width: 1280, height: 720 });

    expect(textObject).toMatchObject({
      kind: 'text',
      x: 384,
      y: 300,
      width: 512,
      height: 120,
      text: 'Text',
      fontWeight: 400,
      fontStyle: 'normal',
    });
    expect(rectangleObject).toMatchObject({
      kind: 'rectangle',
      x: 448,
      y: 260,
      width: 384,
      height: 200,
      cornerRadius: 18,
    });
  });
});

describe('normalizeStageObjectBlendMode', () => {
  it('keeps supported stage object blend modes and falls back to normal', () => {
    expect(normalizeStageObjectBlendMode('color-dodge')).toBe('color-dodge');
    expect(normalizeStageObjectBlendMode('unknown')).toBe('normal');
  });
});

describe('motion-comic stage objects', () => {
  it('create -> normalize round-trips a speech bubble intact', () => {
    const created = createEditorStageObject('speech-bubble', { width: 1920, height: 1080 });
    expect(created.kind).toBe('speech-bubble');
    const normalized = getEditorStageObjects({ editorStageObjects: [created] });
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ kind: 'speech-bubble', fillColor: '#ffffff', textAlign: 'center' });
  });

  it('caption defaults: yellow box, left-aligned, no tail semantics', () => {
    const created = createEditorStageObject('caption', { width: 1920, height: 1080 });
    expect(created).toMatchObject({ kind: 'caption', fillColor: '#fef3c7', textAlign: 'left' });
    const normalized = getEditorStageObjects({ editorStageObjects: [created] });
    expect(normalized[0].kind).toBe('caption');
  });
});

  it('clamps out-of-range text weights during normalization', () => {
    const objects = getEditorStageObjects({
      editorStageObjects: [
        {
          id: 'text-heavy',
          kind: 'text',
          text: 'Heavy',
          fontWeight: 1200,
        },
        {
          id: 'text-light',
          kind: 'text',
          text: 'Light',
          fontWeight: -50,
        },
        {
          id: 'text-missing',
          kind: 'text',
          text: 'Missing',
        },
      ],
    } as Partial<NodeData> as NodeData);

    expect((objects.find((o) => o.id === 'text-heavy') as Extract<typeof objects[number], { kind: 'text' }>)?.fontWeight).toBe(1000);
    expect((objects.find((o) => o.id === 'text-light') as Extract<typeof objects[number], { kind: 'text' }>)?.fontWeight).toBe(1);
    expect((objects.find((o) => o.id === 'text-missing') as Extract<typeof objects[number], { kind: 'text' }>)?.fontWeight).toBe(400);
  });
