import type { BlendMode, ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createBitmap, putBitmapImageData } from './LayerBitmap';
import type { SourceImageOpenParams } from './ImageFileFormats';

/**
 * Bounded, deterministic GIMP XCF importer.
 *
 * Decodes 8-bit-per-sample XCF workfiles into layered Image documents: layer pixels, names,
 * offsets, opacity, visibility, and GIMP layer modes map onto Image layers; layer masks decode
 * into real Image masks; indexed and grayscale canvases expand to RGB(A). Every unsupported
 * construct fails closed with a typed `XcfImportError` (fractal tiles, unsupported precision
 * encodings, zlib tiles when the platform lacks `DecompressionStream`, broken structures) or is
 * imported with an explicit warning instead of silently flattening (groups, text layers,
 * standalone channels, floating selections).
 */

export type XcfImportErrorCode =
  | 'not-xcf'
  | 'truncated'
  | 'pointer-out-of-bounds'
  | 'unsupported-compression'
  | 'unsupported-precision'
  | 'unsupported-base-type'
  | 'invalid-layer-type'
  | 'invalid-structure'
  | 'cap-side-length'
  | 'cap-canvas-pixels'
  | 'cap-total-layer-pixels'
  | 'cap-layers'
  | 'cap-tiles'
  | 'cap-string'
  | 'cap-properties'
  | 'cap-channels'
  | 'cap-colormap'
  | 'tile-decompression-overflow'
  | 'no-layers'
  | 'indexed-without-colormap';

export class XcfImportError extends Error {
  readonly code: XcfImportErrorCode;

  constructor(code: XcfImportErrorCode, message: string) {
    super(message);
    this.name = 'XcfImportError';
    this.code = code;
  }
}

export const XCF_IMPORT_LIMITS = {
  maxSideLength: 30_000,
  maxCanvasPixels: 268_435_456,
  maxTotalLayerPixels: 536_870_912,
  maxLayers: 128,
  maxTilesPerLevel: 262_144,
  maxStringBytes: 512,
  maxPropertiesPerStructure: 1_024,
  maxImageChannels: 1_024,
  maxColormapEntries: 65_536,
} as const;

export function describeXcfImportLimitStrings(): string[] {
  return [
    `XCF import is bounded to ${XCF_IMPORT_LIMITS.maxSideLength.toLocaleString('en-US')} px per side, `
      + `${XCF_IMPORT_LIMITS.maxCanvasPixels.toLocaleString('en-US')} canvas pixels, `
      + `${XCF_IMPORT_LIMITS.maxTotalLayerPixels.toLocaleString('en-US')} total layer pixels, and `
      + `${XCF_IMPORT_LIMITS.maxLayers} layers.`,
    'Only uncompressed, RLE, and zlib-compressed 8-bit non-linear or perceptual tiles are decoded; fractal, linear-light, and higher-than-8-bit precision fail with typed errors.',
    'Layer groups, text layers, floating selections, and standalone channels are imported or skipped with explicit warnings, never silently flattened.',
  ];
}

const XCF_TILE_SIZE = 64;
const XCF_MAGIC_PREFIX = 'gimp xcf ';
const XCF_BASE_TYPE_RGB = 0;
const XCF_BASE_TYPE_GRAY = 1;
const XCF_BASE_TYPE_INDEXED = 2;

const XCF_COMPRESSION_NONE = 0;
const XCF_COMPRESSION_RLE = 1;
const XCF_COMPRESSION_ZLIB = 2;
const XCF_COMPRESSION_FRACTAL = 3;

const XCF_PROP_END = 0;
const XCF_PROP_COLORMAP = 1;
const XCF_PROP_ACTIVE_LAYER = 2;
const XCF_PROP_FLOATING_SELECTION = 5;
const XCF_PROP_OPACITY = 6;
const XCF_PROP_MODE = 7;
const XCF_PROP_VISIBLE = 8;
const XCF_PROP_APPLY_LAYER_MASK = 11;
const XCF_PROP_OFFSETS = 15;
const XCF_PROP_COMPRESSION = 17;
const XCF_PROP_PARASITES = 21;
const XCF_PROP_TEXT_LAYER_FLAGS = 26;
const XCF_PROP_GROUP_ITEM = 29;
const XCF_EFFECTS_VERSION = 20;

// GimpPrecision values from GIMP's public gimpbaseenums.h. XCF v004 uses its
// own compact 0–4 domain; zero is its 8-bit encoding. v005+ use the modern
// GimpPrecision numbers below. Although all three U8 variants carry one byte/sample,
// U8-linear (100) stores linear-light samples and cannot be represented by Image's
// sRGB byte canvas without a transfer conversion, so it is deliberately refused.
const XCF_U8_PRECISIONS = new Set([150, 175]);

const XCF_LAYER_TYPE_BY_BASE_AND_BPP: Record<number, Record<number, number>> = {
  [XCF_BASE_TYPE_RGB]: { 3: 0, 4: 1 },
  [XCF_BASE_TYPE_GRAY]: { 1: 2, 2: 3 },
  [XCF_BASE_TYPE_INDEXED]: { 1: 4, 2: 5 },
};

const XCF_BLEND_MODE_BY_GIMP_MODE: Record<number, BlendMode> = {
  0: 'normal',
  3: 'multiply',
  4: 'screen',
  5: 'overlay',
  6: 'difference',
  9: 'darken',
  10: 'lighten',
  11: 'hue',
  12: 'saturation',
  13: 'color',
  14: 'luminosity',
  16: 'color-dodge',
  17: 'color-burn',
  18: 'hard-light',
  19: 'soft-light',
  23: 'overlay',
  // GIMP 2.10+/3.x non-legacy layer modes.  Keep the old aliases above for
  // v003 exports and older workfiles; the same visual modes have new numbers.
  28: 'normal',
  30: 'multiply',
  31: 'screen',
  32: 'difference',
  35: 'darken',
  36: 'lighten',
  37: 'hue',
  38: 'saturation',
  39: 'color',
  40: 'luminosity',
  42: 'color-dodge',
  43: 'color-burn',
  44: 'hard-light',
  45: 'soft-light',
  52: 'exclusion',
};

