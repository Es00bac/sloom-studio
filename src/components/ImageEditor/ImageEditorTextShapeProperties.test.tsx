// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  DEFAULT_SHAPE_TOOL_SETTINGS,
  DEFAULT_TEXT_TOOL_SETTINGS,
  type ImageLayer,
} from '../../types/imageEditor';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { normalizeImageTextStyle, type ImageTextReadabilitySummary } from './ImageTextLayer';
import {
  PaintBucketPanel,
  ShapePanel,
  TextLayerTypographyReadinessPanel,
  TextPanel,
} from './ImageEditorTextShapeProperties';

function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

class FakeOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(): {
    drawImage: () => void;
    measureText: (text: string) => { width: number };
    fillText: () => void;
  } {
    return {
      drawImage: () => undefined,
      fillText: () => undefined,
      measureText: (text) => ({ width: text.length }),
    };
  }
}

function mockTextLayer(): ImageLayer {
  return {
    id: 'type-title',
    name: 'Title',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 1,
    mask: null,
    text: normalizeImageTextStyle({ content: 'AI driven media workflow AI', fontSize: 32 }),
    metadata: { editableText: true },
  };
}

function readReadabilityFromState(layerText: string): ImageTextReadabilitySummary {
  const words = layerText.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? [];
  const lines = layerText.split(/\r?\n/);
  const sentences = layerText.match(/[^.!?]+[.!?]+|[^.!?\s][^.!?]*$/g) ?? [];
  const sentenceCount = Math.max(1, sentences.filter((sentence) => sentence.trim().length > 0).length);
  const averageWordsPerSentence = Math.round((words.length / sentenceCount) * 100) / 100;

  return {
    characterCount: layerText.length,
    wordCount: words.length,
    sentenceCount,
    averageWordsPerSentence,
    longestLineLength: Math.max(0, ...lines.map((line) => line.length)),
  };
}

