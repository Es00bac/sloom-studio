import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { paintImageMultiShotPreview, type ImageMultiShotResult } from './ImageMultiShotStacking';
import { ImageMultiShotStackingPanel } from './ImageMultiShotStackingPanel';

describe('ImageMultiShotStackingPanel', () => {
  beforeEach(() => {
    const first = createEmptyImageDocument({ id: 'stack-a', title: 'Bracket A', width: 640, height: 480 });
    const second = createEmptyImageDocument({ id: 'stack-b', title: 'Bracket B', width: 640, height: 480 });
    useImageEditorStore.setState({ documents: [first, second], activeDocId: first.id, undoStacks: {}, redoStacks: {} });
  });

  it('mounts all three bounded multi-shot routes with source selection, preview, cancel, and editable creation controls', () => {
    const html = renderToStaticMarkup(<ImageMultiShotStackingPanel />);
    expect(html).toContain('Multi-shot stack');
    expect(html).toContain('HDR merge');
    expect(html).toContain('Panorama stitch');
    expect(html).toContain('Focus stack');
    expect(html).toContain('Bracket A');
    expect(html).toContain('aria-label="Preview multi-shot stack"');
    expect(html).toContain('aria-label="Create editable multi-shot image"');
    expect(html).toContain('Previews are disposable');
  });

  it('paints previews through a context-created native ImageData object', () => {
    const nativeImageData = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray(8),
      colorSpace: 'srgb',
    } as ImageData;
    let painted: ImageData | null = null;
    const context = {
      createImageData(width: number, height: number) {
        expect({ width, height }).toEqual({ width: 2, height: 1 });
        return nativeImageData;
      },
      putImageData(imageData: ImageData) {
        if (imageData !== nativeImageData) throw new TypeError('parameter 1 is not of type ImageData');
        painted = imageData;
      },
    } as unknown as Pick<CanvasRenderingContext2D, 'createImageData' | 'putImageData'>;
    const result: ImageMultiShotResult = {
      mode: 'hdr',
      pixels: { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]) },
      description: 'test preview',
      sourceIds: ['a', 'b'],
    };

    paintImageMultiShotPreview(context, result);

    expect(painted).toBe(nativeImageData);
    expect(Array.from(nativeImageData.data)).toEqual(Array.from(result.pixels.data));
  });
});
