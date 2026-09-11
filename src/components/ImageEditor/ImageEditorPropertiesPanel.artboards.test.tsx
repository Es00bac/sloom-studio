// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageEditorPropertiesPanel } from './ImageEditorPropertiesPanel';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { applyImageArtboardsMetadata } from './ImageArtboards';
import {
  DEFAULT_BRUSH_SETTINGS,
  DEFAULT_CROP_TOOL_SETTINGS,
  DEFAULT_GRADIENT_TOOL_SETTINGS,
  DEFAULT_SELECTION_TOOL_SETTINGS,
  DEFAULT_SHAPE_TOOL_SETTINGS,
  DEFAULT_TEXT_TOOL_SETTINGS,
} from '../../types/imageEditor';

class FakeHistogramContext {
  private readonly width: number;
  private readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  clearRect() {}

  getImageData(): ImageData {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.width * this.height * 4),
    } as ImageData;
  }
}

class FakeHistogramCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: FakeHistogramContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeHistogramContext(width, height);
  }

  getContext() {
    return this.context;
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('ImageEditorPropertiesPanel artboards', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeHistogramCanvas);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      tool: 'move',
      brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      gradientToolSettings: { ...DEFAULT_GRADIENT_TOOL_SETTINGS },
      shapeToolSettings: { ...DEFAULT_SHAPE_TOOL_SETTINGS },
      selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
      textToolSettings: { ...DEFAULT_TEXT_TOOL_SETTINGS },
      viewportContainerSize: { width: 0, height: 0 },
      undoStacks: {},
      redoStacks: {},
      generativeFillDismissedByDocId: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders Image-native artboard print proof controls and persists metadata edits', () => {
    useImageEditorStore.getState().openDocument(createEmptyImageDocument({
      id: 'doc-artboards-panel',
      title: 'poster.png',
      width: 2400,
      height: 3000,
    }));

    act(() => {
      root.render(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    });

    expect(container.textContent).toContain('Artboards / Print Proof');
    expect(container.textContent).toContain('Trim');
    expect(container.textContent).toContain('Blocked for export proofing until explicit artboard metadata is confirmed.');
    expect(container.textContent).toContain('Screen review proof is blocked until explicit artboard metadata is confirmed.');

    const presetSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Artboard page preset"]');
    const proofLabelInput = container.querySelector<HTMLInputElement>('input[aria-label="Artboard proof label"]');
    const bleedInput = container.querySelector<HTMLInputElement>('input[aria-label="Artboard bleed mm"]');
    const dpiInput = container.querySelector<HTMLInputElement>('input[aria-label="Artboard target DPI"]');
    const addButton = container.querySelector<HTMLButtonElement>('button[aria-label="Add artboard"]');
    const trimPngButton = container.querySelector<HTMLButtonElement>('button[aria-label="Export artboards as trim PNG"]');

    expect(presetSelect).not.toBeNull();
    expect(proofLabelInput).not.toBeNull();
    expect(bleedInput).not.toBeNull();
    expect(dpiInput).not.toBeNull();
    expect(addButton).not.toBeNull();
    expect(trimPngButton).not.toBeNull();
    expect(container.textContent).toContain('Bleed extension, ICC conversion/embedding, PDF/X, printer marks, imposition, and packages remain outside this local raster workflow.');

    act(() => {
      setSelectValue(presetSelect!, 'a4');
      setInputValue(proofLabelInput!, 'Press proof');
      setInputValue(bleedInput!, '5');
      setInputValue(dpiInput!, '350');
      addButton!.click();
    });

    const activeDoc = useImageEditorStore.getState().getActiveDocument();
    const artboards = (activeDoc?.metadata as { artboards?: { artboards?: Array<Record<string, unknown>> } } | undefined)?.artboards?.artboards ?? [];

    expect(activeDoc?.dirty).toBe(true);
    expect(artboards).toHaveLength(2);
    expect(artboards[0]).toMatchObject({
      proofLabel: 'Press proof',
      page: expect.objectContaining({
        preset: 'a4',
        bleedMm: 5,
        dpi: 350,
      }),
    });
  });

  it('surfaces page-box suitability and blocker summaries for invalid artboard bounds', () => {
    useImageEditorStore.getState().openDocument(applyImageArtboardsMetadata(createEmptyImageDocument({
      id: 'doc-artboards-panel-blockers',
      title: 'catalog.png',
      width: 1800,
      height: 2200,
    }), {
      activeArtboardId: 'cover',
      artboards: [
        {
          id: 'cover',
          name: 'Cover',
          x: -40,
          y: 30,
          width: 1600,
          height: 2100,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: 135.4667,
            heightMm: 177.8,
            bleedMm: 5,
            dpi: 300,
          },
        },
      ],
    }));

    act(() => {
      root.render(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    });

    expect(container.textContent).toContain('Media Box 1619 x 2189 px');
    expect(container.textContent).toContain('Flattened export remains possible, but Trim Box and Bleed Box blockers must be resolved first.');
    expect(container.textContent).toContain('Press proof is flagged because trim or bleed boxes fall outside the Image document.');
    expect(container.textContent).toContain('Trim Box extends outside the current Image document bounds.');
    expect(container.textContent).toContain('Bleed Box extends outside the current Image document bounds and would export clipped edges.');
    expect(container.textContent).toContain('Safe Box extends outside the current Image document bounds.');
  });

  it('surfaces deterministic filename, proof profile, and unsupported print-proof states', () => {
    useImageEditorStore.getState().openDocument(applyImageArtboardsMetadata({
      ...createEmptyImageDocument({
        id: 'doc-artboards-panel-proof-profile',
        title: 'proof.png',
        width: 1800,
        height: 2200,
      }),
      metadata: {
        colorProof: {
          mode: 'cmyk-soft-proof',
          intent: 'relative-colorimetric',
          profileLabel: 'FOGRA39',
        },
      },
    }, {
      activeArtboardId: 'cover',
      artboards: [
        {
          id: 'cover',
          name: 'Cover',
          x: 100,
          y: 100,
          width: 1200,
          height: 1600,
          proofLabel: 'Press proof',
          page: {
            preset: 'custom',
            widthMm: 101.6,
            heightMm: 135.4667,
            bleedMm: 3,
            dpi: 300,
          },
        },
      ],
    }));

    act(() => {
      root.render(<ImageEditorPropertiesPanel documentPropertiesDefaultOpen />);
    });

    expect(container.textContent).toContain('Filename policy: 01-cover-custom-300dpi-3mm-bleed');
    expect(container.textContent).toContain('Raster bounds: trim 1200 x 1600 px, bleed 1270 x 1670 px');
    expect(container.textContent).toContain('Proof profile: FOGRA39 metadata only; ICC embedding unsupported.');
    expect(container.textContent).toContain('Unsupported: auto bleed extension, Image slices, printer marks/PDF/X, and true contract proof output.');
  });
});
