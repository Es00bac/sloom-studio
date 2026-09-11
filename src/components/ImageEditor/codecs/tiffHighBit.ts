const MAX_PIXELS = 64 * 1024 * 1024;

export type TiffSampleDepth = 'u16' | 'f32';
export interface HighBitTiffRaster {
  width: number;
  height: number;
  depth: TiffSampleDepth;
  data: Uint16Array | Float32Array;
}

/** Bounded classic-TIFF chunky RGBA decoder for uncompressed 16-bit and IEEE f32 samples. */
export function decodeHighBitTiff(bytes: Uint8Array): HighBitTiffRaster {
  if (bytes.length < 8) throw new Error('TIFF decode refused: truncated header.');
  const little = bytes[0] === 0x49 && bytes[1] === 0x49;
  const big = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!little && !big) throw new Error('TIFF decode refused: invalid byte order.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => { bound(bytes, at, 2); return view.getUint16(at, little); };
  const u32 = (at: number) => { bound(bytes, at, 4); return view.getUint32(at, little); };
  if (u16(2) !== 42) throw new Error('TIFF decode refused: classic TIFF magic required; BigTIFF is unsupported.');
  const ifd = u32(4); bound(bytes, ifd, 2);
  const count = u16(ifd); bound(bytes, ifd + 2, count * 12 + 4);
  const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
  for (let i = 0; i < count; i += 1) { const at = ifd + 2 + i * 12; tags.set(u16(at), { type: u16(at + 2), count: u32(at + 4), value: u32(at + 8), at }); }
  const values = (tag: number): number[] => {
    const entry = tags.get(tag); if (!entry) return [];
    const size = ({ 1: 1, 3: 2, 4: 4 } as Record<number, number>)[entry.type];
    if (!size) throw new Error(`TIFF decode refused: tag ${tag} has unsupported field type.`);
    const at = entry.count * size <= 4 ? entry.at + 8 : entry.value; bound(bytes, at, entry.count * size);
    return Array.from({ length: entry.count }, (_, i) => entry.type === 3 ? u16(at + i * 2) : entry.type === 4 ? u32(at + i * 4) : bytes[at + i]);
  };
  const one = (tag: number, fallback?: number) => values(tag)[0] ?? fallback;
  const width = one(256), height = one(257), samples = one(277, 1), compression = one(259, 1), photo = one(262, 2);
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height) || width * height > MAX_PIXELS) throw new Error('TIFF decode refused: invalid or oversized dimensions.');
  if (compression !== 1) throw new Error('TIFF decode refused: this increment supports uncompressed strips only.');
  if (one(284, 1) !== 1 || samples !== 4 || photo !== 2) throw new Error('TIFF decode refused: only chunky RGBA TIFF is supported.');
  const bits = values(258); if (bits.length !== 4 || !bits.every((value) => value === bits[0]) || ![16, 32].includes(bits[0])) throw new Error('TIFF decode refused: RGBA samples must all be 16 or 32 bits.');
  const format = one(339, 1); if ((bits[0] === 16 && format !== 1) || (bits[0] === 32 && format !== 3)) throw new Error('TIFF decode refused: sample format must be unsigned 16-bit or IEEE float32.');
  const offsets = values(273), byteCounts = values(279), rows = one(278, height)!;
  if (!offsets.length || offsets.length !== byteCounts.length || !rows) throw new Error('TIFF decode refused: missing strip layout.');
  const sampleBytes = bits[0] / 8, expected = width * height * 4 * sampleBytes;
  const raw = new Uint8Array(expected); let target = 0;
  for (let i = 0; i < offsets.length && target < expected; i += 1) {
    const expectedStrip = Math.min(rows, height - i * rows) * width * 4 * sampleBytes;
    if (byteCounts[i] < expectedStrip) throw new Error('TIFF decode refused: strip byte count is shorter than its declared rows.');
    bound(bytes, offsets[i], expectedStrip); raw.set(bytes.subarray(offsets[i], offsets[i] + expectedStrip), target); target += expectedStrip;
  }
  if (target !== expected) throw new Error('TIFF decode refused: strips do not cover every declared pixel.');
  if (bits[0] === 16) { const data = new Uint16Array(width * height * 4); for (let i = 0; i < data.length; i += 1) data[i] = new DataView(raw.buffer).getUint16(i * 2, little); return { width, height, depth: 'u16', data }; }
  const data = new Float32Array(width * height * 4); for (let i = 0; i < data.length; i += 1) data[i] = new DataView(raw.buffer).getFloat32(i * 4, little); return { width, height, depth: 'f32', data };
}

/** Deterministic little-endian, uncompressed classic TIFF with associated-alpha declaration. */
export function encodeHighBitTiff(raster: HighBitTiffRaster): Uint8Array {
  const { width, height, depth, data } = raster;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || width * height > MAX_PIXELS || data.length !== width * height * 4) throw new Error('TIFF encode refused: invalid dimensions or RGBA sample count.');
  if ((depth === 'u16') !== (data instanceof Uint16Array) || (depth === 'f32') !== (data instanceof Float32Array)) throw new Error('TIFF encode refused: depth and typed sample buffer disagree.');
  const sampleBytes = depth === 'u16' ? 2 : 4, tagCount = 12, ifd = 8, bitsAt = ifd + 2 + tagCount * 12 + 4, formatAt = bitsAt + 8, pixelsAt = formatAt + 8, bytes = new Uint8Array(pixelsAt + data.length * sampleBytes), view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49]); view.setUint16(2, 42, true); view.setUint32(4, ifd, true); view.setUint16(ifd, tagCount, true); let at = ifd + 2;
  const tag = (id: number, type: number, count: number, value: number) => { view.setUint16(at, id, true); view.setUint16(at + 2, type, true); view.setUint32(at + 4, count, true); if (type === 3 && count === 1) view.setUint16(at + 8, value, true); else view.setUint32(at + 8, value, true); at += 12; };
  tag(256, 4, 1, width); tag(257, 4, 1, height); tag(258, 3, 4, bitsAt); tag(259, 3, 1, 1); tag(262, 3, 1, 2); tag(273, 4, 1, pixelsAt); tag(277, 3, 1, 4); tag(278, 4, 1, height); tag(279, 4, 1, data.length * sampleBytes); tag(284, 3, 1, 1); tag(338, 3, 1, 2); tag(339, 3, 4, formatAt); view.setUint32(at, 0, true);
  for (let i = 0; i < 4; i += 1) { view.setUint16(bitsAt + i * 2, depth === 'u16' ? 16 : 32, true); view.setUint16(formatAt + i * 2, depth === 'u16' ? 1 : 3, true); }
  for (let i = 0; i < data.length; i += 1) { if (depth === 'u16') view.setUint16(pixelsAt + i * 2, data[i], true); else view.setFloat32(pixelsAt + i * 4, data[i], true); }
  return bytes;
}

function bound(bytes: Uint8Array, at: number, length: number): void { if (!Number.isSafeInteger(at) || !Number.isSafeInteger(length) || at < 0 || length < 0 || at + length > bytes.length) throw new Error('TIFF decode refused: offset extends past end of file.'); }
