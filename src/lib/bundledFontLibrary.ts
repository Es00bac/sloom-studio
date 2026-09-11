import { useEffect, useState } from 'react';
import type { PaperAssetRepository } from '../features/paper/assets/PaperAssetRepository';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { sha256Hex } from '../shared/crypto/sha256';
import type { PaperManagedFontFace, PaperManagedFontStyle } from '../types/paper';
import type {
  ManagedBundledFontFaceIssue,
  ManagedBundledFontFaceReference,
  ManagedBundledFontFaceState,
  ManagedBundledFontSerializableValue,
} from '../types/managedFont';
import { getSignalLoomNativeBridge, type SignalLoomNativeBridge } from './nativeApp';
import { buildImportedFont } from './paperFontLibrary';
import { normalizePaperFontFamilyId } from './paperManagedFonts';
import { vetFontBytes } from './paperFontVetting';
import {
  registerBundledPaperFontProvenance,
  type BundledPaperFontProvenanceIdentity,
} from './bundledPaperFontProvenance';
import {
  getAndroidFontPackStatus,
  isAndroidFontPackRuntime,
  readAndroidFontPackResource,
} from './androidFontPack';

/**
 * signal-loom-font:// is registered only by this app's own Electron main process
 * (electron/main.mjs installProtocolHandlers), wired up alongside the same preload that
 * exposes window.signalLoomNative. A complete signalLoomNative bridge (getNativeState +
 * onMenuCommand) is installed even when the main process found no bundled-font-library root on
 * disk — in that reachable packaged state every signal-loom-font request 404s, so generic bridge
 * shape is not proof the transport actually works. Only the dedicated
 * bridge.bundledFontLibraryStatus() IPC round trip — sourced from the same
 * resolveBundledFontLibraryRoot() the active protocol handler uses — answers that. Never infer
 * support from user agent, URL, process globals, or an optimistic fetch.
 */

// Keyed by bridge object identity so a fresh bridge (real renderer/window reload, or a fresh
// object stubbed in a test) always re-queries instead of replaying a stale cached answer; the
// same bridge instance reuses one in-flight/settled query rather than issuing a new IPC round
// trip per caller. A WeakMap also means an old renderer bridge is not retained by this module.
const capabilityPromises = new WeakMap<SignalLoomNativeBridge, Promise<boolean>>();

function queryBundledFontLibraryCapabilityForBridge(bridge: SignalLoomNativeBridge | undefined): Promise<boolean> {
  if (
    !bridge
    || typeof bridge.getNativeState !== 'function'
    || typeof bridge.onMenuCommand !== 'function'
    || typeof bridge.bundledFontLibraryStatus !== 'function'
  ) {
    return Promise.resolve(false);
  }
  const cached = capabilityPromises.get(bridge);
  if (cached) return cached;
  // Defer invocation into the promise chain: an incomplete/malicious bridge can synchronously
  // throw just as readily as IPC can reject, and both must resolve to the same closed gate.
  const capability = Promise.resolve().then(() => bridge.bundledFontLibraryStatus!())
    .then((status) => status?.available === true)
    .catch(() => false);
  capabilityPromises.set(bridge, capability);
  return capability;
}

export function queryBundledFontLibraryCapability(): Promise<boolean> {
  if (isAndroidFontPackRuntime()) {
    return getAndroidFontPackStatus()
      .then((status) => status.available === true && status.verified === true)
      .catch(() => false);
  }
  return queryBundledFontLibraryCapabilityForBridge(getSignalLoomNativeBridge());
}

export const BUNDLED_FONT_LIBRARY_CAPABILITY_EVENT = 'sloom-bundled-font-library-capability-change';

export function notifyBundledFontLibraryCapabilityChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BUNDLED_FONT_LIBRARY_CAPABILITY_EVENT));
}

/**
 * Shared React contract for gating bundled-font UI. Starts (and stays, until positively
 * confirmed) false — callers must fail closed while the main-process round trip is pending, not
 * just once it resolves negative. One query per bridge identity is shared across every mounted
 * consumer via queryBundledFontLibraryCapability's cache.
 */
export function useBundledFontLibraryCapability(): boolean {
  const bridge = getSignalLoomNativeBridge();
  const authority = isAndroidFontPackRuntime() ? 'android' : bridge;
  const [state, setState] = useState<{ authority: SignalLoomNativeBridge | 'android' | undefined; available: boolean }>({
    authority,
    available: false,
  });
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      setState({ authority, available: false });
      void queryBundledFontLibraryCapability().then((available) => {
        if (!cancelled) setState({ authority, available });
      });
    };
    refresh();
    window.addEventListener(BUNDLED_FONT_LIBRARY_CAPABILITY_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(BUNDLED_FONT_LIBRARY_CAPABILITY_EVENT, refresh);
    };
  }, [authority]);
  // React has rendered against a new bridge before its effect can complete. Do not expose a
  // previous bridge's positive capability for that intermediate render.
  return state.authority === authority && state.available;
}

export type BundledFontCollection = 'base' | 'optional-chinese' | 'optional-korean';
export type BundledFontRole = 'sans' | 'serif' | 'mono' | 'display' | 'handwriting' | 'japanese' | 'cjk';

export interface BundledFontAxis {
  min: number;
  default: number;
  max: number;
}