class XcfReader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  readonly length: number;

  constructor(buffer: ArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.length = this.bytes.byteLength;
    this.view = new DataView(buffer);
  }

  u8(offset: number): number {
    this.assertRange(offset, 1);
    return this.bytes[offset];
  }

  u32(offset: number): number {
    this.assertRange(offset, 4);
    return this.view.getUint32(offset, false);
  }

  pointer(offset: number, pointerBytes: 4 | 8): number {
    if (pointerBytes === 4) return this.u32(offset);
    this.assertRange(offset, 8);
    const value = this.view.getBigUint64(offset, false);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new XcfImportError(
        'pointer-out-of-bounds',
        `The XCF file references byte ${value.toString()}, beyond this importer's safe address range.`,
      );
    }
    return Number(value);
  }

  i32(offset: number): number {
    this.assertRange(offset, 4);
    return this.view.getInt32(offset, false);
  }

  assertRange(offset: number, byteLength: number): void {
    if (offset < 0 || byteLength < 0 || offset + byteLength > this.length) {
      throw new XcfImportError('truncated', `The XCF file ends before byte ${offset + byteLength} could be read.`);
    }
  }

  string(offset: number): { value: string; next: number } {
    const byteLength = this.u32(offset);
    if (byteLength > XCF_IMPORT_LIMITS.maxStringBytes + 1) {
      throw new XcfImportError('cap-string', 'An XCF string exceeds the import string-length cap.');
    }
    const start = offset + 4;
    const end = start + byteLength;
    if (byteLength < 1 || end > this.length) {
      throw new XcfImportError('truncated', 'An XCF string runs past the end of the file.');
    }
    const terminator = this.bytes.indexOf(0, start);
    const valueEnd = terminator >= start && terminator < end ? terminator : end;
    try {
      return {
        value: new TextDecoder('utf-8', { fatal: true }).decode(this.bytes.subarray(start, valueEnd)),
        next: end,
      };
    } catch {
      throw new XcfImportError('invalid-structure', 'An XCF string is not valid UTF-8.');
    }
  }
}

function throwPointerError(offset: number): never {
  throw new XcfImportError(
    'pointer-out-of-bounds',
    `The XCF file references a structure at byte ${offset}, which is outside the file.`,
  );
}

function assertStructurePointer(reader: XcfReader, pointer: number): void {
  if (pointer <= 0 || pointer >= reader.length) throwPointerError(pointer);
}

interface XcfPointerList {
  pointers: number[];
  next: number;
}

function readPointerList(
  reader: XcfReader,
  offset: number,
  cap: number,
  capCode: XcfImportErrorCode,
  pointerBytes: 4 | 8,
): XcfPointerList {
  const pointers: number[] = [];
  let cursor = offset;
  for (;;) {
    const pointer = reader.pointer(cursor, pointerBytes);
    cursor += pointerBytes;
    if (pointer === 0) return { pointers, next: cursor };
    if (pointers.length >= cap) {
      throw new XcfImportError(capCode, `The XCF file lists more structures than the import cap of ${cap}.`);
    }
    pointers.push(pointer);
  }
}

interface XcfImageProps {
  width: number;
  height: number;
  baseType: number;
  versionTag: string;
  version: number;
  precision: number | null;
  pointerBytes: 4 | 8;
  colormap: Uint8Array | null;
  compression: number;
  hasFloatingSelection: boolean;
  layerPointerListOffset: number;
}

function readXcfImageProps(reader: XcfReader): XcfImageProps {
  let magic = '';
  for (let index = 0; index < XCF_MAGIC_PREFIX.length; index += 1) {
    magic += String.fromCharCode(reader.u8(index));
  }
  if (magic !== XCF_MAGIC_PREFIX) {
    throw new XcfImportError('not-xcf', 'The file does not carry the "gimp xcf " magic header.');
  }
  let versionTag = '';
  for (let index = 9; index < 13; index += 1) {
    const byte = reader.u8(index);
    versionTag += byte === 0 ? '\0' : String.fromCharCode(byte);
  }

  const versionMatch = /^v(\d{3})$/.exec(versionTag);
  const version = versionMatch ? Number(versionMatch[1]) : 0;
  const pointerBytes: 4 | 8 = version >= 11 ? 8 : 4;
  const precision = version >= 4 ? reader.u32(26) : null;
  const width = reader.u32(14);
  const height = reader.u32(18);
  const baseType = reader.u32(22);
  if (width <= 0 || height <= 0) {
    throw new XcfImportError('invalid-structure', 'The XCF header declares an empty canvas.');
  }
  if (width > XCF_IMPORT_LIMITS.maxSideLength || height > XCF_IMPORT_LIMITS.maxSideLength) {
    throw new XcfImportError(
      'cap-side-length',
      `The XCF canvas is ${width}×${height} px, beyond the ${XCF_IMPORT_LIMITS.maxSideLength.toLocaleString('en-US')} px per-side import cap.`,
    );
  }
  if (width * height > XCF_IMPORT_LIMITS.maxCanvasPixels) {
    throw new XcfImportError(
      'cap-canvas-pixels',
      `The XCF canvas has ${width * height} pixels, beyond the ${XCF_IMPORT_LIMITS.maxCanvasPixels.toLocaleString('en-US')} canvas-pixel import cap.`,
    );
  }
  if (baseType !== XCF_BASE_TYPE_RGB && baseType !== XCF_BASE_TYPE_GRAY && baseType !== XCF_BASE_TYPE_INDEXED) {
    throw new XcfImportError('unsupported-base-type', `The XCF base type ${baseType} is not RGB, grayscale, or indexed.`);
  }

  let colormap: Uint8Array | null = null;
  let compression = XCF_COMPRESSION_NONE;
  let hasFloatingSelection = false;
  let cursor = version >= 4 ? 30 : 26;

  for (let propertyIndex = 0; propertyIndex < XCF_IMPORT_LIMITS.maxPropertiesPerStructure; propertyIndex += 1) {
    const property = reader.u32(cursor);
    const payloadLength = reader.u32(cursor + 4);
    cursor += 8;
    if (payloadLength < 0 || cursor + payloadLength > reader.length) {
      throw new XcfImportError('truncated', 'An XCF image property runs past the end of the file.');
    }
    if (property === XCF_PROP_END) break;

    if (property === XCF_PROP_COLORMAP) {
      const count = reader.u32(cursor);
      if (count > XCF_IMPORT_LIMITS.maxColormapEntries) {
        throw new XcfImportError('cap-colormap', 'The XCF colormap exceeds the import colormap-size cap.');
      }
      const byteLength = count * 3;
      if (4 + byteLength > payloadLength) {
        throw new XcfImportError('truncated', 'The XCF colormap payload is shorter than its declared entries.');
      }
      colormap = reader.bytes.slice(cursor + 4, cursor + 4 + byteLength);
    } else if (property === XCF_PROP_COMPRESSION) {
      if (payloadLength < 1) {
        throw new XcfImportError('truncated', 'The XCF compression property has no payload byte.');
      }
      compression = reader.u8(cursor);
    } else if (property === XCF_PROP_FLOATING_SELECTION) {
      hasFloatingSelection = true;
    }

    cursor += payloadLength;
  }

  return {
    width,
    height,
    baseType,
    versionTag,
    version,
    precision,
    pointerBytes,
    colormap,
    compression,
    hasFloatingSelection,
    layerPointerListOffset: cursor,
  };
}

