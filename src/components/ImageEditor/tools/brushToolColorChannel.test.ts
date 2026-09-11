import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrushSettings, ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { DEFAULT_CROP_TOOL_SETTINGS, DEFAULT_SELECTION_TOOL_SETTINGS } from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { brushTool, eraserTool } from './brushTool';

const mods = { shift: false, alt: false, ctrl: false, meta: false };

class FakeCanvasContext {
  readonly imageData: ImageData;
  fillStyle: string | CanvasGradient = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  private readonly width: number;
  private readonly height: number;
  private offsetX = 0;
  private offsetY = 0;
  private readonly stack: Array<{
    fillStyle: string | CanvasGradient;
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;
    offsetX: number;
    offsetY: number;
  }> = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  save() {
    this.stack.push({
      fillStyle: this.fillStyle,
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      offsetX: this.offsetX,
      offsetY: this.offsetY,
    });
  }

  restore() {
    const previous = this.stack.pop();
    if (!previous) return;
    this.fillStyle = previous.fillStyle;
    this.globalAlpha = previous.globalAlpha;
    this.globalCompositeOperation = previous.globalCompositeOperation;
    this.offsetX = previous.offsetX;
    this.offsetY = previous.offsetY;
  }

  translate(x: number, y: number) {
    this.offsetX += x;
    this.offsetY += y;
  }

  rotate() {}
  scale() {}
  beginPath() {}
  arc() {}
  createRadialGradient() {
    return { addColorStop() {} } as CanvasGradient;
  }

  getImageData() {
    return {
      width: this.width,
      height: this.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }

  drawImage(source: FakeOffscreenCanvas, dx: number, dy: number) {
    const sourceData = source.context.imageData.data;
    for (let sy = 0; sy < source.height; sy += 1) {
      for (let sx = 0; sx < source.width; sx += 1) {
        const targetX = sx + dx;
        const targetY = sy + dy;
        if (targetX < 0 || targetY < 0 || targetX >= this.width || targetY >= this.height) continue;
        const sourceOffset = (sy * source.width + sx) * 4;
        const targetOffset = (targetY * this.width + targetX) * 4;
        this.blendPixel(targetOffset, [
          sourceData[sourceOffset] ?? 0,
          sourceData[sourceOffset + 1] ?? 0,
          sourceData[sourceOffset + 2] ?? 0,
          sourceData[sourceOffset + 3] ?? 0,
        ]);
      }
    }
  }

  fillRect(x: number, y: number, width: number, height: number) {
    const [red, green, blue, alpha] = parseColor(this.fillStyle);
    const minX = Math.max(0, Math.ceil(x + this.offsetX));
    const minY = Math.max(0, Math.ceil(y + this.offsetY));
    const maxX = Math.min(this.width, Math.ceil(x + this.offsetX + width));
    const maxY = Math.min(this.height, Math.ceil(y + this.offsetY + height));
    for (let py = minY; py < maxY; py += 1) {
      for (let px = minX; px < maxX; px += 1) {
        const offset = (py * this.width + px) * 4;
        this.blendPixel(offset, [red, green, blue, alpha]);
      }
    }
  }

  fill() {
    this.fillRect(0, 0, 1, 1);
  }

  clearRect() {
    this.imageData.data.fill(0);
  }

  private blendPixel(offset: number, source: [number, number, number, number]) {
    const sourceAlpha = (source[3] / 255) * this.globalAlpha;
    if (this.globalCompositeOperation === 'destination-out') {
      const keep = 1 - sourceAlpha;
      this.imageData.data[offset + 3] = Math.round((this.imageData.data[offset + 3] ?? 0) * keep);
      return;
    }

    const inverse = 1 - sourceAlpha;
    this.imageData.data[offset] = Math.round(source[0] * sourceAlpha + (this.imageData.data[offset] ?? 0) * inverse);
    this.imageData.data[offset + 1] = Math.round(source[1] * sourceAlpha + (this.imageData.data[offset + 1] ?? 0) * inverse);
    this.imageData.data[offset + 2] = Math.round(source[2] * sourceAlpha + (this.imageData.data[offset + 2] ?? 0) * inverse);
    this.imageData.data[offset + 3] = Math.round((sourceAlpha + ((this.imageData.data[offset + 3] ?? 0) / 255) * inverse) * 255);
  }
}

class FakeOffscreenCanvas {
  readonly context: FakeCanvasContext;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function parseColor(value: string | CanvasGradient): [number, number, number, number] {
  if (typeof value !== 'string') return [0, 0, 0, 255];
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) return [0, 0, 0, 255];
  return [
    Number.parseInt(hex[1].slice(0, 2), 16),
    Number.parseInt(hex[1].slice(2, 4), 16),
    Number.parseInt(hex[1].slice(4, 6), 16),
    255,
  ];
}

function setPixel(bitmap: LayerBitmap, x: number, y: number, rgba: [number, number, number, number]) {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  canvas.context.imageData.data.set(rgba, offset);
}

function getPixel(bitmap: LayerBitmap, x: number, y: number): [number, number, number, number] {
  const canvas = bitmap as unknown as FakeOffscreenCanvas;
  const offset = (y * canvas.width + x) * 4;
  return [
    canvas.context.imageData.data[offset] ?? 0,
    canvas.context.imageData.data[offset + 1] ?? 0,
    canvas.context.imageData.data[offset + 2] ?? 0,
    canvas.context.imageData.data[offset + 3] ?? 0,
  ];
}

function pointerEvent(): PointerEvent {
  return {
    pointerType: 'mouse',
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
  } as PointerEvent;
}

function makeBrushSettings(color: string): BrushSettings {
  return {
    presetId: 'test',
    size: 1,
    opacity: 1,
    hardness: 1,
    flow: 1,
    color,
    spacing: 1,
    angleDeg: 0,
    roundness: 1,
    scatter: 0,
    smoothing: 0,
    pressureSize: 0,
    pressureOpacity: 0,
    pressureFlow: 0,
    tipShape: 'square',
    symmetryMode: 'none',
  };
}

function makeLayer(bitmap: LayerBitmap): ImageLayer {
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
    bitmap,
    bitmapVersion: 0,
    mask: null,
  };
}