export interface BundledFontFace {
  id: string;
  file: string;
  collectionIndex: number;
  sha256: string;
  byteLength: number;
  family: string;
  subfamily: string;
  fullName: string;
  postscriptName: string;
  version: string;
  weight: number;
  style: PaperManagedFontStyle;
  stretchPercent: number;
  /** Runtime/catalog proof that stretchPercent came from the face, rather than the legacy 100% fallback. */
  stretchVerified?: boolean;
  glyphCount: number;
  variable: boolean;
  axes: Record<string, BundledFontAxis>;
  canSubset: boolean;
  hasVerticalSubstitution: boolean;
}

export interface BundledFontFamily {
  id: string;
  family: string;
  slug: string;
  collection: BundledFontCollection;
  role: BundledFontRole;
  sourceUrl: string;
  sourceVersion: string;
  licenseId: string;
  licenseFile: string;
  licenseSha256: string;
  licenseByteLength: number;
  faces: BundledFontFace[];
  warnings: string[];
}

export interface BundledFontCatalog {
  schemaVersion: number;
  familyCount: number;
  faceCount: number;
  families: BundledFontFamily[];
}

interface JsonRecord { [key: string]: unknown }

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`);
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is missing.`);
  return value.trim();
}

function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function safeResourcePath(value: unknown, label: string): string {
  const path = text(value, label).replace(/\\/g, '/');
  if (path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${label} contains an unsafe path.`);
  }
  return path;
}

function collection(value: unknown): BundledFontCollection {
  if (value === 'base' || value === 'optional-chinese' || value === 'optional-korean') return value;
  throw new Error('Bundled font collection is invalid.');
}

function styleFor(face: JsonRecord): PaperManagedFontStyle {
  const value = [face.subfamily, face.fullName, face.postscriptName].filter((entry) => typeof entry === 'string').join(' ');
  if (/\boblique\b/i.test(value)) return 'oblique';
  return /\bitalic\b/i.test(value) ? 'italic' : 'normal';
}

function stretchFor(face: JsonRecord, axes: Record<string, BundledFontAxis>): { percent: number; verified: boolean } {
  const explicit = face.stretchPercent;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return { percent: Math.max(50, Math.min(200, explicit)), verified: true };
  }
  const widthAxis = axes.wdth;
  return widthAxis
    ? { percent: Math.max(50, Math.min(200, widthAxis.default)), verified: true }
    : { percent: 100, verified: false };
}

const MONO_SLUGS = new Set(['sourcecodepro', 'ibmplexmono', 'notosansmono', 'liberationmono', 'jetbrainsmono', 'firacode', 'inconsolata', 'spacemono', 'robotomono', 'cousine', 'anonymouspro']);
const SERIF_HINT = /(serif|garamond|baskerville|spectral|lora|merriweather|alegreya|literata|newsreader|vollkorn|cardo|gentium|charis|andada|fraunces|bodoni|playfair|mincho|myeongjo)/i;
const DISPLAY_SLUGS = new Set(['bebasneue', 'anton', 'cinzel', 'abrilfatface', 'dmserifdisplay', 'unbounded', 'syne', 'alfaslabone', 'blackopsone', 'limelight', 'staatliches', 'lilitaone', 'bangers', 'luckiestguy', 'boogaloo', 'chewy']);
const HAND_SLUGS = new Set(['patrickhand', 'permanentmarker', 'kalam', 'shantellsans', 'caveat', 'dancingscript', 'pacifico', 'sacramento', 'greatvibes', 'architectsdaughter', 'indieflower', 'yomogi', 'yujisyuku']);
const JAPANESE_SLUGS = new Set(['notosansjp', 'notoserifjp', 'bizudpgothic', 'bizudpmincho', 'mplus1', 'mplus2', 'mplusrounded1c', 'ibmplexsansjp', 'zenkakugothicnew', 'zenoldmincho', 'zenmarugothic', 'shipporimincho', 'kosugimaru', 'kleeone', 'delagothicone', 'dotgothic16', 'reggaeone', 'rocknrollone', 'yomogi', 'yujisyuku']);

function roleFor(family: string, slug: string, group: BundledFontCollection): BundledFontRole {
  if (group !== 'base') return 'cjk';
  if (JAPANESE_SLUGS.has(slug)) return 'japanese';
  if (MONO_SLUGS.has(slug)) return 'mono';
  if (HAND_SLUGS.has(slug)) return 'handwriting';
  if (DISPLAY_SLUGS.has(slug)) return 'display';
  return SERIF_HINT.test(family) ? 'serif' : 'sans';
}

function parseAxes(value: unknown): Record<string, BundledFontAxis> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(value.map((raw) => {
    const axis = record(raw, 'Bundled font axis');
    const tag = text(axis.tag, 'Bundled font axis tag');
    if (!/^[ -~]{4}$/.test(tag)) throw new Error('Bundled font axis tag is invalid.');
    return [tag, {
      min: number(axis.minimum, `${tag} minimum`),
      default: number(axis.default, `${tag} default`),
      max: number(axis.maximum, `${tag} maximum`),
    }];
  }));
}

export function parseBundledFontInventory(input: unknown): BundledFontCatalog {
  const inventory = record(input, 'Bundled font inventory');
  if (number(inventory.criticalErrorCount, 'Bundled font critical error count') !== 0) {
    throw new Error('Bundled font inventory contains critical audit errors.');
  }
  if (!Array.isArray(inventory.families)) throw new Error('Bundled font inventory has no families.');
  const families = inventory.families.map((rawFamily): BundledFontFamily => {
    const family = record(rawFamily, 'Bundled font family');
    const group = collection(family.collection);
    const familyName = text(family.family, 'Bundled font family name');
    const slug = text(family.slug, 'Bundled font family slug');
    const source = record(family.source, `${familyName} source`);
    if (!Array.isArray(family.licenses) || family.licenses.length === 0) throw new Error(`${familyName} has no license.`);
    const license = record(family.licenses[0], `${familyName} license`);
    if (!Array.isArray(family.faces) || family.faces.length === 0) throw new Error(`${familyName} has no faces.`);
    const faces = family.faces.map((rawFace): BundledFontFace => {
      const face = record(rawFace, `${familyName} face`);
      const file = safeResourcePath(face.file, `${familyName} font path`);
      const postscriptName = text(face.postscriptName, `${familyName} PostScript name`);
      const sha256 = text(face.sha256, `${postscriptName} SHA-256`).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${postscriptName} SHA-256 is invalid.`);
      const axes = parseAxes(face.axes);
      const stretch = stretchFor(face, axes);
      return {
        id: `${slug}:${postscriptName}:${sha256.slice(0, 12)}`,
        file,
        collectionIndex: nonNegativeInteger(face.collectionIndex, `${postscriptName} collection index`),
        sha256,
        byteLength: Math.max(1, Math.round(number(face.byteLength, `${postscriptName} byte length`))),
        family: text(face.family, `${postscriptName} family`),
        subfamily: text(face.subfamily, `${postscriptName} subfamily`),
        fullName: text(face.fullName, `${postscriptName} full name`),
        postscriptName,
        version: text(face.version, `${postscriptName} version`),
        weight: Math.max(1, Math.min(1000, Math.round(number(face.weight, `${postscriptName} weight`)))),
        style: styleFor(face),
        glyphCount: Math.max(0, Math.round(number(face.glyphCount, `${postscriptName} glyph count`))),
        variable: face.variable === true,
        axes,
        stretchPercent: stretch.percent,
        stretchVerified: stretch.verified,
        canSubset: face.noSubsetting !== true,
        hasVerticalSubstitution: face.hasVerticalSubstitution === true,
      };
    }).sort((left, right) => left.weight - right.weight || left.style.localeCompare(right.style));
    const sourceVersion = typeof source.commit === 'string' && source.commit.trim()
      ? source.commit.trim()
      : faces[0].version;
    return {
      id: `${group}:${slug}`,
      family: familyName,
      slug,
      collection: group,
      role: roleFor(familyName, slug, group),
      sourceUrl: text(source.url, `${familyName} source URL`),
      sourceVersion,
      licenseId: text(license.spdx, `${familyName} license id`),
      licenseFile: safeResourcePath(license.file, `${familyName} license path`),
      licenseSha256: text(license.sha256, `${familyName} license SHA-256`).toLowerCase(),
      licenseByteLength: Math.max(1, Math.round(number(license.byteLength, `${familyName} license byte length`))),
      faces,
      warnings: Array.isArray(family.warnings) ? family.warnings.filter((entry): entry is string => typeof entry === 'string') : [],
    };
  }).sort((left, right) => left.family.localeCompare(right.family));
  const faceCount = families.reduce((total, family) => total + family.faces.length, 0);
  const expectedFamilies = number(inventory.catalogFamilyCount, 'Bundled font family count');
  const expectedFaces = number(inventory.faceCount, 'Bundled font face count');
  if (families.length !== expectedFamilies || faceCount !== expectedFaces) {
    throw new Error('Bundled font inventory counts do not match its contents.');
  }
  return {
    schemaVersion: number(inventory.schemaVersion, 'Bundled font schema version'),
    familyCount: families.length,
    faceCount,
    families,
  };
}

