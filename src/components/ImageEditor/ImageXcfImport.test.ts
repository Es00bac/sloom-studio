import { beforeEach, describe, expect, it } from 'vitest';
import { imageDocumentToXcfBytes } from './ImageXcfInterop';
import {
  createXcfImageDocument,
  decodeXcfDocument,
  describeXcfImportLimitStrings,
  inspectXcfFileForPolicy,
  XCF_IMPORT_LIMITS,
  XcfImportError,
} from './ImageXcfImport';
import {
  createImageDocumentFromFile,
} from './ImageSourceDocument';
import {
  describeSourceImageFormatPolicy,
  detectSourceImageFormatPolicy,
} from './ImageFileFormats';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';

class PixelFakeContext {
  imageData: ImageData;

  constructor(width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    this.imageData = { width, height, data } as ImageData;
  }

  getImageData(_x = 0, _y = 0, width = this.imageData.width, height = this.imageData.height) {
    void _x;
    void _y;
    if (width === this.imageData.width && height === this.imageData.height) {
      return this.imageData;
    }
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }

  createImageData(width: number, height: number) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) } as ImageData;
  }

  putImageData(imageData: ImageData) {
    this.imageData = imageData;
  }

  drawImage() {}
  clearRect() {}
  fillRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  transform() {}
  setTransform() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  clip() {}
  filter = 'none';
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  imageSmoothingEnabled = true;
}

class PixelFakeOffscreenCanvas {
  width: number;
  height: number;
  context: PixelFakeContext;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.context = new PixelFakeContext(width, height);
  }

  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
}

class XcfFixtureWriter {
  bytes: number[] = [];

  get offset(): number {
    return this.bytes.length;
  }

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u32(value: number): this {
    this.bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
    return this;
  }

  u64(value: number): this {
    const high = Math.floor(value / 0x1_0000_0000);
    return this.u32(high).u32(value >>> 0);
  }

  i32(value: number): this {
    return this.u32(value >>> 0);
  }

  ascii(value: string): this {
    for (let index = 0; index < value.length; index += 1) this.u8(value.charCodeAt(index));
    return this;
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length === 0) return this.u32(0);
    this.u32(bytes.length + 1);
    this.raw(bytes);
    return this.u8(0);
  }

  raw(values: Uint8Array | number[]): this {
    for (const value of values) this.u8(value);
    return this;
  }

  reserve(): number {
    const offset = this.offset;
    this.u32(0);
    return offset;
  }

  reserve64(): number {
    const offset = this.offset;
    this.u64(0);
    return offset;
  }

  patch(offset: number, value: number): this {
    this.bytes[offset] = (value >>> 24) & 0xff;
    this.bytes[offset + 1] = (value >>> 16) & 0xff;
    this.bytes[offset + 2] = (value >>> 8) & 0xff;
    this.bytes[offset + 3] = value & 0xff;
    return this;
  }

  patch64(offset: number, value: number): this {
    const high = Math.floor(value / 0x1_0000_0000);
    this.patch(offset, high);
    this.patch(offset + 4, value >>> 0);
    return this;
  }

  toBuffer(): ArrayBuffer {
    const array = new Uint8Array(this.bytes);
    return array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength) as ArrayBuffer;
  }
}

/**
 * GIMP's exact XCF RLE encoding: control < 128 means a repeat run of control+1 copies of the
 * next byte (control 127 switches to a big-endian u16 run length); control >= 128 means a
 * literal copy of 256-control raw bytes (control 128 switches to a u16 length). The encoder
 * here always emits repeat runs.
 */
function rleEncodePlane(values: Uint8Array): number[] {
  const out: number[] = [];
  let index = 0;
  while (index < values.length) {
    const value = values[index];
    let run = 1;
    while (index + run < values.length && values[index + run] === value) run += 1;
    if (run <= 127) {
      out.push(run - 1, value);
    } else {
      out.push(127, (run >> 8) & 0xff, run & 0xff, value);
    }
    index += run;
  }
  return out;
}

