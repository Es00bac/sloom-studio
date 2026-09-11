// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import { ImageLiquifyWorkspacePanel } from './ImageLiquifyWorkspacePanel';

class FakeCanvasContext {
  private readonly canvas: FakeOffscreenCanvas;

  constructor(canvas: FakeOffscreenCanvas) {
    this.canvas = canvas;
  }

  drawImage(source: LayerBitmap) {
    const sourceContext = source.getContext('2d') as unknown as FakeCanvasContext;
    const sourceData = sourceContext.getImageData(0, 0, source.width, source.height);
    this.canvas.imageData = {
      width: sourceData.width,
      height: sourceData.height,
      data: new Uint8ClampedArray(sourceData.data),
    } as ImageData;
  }

  getImageData(_x = 0, _y = 0, _width = this.canvas.width, _height = this.canvas.height): ImageData {
    return {
      width: this.canvas.imageData.width,
      height: this.canvas.imageData.height,
      data: new Uint8ClampedArray(this.canvas.imageData.data),
    } as ImageData;
  }

  putImageData(next: ImageData) {
    this.canvas.imageData = {
      width: next.width,
      height: next.height,
      data: new Uint8ClampedArray(next.data),
    } as ImageData;
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  imageData: ImageData;
  private readonly context: FakeCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
    this.context = new FakeCanvasContext(this);
  }

  getContext() {
    return this.context;
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeStripBitmap(values: number[]): LayerBitmap {
  const bitmap = new OffscreenCanvas(values.length, 1) as LayerBitmap;
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  });
  bitmap.getContext('2d')?.putImageData({ width: values.length, height: 1, data } as ImageData, 0, 0);
  return bitmap;
}

function activePixelLayer(bitmap: LayerBitmap): ImageLayer {
  return {
    id: 'layer-liquify',
    name: 'Liquify Pixels',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

describe('ImageLiquifyWorkspacePanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders a mounted liquify workspace panel and applies previewed deformation through history', () => {
    const bitmap = makeStripBitmap([10, 50, 90, 130, 170]);
    const layer = activePixelLayer(bitmap);
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-liquify',
        title: 'liquify.png',
        width: 5,
        height: 1,
      }),
      layers: [layer],
      activeLayerId: layer.id,
    });

    act(() => {
      root.render(<ImageLiquifyWorkspacePanel />);
    });

    expect(container.querySelector('[data-image-liquify-workspace-panel="true"]')).not.toBeNull();
    expect(container.textContent).toContain('Liquify Workspace');
    expect(container.textContent).toContain('Push');
    expect(container.textContent).toContain('Twirl');
    expect(container.textContent).toContain('Pucker');
    expect(container.textContent).toContain('Bloat');
    expect(container.textContent).toContain('Unsupported controls');

    const centerX = container.querySelector<HTMLInputElement>('input[aria-label="Liquify center X"]');
    const centerY = container.querySelector<HTMLInputElement>('input[aria-label="Liquify center Y"]');
    const radius = container.querySelector<HTMLInputElement>('input[aria-label="Liquify radius"]');
    const strength = container.querySelector<HTMLInputElement>('input[aria-label="Liquify strength"]');
    expect(centerX).not.toBeNull();
    expect(centerY).not.toBeNull();
    expect(radius).not.toBeNull();
    expect(strength).not.toBeNull();

    act(() => {
      setInputValue(centerX!, '2');
      setInputValue(centerY!, '0');
      setInputValue(radius!, '2');
      setInputValue(strength!, '1');
    });

    const previewButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Preview'),
    );
    const applyButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Apply'),
    );
    expect(previewButton).not.toBeUndefined();
    expect(applyButton).not.toBeUndefined();

    act(() => {
      previewButton?.click();
      applyButton?.click();
    });

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-liquify');
    const nextLayer = doc?.layers.find((candidate) => candidate.id === 'layer-liquify');
    expect(useImageEditorStore.getState().undoStacks['doc-liquify']).toHaveLength(1);
    expect(nextLayer?.bitmapVersion).toBe(1);
    expect(getBitmapImageData(nextLayer?.bitmap as LayerBitmap).data[2 * 4]).toBe(50);
  });
});
