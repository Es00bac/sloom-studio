import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import type { ToolEnv } from './types';
import { textTool } from './textTool';

// Minimal canvas stub with text-measurement support so rasterizeImageTextStyle
// runs in the node test environment (mirrors ImageTextLayer.test).
class FakeTextContext {
  font = '';
  fontKerning = '';
  fontVariantCaps = '';
  fillStyle = '';
  textBaseline = '';
  measureText(line: string) {
    return { width: line.length * 10 };
  }
  fillText() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context = new FakeTextContext();
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

const NO_MODS = { shift: false, alt: false, ctrl: false, meta: false };

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'background',
    name: 'Background',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(64, 64) as LayerBitmap,
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeEnv(docId: string): ToolEnv {
  const store = useImageEditorStore.getState();
  const doc = store.documents.find((candidate) => candidate.id === docId)!;
  return {
    doc,
    activeLayer: doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null,
    backgroundColor: '#000000',
    brushSettings: store.brushSettings,
    cropToolSettings: store.cropToolSettings,
    selectionToolSettings: store.selectionToolSettings,
    screenToDoc: (point: { x: number; y: number }) => point,
    docToScreen: (point: { x: number; y: number }) => point,
    pushOperation: vi.fn((operation) => store.pushOperation(operation)),
    requestRender: vi.fn(),
    resolveSelectionMode: () => 'replace',
    store,
  } as unknown as ToolEnv;
}

describe('image editor text tool', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    useImageEditorStore.setState({
      documents: [],
      activeDocId: null,
      undoStacks: {},
      redoStacks: {},
      pendingTextEditLayerId: null,
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-text', title: 'Text', width: 320, height: 240 }),
      layers: [makeLayer()],
      activeLayerId: 'background',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops a freshly-placed empty text layer and requests on-canvas editing', () => {
    const env = makeEnv('doc-text');
    textTool.onPointerDown?.(env, { x: 40, y: 80 }, NO_MODS, {} as PointerEvent);

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-text');
    const created = doc?.layers.find((layer) => layer.id !== 'background');
    expect(created?.type).toBe('text');
    expect(created?.metadata?.editableText).toBe(true);
    expect(created?.metadata?.freshlyPlaced).toBe(true);
    expect(created?.text?.content).toBe('');
    expect(doc?.activeLayerId).toBe(created?.id);
    // The canvas opens its in-place editor for exactly this layer.
    expect(useImageEditorStore.getState().pendingTextEditLayerId).toBe(created?.id);
  });

  it('enters text in place rather than via a blocking prompt or modal dialog', () => {
    const source = readFileSync(new URL('./textTool.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('window.prompt');
    expect(source).not.toContain('useTextInputDialogStore');
    expect(source).toContain('setPendingTextEditLayerId');
  });
});
