export const TERRA_SKELETAL_MP4_BASE64 = 'AAAAFGZ0eXBpc29tAAAAAGlzb20AAAAcbW9vdgAAABRoZGxyAAAAAAAAAAB2aWRlAAAACW1kYXQB';

export interface MinimalIsoBmffFixtureOptions {
  kind?: 'video' | 'audio';
  brand?: 'isom' | 'M4V ' | 'M4A ' | 'qt  ';
  codec?: 'avc1' | 'mp4v' | 'mp4a';
  handlerParent?: 'mdia' | 'trak' | 'moov';
  omitBoxes?: readonly string[];
  omitCodecConfig?: boolean;
  omitCodecEntry?: boolean;
  duplicateStsd?: boolean;
  sttsSampleCount?: number;
  stszSampleCount?: number;
  sampleSize?: number;
  chunkOffsetDelta?: number;
  mediaData?: Uint8Array;
}

export function asciiIsoBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

export function u32IsoBytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

export function concatIsoBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function isoBox(type: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = concatIsoBytes(...payload);
  return concatIsoBytes(u32IsoBytes(body.length + 8), asciiIsoBytes(type), body);
}

export function isoFullBox(type: string, body: Uint8Array<ArrayBufferLike> = new Uint8Array(), flags = 0): Uint8Array {
  return isoBox(type, Uint8Array.from([0, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff]), body);
}

function makeMovieHeader(): Uint8Array {
  const body = new Uint8Array(20);
  const view = new DataView(body.buffer);
  view.setUint32(8, 1_000);
  view.setUint32(12, 1_000);
  view.setUint32(16, 0x00010000);
  return isoFullBox('mvhd', body);
}

function makeTrackHeader(kind: 'video' | 'audio'): Uint8Array {
  const body = new Uint8Array(80);
  const view = new DataView(body.buffer);
  view.setUint32(8, 1);
  view.setUint32(16, 1_000);
  if (kind === 'audio') view.setUint16(32, 0x0100);
  view.setUint32(72, kind === 'video' ? 2 << 16 : 0);
  view.setUint32(76, kind === 'video' ? 2 << 16 : 0);
  return isoFullBox('tkhd', body, 7);
}

function makeMediaHeader(): Uint8Array {
  const body = new Uint8Array(20);
  const view = new DataView(body.buffer);
  view.setUint32(8, 1_000);
  view.setUint32(12, 1_000);
  return isoFullBox('mdhd', body);
}

function makeHandler(kind: 'video' | 'audio'): Uint8Array {
  return isoFullBox('hdlr', concatIsoBytes(
    new Uint8Array(4),
    asciiIsoBytes(kind === 'video' ? 'vide' : 'soun'),
    new Uint8Array(12),
  ));
}

function makeDataInformation(): Uint8Array {
  const url = isoFullBox('url ', new Uint8Array(), 1);
  return isoBox('dinf', isoFullBox('dref', concatIsoBytes(u32IsoBytes(1), url)));
}

function makeAvcConfiguration(): Uint8Array {
  return isoBox('avcC', Uint8Array.from([
    1, 0x64, 0, 0x1f, 0xff, 0xe1,
    0, 2, 0x67, 0x64,
    1, 0, 1, 0x68,
  ]));
}

function makeElementaryStreamConfiguration(objectType: number): Uint8Array {
  return isoFullBox('esds', Uint8Array.from([
    0x03, 0x19, 0, 1, 0,
    0x04, 0x11, objectType, 0x15, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x05, 0x02, 0x12, 0x10,
    0x06, 0x01, 0x02,
  ]));
}

function makeSampleEntry(
  kind: 'video' | 'audio',
  codec: 'avc1' | 'mp4v' | 'mp4a',
  omitCodecConfig: boolean,
): Uint8Array {
  if (kind === 'audio') {
    const header = new Uint8Array(28);
    const view = new DataView(header.buffer);
    view.setUint16(6, 1);
    view.setUint16(16, 2);
    view.setUint16(18, 16);
    view.setUint32(24, 44_100 * 65_536);
    return isoBox(codec, header, ...(omitCodecConfig ? [] : [makeElementaryStreamConfiguration(0x40)]));
  }

  const header = new Uint8Array(78);
  const view = new DataView(header.buffer);
  view.setUint16(6, 1);
  view.setUint16(24, 2);
  view.setUint16(26, 2);
  view.setUint32(28, 0x00480000);
  view.setUint32(32, 0x00480000);
  view.setUint16(40, 1);
  view.setUint16(74, 24);
  view.setUint16(76, 0xffff);
  const config = codec === 'avc1' ? makeAvcConfiguration() : makeElementaryStreamConfiguration(0x20);
  return isoBox(codec, header, ...(omitCodecConfig ? [] : [config]));
}