function assertSupportedCompression(compression: number): void {
  if (compression === XCF_COMPRESSION_FRACTAL) {
    throw new XcfImportError(
      'unsupported-compression',
      'Fractal-compressed XCF tiles are not decoded. Re-save the file from GIMP with RLE or zlib tile compression.',
    );
  }
  if (compression !== XCF_COMPRESSION_NONE
    && compression !== XCF_COMPRESSION_RLE
    && compression !== XCF_COMPRESSION_ZLIB) {
    throw new XcfImportError(
      'unsupported-compression',
      `The XCF tile compression mode ${compression} is not one of none, RLE, or zlib.`,
    );
  }
}

export function describeXcfUnsupportedPrecision(version: number, precision: number | null): string | undefined {
  if (precision === null) return undefined;
  if (version === 4 && precision === 0) return undefined;
  if (version !== 4 && XCF_U8_PRECISIONS.has(precision)) return undefined;
  if (version !== 4 && precision === 100) {
    return 'The XCF header uses GIMP 8-bit linear-light precision (100), which Image does not convert to its sRGB canvas bytes. Re-save the file from GIMP using 8-bit non-linear or perceptual precision before importing.';
  }
  if (version === 4 && precision >= 0 && precision <= 4) {
    return `The XCF version 4 header uses precision ${precision}, which is outside Image's bounded 8-bit raster import contract.`;
  }
  if (version === 4) {
    return `The XCF version 4 header declares precision ${precision}, which is invalid for that XCF version. Re-save a valid 8-bit XCF from GIMP before importing.`;
  }
  return `The XCF header uses GIMP precision ${precision}, not an 8-bit precision. Re-save the file from GIMP using 8-bit integer precision before importing.`;
}

function assertSupportedPrecision(version: number, precision: number | null): void {
  const message = describeXcfUnsupportedPrecision(version, precision);
  if (message) {
    throw new XcfImportError(
      'unsupported-precision',
      message,
    );
  }
}

function assertLayerTypeMatchesPlane(layer: XcfLayerProperties, hierarchy: XcfHierarchyPlan, baseType: number): void {
  const expectedType = XCF_LAYER_TYPE_BY_BASE_AND_BPP[baseType]?.[hierarchy.bpp];
  if (expectedType === undefined || layer.layerType !== expectedType) {
    throw new XcfImportError(
      'invalid-layer-type',
      `The XCF layer "${layer.name}" declares type ${layer.layerType}, but a ${hierarchy.bpp}-byte ${baseType === XCF_BASE_TYPE_RGB ? 'RGB' : baseType === XCF_BASE_TYPE_GRAY ? 'grayscale' : 'indexed'} plane requires type ${expectedType ?? 'an unsupported layout'}.`,
    );
  }
}

interface XcfHierarchyPlan {
  width: number;
  height: number;
  bpp: number;
  tilePointers: number[];
  columns: number;
  rows: number;
  /** GIMP writes a tile list whose first pointer is 0 for a completely empty pixel plane. */
  empty: boolean;
}

