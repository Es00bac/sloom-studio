// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { getBitmapImageData } from './LayerBitmap';
import { createMask, maskBoundingBox, setRect } from './SelectionMask';
import {
  borderSelection,
  featherSelection,
  growSelection,
  shrinkSelection,
  smoothSelection,
} from './photoshopQuickActions/selectionActions';
import { ImageEditorChannelsPanel } from './ImageEditorChannelsPanel';
import { buildSavedSelectionChannel } from './ImageSelectionChannels';
import { buildImageSpotChannelEntry } from './ImageSpotChannels';
import { clearAllSelections, clearSelection, getSelection, setSelection } from './selectionRegistry';

class FakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    this.imageData = makeImageData(width, height);
  }

  createImageData(width: number, height: number) {
    return makeImageData(width, height);
  }

  getImageData() {
    return {
      width: this.imageData.width,
      height: this.imageData.height,
      data: new Uint8ClampedArray(this.imageData.data),
    } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData = {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data),
    } as ImageData;
  }

  drawImage() {}
  save() {}
  restore() {}
  clearRect() {}
  fillRect() {}
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  context: FakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new FakeContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }

  async convertToBlob() {
    return new Blob();
  }
}

function installCanvasStub() {
  globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
}

function makeImageLayer(patch: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: patch.id ?? 'layer-1',
    name: patch.name ?? 'Layer 1',
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

function makeImageData(width: number, height: number): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  } as ImageData;
}

function setNumberInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function setTextInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}