export function bundledFontResourceUrl(path: string): string {
  const safe = safeResourcePath(path, 'Bundled font resource');
  return `signal-loom-font://library/${safe.split('/').map(encodeURIComponent).join('/')}`;
}

export function bundledFontFaceCssDescriptor(
  face: BundledFontFace,
): Pick<FontFaceDescriptors, 'style' | 'weight' | 'stretch'> {
  const weightAxis = face.axes.wght;
  return {
    style: face.style,
    stretch: `${face.stretchPercent}%`,
    weight: weightAxis
      ? `${Math.round(weightAxis.min)} ${Math.round(weightAxis.max)}`
      : String(face.weight),
  };
}

const browserFontPromises = new Map<string, Promise<FontFace>>();
const browserFontErrors = new Map<string, string>();
const registeredFaceStretch = new Map<string, number>();

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = number(value, label);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer.`);
  return parsed;
}

function serializableValue(value: unknown, depth = 0): ManagedBundledFontSerializableValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (depth >= 12) return '[maximum depth exceeded]';
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => serializableValue(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 200)
      .map(([key, entry]) => [key, serializableValue(entry, depth + 1)]));
  }
  return String(value);
}

function issue(
  reason: ManagedBundledFontFaceIssue['reason'],
  message: string,
  original: unknown,
): ManagedBundledFontFaceIssue {
  return { kind: 'bundled-font-issue', reason, message, original: serializableValue(original) };
}

export function bundledFontFaceIdentitySignature(reference: ManagedBundledFontFaceReference): string {
  return JSON.stringify([
    reference.schemaVersion,
    reference.faceId,
    reference.family,
    reference.weight,
    reference.style,
    reference.obliqueAngleDeg ?? (reference.style === 'oblique' ? 14 : undefined),
    reference.stretchPercent,
    Object.entries(reference.variationSettings ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    reference.collectionIndex,
    reference.sha256,
    reference.byteLength,
  ]);
}

export function bundledFontFaceStyleDescriptor(reference: ManagedBundledFontFaceReference): string {
  return reference.style === 'oblique'
    ? reference.obliqueAngleDeg === undefined ? 'oblique' : `oblique ${reference.obliqueAngleDeg}deg`
    : reference.style;
}

export function bundledFontFaceVariationSettingsCss(reference: ManagedBundledFontFaceReference): string | undefined {
  const entries = Object.entries(reference.variationSettings ?? {})
    .filter(([tag, value]) => /^[ -~]{4}$/.test(tag) && Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length ? entries.map(([tag, value]) => `"${tag}" ${value}`).join(', ') : undefined;
}

export function bundledFontFaceRuntimeFamilyName(
  reference: ManagedBundledFontFaceReference,
): string {
  return `Sloom Managed Face ${encodeURIComponent(bundledFontFaceIdentitySignature(reference))}`;
}

function bundledFaceBelongsToFamily(family: BundledFontFamily, face: BundledFontFace): boolean {
  return family.faces.some((candidate) => (
    candidate.id === face.id
    && candidate.collectionIndex === face.collectionIndex
    && candidate.sha256 === face.sha256
    && candidate.byteLength === face.byteLength
    && candidate.family === face.family
    && candidate.weight === face.weight
    && candidate.style === face.style
    && candidate.stretchPercent === face.stretchPercent
  ));
}

export function createBundledFontFaceReference(
  family: BundledFontFamily,
  face: BundledFontFace,
): ManagedBundledFontFaceReference {
  if (!bundledFaceBelongsToFamily(family, face)) {
    throw new Error('The selected face does not belong to the bundled family.');
  }
  if (face.stretchVerified !== true) {
    throw new Error(`${face.fullName} must be registered from its audited bytes before its exact managed identity can be authored.`);
  }
  return {
    kind: 'bundled',
    schemaVersion: 2,
    faceId: face.id,
    family: family.family,
    weight: face.weight,
    style: face.style,
    ...(face.style === 'oblique' ? { obliqueAngleDeg: 14 } : {}),
    stretchPercent: face.stretchPercent,
    ...(face.variable ? { variationSettings: Object.fromEntries(Object.entries(face.axes).map(([tag, axis]) => [tag, axis.default])) } : {}),
    collectionIndex: face.collectionIndex,
    sha256: face.sha256,
    byteLength: face.byteLength,
  };
}

export function normalizeBundledFontFaceReference(value: unknown): ManagedBundledFontFaceReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== 'bundled'
    || candidate.schemaVersion !== 2
    || typeof candidate.faceId !== 'string'
    || !candidate.faceId.trim()
    || typeof candidate.family !== 'string'
    || !candidate.family.trim()
    || typeof candidate.weight !== 'number'
    || !Number.isFinite(candidate.weight)
    || !Number.isInteger(candidate.weight)
    || candidate.weight < 1
    || candidate.weight > 1000
    || (candidate.style !== 'normal' && candidate.style !== 'italic' && candidate.style !== 'oblique')
    || typeof candidate.stretchPercent !== 'number'
    || !Number.isFinite(candidate.stretchPercent)
    || candidate.stretchPercent < 50
    || candidate.stretchPercent > 200
    || typeof candidate.collectionIndex !== 'number'
    || !Number.isInteger(candidate.collectionIndex)
    || candidate.collectionIndex < 0
    || typeof candidate.sha256 !== 'string'
    || !SHA256_PATTERN.test(candidate.sha256)
    || typeof candidate.byteLength !== 'number'
    || !Number.isInteger(candidate.byteLength)
    || candidate.byteLength < 1
  ) return undefined;
  const variationSettings = candidate.variationSettings;
  if (variationSettings !== undefined && (!variationSettings || typeof variationSettings !== 'object' || Array.isArray(variationSettings)
    || Object.entries(variationSettings).some(([tag, coordinate]) => !/^[ -~]{4}$/.test(tag) || typeof coordinate !== 'number' || !Number.isFinite(coordinate)))) return undefined;
  const obliqueAngleDeg = candidate.obliqueAngleDeg;
  if (obliqueAngleDeg !== undefined && (candidate.style !== 'oblique' || typeof obliqueAngleDeg !== 'number' || !Number.isFinite(obliqueAngleDeg) || obliqueAngleDeg < -90 || obliqueAngleDeg > 90)) return undefined;
  return {
    kind: 'bundled',
    schemaVersion: 2,
    faceId: candidate.faceId.trim(),
    family: candidate.family.trim(),
    weight: candidate.weight,
    style: candidate.style,
    ...(candidate.style === 'oblique' && obliqueAngleDeg !== undefined ? { obliqueAngleDeg } : {}),
    stretchPercent: candidate.stretchPercent,
    ...(variationSettings ? { variationSettings: Object.fromEntries(Object.entries(variationSettings as Record<string, number>).sort(([left], [right]) => left.localeCompare(right))) } : {}),
    collectionIndex: candidate.collectionIndex,
    sha256: candidate.sha256,
    byteLength: candidate.byteLength,
  };
}

function isLegacyBundledFontFaceReference(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'bundled'
    && candidate.schemaVersion === undefined
    && typeof candidate.faceId === 'string'
    && typeof candidate.family === 'string'
    && typeof candidate.weight === 'number'
    && (candidate.style === 'normal' || candidate.style === 'italic' || candidate.style === 'oblique')
    && typeof candidate.stretchPercent === 'number';
}

export function normalizeBundledFontFaceIssue(value: unknown): ManagedBundledFontFaceIssue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.kind !== 'bundled-font-issue'
    || (candidate.reason !== 'invalid-reference'
      && candidate.reason !== 'legacy-reference'
      && candidate.reason !== 'typography-mismatch')
    || typeof candidate.message !== 'string'
    || !candidate.message.trim()
  ) return undefined;
  return issue(candidate.reason, candidate.message.trim(), candidate.original);
}

export function normalizeBundledFontFaceState(
  managedFace: unknown,
  managedFaceIssue?: unknown,
): ManagedBundledFontFaceState {
  const reference = normalizeBundledFontFaceReference(managedFace);
  if (reference) return { managedFace: reference };
  const preservedIssue = normalizeBundledFontFaceIssue(managedFaceIssue);
  if (preservedIssue) return { managedFaceIssue: preservedIssue };
  if (managedFace === undefined || managedFace === null) return {};
  if (isLegacyBundledFontFaceReference(managedFace)) {
    return {
      managedFaceIssue: issue(
        'legacy-reference',
        'This project contains a legacy managed-font reference without a full content hash or collection identity. Sloom Studio must verify and upgrade it before exact rendering.',
        managedFace,
      ),
    };
  }
  return {
    managedFaceIssue: issue(
      'invalid-reference',
      'This text item contains a malformed managed-font reference. Reselect an audited bundled face before preview or export.',
      managedFace,
    ),
  };
}

export function managedBundledFontFaceIssueForTypographyMismatch(
  reference: ManagedBundledFontFaceReference,
): ManagedBundledFontFaceIssue {
  return issue(
    'typography-mismatch',
    'The saved managed-font identity no longer matches this text item\'s family, weight, or style. Reselect the audited face before preview or export.',
    reference,
  );
}

export function normalizeBundledFontFaceStateForTypography(
  managedFace: unknown,
  managedFaceIssue: unknown,
  typography: { family: string; weight: number | string | undefined; style: string | undefined },
): ManagedBundledFontFaceState {
  const state = normalizeBundledFontFaceState(managedFace, managedFaceIssue);
  if (!state.managedFace) return state;
  return bundledFontFaceReferenceMatchesTypography(state.managedFace, typography)
    ? state
    : { managedFaceIssue: managedBundledFontFaceIssueForTypographyMismatch(state.managedFace) };
}

export function bundledFontFaceReferenceMatchesTypography(
  reference: ManagedBundledFontFaceReference,
  typography: { family: string; weight: number | string | undefined; style: string | undefined },
): boolean {
  const weight = typeof typography.weight === 'number'
    ? typography.weight
    : Number.parseInt(typography.weight ?? '', 10);
  return typography.family.trim() === reference.family
    && Number.isFinite(weight)
    && Math.round(weight) === reference.weight
    && typography.style === reference.style;
}

export function resolveBundledFontFaceReference(
  reference: ManagedBundledFontFaceReference,
  catalog: BundledFontCatalog,
): { family: BundledFontFamily; face: BundledFontFace } {
  const faceIdCandidates = catalog.families.flatMap((family) => family.faces
    .filter((face) => face.id === reference.faceId)
    .map((face) => ({ family, face })));
  const exactCandidates = faceIdCandidates.filter(({ family, face }) => (
    family.family === reference.family
    && face.weight === reference.weight
    && face.style === reference.style
    && (reference.style !== 'oblique' || (reference.obliqueAngleDeg ?? 14) >= -90)
    && face.stretchPercent === reference.stretchPercent
    && face.collectionIndex === reference.collectionIndex
    && face.sha256 === reference.sha256
    && face.byteLength === reference.byteLength
  ));
  if (exactCandidates.length === 0) {
    if (faceIdCandidates.length > 0) {
      throw new Error(`${reference.family} face ${reference.faceId} no longer matches its saved family/weight/style/stretch/collection/content identity. Reinstall the matching bundled font library before rendering.`);
    }
    throw new Error(`${reference.family} face ${reference.faceId} is unavailable or unauthorized. Reinstall or enable the audited bundled font library, then reopen the project.`);
  }
  if (exactCandidates.length !== 1) {
    throw new Error(`${reference.family} face ${reference.faceId} has a duplicate complete identity in the bundled catalog. Exact rendering is blocked until the catalog collision is repaired.`);
  }
  return exactCandidates[0];
}

export interface EnsureBundledFontFacesOptions {
  catalog?: BundledFontCatalog;
  fetchImpl?: typeof fetch;
}

export type ManagedBundledFontDependency =
  | { reference: ManagedBundledFontFaceReference; issue?: never }
  | { reference?: never; issue: ManagedBundledFontFaceIssue };

export interface BundledFontRegistrationReport {
  ready: true;
  registeredFaceIds: string[];
  registeredIdentities: string[];
}

async function loadVerifiedBundledFontBytes(face: BundledFontFace, fetchImpl: typeof fetch): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await fetchResourceBytes(face.file, fetchImpl, face.fullName);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'byte transport failed';
    throw new Error(`${face.family} (${face.fullName}) is unavailable or unauthorized. Reinstall or enable the audited bundled font library, then retry. ${detail}`);
  }
  const hash = sha256Hex(bytes);
  if (bytes.byteLength !== face.byteLength || hash !== face.sha256) {
    throw new Error(`${face.fullName} failed bundled-font integrity verification. Reinstall the audited font library before rendering.`);
  }
  return bytes;
}

async function registerResolvedBundledFontFace(
  family: BundledFontFamily,
  face: BundledFontFace,
  fetchImpl: typeof fetch,
  reference?: ManagedBundledFontFaceReference,
): Promise<FontFace> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') {
    throw new Error('Live bundled-font registration is unavailable in this renderer.');
  }
  const identity = reference
    ? bundledFontFaceIdentitySignature(reference)
    : `catalog:${face.id}:${family.family}:${face.collectionIndex}:${face.sha256}:${face.byteLength}`;
  const existing = browserFontPromises.get(identity);
  if (existing) {
    return existing.then((loaded) => {
      const exactStretch = registeredFaceStretch.get(identity);
      if (exactStretch !== undefined) {
        face.stretchPercent = exactStretch;
        face.stretchVerified = true;
      }
      if (reference && exactStretch !== reference.stretchPercent) {
        throw new Error(`${reference.family} face ${reference.faceId} no longer matches its saved stretch identity (${reference.stretchPercent}%). Reinstall the matching bundled font library before rendering.`);
      }
      return loaded;
    });
  }
  const catalogStretchPercent = face.stretchPercent;
  const catalogStretchVerified = face.stretchVerified === true;
  let resolvedIdentity: string | undefined;
  const pending = loadVerifiedBundledFontBytes(face, fetchImpl).then(async (bytes) => {
    const vet = vetFontBytes(bytes);
    if (vet.format === 'collection') {
      throw new Error(`${face.fullName} is stored in a TrueType/OpenType Collection that Chromium cannot authenticate. Install a standalone .ttf/.otf build before rendering.`);
    }
    const vettedFace = vet.faces.find((candidate) => candidate.collectionIndex === face.collectionIndex);
    if (!vet.ok || !vettedFace?.ok) {
      throw new Error(`${face.fullName} failed bundled-font face validation. Reinstall the audited font library before rendering.`);
    }
    face.stretchPercent = vettedFace.stretchPercent;
    face.stretchVerified = true;
    if (
      vettedFace.familyName !== face.family
      || vettedFace.familyName !== family.family
      || vettedFace.weight !== face.weight
      || vettedFace.style !== face.style
      || (reference && vettedFace.stretchPercent !== reference.stretchPercent)
    ) {
      throw new Error(`${face.fullName} no longer matches its saved family/weight/style/stretch face metadata. Reinstall the matching bundled font library before rendering.`);
    }
    registeredFaceStretch.set(identity, vettedFace.stretchPercent);
    const runtimeReference = reference ?? createBundledFontFaceReference(family, face);
    resolvedIdentity = bundledFontFaceIdentitySignature(runtimeReference);
    registeredFaceStretch.set(resolvedIdentity, vettedFace.stretchPercent);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const descriptor = { ...bundledFontFaceCssDescriptor(face), style: bundledFontFaceStyleDescriptor(runtimeReference) };
    const managed = await new FontFace(bundledFontFaceRuntimeFamilyName(runtimeReference), buffer, descriptor).load();
    document.fonts.add(managed);
    browserFontErrors.delete(identity);
    if (resolvedIdentity) {
      browserFontErrors.delete(resolvedIdentity);
      browserFontPromises.set(resolvedIdentity, pending);
    }
    return managed;
  }).catch((error) => {
    browserFontPromises.delete(identity);
    registeredFaceStretch.delete(identity);
    if (resolvedIdentity) {
      browserFontPromises.delete(resolvedIdentity);
      registeredFaceStretch.delete(resolvedIdentity);
    }
    face.stretchPercent = catalogStretchPercent;
    face.stretchVerified = catalogStretchVerified;
    browserFontErrors.set(identity, error instanceof Error ? error.message : 'Bundled face registration failed.');
    if (resolvedIdentity) browserFontErrors.set(resolvedIdentity, error instanceof Error ? error.message : 'Bundled face registration failed.');
    throw error;
  });
  browserFontPromises.set(identity, pending);
  return pending;
}

export async function ensureBundledFontFaceReferencesRegistered(
  references: readonly ManagedBundledFontFaceReference[],
  options: EnsureBundledFontFacesOptions = {},
): Promise<BundledFontRegistrationReport> {
  const normalized = references.map((reference) => normalizeBundledFontFaceReference(reference));
  if (normalized.some((reference) => !reference)) {
    throw new Error('A managed bundled-font reference is malformed or uses a truncated content identity. Reselect the audited face before rendering.');
  }
  const exactReferences = normalized as ManagedBundledFontFaceReference[];
  const unique = [...new Map(exactReferences.map((reference) => [bundledFontFaceIdentitySignature(reference), reference])).values()];
  if (unique.length === 0) return { ready: true, registeredFaceIds: [], registeredIdentities: [] };
  const fetchImpl = options.fetchImpl ?? fetch;
  let catalog: BundledFontCatalog;
  try {
    catalog = options.catalog ?? await loadBundledFontCatalog(fetchImpl);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'catalog lookup failed';
    throw new Error(`Referenced bundled font faces are unavailable or unauthorized. Reinstall or enable the audited bundled font library, then retry. ${detail}`);
  }
  const resolved = unique.map((reference) => ({ reference, ...resolveBundledFontFaceReference(reference, catalog) }));
  await Promise.all(resolved.map(({ family, face, reference }) => registerResolvedBundledFontFace(family, face, fetchImpl, reference)));
  return {
    ready: true,
    registeredFaceIds: unique.map((reference) => reference.faceId),
    registeredIdentities: unique.map(bundledFontFaceIdentitySignature),
  };
}

export async function ensureBundledFontDependenciesReady(
  dependencies: readonly ManagedBundledFontDependency[],
  options: EnsureBundledFontFacesOptions = {},
): Promise<BundledFontRegistrationReport> {
  const unresolved = dependencies.find((dependency) => dependency.issue)?.issue;
  if (unresolved) {
    throw new Error(`${unresolved.message} Exact managed typography is blocked until the reference is repaired.`);
  }
  return ensureBundledFontFaceReferencesRegistered(
    dependencies.flatMap((dependency) => dependency.reference ?? []),
    options,
  );
}

export async function upgradeLegacyBundledFontFaceIssue(
  fontIssue: ManagedBundledFontFaceIssue,
  options: EnsureBundledFontFacesOptions = {},
): Promise<ManagedBundledFontFaceReference | undefined> {
  if (fontIssue.reason !== 'legacy-reference' || !fontIssue.original || typeof fontIssue.original !== 'object' || Array.isArray(fontIssue.original)) {
    return undefined;
  }
  const legacy = fontIssue.original as Record<string, ManagedBundledFontSerializableValue>;
  if (
    legacy.kind !== 'bundled'
    || typeof legacy.faceId !== 'string'
    || typeof legacy.family !== 'string'
    || typeof legacy.weight !== 'number'
    || (legacy.style !== 'normal' && legacy.style !== 'italic' && legacy.style !== 'oblique')
    || typeof legacy.stretchPercent !== 'number'
  ) return undefined;
  const fetchImpl = options.fetchImpl ?? fetch;
  const catalog = options.catalog ?? await loadBundledFontCatalog(fetchImpl);
  const candidates = catalog.families.flatMap((family) => family.faces
    .filter((face) => (
      face.id === legacy.faceId
      && family.family === legacy.family
      && face.weight === legacy.weight
      && face.style === legacy.style
      && face.stretchPercent === legacy.stretchPercent
    ))
    .map((face) => ({ family, face })));
  if (candidates.length !== 1) return undefined;
  const { family, face } = candidates[0];
  const reference: ManagedBundledFontFaceReference = {
    kind: 'bundled',
    schemaVersion: 2,
    faceId: face.id,
    family: family.family,
    weight: face.weight,
    style: face.style,
    stretchPercent: legacy.stretchPercent,
    collectionIndex: face.collectionIndex,
    sha256: face.sha256,
    byteLength: face.byteLength,
  };
  await ensureBundledFontFaceReferencesRegistered([reference], { catalog, fetchImpl });
  return reference;
}

export function getBundledFontFaceRegistrationError(reference: ManagedBundledFontFaceReference): string | undefined {
  return browserFontErrors.get(bundledFontFaceIdentitySignature(reference));
}

/** Registers a bundled face for live Image/Video/Paper preview without copying it into a project. */
export function ensureBundledFontFaceRegistered(
  family: BundledFontFamily,
  face: BundledFontFace,
): Promise<FontFace> {
  if (!bundledFaceBelongsToFamily(family, face)) {
    return Promise.reject(new Error('The selected face does not belong to the bundled family.'));
  }
  return registerResolvedBundledFontFace(family, face, fetch);
}

let catalogPromise: Promise<BundledFontCatalog> | undefined;
let catalogAuthority: SignalLoomNativeBridge | 'android' | undefined;

async function fetchBundledFontCatalog(
  bridge: SignalLoomNativeBridge | undefined,
  fetchImpl: typeof fetch,
): Promise<BundledFontCatalog> {
  if (isAndroidFontPackRuntime()) {
    const status = await getAndroidFontPackStatus();
    if (!status.available || !status.verified) {
      throw new Error('The optional Android publishing font pack is not downloaded and verified.');
    }
    const bytes = await readAndroidFontPackResource('inventory/font-inventory.json');
    const catalog = parseBundledFontInventory(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (!isAndroidFontPackRuntime()) {
      throw new Error('The bundled font library runtime changed while its catalog was loading.');
    }
    return catalog;
  }
  const available = await queryBundledFontLibraryCapabilityForBridge(bridge);
  if (!available || getSignalLoomNativeBridge() !== bridge) {
    throw new Error('The bundled font library requires the Sloom Studio desktop app with a resolved font-library root; this renderer has no usable signal-loom-font transport.');
  }
  const response = await fetchImpl(bundledFontResourceUrl('inventory/font-inventory.json'), {
    method: 'GET',
    credentials: 'omit',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Bundled font library is unavailable (${response.status}).`);
  const catalog = parseBundledFontInventory(await response.json());
  // A bridge can be replaced while the protocol response or JSON parsing is in flight. The
  // catalog is authorized only by the same bridge that was current after its positive status
  // response, so never return it for a newer renderer authority.
  if (getSignalLoomNativeBridge() !== bridge) {
    throw new Error('The bundled font library bridge changed while its catalog was loading.');
  }
  return catalog;
}

