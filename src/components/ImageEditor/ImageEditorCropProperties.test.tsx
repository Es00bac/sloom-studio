// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CropPanel } from './ImageEditorCropProperties';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import {
  clearPerspectiveCropPreview,
  getPerspectiveCropPreview,
  setPerspectiveCropQuad,
} from './tools/cropTool';
import { DEFAULT_CROP_TOOL_SETTINGS, type ImageLayer, type LayerBitmap } from '../../types/imageEditor';

class FakeContext {
  drawImage = vi.fn();
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  clip() {}
  fill() {}
  stroke() {}
  clearRect() {}
  rect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  transform() {}
  getImageData() {
    return { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;
  }
  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }
  putImageData() {}
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context = new FakeContext();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function imageLayer(): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer 1',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: { width: 640, height: 480 } as LayerBitmap,
    bitmapVersion: 1,
    mask: null,
  };
}

function mountPanel(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  nativeSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('CropPanel perspective mode', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    clearPerspectiveCropPreview();
    const doc = {
      ...createEmptyImageDocument({ id: 'doc-1', title: 'Doc', width: 640, height: 480 }),
      layers: [imageLayer()],
      activeLayerId: 'layer-1',
    };
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: 'doc-1',
      cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
      undoStacks: {},
      redoStacks: {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearPerspectiveCropPreview();
  });

  it('offers Rectangular and Perspective crop modes and writes the setting', async () => {
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    const perspectiveButton = container.querySelector('button:not([title])');
    const buttons = Array.from(container.querySelectorAll('button'));
    const modeButton = buttons.find((button) => button.textContent === 'Perspective');
    expect(modeButton).toBeDefined();

    await act(async () => {
      modeButton?.click();
    });
    expect(useImageEditorStore.getState().cropToolSettings.mode).toBe('perspective');

    const rectangularButton = buttons.find((button) => button.textContent === 'Rectangular');
    await act(async () => {
      rectangularButton?.click();
    });
    expect(useImageEditorStore.getState().cropToolSettings.mode).toBe('rectangular');
    void perspectiveButton;

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('binds the corner fields to the live session quad', async () => {
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    const topRightX = container.querySelector('[aria-label="Top-Right X"]') as HTMLInputElement | null;
    expect(topRightX).not.toBeNull();
    expect(topRightX?.value).toBe('640');

    await act(async () => {
      if (topRightX) setInputValue(topRightX, '600');
    });

    const quad = getPerspectiveCropPreview();
    expect(quad).not.toBeNull();
    expect(quad?.[1]).toEqual({ x: 600, y: 0 });
    expect(quad?.[0]).toEqual({ x: 0, y: 0 });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('offers an explicit content-aware corner-fill control and persists its crop setting', async () => {
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    const control = container.querySelector('[aria-label="Content-Aware Fill Crop Corners"]') as HTMLInputElement | null;
    expect(control).not.toBeNull();
    expect(control?.checked).toBe(false);

    await act(async () => {
      control?.click();
    });
    expect(useImageEditorStore.getState().cropToolSettings.cornerFillMode).toBe('content-aware');
    expect(container.textContent).toContain('bakes the crop into one undoable operation');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('commits the live session through the undoable store operation from Apply', async () => {
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    // Move the bottom-right corner to create a real (valid) trapezoid.
    const bottomRightX = container.querySelector('[aria-label="Bottom-Right X"]') as HTMLInputElement | null;
    await act(async () => {
      if (bottomRightX) setInputValue(bottomRightX, '600');
    });

    const applyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Apply Perspective Crop') as HTMLButtonElement | undefined;
    expect(applyButton?.disabled).toBe(false);

    await act(async () => {
      applyButton?.click();
    });

    const committed = useImageEditorStore.getState().documents[0];
    expect(committed.layers).toHaveLength(1);
    expect(committed.layers[0].name).toBe('Perspective Crop');
    expect(useImageEditorStore.getState().undoStacks['doc-1']).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks['doc-1'][0]).toMatchObject({ kind: 'docResize' });
    expect(getPerspectiveCropPreview()).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('disables Apply for finite panel coordinates whose output exceeds allocation bounds', async () => {
    const activeDoc = useImageEditorStore.getState().getActiveDocument()!;
    setPerspectiveCropQuad([
      { x: 0, y: 0 },
      { x: 1e100, y: 0 },
      { x: 1e100, y: 1e100 },
      { x: 0, y: 1e100 },
    ], activeDoc);
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    const applyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Apply Perspective Crop') as HTMLButtonElement | undefined;
    expect(applyButton?.disabled).toBe(true);
    expect(activeDoc.width).toBe(640);
    expect(useImageEditorStore.getState().undoStacks[activeDoc.id]).toBeUndefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('discloses and refuses perspective crop for a high-bit document before mutation', async () => {
    const current = useImageEditorStore.getState().documents[0];
    const highBitDoc = { ...current, metadata: { bitDepth: 32 as const, sourceBitDepth: 32 as const } };
    useImageEditorStore.setState({ documents: [highBitDoc], activeDocId: highBitDoc.id });
    const { container, root } = mountPanel();
    await act(async () => {
      root.render(<CropPanel />);
    });

    const applyButton = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Apply Perspective Crop') as HTMLButtonElement | undefined;
    expect(applyButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Refused before mutation');

    await act(async () => {
      applyButton?.click();
    });
    expect(useImageEditorStore.getState().documents[0]).toBe(highBitDoc);
    expect(useImageEditorStore.getState().undoStacks[highBitDoc.id]).toBeUndefined();

    const refusal = vi.fn();
    window.addEventListener('sloom-high-bit-tool-refused', refusal);
    useImageEditorStore.getState().applyPerspectiveCrop(highBitDoc.id, [
      { x: 0, y: 0 },
      { x: 640, y: 0 },
      { x: 640, y: 480 },
      { x: 0, y: 480 },
    ]);
    expect(refusal).toHaveBeenCalledOnce();
    expect(refusal.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        tool: 'perspectiveCrop',
        source: 'proxy',
        precisionLossy: true,
        disclosure: expect.stringContaining('no pixels were changed'),
      },
    });
    window.removeEventListener('sloom-high-bit-tool-refused', refusal);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders the mode section deterministically', () => {
    const html = renderToStaticMarkup(<CropPanel />);
    expect(html).toContain('Crop Mode');
    expect(html).toContain('Perspective Crop');
    expect(html).toContain('Apply Perspective Crop');
    expect(html).toContain('Fit');
  });
});