function makeSampleTable(
  options: MinimalIsoBmffFixtureOptions,
  kind: 'video' | 'audio',
  codec: 'avc1' | 'mp4v' | 'mp4a',
  chunkOffset: number,
  sampleSize: number,
): Uint8Array {
  const omitted = new Set(options.omitBoxes);
  const stsd = isoFullBox('stsd', concatIsoBytes(
    u32IsoBytes(options.omitCodecEntry ? 0 : 1),
    ...(options.omitCodecEntry ? [] : [makeSampleEntry(kind, codec, options.omitCodecConfig ?? false)]),
  ));
  const stts = isoFullBox('stts', concatIsoBytes(
    u32IsoBytes(1),
    u32IsoBytes(options.sttsSampleCount ?? 1),
    u32IsoBytes(1_000),
  ));
  const stsc = isoFullBox('stsc', concatIsoBytes(
    u32IsoBytes(1), u32IsoBytes(1), u32IsoBytes(1), u32IsoBytes(1),
  ));
  const stsz = isoFullBox('stsz', concatIsoBytes(
    u32IsoBytes(options.sampleSize ?? sampleSize),
    u32IsoBytes(options.stszSampleCount ?? 1),
  ));
  const stco = isoFullBox('stco', concatIsoBytes(u32IsoBytes(1), u32IsoBytes(chunkOffset)));
  const boxes = [stsd, ...(options.duplicateStsd ? [stsd] : []), stts, stsc, stsz, stco]
    .filter((box) => !omitted.has(new TextDecoder('ascii').decode(box.subarray(4, 8))));
  return isoBox('stbl', ...boxes);
}

function makeMovie(
  options: MinimalIsoBmffFixtureOptions,
  kind: 'video' | 'audio',
  codec: 'avc1' | 'mp4v' | 'mp4a',
  chunkOffset: number,
  sampleSize: number,
): Uint8Array {
  const handler = makeHandler(kind);
  const mediaChildren = [
    makeMediaHeader(),
    ...(options.handlerParent === undefined || options.handlerParent === 'mdia' ? [handler] : []),
    isoBox('minf',
      kind === 'video' ? isoFullBox('vmhd', new Uint8Array(8), 1) : isoFullBox('smhd', new Uint8Array(4)),
      makeDataInformation(),
      makeSampleTable(options, kind, codec, chunkOffset, sampleSize),
    ),
  ];
  const track = isoBox('trak',
    makeTrackHeader(kind),
    ...(options.handlerParent === 'trak' ? [handler] : []),
    isoBox('mdia', ...mediaChildren),
  );
  return isoBox('moov',
    makeMovieHeader(),
    ...(options.handlerParent === 'moov' ? [handler] : []),
    track,
  );
}

export function buildMinimalIsoBmffFixture(options: MinimalIsoBmffFixtureOptions = {}): Uint8Array {
  const kind = options.kind ?? 'video';
  const brand = options.brand ?? (kind === 'audio' ? 'M4A ' : 'isom');
  const codec = options.codec ?? (kind === 'audio' ? 'mp4a' : 'avc1');
  const mediaData = options.mediaData ?? (kind === 'audio'
    ? Uint8Array.from([0x21, 0x10])
    : codec === 'avc1'
      ? Uint8Array.from([0, 0, 0, 2, 0x65, 0x88])
      : Uint8Array.from([0, 0, 1, 0xb6, 0x10]));
  const ftyp = isoBox('ftyp', asciiIsoBytes(brand), new Uint8Array(4), asciiIsoBytes('isom'), asciiIsoBytes(brand));
  let moov = makeMovie(options, kind, codec, 0, mediaData.length);
  const chunkOffset = ftyp.length + moov.length + 8 + (options.chunkOffsetDelta ?? 0);
  moov = makeMovie(options, kind, codec, chunkOffset, mediaData.length);
  return concatIsoBytes(ftyp, moov, isoBox('mdat', mediaData));
}
