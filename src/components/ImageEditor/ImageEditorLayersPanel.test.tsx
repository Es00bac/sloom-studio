// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer } from '../../types/imageEditor';
import { ImageEditorLayersPanel } from './ImageEditorLayersPanel';
import { redo, undo } from './undoRedoApply';
import { createImageTiltmarkLayerSet } from './tiltmark/ImageTiltmarkLayer';
import { dispatchNativeRenderRefusal } from './pixels/nativeDisplay';
import { NativeCompositeRefusal } from './pixels/compositeBuffers';

class FakeOffscreenCanvasContext {
  readonly imageData: ImageData;
  fillStyle = '#000000';
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';

  constructor(width: number, height: number) {
    this.imageData = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }

  beginPath() {}
  closePath() {}
  rect() {}
  ellipse() {}
  lineTo() {}
  moveTo() {}
  fill() {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  drawImage() {}
  save() {}
  restore() {}
  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }
  createImageData(width: number, height: number) {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    } as ImageData;
  }
  putImageData(imageData: ImageData) {
    this.imageData.data.set(imageData.data);
  }
}

class FakeOffscreenCanvas {
  readonly width: number;
  readonly height: number;
  private readonly context: FakeOffscreenCanvasContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeOffscreenCanvasContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

function layer(patch: Partial<ImageLayer>): ImageLayer {
  return {
    id: patch.id ?? 'layer',
    name: patch.name ?? 'Layer',
    type: patch.type ?? 'image',
    visible: patch.visible ?? true,
    locked: patch.locked ?? false,
    opacity: patch.opacity ?? 1,
    blendMode: patch.blendMode ?? 'normal',
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    bitmap: patch.bitmap ?? null,
    bitmapVersion: patch.bitmapVersion ?? 0,
    mask: patch.mask ?? null,
    ...patch,
  };
}

function vectorRectLayer({
  id,
  name,
  x,
  y,
  width,
  height,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): ImageLayer {
  return layer({
    id,
    name,
    type: 'vector',
    x,
    y,
    bitmap: null,
    vectorRecipe: '<svg />',
    metadata: {
      originalSvgSource: '<svg />',
      vectorShape: {
        kind: 'rect',
        width,
        height,
        fillColor: '#22cc88',
        fillOpacity: 0.75,
        strokeColor: '#1144ff',
        strokeOpacity: 0.5,
        strokeWidth: 4,
      },
    } as unknown as ImageLayer['metadata'],
  });
}

function vectorEllipseLayer({
  id,
  name,
  x,
  y,
  width,
  height,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}): ImageLayer {
  return layer({
    id,
    name,
    type: 'vector',
    x,
    y,
    bitmap: null,
    vectorRecipe: '<svg />',
    metadata: {
      originalSvgSource: '<svg />',
      vectorShape: {
        kind: 'ellipse',
        width,
        height,
        fillColor: '#22cc88',
        fillOpacity: 0.75,
        strokeColor: '#1144ff',
        strokeOpacity: 0.5,
        strokeWidth: 4,
      },
    } as unknown as ImageLayer['metadata'],
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe('ImageEditorLayersPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: '#252630',
    } as unknown as CanvasRenderingContext2D);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('discloses the real native render-refusal payload through the mounted status surface', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-render-refusal', title: 'High-bit render refusal', width: 8, height: 8 }),
      metadata: { bitDepth: 16 },
      layers: [layer({ id: 'paint', name: 'Paint' })],
      activeLayerId: 'paint',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });
    const refusal = new NativeCompositeRefusal('unsupported-state', 'Native high-bit render cannot execute this retained filter state.');
    act(() => { dispatchNativeRenderRefusal(refusal); });
    expect(container.textContent).toContain('Native high-bit render cannot execute this retained filter state. No pixels were changed.');
  });