function readXcfHierarchyPlan(reader: XcfReader, pointer: number, pointerBytes: 4 | 8): XcfHierarchyPlan {
  assertStructurePointer(reader, pointer);
  const width = reader.u32(pointer);
  const height = reader.u32(pointer + 4);
  const bpp = reader.u32(pointer + 8);
  if (width <= 0 || height <= 0) {
    throw new XcfImportError('invalid-structure', 'An XCF hierarchy declares an empty pixel plane.');
  }
  if (width > XCF_IMPORT_LIMITS.maxSideLength || height > XCF_IMPORT_LIMITS.maxSideLength) {
    throw new XcfImportError(
      'cap-side-length',
      `An XCF pixel plane is ${width}×${height} px, beyond the ${XCF_IMPORT_LIMITS.maxSideLength.toLocaleString('en-US')} px per-side import cap.`,
    );
  }
  if (width * height > XCF_IMPORT_LIMITS.maxCanvasPixels) {
    throw new XcfImportError(
      'cap-canvas-pixels',
      `An XCF pixel plane has ${width * height} pixels, beyond the ${XCF_IMPORT_LIMITS.maxCanvasPixels.toLocaleString('en-US')} canvas-pixel import cap.`,
    );
  }
  if (bpp < 1 || bpp > 4) {
    throw new XcfImportError(
      'unsupported-precision',
      `The XCF pixel data uses ${bpp} bytes per pixel, which is higher-than-8-bit precision. `
        + 'Re-save the file from GIMP with 8-bit precision before importing.',
    );
  }

  const { pointers: levelPointers } = readPointerList(reader, pointer + 12, 16, 'invalid-structure', pointerBytes);
  const firstLevel = levelPointers[0];
  if (!firstLevel) {
    throw new XcfImportError('invalid-structure', 'An XCF hierarchy has no full-resolution level.');
  }
  assertStructurePointer(reader, firstLevel);
  const levelWidth = reader.u32(firstLevel);
  const levelHeight = reader.u32(firstLevel + 4);
  if (levelWidth !== width || levelHeight !== height) {
    throw new XcfImportError('invalid-structure', 'The XCF full-resolution level does not match its hierarchy dimensions.');
  }
  const columns = Math.ceil(width / XCF_TILE_SIZE);
  const rows = Math.ceil(height / XCF_TILE_SIZE);
  const expectedTiles = columns * rows;
  if (expectedTiles > XCF_IMPORT_LIMITS.maxTilesPerLevel) {
    throw new XcfImportError(
      'cap-tiles',
      `An XCF level needs ${expectedTiles} tiles, beyond the ${XCF_IMPORT_LIMITS.maxTilesPerLevel.toLocaleString('en-US')} tile import cap.`,
    );
  }
  const { pointers: tilePointers } = readPointerList(reader, firstLevel + 8, expectedTiles, 'cap-tiles', pointerBytes);
  if (tilePointers.length > 0 && tilePointers.length !== expectedTiles) {
    throw new XcfImportError(
      'invalid-structure',
      `An XCF level declares ${columns}×${rows} tiles but lists ${tilePointers.length} tile pointers.`,
    );
  }
  return { width, height, bpp, tilePointers, columns, rows, empty: tilePointers.length === 0 };
}

interface XcfTileGeometry {
  width: number;
  height: number;
}

function tileGeometry(plan: XcfHierarchyPlan, row: number, column: number): XcfTileGeometry {
  const width = column === plan.columns - 1 ? plan.width - column * XCF_TILE_SIZE : XCF_TILE_SIZE;
  const height = row === plan.rows - 1 ? plan.height - row * XCF_TILE_SIZE : XCF_TILE_SIZE;
  if (width <= 0 || height <= 0 || width > XCF_TILE_SIZE || height > XCF_TILE_SIZE) {
    throw new XcfImportError('invalid-structure', 'An XCF tile has invalid dimensions.');
  }
  return { width, height };
}

/**
 * Decode one XCF RLE plane in place (GIMP's exact `xcf_load_tile_rle` algorithm): a control
 * byte below 128 starts a repeat run of `control + 1` copies of the next byte (control 127
 * switches to a big-endian u16 run length), while a control byte of 128 or more starts a
 * literal copy of `256 - control` raw bytes (control 128 switches to a u16 length). Returns
 * the number of file bytes the runs consumed.
 */
function decodeRlePlane(reader: XcfReader, start: number, planeValues: Uint8Array): number {
  let offset = start;
  let written = 0;
  while (written < planeValues.length) {
    const control = reader.u8(offset);
    offset += 1;
    const repeat = control < 128;
    let length = repeat ? control + 1 : 256 - control;
    if (length === 128) {
      length = (reader.u8(offset) << 8) | reader.u8(offset + 1);
      offset += 2;
    }
    if (written + length > planeValues.length) {
      throw new XcfImportError('tile-decompression-overflow', 'An RLE tile run overruns its pixel plane.');
    }
    if (repeat) {
      const value = reader.u8(offset);
      offset += 1;
      planeValues.fill(value, written, written + length);
    } else {
      reader.assertRange(offset, length);
      for (let index = 0; index < length; index += 1) {
        planeValues[written + index] = reader.bytes[offset + index];
      }
      offset += length;
    }
    written += length;
  }
  return offset - start;
}

/**
 * Inflate one whole zlib-compressed XCF tile (GIMP deflates the complete interleaved tile, not
 * per-plane streams) with a strict decompression-bomb cap. Like GIMP's loader, the input is
 * bounded by the next tile pointer (or the end of the file for the final tile).
 */
async function inflateZlibTile(
  reader: XcfReader,
  pointer: number,
  endBound: number,
  expectedBytes: number,
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new XcfImportError(
      'unsupported-compression',
      'This platform cannot inflate zlib-compressed XCF tiles. Re-save the file from GIMP with RLE or uncompressed tiles.',
    );
  }
  const bound = Math.max(pointer + 1, Math.min(endBound, reader.length));
  const compressed = reader.bytes.subarray(pointer, bound);
  const output = new Uint8Array(expectedBytes);
  let written = 0;
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const stream = new Blob([compressed as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    streamReader = stream.getReader();
    for (;;) {
      const chunk = await streamReader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      if (written + bytes.byteLength > expectedBytes) {
        throw new XcfImportError(
          'tile-decompression-overflow',
          'A zlib-compressed XCF tile expands beyond its declared pixel size.',
        );
      }
      output.set(bytes, written);
      written += bytes.byteLength;
    }
  } catch (error) {
    if (error instanceof XcfImportError) throw error;
    throw new XcfImportError('truncated', 'A zlib-compressed XCF tile stream is corrupt or incomplete.');
  } finally {
    void streamReader?.cancel().catch(() => undefined);
  }
  if (written !== expectedBytes) {
    throw new XcfImportError('truncated', 'A zlib-compressed XCF tile expanded to fewer bytes than its pixel plane needs.');
  }
  return output;
}

