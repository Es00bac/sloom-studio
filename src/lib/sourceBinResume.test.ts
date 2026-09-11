import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadImportedAssetForBoundedRead,
  loadImportedAssetAsDataUrl,
  loadImportedAssetBlob,
  materializeBoundedStoredAssetUrl,
  releaseBoundedStoredAssetUrl,
} from './assetStore';
import {
  BINARY_RESUME_SAMPLE_BYTES,
  MAX_BINARY_RESUME_BYTES,
  sniffBinaryResumeSample,
} from './binaryResumeSniffer';
import {
  TERRA_SKELETAL_MP4_BASE64,
  asciiIsoBytes,
  buildMinimalIsoBmffFixture,
  concatIsoBytes,
  isoBox,
} from './isoBmffResumeFixtures.testSupport';
import { validateSourceBinResumeItem } from './sourceBinResume';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';

vi.mock('./assetStore', () => ({
  loadImportedAssetForBoundedRead: vi.fn(),
  loadImportedAssetAsDataUrl: vi.fn(),
  loadImportedAssetBlob: vi.fn(),
  materializeBoundedStoredAssetUrl: vi.fn((asset: { dataUrl?: string; blob?: Blob }) => (
    asset.dataUrl ?? (asset.blob ? 'blob:bounded-resume' : undefined)
  )),
  releaseBoundedStoredAssetUrl: vi.fn(),
}));

const VALID_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TRUNCATED_CONTAINER_PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAAAAAA';
const VALID_GIF_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const VALID_WEBP_DATA_URL = 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const VALID_JPEG_DATA_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';
const VALID_MP4_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMXbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAACgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAIAAAACAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAoAAAAAAABAAAAAAG5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABZG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAIAAgBIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDEgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2V+IiMBEAAADAAQAAAMAyDxIllgBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAACKegAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAEAAAIAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAABAAAAAQAAABRzdHN6AAAAAAAAAsUAAAABAAAAFHN0Y28AAAAAAAAAAQAAA0cAAABidWR0YQAAAFptZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAC1pbHN0AAAAJal0b28AAAAdZGF0YQAAAAEAAAAATGF2ZjYyLjEyLjEwMQAAAAhmcmVlAAACzW1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEACv//vZzfAprbbGB';

function bytesFromDataUrl(value: string): Uint8Array {
  return Uint8Array.from(atob(value.slice(value.indexOf(',') + 1)), (character) => character.charCodeAt(0));
}

function dataUrl(mimeType: string, bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function ownedBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function validMp4Bytes(): Uint8Array {
  const truncated = Uint8Array.from(atob(VALID_MP4_BASE64), (character) => character.charCodeAt(0));
  const bytes = new Uint8Array(truncated.length + 3);
  bytes.set(truncated);
  return bytes;
}

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set([...type].map((character) => character.charCodeAt(0)), 4);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, pngCrc(chunk.subarray(4, 8 + payload.length)));
  return chunk;
}

function joinedBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function completeBinarySample(bytes: Uint8Array) {
  return { head: bytes, tail: bytes, size: bytes.length, tailOffset: 0 };
}

function terraSkeletalMp4Bytes(): Uint8Array {
  return Uint8Array.from(atob(TERRA_SKELETAL_MP4_BASE64), (character) => character.charCodeAt(0));
}

function malformedPngFixtures(): readonly [string, Uint8Array][] {
  const valid = bytesFromDataUrl(VALID_PNG_DATA_URL);
  const badCrc = Uint8Array.from(valid);
  badCrc[29] ^= 0x01;
  const ihdr = valid.subarray(0, 33);
  const overflow = joinedBytes(ihdr, Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x49, 0x44, 0x41, 0x54]));
  return [
    ['the exact 33-byte Terra probe', bytesFromDataUrl(TRUNCATED_CONTAINER_PNG_DATA_URL)],
    ['a bad IHDR CRC', badCrc],
    ['a missing IHDR CRC', valid.subarray(0, 32)],
    ['a missing IEND CRC', valid.subarray(0, valid.length - 4)],
    ['a zero-length IDAT', joinedBytes(ihdr, pngChunk('IDAT', new Uint8Array()), pngChunk('IEND', new Uint8Array()))],
    ['a truncated IDAT payload', valid.subarray(0, 40)],
    ['a missing IEND', valid.subarray(0, valid.length - 12)],
    ['an overflowing chunk length', overflow],
  ];
}

function validWavBytes(): Uint8Array {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => [...value].forEach((character, index) => {
    bytes[offset + index] = character.charCodeAt(0);
  });
  write(0, 'RIFF');
  view.setUint32(4, 38, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, 2, true);
  return bytes;
}

