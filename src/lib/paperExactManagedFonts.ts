import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperDocument, PaperFrame, PaperManagedFontFace, PaperManagedFontStyle, PaperTextRun, PaperTypography } from '../types/paper';
import { normalizeFamilyName } from './paperFontLibrary';
import { paperFrameLayerIsPrintable, paperParentPageIsApplied } from './paperLayers';
import { canonicalPaperFontObliqueAngle, canUseManagedFontForProduction, normalizePaperFontFamilyId, normalizePaperFontStretch, normalizePaperFontVariationSettings, selectManagedFontFace } from './paperManagedFonts';

/** Failure here is deliberately terminal for browser/raster/print output: fallback paint lies. */
export class PaperExactManagedFontError extends Error {
  readonly code = 'PAPER_EXACT_MANAGED_FONT_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'PaperExactManagedFontError';
  }
}

export function paperFontStyleFromCss(value: string | undefined): PaperManagedFontStyle {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /^oblique(?:\s+-?(?:\d+(?:\.\d+)?|\.\d+)deg)?$/.test(normalized)
    ? 'oblique' : normalized === 'italic' ? 'italic' : 'normal';
}

export function paperFontObliqueAngleFromCss(value: string | undefined): number | undefined {
  const match = value?.trim().toLowerCase().match(/^oblique(?:\s+(-?(?:\d+(?:\.\d+)?|\.\d+))deg)?$/);
  return match ? canonicalPaperFontObliqueAngle('oblique', match[1] === undefined ? 14 : Number(match[1])) : undefined;
}

export function paperFontStyleDescriptor(style: PaperManagedFontStyle, angle?: number): string {
  return style === 'oblique' ? `oblique ${canonicalPaperFontObliqueAngle(style, angle)}deg` : style;
}

export function paperFontWeightFromCss(value: string | undefined, inherited = 400): number {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'bolder') return inherited < 400 ? 400 : inherited < 700 ? 700 : 900;
  if (normalized === 'lighter') return inherited <= 400 ? 100 : inherited <= 700 ? 400 : 700;
  if (normalized === 'bold') return 700;
  if (normalized === 'normal' || !normalized) return 400;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(1, Math.round(parsed))) : 400;
}

export function paperFontStretchFromCss(value: string | undefined): number {
  const keyword: Record<string, number> = { 'ultra-condensed': 50, 'extra-condensed': 62.5, condensed: 75, 'semi-condensed': 87.5, normal: 100, 'semi-expanded': 112.5, expanded: 125, 'extra-expanded': 150, 'ultra-expanded': 200 };
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized in keyword ? keyword[normalized] : normalizePaperFontStretch(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/.test(normalized) ? Number(normalized.slice(0, -1)) : undefined);
}

export function effectivePaperRunTypography(typography: PaperTypography, run?: PaperTextRun): PaperTypography {
  const inheritedWeight = paperFontWeightFromCss(typography.fontWeight);
  return {
    ...typography,
    ...(run?.fontFamily !== undefined ? { fontFamily: run.fontFamily } : {}),
    ...(run?.fontWeight !== undefined ? { fontWeight: String(paperFontWeightFromCss(run.fontWeight, inheritedWeight)) } : {}),
    ...(run?.fontStyle !== undefined ? { fontStyle: run.fontStyle } : {}),
    ...(run?.fontStretch !== undefined ? { fontStretch: run.fontStretch } : {}),
    ...(run?.fontVariationSettings !== undefined ? { fontVariationSettings: run.fontVariationSettings } : {}),
  };
}

export function effectivePaperFrameTypography(frame: PaperFrame, run?: PaperTextRun): PaperTypography {
  return effectivePaperRunTypography(frame.typography, run);
}