export function loadBundledFontCatalog(fetchImpl: typeof fetch = fetch): Promise<BundledFontCatalog> {
  const bridge = getSignalLoomNativeBridge();
  const authority = isAndroidFontPackRuntime() ? 'android' : bridge;
  if (catalogPromise && catalogAuthority === authority) return catalogPromise;
  catalogAuthority = authority;
  const nextCatalogPromise = fetchBundledFontCatalog(bridge, fetchImpl);
  const handledCatalogPromise = nextCatalogPromise.catch((error) => {
    if (catalogPromise === handledCatalogPromise) {
      catalogPromise = undefined;
      catalogAuthority = undefined;
    }
    throw error;
  });
  catalogPromise = handledCatalogPromise;
  return handledCatalogPromise;
}

export function selectBundledFontFace(
  family: BundledFontFamily,
  requestedWeight: number,
  requestedStyle: PaperManagedFontStyle,
): BundledFontFace {
  const weight = Number.isFinite(requestedWeight) ? requestedWeight : 400;
  return [...family.faces].sort((left, right) => {
    const leftStyle = left.style === requestedStyle ? 0 : 10_000;
    const rightStyle = right.style === requestedStyle ? 0 : 10_000;
    return leftStyle - rightStyle
      || Math.abs(left.weight - weight) - Math.abs(right.weight - weight)
      || Number(left.variable) - Number(right.variable)
      || left.postscriptName.localeCompare(right.postscriptName);
  })[0];
}