describe('ImageEditorChannelsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    installCanvasStub();
    clearAllSelections();
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
    clearAllSelections();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves, reloads, and deletes persisted alpha channels through undoable panel actions', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-1',
      title: 'Channels',
      width: 4,
      height: 4,
    });
    useImageEditorStore.getState().openDocument(doc);

    const selection = createMask(4, 4);
    setRect(selection, 0, 0, 2, 2, 255, false);
    setSelection('doc-1', selection);
    useImageEditorStore.getState().setHasSelection('doc-1', true);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const saveButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save selection as alpha channel"]');
    expect(saveButton).not.toBeNull();

    act(() => {
      saveButton?.click();
    });

    let currentDoc = useImageEditorStore.getState().getActiveDocument() as typeof doc & {
      savedSelectionChannels?: Array<{ id: string; name: string }>;
    };
    expect(currentDoc.savedSelectionChannels).toHaveLength(1);
    expect(currentDoc.savedSelectionChannels?.[0]?.name).toBe('Alpha 1');
    expect(useImageEditorStore.getState().undoStacks['doc-1']?.at(-1)).toMatchObject({
      kind: 'documentState',
      docId: 'doc-1',
    });

    act(() => {
      clearSelection('doc-1');
      useImageEditorStore.getState().setHasSelection('doc-1', false);
    });

    const loadButton = container.querySelector<HTMLButtonElement>('button[aria-label="Load selected alpha channel to selection"]');
    expect(loadButton).not.toBeNull();

    act(() => {
      loadButton?.click();
    });

    expect(Array.from(getSelection('doc-1')?.data ?? [])).toEqual(Array.from(selection.data));
    expect(useImageEditorStore.getState().undoStacks['doc-1']?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: 'doc-1',
    });

    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete selected alpha channel"]');
    expect(deleteButton).not.toBeNull();

    act(() => {
      deleteButton?.click();
    });

    currentDoc = useImageEditorStore.getState().getActiveDocument() as typeof doc & {
      savedSelectionChannels?: Array<{ id: string; name: string }>;
    };
    expect(currentDoc.savedSelectionChannels ?? []).toHaveLength(0);
  });

  it('selects Red, Green, Blue, and RGB composite as the persisted active color channel', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-color-channels',
      title: 'Channels',
      width: 4,
      height: 4,
    });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    expect(container.querySelector('[data-testid="active-color-channel"]')?.textContent).toContain('RGB Composite');
    expect(useImageEditorStore.getState().getActiveDocument()?.activeColorChannel ?? 'rgb').toBe('rgb');

    for (const channel of [
      { label: 'Red', value: 'red' },
      { label: 'Green', value: 'green' },
      { label: 'Blue', value: 'blue' },
      { label: 'RGB Composite', value: 'rgb' },
    ] as const) {
      const button = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Set active color channel to ${channel.label}"]`,
      );
      expect(button).not.toBeNull();

      act(() => {
        button?.click();
      });

      const currentDoc = useImageEditorStore.getState().getActiveDocument();
      expect(currentDoc?.activeColorChannel).toBe(channel.value);
      expect(container.querySelector('[data-testid="active-color-channel"]')?.textContent).toContain(channel.label);
      expect(button?.getAttribute('aria-pressed')).toBe('true');
      expect(useImageEditorStore.getState().undoStacks['doc-color-channels']?.at(-1)).toMatchObject({
        kind: 'documentState',
        docId: 'doc-color-channels',
      });
    }
  });

  it('renders deterministic channel action descriptors and unsupported separation limits', () => {
    const mask = createMask(4, 4);
    setRect(mask, 1, 1, 2, 2, 255, false);
    const savedChannel = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-channel-descriptors',
        title: 'Channel Descriptors',
        width: 4,
        height: 4,
      }),
      activeColorChannel: 'blue' as const,
      savedSelectionChannels: [savedChannel],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const blueRow = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Set active color channel to Blue"]',
    );
    expect(blueRow?.textContent).toContain('Edit Blue channel');
    expect(blueRow?.textContent).toContain('Load selection unavailable');

    const alphaRow = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select alpha channel Subject"]',
    );
    expect(alphaRow?.textContent).toContain('Saved selection alpha channel');
    expect(alphaRow?.textContent).toContain('Load as selection');

    expect(container.textContent).toContain('Preview alpha overlay');
    expect(container.textContent).toContain('Direct alpha painting is unavailable; save or load selections instead.');
    expect(container.textContent).toContain('Direct channel painting is limited to RGB brush and eraser routing.');
    expect(container.textContent).toContain('Direct spot-channel painting is not implemented');
    expect(container.textContent).toContain('native spot plates or press-ready separations');
  });

  it('renders alpha and spot panel summary descriptors with blockers and honest caveats', () => {
    const alphaMask = createMask(3, 2);
    setRect(alphaMask, 0, 0, 2, 1, 255, false);
    const savedChannel = {
      ...buildSavedSelectionChannel(alphaMask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const spotMask = createMask(3, 2);
    setRect(spotMask, 0, 0, 2, 1, 255, false);
    const spotChannel = buildImageSpotChannelEntry(spotMask, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      now: 100,
    });
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-panel-descriptor',
        title: 'Panel Descriptors',
        width: 4,
        height: 4,
      }),
      savedSelectionChannels: [savedChannel],
      spotChannels: [spotChannel],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    expect(container.textContent).toContain('Load selection is blocked until the saved alpha channel matches the active document dimensions.');
    expect(container.textContent).toContain('Load "Subject" is blocked: saved alpha is 3x2 but the active document is 4x4.');
    expect(container.textContent).toContain('1 saved alpha channel will be preserved as Sloom Studio metadata only; no native alpha plate is exported.');
    expect(container.textContent).toContain('Saved alpha channels are selection masks only and do not create press-ready separations.');
    expect(container.textContent).toContain('PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.');
    expect(container.textContent).toContain('Spot channel preview is an RGB tint overlay; it is not a native ink separation.');
    expect(container.textContent).toContain('Sloom Studio does not emit native spot plates or press-ready separations.');
    expect(container.textContent).toContain('Spot channel "Varnish" is 3x2 but the active document is 4x4.');

    const alphaSignatures = container.querySelector<HTMLElement>('[data-testid="alpha-channel-readiness-signatures"]');
    expect(alphaSignatures?.getAttribute('data-action-signature')).toBe(
      'alpha-channel-panel-actions:v1:4x4:replace:alpha-subject:blocked:alpha-channel-size-mismatch:psd:metadata-only',
    );
    expect(alphaSignatures?.getAttribute('data-load-mode-signatures')).toBe(
      'alpha-load-mode:alpha-subject:replace:3x2->4x4:blocked:alpha-channel-size-mismatch|alpha-load-mode:alpha-subject:add:3x2->4x4:blocked:alpha-channel-size-mismatch|alpha-load-mode:alpha-subject:subtract:3x2->4x4:blocked:alpha-channel-size-mismatch|alpha-load-mode:alpha-subject:intersect:3x2->4x4:blocked:alpha-channel-size-mismatch',
    );

    const spotSignatures = container.querySelector<HTMLElement>('[data-testid="spot-channel-readiness-signatures"]');
    expect(spotSignatures?.getAttribute('data-panel-signature')).toBe(
      'spot-channel-panel:v1:psd:spot-varnish:3x2:blocked:size-mismatch:warning-count=3',
    );
  });

  it('creates and edits persisted spot channels through undoable document-state panel actions', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-spot-channels',
      title: 'Spot Channels',
      width: 4,
      height: 4,
    });
    useImageEditorStore.getState().openDocument(doc);

    const selection = createMask(4, 4);
    setRect(selection, 1, 1, 2, 2, 255, false);
    setSelection(doc.id, selection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const saveSpotButton = container.querySelector<HTMLButtonElement>('button[aria-label="Save selection as spot channel"]');
    expect(saveSpotButton).not.toBeNull();

    act(() => {
      saveSpotButton?.click();
    });

    let currentDoc = useImageEditorStore.getState().getActiveDocument() as typeof doc & {
      spotChannels?: Array<{ id: string; name: string; opacity: number; solidity: number; visible: boolean; dataBase64: string }>;
    };
    expect(currentDoc.spotChannels).toHaveLength(1);
    expect(currentDoc.spotChannels?.[0]).toMatchObject({
      name: 'Spot 1',
      opacity: 1,
      solidity: 1,
      visible: true,
    });
    expect(currentDoc.spotChannels?.[0]?.dataBase64).toEqual(expect.any(String));
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'documentState',
      docId: doc.id,
    });
    expect(container.textContent).toContain('Spot Channels');
    expect(container.textContent).toContain('Spot 1');
    expect(container.textContent).toContain('RGB tint overlay');

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Selected spot channel name"]');
    const opacityInput = container.querySelector<HTMLInputElement>('input[aria-label="Selected spot channel opacity"]');
    const redInput = container.querySelector<HTMLInputElement>('input[aria-label="Selected spot channel red"]');
    const visibilityInput = container.querySelector<HTMLInputElement>('input[aria-label="Selected spot channel visibility"]');
    expect(nameInput).not.toBeNull();
    expect(opacityInput).not.toBeNull();
    expect(redInput).not.toBeNull();
    expect(visibilityInput).not.toBeNull();

    act(() => {
      if (nameInput) {
        setTextInputValue(nameInput, 'Varnish');
      }
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels?.[0]?.name).toBe('Varnish');

    act(() => {
      if (opacityInput) {
        setNumberInputValue(opacityInput, '0.6');
      }
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels?.[0]?.opacity).toBe(0.6);

    act(() => {
      if (redInput) {
        setNumberInputValue(redInput, '48');
      }
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels?.[0]?.color.r).toBe(48);

    act(() => {
      visibilityInput?.click();
    });
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels?.[0]?.visible).toBe(false);

    const deleteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Delete selected spot channel"]');
    expect(deleteButton).not.toBeNull();

    act(() => {
      deleteButton?.click();
    });

    currentDoc = useImageEditorStore.getState().getActiveDocument() as typeof doc & {
      spotChannels?: Array<{ id: string }>;
    };
    expect(currentDoc.spotChannels ?? []).toHaveLength(0);
  });

  it('renders persisted spot channels from document state across panel mounts', () => {
    const mask = createMask(4, 4);
    setRect(mask, 0, 0, 2, 2, 255, false);
    const spotChannel = buildImageSpotChannelEntry(mask, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      color: { r: 20, g: 120, b: 220 },
      opacity: 0.75,
      solidity: 0.5,
      now: 100,
    });
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-persisted-spot',
        title: 'Spot Channels',
        width: 4,
        height: 4,
      }),
      spotChannels: [spotChannel],
    };
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    expect(container.textContent).toContain('Spot Channels');
    expect(container.textContent).toContain('Varnish');
    expect(container.textContent).toContain('0.75');

    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    expect(container.textContent).toContain('Varnish');
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels?.[0]).toMatchObject({
      id: 'spot-varnish',
      name: 'Varnish',
    });
  });

  it('offers a mounted local grayscale plate download without mutating the retained spot channel', async () => {
    const spotChannel = buildImageSpotChannelEntry(
      { width: 2, height: 1, data: new Uint8ClampedArray([255, 0]) },
      [],
      { id: 'spot-varnish', name: 'Varnish', opacity: 0.5, solidity: 1, now: 100 },
    );
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-spot-plate',
        title: 'Spot plate',
        width: 2,
        height: 1,
      }),
      spotChannels: [spotChannel],
    };
    const createObjectUrl = vi.fn(() => 'blob:spot-plate');
    const revokeObjectUrl = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: revokeObjectUrl });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const plateDescriptor = container.querySelector<HTMLElement>('[data-testid="spot-channel-grayscale-plate"]');
    expect(container.textContent).toContain('Local grayscale plate');
    expect(container.textContent).toContain('50% ink coverage scale');
    expect(plateDescriptor?.getAttribute('data-plate-signature')).toBe(
      'spot-grayscale-plate:v1:spot-varnish:2x1:0.5:visible:13',
    );

    const download = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Download grayscale plate for Varnish"]',
    );
    expect(download?.disabled).toBe(false);
    await act(async () => {
      download?.click();
    });

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Download started for varnish-coverage.pgm');
    expect(useImageEditorStore.getState().getActiveDocument()?.spotChannels).toEqual([spotChannel]);
  });

  it('clears the plate notice when the selected channel changes', async () => {
    const first = buildImageSpotChannelEntry(
      { width: 1, height: 1, data: new Uint8ClampedArray([255]) }, [],
      { id: 'spot-first', name: 'First', now: 100 },
    );
    const second = buildImageSpotChannelEntry(
      { width: 1, height: 1, data: new Uint8ClampedArray([128]) }, [first],
      { id: 'spot-second', name: 'Second', now: 100 },
    );
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:spot'), revokeObjectURL: vi.fn() });
    useImageEditorStore.getState().openDocument({
      ...createEmptyImageDocument({ id: 'doc-notice', title: 'Notice', width: 1, height: 1 }),
      spotChannels: [first, second],
    });
    act(() => root.render(<ImageEditorChannelsPanel />));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Download grayscale plate for First"]')?.click();
    });
    expect(container.textContent).toContain('Download started for first-coverage.pgm');
    const secondButton = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Second'));
    act(() => secondButton?.click());
    expect(container.textContent).not.toContain('first-coverage.pgm');
  });

  it('toggles QuickMask controls and updates the preview mode from the Channels panel', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-quick-mask-panel',
      title: 'Channels',
      width: 4,
      height: 4,
    });
    useImageEditorStore.getState().openDocument(doc);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const toggleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle Quick Mask"]');
    const viewMode = container.querySelector<HTMLSelectElement>('select[aria-label="Quick mask view mode"]');

    expect(toggleButton).not.toBeNull();
    expect(viewMode).not.toBeNull();

    act(() => {
      toggleButton?.click();
    });
    expect(useImageEditorStore.getState().quickMaskSettings.enabled).toBe(true);

    act(() => {
      if (viewMode) {
        viewMode.value = 'selectedAreas';
        viewMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(useImageEditorStore.getState().quickMaskSettings.viewMode).toBe('selectedAreas');
  });

  it('applies select and mask outputs to selection, quick mask, layer masks, and saved alpha channels', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-select-and-mask',
        title: 'Select and Mask',
        width: 7,
        height: 7,
      }),
      layers: [makeImageLayer({ id: 'layer-1', name: 'Base' })],
      activeLayerId: 'layer-1',
    };
    useImageEditorStore.getState().openDocument(doc);

    const baseSelection = createMask(7, 7);
    setRect(baseSelection, 2, 2, 3, 3, 255, false);
    setSelection(doc.id, baseSelection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const shiftEdge = container.querySelector<HTMLInputElement>('input[aria-label="Select and Mask shift edge"]');
    const smartRadius = container.querySelector<HTMLInputElement>('input[aria-label="Select and Mask radius"]');
    const decontaminateColors = container.querySelector<HTMLInputElement>('input[aria-label="Select and Mask decontaminate colors"]');
    const decontaminateAmount = container.querySelector<HTMLInputElement>('input[aria-label="Select and Mask decontaminate amount"]');
    const outputMode = container.querySelector<HTMLSelectElement>('select[aria-label="Select and Mask output mode"]');
    const applyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply Select and Mask output"]');

    expect(shiftEdge).not.toBeNull();
    expect(smartRadius).not.toBeNull();
    expect(decontaminateColors).not.toBeNull();
    expect(decontaminateAmount).not.toBeNull();
    expect(outputMode).not.toBeNull();
    expect(applyButton).not.toBeNull();

    act(() => {
      if (shiftEdge) {
        setNumberInputValue(shiftEdge, '1');
      }
      if (smartRadius) {
        setNumberInputValue(smartRadius, '7');
      }
      decontaminateColors?.click();
      if (decontaminateAmount) {
        setNumberInputValue(decontaminateAmount, '0.35');
      }
    });

    expect(useImageEditorStore.getState().selectAndMaskSettings).toMatchObject({
      refineRadius: 7,
      decontaminateColors: true,
      decontaminateAmount: 0.35,
    });

    act(() => {
      if (outputMode) {
        outputMode.value = 'selection';
        outputMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applyButton?.click();
    });

    expect(maskBoundingBox(getSelection(doc.id)!)).toEqual({ x: 1, y: 1, width: 5, height: 5 });
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });

    act(() => {
      setSelection(doc.id, baseSelection);
      useImageEditorStore.getState().setHasSelection(doc.id, true);
      if (outputMode) {
        outputMode.value = 'quickMask';
        outputMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applyButton?.click();
    });

    expect(useImageEditorStore.getState().quickMaskSettings.enabled).toBe(true);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'selection',
      docId: doc.id,
    });

    act(() => {
      setSelection(doc.id, baseSelection);
      useImageEditorStore.getState().setHasSelection(doc.id, true);
      if (outputMode) {
        outputMode.value = 'layerMask';
        outputMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applyButton?.click();
    });

    const maskedLayer = useImageEditorStore.getState().getActiveDocument()?.layers.find((layer) => layer.id === 'layer-1');
    const maskImageData = maskedLayer?.mask ? getBitmapImageData(maskedLayer.mask as LayerBitmap) : null;
    expect(maskedLayer?.mask).not.toBeNull();
    expect(maskImageData?.data[(2 * 7 + 2) * 4 + 3]).toBe(255);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'layerOp',
      docId: doc.id,
    });

    act(() => {
      setSelection(doc.id, baseSelection);
      useImageEditorStore.getState().setHasSelection(doc.id, true);
      if (outputMode) {
        outputMode.value = 'newAlphaChannel';
        outputMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      applyButton?.click();
    });

    expect(useImageEditorStore.getState().getActiveDocument()?.savedSelectionChannels).toHaveLength(1);
    expect(useImageEditorStore.getState().undoStacks[doc.id]?.at(-1)).toMatchObject({
      kind: 'documentState',
      docId: doc.id,
    });
  });

  it('refuses Select and Mask layer-mask output on a linked consumer without mutating it', () => {
    const sourceMask = new OffscreenCanvas(4, 4) as unknown as LayerBitmap;
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-select-and-mask-linked',
        title: 'Select and Mask linked',
        width: 7,
        height: 7,
      }),
      layers: [
        makeImageLayer({ id: 'source', name: 'Mask source', mask: sourceMask }),
        makeImageLayer({ id: 'consumer', name: 'Linked consumer', maskLinkSourceLayerId: 'source' }),
      ],
      activeLayerId: 'consumer',
    };
    useImageEditorStore.getState().openDocument(doc);

    const baseSelection = createMask(7, 7);
    setRect(baseSelection, 2, 2, 3, 3, 255, false);
    setSelection(doc.id, baseSelection);
    useImageEditorStore.getState().setHasSelection(doc.id, true);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const outputMode = container.querySelector<HTMLSelectElement>('select[aria-label="Select and Mask output mode"]');
    const applyButton = container.querySelector<HTMLButtonElement>('button[aria-label="Apply Select and Mask output"]');
    expect(outputMode).not.toBeNull();
    expect(applyButton).not.toBeNull();

    act(() => {
      if (outputMode) {
        outputMode.value = 'layerMask';
        outputMode.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(applyButton?.disabled).toBe(true);
    const refusal = container.querySelector('[data-testid="select-and-mask-refusal"]');
    expect(refusal?.textContent).toContain('Unlink it into an independent copy first');

    act(() => {
      applyButton?.click();
    });

    const currentDoc = useImageEditorStore.getState().getActiveDocument();
    const consumer = currentDoc?.layers.find((layer) => layer.id === 'consumer');
    expect(consumer).toMatchObject({ mask: null, maskLinkSourceLayerId: 'source' });
    expect(useImageEditorStore.getState().undoStacks[doc.id] ?? []).toHaveLength(0);
    expect(useImageEditorStore.getState().selectAndMaskSettings.enabled).toBe(false);
    expect(Array.from(getSelection(doc.id)?.data ?? [])).toEqual(Array.from(baseSelection.data));
  });

  it('applies selection refinement operations from the Channels panel as undoable selection history', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-refine',
      title: 'Refine',
      width: 7,
      height: 7,
    });
    useImageEditorStore.getState().openDocument(doc);

    const baseSelection = createMask(7, 7);
    setRect(baseSelection, 2, 2, 3, 3, 255, false);
    setSelection('doc-refine', baseSelection);
    useImageEditorStore.getState().setHasSelection('doc-refine', true);

    act(() => {
      root.render(<ImageEditorChannelsPanel />);
    });

    const radiusInput = container.querySelector<HTMLInputElement>('input[aria-label="Selection refinement radius"]');
    expect(radiusInput).not.toBeNull();

    act(() => {
      if (radiusInput) {
        radiusInput.value = '2';
        radiusInput.dispatchEvent(new Event('input', { bubbles: true }));
        radiusInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    const cases = [
      { ariaLabel: 'Grow selection', expected: growSelection(baseSelection, 2) },
      { ariaLabel: 'Shrink selection', expected: shrinkSelection(baseSelection, 2) },
      { ariaLabel: 'Feather selection', expected: featherSelection(baseSelection, 2) },
      { ariaLabel: 'Border selection', expected: borderSelection(baseSelection, 2) },
      { ariaLabel: 'Smooth selection', expected: smoothSelection(baseSelection) },
    ];

    for (const testCase of cases) {
      act(() => {
        setSelection('doc-refine', baseSelection);
        useImageEditorStore.getState().setHasSelection('doc-refine', true);
      });

      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${testCase.ariaLabel}"]`);
      expect(button).not.toBeNull();

      act(() => {
        button?.click();
      });

      if (maskBoundingBox(testCase.expected)) {
        expect(Array.from(getSelection('doc-refine')?.data ?? [])).toEqual(Array.from(testCase.expected.data));
      } else {
        expect(getSelection('doc-refine')).toBeUndefined();
      }
      expect(useImageEditorStore.getState().undoStacks['doc-refine']?.at(-1)).toMatchObject({
        kind: 'selection',
        docId: 'doc-refine',
      });
    }
  });
});