  it('renders compact layer search, filters, and color labels for an open document', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-1',
        title: 'Layered edit',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'background', name: 'Background plate', colorLabel: 'blue' }),
        layer({ id: 'ink', name: 'Character ink', colorLabel: 'red' }),
        layer({ id: 'title', name: 'Title type', type: 'text', visible: false, colorLabel: 'violet' }),
      ],
      activeLayerId: 'ink',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });
    const html = container.innerHTML;

    expect(html).toContain('aria-label="Search layers"');
    expect(html).toContain('aria-label="Layer type filter"');
    expect(html).toContain('aria-label="Layer color label filter"');
    expect(html).toContain('aria-label="Layer color label"');
    expect(html).toContain('aria-label="Clip layer to layer below"');
    expect(html).toContain('Clip');
    expect(html).toContain('max-h-28');
    expect(html).toContain('min-h-0 flex-1');
    expect(html).toContain('overscroll-contain');
    expect(html).toContain('class="sr-only">Duplicate');
    expect(html).not.toContain('hidden xl:inline');
    expect(html).toContain('All Labels');
    expect(html).toContain('Character ink');
    expect(html).toContain('Red label');
  });

  it('mounts and commits the retained Reduce Noise filter through the Layers panel', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-denoise', title: 'Portrait', width: 8, height: 8 }),
      layers: [layer({ id: 'portrait', name: 'Portrait', bitmap: new FakeOffscreenCanvas(8, 8) as unknown as OffscreenCanvas })],
      activeLayerId: 'portrait',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Add layer filter"]');
    expect(select).not.toBeNull();
    act(() => {
      if (!select) return;
      select.value = 'denoise';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.filters).toMatchObject([
      { kind: 'denoise', enabled: true, amount: 60 },
    ]);
    expect(container.textContent).toContain('Reduce Noise');

    act(() => { expect(undo('doc-denoise')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.filters ?? []).toHaveLength(0);
    act(() => { expect(redo('doc-denoise')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers[0]?.filters).toMatchObject([
      { kind: 'denoise', enabled: true, amount: 60 },
    ]);
  });

  it('mounts Smart Filters and synchronizes a source stack through one undoable layer operation', () => {
    const sharedInstance = (id: string): ImageLayer => layer({
      id,
      name: id,
      bitmap: new FakeOffscreenCanvas(8, 8) as unknown as OffscreenCanvas,
      smartObject: { sourceId: 'shared-source', placement: { width: 8, height: 8 }, renderedVersion: 1 },
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-smart-filters', title: 'Smart filters', width: 8, height: 8 }),
      layers: [sharedInstance('source-a'), sharedInstance('source-b')],
      activeLayerId: 'source-a',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    expect(container.querySelector('[aria-label="Smart Filters"]')).not.toBeNull();
    expect(container.textContent).toContain('2 shared instances');
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Add layer filter"]');
    expect(select).not.toBeNull();
    act(() => {
      if (!select) return;
      select.value = 'blur';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    let state = useImageEditorStore.getState();
    expect(state.documents.find((doc) => doc.id === 'doc-smart-filters')?.layers.map((entry) => entry.filters)).toEqual([
      [expect.objectContaining({ kind: 'blur' })],
      [expect.objectContaining({ kind: 'blur' })],
    ]);
    expect(state.undoStacks['doc-smart-filters']?.filter((operation) => operation.kind === 'layerOp')).toHaveLength(1);

    act(() => { expect(undo('doc-smart-filters')).toBe(true); });
    expect(useImageEditorStore.getState().documents.find((doc) => doc.id === 'doc-smart-filters')?.layers.every((entry) => !entry.filters?.length)).toBe(true);
    act(() => { expect(redo('doc-smart-filters')).toBe(true); });
    state = useImageEditorStore.getState();
    expect(state.documents.find((doc) => doc.id === 'doc-smart-filters')?.layers.every((entry) => entry.filters?.[0]?.kind === 'blur')).toBe(true);
  });

  it('refuses the generic Add Adjustment menu on high-bit documents before mutation', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-high-bit-generic-adjustment', title: '16-bit', width: 8, height: 8 }),
      metadata: { bitDepth: 16 },
      layers: [layer({ id: 'paint', name: 'Paint', bitmap: new FakeOffscreenCanvas(8, 8) as unknown as OffscreenCanvas })],
      activeLayerId: 'paint',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });
    act(() => { container.querySelector<HTMLButtonElement>('button[title="Add layer"]')?.click(); });
    const adjustment = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Adjustment');
    expect(adjustment).not.toBeNull();
    act(() => { adjustment?.click(); });
    const current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layers).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[current!.id] ?? []).toHaveLength(0);
    expect(container.textContent).toContain('16-bit adjustment processing has no native round-trip authority');
  });

  it('refuses Smart Filter stack edits on high-bit documents before mutation', () => {
    const sharedInstance = (id: string): ImageLayer => layer({
      id,
      name: id,
      bitmap: new FakeOffscreenCanvas(8, 8) as unknown as OffscreenCanvas,
      smartObject: { sourceId: 'high-bit-shared-source', placement: { width: 8, height: 8 }, renderedVersion: 1 },
    });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-high-bit-smart-filters', title: '16-bit Smart filters', width: 8, height: 8 }),
      metadata: { bitDepth: 16 },
      layers: [sharedInstance('source-a'), sharedInstance('source-b')],
      activeLayerId: 'source-a',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Add layer filter"]');
    expect(select).not.toBeNull();
    act(() => {
      select!.value = 'blur';
      select!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layers.every((entry) => !entry.filters?.length)).toBe(true);
    expect(useImageEditorStore.getState().undoStacks[current!.id] ?? []).toHaveLength(0);
    expect(container.textContent).toContain('16-bit filters and adjustments have no native round-trip executor');
  });

  it('ctrl-clicks a layer row to extend the multi-layer selection used by linked move', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-multi',
        title: 'Multi select',
        width: 256,
        height: 256,
      }),
      layers: [
        layer({ id: 'back', name: 'Back plate' }),
        layer({ id: 'mid', name: 'Mid plate' }),
        layer({ id: 'front', name: 'Front plate' }),
      ],
      activeLayerId: 'front',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const midRow = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Mid plate'),
    );
    expect(midRow).toBeTruthy();

    act(() => {
      midRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-multi');
    expect(doc?.selectedLayerIds).toEqual(['front', 'mid']);
    expect(doc?.activeLayerId).toBe('mid');

    // A plain click then collapses the multi-selection back to a single layer.
    const backRow = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Back plate'),
    );
    act(() => {
      backRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const collapsed = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-multi');
    expect(collapsed?.selectedLayerIds).toEqual(['back']);
    expect(collapsed?.activeLayerId).toBe('back');
  });

  it('toggles clipping masks through an undoable layer operation', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-clip',
        title: 'Clipping edit',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base shape', colorLabel: 'blue' }),
        layer({ id: 'shade', name: 'Clipped shade', colorLabel: 'red' }),
      ],
      activeLayerId: 'shade',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Clip layer to layer below"]');
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.click();
    });

    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === 'doc-clip');
    expect(doc?.layers.find((entry) => entry.id === 'shade')?.clippingMask).toBe(true);
    expect(state.undoStacks['doc-clip']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-clip',
    });
  });

  it('batch creates and releases clipping masks for layers above a context-menu base layer', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-clip-batch',
        title: 'Batch clipping edit',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base shape' }),
        layer({ id: 'shade', name: 'Shade pass' }),
        layer({ id: 'texture', name: 'Texture pass' }),
      ],
      activeLayerId: 'texture',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const baseRow = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Base shape'),
    );
    expect(baseRow).not.toBeNull();

    act(() => {
      baseRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    const clipAbove = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Clip Layers Above to This Layer'),
    );
    expect(clipAbove).toBeDefined();

    act(() => {
      clipAbove?.click();
    });

    let state = useImageEditorStore.getState();
    let doc = state.documents.find((candidate) => candidate.id === 'doc-clip-batch');
    expect(doc?.layers.find((entry) => entry.id === 'base')?.clippingMask).toBeUndefined();
    expect(doc?.layers.find((entry) => entry.id === 'shade')?.clippingMask).toBe(true);
    expect(doc?.layers.find((entry) => entry.id === 'texture')?.clippingMask).toBe(true);
    expect(state.undoStacks['doc-clip-batch']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(1);

    act(() => {
      baseRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    const releaseAbove = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Release Clipping Masks Above'),
    );
    expect(releaseAbove).toBeDefined();

    act(() => {
      releaseAbove?.click();
    });

    state = useImageEditorStore.getState();
    doc = state.documents.find((candidate) => candidate.id === 'doc-clip-batch');
    expect(doc?.layers.find((entry) => entry.id === 'shade')?.clippingMask).toBeUndefined();
    expect(doc?.layers.find((entry) => entry.id === 'texture')?.clippingMask).toBeUndefined();
    expect(state.undoStacks['doc-clip-batch']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('surfaces nested-group, inherited-lock, and clipping handoff caveats for the active layer', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-layer-caveats',
        title: 'Layer caveats',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({
          id: 'root-group',
          name: 'Root folder',
          type: 'group',
          bitmap: null,
          blendMode: 'multiply',
          locked: true,
          mask: document.createElement('canvas') as unknown as OffscreenCanvas,
        }),
        layer({
          id: 'nested-group',
          name: 'Nested folder',
          type: 'group',
          bitmap: null,
          groupId: 'root-group',
        }),
        layer({
          id: 'clip-base',
          name: 'Clip base',
          groupId: 'nested-group',
        }),
        layer({
          id: 'clip-fill',
          name: 'Clip fill',
          groupId: 'nested-group',
          clippingMask: true,
        } as Partial<ImageLayer>),
      ],
      activeLayerId: 'clip-fill',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const text = container.textContent ?? '';

    expect(text).toContain('Nested groups are normalized for preview only.');
    expect(text).toContain('Pass-through folders do not have full Photoshop compositing semantics.');
    expect(text).toContain('Group masks stay metadata-only and can flatten through visible descendants on PSD handoff.');
    expect(text).toContain('Inherited folder locks can still block child and batch actions.');
    expect(text).toContain('PSD handoff keeps clipping masks as Sloom Studio metadata; native Photoshop clipping groups are not guaranteed.');
  });

  it('renders mask density and feather controls and commits them as undoable layer operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-mask-controls',
        title: 'Mask controls',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base plate' }),
        layer({
          id: 'masked',
          name: 'Masked layer',
          mask: document.createElement('canvas') as unknown as OffscreenCanvas,
          maskDensity: 0.4,
          maskFeather: 6,
        } as unknown as Partial<ImageLayer>),
      ],
      activeLayerId: 'masked',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const density = container.querySelector<HTMLInputElement>('input[aria-label="Mask density"]');
    const feather = container.querySelector<HTMLInputElement>('input[aria-label="Mask feather"]');
    expect(density).not.toBeNull();
    expect(feather).not.toBeNull();

    act(() => {
      setInputValue(density!, '0.75');
    });
    act(() => {
      setInputValue(feather!, '12');
    });

    const state = useImageEditorStore.getState();
    const maskedLayer = state.documents
      .find((candidate) => candidate.id === 'doc-mask-controls')
      ?.layers.find((entry) => entry.id === 'masked') as (ImageLayer & {
      maskDensity?: number;
      maskFeather?: number;
    }) | undefined;

    expect(maskedLayer?.maskDensity).toBe(0.75);
    expect(maskedLayer?.maskFeather).toBe(12);
    expect(state.undoStacks['doc-mask-controls']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('switches the active edit target between the layer bitmap and its mask', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-mask-target',
        title: 'Mask target',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base plate' }),
        layer({
          id: 'masked',
          name: 'Masked layer',
          mask: document.createElement('canvas') as unknown as OffscreenCanvas,
        } as unknown as Partial<ImageLayer>),
      ],
      activeLayerId: 'masked',
      activeLayerEditTarget: 'layer',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const editMask = container.querySelector<HTMLButtonElement>('button[aria-label="Edit mask target"]');
    const editLayer = container.querySelector<HTMLButtonElement>('button[aria-label="Edit layer target"]');
    expect(editMask).not.toBeNull();
    expect(editLayer).not.toBeNull();

    act(() => {
      editMask?.click();
    });

    expect(
      useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-mask-target')?.activeLayerEditTarget,
    ).toBe('mask');

    act(() => {
      editLayer?.click();
    });

    expect(
      useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-mask-target')?.activeLayerEditTarget,
    ).toBe('layer');
  });

  it('links a layer to a source mask as one undoable operation, then unlinks to a detached mask', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-linked-mask', title: 'Linked masks', width: 64, height: 64 }),
      layers: [
        layer({ id: 'source', name: 'Source mask', mask: new OffscreenCanvas(2, 2) as unknown as ImageLayer['mask'] }),
        layer({ id: 'target', name: 'Target layer' }),
      ],
      activeLayerId: 'target',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Link layer mask from"]');
    expect(picker).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(picker, 'source');
      picker?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    let doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-linked-mask');
    expect(doc?.layers.find((entry) => entry.id === 'target')).toMatchObject({ mask: null, maskLinkSourceLayerId: 'source' });
    expect(useImageEditorStore.getState().undoStacks['doc-linked-mask']?.at(-1)).toMatchObject({ kind: 'layerOp' });
    expect(container.textContent).toContain('Linked to Source mask');

    act(() => { expect(undo('doc-linked-mask')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((entry) => entry.id === 'target')?.maskLinkSourceLayerId).toBeUndefined();
    act(() => { expect(redo('doc-linked-mask')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((entry) => entry.id === 'target')?.maskLinkSourceLayerId).toBe('source');

    const unlink = container.querySelector<HTMLButtonElement>('button[aria-label="Unlink layer mask"]');
    act(() => { unlink?.click(); });
    doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-linked-mask');
    const target = doc?.layers.find((entry) => entry.id === 'target');
    const source = doc?.layers.find((entry) => entry.id === 'source');
    expect(target?.maskLinkSourceLayerId).toBeUndefined();
    expect(target?.mask).not.toBe(source?.mask);
  });

  it('refuses linking a mask away from a layer that existing consumers reference, without mutation', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-link-refusal', title: 'Link refusal', width: 64, height: 64 }),
      layers: [
        layer({ id: 'other', name: 'Other source', mask: new OffscreenCanvas(2, 2) as unknown as ImageLayer['mask'] }),
        layer({ id: 'demanded', name: 'Demanded source', mask: new OffscreenCanvas(2, 2) as unknown as ImageLayer['mask'] }),
        layer({ id: 'consumer', name: 'Consumer', maskLinkSourceLayerId: 'demanded' }),
      ],
      activeLayerId: 'demanded',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const picker = container.querySelector<HTMLSelectElement>('select[aria-label="Link layer mask from"]');
    expect(picker).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(picker, 'other');
      picker?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-link-refusal');
    const demanded = doc?.layers.find((entry) => entry.id === 'demanded');
    expect(demanded?.maskLinkSourceLayerId).toBeUndefined();
    expect(demanded?.mask).not.toBeNull();
    expect(useImageEditorStore.getState().undoStacks['doc-link-refusal'] ?? []).toHaveLength(0);
    expect(container.textContent).toContain('Linked-mask link refused');
  });

  it('deletes a linked-mask source as one undoable operation that materializes its consumers', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-delete-materialize', title: 'Delete source', width: 64, height: 64 }),
      layers: [
        layer({ id: 'source', name: 'Mask source', mask: new OffscreenCanvas(2, 2) as unknown as ImageLayer['mask'] }),
        layer({ id: 'consumer', name: 'Consumer', maskLinkSourceLayerId: 'source' }),
      ],
      activeLayerId: 'source',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button[title="Delete"]'))
      .find((button) => !button.disabled && button.closest('div')?.textContent?.includes('Flatten'));
    expect(deleteButton).not.toBeNull();
    act(() => { deleteButton?.click(); });

    let doc = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-delete-materialize');
    expect(doc?.layers.map((entry) => entry.id)).toEqual(['consumer']);
    const consumer = doc?.layers.find((entry) => entry.id === 'consumer');
    expect(consumer?.maskLinkSourceLayerId).toBeUndefined();
    expect(consumer?.mask).not.toBeNull();
    expect(useImageEditorStore.getState().undoStacks['doc-delete-materialize']?.at(-1)).toMatchObject({ kind: 'layerOp' });

    act(() => { expect(undo('doc-delete-materialize')).toBe(true); });
    doc = useImageEditorStore.getState().getActiveDocument();
    expect(doc?.layers.map((entry) => entry.id)).toEqual(['source', 'consumer']);
    expect(doc?.layers.find((entry) => entry.id === 'consumer')?.maskLinkSourceLayerId).toBe('source');
  });

  it('renders editable vector shape controls and commits stroke-width changes as undoable layer operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vector-controls',
        title: 'Vector controls',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({
          id: 'shape-layer',
          name: 'Badge shape',
          type: 'vector',
          bitmap: null,
          vectorRecipe: '<svg viewBox="0 0 160 80"></svg>',
          metadata: {
            originalSvgSource: '<svg viewBox="0 0 160 80"></svg>',
            vectorShape: {
              kind: 'rect',
              width: 160,
              height: 80,
              fillColor: '#ff00aa',
              fillOpacity: 1,
              strokeColor: '#112233',
              strokeOpacity: 1,
              strokeWidth: 4,
            },
          } as unknown as ImageLayer['metadata'],
        }),
      ],
      activeLayerId: 'shape-layer',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    expect(container.innerHTML).toContain('Vector Shape');
    const strokeWidth = container.querySelector<HTMLInputElement>('input[aria-label="Vector stroke width"]');
    expect(strokeWidth).not.toBeNull();

    act(() => {
      setInputValue(strokeWidth!, '12');
    });

    const state = useImageEditorStore.getState();
    const vectorLayer = state.documents
      .find((candidate) => candidate.id === 'doc-vector-controls')
      ?.layers.find((entry) => entry.id === 'shape-layer') as
        | (ImageLayer & { metadata?: { vectorShape?: { strokeWidth?: number } } })
        | undefined;

    expect(vectorLayer?.metadata?.vectorShape?.strokeWidth).toBe(12);
    expect(state.undoStacks['doc-vector-controls']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-vector-controls',
    });
  });

  it('rasterizes editable vector shape layers into normal image layers without retaining live vector metadata', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vector-rasterize',
        title: 'Vector rasterize',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({
          id: 'shape-layer',
          name: 'Sticker shape',
          type: 'vector',
          bitmap: null,
          vectorRecipe: '<svg viewBox="0 0 120 60"></svg>',
          metadata: {
            originalSvgSource: '<svg viewBox="0 0 120 60"></svg>',
            vectorShape: {
              kind: 'ellipse',
              width: 120,
              height: 60,
              fillColor: '#44ccff',
              fillOpacity: 0.9,
              strokeColor: '#0f172a',
              strokeOpacity: 1,
              strokeWidth: 6,
            },
          } as unknown as ImageLayer['metadata'],
        }),
      ],
      activeLayerId: 'shape-layer',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const row = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Sticker shape'),
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    const rasterize = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Rasterize Layer'),
    );
    expect(rasterize).not.toBeNull();

    act(() => {
      rasterize?.click();
    });

    const rasterized = useImageEditorStore.getState().documents
      .find((candidate) => candidate.id === 'doc-vector-rasterize')
      ?.layers.find((entry) => entry.id === 'shape-layer') as
        | (ImageLayer & { metadata?: { vectorShape?: unknown } })
        | undefined;

    expect(rasterized?.type).toBe('image');
    expect(rasterized?.bitmap).not.toBeNull();
    expect(rasterized?.vectorRecipe).toBeUndefined();
    expect(rasterized?.metadata?.originalSvgSource).toBeUndefined();
    expect(rasterized?.metadata?.vectorShape).toBeUndefined();
  });

  it('converts retained vector shapes into editable path layers from the Layers context menu', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vector-convert-to-path',
        title: 'Vector convert to path',
        width: 1024,
        height: 768,
      }),
      layers: [
        vectorEllipseLayer({
          id: 'shape-layer',
          name: 'Badge ellipse',
          x: 30,
          y: 40,
          width: 64,
          height: 32,
        }),
      ],
      activeLayerId: 'shape-layer',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const row = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Badge ellipse'),
    );
    expect(row).not.toBeNull();

    act(() => {
      row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    const convertToPath = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Convert Shape to Editable Path'),
    );
    expect(convertToPath).not.toBeNull();
    expect(convertToPath?.disabled).toBe(false);

    act(() => {
      convertToPath?.click();
    });

    const state = useImageEditorStore.getState();
    const converted = state.documents
      .find((candidate) => candidate.id === 'doc-vector-convert-to-path')
      ?.layers.find((entry) => entry.id === 'shape-layer') as
        | (ImageLayer & { metadata?: { vectorShape?: { kind?: string; points?: unknown[] } } })
        | undefined;

    expect(converted?.type).toBe('vector');
    expect(converted?.metadata?.vectorShape?.kind).toBe('path');
    expect(converted?.metadata?.vectorShape?.points).toHaveLength(32);
    expect(converted?.vectorRecipe).toContain('<path');
    expect(state.undoStacks['doc-vector-convert-to-path']?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: 'doc-vector-convert-to-path',
    });
  });

  it('retains exact vector Boolean operands and adds a live derived result as one undoable layer operation', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vector-boolean-menu',
        title: 'Vector Boolean',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'background', name: 'Background plate' }),
        vectorRectLayer({ id: 'vector-a', name: 'Panel Shape A', x: 0, y: 0, width: 20, height: 20 }),
        vectorRectLayer({ id: 'vector-b', name: 'Panel Shape B', x: 8, y: 6, width: 20, height: 18 }),
      ],
      activeLayerId: 'vector-b',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const topShapeRow = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Panel Shape B'),
    );
    expect(topShapeRow).not.toBeNull();

    act(() => {
      topShapeRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    expect(document.body.innerHTML).toContain('Vector Boolean');
    const intersect = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Intersect with Panel Shape A'),
    );
    expect(intersect).toBeDefined();
    expect(intersect?.disabled).toBe(false);

    act(() => {
      intersect?.click();
    });

    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === 'doc-vector-boolean-menu');
    expect(doc?.layers.map((entry) => entry.id)).toContain('vector-a');
    expect(doc?.layers.map((entry) => entry.id)).toContain('vector-b');
    expect(doc?.layers).toHaveLength(4);
    expect(doc?.layers[0]?.id).toBe('background');

    const booleanLayer = doc?.layers.find((entry) => entry.metadata?.vectorBooleanSource);
    expect(booleanLayer).toMatchObject({
      type: 'vector',
      name: 'Panel Shape B Intersect Panel Shape A',
      x: 8,
      y: 6,
    });
    expect(booleanLayer?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      closed: true,
      width: 12,
      height: 14,
    });
    expect(booleanLayer?.metadata?.vectorBooleanSource).toMatchObject({
      operation: 'intersect',
      sourceLayerIds: ['vector-b', 'vector-a'],
      supportedSubset: 'axis-aligned-rectangles',
    });
    expect(booleanLayer?.metadata?.vectorShape).toMatchObject({
      kind: 'path',
      liveBoolean: {
        version: 1,
        operation: 'intersect',
        sourceLayerIds: ['vector-b', 'vector-a'],
        outputIndex: 0,
      },
    });
    expect(doc?.activeLayerId).toBe(booleanLayer?.id);
    expect(state.undoStacks['doc-vector-boolean-menu']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(1);

    let undoResult = undefined as ReturnType<typeof state.popUndo> | undefined;
    act(() => {
      undoResult = state.popUndo('doc-vector-boolean-menu');
    });
    expect(undoResult?.kind).toBe('layerOp');
    if (!undoResult || undoResult.kind !== 'layerOp') throw new Error('expected the Boolean layer operation');
    const undoLayers = undoResult.before;
    act(() => {
      state.setLayers('doc-vector-boolean-menu', undoLayers, 'vector-b');
    });
    expect(useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-vector-boolean-menu')?.layers)
      .toHaveLength(3);

    let redoResult = undefined as ReturnType<typeof state.popRedo> | undefined;
    act(() => {
      redoResult = state.popRedo('doc-vector-boolean-menu');
    });
    expect(redoResult?.kind).toBe('layerOp');
    if (!redoResult || redoResult.kind !== 'layerOp') throw new Error('expected the Boolean layer operation');
    const redoLayers = redoResult.after;
    act(() => {
      state.setLayers('doc-vector-boolean-menu', redoLayers, booleanLayer?.id ?? null);
    });
    expect(useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-vector-boolean-menu')?.layers)
      .toHaveLength(4);

    act(() => {
      useImageEditorStore.getState().setActiveLayer('doc-vector-boolean-menu', 'vector-b');
    });
    const fillColor = container.querySelector<HTMLInputElement>('input[aria-label="Vector fill color"]');
    expect(fillColor).not.toBeNull();
    act(() => {
      setInputValue(fillColor!, '#ff3366');
    });

    const displayedAfterEdit = useImageEditorStore.getState().documents
      .find((candidate) => candidate.id === 'doc-vector-boolean-menu')!;
    const displayedBoolean = displayedAfterEdit.layers.find((entry) => entry.id === booleanLayer?.id)!;
    expect(displayedBoolean.metadata?.vectorShape).toMatchObject({ fillColor: '#ff3366' });
    const editOperation = useImageEditorStore.getState().undoStacks['doc-vector-boolean-menu']?.at(-1);
    expect(editOperation).toMatchObject({ kind: 'layerOp', docId: 'doc-vector-boolean-menu' });
    if (!editOperation || editOperation.kind !== 'layerOp') throw new Error('expected operand edit layer operation');
    expect(editOperation.after.find((entry) => entry.id === booleanLayer?.id)?.metadata?.vectorShape)
      .toEqual(displayedBoolean.metadata?.vectorShape);

    act(() => { expect(undo('doc-vector-boolean-menu')).toBe(true); });
    act(() => { expect(redo('doc-vector-boolean-menu')).toBe(true); });
    const displayedAfterRedo = useImageEditorStore.getState().documents
      .find((candidate) => candidate.id === 'doc-vector-boolean-menu')!
      .layers.find((entry) => entry.id === booleanLayer?.id)!;
    expect(displayedAfterRedo.metadata?.vectorShape).toEqual(displayedBoolean.metadata?.vectorShape);
  });

  it('keeps unsupported vector boolean context-menu operations non-mutating and visible', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-vector-boolean-unsupported',
        title: 'Vector Boolean Unsupported',
        width: 1024,
        height: 768,
      }),
      layers: [
        vectorRectLayer({ id: 'vector-a', name: 'Panel Shape A', x: 0, y: 0, width: 20, height: 20 }),
        vectorEllipseLayer({ id: 'ellipse-b', name: 'Glow Ellipse', x: 8, y: 6, width: 20, height: 18 }),
      ],
      activeLayerId: 'ellipse-b',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const ellipseRow = Array.from(container.querySelectorAll('[draggable="true"]')).find((element) =>
      element.textContent?.includes('Glow Ellipse'),
    );
    expect(ellipseRow).not.toBeNull();

    act(() => {
      ellipseRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 24, clientY: 32 }));
    });

    const union = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')).find((button) =>
      button.textContent?.includes('Union with Panel Shape A'),
    );
    expect(union).toBeDefined();
    expect(union?.disabled).toBe(false);

    act(() => {
      union?.click();
    });

    const state = useImageEditorStore.getState();
    const doc = state.documents.find((candidate) => candidate.id === 'doc-vector-boolean-unsupported');
    expect(doc?.layers.map((entry) => entry.id)).toEqual(['vector-a', 'ellipse-b']);
    expect(state.undoStacks['doc-vector-boolean-unsupported']?.filter((entry) => entry.kind === 'layerOp') ?? []).toHaveLength(0);
    expect(container.innerHTML).toContain('Vector boolean unsupported');
    expect(container.innerHTML).toContain('Ellipse vector booleans are not materialized yet');
  });

  it('toggles pixel and position lock variants through undoable layer operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-locks',
        title: 'Layer locks',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base plate' }),
        layer({ id: 'paint', name: 'Paint layer' }),
      ],
      activeLayerId: 'paint',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const pixelLock = container.querySelector<HTMLInputElement>('input[aria-label="Lock layer pixels"]');
    const positionLock = container.querySelector<HTMLInputElement>('input[aria-label="Lock layer position"]');
    expect(pixelLock).not.toBeNull();
    expect(positionLock).not.toBeNull();

    act(() => {
      pixelLock?.click();
    });
    act(() => {
      positionLock?.click();
    });

    const state = useImageEditorStore.getState();
    const lockedLayer = state.documents
      .find((candidate) => candidate.id === 'doc-locks')
      ?.layers.find((entry) => entry.id === 'paint');

    expect(lockedLayer?.locks).toEqual({ pixels: true, position: true });
    expect(state.undoStacks['doc-locks']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('creates layer groups and assigns the active layer through undoable controls', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-groups',
        title: 'Layer groups',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base plate' }),
        layer({ id: 'paint', name: 'Paint layer' }),
      ],
      activeLayerId: 'paint',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const addButton = container.querySelector<HTMLButtonElement>('button[title="Add layer"]');
    expect(addButton).not.toBeNull();
    act(() => {
      addButton?.click();
    });

    const groupButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Group');
    expect(groupButton).not.toBeNull();
    act(() => {
      groupButton?.click();
    });

    let state = useImageEditorStore.getState();
    let currentDoc = state.documents.find((candidate) => candidate.id === 'doc-groups');
    const groupLayer = currentDoc?.layers.find((entry) => entry.type === ('group' as ImageLayer['type']));
    expect(groupLayer).toMatchObject({
      name: 'Group 3',
      type: 'group',
      bitmap: null,
      groupExpanded: true,
    });
    expect(state.undoStacks['doc-groups']?.at(-1)).toMatchObject({ kind: 'layerOp' });

    const paintLayerRow = Array.from(container.querySelectorAll<HTMLElement>('span'))
      .find((entry) => entry.textContent === 'Paint layer');
    expect(paintLayerRow).not.toBeNull();
    act(() => {
      paintLayerRow?.click();
    });

    const groupSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Layer group"]');
    expect(groupSelect).not.toBeNull();
    act(() => {
      groupSelect!.value = groupLayer!.id;
      groupSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    state = useImageEditorStore.getState();
    currentDoc = state.documents.find((candidate) => candidate.id === 'doc-groups');
    expect(currentDoc?.layers.find((entry) => entry.id === 'paint')?.groupId).toBe(groupLayer?.id);
    expect(state.undoStacks['doc-groups']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('edits a group pass-through mode and nests a child folder with undoable layer operations', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-nested-groups', title: 'Nested groups', width: 128, height: 128 }),
      layers: [
        layer({ id: 'root', name: 'Root', type: 'group', bitmap: null }),
        layer({ id: 'child', name: 'Child', type: 'group', bitmap: null }),
      ],
      activeLayerId: 'root',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const passThrough = container.querySelector<HTMLInputElement>('input[aria-label="Pass through group compositing"]');
    expect(passThrough).not.toBeNull();
    act(() => { passThrough?.click(); });

    let current = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-nested-groups');
    expect(current?.layers.find((entry) => entry.id === 'root')?.groupPassThrough).toBe(true);

    const childRow = Array.from(container.querySelectorAll<HTMLElement>('span')).find((entry) => entry.textContent === 'Child');
    act(() => { childRow?.click(); });
    const groupSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Layer group"]');
    expect(groupSelect).not.toBeNull();
    act(() => {
      groupSelect!.value = 'root';
      groupSelect!.dispatchEvent(new Event('change', { bubbles: true }));
    });

    current = useImageEditorStore.getState().documents.find((candidate) => candidate.id === 'doc-nested-groups');
    expect(current?.layers.find((entry) => entry.id === 'child')?.groupId).toBe('root');
    expect(useImageEditorStore.getState().undoStacks['doc-nested-groups']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('captures a Layer Comp as document history and restores its recorded arrangement through undo and redo', () => {    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-layer-comps', title: 'Layer comps', width: 128, height: 128 }),
      layers: [
        layer({ id: 'base', name: 'Base', visible: true, opacity: 1, blendMode: 'normal' }),
        layer({ id: 'ink', name: 'Ink', visible: false, opacity: 0.5, blendMode: 'multiply' }),
      ],
      activeLayerId: 'ink',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Layer comp name"]');
    const capture = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Capture');
    expect(name).not.toBeNull();
    expect(capture).not.toBeNull();
    act(() => { setInputValue(name!, 'Night inks'); capture?.click(); });

    let current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layerComps).toMatchObject([{ name: 'Night inks', layers: [
      { layerId: 'base', visible: true, opacity: 1, blendMode: 'normal' },
      { layerId: 'ink', visible: false, opacity: 0.5, blendMode: 'multiply' },
    ] }]);
    expect(useImageEditorStore.getState().undoStacks['doc-layer-comps']?.at(-1)).toMatchObject({ kind: 'documentState' });

    act(() => { expect(undo('doc-layer-comps')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps).toBeUndefined();
    act(() => { expect(redo('doc-layer-comps')).toBe(true); });
    current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layerComps).toHaveLength(1);

    act(() => {
      useImageEditorStore.getState().setLayers('doc-layer-comps', current!.layers.map((entry) => (
        entry.id === 'ink' ? { ...entry, visible: true, opacity: 1, blendMode: 'screen' as const } : entry
      )));
    });
    const apply = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Night inks'));
    expect(apply).not.toBeNull();
    act(() => { apply?.click(); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layers.find((entry) => entry.id === 'ink')).toMatchObject({
      visible: false,
      opacity: 0.5,
      blendMode: 'multiply',
    });
    expect(useImageEditorStore.getState().undoStacks['doc-layer-comps']?.at(-1)).toMatchObject({ kind: 'layerOp' });
  });

  it('renames and deletes Layer Comps through undoable document history and refuses invalid identifiers', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-comp-ops', title: 'Comp ops', width: 128, height: 128 }),
      layers: [
        layer({ id: 'base', name: 'Base', visible: true, opacity: 1, blendMode: 'normal' }),
        layer({ id: 'ink', name: 'Ink', visible: false, opacity: 0.5, blendMode: 'multiply' }),
      ],
      activeLayerId: 'ink',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const name = container.querySelector<HTMLInputElement>('input[aria-label="Layer comp name"]');
    const capture = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Capture');
    expect(name).not.toBeNull();
    expect(capture).not.toBeNull();
    act(() => { setInputValue(name!, 'Night inks'); capture?.click(); setInputValue(name!, 'Day proofs'); capture?.click(); });
    let current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layerComps?.map((comp) => comp.name)).toEqual(['Night inks', 'Day proofs']);
    const undoCountAfterCaptures = useImageEditorStore.getState().undoStacks['doc-comp-ops']?.length ?? 0;

    // Rename inside the inline editor; colliding and blank names refuse without pushing history.
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Rename layer comp Night inks"]')?.click();
    });
    const findConfirm = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.getAttribute('aria-label') === 'Confirm layer comp rename');
    let editor = container.querySelector<HTMLInputElement>('input[aria-label="Rename layer comp Night inks"]');
    expect(editor?.value).toBe('Night inks');
    act(() => { setInputValue(editor!, 'Day proofs'); findConfirm()?.click(); });
    current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layerComps?.map((comp) => comp.name)).toEqual(['Night inks', 'Day proofs']);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('refused');
    expect(useImageEditorStore.getState().undoStacks['doc-comp-ops']?.length).toBe(undoCountAfterCaptures);

    act(() => { setInputValue(editor!, '   '); findConfirm()?.click(); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Night inks', 'Day proofs']);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('non-blank');
    expect(useImageEditorStore.getState().undoStacks['doc-comp-ops']?.length).toBe(undoCountAfterCaptures);

    act(() => {
      editor = container.querySelector<HTMLInputElement>('input[aria-label="Rename layer comp Night inks"]');
      setInputValue(editor!, 'Final lock');
      findConfirm()?.click();
    });
    current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layerComps?.map((comp) => comp.name)).toEqual(['Final lock', 'Day proofs']);
    expect(current?.activeLayerId).toBe('ink');
    expect(useImageEditorStore.getState().undoStacks['doc-comp-ops']?.at(-1)).toMatchObject({ kind: 'documentState' });

    act(() => { expect(undo('doc-comp-ops')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Night inks', 'Day proofs']);
    expect(useImageEditorStore.getState().getActiveDocument()?.activeLayerId).toBe('ink');
    act(() => { expect(redo('doc-comp-ops')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Final lock', 'Day proofs']);

    // Delete removes exactly one comp, is undoable/redoable, and never resurrects silently.
    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete layer comp Day proofs"]')?.click();
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Final lock']);
    expect(useImageEditorStore.getState().undoStacks['doc-comp-ops']?.at(-1)).toMatchObject({ kind: 'documentState' });
    act(() => { expect(undo('doc-comp-ops')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Final lock', 'Day proofs']);
    act(() => { expect(redo('doc-comp-ops')).toBe(true); });
    expect(useImageEditorStore.getState().getActiveDocument()?.layerComps?.map((comp) => comp.name)).toEqual(['Final lock']);
    expect(useImageEditorStore.getState().getActiveDocument()?.activeLayerId).toBe('ink');
  });

  it('links the active layer with the layer below and can unlink the movement group', () => {
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-links',
        title: 'Layer links',
        width: 1024,
        height: 768,
      }),
      layers: [
        layer({ id: 'base', name: 'Base plate' }),
        layer({ id: 'paint', name: 'Paint layer' }),
      ],
      activeLayerId: 'paint',
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    const linkBelow = container.querySelector<HTMLButtonElement>('button[aria-label="Link layer with layer below"]');
    expect(linkBelow).not.toBeNull();

    act(() => {
      linkBelow?.click();
    });

    let state = useImageEditorStore.getState();
    let currentDoc = state.documents.find((candidate) => candidate.id === 'doc-links');
    const baseLink = currentDoc?.layers.find((entry) => entry.id === 'base')?.linkGroupId;
    const paintLink = currentDoc?.layers.find((entry) => entry.id === 'paint')?.linkGroupId;
    expect(baseLink).toBeTruthy();
    expect(paintLink).toBe(baseLink);
    expect(container.innerHTML).toContain('title="Linked movement group"');

    const unlink = container.querySelector<HTMLButtonElement>('button[aria-label="Unlink layer"]');
    expect(unlink).not.toBeNull();
    act(() => {
      unlink?.click();
    });

    state = useImageEditorStore.getState();
    currentDoc = state.documents.find((candidate) => candidate.id === 'doc-links');
    expect(currentDoc?.layers.map((entry) => [entry.id, entry.linkGroupId])).toEqual([
      ['base', undefined],
      ['paint', undefined],
    ]);
    expect(state.undoStacks['doc-links']?.filter((entry) => entry.kind === 'layerOp')).toHaveLength(2);
  });

  it('exposes retained Tiltmark surface controls and converts only through the explicit raster action', () => {
    const { group, surface } = createImageTiltmarkLayerSet({ width: 320, height: 240 });
    const physicalSurface: ImageLayer = {
      ...surface,
      metadata: {
        tiltmark: {
          ...surface.metadata!.tiltmark!,
          materialState: 'physical',
          strokeCount: 3,
          simulation: {
            format: 'tiltmark-substrate',
            version: 1,
            byteLength: 128,
            tileCount: 2,
            stepCount: 4,
            evolvingTileCount: 1,
            updatedAt: 1,
          },
        },
      },
      tiltmarkSimulationData: 'checkpoint',
    };
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({
        id: 'doc-tiltmark',
        title: 'Physical paint',
        width: 320,
        height: 240,
      }),
      layers: [group, physicalSurface],
      activeLayerId: physicalSurface.id,
    });

    act(() => {
      root.render(<ImageEditorLayersPanel />);
    });

    expect(container.textContent).toContain('Tiltmark surface');
    expect(container.textContent).toContain('3 strokes · 2 physical tiles');
    expect(container.querySelector('select[aria-label="Tiltmark surface profile"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Tiltmark absorb"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Tiltmark sizing"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[aria-label="Tiltmark tooth"]')?.disabled,
    ).toBe(true);

    const convert = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Convert to Raster Layer');
    expect(convert).not.toBeNull();
    act(() => {
      convert?.click();
    });

    const state = useImageEditorStore.getState();
    const converted = state.getActiveDocument()?.layers.find((entry) => entry.id === physicalSurface.id);
    expect(converted?.bitmap).toBe(physicalSurface.bitmap);
    expect(converted?.metadata?.tiltmark).toBeUndefined();
    expect(converted?.tiltmarkBaseBitmap).toBeUndefined();
    expect(converted?.tiltmarkSimulationData).toBeUndefined();
    expect(state.undoStacks['doc-tiltmark']?.at(-1)).toMatchObject({ kind: 'layerOp' });
  });

  it('does not resurrect an active layer deleted while Convert to Smart Object awaits encoding', async () => {
    const pendingBlob = deferred<Blob>();
    const convertToBlob = vi.fn(() => pendingBlob.promise);
    const bitmap = {
      width: 2,
      height: 2,
      convertToBlob,
    } as unknown as ImageLayer['bitmap'];
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-smart-race', title: 'Race', width: 32, height: 32 }),
      layers: [layer({ id: 'source-layer', name: 'Source', bitmap })],
      activeLayerId: 'source-layer',
    });
    act(() => { root.render(<ImageEditorLayersPanel />); });

    const convert = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Convert to Smart Object');
    expect(convert).toBeDefined();
    act(() => { convert?.click(); });
    expect(convertToBlob).toHaveBeenCalledOnce();

    act(() => { useImageEditorStore.getState().removeLayer('doc-smart-race', 'source-layer'); });
    await act(async () => {
      pendingBlob.resolve(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const current = useImageEditorStore.getState().getActiveDocument();
    expect(current?.layers).toEqual([]);
    expect(current?.metadata?.smartSources).toBeUndefined();
  });
});