async function fetchResourceBytes(path: string, fetchImpl: typeof fetch, label: string): Promise<Uint8Array> {
  if (isAndroidFontPackRuntime()) {
    const bytes = await readAndroidFontPackResource(path);
    if (!bytes.byteLength) throw new Error(`${label} is empty.`);
    return bytes;
  }
  const response = await fetchImpl(bundledFontResourceUrl(path), { method: 'GET', credentials: 'omit' });
  if (!response.ok) throw new Error(`${label} is unavailable (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error(`${label} is empty.`);
  return bytes;
}

export interface InstallBundledPaperFontFaceInput {
  family: BundledFontFamily;
  face: BundledFontFace;
  repository: PaperAssetRepository;
  fetchImpl?: typeof fetch;
}

function bundledPaperFontProvenanceIdentity(
  family: BundledFontFamily,
  face: BundledFontFace,
): BundledPaperFontProvenanceIdentity {
  return {
    sourceUrl: bundledFontResourceUrl(face.file),
    sourceVersion: family.sourceVersion,
    fontId: `bundled-${face.id}`,
    fontSha256: face.sha256,
    fontByteLength: face.byteLength,
    fontMimeType: face.file.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf',
    licenseId: family.licenseId,
    licenseSha256: family.licenseSha256,
    licenseByteLength: family.licenseByteLength,
    licenseAttribution: family.sourceUrl,
    familyId: normalizePaperFontFamilyId(family.family),
    familyName: family.family,
    postscriptName: face.postscriptName,
    weight: face.weight,
    style: face.style,
    stretchPercent: face.stretchPercent,
    collectionIndex: face.collectionIndex,
    variableAxes: structuredClone(face.axes),
    canSubset: face.canSubset,
  };
}

export async function installBundledPaperFontFace(input: InstallBundledPaperFontFaceInput): Promise<PaperManagedFontFace> {
  if (!bundledFaceBelongsToFamily(input.family, input.face)) {
    throw new Error('The selected face does not belong to the bundled family.');
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const [fontBytes, licenseBytes] = await Promise.all([
    fetchResourceBytes(input.face.file, fetchImpl, input.face.fullName),
    fetchResourceBytes(input.family.licenseFile, fetchImpl, `${input.family.family} license`),
  ]);
  const [fontRecord, licenseRecord] = await Promise.all([
    createBinaryAssetRecord(fontBytes, {
      mimeType: input.face.file.toLowerCase().endsWith('.otf') ? 'font/otf' : 'font/ttf',
      fileName: input.face.file.split('/').at(-1),
    }),
    createBinaryAssetRecord(licenseBytes, {
      mimeType: 'text/plain',
      fileName: input.family.licenseFile.split('/').at(-1),
    }),
  ]);
  if (fontRecord.ref.sha256 !== input.face.sha256 || fontRecord.ref.byteLength !== input.face.byteLength) {
    throw new Error(`${input.face.fullName} does not match the audited bundled font hash.`);
  }
  if (licenseRecord.ref.sha256 !== input.family.licenseSha256 || licenseRecord.ref.byteLength !== input.family.licenseByteLength) {
    throw new Error(`${input.family.family} license does not match the audited bundled license hash.`);
  }
  const vet = vetFontBytes(fontBytes);
  if (!vet.ok) throw new Error(vet.errors[0] ?? `${input.face.fullName} failed production font vetting.`);
  if (vet.format === 'collection') {
    throw new Error(`${input.face.fullName} is stored in a TrueType/OpenType Collection that Chromium cannot authenticate. Install a standalone .ttf/.otf build before importing it into Paper.`);
  }
  const [fontAsset, licenseAsset] = await Promise.all([
    input.repository.put(fontRecord),
    input.repository.put(licenseRecord),
  ]);
  const built = buildImportedFont(vet, fontAsset, `bundled-${input.face.id}`, {
    collectionIndex: input.face.collectionIndex,
    source: {
      kind: 'bundled',
      url: bundledFontResourceUrl(input.face.file),
      version: input.family.sourceVersion,
    },
    license: {
      id: input.family.licenseId,
      textAsset: licenseAsset,
      attribution: input.family.sourceUrl,
    },
  });
  if (!built) throw new Error(`${input.face.fullName} cannot be embedded in production output.`);
  const installed = {
    ...built,
    familyId: normalizePaperFontFamilyId(input.family.family),
    familyName: input.family.family,
    postscriptName: input.face.postscriptName,
    weight: input.face.weight,
    style: input.face.style,
    variableAxes: input.face.axes,
    canSubset: input.face.canSubset,
  };
  registerBundledPaperFontProvenance(
    bundledPaperFontProvenanceIdentity(input.family, input.face),
  );
  return installed;
}
