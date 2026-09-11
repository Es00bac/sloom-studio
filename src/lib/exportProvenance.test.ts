import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  appendPngSoftwareText,
  applyImageExportProvenance,
  buildProvenanceLabel,
  insertJpegXmpProvenance,
} from './exportProvenance';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** Build a real, spec-valid 1x1 gray PNG from scratch. */
function buildTinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, 1); // width
  ihdrView.setUint32(4, 1); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const idatData = new Uint8Array(deflateSync(new Uint8Array([0, 128]))); // filter byte + one pixel
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idatData),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/** Minimal JPEG prefix: SOI + JFIF APP0 + a DQT stub (enough structure for the injector). */
function buildTinyJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF (len 16)
    0xff, 0xdb, 0x00, 0x04, 0x00, 0x11, // DQT stub
    0xff, 0xd9, // EOI
  ]);
}

function readPngChunks(png: Uint8Array): Array<{ type: string; offset: number; data: Uint8Array }> {
  const chunks: Array<{ type: string; offset: number; data: Uint8Array }> = [];
  let offset = 8;
  while (offset + 12 <= png.length) {
    const view = new DataView(png.buffer, png.byteOffset + offset);
    const length = view.getUint32(0);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    chunks.push({ type, offset, data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

describe('export provenance metadata', () => {
  it('labels Community vs licensed builds', () => {
    expect(buildProvenanceLabel({ licensed: false })).toMatch(/Community \(unlicensed\)$/);
    expect(buildProvenanceLabel({ licensed: true, email: 'buyer@x.com' })).toMatch(/\(licensed to buyer@x\.com\)$/);
  });

  it('inserts a CRC-valid tEXt Software chunk after IHDR without touching pixel data', () => {
    const png = buildTinyPng();
    const label = buildProvenanceLabel({ licensed: false });
    const stamped = appendPngSoftwareText(png, label);

    const chunks = readPngChunks(stamped);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);

    const textChunk = chunks[1];
    const decoded = new TextDecoder('latin1').decode(textChunk.data);
    expect(decoded.startsWith('Software\0')).toBe(true);
    expect(decoded).toContain('Community (unlicensed)');

    // inserted chunk carries a correct CRC (decoders reject bad CRCs)
    const view = new DataView(stamped.buffer, stamped.byteOffset + textChunk.offset);
    const declaredCrc = view.getUint32(8 + textChunk.data.length);
    expect(declaredCrc).toBe(crc32(stamped.subarray(textChunk.offset + 4, textChunk.offset + 8 + textChunk.data.length)));

    // pixel data byte-identical
    const originalIdat = readPngChunks(png).find((chunk) => chunk.type === 'IDAT')!;
    const stampedIdat = chunks.find((chunk) => chunk.type === 'IDAT')!;
    expect([...stampedIdat.data]).toEqual([...originalIdat.data]);
  });

  it('inserts an APP1 XMP segment after the JFIF APP0 header', () => {
    const jpeg = buildTinyJpeg();
    const stamped = insertJpegXmpProvenance(jpeg, buildProvenanceLabel({ licensed: true, email: 'pro@x.com' }));

    expect(stamped[0]).toBe(0xff);
    expect(stamped[1]).toBe(0xd8); // SOI preserved
    // APP0 stays first, APP1 follows immediately
    expect(stamped[2]).toBe(0xff);
    expect(stamped[3]).toBe(0xe0);
    expect(stamped[20]).toBe(0xff);
    expect(stamped[21]).toBe(0xe1);
    const decoded = new TextDecoder('latin1').decode(stamped);
    expect(decoded).toContain('http://ns.adobe.com/xap/1.0/');
    expect(decoded).toContain('licensed to pro@x.com');
    // trailing bytes (DQT + EOI) intact
    expect([...stamped.subarray(stamped.length - 8)]).toEqual([...jpeg.subarray(jpeg.length - 8)]);
  });

  it('passes non-image bytes and unknown mime types through untouched', () => {
    const junk = new Uint8Array([1, 2, 3, 4]);
    expect(appendPngSoftwareText(junk, 'x')).toBe(junk);
    expect(insertJpegXmpProvenance(junk, 'x')).toBe(junk);
    expect(applyImageExportProvenance(junk, 'image/webp', 'x')).toBe(junk);
  });
});