describe('TextPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      textToolSettings: {
        ...DEFAULT_TEXT_TOOL_SETTINGS,
        content: 'Existing headline',
        color: '#abcdef',
        fontWeight: '400',
        fontStyle: 'normal',
        fontKerning: 'auto',
        fontVariantCaps: 'normal',
        letterSpacing: 0,
        baselineShift: 6,
        align: 'left',
        lineHeight: 1,
      },
      shapeToolSettings: {
        ...DEFAULT_SHAPE_TOOL_SETTINGS,
        presetKind: 'rect',
        polygonSides: 6,
        starInnerRadius: 0.5,
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('applies named typography style presets to retained Text tool settings', () => {
    act(() => {
      root.render(<TextPanel />);
    });

    const editorialPreset = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Editorial Italic');

    expect(editorialPreset).toBeDefined();

    act(() => {
      editorialPreset?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useImageEditorStore.getState().textToolSettings).toMatchObject({
      content: 'Existing headline',
      color: '#abcdef',
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
    });
  });

  it('persists Text tool standard font stacks and OpenType feature toggles', () => {
    act(() => {
      root.render(<TextPanel />);
    });

    const fontStack = container.querySelector<HTMLSelectElement>('select[aria-label="Text tool font stack"]');
    const discretionaryLigatures = container.querySelector<HTMLInputElement>('input[aria-label="Text tool OpenType discretionary ligatures"]');
    const stylisticSet = container.querySelector<HTMLInputElement>('input[aria-label="Text tool OpenType stylistic set 1"]');

    expect(fontStack).not.toBeNull();
    expect(discretionaryLigatures).not.toBeNull();
    expect(stylisticSet).not.toBeNull();
    expect(Array.from(fontStack!.options).map((option) => option.textContent)).toContain('Atkinson Hyperlegible');

    act(() => {
      setInputValue(fontStack!, 'Atkinson Hyperlegible, Inter, sans-serif');
    });

    expect(useImageEditorStore.getState().textToolSettings.fontFamily).toBe(
      'Atkinson Hyperlegible, Inter, sans-serif',
    );

    act(() => {
      discretionaryLigatures!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useImageEditorStore.getState().textToolSettings.openTypeFeatures).toEqual({
      enabled: ['dlig'],
      disabled: [],
      unsupported: [],
    });

    act(() => {
      stylisticSet!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(useImageEditorStore.getState().textToolSettings.openTypeFeatures).toEqual({
      enabled: ['dlig', 'ss01'],
      disabled: [],
      unsupported: [],
    });
  });

  it('summarizes Text tool placement readiness, fallback font discovery, and PSD caveats', () => {
    useImageEditorStore.setState({
      textToolSettings: {
        ...DEFAULT_TEXT_TOOL_SETTINGS,
        content: 'Poster title',
        fontFamily: 'Poster Font, Inter, sans-serif',
        baselineShift: 12,
        fontKerning: 'none',
        openTypeFeatures: {
          enabled: ['ss01'],
          disabled: ['liga'],
          unsupported: [],
        },
      },
    });

    act(() => {
      root.render(<TextPanel />);
    });

    expect(container.textContent).toContain('On-canvas text placement keeps retained metadata and generates a raster preview.');
    expect(container.textContent).toContain('Installed font fallback');
    expect(container.textContent).toContain('Poster Font');
    expect(container.textContent).toContain('Inter, sans-serif');
    expect(container.textContent).toContain('Kerning none');
    expect(container.textContent).toContain('Baseline 12px');
    expect(container.textContent).toContain('OpenType intent liga, ss01');
    expect(container.textContent).toContain('Typography support matrix');
    expect(container.textContent).toContain('Unsupported capabilities 0');
    expect(container.textContent).toContain('the supported PSD text subset writes native editable text layers');
  });

  it('persists custom vector shape preset settings for the shape tool', () => {
    act(() => {
      root.render(<ShapePanel />);
    });

    const presetSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Shape preset"]');
    expect(presetSelect).not.toBeNull();

    act(() => {
      setInputValue(presetSelect!, 'polygon');
    });

    const polygonSides = container.querySelector<HTMLInputElement>('input[aria-label="Polygon sides"]');
    expect(polygonSides).not.toBeNull();

    act(() => {
      setInputValue(polygonSides!, '8');
    });

    expect(useImageEditorStore.getState().shapeToolSettings).toMatchObject({
      presetKind: 'polygon',
      polygonSides: 8,
      starInnerRadius: 0.5,
    });
  });

  it('exposes Paint Bucket blend mode and preserve transparency controls', () => {
    useImageEditorStore.setState({
      brushSettings: { ...DEFAULT_BRUSH_SETTINGS, opacity: 0.5, color: '#112233' },
      selectionToolSettings: {
        ...DEFAULT_SELECTION_TOOL_SETTINGS,
        paintBucketBlendMode: 'normal',
        paintBucketPreserveTransparency: false,
      },
    });

    act(() => {
      root.render(<PaintBucketPanel />);
    });

    const mode = container.querySelector<HTMLSelectElement>('select[aria-label="Paint bucket blend mode"]');
    const preserveTransparency = container.querySelector<HTMLInputElement>('#paint-bucket-preserve-transparency');

    expect(mode).not.toBeNull();
    expect(preserveTransparency).not.toBeNull();

    act(() => {
      setInputValue(mode!, 'multiply');
      preserveTransparency!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useImageEditorStore.getState().selectionToolSettings).toMatchObject({
      paintBucketBlendMode: 'multiply',
      paintBucketPreserveTransparency: true,
    });
  });
});

describe('TextLayerTypographyReadinessPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  const nonTextLayer: ImageLayer = {
    id: 'photo',
    name: 'Poster',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 1,
    mask: null,
  };

  const setTextDoc = (activeLayer = mockTextLayer()) => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas as unknown as typeof OffscreenCanvas);
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-typography', title: 'Typography', width: 900, height: 600 }),
      layers: [activeLayer, { ...nonTextLayer, id: 'photo' }],
      activeLayerId: activeLayer.id,
    };
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
    });
  };

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    setTextDoc();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders nothing when no retained text layer is selected', () => {
    useImageEditorStore.setState({
      ...useImageEditorStore.getState(),
      documents: [
        {
          ...createEmptyImageDocument({ id: 'doc-typography', title: 'Typography', width: 900, height: 600 }),
          layers: [{ ...nonTextLayer, id: 'photo' }],
          activeLayerId: 'photo',
        },
      ],
      activeDocId: 'doc-typography',
    });

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });

    expect(container.textContent).toBe('');
  });

  it('shows selected-layer readability and match preview from active-layer typography readiness', () => {
    const textLayer = mockTextLayer();
    setTextDoc(textLayer);
    const expected = readReadabilityFromState(textLayer.text?.content ?? '');

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });

    expect(container.textContent).toContain('Typography Readability');
    expect(container.textContent).toContain('Typography parity checks');
    expect(container.textContent).toContain('Find/replace planning');
    expect(container.textContent).toContain('Spellcheck/readability planning');
    expect(container.textContent).toContain('Stable signatures');
    expect(container.textContent).toContain(`Characters ${expected.characterCount}`);
    expect(container.textContent).toContain(`Words ${expected.wordCount}`);
    expect(container.textContent).toContain('Find');
    expect(container.textContent).toContain('Replace');

    const findInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography find"]');
    const replaceInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography replace"]');
    const applyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply typography find and replace"]');
    if (!findInput || !replaceInput || !applyButton) {
      throw new Error('Typography readability controls failed to render.');
    }
    expect(applyButton.disabled).toBe(true);

    act(() => {
      setInputValue(findInput!, 'AI');
      setInputValue(replaceInput!, 'Signal');
    });

    expect(container.textContent).toContain('Matches 2');
    expect(applyButton.disabled).toBe(false);
  });

  it('renders an accessible local spellcheck warning with count, words, suggestions, and caveat', () => {
    const textLayer = {
      ...mockTextLayer(),
      text: normalizeImageTextStyle({ content: 'Leylinee signal', fontSize: 32 }),
    } satisfies ImageLayer;
    setTextDoc(textLayer);

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });

    const results = container.querySelector<HTMLElement>('[aria-label="Image text spellcheck results"]');
    expect(results).not.toBeNull();
    expect(results?.getAttribute('role')).toBe('alert');
    expect(results?.getAttribute('aria-live')).toBe('polite');
    expect(container.textContent).toContain('Local dictionary spellcheck');
    expect(container.textContent).toContain('Misspellings 1');
    expect(container.textContent).toContain('Leylinee');
    expect(container.textContent).toContain('Suggestions leyline');
    expect(container.textContent).toContain('Compact local dictionary');
  });

  it('updates spellcheck results after the normal selected-text update path without adding spellcheck history', () => {
    const textLayer = {
      ...mockTextLayer(),
      text: normalizeImageTextStyle({ content: 'Leylinee signal', fontSize: 32 }),
    } satisfies ImageLayer;
    setTextDoc(textLayer);

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });
    expect(container.textContent).toContain('Misspellings 1');
    expect(useImageEditorStore.getState().undoStacks['doc-typography']).toBeUndefined();

    act(() => {
      useImageEditorStore.getState().updateLayer('doc-typography', textLayer.id, {
        text: normalizeImageTextStyle({ content: 'signal loom', fontSize: 32 }),
      });
    });

    expect(container.textContent).toContain('Misspellings 0');
    expect(container.textContent).toContain('No misspellings found');
    expect(container.textContent).not.toContain('Leylinee');
    expect(useImageEditorStore.getState().undoStacks['doc-typography']).toBeUndefined();
  });

  it('applies selected-layer find/replace and pushes a layerOp operation', () => {
    const textLayer = mockTextLayer();
    setTextDoc(textLayer);

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });

    const findInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography find"]');
    const replaceInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography replace"]');
    const applyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply typography find and replace"]');
    if (!findInput || !replaceInput || !applyButton) {
      throw new Error('Typography readability controls failed to render.');
    }

    act(() => {
      setInputValue(findInput!, 'AI');
      setInputValue(replaceInput!, 'Signal');
      applyButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-typography');
    const updatedLayer = doc?.layers.find((layer) => layer.id === textLayer.id);
    expect(updatedLayer?.text?.content).toBe('Signal driven media workflow Signal');

    const op = useImageEditorStore.getState().undoStacks['doc-typography']?.at(-1);
    expect(op).toMatchObject({ kind: 'layerOp', docId: 'doc-typography' });
    const beforeLayer = (op as { before: Array<{ id: string; text?: { content: string } }>; after: Array<{ id: string; text?: { content: string } }> } | null)?.before?.find((layer) => layer.id === textLayer.id);
    const afterLayer = (op as { before: Array<{ id: string; text?: { content: string } }>; after: Array<{ id: string; text?: { content: string } }> } | null)?.after?.find((layer) => layer.id === textLayer.id);
    expect(beforeLayer?.text?.content).toBe('AI driven media workflow AI');
    expect(afterLayer?.text?.content).toBe('Signal driven media workflow Signal');
  });

  it('disables apply when the request has no query or no matches', () => {
    const textLayer = mockTextLayer();
    setTextDoc(textLayer);

    act(() => {
      root.render(<TextLayerTypographyReadinessPanel />);
    });

    const findInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography find"]');
    const replaceInput = container.querySelector<HTMLInputElement>('input[aria-label="Typography replace"]');
    const applyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply typography find and replace"]');
    if (!findInput || !replaceInput || !applyButton) {
      throw new Error('Typography readability controls failed to render.');
    }

    act(() => {
      setInputValue(replaceInput!, 'Signal');
    });
    expect(applyButton.disabled).toBe(true);

    act(() => {
      setInputValue(findInput!, 'missing');
    });
    expect(applyButton.disabled).toBe(true);
    expect(container.textContent).toContain('Matches 0');
  });
});
