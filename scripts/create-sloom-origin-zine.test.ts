import { describe, expect, it } from 'vitest';
import { buildSloomOriginZine } from './create-sloom-origin-zine.mjs';

function record(name: string, mimeType = 'image/png') {
  const sha256 = name.charCodeAt(0).toString(16).padStart(2, '0').repeat(32).slice(0, 64);
  return {
    ref: {
      id: `sha256:${sha256}`,
      sha256,
      mimeType,
      byteLength: 4,
      fileName: name,
    },
    bytes: new Uint8Array([1, 2, 3, 4]),
  };
}

function fixture() {
  const names = [
    'cover', 'hero', 'kernProduct', 'kernAd', 'afterimageProduct', 'afterimageAd',
    'sloanAd', 'logo', 'flowCover', 'flowSloan',
  ] as const;
  const assets = Object.fromEntries(names.map((name) => [name, record(`${name}.png`)]));
  return buildSloomOriginZine(assets, {
    importedFonts: [{ id: 'managed-face' }],
    iccProfile: record('FOGRA39L_coated.icc', 'application/vnd.iccprofile'),
    now: 123,
  });
}

describe('Sloom Studio origin zine', () => {
  it('builds a complete 16-page, cover-to-back-cover publication', () => {
    const document = fixture();
    expect(document.pages).toHaveLength(16);
    expect(document.pages.map((page: any) => page.pageNumber)).toEqual(
      Array.from({ length: 16 }, (_, index) => index + 1),
    );
    expect(document.view).toMatchObject({ showSpreads: true, startOnRight: true, rtlBinding: false });
    expect(document.page).toMatchObject({ preset: 'a4', bleedMm: 3, dpi: 300 });
    expect(document.managedIccProfiles?.[0]?.outputConditionId).toBe('FOGRA39');
    expect(document.importedFonts).toHaveLength(1);
  });

  it('preserves the supplied origin facts and uses substantial editorial copy', () => {
    const document = fixture();
    const text = document.pages.flatMap((page: any) => page.frames.map((frame: any) => frame.text)).join('\n');
    expect(text).toContain('personal Gemini API key');
    expect(text).toContain('The video workspace arrived second');
    expect(text).toContain('Image came third');
    expect(text).toContain('Paper followed as the fourth room');
    expect(text).toContain('high school yearbook');
    expect(text).toContain('art school was not financially available');
    expect(text.split(/\s+/).length).toBeGreaterThan(1700);
  });

  it('demonstrates editorial features without malformed polygon frames', () => {
    const document = fixture();
    const frames = document.pages.flatMap((page: any) => page.frames);
    expect(frames.some((frame: any) => frame.richText?.length)).toBe(true);
    expect(frames.some((frame: any) => frame.columns === 2 && frame.columnRule)).toBe(true);
    expect(frames.some((frame: any) => frame.threadId === 'origin-story')).toBe(true);
    expect(frames.some((frame: any) => frame.typography?.writingMode === 'vertical-rl')).toBe(true);
    expect(frames.some((frame: any) => frame.text?.includes('《'))).toBe(true);
    expect(frames.every((frame: any) => frame.kind !== 'polygon' && !frame.vertices)).toBe(true);
  });

  it('labels every fictional advertisement and packages only managed image locators', () => {
    const document = fixture();
    for (const pageNumber of [10, 14, 15]) {
      const text = document.pages[pageNumber - 1].frames.map((frame: any) => frame.text).join('\n');
      expect(text).toContain('ADVERTISEMENT / FICTIONAL DEMO');
      expect(text).toContain('NOT A REAL PRODUCT');
      expect(text).toContain('NOT FOR SALE');
    }
    const imageFrames = document.pages.flatMap((page: any) => page.frames).filter((frame: any) => frame.kind === 'image');
    expect(imageFrames.length).toBeGreaterThanOrEqual(12);
    expect(imageFrames.every((frame: any) => frame.asset?.locator?.kind === 'managed')).toBe(true);
  });
});
