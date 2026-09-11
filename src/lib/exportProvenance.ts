/**
 * Invisible provenance metadata for exports (licensing spec Part 2 §6). Never touches pixels —
 * artists' shared work is the marketing engine. Honest-actor compliance + an enforcement paper
 * trail: every export records the app edition; licensed exports record the licensee.
 *
 * PNG: a `tEXt` chunk (keyword "Software") inserted right after IHDR.
 * JPEG: an APP1 XMP segment inserted after SOI (and after JFIF's APP0 when present).
 */
import { useSettingsStore } from '../store/settingsStore';

export const SIGNAL_LOOM_EXPORT_VERSION = '0.9.9';

export function buildProvenanceLabel(license?: { licensed: boolean; email?: string }): string {
  const current = license ?? useSettingsStore.getState().license;
  return current.licensed && current.email
    ? `Sloom Studio ${SIGNAL_LOOM_EXPORT_VERSION} (licensed to ${current.email})`
    : `Sloom Studio ${SIGNAL_LOOM_EXPORT_VERSION} Community (unlicensed)`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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

/** Insert a tEXt chunk after IHDR. Returns the input unchanged when it is not a PNG. */
export function appendPngSoftwareText(png: Uint8Array, text: string): Uint8Array {
  if (png.length < 33 || PNG_SIGNATURE.some((byte, index) => png[index] !== byte)) {
    return png;
  }

  const keyword = 'Software';
  const payload = new Uint8Array(keyword.length + 1 + text.length);
  payload.set([...keyword].map((ch) => ch.charCodeAt(0)), 0);
  payload[keyword.length] = 0;
  payload.set([...text].map((ch) => ch.charCodeAt(0) & 0x7f), keyword.length + 1);

  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  chunk.set(payload, 8);
  const crcInput = chunk.subarray(4, 8 + payload.length);
  view.setUint32(8 + payload.length, crc32(crcInput));

  // IHDR is always the first chunk: signature (8) + length(4)+type(4)+data(13)+crc(4) = 33.
  const ihdrEnd = 8 + 12 + new DataView(png.buffer, png.byteOffset + 8, 4).getUint32(0);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function buildXmpPacket(label: string): string {
  const escaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    + `<xmp:CreatorTool>${escaped}</xmp:CreatorTool>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>';
}

/** Insert an APP1 XMP segment after SOI/JFIF. Returns the input unchanged when not a JPEG. */
export function insertJpegXmpProvenance(jpeg: Uint8Array, label: string): Uint8Array {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return jpeg;
  }

  const namespace = 'http://ns.adobe.com/xap/1.0/\0';
  const xmp = buildXmpPacket(label);
  const body = new TextEncoder().encode(namespace + xmp);
  const segment = new Uint8Array(4 + body.length);
  segment[0] = 0xff;
  segment[1] = 0xe1; // APP1
  const length = body.length + 2;
  segment[2] = (length >> 8) & 0xff;
  segment[3] = length & 0xff;
  segment.set(body, 4);

  // Insert after SOI, skipping an existing APP0 (JFIF) segment so viewers keep their JFIF header.
  let offset = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0 && jpeg.length >= 6) {
    offset = 4 + (((jpeg[4] << 8) | jpeg[5]) - 2) + 2;
    if (offset > jpeg.length) {
      offset = 2;
    }
  }

  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, offset), 0);
  out.set(segment, offset);
  out.set(jpeg.subarray(offset), offset + segment.length);
  return out;
}

/** Apply the right injector by mime type; unknown types pass through untouched. */
export function applyImageExportProvenance(bytes: Uint8Array, mimeType: string, label = buildProvenanceLabel()): Uint8Array {
  if (mimeType === 'image/png') {
    return appendPngSoftwareText(bytes, label);
  }
  if (mimeType === 'image/jpeg') {
    return insertJpegXmpProvenance(bytes, label);
  }
  return bytes;
}

export async function applyImageExportProvenanceToBlob(blob: Blob, label = buildProvenanceLabel()): Promise<Blob> {
  if (blob.type !== 'image/png' && blob.type !== 'image/jpeg') {
    return blob;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const stamped = applyImageExportProvenance(bytes, blob.type, label);
  return stamped === bytes ? blob : new Blob([stamped as unknown as BlobPart], { type: blob.type });
}
