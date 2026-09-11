// PDF/X structural validator (docs/notes/835). veraPDF validates PDF/A + PDF/UA but NOT PDF/X, and
// Acrobat/Enfocus preflight are proprietary — so this is Sloom Studio's own check against the ISO 15930
// (PDF/X-1a / PDF/X-4) structural essentials. It is an internal structural verifier, not a substitute
// for a press RIP, Acrobat, Enfocus, or an ISO conformance certification.
//
// It verifies STRUCTURE (the things a bad "fake PDF/X" gets wrong): a GTS_PDFX OutputIntent with an
// embedded CMYK DestOutputProfile, PDF/X version in both XMP and the Info dict, TrimBox + MediaBox on
// every page, a trailer /ID, no encryption, the right header version, and — the big one — no RGB.

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFString, PDFNumber, type PDFContext } from 'pdf-lib';
import { unzlibSync } from 'fflate';
import type { PdfxStandard } from './paperPdfxExport';

export interface PdfxCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface PdfxValidationReport {
  /** Detected PDF/X standard from metadata, if any. */
  standard?: PdfxStandard;
  headerVersion: string;
  /** All checks passed. */
  pass: boolean;
  checks: PdfxCheck[];
}

function textOf(bytes: Uint8Array | Uint8ClampedArray): string {
  return new TextDecoder('latin1').decode(bytes);
}

/** Resolve a value/ref to a PDFRawStream, or undefined. (pdf-lib's typed lookupMaybe rejects PDFRawStream.) */
function asRawStream(ctx: PDFContext, value: unknown): PDFRawStream | undefined {
  if (value == null) return undefined;
  const resolved = ctx.lookup(value as never);
  return resolved instanceof PDFRawStream ? resolved : undefined;
}

function headerVersion(bytes: Uint8Array): string {
  const head = textOf(bytes.subarray(0, 16));
  const m = head.match(/%PDF-(\d\.\d)/);
  return m ? m[1] : '';
}