/** Decode one tile into interleaved RGBA pixel bytes at tile-local resolution. */
async function decodeTileToRgba(
  reader: XcfReader,
  pointer: number,
  nextPointer: number,
  compression: number,
  geometry: XcfTileGeometry,
  bpp: number,
  baseType: number,
  colormap: Uint8Array | null,
): Promise<Uint8Array> {
  const planeSize = geometry.width * geometry.height;
  const planes: Uint8Array[] = [];

  if (compression === XCF_COMPRESSION_NONE) {
    const needed = planeSize * bpp;
    reader.assertRange(pointer, needed);
    for (let plane = 0; plane < bpp; plane += 1) {
      const values = new Uint8Array(planeSize);
      for (let index = 0; index < planeSize; index += 1) {
        values[index] = reader.bytes[pointer + index * bpp + plane];
      }
      planes.push(values);
    }
  } else if (compression === XCF_COMPRESSION_RLE) {
    // RLE tiles store each plane as its own run stream, planes back to back.
    let cursor = pointer;
    for (let plane = 0; plane < bpp; plane += 1) {
      const values = new Uint8Array(planeSize);
      cursor += decodeRlePlane(reader, cursor, values);
      planes.push(values);
    }
  } else {
    // Zlib tiles store one deflate stream for the whole interleaved tile.
    const interleaved = await inflateZlibTile(reader, pointer, nextPointer, planeSize * bpp);
    for (let plane = 0; plane < bpp; plane += 1) {
      const values = new Uint8Array(planeSize);
      for (let index = 0; index < planeSize; index += 1) {
        values[index] = interleaved[index * bpp + plane];
      }
      planes.push(values);
    }
  }

  return planesToRgba(planes, bpp, baseType, colormap, planeSize);
}

function planesToRgba(
  planes: Uint8Array[],
  bpp: number,
  baseType: number,
  colormap: Uint8Array | null,
  planeSize: number,
): Uint8Array {
  const rgba = new Uint8Array(planeSize * 4);

  if (bpp === 4 || bpp === 3) {
    for (let index = 0; index < planeSize; index += 1) {
      const target = index * 4;
      rgba[target] = planes[0][index];
      rgba[target + 1] = planes[1][index];
      rgba[target + 2] = planes[2][index];
      rgba[target + 3] = bpp === 4 ? planes[3][index] : 255;
    }
    return rgba;
  }

  if (baseType === XCF_BASE_TYPE_INDEXED) {
    if (!colormap) {
      throw new XcfImportError(
        'indexed-without-colormap',
        'The XCF file uses indexed color without a colormap. Re-save it from GIMP before importing.',
      );
    }
    for (let index = 0; index < planeSize; index += 1) {
      const target = index * 4;
      const paletteIndex = planes[0][index] * 3;
      rgba[target] = colormap[paletteIndex] ?? 0;
      rgba[target + 1] = colormap[paletteIndex + 1] ?? 0;
      rgba[target + 2] = colormap[paletteIndex + 2] ?? 0;
      rgba[target + 3] = bpp === 2 ? planes[1][index] : 255;
    }
    return rgba;
  }

  for (let index = 0; index < planeSize; index += 1) {
    const target = index * 4;
    const gray = planes[0][index];
    rgba[target] = gray;
    rgba[target + 1] = gray;
    rgba[target + 2] = gray;
    rgba[target + 3] = bpp === 2 ? planes[1][index] : 255;
  }
  return rgba;
}

async function decodeHierarchyToImageData(
  reader: XcfReader,
  plan: XcfHierarchyPlan,
  compression: number,
  baseType: number,
  colormap: Uint8Array | null,
  grayscaleMask: boolean,
): Promise<ImageData> {
  const data = new Uint8ClampedArray(plan.width * plan.height * 4);

  if (!plan.empty) {
    for (let row = 0; row < plan.rows; row += 1) {
      for (let column = 0; column < plan.columns; column += 1) {
        const tileIndex = row * plan.columns + column;
        const pointer = plan.tilePointers[tileIndex];
        assertStructurePointer(reader, pointer);
        const nextPointer = plan.tilePointers[tileIndex + 1] ?? reader.length;
        const geometry = tileGeometry(plan, row, column);
        const tileRgba = grayscaleMask
          ? await decodeGrayscaleTile(reader, pointer, nextPointer, compression, geometry)
          : await decodeTileToRgba(reader, pointer, nextPointer, compression, geometry, plan.bpp, baseType, colormap);
        const tileWidth = geometry.width;

        for (let y = 0; y < geometry.height; y += 1) {
          const sourceRow = y * tileWidth * 4;
          const targetRow = ((row * XCF_TILE_SIZE + y) * plan.width + column * XCF_TILE_SIZE) * 4;
          const copyLength = tileWidth * 4;
          for (let index = 0; index < copyLength; index += 1) {
            data[targetRow + index] = tileRgba[sourceRow + index];
          }
        }
      }
    }
  }

  return finishImageData(data, plan.width, plan.height);
}

/** Decode a single-plane tile into white-with-alpha bytes for a layer mask. */
async function decodeGrayscaleTile(
  reader: XcfReader,
  pointer: number,
  nextPointer: number,
  compression: number,
  geometry: XcfTileGeometry,
): Promise<Uint8Array> {
  const planeSize = geometry.width * geometry.height;
  const values = new Uint8Array(planeSize);
  if (compression === XCF_COMPRESSION_NONE) {
    reader.assertRange(pointer, planeSize);
    for (let index = 0; index < planeSize; index += 1) {
      values[index] = reader.bytes[pointer + index];
    }
  } else if (compression === XCF_COMPRESSION_RLE) {
    decodeRlePlane(reader, pointer, values);
  } else {
    const inflated = await inflateZlibTile(reader, pointer, nextPointer, planeSize);
    for (let index = 0; index < planeSize; index += 1) {
      values[index] = inflated[index];
    }
  }
  const rgba = new Uint8Array(planeSize * 4);
  for (let index = 0; index < planeSize; index += 1) {
    const target = index * 4;
    rgba[target] = 255;
    rgba[target + 1] = 255;
    rgba[target + 2] = 255;
    rgba[target + 3] = values[index];
  }
  return rgba;
}

function finishImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') return new ImageData(new Uint8ClampedArray(data), width, height);
  return { data, width, height } as ImageData;
}

interface XcfLayerProperties {
  width: number;
  height: number;
  layerType: number;
  name: string;
  opacity: number;
  visible: boolean;
  gimpMode: number;
  offsetX: number;
  offsetY: number;
  compression: number | null;
  isGroupItem: boolean;
  isTextLayer: boolean;
  hasNonDestructiveEffects: boolean;
  applyMask: boolean;
  isActive: boolean;
  hierarchyPointer: number;
  maskPointer: number;
}

function readXcfLayer(
  reader: XcfReader,
  pointer: number,
  pointerBytes: 4 | 8,
  version: number,
): XcfLayerProperties {
  assertStructurePointer(reader, pointer);
  const width = reader.u32(pointer);
  const height = reader.u32(pointer + 4);
  const layerType = reader.u32(pointer + 8);
  const { value: name, next } = reader.string(pointer + 12);
  void width;
  void height;

  let opacity = 255;
  let visible = true;
  let gimpMode = 0;
  let offsetX = 0;
  let offsetY = 0;
  let compression: number | null = null;
  let isGroupItem = false;
  let isTextLayer = false;
  let hasNonDestructiveEffects = false;
  let applyMask = true;
  let isActive = false;
  let cursor = next;

  for (let propertyIndex = 0; propertyIndex < XCF_IMPORT_LIMITS.maxPropertiesPerStructure; propertyIndex += 1) {
    const property = reader.u32(cursor);
    const payloadLength = reader.u32(cursor + 4);
    cursor += 8;
    if (payloadLength < 0 || cursor + payloadLength > reader.length) {
      throw new XcfImportError('truncated', 'An XCF layer property runs past the end of the file.');
    }
    if (property === XCF_PROP_END) break;

    if (property === XCF_PROP_OPACITY && payloadLength >= 4) {
      opacity = reader.u32(cursor);
    } else if (property === XCF_PROP_VISIBLE && payloadLength >= 4) {
      visible = reader.u32(cursor) !== 0;
    } else if (property === XCF_PROP_MODE && payloadLength >= 4) {
      gimpMode = reader.u32(cursor);
    } else if (property === XCF_PROP_OFFSETS && payloadLength >= 8) {
      offsetX = reader.i32(cursor);
      offsetY = reader.i32(cursor + 4);
    } else if (property === XCF_PROP_COMPRESSION && payloadLength >= 1) {
      compression = reader.u8(cursor);
    } else if (property === XCF_PROP_GROUP_ITEM) {
      isGroupItem = true;
    } else if (property === XCF_PROP_TEXT_LAYER_FLAGS) {
      isTextLayer = true;
    } else if (property === XCF_PROP_APPLY_LAYER_MASK && payloadLength >= 4) {
      applyMask = reader.u32(cursor) !== 0;
    } else if (property === XCF_PROP_ACTIVE_LAYER) {
      isActive = true;
    } else if (property === XCF_PROP_PARASITES) {
      if (scanParasitesForTextLayer(reader, cursor, cursor + payloadLength)) isTextLayer = true;
    }

    cursor += payloadLength;
  }

  const hierarchyPointer = reader.pointer(cursor, pointerBytes);
  const maskPointer = reader.pointer(cursor + pointerBytes, pointerBytes);
  if (version >= XCF_EFFECTS_VERSION) {
    const effectPointer = reader.pointer(cursor + pointerBytes * 2, pointerBytes);
    if (effectPointer > 0) {
      assertStructurePointer(reader, effectPointer);
      hasNonDestructiveEffects = true;
    }
  }

  return {
    width,
    height,
    layerType,
    name,
    opacity,
    visible,
    gimpMode,
    offsetX,
    offsetY,
    compression,
    isGroupItem,
    isTextLayer,
    hasNonDestructiveEffects,
    applyMask,
    isActive,
    hierarchyPointer,
    maskPointer,
  };
}

function scanParasitesForTextLayer(reader: XcfReader, start: number, end: number): boolean {
  let cursor = start;
  while (cursor < end) {
    if (end - cursor < 4) break;
    const nameLength = reader.u32(cursor);
    if (nameLength < 1 || nameLength > XCF_IMPORT_LIMITS.maxStringBytes) break;
    const nameStart = cursor + 4;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > end) break;
    let name = '';
    for (let index = 0; index < nameLength; index += 1) {
      const byte = reader.u8(nameStart + index);
      if (byte === 0) break;
      name += String.fromCharCode(byte);
    }
    if (name.startsWith('gimp-text-layer')) return true;
    if (end - nameEnd < 8) break;
    const dataLength = reader.u32(nameEnd + 4);
    const next = nameEnd + 8 + dataLength;
    if (next > end || next <= cursor) break;
    cursor = next;
  }
  return false;
}

function blendModeFromGimpMode(gimpMode: number, warnings: string[]): BlendMode {
  const mapped = XCF_BLEND_MODE_BY_GIMP_MODE[gimpMode];
  if (mapped) return mapped;
  warnings.push(`The XCF layer mode ${gimpMode} has no Image equivalent; the layer imports with the Normal blend mode.`);
  return 'normal';
}

export interface XcfDecodedLayer {
  name: string;
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  imageData: ImageData;
  offsetX: number;
  offsetY: number;
  mask: ImageData | null;
  warnings: string[];
  active: boolean;
}

