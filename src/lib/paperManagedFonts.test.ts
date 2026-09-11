import { describe, expect, it } from 'vitest';
import type { PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import {
  canUseManagedFontForProduction,
  classifyFontEmbeddingRights,
  collectManagedFontDependencies,
  selectManagedFontFace,
} from './paperManagedFonts';

function fontAsset(sha256 = 'a'.repeat(64)): BinaryAssetRef {
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function managedFace(patch: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  return {
    id: 'face-regular',
    familyId: 'example-sans',
    familyName: 'Example Sans',
    postscriptName: 'ExampleSans-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: fontAsset(),
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...patch,
  };
}

describe('managed Paper font rights', () => {
  it('blocks bitmap-only fonts from outline embedding', () => {
    expect(classifyFontEmbeddingRights({ bitmapOnly: true })).toMatchObject({
      embeddable: false,
      reason: 'bitmap-only',
    });
  });

  it('does not select regular as a silent bold face', () => {
    const regular = managedFace();
    expect(selectManagedFontFace([regular], {
      familyId: regular.familyId,
      weight: 700,
      style: 'normal',
    })).toEqual({
      status: 'missing-face',
      familyId: regular.familyId,
      requestedWeight: 700,
      requestedStyle: 'normal',
      requestedStretchPercent: 100,
    });
  });

  it('requires attestation when embedding rights are unknown', () => {
    const face = managedFace({ embeddability: 'unknown', attestation: undefined });
    expect(canUseManagedFontForProduction(face)).toMatchObject({
      allowed: false,
      reason: 'attestation-required',
    });
  });

  it('accepts an unknown-rights Fontsource face only with pinned open-license evidence', () => {
    const licenseAsset = { ...fontAsset('b'.repeat(64)), mimeType: 'text/plain', byteLength: 120 };
    const trusted = managedFace({
      embeddability: 'unknown',
      source: {
        kind: 'open-catalog',
        url: 'https://cdn.jsdelivr.net/fontsource/fonts/example-sans@1.2.3/latin-400-normal.ttf',
        version: '1.2.3',
      },
      license: { id: 'OFL-1.1', textAsset: licenseAsset },
    });

    expect(canUseManagedFontForProduction(trusted)).toEqual({ allowed: true });
    expect(canUseManagedFontForProduction({
      ...trusted,
      license: { id: 'Proprietary', textAsset: licenseAsset },
    })).toMatchObject({ allowed: false, reason: 'attestation-required' });
  });

  it('accepts an attestation only when it names the exact managed bytes', () => {
    const face = managedFace({
      embeddability: 'unknown',
      attestation: {
        acceptedAt: 1,
        assetSha256: fontAsset().sha256,
        mayEmbedOutput: true,
        mayPackageEditableProject: false,
        statementVersion: 1,
      },
    });
    expect(canUseManagedFontForProduction(face)).toEqual({ allowed: true });
    expect(canUseManagedFontForProduction({
      ...face,
      attestation: { ...face.attestation!, assetSha256: 'b'.repeat(64) },
    })).toMatchObject({ allowed: false, reason: 'attestation-mismatch' });
  });

  it('collects each font binary and its license evidence exactly once', () => {
    const licenseAsset = { ...fontAsset('b'.repeat(64)), mimeType: 'text/plain' };
    const regular = managedFace({ license: { textAsset: licenseAsset } });
    const italic = managedFace({
      id: 'face-italic',
      style: 'italic',
      license: { textAsset: licenseAsset },
    });

    expect(collectManagedFontDependencies([regular, italic])).toEqual([
      regular.fontAsset,
      licenseAsset,
    ]);
  });
});