/** Inflate a FlateDecode stream's raw contents; returns null on any other/failed filter. */
function inflateIfFlate(stream: PDFRawStream): Uint8Array | null {
  const filter = stream.dict.get(PDFName.of('Filter'));
  const raw = stream.contents;
  if (!filter) return raw;
  const filterName = filter instanceof PDFName ? filter.asString() : String(filter);
  if (filterName.includes('FlateDecode')) {
    try {
      return unzlibSync(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function nameValue(value: unknown): string | undefined {
  return value instanceof PDFName ? value.asString().replace(/^\//, '') : undefined;
}

function stringValue(value: unknown): string | undefined {
  return value instanceof PDFString ? value.asString() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

function standardFromPdfxVersion(value: string | undefined): PdfxStandard | undefined {
  if (!value) return undefined;
  if (/^PDF\/X-4(?:\b|:)/i.test(value)) return 'pdf-x-4';
  if (/^PDF\/X-1a(?:\b|:)/i.test(value)) return 'pdf-x-1a';
  return undefined;
}

function asDict(ctx: PDFContext, value: unknown): PDFDict | undefined {
  if (value == null) return undefined;
  const resolved = ctx.lookup(value as never);
  return resolved instanceof PDFDict ? resolved : undefined;
}

/** Return the first inspectable live-transparency construct found in a PDF object dictionary. */
function liveTransparencyDetail(ctx: PDFContext, dict: PDFDict): string | undefined {
  const softMask = dict.get(PDFName.of('SMask'));
  if (softMask && nameValue(softMask) !== 'None') return 'soft mask';
  const smaskInData = numberValue(dict.get(PDFName.of('SMaskInData')));
  if (smaskInData && smaskInData !== 0) return 'image soft-mask data';
  // /Type is optional for ExtGState dictionaries, so alpha keys themselves are also evidence.
  if (
    nameValue(dict.get(PDFName.of('Type'))) === 'ExtGState'
    || dict.has(PDFName.of('ca'))
    || dict.has(PDFName.of('CA'))
  ) {
    const fillAlpha = numberValue(dict.get(PDFName.of('ca')));
    const strokeAlpha = numberValue(dict.get(PDFName.of('CA')));
    if ((fillAlpha !== undefined && fillAlpha < 1) || (strokeAlpha !== undefined && strokeAlpha < 1)) {
      return 'ExtGState alpha';
    }
  }
  const group = asDict(ctx, dict.get(PDFName.of('Group')));
  if (group && nameValue(group.get(PDFName.of('S'))) === 'Transparency') return 'transparency group';
  return undefined;
}

/**
 * Validate PDF/X structure. `expected.standard` (if given) additionally checks the header version and
 * metadata match that standard.
 */
export async function validatePaperPdfx(
  bytes: Uint8Array,
  expected: { standard?: PdfxStandard } = {},
): Promise<PdfxValidationReport> {
  const checks: PdfxCheck[] = [];
  const add = (id: string, label: string, pass: boolean, detail?: string) => checks.push({ id, label, pass, detail });

  const version = headerVersion(bytes);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  const ctx = doc.context;

  // --- OutputIntent with GTS_PDFX + embedded CMYK profile ---
  let outputIntentOk = false;
  let iccOk = false;
  const outputIntents = doc.catalog.lookupMaybe(PDFName.of('OutputIntents'), PDFArray);
  if (outputIntents) {
    for (let i = 0; i < outputIntents.size(); i += 1) {
      const oi = ctx.lookupMaybe(outputIntents.get(i), PDFDict);
      if (!oi) continue;
      if (nameValue(oi.get(PDFName.of('S'))) === 'GTS_PDFX') {
        outputIntentOk = true;
        const dest = asRawStream(ctx, oi.get(PDFName.of('DestOutputProfile')));
        if (dest) {
          const n = dest.dict.get(PDFName.of('N'));
          iccOk = n instanceof PDFNumber ? n.asNumber() === 4 : (dest.contents?.length ?? 0) > 0;
        }
      }
    }
  }
  add('output-intent', 'Has a GTS_PDFX OutputIntent', outputIntentOk);
  add('icc-embedded', 'OutputIntent embeds a CMYK (N=4) ICC profile', iccOk);

  // --- XMP metadata carries GTS_PDFXVersion ---
  let xmpText = '';
  const metadata = asRawStream(ctx, doc.catalog.get(PDFName.of('Metadata')));
  if (metadata) xmpText = textOf(metadata.contents);
  const xmpHasVersion = /GTS_PDFXVersion/.test(xmpText);
  add('xmp-version', 'XMP metadata declares GTS_PDFXVersion', xmpHasVersion);

  let detectedStandard: PdfxStandard | undefined;
  if (/PDF\/X-4/.test(xmpText)) detectedStandard = 'pdf-x-4';
  else if (/PDF\/X-1a/.test(xmpText)) detectedStandard = 'pdf-x-1a';

  // --- Info dict GTS_PDFXVersion + Trapped ---
  let infoVersion: string | undefined;
  let infoVersionOk = false;
  let trappedOk = false;
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict);
  if (info) {
    infoVersion = stringValue(info.get(PDFName.of('GTS_PDFXVersion')));
    infoVersionOk = Boolean(infoVersion);
    const trapped = nameValue(info.get(PDFName.of('Trapped')));
    trappedOk = trapped === 'True' || trapped === 'False';
  }
  add('info-version', 'Info dict declares GTS_PDFXVersion', infoVersionOk);
  add('trapped', 'Info dict declares /Trapped (True/False)', trappedOk);

  // --- Every page has MediaBox + TrimBox ---
  const pages = doc.getPages();
  let allBoxes = pages.length > 0;
  for (const page of pages) {
    const hasMedia = !!page.node.get(PDFName.of('MediaBox'));
    const hasTrim = !!page.node.get(PDFName.of('TrimBox'));
    if (!hasMedia || !hasTrim) {
      allBoxes = false;
      break;
    }
  }
  add('page-boxes', 'Every page has MediaBox + TrimBox', allBoxes, pages.length === 0 ? 'no pages' : undefined);

  // --- Trailer /ID present ---
  const tail = textOf(bytes.subarray(Math.max(0, bytes.length - 3072)));
  const hasId = !!ctx.trailerInfo.ID || /\/ID\s*\[/.test(tail);
  add('trailer-id', 'Trailer has a file /ID', hasId);

  // --- Not encrypted ---
  const notEncrypted = !ctx.trailerInfo.Encrypt && !/\/Encrypt\b/.test(tail);
  add('not-encrypted', 'Document is not encrypted', notEncrypted);

  const targetStandard = expected.standard ?? detectedStandard;
  if (expected.standard) {
    const infoStandard = standardFromPdfxVersion(infoVersion);
    const metadataMatches = detectedStandard === expected.standard && infoStandard === expected.standard;
    const actual = [detectedStandard, infoStandard].filter(Boolean).join(' / ') || 'missing metadata standard';
    add(
      'metadata-standard',
      `XMP and Info metadata match ${expected.standard}`,
      metadataMatches,
      metadataMatches ? undefined : actual,
    );
  }

  // --- PDF/X-1a must not retain live transparency ---
  if (targetStandard === 'pdf-x-1a') {
    let transparencyDetail = '';
    for (const [, object] of ctx.enumerateIndirectObjects()) {
      const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : undefined;
      if (!dict) continue;
      const detail = liveTransparencyDetail(ctx, dict);
      if (detail) {
        transparencyDetail = detail;
        break;
      }
    }
    add('x1a-no-live-transparency', 'PDF/X-1a has no live transparency', !transparencyDetail, transparencyDetail || undefined);
  }

  // --- No RGB anywhere (image color spaces + content color operators) ---
  let rgbDetail = '';
  let noRgb = true;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const subtype = nameValue(obj.dict.get(PDFName.of('Subtype')));
    if (subtype === 'Image') {
      const cs = ctx.lookup(obj.dict.get(PDFName.of('ColorSpace')));
      const csName = nameValue(cs);
      if (csName === 'DeviceRGB' || csName === 'CalRGB') {
        noRgb = false;
        rgbDetail = `image color space ${csName}`;
        break;
      }
      // ICCBased array [/ICCBased <stream>] with N=3 is RGB.
      if (cs instanceof PDFArray && nameValue(cs.get(0)) === 'ICCBased') {
        const iccStream = asRawStream(ctx, cs.get(1));
        const n = iccStream?.dict.get(PDFName.of('N'));
        if (n instanceof PDFNumber && n.asNumber() === 3) {
          noRgb = false;
          rgbDetail = 'ICCBased(N=3) image';
          break;
        }
      }
      continue;
    }
    // Content stream: scan for RGB fill/stroke color operators (rg / RG).
    const decoded = inflateIfFlate(obj);
    if (decoded) {
      const t = textOf(decoded);
      if (/(^|[\s>])\d(\.\d+)?\s+\d(\.\d+)?\s+\d(\.\d+)?\s+(rg|RG)\b/.test(t)) {
        noRgb = false;
        rgbDetail = 'rg/RG color operator';
        break;
      }
    }
  }
  add('no-rgb', 'No RGB color (DeviceCMYK / spot only)', noRgb, rgbDetail || undefined);

  // --- Header version matches the standard (when a standard is expected/detected) ---
  if (targetStandard) {
    const wantVersion = targetStandard === 'pdf-x-4' ? '1.6' : '1.4';
    const versionOk = version === wantVersion || (targetStandard === 'pdf-x-1a' && (version === '1.3' || version === '1.4'));
    add('header-version', `Header version matches ${targetStandard} (${wantVersion})`, versionOk, version);
  }

  const pass = checks.every((c) => c.pass);
  return { standard: detectedStandard, headerVersion: version, pass, checks };
}

/** One-line human summary of a report (for logs / CLI). */
export function summarizePdfxReport(report: PdfxValidationReport): string {
  const failed = report.checks.filter((c) => !c.pass).map((c) => c.label);
  if (report.pass) return `Structural checks passed (${report.standard ?? 'unknown'}, PDF ${report.headerVersion})`;
  return `Structural checks failed: ${failed.join('; ')}`;
}
