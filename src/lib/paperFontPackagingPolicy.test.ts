import { describe, expect, it } from 'vitest';
import { classifyPaperFontPackaging } from './paperManagedFonts';
import type { PaperManagedFontFace } from '../types/paper';

function face(overrides: Partial<PaperManagedFontFace> = {}): PaperManagedFontFace {
  return {
    id: 'face-policy',
    familyId: 'policy family',
    familyName: 'Policy Family',
    postscriptName: 'PolicyFamily-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [],
    format: 'truetype',
    fontAsset: {
      id: `sha256:${'ab'.repeat(32)}`,
      sha256: 'ab'.repeat(32),
      mimeType: 'font/ttf',
      byteLength: 128,
    },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
    ...overrides,
  };
}

describe('classifyPaperFontPackaging', () => {
  it('permits installable and editable faces', () => {
    expect(classifyPaperFontPackaging(face({ embeddability: 'installable' })).allowed).toBe(true);
    expect(classifyPaperFontPackaging(face({ embeddability: 'editable' })).allowed).toBe(true);
  });

  it('fails closed on restricted and bitmap-only faces with actionable detail', () => {
    const restricted = classifyPaperFontPackaging(face({ embeddability: 'restricted' }));
    expect(restricted).toMatchObject({ allowed: false, reason: 'restricted' });
    if (!restricted.allowed) expect(restricted.detail).toMatch(/Policy Family/);

    const bitmapOnly = classifyPaperFontPackaging(face({ embeddability: 'bitmap-only' }));
    expect(bitmapOnly).toMatchObject({ allowed: false, reason: 'bitmap-only' });
  });

  it('requires a byte-bound packaging attestation for unknown and print-preview faces', () => {
    expect(classifyPaperFontPackaging(face({ embeddability: 'unknown' })))
      .toMatchObject({ allowed: false, reason: 'attestation-required' });
    expect(classifyPaperFontPackaging(face({ embeddability: 'print-preview' })))
      .toMatchObject({ allowed: false, reason: 'attestation-required' });

    const attested = face({
      embeddability: 'unknown',
      attestation: {
        acceptedAt: 1,
        assetSha256: 'ab'.repeat(32),
        mayEmbedOutput: true,
        mayPackageEditableProject: true,
        statementVersion: 1,
      },
    });
    expect(classifyPaperFontPackaging(attested).allowed).toBe(true);
  });

  it('rejects an attestation bound to different bytes', () => {
    const mismatched = face({
      embeddability: 'unknown',
      attestation: {
        acceptedAt: 1,
        assetSha256: 'cd'.repeat(32),
        mayEmbedOutput: true,
        mayPackageEditableProject: true,
        statementVersion: 1,
      },
    });
    expect(classifyPaperFontPackaging(mismatched)).toMatchObject({ allowed: false, reason: 'attestation-mismatch' });
  });

  it('rejects an attestation that only covers embedded output, not project packaging', () => {
    const outputOnly = face({
      embeddability: 'unknown',
      attestation: {
        acceptedAt: 1,
        assetSha256: 'ab'.repeat(32),
        mayEmbedOutput: true,
        mayPackageEditableProject: false,
        statementVersion: 1,
      },
    });
    expect(classifyPaperFontPackaging(outputOnly)).toMatchObject({ allowed: false, reason: 'attestation-required' });
  });

  it('permits a version-pinned open-catalog face and requires its license text to travel', () => {
    const openCatalog = face({
      embeddability: 'unknown',
      source: {
        kind: 'open-catalog',
        url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter@5.0.18/latin-400-normal.ttf',
        version: '5.0.18',
      },
      license: {
        id: 'OFL-1.1',
        textAsset: {
          id: `sha256:${'ef'.repeat(32)}`,
          sha256: 'ef'.repeat(32),
          mimeType: 'text/plain',
          byteLength: 64,
        },
      },
    });
    const verdict = classifyPaperFontPackaging(openCatalog);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.licenseTextRequired).toBe(true);
  });

  it('permits bundled faces we already redistribute with the application', () => {
    const bundled = face({ embeddability: 'unknown', source: { kind: 'bundled' } });
    expect(classifyPaperFontPackaging(bundled).allowed).toBe(true);
  });
});
