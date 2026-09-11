import { zlibSync } from 'fflate';
import { inflateZlibBounded } from './boundedInflate';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_PIXELS = 64 * 1024 * 1024;
const MAX_PNG_DECODED_BYTES = 512 * 1024 * 1024;
const MAX_PNG_COMPRESSED_BYTES = 512 * 1024 * 1024;

export type PngChannelDepth = 1 | 2 | 4 | 8 | 16;

export interface DecodedPngRaster {
  width: number;
  height: number;
  /** The PNG IHDR sample depth, retained even where packed samples expand to u8. */
  bitDepth: PngChannelDepth;
  colorType: 0 | 2 | 3 | 4 | 6;
  /** Straight-alpha RGBA samples. 16-bit files retain every input sample bit. */
  data: Uint8Array | Uint16Array;
}

export interface Png16RgbaRaster {
  width: number;
  height: number;
  data: Uint16Array;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: PngChannelDepth;
  colorType: 0 | 2 | 3 | 4 | 6;
  interlace: 0 | 1;
}

interface PngChunks {
  header: PngHeader;
  idat: Uint8Array;
  palette?: Uint8Array;
  transparency?: Uint8Array;
}

/**
 * Decode a bounded PNG into a canvas-free straight-alpha RGBA sample buffer.
 * It accepts the standard non-interlaced and Adam7 variants of grayscale, RGB,
 * RGBA, and indexed PNG.  It deliberately returns typed samples rather than an
 * ImageData proxy so a high-bit caller cannot accidentally downsample them.
 */
export function decodePngRaster(bytes: Uint8Array): DecodedPngRaster {
  const chunks = readPngChunks(bytes);
  const { header } = chunks;
  const channelCount = channelsForColorType(header.colorType);
  const passes = header.interlace === 0
    ? [{ x: 0, y: 0, xStep: 1, yStep: 1 }]
    : ADAM7_PASSES;
  const expectedByteLength = passes.reduce((total, pass) => {
    const passWidth = adam7Length(header.width, pass.x, pass.xStep);
    const passHeight = adam7Length(header.height, pass.y, pass.yStep);
    if (passWidth === 0 || passHeight === 0) return total;
    const rowBytes = scanlineByteLength(passWidth, channelCount, header.bitDepth);
    return checkedAdd(total, checkedMultiply(passHeight, checkedAdd(rowBytes, 1, 'PNG scanline'), 'PNG pass'), 'PNG stream');
  }, 0);
  if (expectedByteLength > MAX_PNG_DECODED_BYTES) {
    throw new Error('PNG decode refused: decompressed image data exceeds the 512 MiB safety limit.');
  }
  const output = header.bitDepth === 16
    ? new Uint16Array(checkedRgbaSampleCount(header.width, header.height))
    : new Uint8Array(checkedRgbaSampleCount(header.width, header.height));
  const inflated = inflateZlibBounded(
    chunks.idat,
    MAX_PNG_DECODED_BYTES,
    'PNG decode refused: decompressed image data exceeds the 512 MiB safety limit.',
  );
  if (inflated.byteLength !== expectedByteLength) {
    throw new Error(`PNG decode refused: decompressed scanline length ${inflated.byteLength} does not match expected ${expectedByteLength}.`);
  }

  let offset = 0;
  for (const pass of passes) {
    const passWidth = adam7Length(header.width, pass.x, pass.xStep);
    const passHeight = adam7Length(header.height, pass.y, pass.yStep);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = scanlineByteLength(passWidth, channelCount, header.bitDepth);
    const bytesPerPixel = Math.max(1, Math.ceil((channelCount * header.bitDepth) / 8));
    let previous = new Uint8Array(rowBytes);
    for (let row = 0; row < passHeight; row += 1) {
      const filter = inflated[offset];
      offset += 1;
      const scanline = inflated.slice(offset, offset + rowBytes);
      offset += rowBytes;
      unfilterScanline(scanline, previous, filter, bytesPerPixel);
      writeScanlineToRgba({
        scanline,
        scanlineWidth: passWidth,
        destination: output,
        destinationWidth: header.width,
        destinationX: pass.x,
        destinationY: pass.y + row * pass.yStep,
        destinationStep: pass.xStep,
        header,
        palette: chunks.palette,
        transparency: chunks.transparency,
      });
      previous = scanline;
    }
  }

  return { width: header.width, height: header.height, bitDepth: header.bitDepth, colorType: header.colorType, data: output };
}

