import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { buildPaperPackageExport } from './paperPackageExport';

function imageItem(): SourceBinLibraryItem & { pixelWidth: number; pixelHeight: number } {
  return {
    id: 'asset-1',
    label: 'Cover Art',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: 'data:image/png;base64,abc',
    createdAt: 1,
    pixelWidth: 1200,
    pixelHeight: 1800,
  };
}

describe('paperPackageExport', () => {
  it('builds a browser-safe ZIP package with manifest, preflight, assets, fonts, and colors', async () => {
    const item = imageItem();
    const base = createDefaultPaperDocument({ title: 'Package Me', preset: 'comic-book' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 100,
      asset: { sourceBinItemId: item.id, label: item.label, kind: item.kind },
    });

    const exported = await buildPaperPackageExport(document, [item], { profileId: 'comic-print' });
    const parsed = JSON.parse(exported.json) as {
      manifest: typeof exported.manifest;
      preflightReport: { profile: { id: string } };
      assets: Array<{ source?: { assetUrl?: string } }>;
    };

    expect(exported.fileName).toBe('Package-Me.sloom-paper-package.zip');
    expect(exported.fallbackJsonFileName).toBe('Package-Me.sloom-paper-package.json');
    expect(exported.mimeType).toBe('application/zip');
    expect(Object.keys(unzipSync(new Uint8Array(await exported.blob.arrayBuffer())))).toEqual(expect.arrayContaining([
      'document.sloom-paper.json',
      'preflight-report.json',
      'manifest.json',
      'Links/Cover-Art.json',
    ]));
    expect(exported.manifest.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      'document.sloom-paper.json',
      'preflight-report.json',
      'manifest.json',
      'Links/Cover-Art.json',
    ]));
    expect(exported.manifest.linkedAssets[0]).toEqual(expect.objectContaining({ sourceId: item.id, sourceLabel: item.label }));
    expect(exported.manifest.production).toEqual(expect.objectContaining({
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'srgb',
      browserPdfIsPressCertified: false,
    }));
    expect(exported.manifest.fonts.length).toBeGreaterThan(0);
    expect(exported.manifest.colors.length).toBeGreaterThan(0);
    expect(parsed.preflightReport.profile.id).toBe('comic-print');
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].source?.assetUrl).toBeUndefined();
    expect(exported.json).not.toMatch(/data:image|base64,abc/);

    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(new TextDecoder().decode(entries['Links/Cover-Art.json'])).not.toMatch(/data:image|base64,abc/);
  });
});