export interface XcfDecodedDocument {
  width: number;
  height: number;
  baseType: number;
  versionTag: string;
  compression: number;
  layers: XcfDecodedLayer[];
  warnings: string[];
  skippedGroupLayerCount: number;
  skippedChannelCount: number;
}

export interface XcfFilePolicyInspection {
  versionTag: string;
  width: number;
  height: number;
  baseType: number;
  precision: number | null;
  compression: number | null;
}

/**
 * Bounded header-only sniff for the format policy: recognizes XCF magic and reads canvas facts
 * plus the image-level compression byte without allocating pixel state. Returns null when the
 * bytes are not a recognizable XCF header.
 */
export function inspectXcfFileForPolicy(bytes: Uint8Array | undefined): XcfFilePolicyInspection | null {
  if (!bytes || bytes.byteLength < 26) return null;
  let magic = '';
  for (let index = 0; index < XCF_MAGIC_PREFIX.length; index += 1) {
    magic += String.fromCharCode(bytes[index]);
  }
  if (magic !== XCF_MAGIC_PREFIX) return null;

  try {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const reader = new XcfReader(buffer);
    const props = readXcfImageProps(reader);
    return {
      versionTag: props.versionTag,
      width: props.width,
      height: props.height,
      baseType: props.baseType,
      precision: props.precision,
      compression: props.compression,
    };
  } catch {
    return null;
  }
}

/** Truthful policy message when this platform cannot decode the file's tile compression. */
export function describeXcfUnsupportedCompressionMessage(compression: number): string {
  if (compression === XCF_COMPRESSION_FRACTAL) {
    return 'Fractal-compressed XCF tiles are not decoded. Re-save the file from GIMP with RLE or zlib tile compression before opening here.';
  }
  if (compression === XCF_COMPRESSION_ZLIB) {
    return 'This platform cannot inflate zlib-compressed XCF tiles. Re-save the file from GIMP with RLE or uncompressed tiles before opening here.';
  }
  return `The XCF tile compression mode ${compression} is not decoded. Re-save the file from GIMP with RLE or zlib tile compression before opening here.`;
}

export async function decodeXcfDocument(buffer: ArrayBuffer): Promise<XcfDecodedDocument> {
  const reader = new XcfReader(buffer);
  const props = readXcfImageProps(reader);
  assertSupportedPrecision(props.version, props.precision);
  assertSupportedCompression(props.compression);

  const layerList = readPointerList(
    reader,
    props.layerPointerListOffset,
    XCF_IMPORT_LIMITS.maxLayers,
    'cap-layers',
    props.pointerBytes,
  );
  const channelList = readPointerList(
    reader,
    layerList.next,
    XCF_IMPORT_LIMITS.maxImageChannels,
    'cap-channels',
    props.pointerBytes,
  );
  const layerPointers = layerList.pointers;
  const channelPointers = channelList.pointers;

  const documentWarnings: string[] = [];
  if (props.hasFloatingSelection) {
    documentWarnings.push('The XCF floating selection was imported as a normal layer.');
  }

  const decodedLayers: XcfDecodedLayer[] = [];
  let skippedGroupLayerCount = 0;
  let totalLayerPixels = 0;

  for (const layerPointer of layerPointers) {
    const layer = readXcfLayer(reader, layerPointer, props.pointerBytes, props.version);

    if (layer.isGroupItem) {
      if (layer.hasNonDestructiveEffects) {
        documentWarnings.push(`The XCF layer group "${layer.name}" has GIMP non-destructive effects that Image does not render or reconstruct.`);
      }
      skippedGroupLayerCount += 1;
      continue;
    }
    if (layer.hierarchyPointer <= 0) {
      documentWarnings.push(`The XCF layer "${layer.name}" has no pixel data and was skipped.`);
      continue;
    }

    const warnings: string[] = [];
    const hierarchy = readXcfHierarchyPlan(reader, layer.hierarchyPointer, props.pointerBytes);
    const compression = layer.compression ?? props.compression;
    assertSupportedCompression(compression);

    const layerPixels = hierarchy.width * hierarchy.height;
    let maskPlan: XcfMaskPlan | null = null;
    if (layer.maskPointer > 0) {
      maskPlan = readXcfMaskPlan(reader, layer.maskPointer, props.pointerBytes);
      if (maskPlan.width !== hierarchy.width || maskPlan.height !== hierarchy.height) {
        throw new XcfImportError(
          'invalid-structure',
          `The layer mask of XCF layer "${layer.name}" is ${maskPlan.width}×${maskPlan.height} px instead of matching its ${hierarchy.width}×${hierarchy.height} px layer.`,
        );
      }
    }
    totalLayerPixels += layerPixels + (maskPlan ? maskPlan.width * maskPlan.height : 0);
    if (totalLayerPixels > XCF_IMPORT_LIMITS.maxTotalLayerPixels) {
      throw new XcfImportError(
        'cap-total-layer-pixels',
        `Importing this XCF needs more than the ${XCF_IMPORT_LIMITS.maxTotalLayerPixels.toLocaleString('en-US')} total layer-pixel import cap.`,
      );
    }

    assertLayerTypeMatchesPlane(layer, hierarchy, props.baseType);

    const imageData = await decodeHierarchyToImageData(reader, hierarchy, compression, props.baseType, props.colormap, false);

    let mask: ImageData | null = null;
    if (maskPlan) {
      mask = await decodeXcfMask(reader, maskPlan, compression);
      if (mask && !layer.applyMask) {
        documentWarnings.push(`The layer mask of XCF layer "${layer.name}" was disabled in GIMP and was not applied on import.`);
        mask = null;
      }
    }

    if (layer.isTextLayer) {
      warnings.push(`The XCF text layer "${layer.name}" was imported as raster pixels; its editable text state is not reconstructed.`);
    }
    if (layer.hasNonDestructiveEffects) {
      warnings.push(`The XCF layer "${layer.name}" has GIMP non-destructive effects that Image does not render or reconstruct; imported pixels are the unfiltered source layer.`);
    }

    decodedLayers.push({
      name: layer.name || `Layer ${decodedLayers.length + 1}`,
      visible: layer.visible,
      opacity: Math.max(0, Math.min(1, layer.opacity / 255)),
      blendMode: blendModeFromGimpMode(layer.gimpMode, warnings),
      imageData,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
      mask,
      warnings,
      active: layer.isActive,
    });
  }

  if (decodedLayers.length === 0) {
    throw new XcfImportError(
      'no-layers',
      skippedGroupLayerCount > 0
        ? 'The XCF file contains only group layers without rasterizable pixel data.'
        : 'The XCF file has no layers with pixel data to import.',
    );
  }

  if (skippedGroupLayerCount > 0) {
    documentWarnings.push(
      `${skippedGroupLayerCount} XCF layer group${skippedGroupLayerCount === 1 ? ' was' : 's were'} flattened: `
        + 'child layers were imported in stack order without the group folders.',
    );
  }
  if (channelPointers.length > 0) {
    documentWarnings.push(
      `${channelPointers.length} standalone XCF channel${channelPointers.length === 1 ? '' : 's'} `
        + `${channelPointers.length === 1 ? 'was' : 'were'} not imported; Image keeps layer masks only.`,
    );
  }

  return {
    width: props.width,
    height: props.height,
    baseType: props.baseType,
    versionTag: props.versionTag,
    compression: props.compression,
    layers: decodedLayers,
    warnings: documentWarnings,
    skippedGroupLayerCount,
    skippedChannelCount: channelPointers.length,
  };
}