async function zlibCompress(values: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([values as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let written = 0;
  for (const chunk of chunks) {
    output.set(chunk, written);
    written += chunk.byteLength;
  }
  return output;
}

interface FixturePlaneLayer {
  name: string;
  width: number;
  height: number;
  type?: number;
  bpp: number;
  planes: Uint8Array[] | 'empty';
  opacity?: number;
  visible?: boolean;
  mode?: number;
  offsetX?: number;
  offsetY?: number;
  groupItem?: boolean;
  textFlags?: boolean;
  active?: boolean;
  applyMask?: boolean;
  effects?: readonly string[];
  compressionOverride?: number;
  mask?: {
    width: number;
    height: number;
    plane: Uint8Array | 'empty';
  };
}

interface FixtureOptions {
  width?: number;
  height?: number;
  baseType?: number;
  compression?: number;
  versionTag?: string;
  precision?: number;
  colormap?: number[];
  floatingSelection?: boolean;
  layers: FixturePlaneLayer[];
  standaloneChannels?: Array<{ width: number; height: number; name: string }>;
  truncateAfter?: number;
}

async function buildXcfFixture(options: FixtureOptions): Promise<ArrayBuffer> {
  const writer = new XcfFixtureWriter();
  const compression = options.compression ?? 0;
  const versionTag = options.versionTag ?? 'v003';
  const versionMatch = /^v(\d{3})$/.exec(versionTag);
  const version = versionMatch ? Number(versionMatch[1]) : 0;
  const pointerBytes: 4 | 8 = version >= 11 ? 8 : 4;
  const baseType = options.baseType ?? 0;
  const reservePointer = () => (pointerBytes === 8 ? writer.reserve64() : writer.reserve());
  const patchPointer = (offset: number, value: number) => (
    pointerBytes === 8 ? writer.patch64(offset, value) : writer.patch(offset, value)
  );
  const writePointer = (value: number) => {
    if (pointerBytes === 8) writer.u64(value);
    else writer.u32(value);
  };
  const defaultLayerType = (bpp: number) => {
    if (baseType === 0) return bpp === 4 ? 1 : 0;
    if (baseType === 1) return bpp === 2 ? 3 : 2;
    return bpp === 2 ? 5 : 4;
  };

  writer.ascii('gimp xcf ');
  writer.ascii(versionTag);
  writer.u8(0);
  writer.u32(options.width ?? 8);
  writer.u32(options.height ?? 8);
  writer.u32(baseType);
  if (version >= 4) writer.u32(options.precision ?? (version === 4 ? 0 : 150));

  if (options.colormap) {
    const payload = new XcfFixtureWriter();
    payload.u32(options.colormap.length / 3);
    payload.raw(options.colormap);
    writer.u32(1);
    writer.u32(payload.offset);
    writer.raw(payload.bytes);
  }
  if (options.floatingSelection) {
    writer.u32(5);
    writer.u32(4);
    writer.u32(0x10);
  }
  {
    const payload = new XcfFixtureWriter();
    payload.u8(compression);
    writer.u32(17);
    writer.u32(payload.offset);
    writer.raw(payload.bytes);
  }
  writer.u32(0);
  writer.u32(0);

  const layerPointerOffsets = options.layers.map(() => reservePointer());
  writePointer(0);
  const channelPointerOffsets = (options.standaloneChannels ?? []).map(() => reservePointer());
  writePointer(0);

  const encodeTile = async (
    planes: Uint8Array[],
    bpp: number,
    planeWidth: number,
    tileWidth: number,
    tileHeight: number,
    column: number,
    row: number,
  ): Promise<number[] | Uint8Array> => {
    const planeSize = tileWidth * tileHeight;
    const pixelAt = (x: number, y: number) => (row * 64 + y) * planeWidth + column * 64 + x;
    if (compression === 0) {
      const out: number[] = [];
      for (let y = 0; y < tileHeight; y += 1) {
        for (let x = 0; x < tileWidth; x += 1) {
          const pixel = pixelAt(x, y);
          for (let plane = 0; plane < bpp; plane += 1) out.push(planes[plane][pixel]);
        }
      }
      return out;
    }
    if (compression === 1) {
      const out: number[] = [];
      for (let plane = 0; plane < bpp; plane += 1) {
        const tilePlane = new Uint8Array(planeSize);
        let index = 0;
        for (let y = 0; y < tileHeight; y += 1) {
          for (let x = 0; x < tileWidth; x += 1) {
            tilePlane[index] = planes[plane][pixelAt(x, y)];
            index += 1;
          }
        }
        out.push(...rleEncodePlane(tilePlane));
      }
      return out;
    }
    const interleaved = new Uint8Array(planeSize * bpp);
    let index = 0;
    for (let y = 0; y < tileHeight; y += 1) {
      for (let x = 0; x < tileWidth; x += 1) {
        const pixel = pixelAt(x, y);
        for (let plane = 0; plane < bpp; plane += 1) {
          interleaved[index] = planes[plane][pixel];
          index += 1;
        }
      }
    }
    return zlibCompress(interleaved);
  };

  const writeHierarchy = async (
    width: number,
    height: number,
    bpp: number,
    planes: Uint8Array[] | 'empty',
  ): Promise<void> => {
    writer.u32(width);
    writer.u32(height);
    writer.u32(bpp);
    const levelPointerOffset = reservePointer();
    writePointer(0);

    const levelOffset = writer.offset;
    writer.u32(width);
    writer.u32(height);
    const columns = Math.ceil(width / 64);
    const rows = Math.ceil(height / 64);
    const tilePointerOffsets: number[] = [];
    for (let index = 0; index < columns * rows; index += 1) {
      tilePointerOffsets.push(reservePointer());
    }
    writePointer(0);

    if (planes !== 'empty') {
      let tileIndex = 0;
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const tileWidth = column === columns - 1 ? width - column * 64 : 64;
          const tileHeight = row === rows - 1 ? height - row * 64 : 64;
          patchPointer(tilePointerOffsets[tileIndex], writer.offset);
          writer.raw(await encodeTile(planes, bpp, width, tileWidth, tileHeight, column, row));
          tileIndex += 1;
        }
      }
    }
    patchPointer(levelPointerOffset, levelOffset);
  };

  for (let index = 0; index < options.layers.length; index += 1) {
    const layer = options.layers[index];
    patchPointer(layerPointerOffsets[index], writer.offset);
    writer.u32(layer.width);
    writer.u32(layer.height);
    writer.u32(layer.type ?? defaultLayerType(layer.bpp));
    writer.string(layer.name);

    const props = new XcfFixtureWriter();
    if (layer.active) {
      props.u32(2);
      props.u32(0);
    }
    {
      props.u32(6);
      props.u32(4);
      props.u32(layer.opacity ?? 255);
    }
    {
      props.u32(7);
      props.u32(4);
      props.u32(layer.mode ?? 0);
    }
    {
      props.u32(8);
      props.u32(4);
      props.u32(layer.visible === false ? 0 : 1);
    }
    if (layer.applyMask === false) {
      props.u32(11);
      props.u32(4);
      props.u32(0);
    }
    {
      props.u32(15);
      props.u32(8);
      props.i32(layer.offsetX ?? 0);
      props.i32(layer.offsetY ?? 0);
    }
    if (layer.compressionOverride !== undefined) {
      props.u32(17);
      props.u32(1);
      props.u8(layer.compressionOverride);
    }
    if (layer.groupItem) {
      props.u32(29);
      props.u32(0);
    }
    if (layer.textFlags) {
      props.u32(26);
      props.u32(4);
      props.u32(1);
    }
    props.u32(0);
    props.u32(0);
    writer.raw(props.bytes);

    const hierarchyPointerOffset = reservePointer();
    const maskPointerOffset = reservePointer();
    const effectPointerOffsets = version >= 20
      ? (layer.effects ?? []).map(() => reservePointer())
      : [];
    if (version >= 20) writePointer(0);

    if (!layer.groupItem) {
      patchPointer(hierarchyPointerOffset, writer.offset);
      await writeHierarchy(layer.width, layer.height, layer.bpp, layer.planes);

      if (layer.mask) {
        patchPointer(maskPointerOffset, writer.offset);
        writer.u32(layer.mask.width);
        writer.u32(layer.mask.height);
        writer.string(`${layer.name} mask`);
        writer.u32(0);
        writer.u32(0);
        const maskHierarchyPointerOffset = reservePointer();
        patchPointer(maskHierarchyPointerOffset, writer.offset);
        const maskPlanes = layer.mask.plane === 'empty' ? 'empty' : [layer.mask.plane];
        await writeHierarchy(layer.mask.width, layer.mask.height, 1, maskPlanes);
      }
    } else {
      patchPointer(hierarchyPointerOffset, 0);
      patchPointer(maskPointerOffset, 0);
    }

    for (let effectIndex = 0; effectIndex < effectPointerOffsets.length; effectIndex += 1) {
      patchPointer(effectPointerOffsets[effectIndex], writer.offset);
      writer.string(`Effect ${effectIndex + 1}`);
      writer.string('gimp-gegl');
      writer.string(layer.effects![effectIndex]);
      if (version >= 22) writer.string('1.0');
      writer.u32(0);
      writer.u32(0);
      writePointer(0);
    }
  }

  for (let index = 0; index < (options.standaloneChannels ?? []).length; index += 1) {
    const channel = options.standaloneChannels![index];
    patchPointer(channelPointerOffsets[index], writer.offset);
    writer.u32(channel.width);
    writer.u32(channel.height);
    writer.string(channel.name);
    writer.u32(0);
    writer.u32(0);
    const hierarchyPointerOffset = reservePointer();
    patchPointer(hierarchyPointerOffset, writer.offset);
    writer.u32(channel.width);
    writer.u32(channel.height);
    writer.u32(1);
    const levelPointerOffset = reservePointer();
    writePointer(0);
    patchPointer(levelPointerOffset, writer.offset);
    writer.u32(channel.width);
    writer.u32(channel.height);
    const tilePointerOffset = reservePointer();
    writePointer(0);
    patchPointer(tilePointerOffset, writer.offset);
    writer.raw(new Uint8Array(channel.width * channel.height));
  }

  const buffer = writer.toBuffer();
  if (options.truncateAfter !== undefined) {
    return buffer.slice(0, options.truncateAfter);
  }
  return buffer;
}

