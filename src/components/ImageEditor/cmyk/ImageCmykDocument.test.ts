import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertImageCmykPixelBuffer,
  createImageCmykPixelBuffer,
  decodeImageCmykPixelBuffer,
  convertImageCmykaBytesToRgba,
  convertImageRgbaBytesToCmyka,
  editImageCmykPlate,
  encodeImageCmykPixelBuffer,
  extractImageCmykPlate,
  imageCmykPixelBufferEquals,
  exportImageDocumentCmykTiff,
} from './ImageCmykDocument';
import { encodeImageCmykTiff, decodeImageCmykTiff } from './cmykTiff';
import { serializeSlimg, deserializeSlimg, type SlimgCodec } from '../ImageSlimgFormat';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../../types/imageEditor';
import { imageDocumentToBlob } from '../ImageDocumentExport';

const profile = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const identity = {
  source: { kind: 'bundled' as const, id: 'fogra39' },
  id: 'fogra39',
  label: 'FOGRA39',
  url: '/icc/FOGRA39L_coated.icc',
  outputConditionId: 'FOGRA39',
};

const persistenceCodec: SlimgCodec = {
  encode: async (bitmap) => new Uint8Array([bitmap.width, bitmap.height, 91]),
  decode: async (_bytes, width, height) => ({ width, height } as unknown as LayerBitmap),
};

