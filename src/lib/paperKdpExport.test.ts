import { describe, expect, it, vi } from 'vitest';
import { createDefaultPaperDocument } from './paperDocument';
import {
  buildPaperKdpExportPlan,
  buildPaperKdpImageArchiveExport,
  getKdpSpinePageThicknessMm,
  paperKdpSafePathPart,
} from './paperKdpExport';
import type { PaperDocument } from '../types/paper';

function makeChronicleDocument(pageCount = 24): PaperDocument {
  const base = createDefaultPaperDocument({
    title: 'Chronicle Test 3',
    preset: 'comic-book',
    dpi: 300,
  });
  const templatePage = base.pages[0];
  return {
    ...base,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      ...templatePage,
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      frames: [],
      guides: [],
    })),
  };
}

describe('paperKdpExport', () => {
  it('maps Chronicle-style cover and inside-cover pages without losing story numbering', () => {
    const plan = buildPaperKdpExportPlan(makeChronicleDocument());

    expect(plan.roles.frontCover?.sourcePageNumber).toBe(1);
    expect(plan.roles.backCover?.sourcePageNumber).toBe(24);
    expect(plan.roles.insideFrontCover?.sourcePageNumber).toBe(2);
    expect(plan.roles.insideBackCover?.sourcePageNumber).toBe(23);
    expect(plan.interiorPages).toHaveLength(22);
    expect(plan.interiorPages[0]).toMatchObject({
      sourcePageNumber: 2,
      role: 'inside-front-cover',
      kdpInteriorPageNumber: 1,
    });
    expect(plan.interiorPages[1]).toMatchObject({
      sourcePageNumber: 3,
      role: 'story',
      kdpInteriorPageNumber: 2,
      storyPageNumber: 1,
    });
    expect(plan.interiorPages.at(-1)).toMatchObject({
      sourcePageNumber: 23,
      role: 'inside-back-cover',
      kdpInteriorPageNumber: 22,
    });
    expect(plan.warnings).toContainEqual(expect.objectContaining({
      code: 'kdp-interior-page-count-low',
      severity: 'error',
    }));
  });

  it('uses official KDP bleed and spine formulas for cover wrap and interior page dimensions', () => {
    const plan = buildPaperKdpExportPlan(makeChronicleDocument(), {
      interiorType: 'premium-color',
      paperType: 'white',
      dpi: 300,
    });

    expect(plan.kdpBleedMm).toBeCloseTo(3.175, 3);
    expect(plan.interiorPageDimensions.widthMm).toBeCloseTo(173.175, 3);
    expect(plan.interiorPageDimensions.heightMm).toBeCloseTo(266.35, 3);
    expect(plan.coverWrap.spineWidthMm).toBeCloseTo(22 * 0.0596, 3);
    expect(plan.coverWrap.widthMm).toBeCloseTo(3.175 + 170 + (22 * 0.0596) + 170 + 3.175, 3);
    expect(plan.coverWrap.heightMm).toBeCloseTo(260 + (3.175 * 2), 3);
    expect(plan.coverWrap.allowSpineText).toBe(false);
    expect(getKdpSpinePageThicknessMm('standard-color', 'white')).toBe(0.0572);
  });

  it('builds a named KDP image asset archive with cover, interior, manifest, and preflight entries', async () => {
    const doc = makeChronicleDocument();
    const rasterize = vi.fn().mockResolvedValue('data:image/png;base64,UE5H');
    const composeCoverWrap = vi.fn().mockResolvedValue('data:image/png;base64,Q09WRVI=');

    const archive = await buildPaperKdpImageArchiveExport(doc, {
      rasterize,
      composeCoverWrap,
    });

    expect(archive.fileName).toBe('Chronicle-Test-3-kdp-assets.zip');
    expect(archive.entries).toEqual(expect.arrayContaining([
      'Chronicle-Test-3-kdp-assets/cover/full-wrap-cover.png',
      'Chronicle-Test-3-kdp-assets/cover/front-cover-page-001.png',
      'Chronicle-Test-3-kdp-assets/cover/back-cover-page-024.png',
      'Chronicle-Test-3-kdp-assets/interior/001-inside-front-cover-page-002.png',
      'Chronicle-Test-3-kdp-assets/interior/002-story-page-001-source-page-003.png',
      'Chronicle-Test-3-kdp-assets/interior/022-inside-back-cover-page-023.png',
      'Chronicle-Test-3-kdp-assets/manifest.json',
      'Chronicle-Test-3-kdp-assets/preflight.json',
    ]));
    expect(archive.blob.type).toBe('application/zip');
    expect(rasterize).toHaveBeenCalledWith(expect.objectContaining({
      role: 'inside-front-cover',
      kdpInteriorPageNumber: 1,
      widthPx: archive.plan.interiorPageDimensions.widthPx,
      heightPx: archive.plan.interiorPageDimensions.heightPx,
    }));
    expect(composeCoverWrap).toHaveBeenCalledWith(expect.objectContaining({
      frontCover: expect.objectContaining({ sourcePageNumber: 1 }),
      backCover: expect.objectContaining({ sourcePageNumber: 24 }),
    }));
  });

  it('sanitizes KDP export path parts without producing empty names', () => {
    expect(paperKdpSafePathPart('  /bad:name?  ', 'fallback')).toBe('bad-name');
    expect(paperKdpSafePathPart('***', 'fallback')).toBe('fallback');
  });
});
