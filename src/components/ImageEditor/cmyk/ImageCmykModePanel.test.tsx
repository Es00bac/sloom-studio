// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../../store/imageEditorStore';
import type { LayerBitmap } from '../../../types/imageEditor';
import { ImageCmykModePanel } from './ImageCmykModePanel';

vi.mock('./cmykProfiles', () => ({
  loadBundledImageCmykProfile: vi.fn(async () => ({
    bytes: new Uint8Array([1, 2, 3]),
    identity: {
      id: 'fogra39',
      label: 'FOGRA39',
      source: { kind: 'bundled', id: 'fogra39' },
    },
  })),
  resolveBundledImageCmykProfile: vi.fn(() => ({ id: 'fogra39', label: 'FOGRA39' })),
}));

vi.mock('../LayerBitmap', async (importOriginal) => ({
  ...await importOriginal<typeof import('../LayerBitmap')>(),
  getBitmapImageData: vi.fn(() => ({
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([12, 34, 56, 255]),
  })),
}));

vi.mock('../ImageColorProof', () => ({
  executeImageIccSoftProof: vi.fn(async () => ({
    rgba: new Uint8Array([18, 52, 86, 255]),
    gamutWarnings: [true],
    outOfGamutPixels: 1,
  })),
}));

describe('ImageCmykModePanel refusals', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const doc = {
      ...createEmptyImageDocument({ id: 'cmyk-refusal', title: 'Proof', width: 1, height: 1 }),
      layers: [{
        id: 'proof-layer',
        name: 'Proof layer',
        type: 'image' as const,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal' as const,
        x: 0,
        y: 0,
        bitmap: { width: 1, height: 1 } as LayerBitmap,
        bitmapVersion: 1,
        mask: null,
      }],
      activeLayerId: 'proof-layer',
    };
    useImageEditorStore.setState({ documents: [doc], activeDocId: doc.id });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders a dispatcher or store CMYK refusal in the mounted mode controls', () => {
    act(() => root.render(<ImageCmykModePanel />));
    act(() => window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
      detail: { tool: 'liquify', disclosure: 'Liquify is refused for native CMYK; no ink authority changed.' },
    })));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('Liquify is refused');
  });

  it('renders the executed ICC RGBA proof with its gamut-warning overlay without mutating the document', async () => {
    await act(async () => root.render(<ImageCmykModePanel />));
    const before = useImageEditorStore.getState().getActiveDocument();
    const button = container.querySelector('[aria-label="Run real ICC soft proof and gamut check"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const preview = container.querySelector('[data-image-icc-proof-preview]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('data-gamut-warning-pixels')).toBe('1');
    expect(preview?.querySelector('canvas')?.getAttribute('aria-label')).toContain('read-only ICC soft proof');
    expect(useImageEditorStore.getState().getActiveDocument()).toBe(before);
  });
});