describe('native CMYK document authority', () => {
  it('keeps a five-channel C/M/Y/K/alpha shape and rejects malformed buffers', () => {
    const buffer = createImageCmykPixelBuffer(2, 1, new Uint8Array([1, 2, 3, 4, 255, 5, 6, 7, 8, 128]));
    expect(buffer.model).toBe('cmyk');
    expect(() => assertImageCmykPixelBuffer({ ...buffer, data: new Uint8Array(8) })).toThrow(/dimensions/i);
  });

  it('round-trips authority bytes with a self-describing bounded payload', () => {
    const source = createImageCmykPixelBuffer(2, 1, new Uint8Array([1, 2, 3, 4, 255, 250, 240, 230, 220, 128]));
    const reopened = decodeImageCmykPixelBuffer(encodeImageCmykPixelBuffer(source));
    expect(imageCmykPixelBufferEquals(reopened, source)).toBe(true);
    expect(() => decodeImageCmykPixelBuffer('sloom-cmyka-u8-2x1:AAAA')).toThrow(/dimensions/i);
  });

  it('edits one plate without touching other ink or alpha samples', () => {
    const source = createImageCmykPixelBuffer(2, 1, new Uint8Array([1, 2, 3, 4, 255, 5, 6, 7, 8, 128]));
    const edited = editImageCmykPlate(source, 'k', () => 200);
    expect(Array.from(edited.data)).toEqual([1, 2, 3, 200, 255, 5, 6, 7, 200, 128]);
    expect(Array.from(extractImageCmykPlate(edited, 'k'))).toEqual([200, 200]);
  });

  it('uses real Little-CMS values for RGB red/white/black and preserves alpha on round trip', async () => {
    const ink = await convertImageRgbaBytesToCmyka(new Uint8Array([
      255, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 128,
    ]), 3, 1, profile, { intent: 'relative', blackPointCompensation: true });
    expect(ink.data[0]).toBeLessThanOrEqual(8);
    expect(ink.data[1]).toBeGreaterThanOrEqual(220);
    expect(ink.data[2]).toBeGreaterThanOrEqual(220);
    expect(Array.from(ink.data.slice(5, 10))).toEqual([0, 0, 0, 0, 255]);
    expect(ink.data[14]).toBe(128);
    const rgb = await convertImageCmykaBytesToRgba(ink, profile, { intent: 'relative', blackPointCompensation: true });
    expect(rgb[3]).toBe(255);
    expect(rgb[7]).toBe(255);
    expect(rgb[11]).toBe(128);
  });

  it('emits and reimports DeviceCMYK TIFF without changing CMYKA bytes', () => {
    const source = createImageCmykPixelBuffer(2, 1, new Uint8Array([1, 2, 3, 4, 255, 250, 240, 230, 220, 128]));
    const encoded = encodeImageCmykTiff(source, identity, profile);
    expect(encoded.bytes[0]).toBe(0x49);
    expect(decodeImageCmykTiff(encoded.bytes).buffer.data).toEqual(source.data);
  });

  it('refuses a profile-less or oversized authority before pretending it is exportable', () => {
    const source = createImageCmykPixelBuffer(1, 1, new Uint8Array(5));
    expect(() => encodeImageCmykTiff(source, identity, new Uint8Array(127))).toThrow(/ICC/i);
    expect(() => createImageCmykPixelBuffer(2896, 2896)).not.toThrow();
    expect(() => createImageCmykPixelBuffer(2897, 2897)).toThrow(/limited/i);
  });

  it('persists native CMYKA authority and profile metadata through the editable .slimg container', async () => {
    const authority = createImageCmykPixelBuffer(1, 1, new Uint8Array([12, 34, 56, 78, 255]));
    const source = {
      id: 'cmyk-persist', name: 'CMYK', width: 1, height: 1, activeLayerId: 'layer',
      layers: [{ id: 'layer', name: 'Ink', type: 'image', visible: true, opacity: 1, bitmap: { width: 1, height: 1 } as LayerBitmap, cmykPixels: authority }],
      metadata: {
        colorMode: 'cmyk' as const,
        cmyk: {
          profileId: identity.id,
          profileLabel: identity.label,
          profileSource: identity.source,
          intent: 'relative' as const,
          blackPointCompensation: true,
          paperWhiteSimulation: false,
        },
      },
    } as unknown as ImageDocument;
    const reopened = await deserializeSlimg(await serializeSlimg(source, persistenceCodec), persistenceCodec);
    expect(reopened.metadata?.colorMode).toBe('cmyk');
    expect(reopened.metadata?.cmyk?.profileId).toBe(identity.id);
    expect(reopened.layers[0]?.cmykPixels?.data).toEqual(authority.data);
    expect(reopened.layers[0]?.cmykPixelsData).toBeUndefined();
  });

  it('routes native TIFF export through DeviceCMYK instead of flattening the RGB proxy', async () => {
    const authority = createImageCmykPixelBuffer(1, 1, new Uint8Array([12, 34, 56, 78, 255]));
    const profileBytesData = btoa(String.fromCharCode(...profile));
    const source = {
      id: 'cmyk-export', name: 'CMYK', title: 'native', width: 1, height: 1, activeLayerId: 'layer',
      layers: [{ id: 'layer', name: 'Ink', type: 'image', visible: true, opacity: 1, bitmap: null, cmykPixels: authority }],
      metadata: {
        colorMode: 'cmyk' as const,
        cmyk: {
          profileId: 'imported-profile', profileLabel: 'Imported FOGRA39',
          profileSource: { kind: 'imported' as const, assetId: 'icc-asset', sha256: 'a'.repeat(64) },
          profileBytesData, intent: 'relative' as const, blackPointCompensation: true,
        },
      },
    } as unknown as ImageDocument;
    const output = await imageDocumentToBlob(source, 'image/tiff');
    expect(output.type).toBe('image/tiff');
    expect(new Uint8Array(await output.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0x49, 0x49]));
  });

  it('refuses positioned, masked, and non-normal-blend layers instead of exporting a divergent CMYK composite', () => {
    const authority = createImageCmykPixelBuffer(1, 1, new Uint8Array([12, 34, 56, 78, 255]));
    const source = {
      id: 'cmyk-composite-refusal', name: 'CMYK', width: 1, height: 1, activeLayerId: 'layer',
      layers: [{ id: 'layer', name: 'Ink', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, bitmapVersion: 0, mask: null, cmykPixels: authority }],
      metadata: {
        colorMode: 'cmyk' as const,
        cmyk: { profileId: identity.id, profileLabel: identity.label, profileSource: identity.source, intent: 'relative' as const, blackPointCompensation: true },
      },
    } as unknown as ImageDocument;
    for (const [patch, label] of [
      [{ x: 1 }, 'Offset ink'],
      [{ mask: {} }, 'Masked ink'],
      [{ blendMode: 'multiply' }, 'Multiply ink'],
    ] as const) {
      const layer = { ...source.layers[0]!, ...patch, name: label } as unknown as ImageLayer;
      expect(() => exportImageDocumentCmykTiff({ ...source, layers: [layer] }, identity, profile)).toThrow(/native ink-space exporter/i);
    }
  });
});