function solidPlane(width: number, height: number, value: number): Uint8Array {
  const plane = new Uint8Array(width * height);
  plane.fill(value);
  return plane;
}

function gradientPlane(width: number, height: number): Uint8Array {
  const plane = new Uint8Array(width * height);
  for (let index = 0; index < plane.length; index += 1) {
    plane[index] = index % 251;
  }
  return plane;
}

function makeLayer(overrides?: Partial<ImageLayer>): ImageLayer {
  return {
    id: 'layer-1',
    name: 'Layer',
    type: 'image',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: new OffscreenCanvas(2, 2) as unknown as ImageLayer['bitmap'],
    bitmapVersion: 0,
    mask: null,
    ...overrides,
  };
}

function makeDoc(layers: ImageLayer[]): ImageDocument {
  return {
    id: 'xcf-doc',
    title: 'Roundtrip',
    width: 2,
    height: 2,
    layers,
    activeLayerId: layers[layers.length - 1]?.id ?? null,
    hasSelection: false,
    selectionVersion: 0,
    viewport: { zoom: 1, panX: 0, panY: 0 },
    dirty: false,
  };
}

// A real GIMP-authored 2.6-era workfile (100×90 RGB, RLE compression, two layers with empty
// pixel levels, one layer mask, two standalone channels). From GIMP's own test corpus.
const GIMP_26_TEST_XCF_BASE64 = 'Z2ltcCB4Y2YgZmlsZQAAAABkAAAAWgAAAAAAAAARAAAAAQEAAAASAAAAFAAAACoCAAAAUgIAAAADAQAAAAQBAAAAGwAAABAA'
  + 'AAAKAAAADAAAACkAAAAxAAAAEwAAAAhDyAAAQ80AAAAAABQAAAAEAAAABwAAABYAAAAEAAAABAAAABkAAAC2AAAAAQAAAAAA'
  + 'AAACAAAACXZlY3RvcnMyAAAAAAcAAAAAAAAAAAAAAAAAAAABAAAAAQAAAAEAAAACAAAAAwAAAAFEY8AARGQAAAAAAABEZkAA'
  + 'RGaAAAAAAAFEaMAARGkAAAAAAAl2ZWN0b3JzMQAAAAAGAAAAAQAAAAAAAAAAAAAAAQAAAAEAAAABAAAAAgAAAAMAAAABQTAA'
  + 'AEFAAAAAAAAAQagAAEGwAAAAAAABQfgAAEIAAAAAAAAVAAAB8gAAAA50ZXN0LXBhcmFzaXRlAAAAAAEAAAAEZm9vAAAAAA1n'
  + 'aW1wLWNvbW1lbnQAAAAAAQAAAJ9DcmVhdGVkIHdpdGggY29kZSBmcm9tIGFwcC90ZXN0cy90ZXN0LXhjZi5jIGluIHRoZSBH'
  + 'SU1QIHNvdXJjZSB0cmVlLCBpLmUuIGl0IHdhcyBub3QgY3JlYXRlZCBtYW51YWxseSBhbmQgbWF5IHRodXMgbG9vayB3ZWly'
  + 'ZCBpZiBvcGVuZWQgYW5kIGluc3BlY3RlZCBpbiBHSU1QLgAAAAAQZ2ltcC1pbWFnZS1ncmlkAAAAAAEAAAEAKHN0eWxlIHNv'
  + 'bGlkKQooZmdjb2xvciAoY29sb3ItcmdiYSAwLjAwMDAwMCAwLjAwMDAwMCAwLjAwMDAwMCAxLjAwMDAwMCkpCihiZ2NvbG9y'
  + 'IChjb2xvci1yZ2JhIDEuMDAwMDAwIDEuMDAwMDAwIDEuMDAwMDAwIDEuMDAwMDAwKSkKKHhzcGFjaW5nIDI1LjAwMDAwMCkK'
  + 'KHlzcGFjaW5nIDI3LjAwMDAwMCkKKHNwYWNpbmctdW5pdCBpbmNoZXMpCih4b2Zmc2V0IDAuMDAwMDAwKQooeW9mZnNldCAw'
  + 'LjAwMDAwMCkKKG9mZnNldC11bml0IGluY2hlcykKAAAAAAAAAAAAAAADVwAABQUAAAAAAAAFyAAABmgAAAAAAAAAGQAAAPsA'
  + 'AAAAAAAAB2xheWVyMgAAAAAGAAAABAAAAAAAAAAIAAAABAAAAAEAAAAJAAAABAAAAAAAAAAKAAAABAAAAAAAAAALAAAABAAA'
  + 'AAEAAAAMAAAABAAAAAEAAAANAAAABAAAAAAAAAAPAAAACAAAAAAAAAAAAAAABwAAAAQAAAADAAAAFAAAAAQAAAADAAAAAAAA'
  + 'AAAAAAP6AAAEOgAAABkAAAD7AAAAAwAABBYAAAQiAAAELgAAAAAAAAAZAAAA+wAAAAAAAAAMAAAAfQAAAAAAAAAGAAAAPgAA'
  + 'AAAAAAAZAAAA+wAAAAxsYXllcjIgbWFzawAAAAAGAAAABAAAAP8AAAAIAAAABAAAAAEAAAAJAAAABAAAAAAAAAAOAAAABAAA'
  + 'AAEAAAAQAAAAAwAAAAAAABQAAAAEAAAABAAAAAAAAAAAAAAEpQAAABkAAAD7AAAAAQAABMEAAATtAAAE+QAAAAAAAAAZAAAA'
  + '+wAABN0AAAThAAAE5QAABOkAAAAAfwZAAH8GQAB/BkAAfwXDAAAAAAwAAAB9AAAAAAAAAAYAAAA+AAAAAAAAADIAAAAzAAAA'
  + 'AQAAAAdsYXllcjEAAAAABgAAAAQAAAD/AAAACAAAAAQAAAABAAAACQAAAAQAAAAAAAAACgAAAAQAAAAAAAAACwAAAAQAAAAA'
  + 'AAAADAAAAAQAAAAAAAAADQAAAAQAAAAAAAAADwAAAAgAAAAAAAAAAAAAAAcAAAAEAAAAAAAAABQAAAAEAAAAAgAAAAAAAAAA'
  + 'AAAFqAAAAAAAAAAyAAAAMwAAAAQAAAW8AAAAAAAAADIAAAAzAAAAAAAAAGQAAABaAAAACWNoYW5uZWwxAAAAAAMAAAAAAAAA'
  + 'BgAAAAQAAAD/AAAACAAAAAQAAAABAAAACQAAAAQAAAAAAAAADgAAAAQAAAABAAAAEAAAAAP/AP8AAAAUAAAABAAAAAUAAAAA'
  + 'AAAAAAAABjgAAABkAAAAWgAAAAEAAAZQAAAGXAAAAAAAAABkAAAAWgAAAAAAAAAyAAAALQAAAAAAAABkAAAAWgAAAA9TZWxl'
  + 'Y3Rpb24gTWFzawAAAAAEAAAAAAAAAAYAAAAEAAAAfwAAAAgAAAAEAAAAAQAAAAkAAAAEAAAAAAAAAA4AAAAEAAAAAQAAABAA'
  + 'AAADAAAAAAAAFAAAAAQAAAABAAAAAAAAAAAAAAbeAAAAZAAAAFoAAAABAAAG9gAAB0QAAAAAAAAAZAAAAFoAAAcSAAAHOAAA'
  + 'BzwAAAdAAAAAAH8BhQAG/zgABv84AAb/OAAG/zgABv84AAb/OAAG/zgABv9/DLQAfwkAAH8GgAB/A6gAAAAAMgAAAC0AAAAA';

