import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  buildEnglishMagazine,
  buildJapaneseMagazine,
  createAssetRecord,
  packMagazineContainer,
} from './create-signaloom-magazine-demo.mjs';

const MIDPOINT_MM = 148.5;

async function fixtureRecords() {
  return {
    hero: await createAssetRecord(new Uint8Array([1, 2, 3]), 'hero.png'),
    ad: await createAssetRecord(new Uint8Array([4, 5, 6]), 'ad-composite.png'),
    icc: await createAssetRecord(
      new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc')),
      'FOGRA39L_coated.icc',
    ),
  };
}

function plainText(document: unknown): string {
  return JSON.stringify(document);
}

function assertSharedMagazineStructure(document: any, heroId: string, adId: string) {
  expect(document.page).toMatchObject({ preset: 'a4', widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300 });
  expect(document.pages).toHaveLength(2);
  expect(document.view).toMatchObject({
    showRulers: false,
    showGrid: false,
    showGuides: false,
    showFrameEdges: false,
    showBleed: false,
    showSpreads: true,
    startOnRight: false,
  });
  expect(document.printProduction.pdfStandard).toBe('browser-pdf');
  expect(document.printProduction).toMatchObject({
    outputIntentProfileId: 'custom',
    customOutputIntentName: 'FOGRA39',
  });
  expect(document.managedIccProfiles).toHaveLength(1);
  expect(document.managedIccProfiles[0]).toMatchObject({
    id: document.printProduction.outputIntentProfileAssetId,
    outputConditionId: 'FOGRA39',
    colorSpace: 'CMYK',
    source: { kind: 'bundled', url: '/icc/FOGRA39L_coated.icc' },
  });
  expect(document.styles.paragraph.length).toBeGreaterThanOrEqual(8);
  expect(document.styles.character.length).toBeGreaterThanOrEqual(4);
  expect(document.styles.object.length).toBeGreaterThanOrEqual(5);
  expect(document.swatches.length).toBeGreaterThanOrEqual(6);

  const allFrames = document.pages.flatMap((page: any) => page.frames);
  const managedIds = allFrames
    .map((frame: any) => frame.asset?.locator?.kind === 'managed' ? frame.asset.locator.ref.id : undefined)
    .filter(Boolean);
  expect(managedIds).toContain(heroId);
  expect(managedIds).toContain(adId);

  const pageTwoFrames = document.pages[1].frames;
  const articleFrames = pageTwoFrames.filter((frame: any) => /^(Article|Timeline)/.test(frame.label));
  const adFrames = pageTwoFrames.filter((frame: any) => frame.label.startsWith('Ad '));
  expect(articleFrames.length).toBeGreaterThan(4);
  expect(adFrames.length).toBeGreaterThan(4);
  expect(articleFrames.every((frame: any) => frame.yMm + frame.heightMm <= MIDPOINT_MM)).toBe(true);
  expect(adFrames.every((frame: any) => frame.yMm >= MIDPOINT_MM)).toBe(true);

  const threaded = allFrames.filter((frame: any) => frame.threadId === 'signaloom-feature');
  expect(threaded.length).toBeGreaterThanOrEqual(document.view.rtlBinding ? 1 : 4);
  expect(new Set(threaded.map((frame: any) => frame.threadOrder)).size).toBe(threaded.length);
  expect(allFrames.some((frame: any) => frame.richText?.some((paragraph: any) => paragraph.runs.length > 1))).toBe(true);
  expect(allFrames.some((frame: any) => frame.fillGradient)).toBe(true);
  expect(allFrames.some((frame: any) => frame.columns > 1 && frame.columnRule)).toBe(true);
  expect(allFrames.every((frame: any) => frame.kind !== 'shape' || frame.shapeKind)).toBe(true);

  const deprecatedEditorialCards = allFrames.filter((frame: any) => (
    /p1-meta-card$/.test(frame.id)
    || /p2-timeline-\d\d$/.test(frame.id)
    || /p1-opening-card$/.test(frame.id)
  ));
  expect(deprecatedEditorialCards).toEqual([]);

  const openingPanels = allFrames.filter((frame: any) => /p1-opening-panel$/.test(frame.id));
  expect(openingPanels).toHaveLength(1);
  expect(openingPanels[0].heightMm).toBeLessThanOrEqual(66);

  const milestoneRules = document.pages[1].frames.filter((frame: any) => /p2-milestone-\d\d-rule$/.test(frame.id));
  expect(milestoneRules).toHaveLength(3);
  expect(milestoneRules.every((frame: any) => frame.kind === 'panel' && frame.heightMm <= 0.6)).toBe(true);
}

