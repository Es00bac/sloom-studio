import { describe, expect, it } from 'vitest';
import { openSlimgDocument, saveImageDocumentAsSlimg, slimgPixelCodec } from './ImageSlimgCodec';
import { assertPngBytesMatchDimensions } from './LayerBitmap';

// The encode/decode use browser canvas APIs (convertToBlob / createImageBitmap) that the Node test
// env lacks, so they're exercised in-app; here we guard that the module loads and exposes its
// contract (the structural serialization it drives is fully unit-tested in ImageSlimgFormat.test.ts).
describe('ImageSlimgCodec', () => {
  it('exposes a pixel codec and save/open helpers', () => {
    expect(typeof slimgPixelCodec.encode).toBe('function');
    expect(typeof slimgPixelCodec.decode).toBe('function');
    expect(typeof saveImageDocumentAsSlimg).toBe('function');
    expect(typeof openSlimgDocument).toBe('function');
  });

  it('rejects hostile PNG dimensions before browser image allocation', () => {
    const header = new Uint8Array(24);
    header.set([137, 80, 78, 71, 13, 10, 26, 10]);
    header.set(new TextEncoder().encode('IHDR'), 12);
    const view = new DataView(header.buffer);
    view.setUint32(16, 64, false);
    view.setUint32(20, 48, false);

    expect(() => assertPngBytesMatchDimensions(header, 64, 48)).not.toThrow();
    expect(() => assertPngBytesMatchDimensions(header, 16_384, 16_384)).toThrow(/dimensions.*integrity/i);
  });
});