function realGimp26Xcf(): ArrayBuffer {
  const decoded = Buffer.from(GIMP_26_TEST_XCF_BASE64, 'base64');
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
}

// GIMP 3.2 authored v011 RGB workfile. Keeping this small real fixture inline
// makes current-GIMP pointer/precision coverage portable and executable.
const GIMP_32_RGB_TEST_XCF_BASE64 = 'Z2ltcCB4Y2YgdjAxMQAAAAAoAAAAHgAAAAAAAACWAAAAEQAAAAEBAAAAEwAAAAhDlgAAQ5YAAAAAABQAAAAEAAAAAgAAABYAAAAEAAAAAQAAABUAAAJzAAAAEGdpbXAtaW1hZ2UtZ3JpZAAAAAABAAAArChzdHlsZSBzb2xpZCkKKGZnY29sb3IgKGNvbG9yLXJnYmEgMCAwIDAgMSkpCihiZ2NvbG9yIChjb2xvci1yZ2JhIDEgMSAxIDEpKQooeHNwYWNpbmcgMTApCih5c3BhY2luZyAxMCkKKHNwYWNpbmctdW5pdCBpbmNoZXMpCih4b2Zmc2V0IDApCih5b2Zmc2V0IDApCihvZmZzZXQtdW5pdCBpbmNoZXMpCgAAAAAUZ2ltcC1pbWFnZS1tZXRhZGF0YQAAAAABAAABizw/eG1sIHZlcnNpb249JzEuMCcgZW5jb2Rpbmc9J1VURi04Jz8+CjxtZXRhZGF0YT4KICA8dGFnIG5hbWU9IkV4aWYuSW1hZ2UuQml0c1BlclNhbXBsZSI+OCA4IDg8L3RhZz4KICA8dGFnIG5hbWU9IkV4aWYuSW1hZ2UuSW1hZ2VMZW5ndGgiPjMwPC90YWc+CiAgPHRhZyBuYW1lPSJFeGlmLkltYWdlLkltYWdlV2lkdGgiPjQwPC90YWc+CiAgPHRhZyBuYW1lPSJFeGlmLkltYWdlLlJlc29sdXRpb25Vbml0Ij4yPC90YWc+CiAgPHRhZyBuYW1lPSJFeGlmLkltYWdlLlhSZXNvbHV0aW9uIj4zMDAvMTwvdGFnPgogIDx0YWcgbmFtZT0iRXhpZi5JbWFnZS5ZUmVzb2x1dGlvbiI+MzAwLzE8L3RhZz4KICA8dGFnIG5hbWU9IkV4aWYuUGhvdG8uQ29sb3JTcGFjZSI+MTwvdGFnPgo8L21ldGFkYXRhPgoAAAAAAAAAAAAAAAAAAAAC6gAAAAAAAAAAAAAAAAAAAAAAAAAoAAAAHgAAAAEAAAAFU29sbwAAAAACAAAAAAAAAAYAAAAEAAAA/wAAACEAAAAEP4AAAAAAAAgAAAAEAAAAAQAAACIAAAAEAAAAAAAAABwAAAAEAAAAAAAAAAoAAAAEAAAAAAAAACAAAAAEAAAAAAAAACoAAAAEAAAAAAAAAAsAAAAEAAAAAAAAAAwAAAAEAAAAAAAAAA0AAAAEAAAAAAAAAA8AAAAIAAAAAAAAAAAAAAAHAAAABAAAABwAAAAlAAAABAAAAAAAAAAkAAAABP////8AAAAjAAAABP////8AAAAUAAAABAAAAAIAAAAAAAAAAAAAAAAAAAP3AAAAAAAAAAAAAAAAAAAAAAAAACgAAAAeAAAABAAAAAAAAAQTAAAAAAAAAAAAAAAoAAAAHgAAAAAAAAQrAAAAAAAAAAB/BLAKfwSwFH8EsB5/BLD/';

function realGimp32RgbXcf(): ArrayBuffer {
  const decoded = Buffer.from(GIMP_32_RGB_TEST_XCF_BASE64, 'base64');
  return decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength) as ArrayBuffer;
}