export function paperFrameTextStyles(frame: PaperFrame): Array<{ text: string; typography: PaperTypography }> {
  if (!['text', 'caption', 'speechBubble', 'thoughtBubble'].includes(frame.kind)) return [];
  if (frame.richText?.length) return frame.richText.flatMap((paragraph) => paragraph.runs.map((run) => ({ text: run.text, typography: effectivePaperFrameTypography(frame, run) }))).filter(({ text }) => text.trim().length > 0);
  return frame.text?.trim() ? [{ text: frame.text, typography: frame.typography }] : [];
}

/**
 * Resolve the exact managed face this typography requests for BROWSER text paint, or undefined when the
 * family is not managed. Throws typed errors for every unverifiable outcome, including TTC/OTC members:
 * CSS font sources cannot prove which collection member an engine loads (Chromium ignores PostScript-name
 * fragments and always decodes member zero), so browser-painted collection members are unsupported.
 */
export function requestedExactPaperManagedFace(typography: PaperTypography, fonts: readonly PaperManagedFontFace[]): PaperManagedFontFace | undefined {
  const rawFamily = typography.fontFamily ?? '';
  const whole = normalizePaperFontFamilyId(rawFamily);
  const fallback = normalizePaperFontFamilyId(normalizeFamilyName(rawFamily));
  const candidates = fonts.filter((face) => normalizePaperFontFamilyId(face.familyName) === whole || normalizePaperFontFamilyId(face.familyName) === fallback);
  if (!candidates.length) return undefined;
  const familyIds = [...new Set(candidates.map((face) => normalizePaperFontFamilyId(face.familyId)))];
  if (familyIds.length !== 1) throw new PaperExactManagedFontError(`Managed family "${rawFamily}" has ambiguous document identities.`);
  const style = paperFontStyleFromCss(typography.fontStyle);
  const selection = selectManagedFontFace(candidates, {
    familyId: familyIds[0], weight: paperFontWeightFromCss(typography.fontWeight), style,
    obliqueAngleDeg: paperFontObliqueAngleFromCss(typography.fontStyle), stretchPercent: paperFontStretchFromCss(typography.fontStretch),
    variationSettings: typography.fontVariationSettings,
  });
  if (selection.status === 'ambiguous-face') throw new PaperExactManagedFontError(`Managed family "${rawFamily}" has conflicting byte identities for the requested descriptor (${selection.faceIds.join(', ')}).`);
  if (selection.status !== 'selected') throw new PaperExactManagedFontError(`Managed family "${rawFamily}" has no exact requested face; fallback paint is blocked.`);
  assertBrowserPaintablePaperManagedFace(selection.face);
  if (!canUseManagedFontForProduction(selection.face).allowed) throw new PaperExactManagedFontError(`Managed face "${rawFamily}" is not authorized for production output.`);
  return selection.face;
}

/**
 * Resolve every exact face a selection will request after a face-changing edit. Each input typography is
 * already the effective typography of one selected run, so a weight/style/stretch edit preserves mixed
 * managed families instead of accidentally resolving every run against the frame default.
 */