function makeEnv(doc: ImageDocument, layer: ImageLayer, brushSettings: BrushSettings): ToolEnv {
  return {
    doc,
    activeLayer: layer,
    brushSettings,
    cropToolSettings: { ...DEFAULT_CROP_TOOL_SETTINGS },
    selectionToolSettings: { ...DEFAULT_SELECTION_TOOL_SETTINGS },
    screenToDoc: (point) => point,
    docToScreen: (point) => point,
    pushOperation: vi.fn(),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store: {
      quickMaskSettings: {
        enabled: false,
        viewMode: 'maskedAreas',
        overlayOpacity: 0.5,
      },
      updateLayer: vi.fn(),
      bumpLayerBitmapVersion: vi.fn(),
      markDocumentDirty: vi.fn(),
    } as unknown as ToolEnv['store'],
  };
}

describe('brushTool color channel routing', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  });

  it('routes brush paint to only the active red component on normal layer pixels', () => {
    const bitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    setPixel(bitmap, 1, 1, [10, 20, 30, 200]);
    const layer = makeLayer(bitmap);
    const doc = {
      id: 'doc-red-channel',
      title: 'Red Channel',
      width: 3,
      height: 3,
      layers: [layer],
      activeLayerId: layer.id,
      activeLayerEditTarget: 'layer',
      activeColorChannel: 'red',
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
    } satisfies ImageDocument;
    const env = makeEnv(doc, layer, makeBrushSettings('#ff8040'));

    brushTool.onPointerDown?.(env, { x: 1, y: 1 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 1, y: 1 }, mods, pointerEvent());

    expect(getPixel(bitmap, 1, 1)).toEqual([255, 20, 30, 200]);
  });

  it('routes brush paint to only the active green component on normal layer pixels', () => {
    const bitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    setPixel(bitmap, 1, 1, [10, 20, 30, 200]);
    const layer = makeLayer(bitmap);
    const doc = {
      id: 'doc-green-channel',
      title: 'Green Channel',
      width: 3,
      height: 3,
      layers: [layer],
      activeLayerId: layer.id,
      activeLayerEditTarget: 'layer',
      activeColorChannel: 'green',
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
    } satisfies ImageDocument;
    const env = makeEnv(doc, layer, makeBrushSettings('#ff8040'));

    brushTool.onPointerDown?.(env, { x: 1, y: 1 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 1, y: 1 }, mods, pointerEvent());

    expect(getPixel(bitmap, 1, 1)).toEqual([10, 128, 30, 200]);
  });

  it('keeps RGB composite brush behavior routed to all color components and alpha', () => {
    const bitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    setPixel(bitmap, 1, 1, [10, 20, 30, 200]);
    const layer = makeLayer(bitmap);
    const doc = {
      id: 'doc-rgb-channel',
      title: 'RGB Channel',
      width: 3,
      height: 3,
      layers: [layer],
      activeLayerId: layer.id,
      activeLayerEditTarget: 'layer',
      activeColorChannel: 'rgb',
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
    } satisfies ImageDocument;
    const env = makeEnv(doc, layer, makeBrushSettings('#ff8040'));

    brushTool.onPointerDown?.(env, { x: 1, y: 1 }, mods, pointerEvent());
    brushTool.onPointerUp?.(env, { x: 1, y: 1 }, mods, pointerEvent());

    expect(getPixel(bitmap, 1, 1)).toEqual([255, 128, 64, 255]);
  });

  it('routes eraser edits to only the active blue component on normal layer pixels', () => {
    const bitmap = new OffscreenCanvas(3, 3) as LayerBitmap;
    setPixel(bitmap, 1, 1, [10, 20, 30, 200]);
    const layer = makeLayer(bitmap);
    const doc = {
      id: 'doc-blue-channel',
      title: 'Blue Channel',
      width: 3,
      height: 3,
      layers: [layer],
      activeLayerId: layer.id,
      activeLayerEditTarget: 'layer',
      activeColorChannel: 'blue',
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: false,
    } satisfies ImageDocument;
    const env = makeEnv(doc, layer, makeBrushSettings('#ffffff'));

    eraserTool.onPointerDown?.(env, { x: 1, y: 1 }, mods, pointerEvent());
    eraserTool.onPointerUp?.(env, { x: 1, y: 1 }, mods, pointerEvent());

    expect(getPixel(bitmap, 1, 1)).toEqual([10, 20, 0, 200]);
  });
});