describe('ImageXcfImport', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = PixelFakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('exports XCF layer records top-first while retaining Image document order on open', async () => {
    const doc = makeDoc([
      makeLayer({ id: 'bottom', name: 'Backdrop' }),
      makeLayer({ id: 'top', name: 'Ink Accent' }),
    ]);
    const bytes = imageDocumentToXcfBytes(doc);
    const decoded = await decodeXcfDocument(bytes.slice().buffer as ArrayBuffer);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.layers.map((layer) => layer.name)).toEqual(['Ink Accent', 'Backdrop']);
    const reopened = await createXcfImageDocument(bytes.slice().buffer as ArrayBuffer, { id: 'roundtrip', title: 'Roundtrip' });
    expect(reopened.layers.map((layer) => layer.name)).toEqual(['Backdrop', 'Ink Accent']);
    expect(decoded.versionTag).toBe('v003');
  });

  it('imports uncompressed RGBA layer pixels, names, opacity, visibility, mode, and offsets', async () => {
    const buffer = await buildXcfFixture({
      width: 4,
      height: 4,
      compression: 0,
      layers: [
        {
          name: 'Backdrop',
          width: 4,
          height: 4,
          bpp: 4,
          opacity: 255,
          planes: [
            solidPlane(4, 4, 200),
            solidPlane(4, 4, 10),
            solidPlane(4, 4, 30),
            solidPlane(4, 4, 255),
          ],
        },
        {
          name: 'Ink',
          width: 2,
          height: 2,
          bpp: 4,
          opacity: 128,
          visible: false,
          mode: 3,
          offsetX: 3,
          offsetY: 5,
          active: true,
          planes: [
            solidPlane(2, 2, 1),
            solidPlane(2, 2, 2),
            solidPlane(2, 2, 3),
            solidPlane(2, 2, 200),
          ],
        },
      ],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers.map((layer) => layer.name)).toEqual(['Backdrop', 'Ink']);

    const backdrop = decoded.layers[0];
    expect(backdrop.opacity).toBe(1);
    expect(backdrop.visible).toBe(true);
    expect(backdrop.blendMode).toBe('normal');
    expect(backdrop.offsetX).toBe(0);
    const backdropPixel = backdrop.imageData.data;
    expect(Array.from(backdropPixel.slice(0, 4))).toEqual([200, 10, 30, 255]);

    const ink = decoded.layers[1];
    expect(ink.opacity).toBeCloseTo(128 / 255, 5);
    expect(ink.visible).toBe(false);
    expect(ink.blendMode).toBe('multiply');
    expect(ink.offsetX).toBe(3);
    expect(ink.offsetY).toBe(5);
    expect(ink.active).toBe(true);
    expect(Array.from(ink.imageData.data.slice(0, 4))).toEqual([1, 2, 3, 200]);
  });

  it('imports current GIMP precision headers and both 32- and 64-bit offset tables', async () => {
    for (const versionTag of ['v004', 'v010', 'v011', 'v023']) {
      const buffer = await buildXcfFixture({
        versionTag,
        width: 2,
        height: 1,
        compression: 0,
        layers: [{
          name: 'Éclat',
          width: 2,
          height: 1,
          bpp: 4,
          mode: 31,
          planes: [
            new Uint8Array([11, 12]), new Uint8Array([13, 14]),
            new Uint8Array([15, 16]), new Uint8Array([255, 255]),
          ],
        }],
      });
      const decoded = await decodeXcfDocument(buffer);
      expect(decoded.versionTag).toBe(versionTag);
      expect(decoded.layers[0].name).toBe('Éclat');
      expect(decoded.layers[0].blendMode).toBe('screen');
      expect(Array.from(decoded.layers[0].imageData.data.slice(0, 4))).toEqual([11, 13, 15, 255]);
    }
  });

  it('uses the real v004 precision domain and maps current Overlay and Exclusion modes', async () => {
    for (const [mode, blendMode] of [[23, 'overlay'], [52, 'exclusion']] as const) {
      const buffer = await buildXcfFixture({
        versionTag: 'v004',
        precision: 0,
        width: 1,
        height: 1,
        layers: [{ name: blendMode, width: 1, height: 1, bpp: 4, mode, planes: 'empty' }],
      });
      const decoded = await decodeXcfDocument(buffer);
      expect(decoded.layers[0].blendMode).toBe(blendMode);
    }

    const corruptPrecision = await buildXcfFixture({
      versionTag: 'v004',
      precision: 150,
      width: 1,
      height: 1,
      layers: [{ name: 'Corrupt v004 precision', width: 1, height: 1, bpp: 4, planes: 'empty' }],
    });
    await expect(decodeXcfDocument(corruptPrecision)).rejects.toMatchObject({ code: 'unsupported-precision' });
    expect(detectSourceImageFormatPolicy({ fileName: 'corrupt-v004.xcf', bytes: new Uint8Array(corruptPrecision) }))
      .toMatchObject({ kind: 'xcf', message: expect.stringContaining('invalid for that XCF version') });
  });

  it('opens the committed real GIMP 3.2 v011 RGB fixture through the normal decoder', async () => {
    const decoded = await decodeXcfDocument(realGimp32RgbXcf());
    expect(decoded.versionTag).toBe('v011');
    expect(decoded.width).toBe(40);
    expect(decoded.height).toBe(30);
    expect(decoded.layers).toHaveLength(1);
    expect(decoded.layers[0]).toMatchObject({ name: 'Solo', blendMode: 'normal' });
  });

  it('fails closed for non-8-bit modern GIMP precision and reports the same policy truth', async () => {
    const buffer = await buildXcfFixture({
      versionTag: 'v011',
      precision: 200,
      width: 1,
      height: 1,
      layers: [{ name: 'High depth', width: 1, height: 1, bpp: 4, planes: 'empty' }],
    });
    await expect(decodeXcfDocument(buffer)).rejects.toMatchObject({ code: 'unsupported-precision' });
    const policy = detectSourceImageFormatPolicy({ fileName: 'high-depth.xcf', bytes: new Uint8Array(buffer) });
    expect(policy).toMatchObject({ kind: 'xcf', message: expect.stringContaining('precision 200') });
  });

  it('fails closed for U8 linear-light precision instead of silently treating linear samples as sRGB', async () => {
    const buffer = await buildXcfFixture({
      versionTag: 'v011',
      precision: 100,
      width: 1,
      height: 1,
      layers: [{
        name: 'Linear mid-grey',
        width: 1,
        height: 1,
        bpp: 4,
        planes: [new Uint8Array([55]), new Uint8Array([55]), new Uint8Array([55]), new Uint8Array([255])],
      }],
    });

    await expect(decodeXcfDocument(buffer)).rejects.toMatchObject({ code: 'unsupported-precision' });
    const policy = detectSourceImageFormatPolicy({ fileName: 'linear-mid-grey.xcf', bytes: new Uint8Array(buffer) });
    expect(policy).toMatchObject({
      kind: 'xcf',
      message: expect.stringContaining('linear-light precision (100)'),
    });
    expect(describeSourceImageFormatPolicy(policy).importStatus).toBe('unsupported');
  });

  it('warns per layer when a GIMP 3 non-destructive effect is present but not rendered', async () => {
    const buffer = await buildXcfFixture({
      versionTag: 'v022',
      width: 2,
      height: 1,
      layers: [{
        name: 'Unfiltered source',
        width: 2,
        height: 1,
        bpp: 4,
        effects: ['gegl:gaussian-blur'],
        planes: [new Uint8Array([255, 0]), new Uint8Array([255, 0]), new Uint8Array([255, 0]), new Uint8Array([255, 255])],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers[0].warnings).toEqual([
      'The XCF layer "Unfiltered source" has GIMP non-destructive effects that Image does not render or reconstruct; imported pixels are the unfiltered source layer.',
    ]);
    expect(Array.from(decoded.layers[0].imageData.data.slice(0, 4))).toEqual([255, 255, 255, 255]);

    const document = await createXcfImageDocument(buffer, { id: 'gimp-effect', title: 'GIMP effect' });
    expect(document.layers[0].metadata?.sourceWarnings).toEqual(decoded.layers[0].warnings);
  });

  it('rejects layer type layouts that contradict their actual pixel planes', async () => {
    const buffer = await buildXcfFixture({
      width: 1,
      height: 1,
      layers: [{
        name: 'Not RGBA',
        width: 1,
        height: 1,
        type: 1,
        bpp: 1,
        planes: [new Uint8Array([22])],
      }],
    });
    await expect(decodeXcfDocument(buffer)).rejects.toMatchObject({ code: 'invalid-layer-type' });
  });

  it('caps a hostile layer mask before any mask pixel buffer is allocated', async () => {
    const buffer = await buildXcfFixture({
      width: 1,
      height: 1,
      layers: [{
        name: 'Mask bomb',
        width: 1,
        height: 1,
        bpp: 4,
        planes: 'empty',
        mask: { width: 20_000, height: 20_000, plane: 'empty' },
      }],
    });
    await expect(decodeXcfDocument(buffer)).rejects.toMatchObject({ code: 'cap-canvas-pixels' });
  });

  it('imports RLE-compressed tiles including partial edge tiles', async () => {
    const width = 70;
    const height = 70;
    const r = gradientPlane(width, height);
    const g = solidPlane(width, height, 17);
    const b = gradientPlane(width, height);
    const a = solidPlane(width, height, 255);

    const buffer = await buildXcfFixture({
      width,
      height,
      compression: 1,
      layers: [{
        name: 'RLE Layer',
        width,
        height,
        bpp: 4,
        planes: [r, g, b, a],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers).toHaveLength(1);
    const data = decoded.layers[0].imageData.data;

    const sample = (x: number, y: number) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    expect(sample(0, 0)).toEqual([0, 17, 0, 255]);
    expect(sample(69, 69)).toEqual([(69 * 70 + 69) % 251, 17, (69 * 70 + 69) % 251, 255]);
    expect(sample(63, 63)).toEqual([(63 * 70 + 63) % 251, 17, (63 * 70 + 63) % 251, 255]);
    expect(sample(64, 64)).toEqual([(64 * 70 + 64) % 251, 17, (64 * 70 + 64) % 251, 255]);
  });

  it('imports zlib-compressed whole tiles', async () => {
    const buffer = await buildXcfFixture({
      width: 5,
      height: 3,
      compression: 2,
      layers: [{
        name: 'Zlib Layer',
        width: 5,
        height: 3,
        bpp: 4,
        planes: [
          solidPlane(5, 3, 9),
          solidPlane(5, 3, 8),
          solidPlane(5, 3, 7),
          gradientPlane(5, 3),
        ],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    const data = decoded.layers[0].imageData.data;
    expect(Array.from(data.slice(0, 8))).toEqual([9, 8, 7, 0, 9, 8, 7, 1]);
    expect(Array.from(data.slice(-4))).toEqual([9, 8, 7, (5 * 3 - 1) % 251]);
  });

  it('imports grayscale and indexed layers with and without alpha', async () => {
    const gray = await buildXcfFixture({
      width: 3,
      height: 1,
      baseType: 1,
      compression: 0,
      layers: [{
        name: 'Gray',
        width: 3,
        height: 1,
        type: 3,
        bpp: 2,
        planes: [new Uint8Array([10, 20, 30]), new Uint8Array([255, 128, 0])],
      }],
    });
    const grayDecoded = await decodeXcfDocument(gray);
    const grayData = grayDecoded.layers[0].imageData.data;
    expect(Array.from(grayData.slice(0, 8))).toEqual([10, 10, 10, 255, 20, 20, 20, 128]);
    expect(Array.from(grayData.slice(8, 12))).toEqual([30, 30, 30, 0]);

    const indexed = await buildXcfFixture({
      width: 2,
      height: 1,
      baseType: 2,
      compression: 0,
      colormap: [255, 0, 0, 0, 255, 0, 0, 0, 255],
      layers: [{
        name: 'Indexed',
        width: 2,
        height: 1,
        type: 5,
        bpp: 2,
        planes: [new Uint8Array([0, 1]), new Uint8Array([200, 250])],
      }],
    });
    const indexedDecoded = await decodeXcfDocument(indexed);
    const indexedData = indexedDecoded.layers[0].imageData.data;
    expect(Array.from(indexedData.slice(0, 8))).toEqual([255, 0, 0, 200, 0, 255, 0, 250]);

    const indexedNoAlpha = await buildXcfFixture({
      width: 1,
      height: 1,
      baseType: 2,
      compression: 0,
      colormap: [1, 2, 3],
      layers: [{
        name: 'Indexed Solid',
        width: 1,
        height: 1,
        type: 4,
        bpp: 1,
        planes: [new Uint8Array([0])],
      }],
    });
    const noAlphaDecoded = await decodeXcfDocument(indexedNoAlpha);
    expect(Array.from(noAlphaDecoded.layers[0].imageData.data.slice(0, 4))).toEqual([1, 2, 3, 255]);
  });

  it('imports layer masks with white-is-opaque alpha semantics', async () => {
    const buffer = await buildXcfFixture({
      width: 4,
      height: 2,
      compression: 0,
      layers: [{
        name: 'Masked',
        width: 4,
        height: 2,
        bpp: 4,
        planes: [
          solidPlane(4, 2, 50),
          solidPlane(4, 2, 60),
          solidPlane(4, 2, 70),
          solidPlane(4, 2, 255),
        ],
        mask: {
          width: 4,
          height: 2,
          plane: new Uint8Array([255, 128, 0, 255, 255, 255, 255, 255]),
        },
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    const mask = decoded.layers[0].mask;
    expect(mask).not.toBeNull();
    expect(mask?.width).toBe(4);
    expect(mask?.height).toBe(2);
    expect(Array.from(mask!.data.slice(0, 8))).toEqual([255, 255, 255, 255, 255, 255, 255, 128]);
    expect(Array.from(mask!.data.slice(8, 12))).toEqual([255, 255, 255, 0]);
  });

  it('drops the mask when GIMP stored apply-mask as disabled, with an explicit warning', async () => {
    const buffer = await buildXcfFixture({
      width: 2,
      height: 2,
      compression: 0,
      layers: [{
        name: 'Unapplied',
        width: 2,
        height: 2,
        bpp: 4,
        applyMask: false,
        planes: [
          solidPlane(2, 2, 1),
          solidPlane(2, 2, 2),
          solidPlane(2, 2, 3),
          solidPlane(2, 2, 255),
        ],
        mask: {
          width: 2,
          height: 2,
          plane: solidPlane(2, 2, 0),
        },
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers[0].mask).toBeNull();
    expect(decoded.warnings.join(' ')).toContain('was disabled in GIMP');
  });

  it('flattens group layers with a warning, keeps child order, and counts standalone channels', async () => {
    const buffer = await buildXcfFixture({
      width: 4,
      height: 4,
      compression: 0,
      layers: [
        {
          name: 'Inside Group',
          width: 4,
          height: 4,
          bpp: 4,
          planes: [
            solidPlane(4, 4, 5),
            solidPlane(4, 4, 6),
            solidPlane(4, 4, 7),
            solidPlane(4, 4, 255),
          ],
        },
        { name: 'Group Folder', width: 4, height: 4, bpp: 4, groupItem: true, planes: 'empty' },
      ],
      standaloneChannels: [
        { width: 2, height: 2, name: 'Extra Alpha' },
      ],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers.map((layer) => layer.name)).toEqual(['Inside Group']);
    expect(decoded.skippedGroupLayerCount).toBe(1);
    expect(decoded.skippedChannelCount).toBe(1);
    expect(decoded.warnings.some((warning) => warning.includes('1 XCF layer group'))).toBe(true);
    expect(decoded.warnings.some((warning) => warning.includes('1 standalone XCF channel'))).toBe(true);
  });

  it('imports text-flagged layers as raster pixels with a per-layer warning', async () => {
    const buffer = await buildXcfFixture({
      width: 2,
      height: 2,
      compression: 0,
      layers: [{
        name: 'Caption',
        width: 2,
        height: 2,
        bpp: 4,
        textFlags: true,
        planes: [
          solidPlane(2, 2, 0),
          solidPlane(2, 2, 0),
          solidPlane(2, 2, 0),
          solidPlane(2, 2, 255),
        ],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers[0].warnings.join(' ')).toContain('text layer "Caption" was imported as raster pixels');
  });

  it('warns about a floating selection instead of dropping it', async () => {
    const buffer = await buildXcfFixture({
      width: 2,
      height: 2,
      compression: 0,
      floatingSelection: true,
      layers: [{
        name: 'Floater',
        width: 2,
        height: 2,
        bpp: 4,
        planes: [
          solidPlane(2, 2, 1),
          solidPlane(2, 2, 1),
          solidPlane(2, 2, 1),
          solidPlane(2, 2, 255),
        ],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.warnings.some((warning) => warning.includes('floating selection'))).toBe(true);
    expect(decoded.layers).toHaveLength(1);
  });

  it('imports GIMP\'s empty-level encoding as fully transparent planes', async () => {
    const buffer = await buildXcfFixture({
      width: 3,
      height: 3,
      compression: 1,
      layers: [{
        name: 'Empty',
        width: 3,
        height: 3,
        bpp: 4,
        planes: 'empty',
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    const data = decoded.layers[0].imageData.data;
    expect(data.length).toBe(3 * 3 * 4);
    expect(data.every((value) => value === 0)).toBe(true);
  });

  it('imports a real GIMP-authored workfile with its actual layer stack and warnings', async () => {
    const decoded = await decodeXcfDocument(realGimp26Xcf());
    expect(decoded.width).toBe(100);
    expect(decoded.height).toBe(90);
    expect(decoded.compression).toBe(1);
    expect(decoded.layers.map((layer) => layer.name)).toEqual(['layer2', 'layer1']);
    expect(decoded.layers[0].blendMode).toBe('multiply');
    expect(decoded.layers[0].opacity).toBe(0);
    expect(decoded.layers[1].blendMode).toBe('normal');
    expect(decoded.layers[1].opacity).toBe(1);
    // Both layers use GIMP's empty-level encoding, so pixels decode as transparent.
    expect(decoded.layers[0].imageData.data.every((value) => value === 0)).toBe(true);
    expect(decoded.skippedChannelCount).toBe(2);
    expect(decoded.warnings.some((warning) => warning.includes('2 standalone XCF channels'))).toBe(true);
  });

  it('maps unknown GIMP layer modes to Normal with a warning', async () => {
    const buffer = await buildXcfFixture({
      width: 1,
      height: 1,
      compression: 0,
      layers: [{
        name: 'Weird Mode',
        width: 1,
        height: 1,
        bpp: 4,
        mode: 999,
        planes: [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3]), new Uint8Array([4])],
      }],
    });

    const decoded = await decodeXcfDocument(buffer);
    expect(decoded.layers[0].blendMode).toBe('normal');
    expect(decoded.layers[0].warnings.some((warning) => warning.includes('layer mode 999'))).toBe(true);
  });

  it('fails closed with typed errors for hostile or unsupported files', async () => {
    const pngMagic = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).buffer as ArrayBuffer;
    await expect(decodeXcfDocument(pngMagic)).rejects.toMatchObject({ code: 'not-xcf' });

    const truncated = await buildXcfFixture({
      width: 4,
      height: 4,
      compression: 0,
      layers: [{
        name: 'T',
        width: 4,
        height: 4,
        bpp: 4,
        planes: [solidPlane(4, 4, 1), solidPlane(4, 4, 2), solidPlane(4, 4, 3), solidPlane(4, 4, 4)],
      }],
      truncateAfter: 40,
    });
    await expect(decodeXcfDocument(truncated)).rejects.toMatchObject({ code: 'truncated' });

    const fractal = await buildXcfFixture({
      width: 1,
      height: 1,
      compression: 3,
      layers: [{
        name: 'F',
        width: 1,
        height: 1,
        bpp: 4,
        planes: 'empty',
      }],
    });
    await expect(decodeXcfDocument(fractal)).rejects.toMatchObject({
      code: 'unsupported-compression',
      message: expect.stringContaining('Fractal-compressed'),
    });

    const wide = await buildXcfFixture({
      width: 30_001,
      height: 4,
      compression: 0,
      layers: [{
        name: 'W',
        width: 1,
        height: 1,
        bpp: 4,
        planes: 'empty',
      }],
    });
    await expect(decodeXcfDocument(wide)).rejects.toMatchObject({ code: 'cap-side-length' });

    const indexedNoMap = await buildXcfFixture({
      width: 1,
      height: 1,
      baseType: 2,
      compression: 0,
      layers: [{
        name: 'I',
        width: 1,
        height: 1,
        type: 4,
        bpp: 1,
        planes: [new Uint8Array([0])],
      }],
    });
    await expect(decodeXcfDocument(indexedNoMap)).rejects.toMatchObject({ code: 'indexed-without-colormap' });

    const rgbWrongBpp = await buildXcfFixture({
      width: 1,
      height: 1,
      compression: 0,
      layers: [{
        name: 'Bad Type',
        width: 1,
        height: 1,
        type: 0,
        bpp: 1,
        planes: [new Uint8Array([0])],
      }],
    });
    await expect(decodeXcfDocument(rgbWrongBpp)).rejects.toMatchObject({ code: 'invalid-layer-type' });

    const onlyGroups = await buildXcfFixture({
      width: 2,
      height: 2,
      compression: 0,
      layers: [{ name: 'G', width: 2, height: 2, bpp: 4, groupItem: true, planes: 'empty' }],
    });
    await expect(decodeXcfDocument(onlyGroups)).rejects.toMatchObject({ code: 'no-layers' });

    const mismatchedMask = await buildXcfFixture({
      width: 4,
      height: 4,
      compression: 0,
      layers: [{
        name: 'M',
        width: 4,
        height: 4,
        bpp: 4,
        planes: [
          solidPlane(4, 4, 1),
          solidPlane(4, 4, 1),
          solidPlane(4, 4, 1),
          solidPlane(4, 4, 1),
        ],
        mask: { width: 2, height: 2, plane: solidPlane(2, 2, 128) },
      }],
    });
    await expect(decodeXcfDocument(mismatchedMask)).rejects.toMatchObject({ code: 'invalid-structure' });
  });

  it('rejects RLE run overruns instead of overwriting memory', async () => {
    // Hand-build a single-pixel grayscale RLE plane whose long-form run claims 65,535 pixels.
    const writer = new XcfFixtureWriter();
    writer.ascii('gimp xcf v003');
    writer.u8(0);
    writer.u32(1);
    writer.u32(1);
    writer.u32(1);
    writer.u32(17);
    writer.u32(1);
    writer.u8(1);
    writer.u32(0);
    writer.u32(0);
    const layerPointerOffset = writer.reserve();
    writer.u32(0);
    writer.u32(0);

    writer.patch(layerPointerOffset, writer.offset);
    writer.u32(1);
    writer.u32(1);
    writer.u32(2);
    writer.string('Bomb');
    writer.u32(6);
    writer.u32(4);
    writer.u32(255);
    writer.u32(0);
    writer.u32(0);
    const hierarchyPointerOffset = writer.reserve();
    writer.u32(0);

    writer.patch(hierarchyPointerOffset, writer.offset);
    writer.u32(1);
    writer.u32(1);
    writer.u32(1);
    const levelPointerOffset = writer.reserve();
    writer.u32(0);
    const levelOffset = writer.offset;
    writer.u32(1);
    writer.u32(1);
    const tilePointerOffset = writer.reserve();
    writer.u32(0);
    writer.patch(tilePointerOffset, writer.offset);
    // Control 127 = long-form repeat run; the u16 length promises 0xFFFF pixels for a 1-pixel plane.
    writer.u8(127);
    writer.u8(0xff);
    writer.u8(0xff);
    writer.u8(0);
    writer.patch(levelPointerOffset, levelOffset);

    await expect(decodeXcfDocument(writer.toBuffer())).rejects.toMatchObject({
      code: 'tile-decompression-overflow',
    });
  });

  it('builds layered Image documents through the shared open path', async () => {
    const buffer = await buildXcfFixture({
      width: 4,
      height: 4,
      compression: 0,
      layers: [
        {
          name: 'Backdrop',
          width: 4,
          height: 4,
          bpp: 4,
          planes: [
            solidPlane(4, 4, 9),
            solidPlane(4, 4, 9),
            solidPlane(4, 4, 9),
            solidPlane(4, 4, 255),
          ],
        },
        {
          name: 'Ink',
          width: 4,
          height: 4,
          bpp: 4,
          active: true,
          planes: [
            solidPlane(4, 4, 1),
            solidPlane(4, 4, 1),
            solidPlane(4, 4, 1),
            solidPlane(4, 4, 128),
          ],
        },
      ],
    });

    const doc = await createXcfImageDocument(buffer, { id: 'xcf-1', title: 'Board' });
    expect(doc.width).toBe(4);
    expect(doc.height).toBe(4);
    expect(doc.layers.map((layer) => layer.name)).toEqual(['Ink', 'Backdrop']);
    expect(doc.activeLayerId).toBe(doc.layers[0].id);
    expect(doc.metadata?.sourceFormat).toBe('XCF');
    expect(doc.layers[1].metadata?.sourceFormat).toBe('XCF');

    const file = new File([buffer], 'board.xcf', { type: 'image/x-xcf' });
    const opened = await createImageDocumentFromFile(file);
    expect(opened.layers.map((layer) => layer.name)).toEqual(['Ink', 'Backdrop']);
    expect(opened.title).toContain('board');

    const fractalBuffer = await buildXcfFixture({
      width: 1,
      height: 1,
      compression: 3,
      layers: [{
        name: 'F',
        width: 1,
        height: 1,
        bpp: 4,
        planes: 'empty',
      }],
    });
    const fractalFile = new File([fractalBuffer], 'old.xcf', { type: 'image/x-xcf' });
    await expect(createImageDocumentFromFile(fractalFile)).rejects.toThrow(/Fractal-compressed/);
  });
});

describe('ImageXcfImport policy integration', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = PixelFakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
  });

  it('reports supported bounded import for decodable XCF bytes', async () => {
    const buffer = await buildXcfFixture({
      width: 2,
      height: 2,
      compression: 1,
      layers: [{
        name: 'L',
        width: 2,
        height: 2,
        bpp: 4,
        planes: [solidPlane(2, 2, 1), solidPlane(2, 2, 2), solidPlane(2, 2, 3), solidPlane(2, 2, 255)],
      }],
    });
    const bytes = new Uint8Array(buffer);
    const inspection = inspectXcfFileForPolicy(bytes);
    expect(inspection).toMatchObject({ width: 2, height: 2, baseType: 0, compression: 1 });

    const policy = detectSourceImageFormatPolicy({ fileName: 'art.xcf', bytes });
    expect(policy.kind).toBe('xcf');
    expect('message' in policy && policy.message).toBeFalsy();

    const description = describeSourceImageFormatPolicy(policy);
    expect(description.importStatus).toBe('supported');
    expect(description.compatibility.importSupported).toBe(true);
    expect(description.warningCodes).toContain('xcf-format-limits');
    expect(description.warningCodes).toContain('xcf-editable-state-loss');
    expect(description.limitations.join(' ')).toContain('30,000');
    expect(description.limitations.join(' ')).toContain('RLE');
  });

  it('keeps honest unsupported policies for undecodable compression', async () => {
    const buffer = await buildXcfFixture({
      width: 1,
      height: 1,
      compression: 3,
      layers: [{
        name: 'F',
        width: 1,
        height: 1,
        bpp: 4,
        planes: 'empty',
      }],
    });
    const bytes = new Uint8Array(buffer);
    const policy = detectSourceImageFormatPolicy({ fileName: 'old.xcf', bytes });
    expect(policy.kind).toBe('xcf');
    expect('message' in policy && policy.message).toContain('Fractal-compressed');

    const description = describeSourceImageFormatPolicy(policy);
    expect(description.importStatus).toBe('unsupported');
    expect(description.compatibility.importSupported).toBe(false);
    expect(description.warningCodes).toContain('xcf-import-unsupported');
  });

  it('exposes the documented import limits for policy text', () => {
    const limits = describeXcfImportLimitStrings();
    expect(limits.length).toBeGreaterThanOrEqual(3);
    expect(limits[0]).toContain(`${XCF_IMPORT_LIMITS.maxSideLength.toLocaleString('en-US')}`);
    expect(() => {
      throw new XcfImportError('truncated', 'probe');
    }).toThrow(XcfImportError);
  });
});
