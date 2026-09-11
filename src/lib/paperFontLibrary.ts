// The imported-font library: how a document's user-imported fonts are stored, matched to a frame's
// typography, and resolved into a face to embed. Sits above the vetting gate (paperFontVetting) and the
// bundled-face fallback (paperFontResolution): when a frame's font-family matches an imported, embeddable
// face we embed the user's ACTUAL font; otherwise we fall back to the metric-compatible Liberation
// substitute (disclosed in preflight). Framework-free + unit-testable; imported bytes are addressed through
// a managed content-addressed record and never live in Paper JSON.

import type { PaperImportedFont, PaperManagedFontFace, PaperManagedFontStyle } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { resolveBundledFontFace } from './paperFontResolution';
import type { FontVetResult } from './paperFontVetting';
import {
  canUseManagedFontForProduction,
  normalizePaperFontFamilyId,
  selectManagedFontFace,
} from './paperManagedFonts';

/** Normalize a CSS font-family (or stack) to its first family token, unquoted + lowercased, for matching. */
export function normalizeFamilyName(cssFamily: string): string {
  const first = (cssFamily || '').split(',')[0] ?? '';
  return first.trim().replace(/^["']|["']$/g, '').trim().toLowerCase();
}

/**
 * Legacy convenience wrapper for UI callers that still carry boolean weight/style controls. It uses exact
 * 400/700 faces and deliberately returns undefined rather than synthesizing a nearby face.
 */
export function selectImportedFace(
  family: string,
  bold: boolean,
  italic: boolean,
  fonts: readonly PaperImportedFont[],
): PaperImportedFont | undefined {
  if (!family) return undefined;
  const selection = selectManagedFontFace(fonts, {
    familyId: normalizePaperFontFamilyId(family),
    weight: bold ? 700 : 400,
    style: italic ? 'italic' : 'normal',
  });
  if (selection.status !== 'selected') return undefined;
  return canUseManagedFontForProduction(selection.face).allowed ? selection.face : undefined;
}

/** A face resolved for the vector-text exporter — either the user's imported font, or a bundled Liberation. */
export interface ResolvedTextFace {
  /** Embed cache key (unique per distinct face). */
  id: string;
  /** Managed binary record — present for imported fonts (load bytes through the asset repository). */
  assetRef?: BinaryAssetRef;
  /** public/-relative .ttf URL — present for bundled Liberation faces (adapter fetches it). */
  url?: string;
  /** Family that was actually used. */
  familyName: string;
  /** True when the user's actual font is embedded; false when a Liberation substitute stands in. */
  embeddedReal: boolean;
  /** True when the imported font disallows subsetting (embed the whole font). */
  noSubsetting?: boolean;
}

interface TypographyLike {
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
}

function numericWeight(weight: string | undefined): number {
  const normalized = (weight ?? '').trim().toLowerCase();
  if (normalized === 'bold' || normalized === 'bolder') return 700;
  if (normalized === 'normal' || normalized === 'lighter' || !normalized) return 400;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(1, parsed)) : 400;
}

function requestedStyle(style: string | undefined): PaperManagedFontStyle {
  const normalized = (style ?? '').trim().toLowerCase();
  if (normalized === 'oblique') return 'oblique';
  return normalized === 'italic' ? 'italic' : 'normal';
}

/**
 * Resolve a frame's typography to the face to embed: the user's imported font only when one exact face is
 * authorized for production, otherwise the existing bundled Liberation draft fallback.
 */
export function resolveTextFace(
  typography: TypographyLike,
  importedFonts: readonly PaperImportedFont[] | undefined,
): ResolvedTextFace {
  const family = normalizeFamilyName(typography.fontFamily ?? '');
  const selection = family
    ? selectManagedFontFace(importedFonts ?? [], {
      familyId: normalizePaperFontFamilyId(family),
      weight: numericWeight(typography.fontWeight),
      style: requestedStyle(typography.fontStyle),
    })
    : undefined;
  if (selection?.status === 'selected' && canUseManagedFontForProduction(selection.face).allowed) {
    const imported = selection.face;
    return {
      id: `imported-${imported.id}`,
      assetRef: imported.fontAsset,
      familyName: imported.familyName,
      embeddedReal: true,
      noSubsetting: !imported.canSubset,
    };
  }
  const face = resolveBundledFontFace(typography);
  return { id: face.id, url: face.url, familyName: face.id, embeddedReal: false };
}

/**
 * Build one explicit managed face from a vetted binary record. A collection caller chooses its face index;
 * no face is silently inferred from an adjacent weight or style.
 */
export function buildImportedFont(
  vet: FontVetResult,
  fontAsset: BinaryAssetRef,
  id: string,
  options: {
    collectionIndex?: number;
    source?: PaperManagedFontFace['source'];
    license?: PaperManagedFontFace['license'];
    attestation?: PaperManagedFontFace['attestation'];
  } = {},
): PaperImportedFont | null {
  const collectionIndex = options.collectionIndex ?? 0;
  const vettedFace = vet.faces.find((face) => face.collectionIndex === collectionIndex);
  if (!vettedFace || !vettedFace.ok || !vettedFace.embeddable) return null;
  const familyName = vettedFace.familyName ?? vet.familyName ?? id;
  return {
    id,
    familyId: normalizePaperFontFamilyId(familyName),
    familyName,
    postscriptName: vettedFace.postscriptName ?? vettedFace.familyName ?? id,
    weight: vettedFace.weight,
    style: vettedFace.style,
    ...(vettedFace.obliqueAngleDeg !== undefined ? { obliqueAngleDeg: vettedFace.obliqueAngleDeg } : {}),
    stretchPercent: vettedFace.stretchPercent,
    collectionIndex,
    variableAxes: vettedFace.variableAxes,
    unicodeRanges: vettedFace.unicodeRanges,
    format: vettedFace.format,
    fontAsset,
    embeddability: vettedFace.embeddability,
    canSubset: vettedFace.canSubset,
    source: options.source ?? { kind: 'user-import' },
    license: options.license ?? {},
    attestation: options.attestation,
  };
}