/** Encode exactly the supplied straight-alpha 16-bit RGBA samples as PNG. */
export function encodePng16Rgba(raster: Png16RgbaRaster): Uint8Array {
  const { width, height, data } = raster;
  assertDimensions(width, height);
  const sampleCount = checkedRgbaSampleCount(width, height);
  if (data.length !== sampleCount) {
    throw new Error(`PNG16 encode refused: expected ${sampleCount} RGBA samples, received ${data.length}.`);
  }
  const rowBytes = checkedMultiply(width, 8, 'PNG16 scanline');
  const raw = new Uint8Array(checkedMultiply(height, checkedAdd(rowBytes, 1, 'PNG16 scanline'), 'PNG16 source'));
  let source = 0;
  let target = 0;
  for (let y = 0; y < height; y += 1) {
    raw[target] = 0; // Filter None is deterministic and preserves sample identity.
    target += 1;
    for (let x = 0; x < width * 4; x += 1) {
      const value = data[source];
      source += 1;
      raw[target] = value >>> 8;
      raw[target + 1] = value & 0xff;
      target += 2;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 16;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return concatenateBytes([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

function readPngChunks(bytes: Uint8Array): PngChunks {
  if (bytes.byteLength < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new Error('PNG decode refused: missing PNG signature.');
  }
  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idatParts: Uint8Array[] = [];
  let idatLength = 0;
  let sawEnd = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) throw new Error('PNG decode refused: truncated chunk header.');
    const length = readUint32(bytes, offset);
    const chunkEnd = checkedAdd(offset, checkedAdd(12, length, 'PNG chunk'), 'PNG chunk');
    if (chunkEnd > bytes.byteLength) throw new Error('PNG decode refused: chunk extends past end of file.');
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.slice(offset + 8, offset + 8 + length);
    offset = chunkEnd;
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('PNG decode refused: IHDR must occur once and contain 13 bytes.');
      header = readPngHeader(data);
    } else if (type === 'PLTE') {
      if (!header || palette || length === 0 || length % 3 !== 0 || length > 768) throw new Error('PNG decode refused: invalid PLTE chunk.');
      palette = data;
    } else if (type === 'tRNS') {
      if (!header || transparency) throw new Error('PNG decode refused: duplicate or misplaced tRNS chunk.');
      transparency = data;
    } else if (type === 'IDAT') {
      if (!header) throw new Error('PNG decode refused: IDAT appears before IHDR.');
      idatLength = checkedAdd(idatLength, data.byteLength, 'PNG IDAT');
      if (idatLength > MAX_PNG_COMPRESSED_BYTES) throw new Error('PNG decode refused: compressed image data exceeds the 512 MiB safety limit.');
      idatParts.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) throw new Error('PNG decode refused: IEND must be empty.');
      sawEnd = true;
      break;
    }
  }
  if (!header || !sawEnd || idatParts.length === 0) throw new Error('PNG decode refused: missing IHDR, IDAT, or IEND chunk.');
  if (header.colorType === 3 && !palette) throw new Error('PNG decode refused: indexed PNG is missing PLTE.');
  if (header.colorType === 3 && transparency && transparency.byteLength > palette!.byteLength / 3) {
    throw new Error('PNG decode refused: indexed PNG tRNS has more alpha entries than PLTE.');
  }
  return { header, idat: concatenateBytes(idatParts), palette, transparency };
}

function readPngHeader(data: Uint8Array): PngHeader {
  const width = readUint32(data, 0);
  const height = readUint32(data, 4);
  assertDimensions(width, height);
  const bitDepth = data[8] as PngChannelDepth;
  const colorType = data[9] as PngHeader['colorType'];
  if (data[10] !== 0 || data[11] !== 0 || (data[12] !== 0 && data[12] !== 1)) {
    throw new Error('PNG decode refused: unsupported compression, filter, or interlace method.');
  }
  if (!isValidBitDepth(colorType, bitDepth)) throw new Error(`PNG decode refused: bit depth ${bitDepth} is invalid for color type ${colorType}.`);
  return { width, height, bitDepth, colorType, interlace: data[12] as 0 | 1 };
}

function writeScanlineToRgba(args: {
  scanline: Uint8Array;
  scanlineWidth: number;
  destination: Uint8Array | Uint16Array;
  destinationWidth: number;
  destinationX: number;
  destinationY: number;
  destinationStep: number;
  header: PngHeader;
  palette?: Uint8Array;
  transparency?: Uint8Array;
}): void {
  const { scanline, scanlineWidth, destination, destinationWidth, destinationX, destinationY, destinationStep, header, palette, transparency } = args;
  const channels = channelsForColorType(header.colorType);
  const maxSample = header.bitDepth === 16 ? 65535 : (1 << header.bitDepth) - 1;
  for (let x = 0; x < scanlineWidth; x += 1) {
    const samples = readSamples(scanline, x, channels, header.bitDepth);
    let red: number;
    let green: number;
    let blue: number;
    let alpha = maxSample;
    if (header.colorType === 0) {
      red = samples[0];
      green = red;
      blue = red;
      if (transparency && samples[0] === readTransparencySample(transparency, 0, header.bitDepth)) alpha = 0;
    } else if (header.colorType === 2) {
      [red, green, blue] = samples;
      if (transparency && red === readTransparencySample(transparency, 0, header.bitDepth)
        && green === readTransparencySample(transparency, 1, header.bitDepth)
        && blue === readTransparencySample(transparency, 2, header.bitDepth)) alpha = 0;
    } else if (header.colorType === 3) {
      const index = samples[0];
      const paletteOffset = index * 3;
      if (!palette || paletteOffset + 2 >= palette.byteLength) throw new Error('PNG decode refused: palette index exceeds PLTE.');
      red = palette[paletteOffset];
      green = palette[paletteOffset + 1];
      blue = palette[paletteOffset + 2];
      alpha = transparency?.[index] ?? 255;
    } else if (header.colorType === 4) {
      red = samples[0];
      green = red;
      blue = red;
      alpha = samples[1];
    } else {
      [red, green, blue, alpha] = samples;
    }
    const destinationIndex = (destinationY * destinationWidth + destinationX + x * destinationStep) * 4;
    if (destination instanceof Uint16Array) {
      destination[destinationIndex] = red;
      destination[destinationIndex + 1] = green;
      destination[destinationIndex + 2] = blue;
      destination[destinationIndex + 3] = alpha;
    } else if (header.colorType === 3) {
      // PLTE and indexed tRNS entries are always full 8-bit channel values;
      // the IHDR depth describes the palette index, not its colours.
      destination[destinationIndex] = red;
      destination[destinationIndex + 1] = green;
      destination[destinationIndex + 2] = blue;
      destination[destinationIndex + 3] = alpha;
    } else {
      destination[destinationIndex] = scaleToByte(red, maxSample);
      destination[destinationIndex + 1] = scaleToByte(green, maxSample);
      destination[destinationIndex + 2] = scaleToByte(blue, maxSample);
      destination[destinationIndex + 3] = scaleToByte(alpha, maxSample);
    }
  }
}

function readSamples(scanline: Uint8Array, pixel: number, channelCount: number, bitDepth: PngChannelDepth): number[] {
  const samples: number[] = [];
  const bitsPerPixel = channelCount * bitDepth;
  const startBit = pixel * bitsPerPixel;
  for (let channel = 0; channel < channelCount; channel += 1) {
    const sampleBit = startBit + channel * bitDepth;
    if (bitDepth === 16) samples.push((scanline[sampleBit >> 3] << 8) | scanline[(sampleBit >> 3) + 1]);
    else if (bitDepth === 8) samples.push(scanline[sampleBit >> 3]);
    else {
      const shift = 8 - bitDepth - (sampleBit & 7);
      samples.push((scanline[sampleBit >> 3] >> shift) & ((1 << bitDepth) - 1));
    }
  }
  return samples;
}

function unfilterScanline(row: Uint8Array, previous: Uint8Array, filter: number, bytesPerPixel: number): void {
  if (filter > 4) throw new Error(`PNG decode refused: unsupported filter type ${filter}.`);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const above = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? (previous[index - bytesPerPixel] ?? 0) : 0;
    if (filter === 1) row[index] = (row[index] + left) & 0xff;
    else if (filter === 2) row[index] = (row[index] + above) & 0xff;
    else if (filter === 3) row[index] = (row[index] + Math.floor((left + above) / 2)) & 0xff;
    else if (filter === 4) row[index] = (row[index] + paeth(left, above, upperLeft)) & 0xff;
  }
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const output = new Uint8Array(12 + data.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.byteLength, false);
  for (let index = 0; index < 4; index += 1) output[4 + index] = type.charCodeAt(index);
  output.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(output.subarray(4, 8 + data.byteLength)), false);
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