interface XcfMaskPlan {
  width: number;
  height: number;
  hierarchy: XcfHierarchyPlan;
}

function readXcfMaskPlan(reader: XcfReader, maskPointer: number, pointerBytes: 4 | 8): XcfMaskPlan {
  assertStructurePointer(reader, maskPointer);
  const width = reader.u32(maskPointer);
  const height = reader.u32(maskPointer + 4);
  const { next } = reader.string(maskPointer + 8);
  if (width <= 0 || height <= 0) {
    throw new XcfImportError('invalid-structure', 'An XCF layer mask declares an empty pixel plane.');
  }

  let cursor = next;
  for (let propertyIndex = 0; propertyIndex < XCF_IMPORT_LIMITS.maxPropertiesPerStructure; propertyIndex += 1) {
    const property = reader.u32(cursor);
    const payloadLength = reader.u32(cursor + 4);
    cursor += 8;
    if (payloadLength < 0 || cursor + payloadLength > reader.length) {
      throw new XcfImportError('truncated', 'An XCF channel property runs past the end of the file.');
    }
    if (property === XCF_PROP_END) break;
    cursor += payloadLength;
  }
  const hierarchyPointer = reader.pointer(cursor, pointerBytes);

  const hierarchy = readXcfHierarchyPlan(reader, hierarchyPointer, pointerBytes);
  if (hierarchy.bpp !== 1) {
    throw new XcfImportError(
      'unsupported-precision',
      `An XCF layer mask uses ${hierarchy.bpp} bytes per pixel instead of one byte per pixel.`,
    );
  }

  if (hierarchy.width !== width || hierarchy.height !== height) {
    throw new XcfImportError(
      'invalid-structure',
      `An XCF layer mask header is ${width}×${height} px but its hierarchy is ${hierarchy.width}×${hierarchy.height} px.`,
    );
  }

  return { width, height, hierarchy };
}

async function decodeXcfMask(reader: XcfReader, plan: XcfMaskPlan, compression: number): Promise<ImageData> {
  return decodeHierarchyToImageData(reader, plan.hierarchy, compression, 0, null, true);
}

function imageDataToBitmap(imageData: ImageData): LayerBitmap {
  const bitmap = createBitmap(imageData.width, imageData.height);
  putBitmapImageData(bitmap, imageData);
  return bitmap;
}

export async function createXcfImageDocument(
  buffer: ArrayBuffer,
  params: SourceImageOpenParams,
): Promise<ImageDocument> {
  const decoded = await decodeXcfDocument(buffer);

  // XCF's file list is top-first; Image documents retain their stack bottom-first.
  const documentOrderLayers = [...decoded.layers].reverse();
  const layers: ImageLayer[] = documentOrderLayers.map((layer, index) => ({
    id: `${params.id}-layer-${index + 1}`,
    name: layer.name,
    type: 'image',
    visible: layer.visible,
    locked: false,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    x: layer.offsetX,
    y: layer.offsetY,
    bitmap: imageDataToBitmap(layer.imageData),
    bitmapVersion: 0,
    mask: layer.mask ? imageDataToBitmap(layer.mask) : null,
    metadata: {
      smartLinkedSourceId: params.sourceBinItemId,
      sourceLabel: params.sourceLabel,
      sourceFormat: 'XCF',
      sourceMimeType: params.sourceMimeType,
      sourceWarnings: [...layer.warnings],
      ...(params.sourceBinItemId
        ? {
          sourceLink: {
            id: params.sourceBinItemId,
            label: params.sourceLabel,
            width: layer.imageData.width,
            height: layer.imageData.height,
            status: 'linked' as const,
            relinkHistory: [],
          },
        }
        : {}),
    },
  }));

  const activeIndex = documentOrderLayers.findIndex((layer) => layer.active);
  const activeLayerId = layers[activeIndex >= 0 ? activeIndex : layers.length - 1]?.id ?? null;

  return {
    id: params.id,
    title: params.title,
    width: decoded.width,
    height: decoded.height,
    layers,
    activeLayerId,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
    sourceBinItemId: params.sourceBinItemId,
    metadata: {
      sourceFormat: 'XCF',
      sourceMimeType: params.sourceMimeType,
      warnings: [...decoded.warnings],
    },
  };
}
