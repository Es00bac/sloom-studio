import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaperSoftProofModal } from './PaperSoftProofModal';
import { createDefaultPaperDocument } from '../../../lib/paperDocument';
import type { BinaryAssetId } from '../../../shared/assets/contentAddressedAsset';

// The async preview build (canvas + lcms) never runs under renderToStaticMarkup (effects don't fire on
// the server), so this exercises the modal's structure + initial loading state without needing a DOM
// canvas. The soft-proof transform itself is covered by paperSoftProof.test.ts / paperSoftProofImage.test.ts.
describe('PaperSoftProofModal', () => {
  it('turns a missing output profile into an actionable bundled-profile setup state', () => {
    const doc = createDefaultPaperDocument({ title: 'Proof me', preset: 'us-letter' });
    const html = renderToStaticMarkup(
      <PaperSoftProofModal
        document={doc}
        onClose={vi.fn()}
        onConfigureProfile={vi.fn()}
        pageId={doc.pages[0].id}
      />,
    );

    expect(html).toContain('data-paper-soft-proof-modal="true"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="CMYK soft proof"');
    expect(html).toContain('Choose an exact CMYK output profile');
    expect(html).toContain('aria-label="Bundled CMYK profile"');
    expect(html).not.toContain('Building soft-proof preview');
  });

  it('renders the loading state and paper-color toggle after an exact profile is selected', () => {
    const assetId = `sha256:${'a'.repeat(64)}` as BinaryAssetId;
    const base = createDefaultPaperDocument({ title: 'Proof me', preset: 'us-letter' });
    const doc = {
      ...base,
      managedIccProfiles: [{
        id: assetId,
        asset: {
          id: assetId,
          sha256: 'a'.repeat(64),
          mimeType: 'application/vnd.iccprofile',
          byteLength: 122152,
        },
        description: 'FOGRA39L Coated',
        deviceClass: 'prtr' as const,
        colorSpace: 'CMYK' as const,
        pcs: 'Lab ' as const,
        outputConditionId: 'FOGRA39',
        source: { kind: 'bundled' as const, url: '/icc/FOGRA39L_coated.icc' },
      }],
      printProduction: {
        ...base.printProduction,
        outputIntentProfileId: 'custom' as const,
        customOutputIntentName: 'FOGRA39',
        outputIntentProfileAssetId: assetId,
      },
    };
    const html = renderToStaticMarkup(
      <PaperSoftProofModal document={doc} onClose={vi.fn()} pageId={doc.pages[0].id} />,
    );

    expect(html).toContain('Building soft-proof preview');
    expect(html).toContain('Simulate paper color');
    expect(html).toContain('Page 1 of 1');
    expect(html).toContain('Export PDF/X to create the printer handoff file');
    expect(html).toContain('aria-label="Close soft proof"');
  });
});