function channelsForColorType(colorType: PngHeader['colorType']): number {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`PNG decode refused: unsupported color type ${colorType}.`);
  return channels;
}

function isValidBitDepth(colorType: PngHeader['colorType'], bitDepth: number): bitDepth is PngChannelDepth {
  return (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth))
    || (colorType === 2 && [8, 16].includes(bitDepth))
    || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth))
    || ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
}

function readTransparencySample(transparency: Uint8Array, index: number, bitDepth: PngChannelDepth): number {
  const offset = index * 2;
  if (offset + 1 >= transparency.byteLength) throw new Error('PNG decode refused: malformed tRNS sample values.');
  const value = (transparency[offset] << 8) | transparency[offset + 1];
  return bitDepth === 16 ? value : value & ((1 << bitDepth) - 1);
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('PNG decode refused: image dimensions must be positive integers.');
  }
  const pixels = checkedMultiply(width, height, 'PNG dimensions');
  if (pixels > MAX_PNG_PIXELS) throw new Error(`PNG decode refused: ${width}×${height} exceeds the ${MAX_PNG_PIXELS}-pixel safety limit.`);
}

function checkedRgbaSampleCount(width: number, height: number): number {
  assertDimensions(width, height);
  return checkedMultiply(checkedMultiply(width, height, 'PNG dimensions'), 4, 'PNG RGBA samples');
}