function validZipBytes(): Uint8Array {
  const bytes = new Uint8Array(101);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  u32(0, 0x04034b50); u16(4, 20); u16(8, 0); u32(14, 0x8cdc1683); u32(18, 1); u32(22, 1); u16(26, 1);
  bytes[30] = 0x61; bytes[31] = 0x78;
  const central = 32;
  u32(central, 0x02014b50); u16(central + 4, 20); u16(central + 6, 20); u32(central + 16, 0x8cdc1683);
  u32(central + 20, 1); u32(central + 24, 1); u16(central + 28, 1); u32(central + 42, 0); bytes[central + 46] = 0x61;
  const eocd = 79;
  u32(eocd, 0x06054b50); u16(eocd + 8, 1); u16(eocd + 10, 1); u32(eocd + 12, 47); u32(eocd + 16, 32);
  return bytes;
}

function sourceItem(overrides: Partial<SourceBinLibraryItem> = {}): SourceBinLibraryItem {
  return {
    id: 'source-item-1',
    label: 'Cached result',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: VALID_PNG_DATA_URL,
    createdAt: 1,
    originNodeId: 'target',
    envelopeId: 'envelope-1',
    envelopeIndex: 0,
    ...overrides,
  };
}

describe('Source Bin paid-run resume validation', () => {
  beforeEach(() => {
    vi.mocked(loadImportedAssetForBoundedRead).mockReset().mockResolvedValue(undefined);
    vi.mocked(loadImportedAssetAsDataUrl).mockReset().mockResolvedValue(undefined);
    vi.mocked(loadImportedAssetBlob).mockReset().mockResolvedValue(undefined);
    vi.mocked(materializeBoundedStoredAssetUrl).mockReset().mockImplementation((asset: { dataUrl?: string; blob?: Blob }) => (
      asset.dataUrl ?? (asset.blob ? 'blob:bounded-resume' : undefined)
    ));
    vi.mocked(releaseBoundedStoredAssetUrl).mockReset();
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['PNG', 'image/png', VALID_PNG_DATA_URL],
    ['JPEG', 'image/jpeg', VALID_JPEG_DATA_URL],
    ['GIF', 'image/gif', VALID_GIF_DATA_URL],
    ['WebP', 'image/webp', VALID_WEBP_DATA_URL],
  ])('accepts a structurally valid %s inline image', async (_format, mimeType, assetUrl) => {
    await expect(validateSourceBinResumeItem(sourceItem({ mimeType, assetUrl }), 'image')).resolves.toMatchObject({
      kind: 'image',
      value: assetUrl,
      mimeType,
    });
  });

  it('accepts a valid inline payload with bounded ASCII base64 whitespace', async () => {
    const [prefix, payload] = VALID_PNG_DATA_URL.split(',');
    const assetUrl = `${prefix}, ${payload.match(/.{1,4}/g)?.join(' \n') ?? payload}`;
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl }), 'image')).resolves.toMatchObject({
      kind: 'image', value: assetUrl, mimeType: 'image/png',
    });
  });

  it.each([
    ['image', sourceItem(), 'image/png'],
    ['audio', sourceItem({ kind: 'audio', mimeType: 'audio/wav', assetUrl: dataUrl('audio/wav', validWavBytes()) }), 'audio/wav'],
    ['video', sourceItem({ kind: 'video', mimeType: 'video/mp4', assetUrl: dataUrl('video/mp4', validMp4Bytes()) }), 'video/mp4'],
    ['package', sourceItem({ kind: 'package', mimeType: 'application/zip', assetUrl: dataUrl('application/zip', validZipBytes()) }), 'application/zip'],
  ] as const)('accepts a valid inline %s resume without widening its type', async (kind, item, mimeType) => {
    await expect(validateSourceBinResumeItem(item, kind)).resolves.toMatchObject({ kind, mimeType });
  });

  it('preserves non-binary text semantics and rejects an empty metadata shell', async () => {
    const item = sourceItem({ kind: 'text', mimeType: 'text/plain', text: '   ', assetUrl: 'data:text/plain,metadata-only' });
    await expect(validateSourceBinResumeItem(item, 'text')).resolves.toBeUndefined();
    await expect(validateSourceBinResumeItem({ ...item, text: 'usable text' }, 'text')).resolves.toMatchObject({
      kind: 'text', value: 'usable text', mimeType: 'text/plain',
    });
  });

  it.each([
    ['proven corrupt PNG', 'data:image/png;base64,Y29ycnVwdC1ub3QtYS1wbmc='],
    ['truncated PNG', 'data:image/png;base64,iVBORw0KGgo='],
    ['JPEG bytes claimed as PNG', VALID_JPEG_DATA_URL.replace('image/jpeg', 'image/png')],
    ['WAV audio claimed as video', dataUrl('video/mp4', validWavBytes())],
    ['empty data', 'data:image/png;base64,'],
    ['invalid base64', 'data:image/png;base64,%%%'],
  ])('rejects corrupt, truncated, or mismatched inline bytes: %s', async (_label, assetUrl) => {
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl }), 'image')).resolves.toBeUndefined();
  });

  it.each(malformedPngFixtures())('rejects PNG container corruption inline: %s', async (_label, bytes) => {
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: dataUrl('image/png', bytes) }), 'image'))
      .resolves.toBeUndefined();
  });

  it.each([
    ['JPEG without terminal EOI', 'image' as const, 'image/jpeg', bytesFromDataUrl(VALID_JPEG_DATA_URL).subarray(0, bytesFromDataUrl(VALID_JPEG_DATA_URL).length - 2)],
    ['GIF without its trailer', 'image' as const, 'image/gif', bytesFromDataUrl(VALID_GIF_DATA_URL).subarray(0, bytesFromDataUrl(VALID_GIF_DATA_URL).length - 1)],
    ['WebP with a truncated RIFF payload', 'image' as const, 'image/webp', bytesFromDataUrl(VALID_WEBP_DATA_URL).subarray(0, bytesFromDataUrl(VALID_WEBP_DATA_URL).length - 1)],
    ['WAV with truncated sample data', 'audio' as const, 'audio/wav', validWavBytes().subarray(0, validWavBytes().length - 1)],
  ])('rejects an analogous bounded container truncation: %s', async (_label, kind, mimeType, bytes) => {
    await expect(validateSourceBinResumeItem(sourceItem({ kind, mimeType, assetUrl: dataUrl(mimeType, bytes) }), kind))
      .resolves.toBeUndefined();
  });

  it('rejects source-kind, item-MIME, and filename-extension mismatches', async () => {
    await expect(validateSourceBinResumeItem(sourceItem({ kind: 'video' }), 'image')).resolves.toBeUndefined();
    await expect(validateSourceBinResumeItem(sourceItem({ mimeType: 'video/mp4' }), 'image')).resolves.toBeUndefined();
    await expect(validateSourceBinResumeItem(sourceItem({ scratchFileName: 'cached.jpg' }), 'image')).resolves.toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ownedBuffer(bytesFromDataUrl(VALID_PNG_DATA_URL)), {
      headers: { 'content-type': 'image/png' },
    })));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/cached.jpg' }), 'image'))
      .resolves.toBeUndefined();
  });

  it.each([
    ['corrupt bytes', new TextEncoder().encode('corrupt-not-a-png'), 'image/png'],
    ['truncated header', bytesFromDataUrl(VALID_PNG_DATA_URL).subarray(0, 12), 'image/png'],
    ['JPEG bytes with PNG response MIME', bytesFromDataUrl(VALID_JPEG_DATA_URL), 'image/png'],
    ['audio bytes with video response MIME', validWavBytes(), 'video/mp4'],
  ])('rejects a fetched blob with %s', async (_label, bytes, responseMimeType) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ownedBuffer(bytes), {
      headers: { 'content-type': responseMimeType },
    })));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/cached.png' }), 'image'))
      .resolves.toBeUndefined();
  });

  it('accepts a valid fetched blob after content sniffing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(ownedBuffer(bytesFromDataUrl(VALID_PNG_DATA_URL)), {
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'blob:https://app.test/cached' }), 'image'))
      .resolves.toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects the exact 33-byte probe from a fetched payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(ownedBuffer(bytesFromDataUrl(TRUNCATED_CONTAINER_PNG_DATA_URL)), {
      headers: { 'content-type': 'image/png' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/probe.png' }), 'image'))
      .resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid or unresolvable canonical asset IDs', async () => {
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'bad/id' }), 'image'))
      .resolves.toBeUndefined();
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'asset-missing-1' }), 'image'))
      .resolves.toBeUndefined();
  });

  it('accepts matching, content-sniffed asset-store blob and byte payloads', async () => {
    const pngBytes = bytesFromDataUrl(VALID_PNG_DATA_URL);
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-valid-1', name: 'cached.png', mimeType: 'image/png', size: pngBytes.length, createdAt: 1,
      blob: new Blob([ownedBuffer(pngBytes)], { type: 'image/png' }), dataUrl: VALID_PNG_DATA_URL,
    });
    vi.mocked(loadImportedAssetBlob).mockResolvedValue({
      id: 'asset-valid-1', name: 'cached.png', mimeType: 'image/png', blob: new Blob([ownedBuffer(pngBytes)], { type: 'image/png' }),
    });
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-valid-1', name: 'cached.png', mimeType: 'image/png', dataUrl: VALID_PNG_DATA_URL,
    });
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'asset-valid-1' }), 'image'))
      .resolves.toMatchObject({ kind: 'image', value: VALID_PNG_DATA_URL, mimeType: 'image/png' });
  });

  it('rejects an over-limit data-url-only cached asset before Blob conversion', async () => {
    vi.mocked(loadImportedAssetForBoundedRead).mockImplementation(async (_id, maxBytes) => (
      9 > maxBytes ? undefined : {
        id: 'asset-data-only', name: 'cached.png', mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,QUJDREVGR0k=', size: 9, createdAt: 1,
      }
    ));

    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: undefined, assetId: 'asset-data-only' }),
      'image',
      undefined,
      { maxBinaryBytes: 8, sampleBytes: 8 },
    )).resolves.toBeUndefined();
    expect(loadImportedAssetForBoundedRead).toHaveBeenCalledWith('asset-data-only', 8, 8, undefined);
    expect(loadImportedAssetBlob).not.toHaveBeenCalled();
    expect(loadImportedAssetAsDataUrl).not.toHaveBeenCalled();
  });

  it('rejects an over-limit declared Blob before any byte slice is read', async () => {
    const slice = vi.fn();
    vi.mocked(loadImportedAssetForBoundedRead).mockImplementation(async (_id, maxBytes) => (
      9 > maxBytes ? undefined : {
        id: 'asset-blob-large', name: 'cached.png', mimeType: 'image/png', size: 9, createdAt: 1,
        blob: { size: 9, type: 'image/png', slice } as unknown as Blob,
      }
    ));

    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: undefined, assetId: 'asset-blob-large' }),
      'image',
      undefined,
      { maxBinaryBytes: 8, sampleBytes: 8 },
    )).resolves.toBeUndefined();
    expect(slice).not.toHaveBeenCalled();
  });

  it('samples and hands off an accepted exact-limit Blob without data-URL materialization', async () => {
    const pngBytes = bytesFromDataUrl(VALID_PNG_DATA_URL);
    const blob = new Blob([ownedBuffer(pngBytes)], { type: 'image/png' });
    const slice = vi.spyOn(blob, 'slice');
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-blob-limit', name: 'cached.png', mimeType: 'image/png',
      size: blob.size, createdAt: 1, blob,
    });

    const resume = await validateSourceBinResumeItem(
      sourceItem({ assetUrl: undefined, assetId: 'asset-blob-limit' }),
      'image',
      undefined,
      { maxBinaryBytes: blob.size, sampleBytes: blob.size },
    );
    expect(resume).toMatchObject({ value: 'blob:bounded-resume', mimeType: 'image/png' });
    expect(slice).toHaveBeenCalledTimes(2);
    expect(loadImportedAssetBlob).not.toHaveBeenCalled();
    expect(loadImportedAssetAsDataUrl).not.toHaveBeenCalled();
    resume?.release?.();
    resume?.release?.();
    expect(releaseBoundedStoredAssetUrl).toHaveBeenCalledTimes(1);
    expect(releaseBoundedStoredAssetUrl).toHaveBeenCalledWith('asset-blob-limit', 'blob:bounded-resume');
  });

  it('releases a just-created Blob URL exactly once when cancellation wins the handoff race', async () => {
    const pngBytes = bytesFromDataUrl(VALID_PNG_DATA_URL);
    const blob = new Blob([ownedBuffer(pngBytes)], { type: 'image/png' });
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-cancel-handoff', name: 'cached.png', mimeType: 'image/png',
      size: blob.size, createdAt: 1, blob,
    });
    const controller = new AbortController();
    vi.mocked(materializeBoundedStoredAssetUrl).mockImplementation(() => {
      controller.abort();
      return 'blob:cancelled-handoff';
    });

    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: undefined, assetId: 'asset-cancel-handoff' }),
      'image',
      controller.signal,
      { maxBinaryBytes: blob.size, sampleBytes: blob.size },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(releaseBoundedStoredAssetUrl).toHaveBeenCalledTimes(1);
    expect(releaseBoundedStoredAssetUrl).toHaveBeenCalledWith(
      'asset-cancel-handoff',
      'blob:cancelled-handoff',
    );
  });

  it('rejects a bounded stored payload whose metadata MIME disagrees with its bytes', async () => {
    const pngBytes = bytesFromDataUrl(VALID_PNG_DATA_URL);
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-mime-race', name: 'cached.png', mimeType: 'video/mp4',
      size: pngBytes.length, createdAt: 1,
      blob: new Blob([ownedBuffer(pngBytes)], { type: 'image/png' }),
    });
    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: undefined, assetId: 'asset-mime-race' }), 'image',
    )).resolves.toBeUndefined();
    expect(materializeBoundedStoredAssetUrl).not.toHaveBeenCalled();
  });

  it('rejects the exact 33-byte probe from matching asset-store transports', async () => {
    const probe = bytesFromDataUrl(TRUNCATED_CONTAINER_PNG_DATA_URL);
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-probe-1', name: 'cached.png', mimeType: 'image/png', size: probe.length, createdAt: 1,
      blob: new Blob([ownedBuffer(probe)], { type: 'image/png' }), dataUrl: TRUNCATED_CONTAINER_PNG_DATA_URL,
    });
    vi.mocked(loadImportedAssetBlob).mockResolvedValue({
      id: 'asset-probe-1', name: 'cached.png', mimeType: 'image/png', blob: new Blob([ownedBuffer(probe)], { type: 'image/png' }),
    });
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-probe-1', name: 'cached.png', mimeType: 'image/png', dataUrl: TRUNCATED_CONTAINER_PNG_DATA_URL,
    });
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'asset-probe-1' }), 'image'))
      .resolves.toBeUndefined();
  });

  it.each([
    ['corrupt blob', new TextEncoder().encode('corrupt-not-a-png'), 'image/png'],
    ['truncated blob', bytesFromDataUrl(VALID_PNG_DATA_URL).subarray(0, 12), 'image/png'],
    ['mismatched blob', bytesFromDataUrl(VALID_JPEG_DATA_URL), 'image/png'],
  ])('rejects an asset-store %s before it can resume', async (_label, bytes, mimeType) => {
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-bad-1', name: 'cached.png', mimeType, size: bytes.length, createdAt: 1,
      blob: new Blob([ownedBuffer(bytes)], { type: mimeType }), dataUrl: VALID_PNG_DATA_URL,
    });
    vi.mocked(loadImportedAssetBlob).mockResolvedValue({
      id: 'asset-bad-1', name: 'cached.png', mimeType, blob: new Blob([ownedBuffer(bytes)], { type: mimeType }),
    });
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-bad-1', name: 'cached.png', mimeType, dataUrl: VALID_PNG_DATA_URL,
    });
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'asset-bad-1' }), 'image'))
      .resolves.toBeUndefined();
  });

  it('rejects disagreement between an asset-store blob and its resolved byte payload', async () => {
    const pngBytes = bytesFromDataUrl(VALID_PNG_DATA_URL);
    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-disagree-1', name: 'cached.png', mimeType: 'image/png', size: pngBytes.length, createdAt: 1,
      blob: new Blob([ownedBuffer(pngBytes)], { type: 'image/png' }),
      dataUrl: dataUrl('image/png', new Uint8Array([...pngBytes, 0])),
    });
    vi.mocked(loadImportedAssetBlob).mockResolvedValue({
      id: 'asset-disagree-1', name: 'cached.png', mimeType: 'image/png',
      blob: new Blob([ownedBuffer(bytesFromDataUrl(VALID_PNG_DATA_URL))], { type: 'image/png' }),
    });
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-disagree-1', name: 'cached.png', mimeType: 'image/png',
      dataUrl: dataUrl('image/png', new Uint8Array([...bytesFromDataUrl(VALID_PNG_DATA_URL), 0])),
    });
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: undefined, assetId: 'asset-disagree-1' }), 'image'))
      .resolves.toBeUndefined();
  });

  it.each([
    ['native file', { nativeFilePath: '/project/cache/composition.mp4' }, 'signal-loom-asset://asset/native-composition-1'],
    ['scratch file', { scratchFileName: 'composition.mp4' }, 'signal-loom-asset://file/composition.mp4'],
  ] as const)('accepts a valid content-sniffed %s payload', async (_label, location, assetUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ownedBuffer(validMp4Bytes()), {
      headers: { 'content-type': 'video/mp4' },
    })));
    const item = sourceItem({ kind: 'composition', mimeType: 'video/mp4', assetUrl, ...location });
    await expect(validateSourceBinResumeItem(item, 'video')).resolves.toMatchObject({
      kind: 'video', value: assetUrl, mimeType: 'video/mp4',
    });
  });

  it.each([
    ['native file with corrupt bytes', { nativeFilePath: '/project/cache/cached.png' }, 'signal-loom-asset://file/cached.png', new TextEncoder().encode('corrupt-not-a-png')],
    ['native file with a truncated header', { nativeFilePath: '/project/cache/cached.png' }, 'signal-loom-asset://file/cached.png', bytesFromDataUrl(VALID_PNG_DATA_URL).subarray(0, 12)],
    ['native file with mismatched JPEG bytes', { nativeFilePath: '/project/cache/cached.png' }, 'signal-loom-asset://file/cached.png', bytesFromDataUrl(VALID_JPEG_DATA_URL)],
    ['scratch file with corrupt bytes', { scratchFileName: 'cached.png' }, 'signal-loom-asset://file/cached.png', new TextEncoder().encode('corrupt-not-a-png')],
    ['scratch file with a truncated header', { scratchFileName: 'cached.png' }, 'signal-loom-asset://file/cached.png', bytesFromDataUrl(VALID_PNG_DATA_URL).subarray(0, 12)],
    ['scratch file with mismatched JPEG bytes', { scratchFileName: 'cached.png' }, 'signal-loom-asset://file/cached.png', bytesFromDataUrl(VALID_JPEG_DATA_URL)],
  ] as const)('rejects a %s payload', async (_label, location, assetUrl, bytes) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ownedBuffer(bytes), { headers: { 'content-type': 'image/png' } })));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl, ...location }), 'image')).resolves.toBeUndefined();
  });

  it.each([
    ['native file', { nativeFilePath: '/project/cache/probe.png' }, 'signal-loom-asset://file/probe.png'],
    ['scratch file', { scratchFileName: 'probe.png' }, 'signal-loom-asset://file/probe.png'],
  ] as const)('rejects the exact 33-byte probe from a %s transport', async (_label, location, assetUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      ownedBuffer(bytesFromDataUrl(TRUNCATED_CONTAINER_PNG_DATA_URL)),
      { headers: { 'content-type': 'image/png' } },
    )));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl, ...location }), 'image')).resolves.toBeUndefined();
  });

  it('rejects a structurally truncated ZIP without extracting it', async () => {
    const zip = validZipBytes();
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'package', mimeType: 'application/zip', assetUrl: dataUrl('application/zip', zip.subarray(0, zip.length - 5)),
    }), 'package')).resolves.toBeUndefined();
  });

  it('rejects a stored ZIP entry whose bounded payload disagrees with its CRC', async () => {
    const zip = validZipBytes();
    zip[31] ^= 0x01;
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'package', mimeType: 'application/zip', assetUrl: dataUrl('application/zip', zip),
    }), 'package')).resolves.toBeUndefined();
  });

  it('rejects an ISO-BMFF payload whose final media-data box overflows the available bytes', async () => {
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl: `data:video/mp4;base64,${VALID_MP4_BASE64}`,
    }), 'video')).resolves.toBeUndefined();
  });

  it('rejects the exact 57-byte Terra skeletal MP4', async () => {
    const bytes = terraSkeletalMp4Bytes();
    expect(bytes).toHaveLength(57);
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl: dataUrl('video/mp4', bytes),
    }), 'video')).resolves.toBeUndefined();
  });

  it.each([
    ['MP4/AVC', 'video' as const, 'video/mp4', buildMinimalIsoBmffFixture()],
    ['QuickTime/AVC', 'video' as const, 'video/quicktime', buildMinimalIsoBmffFixture({ brand: 'qt  ' })],
    ['M4V/MPEG-4 Visual', 'video' as const, 'video/mp4', buildMinimalIsoBmffFixture({ brand: 'M4V ', codec: 'mp4v' })],
    ['M4A/AAC', 'audio' as const, 'audio/mp4', buildMinimalIsoBmffFixture({ kind: 'audio', brand: 'M4A ', codec: 'mp4a' })],
  ])('accepts a coherent minimal %s ISO-BMFF artifact', async (_label, kind, mimeType, bytes) => {
    await expect(validateSourceBinResumeItem(sourceItem({
      kind, mimeType, assetUrl: dataUrl(mimeType, bytes),
    }), kind)).resolves.toMatchObject({ kind, mimeType });
  });

  it.each([
    ['a handler directly under moov', buildMinimalIsoBmffFixture({ handlerParent: 'moov' })],
    ['a handler directly under trak', buildMinimalIsoBmffFixture({ handlerParent: 'trak' })],
    ['a missing stsd', buildMinimalIsoBmffFixture({ omitBoxes: ['stsd'] })],
    ['an stsd without a codec entry', buildMinimalIsoBmffFixture({ omitCodecEntry: true })],
    ['an AVC entry without avcC evidence', buildMinimalIsoBmffFixture({ omitCodecConfig: true })],
    ['a missing stts', buildMinimalIsoBmffFixture({ omitBoxes: ['stts'] })],
    ['a missing stsc', buildMinimalIsoBmffFixture({ omitBoxes: ['stsc'] })],
    ['a missing stsz', buildMinimalIsoBmffFixture({ omitBoxes: ['stsz'] })],
    ['a missing stco/co64', buildMinimalIsoBmffFixture({ omitBoxes: ['stco'] })],
    ['incoherent timing and size sample counts', buildMinimalIsoBmffFixture({ sttsSampleCount: 2 })],
    ['a declared sample larger than mdat', buildMinimalIsoBmffFixture({ sampleSize: 1_024 })],
    ['a chunk offset outside mdat', buildMinimalIsoBmffFixture({ chunkOffsetDelta: 1_024 })],
    ['empty media data', buildMinimalIsoBmffFixture({ mediaData: new Uint8Array(), sampleSize: 0 })],
    ['a duplicate stsd', buildMinimalIsoBmffFixture({ duplicateStsd: true })],
  ])('rejects incomplete or incoherent ISO-BMFF structure: %s', async (_label, bytes) => {
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl: dataUrl('video/mp4', bytes),
    }), 'video')).resolves.toBeUndefined();
  });

  it('rejects zero-sized, duplicate, extended-size-truncated, and truncated ISO boxes', () => {
    const valid = buildMinimalIsoBmffFixture();
    const ftypSize = new DataView(valid.buffer, valid.byteOffset, 4).getUint32(0);
    const duplicateFtyp = concatIsoBytes(valid.subarray(0, ftypSize), valid);
    const zeroSizedMdat = Uint8Array.from(valid);
    const mdatType = new TextDecoder('ascii').decode(valid).lastIndexOf('mdat');
    new DataView(zeroSizedMdat.buffer).setUint32(mdatType - 4, 0);
    const truncatedExtendedMdat = concatIsoBytes(
      valid.subarray(0, mdatType - 4),
      Uint8Array.from([0, 0, 0, 1]),
      asciiIsoBytes('mdat'),
      Uint8Array.from([0, 0, 0]),
    );

    for (const bytes of [duplicateFtyp, zeroSizedMdat, truncatedExtendedMdat, valid.subarray(0, valid.length - 1)]) {
      expect(sniffBinaryResumeSample(completeBinarySample(bytes), 'video')).toBeUndefined();
    }
  });

  it('accepts a bounded, well-formed extended-size ISO box', () => {
    const extendedFree = new Uint8Array(16);
    const view = new DataView(extendedFree.buffer);
    view.setUint32(0, 1);
    extendedFree.set(asciiIsoBytes('free'), 4);
    view.setUint32(12, 16);
    const bytes = concatIsoBytes(buildMinimalIsoBmffFixture(), extendedFree);
    expect(sniffBinaryResumeSample(completeBinarySample(bytes), 'video')).toBe('video/mp4');
  });

  it('fails closed without stack overflow on hostile ISO nesting', () => {
    let nested = isoBox('hdlr', new Uint8Array(8), asciiIsoBytes('vide'));
    for (let depth = 0; depth < 3_000; depth += 1) nested = isoBox('moov', nested);
    const bytes = concatIsoBytes(
      isoBox('ftyp', asciiIsoBytes('isom'), new Uint8Array(4), asciiIsoBytes('isom')),
      nested,
      isoBox('mdat', Uint8Array.from([1])),
    );
    expect(() => sniffBinaryResumeSample(completeBinarySample(bytes), 'video')).not.toThrow();
    expect(sniffBinaryResumeSample(completeBinarySample(bytes), 'video')).toBeUndefined();
  });

  it('fails closed when ISO box work exceeds the explicit budget', () => {
    const valid = buildMinimalIsoBmffFixture();
    const ftypSize = new DataView(valid.buffer, valid.byteOffset, 4).getUint32(0);
    const padding = Array.from({ length: 3_000 }, () => isoBox('free'));
    const bytes = concatIsoBytes(valid.subarray(0, ftypSize), ...padding, valid.subarray(ftypSize));
    expect(sniffBinaryResumeSample(completeBinarySample(bytes), 'video')).toBeUndefined();
  });

  it('rejects the Terra skeleton from fetched and asset-store transports', async () => {
    const bytes = terraSkeletalMp4Bytes();
    const fetchMock = vi.fn().mockResolvedValue(new Response(ownedBuffer(bytes), {
      headers: { 'content-type': 'video/mp4' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl: 'https://assets.example.test/skeleton.mp4',
    }), 'video')).resolves.toBeUndefined();

    vi.mocked(loadImportedAssetForBoundedRead).mockResolvedValue({
      id: 'asset-skeleton-1', name: 'skeleton.mp4', mimeType: 'video/mp4', size: bytes.length, createdAt: 1,
      blob: new Blob([ownedBuffer(bytes)], { type: 'video/mp4' }), dataUrl: dataUrl('video/mp4', bytes),
    });
    vi.mocked(loadImportedAssetBlob).mockResolvedValue({
      id: 'asset-skeleton-1', name: 'skeleton.mp4', mimeType: 'video/mp4',
      blob: new Blob([ownedBuffer(bytes)], { type: 'video/mp4' }),
    });
    vi.mocked(loadImportedAssetAsDataUrl).mockResolvedValue({
      id: 'asset-skeleton-1', name: 'skeleton.mp4', mimeType: 'video/mp4',
      dataUrl: dataUrl('video/mp4', bytes),
    });
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl: undefined, assetId: 'asset-skeleton-1',
    }), 'video')).resolves.toBeUndefined();
  });

  it.each([
    ['native file', { nativeFilePath: '/project/cache/skeleton.mp4' }, 'signal-loom-asset://asset/native-skeleton-1'],
    ['scratch file', { scratchFileName: 'skeleton.mp4' }, 'signal-loom-asset://file/skeleton.mp4'],
  ] as const)('rejects the Terra skeleton from a %s video transport', async (_label, location, assetUrl) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(ownedBuffer(terraSkeletalMp4Bytes()), {
      headers: { 'content-type': 'video/mp4' },
    })));
    await expect(validateSourceBinResumeItem(sourceItem({
      kind: 'video', mimeType: 'video/mp4', assetUrl, ...location,
    }), 'video')).resolves.toBeUndefined();
  });

  it('propagates cancellation while proving a remote cached payload', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
    const controller = new AbortController();
    const validation = validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/cached.png' }), 'image', controller.signal);
    controller.abort();
    await expect(validation).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects an over-ceiling fetched payload before reading its body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const body = new ReadableStream<Uint8Array>({ cancel, start() {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      headers: { 'content-length': String(MAX_BINARY_RESUME_BYTES + 1), 'content-type': 'image/png' },
    })));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/huge.png' }), 'image'))
      .resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a non-OK range response body exactly once', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const body = new ReadableStream<Uint8Array>({ cancel, start() {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 416,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: 'https://assets.example.test/range-rejected.png' }),
      'image',
    )).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects inconsistent range metadata before reading the response body', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const body = new ReadableStream<Uint8Array>({ cancel, pull() {} });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
      status: 206,
      headers: {
        'content-range': 'bytes 0-7/68',
        'content-length': '7',
        'content-type': 'image/png',
      },
    })));
    await expect(validateSourceBinResumeItem(
      sourceItem({ assetUrl: 'https://assets.example.test/stale.png' }),
      'image',
      undefined,
      { maxBinaryBytes: 68, sampleBytes: 8 },
    )).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('fails closed when head and tail range metadata report a size-change race', async () => {
    const bytes = validMp4Bytes();
    const sampleBytes = 64;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(ownedBuffer(bytes.subarray(0, sampleBytes)), {
        status: 206,
        headers: {
          'content-range': `bytes 0-${sampleBytes - 1}/${bytes.length}`,
          'content-length': String(sampleBytes),
          'content-type': 'video/mp4',
          etag: '"version-a"',
        },
      }))
      .mockResolvedValueOnce(new Response(ownedBuffer(bytes.subarray(bytes.length - sampleBytes)), {
        status: 206,
        headers: {
          'content-range': `bytes ${bytes.length - sampleBytes + 1}-${bytes.length}/${bytes.length + 1}`,
          'content-length': String(sampleBytes),
          'content-type': 'video/mp4',
          etag: '"version-b"',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(validateSourceBinResumeItem(
      sourceItem({ kind: 'video', mimeType: 'video/mp4', assetUrl: 'https://assets.example.test/racing.mp4' }),
      'video',
      undefined,
      { maxBinaryBytes: bytes.length + 1, sampleBytes },
    )).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels an unknown-length stream after the fixed sniff window', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const chunk = new Uint8Array(BINARY_RESUME_SAMPLE_BYTES + 1);
    chunk.set(bytesFromDataUrl(VALID_PNG_DATA_URL));
    const body = new ReadableStream<Uint8Array>({ cancel, start(controller) { controller.enqueue(chunk); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } })));
    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/unbounded.png' }), 'image'))
      .resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('settles a stalled direct sample read and stalled cancellation, then releases the reader lock', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}));
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const releaseLock = vi.fn();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        status: 206,
        headers: new Headers({
          'content-range': 'bytes 0-7/68',
          'content-length': '8',
          'content-type': 'image/png',
        }),
        body: { getReader: () => ({ read, cancel, releaseLock }) },
      } as unknown as Response));

      const validation = validateSourceBinResumeItem(
        sourceItem({ assetUrl: 'https://assets.example.test/stalled.png' }),
        'image',
        undefined,
        { maxBinaryBytes: 68, sampleBytes: 8 },
      );
      const outcome = Promise.race([
        validation.then(() => 'settled'),
        new Promise<'test-timeout'>((resolve) => setTimeout(() => resolve('test-timeout'), 16_000)),
      ]);
      await vi.advanceTimersByTimeAsync(16_000);

      await expect(outcome).resolves.toBe('settled');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(releaseLock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not claim a partial bounded PNG range without complete container proof', async () => {
    const totalSize = BINARY_RESUME_SAMPLE_BYTES + 128;
    const bytes = new Uint8Array(BINARY_RESUME_SAMPLE_BYTES);
    bytes.set(bytesFromDataUrl(VALID_PNG_DATA_URL).subarray(0, 33));
    const fetchMock = vi.fn().mockResolvedValue(new Response(ownedBuffer(bytes), {
      status: 206,
      headers: {
        'content-range': `bytes 0-${BINARY_RESUME_SAMPLE_BYTES - 1}/${totalSize}`,
        'content-length': String(BINARY_RESUME_SAMPLE_BYTES),
        'content-type': 'image/png',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(validateSourceBinResumeItem(sourceItem({ assetUrl: 'https://assets.example.test/partial.png' }), 'image'))
      .resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { Range: `bytes=0-${BINARY_RESUME_SAMPLE_BYTES - 1}` },
    }));
  });
});