describe('Signaloom bilingual magazine demo builder', () => {
  it('builds a professional two-page English edition with an isolated half-page demo ad', async () => {
    const { hero, ad, icc } = await fixtureRecords();
    const document = buildEnglishMagazine(hero, ad, { now: 1_784_132_800_000, iccProfile: icc });

    assertSharedMagazineStructure(document, hero.ref.id, ad.ref.id);
    expect(document.view.rtlBinding).toBe(false);
    expect(document.styles.paragraph.find((style: any) => style.id === 'p-body')?.typography.align).toBe('left');
    const continuation = document.pages[1].frames.find((frame: any) => frame.id === 'en-p2-article-columns');
    expect(continuation).toMatchObject({ columnRule: false, typography: { align: 'left' } });
    const pullQuote = document.pages[0].frames.find((frame: any) => frame.id === 'en-p1-pull');
    const pullBackdrop = document.pages[0].frames.find((frame: any) => frame.id === 'en-p1-pull-backdrop');
    expect(pullBackdrop).toMatchObject({
      kind: 'panel',
      fillColor: '#071426',
      fillOpacity: 0.62,
      opacity: 0.92,
    });
    expect(pullBackdrop.zIndex).toBeLessThan(pullQuote.zIndex);
    for (const id of ['en-p1-masthead', 'en-p1-issue', 'en-p2-running']) {
      expect(document.pages.flatMap((page: any) => page.frames).find((frame: any) => frame.id === id)?.typography.color).toBe('#f3f0e8');
    }
    expect(plainText(document)).toContain('WOVEN FROM SIGNALS');
    expect(plainText(document)).toContain('CONCEPT DEMO — NOT A REAL PRODUCT — NOT FOR SALE');
    expect(plainText(document)).toContain('信号を、かたちへ。');
  });

  it('builds a fully localized Japanese edition with vertical type and right binding', async () => {
    const { hero, ad, icc } = await fixtureRecords();
    const document = buildJapaneseMagazine(hero, ad, { now: 1_784_132_800_000, iccProfile: icc });

    assertSharedMagazineStructure(document, hero.ref.id, ad.ref.id);
    expect(document.view.rtlBinding).toBe(true);
    const verticalFrames = ['jp-p2-article-v1', 'jp-p2-article-v2', 'jp-p2-article-v3']
      .map((id) => document.pages[1].frames.find((frame: any) => frame.id === id));
    expect(verticalFrames.every((frame: any) => frame?.text && !frame.threadId && frame.threadOrder == null)).toBe(true);
    expect(verticalFrames[0]?.text).toContain('時間軸《じかんじく》');
    expect(verticalFrames[1]?.text).toContain('認証情報《にんしょうじょうほう》');
    expect(verticalFrames[1]?.text).toContain('ポートは「受け取れるものを漏らさず受け取り');
    expect(verticalFrames[2]?.text).toContain('｜見開き《みひらき》');
    expect(document.pages[1].frames.find((frame: any) => frame.id === 'jp-p2-article-pull')?.widthMm).toBeGreaterThanOrEqual(30);
    const pullQuote = document.pages[0].frames.find((frame: any) => frame.id === 'jp-p1-pull');
    const pullBackdrop = document.pages[0].frames.find((frame: any) => frame.id === 'jp-p1-pull-backdrop');
    expect(pullBackdrop).toMatchObject({
      kind: 'panel',
      fillColor: '#071426',
      fillOpacity: 0.62,
      opacity: 0.92,
    });
    expect(pullBackdrop.zIndex).toBeLessThan(pullQuote.zIndex);
    for (const id of ['jp-p1-masthead', 'jp-p1-issue', 'jp-p2-running']) {
      expect(document.pages.flatMap((page: any) => page.frames).find((frame: any) => frame.id === id)?.typography.color).toBe('#f3f0e8');
    }
    expect(plainText(document)).toContain('素材《そざい》と工程《こうてい》');
    expect(plainText(document)).toContain('シグナルを織る');
    expect(plainText(document)).toContain('コンセプトデモ／実在しない商品です／非売品');
    expect(document.pages.flatMap((page: any) => page.frames).some((frame: any) =>
      frame.typography.writingMode === 'vertical-rl'
      && frame.typography.lineBreakStrict === true
      && frame.typography.textOrientation === 'mixed')).toBe(true);
  });

  it('packs deterministic version-2 .slppr containers with validated managed assets', async () => {
    const { hero, ad, icc } = await fixtureRecords();
    const document = buildEnglishMagazine(hero, ad, { now: 1_784_132_800_000, iccProfile: icc });
    const bytes = packMagazineContainer(document, [hero, ad, icc]);
    const archive = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(archive['manifest.json']));

    expect(manifest).toMatchObject({ format: 'signal-loom-paper', formatVersion: 2, kind: 'paper' });
    expect(manifest.assets).toEqual([hero.ref, ad.ref, icc.ref]);
    const iccPath = Object.keys(archive).find((path) => path.endsWith('.icc'));
    expect(iccPath).toBe(`assets/${icc.ref.sha256}.icc`);
    expect(createHash('sha256').update(archive[iccPath!]).digest('hex')).toBe(icc.ref.sha256);
    expect(Object.keys(archive).filter((path) => path.startsWith('assets/'))).toHaveLength(3);
    expect(JSON.stringify(manifest.document)).not.toContain('data:image');
  });
});
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
