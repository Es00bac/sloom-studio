import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PaperManagedFontFace } from '../types/paper';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';
import { createBinaryAssetRecord } from '../shared/assets/contentAddressedAsset';
import { getPaperResourceCleanupError } from './paperColorManagement';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperFrame } from './paperDocument';
import type { PaperOutputProfileResolution } from './paperManagedIccProfiles';
import { exportPaperDocumentToPdfx } from './paperPdfxPipeline';
import { createHarfBuzzPaperTextShaper, type PaperTextShaper } from './paperTextShaper';

const liberationSerif = new Uint8Array(readFileSync('public/fonts/liberation/LiberationSerif-Regular.ttf'));

const profileId = `sha256:${'3'.repeat(64)}` as BinaryAssetId;
const outputProfile: Extract<PaperOutputProfileResolution, { status: 'ready' }> = {
  status: 'ready',
  profile: {
    id: profileId,
    asset: { id: profileId, sha256: '3'.repeat(64), mimeType: 'application/vnd.iccprofile', byteLength: 1 },
    description: 'Tracked CMYK', deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ',
    outputConditionId: 'TRACKED', source: { kind: 'user-import' },
  },
  bytes: new Uint8Array([1]),
};

describe('PDF/X owned lifecycle cleanup', () => {
  it('preserves a primary conversion failure while destroying shapers and disposing the owned transform', async () => {
    const fontAsset = (await createBinaryAssetRecord(liberationSerif, { mimeType: 'font/ttf' })).ref;
    const managedFace: PaperManagedFontFace = {
      id: 'managed-serif', familyId: 'managed serif', familyName: 'Managed Serif', postscriptName: 'ManagedSerif-Regular',
      weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {},
      unicodeRanges: [{ start: 0x20, end: 0x7e }], format: 'truetype', fontAsset,
      embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
    };
    const base = createDefaultPaperDocument({ title: 'PDF/X nested cleanup' });
    const added = addFrameToPaperPage({ ...base, importedFonts: [managedFace] }, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 80, heightMm: 20,
      typography: { fontFamily: 'Managed Serif', fontSizePt: 12, fontWeight: '400', fontStyle: 'normal', color: '#101010' },
    });
    const withManagedText = updatePaperFrame(added.document, base.pages[0].id, added.frameId, { text: 'Managed cleanup text' });
    const withFlattenedPanel = addFrameToPaperPage(withManagedText, base.pages[0].id, {
      kind: 'panel', xMm: 10, yMm: 40, widthMm: 30, heightMm: 20, opacity: 0.5,
    });
    const primary = new Error('primary conversion failure');
    let destroyAttempts = 0;
    let transformDisposeAttempts = 0;
    let thrown: unknown;
    try {
      await exportPaperDocumentToPdfx(withFlattenedPanel.document, { standard: 'pdf-x-4', outputProfile }, {
        createTransform: async () => ({
          kind: 'icc', profileName: 'Owned', rgbToCmyk: () => { throw primary; },
          transformRgbBuffer: (_rgb, pixelCount) => new Uint8Array(pixelCount * 4),
          dispose: () => { transformDisposeAttempts += 1; },
        }),
        createTextShaper: async (bytes, options): Promise<PaperTextShaper> => {
          const actual = await createHarfBuzzPaperTextShaper(bytes, options);
          return {
            unitsPerEm: actual.unitsPerEm,
            shape: (request) => actual.shape(request),
            glyphPath: (glyphId) => actual.glyphPath(glyphId),
            destroy: () => { actual.destroy(); destroyAttempts += 1; throw new Error('shaper destroy failure'); },
          };
        },
        loadManagedFontBytes: async () => liberationSerif,
        rasterizePage: async () => ({ rgba: new Uint8Array([255, 255, 255, 255]), widthPx: 1, heightPx: 1 }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(primary);
    expect(destroyAttempts).toBe(1);
    expect(transformDisposeAttempts).toBe(1);
    expect(getPaperResourceCleanupError(thrown)?.failures.map((failure) => (failure as Error).message)).toEqual(['shaper destroy failure']);
  });
});