function checkedMultiply(left: number, right: number, context: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`PNG decode refused: ${context} overflows safe bounds.`);
  return value;
}

function checkedAdd(left: number, right: number, context: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`PNG decode refused: ${context} overflows safe bounds.`);
  return value;
}

function scanlineByteLength(width: number, channels: number, bitDepth: number): number {
  return Math.ceil(checkedMultiply(checkedMultiply(width, channels, 'PNG row'), bitDepth, 'PNG row') / 8);
}

function adam7Length(length: number, start: number, step: number): number {
  return length <= start ? 0 : Math.floor((length - start + step - 1) / step);
}

function scaleToByte(value: number, maximum: number): number {
  return maximum === 255 ? value : Math.round((value * 255) / maximum);
}

function paeth(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function readUint32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw new Error('PNG decode refused: truncated 32-bit value.');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function concatenateBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => checkedAdd(total, part.byteLength, 'PNG byte stream'), 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

const ADAM7_PASSES = [
  { x: 0, y: 0, xStep: 8, yStep: 8 },
  { x: 4, y: 0, xStep: 8, yStep: 8 },
  { x: 0, y: 4, xStep: 4, yStep: 8 },
  { x: 2, y: 0, xStep: 4, yStep: 4 },
  { x: 0, y: 2, xStep: 2, yStep: 4 },
  { x: 1, y: 0, xStep: 2, yStep: 2 },
  { x: 0, y: 1, xStep: 1, yStep: 2 },
] as const;
