import { createCanvas } from 'canvas';
import { initializeCanvas, readPsd, writePsdUint8Array, type Psd } from 'ag-psd';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  attachSmartObjectPsdInterchange,
  readSmartObjectPsdInterchange,
  writeSmartObjectPsdInterchange,
  type SmartObjectPsdRecord,
} from './SmartObjectPsd';

const sourceBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

function makeRecord(overrides?: Partial<SmartObjectPsdRecord>): SmartObjectPsdRecord {
  return {
    source: {
      id: '20953ddb-9391-11ec-b4f1-c15674f50bc4',
      name: 'asset.png',
      mimeType: 'image/png',
      bytes: sourceBytes,
    },
    placement: {
      transform: [3, 4, 35, 4, 35, 44, 3, 44],
      width: 32,
      height: 40,
    },
    filters: [{ kind: 'gaussian-blur', radius: 3 }],
    ...overrides,
  };
}

function makePsd(): Psd {
  const canvas = createCanvas(40, 50);
  const imageData = canvas.getContext('2d').getImageData(0, 0, 40, 50);
  return { width: 40, height: 50, imageData, children: [{ name: 'Smart Layer', imageData }] };
}

describe('SmartObjectPsd', () => {
  beforeAll(() => initializeCanvas(createCanvas as unknown as (width: number, height: number) => HTMLCanvasElement));

  it('writes and reads placed-layer structure with exact embedded source bytes', () => {
    const record = makeRecord();
    const interchange = writeSmartObjectPsdInterchange(record);
    const psd = attachSmartObjectPsdInterchange({
      ...makePsd(),
      children: [{
        name: 'Smart Layer',
        imageData: makePsd().imageData,
        ...interchange,
      }],
    }, [record]);

    const bytes = writePsdUint8Array(psd);
    const readback = readPsd(bytes, { useImageData: true, skipCompositeImageData: true });
    const [layer] = readSmartObjectPsdInterchange(readback);

    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(layer.interchange.previewOnly).toBe(false);
    expect(layer.interchange.placement).toMatchObject({
      transform: record.placement.transform,
      width: 32,
      height: 40,
    });
    expect(layer.interchange.source?.bytes).toEqual(sourceBytes);
    expect(layer.interchange.source?.mimeType).toBe('image/png');
    expect(layer.interchange.filters).toEqual([{ kind: 'gaussian-blur', radius: 3, enabled: true }]);
    expect(readback.linkedFiles?.[0]?.data).toEqual(sourceBytes);
  });

  it('accepts non-empty linked-file bytes after a real PSD write/read', () => {
    const record = makeRecord({ filters: [] });
    const interchange = writeSmartObjectPsdInterchange(record);
    const psd = {
      ...makePsd(),
      children: [{ name: 'Positive Smart Layer', imageData: makePsd().imageData, ...interchange }],
      linkedFiles: [interchange.linkedFile],
    } satisfies Psd;

    const readback = readPsd(writePsdUint8Array(psd), { useImageData: true, skipCompositeImageData: true });
    const [layer] = readSmartObjectPsdInterchange(readback);

    expect(layer.interchange.previewOnly).toBe(false);
    expect(layer.interchange.source?.bytes.byteLength).toBe(sourceBytes.byteLength);
    expect(layer.interchange.source?.bytes).toEqual(sourceBytes);
  });

  it('fails closed for empty linked-file bytes after a real PSD write/read', () => {
    const record = makeRecord({ filters: [] });
    const interchange = writeSmartObjectPsdInterchange(record);
    const psd = {
      ...makePsd(),
      children: [{ name: 'Empty Smart Layer', imageData: makePsd().imageData, ...interchange }],
      linkedFiles: [{ ...interchange.linkedFile, data: new Uint8Array() }],
    } satisfies Psd;

    const readback = readPsd(writePsdUint8Array(psd), { useImageData: true, skipCompositeImageData: true });
    const [layer] = readSmartObjectPsdInterchange(readback);

    expect(readback.linkedFiles?.[0]?.data?.byteLength).toBe(0);
    expect(layer.interchange.previewOnly).toBe(true);
    expect(layer.interchange.source).toBeNull();
    expect(layer.interchange.reason).toContain('empty embedded bytes');
  });

  it('round-trips box blur and deduplicates a linked source id', () => {
    const record = makeRecord({ filters: [{ kind: 'box-blur', radius: 2, enabled: false }] });
    const interchange = writeSmartObjectPsdInterchange(record);
    const psd = attachSmartObjectPsdInterchange({
      ...makePsd(),
      children: [{ name: 'Smart Layer', imageData: makePsd().imageData, ...interchange }],
      linkedFiles: [interchange.linkedFile],
    }, [record]);

    const readback = readPsd(writePsdUint8Array(psd), { useImageData: true, skipCompositeImageData: true });
    const [layer] = readSmartObjectPsdInterchange(readback);

    expect(readback.linkedFiles).toHaveLength(1);
    expect(layer.interchange.filters).toEqual([{ kind: 'box-blur', radius: 2, enabled: false }]);
  });

  it('degrades missing linked files and unsupported filters to an explicit preview-only record', () => {
    const record = makeRecord({ filters: [] });
    const interchange = writeSmartObjectPsdInterchange(record);
    const malformed = {
      ...makePsd(),
      children: [{
        name: 'Broken Smart Layer',
        imageData: makePsd().imageData,
        placedLayer: {
          ...interchange.placedLayer,
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          filter: {
            enabled: true,
            validAtPosition: true,
            maskEnabled: false,
            maskLinked: false,
            maskExtendWithWhite: false,
            list: [{
              type: 'motion blur' as const,
              filter: { angle: 0, distance: { value: 4, units: 'Pixels' as const } },
              name: 'Motion Blur', opacity: 1, blendMode: 'normal' as const, enabled: true,
              hasOptions: true, foregroundColor: { r: 0, g: 0, b: 0 }, backgroundColor: { r: 255, g: 255, b: 255 },
            }],
          },
        },
      }],
      linkedFiles: [interchange.linkedFile],
    } as Psd;

    const [layer] = readSmartObjectPsdInterchange(malformed);
    expect(layer.interchange.previewOnly).toBe(true);
    expect(layer.interchange.source).toBeNull();
    expect(layer.interchange.unsupportedFilters).toEqual(['motion blur']);
    expect(layer.interchange.reason).toContain('missing');
  });

  it('refuses invalid placements and oversized or empty source bytes before writing', () => {
    expect(() => writeSmartObjectPsdInterchange(makeRecord({
      placement: { transform: [0, 0], width: 2, height: 2 },
    }))).toThrow('eight finite transform coordinates');
    expect(() => writeSmartObjectPsdInterchange(makeRecord({
      source: { ...makeRecord().source, bytes: new Uint8Array() },
    }))).toThrow('must not be empty');
  });

  it('refuses conflicting linked-file bytes for one source id', () => {
    const first = makeRecord();
    const second = makeRecord({ source: { ...first.source, bytes: new Uint8Array([9, 8, 7]) } });
    expect(() => attachSmartObjectPsdInterchange({ ...makePsd(), linkedFiles: [] }, [first, second]))
      .toThrow('linkedFiles id collision');
  });

  it('degrades duplicate linked-file ids instead of guessing which bytes to use', () => {
    const record = makeRecord();
    const interchange = writeSmartObjectPsdInterchange(record);
    const duplicate = { ...interchange.linkedFile, data: new Uint8Array([7, 7, 7]) };
    const [layer] = readSmartObjectPsdInterchange({
      ...makePsd(),
      children: [{ name: 'Ambiguous Smart Layer', imageData: makePsd().imageData, ...interchange }],
      linkedFiles: [interchange.linkedFile, duplicate],
    });

    expect(layer.interchange.previewOnly).toBe(true);
    expect(layer.interchange.source).toBeNull();
    expect(layer.interchange.reason).toContain('duplicate');
  });
});
