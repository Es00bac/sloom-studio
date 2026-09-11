import { Deflate, zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodePngRaster, encodePng16Rgba } from './png16';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MIB = 1024 * 1024;

describe('PNG16 codec', () => {
  it('preserves every 16-bit RGBA ramp sample through encode and decode', () => {
    const source = new Uint16Array([
      0, 1, 257, 65535,
      258, 1024, 32768, 65534,
      65535, 65534, 32769, 0,
      4660, 43981, 255, 32767,
    ]);
    const encoded = encodePng16Rgba({ width: 2, height: 2, data: source });
    const decoded = decodePngRaster(encoded);

    expect(decoded).toMatchObject({ width: 2, height: 2, bitDepth: 16, colorType: 6 });
    expect(decoded.data).toBeInstanceOf(Uint16Array);
    expect([...decoded.data]).toEqual([...source]);
  });

  it('decodes known 16-bit RGB values and tRNS alpha without a canvas', () => {
    const png = buildPng({
      width: 2,
      height: 1,
      bitDepth: 16,
      colorType: 2,
      raw: new Uint8Array([
        0,
        0x12, 0x34, 0xab, 0xcd, 0x00, 0xff,
        0x00, 0x01, 0x00, 0x02, 0x00, 0x03,
      ]),
      transparency: new Uint8Array([0x12, 0x34, 0xab, 0xcd, 0x00, 0xff]),
    });

    expect([...decodePngRaster(png).data]).toEqual([
      0x1234, 0xabcd, 0x00ff, 0,
      1, 2, 3, 65535,
    ]);
  });

  it('decodes packed palette samples and palette alpha into straight u8 RGBA', () => {
    const png = buildPng({
      width: 4,
      height: 1,
      bitDepth: 2,
      colorType: 3,
      raw: new Uint8Array([0, 0b00011011]),
      palette: new Uint8Array([
        10, 20, 30,
        40, 50, 60,
        70, 80, 90,
        100, 110, 120,
      ]),
      transparency: new Uint8Array([255, 128, 64, 0]),
    });

    const decoded = decodePngRaster(png);
    expect(decoded).toMatchObject({ bitDepth: 2, colorType: 3 });
    expect([...decoded.data]).toEqual([
      10, 20, 30, 255,
      40, 50, 60, 128,
      70, 80, 90, 64,
      100, 110, 120, 0,
    ]);
  });

  it('rejects truncated and oversized headers before allocating image samples', () => {
    expect(() => decodePngRaster(SIGNATURE)).toThrow(/truncated|missing/i);
    const oversized = buildPng({
      width: 0x7fffffff,
      height: 0x7fffffff,
      bitDepth: 16,
      colorType: 6,
      raw: new Uint8Array(),
    });
    expect(() => decodePngRaster(oversized)).toThrow(/safety limit|dimensions/i);
  });

  it('rejects scanline length mismatches and invalid encode dimensions', () => {
    const shortScanline = buildPng({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 6,
      raw: new Uint8Array([0, 0, 0]),
    });
    expect(() => decodePngRaster(shortScanline)).toThrow(/scanline length/i);
    expect(() => encodePng16Rgba({ width: 1, height: 1, data: new Uint16Array(3) })).toThrow(/expected 4/i);
  });

  it('refuses a hostile IDAT stream that expands past the 512 MiB bound without materializing it', () => {
    const hostile = buildPng({
      width: 1,
      height: 1,
      bitDepth: 16,
      colorType: 6,
      raw: new Uint8Array(),
      idat: buildHostileZlibStream(640 * MIB),
    });
    expect(() => decodePngRaster(hostile)).toThrow('PNG decode refused: decompressed image data exceeds the 512 MiB safety limit.');
    const benign = buildPng({ width: 1, height: 1, bitDepth: 16, colorType: 6, raw: new Uint8Array(9) });
    expect([...decodePngRaster(benign).data]).toEqual([0, 0, 0, 0]);
  }, 30000);
});

function buildPng(input: {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  raw: Uint8Array;
  idat?: Uint8Array;
  palette?: Uint8Array;
  transparency?: Uint8Array;
}): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, input.width, false);
  view.setUint32(4, input.height, false);
  ihdr[8] = input.bitDepth;
  ihdr[9] = input.colorType;
  return concatenate([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...(input.palette ? [chunk('PLTE', input.palette)] : []),
    ...(input.transparency ? [chunk('tRNS', input.transparency)] : []),
    chunk('IDAT', input.idat ?? zlibSync(input.raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Builds a zlib stream of `totalBytes` zero bytes without ever allocating the expansion. */
function buildHostileZlibStream(totalBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const deflater = new Deflate((chunk) => {
    if (chunk.length) parts.push(chunk);
  });
  const zeros = new Uint8Array(MIB);
  for (let at = 0; at < totalBytes; at += MIB) deflater.push(zeros, at + MIB >= totalBytes);
  const accumulated = totalBytes % 65521;
  const trailer = new Uint8Array([0, 1, (accumulated >> 8) & 0xff, accumulated & 0xff]);
  return concatenate([new Uint8Array([0x78, 0x9c]), ...parts, trailer]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length, false);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(data, 8);
  view.setUint32(data.length + 8, crc32(output.subarray(4, data.length + 8)), false);
  return output;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