export function requestedExactPaperManagedFacesForTypographyPatch(
  typographies: readonly PaperTypography[],
  patch: Partial<PaperTypography>,
  fonts: readonly PaperManagedFontFace[],
): PaperManagedFontFace[] {
  const requested = new Map<string, PaperManagedFontFace>();
  for (const typography of typographies) {
    const face = requestedExactPaperManagedFace({ ...typography, ...patch }, fonts);
    if (face) requested.set(face.id, face);
  }
  return [...requested.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Browser paint/raster/export cannot verify a collection member; fail before any CSS source is emitted. */
export function assertBrowserPaintablePaperManagedFace(face: PaperManagedFontFace): void {
  if (face.format === 'collection') {
    throw new PaperExactManagedFontError(
      `Managed face "${face.familyName}" (${face.postscriptName}) is a TrueType/OpenType Collection member; browser text cannot verify which member an engine loads, so exact paint is blocked. Extract the face to a standalone .ttf/.otf and re-import it.`,
    );
  }
}

/** Nonexistent-on-purpose family painted while an exact managed face is unresolvable or unregistered. */
export const PAPER_MANAGED_FONT_BLOCKED_FAMILY = 'sloom-managed-font-blocked';

/** A single CSS family token. Quoting is required because digest-derived aliases may not parse as idents. */
export function paperManagedFontFamilyCssValue(family: string): string {
  return `"${family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Live browser paint may use only the digest-derived alias for a managed family. */
export function paperManagedFontFamilyForLivePaint(typography: PaperTypography, fonts: readonly PaperManagedFontFace[] | undefined): string | undefined {
  const all = fonts ?? [];
  const rawFamily = typography.fontFamily ?? '';
  const whole = normalizePaperFontFamilyId(rawFamily);
  const fallback = normalizePaperFontFamilyId(normalizeFamilyName(rawFamily));
  if (!all.some((face) => normalizePaperFontFamilyId(face.familyName) === whole || normalizePaperFontFamilyId(face.familyName) === fallback)) return undefined;
  try {
    const face = requestedExactPaperManagedFace(typography, all);
    return paperManagedFontFamilyCssValue(face ? paperManagedFontFamilyAlias(face) : PAPER_MANAGED_FONT_BLOCKED_FAMILY);
  } catch {
    return paperManagedFontFamilyCssValue(PAPER_MANAGED_FONT_BLOCKED_FAMILY);
  }
}

export function collectExactPaperManagedFaces(frames: readonly PaperFrame[], fonts: readonly PaperManagedFontFace[] | undefined): PaperManagedFontFace[] {
  const all = fonts ?? [];
  const output = new Map<string, PaperManagedFontFace>();
  for (const frame of frames) for (const style of paperFrameTextStyles(frame)) {
    const face = requestedExactPaperManagedFace(style.typography, all);
    if (face) output.set(face.id, face);
  }
  return [...output.values()].sort((left, right) => left.id.localeCompare(right.id));
}

/** Reject a descriptor that would make browser/CSS member selection depend on insertion order. */
export function assertNoConflictingPaperManagedFontDescriptors(fonts: readonly PaperManagedFontFace[] | undefined): void {
  const owners = new Map<string, PaperManagedFontFace>();
  for (const face of fonts ?? []) {
    const variationSettings = normalizePaperFontVariationSettings(face.variationSettings, face.variableAxes);
    const key = `${normalizePaperFontFamilyId(face.familyId)}:${face.weight}:${paperFontStyleDescriptor(face.style, face.obliqueAngleDeg)}:${face.stretchPercent}:${JSON.stringify(variationSettings ?? {})}`;
    const existing = owners.get(key);
    if (existing && (existing.id !== face.id || existing.fontAsset.sha256 !== face.fontAsset.sha256 || existing.collectionIndex !== face.collectionIndex)) {
      throw new PaperExactManagedFontError(`Managed font descriptor collision for ${face.familyName}; exact registration is blocked.`);
    }
    owners.set(key, face);
  }
}

export function paperManagedFontFamilyAlias(face: PaperManagedFontFace): string {
  const safeId = face.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32) || 'face';
  return `sloom-managed-${safeId}-${face.fontAsset.sha256.slice(0, 16)}`;
}

function aliasFrame(frame: PaperFrame, fonts: readonly PaperManagedFontFace[]): PaperFrame {
  if (paperFrameTextStyles(frame).length === 0) return frame;
  const alias = (typography: PaperTypography) => {
    const face = requestedExactPaperManagedFace(typography, fonts);
    return face ? { ...typography, fontFamily: paperManagedFontFamilyAlias(face) } : typography;
  };
  return {
    ...frame, typography: frame.richText?.length ? frame.typography : alias(frame.typography),
    ...(frame.richText ? { richText: frame.richText.map((paragraph) => ({ ...paragraph, runs: paragraph.runs.map((run) => {
      if (!run.text.trim()) return run;
      const effective = alias(effectivePaperFrameTypography(frame, run));
      return effective.fontFamily === (run.fontFamily ?? frame.typography.fontFamily) ? run : { ...run, fontFamily: effective.fontFamily };
    }) })) } : {}),
  };
}

export function aliasPaperDocumentManagedFontFamilies(document: PaperDocument): PaperDocument {
  const fonts = document.importedFonts ?? [];
  if (!fonts.length) return document;
  return { ...document, pages: document.pages.map((page) => ({ ...page, frames: page.frames.map((frame) => aliasFrame(frame, fonts)) })), parentPages: document.parentPages.map((page) => ({ ...page, frames: page.frames.map((frame) => aliasFrame(frame, fonts)) })) };
}

/**
 * Alias only frames eligible for production output. Excluded frames remain authored and retained
 * in the projection, but their managed families are deliberately never resolved: a bad hidden or
 * non-printing font must not poison otherwise exact printable output.
 */
export function aliasPaperDocumentManagedFontFamiliesForOutput(document: PaperDocument): PaperDocument {
  const fonts = document.importedFonts ?? [];
  if (!fonts.length) return document;
  const aliasContainer = <T extends { frames: PaperFrame[] }>(container: T): T => {
    const frames = container.frames.map((frame) => (
      paperFrameLayerIsPrintable(document, frame) ? aliasFrame(frame, fonts) : frame
    ));
    return frames.some((frame, index) => frame !== container.frames[index])
      ? { ...container, frames }
      : container;
  };
  const pages = document.pages.map(aliasContainer);
  const parentPages = document.parentPages.map((parentPage) => (
    paperParentPageIsApplied(document, parentPage.id) ? aliasContainer(parentPage) : parentPage
  ));
  return { ...document, pages, parentPages };
}

export interface PaperManagedFontManifestFace { identity: string; familyAlias: string; postscriptName: string; weight: number; style: PaperManagedFontStyle; obliqueAngleDeg?: number; stretchPercent: number; byteLength?: number; format: PaperManagedFontFace['format']; collectionIndex: number; variationSettings?: Record<string, number>; }
export interface PaperManagedFontManifest { version: 1; faces: PaperManagedFontManifestFace[]; }

function paperManagedFontManifestFaceFor(face: PaperManagedFontFace): PaperManagedFontManifestFace {
  const variationSettings = normalizePaperFontVariationSettings(face.variationSettings, face.variableAxes);
  return {
    identity: `${face.id}:${face.fontAsset.sha256}:${face.postscriptName}:${face.collectionIndex}:${JSON.stringify(variationSettings ?? {})}`,
    familyAlias: paperManagedFontFamilyAlias(face),
    postscriptName: face.postscriptName,
    weight: face.weight,
    style: face.style,
    ...(face.style === 'oblique' ? { obliqueAngleDeg: canonicalPaperFontObliqueAngle(face.style, face.obliqueAngleDeg) } : {}),
    stretchPercent: face.stretchPercent,
    byteLength: face.fontAsset.byteLength,
    format: face.format,
    collectionIndex: face.collectionIndex,
    ...(variationSettings ? { variationSettings } : {}),
  };
}
const manifestPrefix = 'signal-loom-managed-font-manifest:';

function cssString(value: string): string { return `"${[...value].map((char) => `\\${char.codePointAt(0)!.toString(16)} `).join('')}"`; }
function base64(bytes: Uint8Array): string { let output = ''; for (let index = 0; index < bytes.length; index += 0x8000) output += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(output); }

/**
 * Standalone faces only. The PostScript-name URL fragment the CSS Fonts spec describes for TTC/OTC member
 * selection is NOT a usable proof: Chromium ignores it and decodes member zero for any fragment, including
 * nonexistent members, so a collection source would silently paint the wrong face. Collections are rejected
 * as unsupported for browser paint instead of being declared with an unverifiable member.
 */
export function paperManagedFontCssSource(face: PaperManagedFontFace, bytes: Uint8Array): string {
  assertBrowserPaintablePaperManagedFace(face);
  return `url(data:${face.fontAsset.mimeType};base64,${base64(bytes)})`;
}

export async function buildExactPaperManagedFontCss(faces: readonly PaperManagedFontFace[], load: (ref: BinaryAssetRef) => Promise<Uint8Array>): Promise<string> {
  assertNoConflictingPaperManagedFontDescriptors(faces);
  const rules: string[] = [];
  for (const face of faces) {
    const bytes = await load(face.fontAsset);
    if (!bytes.byteLength) throw new PaperExactManagedFontError(`Managed face ${face.familyName} is unavailable.`);
    const source = paperManagedFontCssSource(face, bytes);
    rules.push(`@font-face{font-family:${cssString(paperManagedFontFamilyAlias(face))};font-weight:${face.weight};font-style:${paperFontStyleDescriptor(face.style, face.obliqueAngleDeg)};font-stretch:${face.stretchPercent}%;src:${source};}`);
  }
  const manifest: PaperManagedFontManifest = { version: 1, faces: faces.map(paperManagedFontManifestFaceFor) };
  return `/* ${manifestPrefix}${btoa(JSON.stringify(manifest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')} */\n${rules.join('\n')}`;
}

export function readPaperManagedFontManifest(css: string | undefined): PaperManagedFontManifest | undefined {
  const encoded = css?.match(new RegExp(`/\\*\\s*${manifestPrefix}([A-Za-z0-9_-]+)\\s*\\*/`))?.[1];
  if (!encoded) return undefined;
  try {
    const parsed = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<PaperManagedFontManifest>;
    if (parsed.version !== 1 || !Array.isArray(parsed.faces)) return undefined;
    const valid = parsed.faces.every((face) => face
      && typeof face.identity === 'string'
      && typeof face.familyAlias === 'string'
      && typeof face.postscriptName === 'string'
      && Number.isFinite(face.weight)
      && (face.style === 'normal' || face.style === 'italic' || face.style === 'oblique')
      && Number.isFinite(face.stretchPercent)
      && (face.byteLength === undefined || (Number.isSafeInteger(face.byteLength) && face.byteLength > 0))
      && (face.format === 'truetype' || face.format === 'opentype-cff' || face.format === 'collection')
      && Number.isInteger(face.collectionIndex)
      && face.collectionIndex >= 0);
    return valid ? parsed as PaperManagedFontManifest : undefined;
  } catch {
    return undefined;
  }
}

const paperManagedFontStretchKeywords = new Map<number, string>([
  [50, 'ultra-condensed'],
  [62.5, 'extra-condensed'],
  [75, 'condensed'],
  [87.5, 'semi-condensed'],
  [100, 'normal'],
  [112.5, 'semi-expanded'],
  [125, 'expanded'],
  [150, 'extra-expanded'],
  [200, 'ultra-expanded'],
]);

/** Chromium's FontFaceSet shorthand parser rejects percentage stretch even though @font-face accepts it. */
export function paperManagedFontStretchDescriptor(stretchPercent: number): string {
  const keyword = paperManagedFontStretchKeywords.get(stretchPercent);
  if (!keyword) {
    throw new PaperExactManagedFontError(`Managed font stretch ${stretchPercent}% has no exact CSS shorthand keyword.`);
  }
  return keyword;
}

/** Large CJK/variable faces need more than the old 2.5-second window, but registration remains bounded. */
export function paperManagedFontLoadTimeoutMs(byteLength: number | undefined): number {
  const mebibytes = Math.ceil(Math.max(0, Number(byteLength) || 0) / (1024 * 1024));
  return Math.min(30_000, Math.max(5_000, 2_500 + mebibytes * 2_000));
}

export function paperManagedFontDescriptor(face: PaperManagedFontManifestFace): string {
  return `${paperFontStyleDescriptor(face.style, face.obliqueAngleDeg)} ${face.weight} ${paperManagedFontStretchDescriptor(face.stretchPercent)} 16px "${face.familyAlias}"`;
}

const VERIFY_SAMPLE_TEXT = 'WMWMWMiiiii012345';

function boundedFontFaceVerification(target: Document, timeoutMs: number) {
  const fonts = target.fonts;
  if (!fonts?.ready || typeof fonts.load !== 'function' || typeof fonts.check !== 'function') throw new PaperExactManagedFontError('Browser does not expose requested-face verification.');
  const bounded = <T,>(promise: Promise<T>, label: string) => new Promise<T>((resolve, reject) => { const timer = globalThis.setTimeout(() => reject(new PaperExactManagedFontError(`${label} timed out.`)), timeoutMs); promise.then((value) => { globalThis.clearTimeout(timer); resolve(value); }, reject); });
  return { fonts, bounded };
}

async function verifyRequestedFaceLoaded(
  fonts: FontFaceSet,
  face: PaperManagedFontManifestFace,
  bounded: <T>(promise: Promise<T>, label: string) => Promise<T>,
): Promise<void> {
  if (face.format === 'collection' || face.collectionIndex !== 0) {
    throw new PaperExactManagedFontError(`Managed face ${face.identity} selects a TrueType/OpenType Collection member; Chromium cannot authenticate that member, so exact paint is blocked. Extract it to a standalone .ttf/.otf and re-import it.`);
  }
  const descriptor = paperManagedFontDescriptor(face);
  const loaded = await bounded(Promise.resolve(fonts.load(descriptor, VERIFY_SAMPLE_TEXT)), `Managed face ${face.identity}`);
  const exact = [...loaded].some((candidate) => candidate.family === face.familyAlias && candidate.status === 'loaded');
  if (!exact || !fonts.check(descriptor, VERIFY_SAMPLE_TEXT)) throw new PaperExactManagedFontError(`Managed face did not load with its requested identity: ${face.identity}.`);
}

/** Bounded requested-identity verification. A hostile unrelated FontFace return cannot satisfy this. */
export async function verifyExactPaperManagedFontReadiness(target: Document, css: string | undefined, timeoutMs?: number): Promise<void> {
  if (!css?.includes('@font-face')) return;
  const manifest = readPaperManagedFontManifest(css);
  if (!manifest) throw new PaperExactManagedFontError('Managed font payload has no exact identity manifest.');
  const readinessTimeoutMs = timeoutMs ?? Math.max(5_000, ...manifest.faces.map((face) => paperManagedFontLoadTimeoutMs(face.byteLength)));
  const { fonts, bounded } = boundedFontFaceVerification(target, readinessTimeoutMs);
  await bounded(Promise.resolve(fonts.ready), 'Managed font readiness');
  for (const face of manifest.faces) {
    const faceTimeoutMs = timeoutMs ?? paperManagedFontLoadTimeoutMs(face.byteLength);
    await verifyRequestedFaceLoaded(fonts, face, boundedFontFaceVerification(target, faceTimeoutMs).bounded);
  }
}

/**
 * Bounded single-face authentication for the LIVE editor: the exact registered alias must load with its
 * requested identity before the editor may paint or commit the face. Same proof as export readiness.
 */
export async function verifyExactPaperManagedFaceRegistration(target: Document, face: PaperManagedFontFace, timeoutMs = paperManagedFontLoadTimeoutMs(face.fontAsset.byteLength)): Promise<void> {
  assertBrowserPaintablePaperManagedFace(face);
  const { fonts, bounded } = boundedFontFaceVerification(target, timeoutMs);
  await bounded(Promise.resolve(fonts.ready), 'Managed font readiness');
  await verifyRequestedFaceLoaded(fonts, paperManagedFontManifestFaceFor(face), bounded);
}
