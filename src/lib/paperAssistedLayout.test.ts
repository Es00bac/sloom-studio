import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  convertPaperAssistedLayoutPlanToDocument,
  normalizePaperAssistedLayoutSourceBundle,
  PaperAssistedLayoutValidationError,
  validatePaperAssistedLayoutPlanV1,
  validatePaperAssistedLayoutSourceBundleV1,
  type PaperAssistedLayoutPlanV1,
  type PaperAssistedLayoutSourceBundleV1,
} from './paperAssistedLayout';

function makeSourceBundle(): PaperAssistedLayoutSourceBundleV1 {
  return {
    version: 1,
    id: 'manuscript-bundle',
    files: [{
      id: 'source-0001',
      order: 0,
      name: 'chapter.md',
      title: 'chapter',
      format: 'markdown',
      originalBytes: 24,
      blocks: [
        { id: 'source-0001-block-0001', order: 0, role: 'heading', text: 'A Beautiful Beginning' },
        { id: 'source-0001-block-0002', order: 1, role: 'paragraph', text: 'Body copy from the source.' },
      ],
    }],
    totalCharacters: 'A Beautiful Beginning'.length + 'Body copy from the source.'.length,
  };
}

function makePlan(): PaperAssistedLayoutPlanV1 {
  return {
    version: 1,
    document: {
      id: 'assisted-book',
      title: 'Assisted Book',
      page: { widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300 },
      marginsMm: { top: 15, right: 15, bottom: 18, left: 15 },
      background: { kind: 'hex', value: '#ffffff' },
      fonts: [{ id: 'font-body', family: 'Literata', fallback: 'serif' }],
      swatches: [
        {
          id: 'swatch-accent',
          name: 'Warm Red',
          type: 'process',
          color: { model: 'rgb', hex: '#ff0000' },
        },
        {
          id: 'swatch-ink',
          name: 'Print Black',
          type: 'process',
          color: { model: 'cmyk', c: 0, m: 0, y: 0, k: 100 },
        },
      ],
      pages: [{
        id: 'page-cover',
        frames: [
          {
            id: 'frame-story',
            kind: 'text',
            label: 'Opening story',
            geometry: { xMm: 15, yMm: 20, widthMm: 180, heightMm: 80 },
            columns: 1,
            content: {
              kind: 'source-blocks',
              bundleId: 'manuscript-bundle',
              fileId: 'source-0001',
              blockIds: ['source-0001-block-0001', 'source-0001-block-0002'],
            },
            style: {
              fill: { kind: 'none' },
              typography: {
                fontId: 'font-body',
                fontSizePt: 11,
                leadingPt: 15,
                color: { kind: 'swatch', swatchId: 'swatch-ink' },
              },
            },
          },
          {
            id: 'frame-caption',
            kind: 'caption',
            label: 'Cover line',
            geometry: { xMm: 15, yMm: 240, widthMm: 90, heightMm: 25, rotationDeg: 0 },
            content: { kind: 'literal', text: 'Designed locally.' },
            style: {
              fill: { kind: 'swatch', swatchId: 'swatch-accent', tintPercent: 50 },
              fillOpacity: 0.9,
              stroke: { kind: 'hex', value: '#101010' },
              strokeWidthMm: 0.4,
            },
          },
          {
            id: 'frame-image-placeholder',
            kind: 'image',
            label: 'Cover art placeholder',
            geometry: { xMm: 110, yMm: 130, widthMm: 85, heightMm: 135 },
          },
        ],
      }],
    },
  };
}

describe('Paper assisted-layout source normalization', () => {
  it('normalizes editable files in caller order with stable source and block IDs', async () => {
    const bundle = await normalizePaperAssistedLayoutSourceBundle([
      new File(['# First\r\n\r\nOpening paragraph.'], 'first.md', { type: 'text/markdown' }),
      new File(['Second file.\r\nStill one paragraph.'], 'second.txt', { type: 'text/plain' }),
    ], { bundleId: 'ordered-inputs' });

    expect(bundle).toMatchObject({
      version: 1,
      id: 'ordered-inputs',
      files: [
        {
          id: 'source-0001',
          order: 0,
          name: 'first.md',
          format: 'markdown',
          blocks: [
            { id: 'source-0001-block-0001', order: 0, role: 'heading', text: 'First' },
            { id: 'source-0001-block-0002', order: 1, role: 'paragraph', text: 'Opening paragraph.' },
          ],
        },
        {
          id: 'source-0002',
          order: 1,
          name: 'second.txt',
          format: 'txt',
          blocks: [{ id: 'source-0002-block-0001', text: 'Second file.\nStill one paragraph.' }],
        },
      ],
    });
    expect(validatePaperAssistedLayoutSourceBundleV1(bundle)).toEqual({ ok: true, value: bundle });
  });

  it('rejects layout/project files instead of treating them as model input text', async () => {
    const file = new File(['{}'], 'layout.sloom-paper.json', { type: 'application/json' });
    await expect(normalizePaperAssistedLayoutSourceBundle([file])).rejects.toMatchObject({
      name: 'PaperAssistedLayoutValidationError',
      issues: [expect.objectContaining({ message: expect.stringMatching(/not an editable text source/) })],
    });
  });

  it('rejects suspicious DOCX expansion before the assisted-layout importer decompresses it', async () => {
    const docx = zipSync({
      'word/document.xml': strToU8('A'.repeat(1_000_000)),
    }, { level: 9 });

    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([docx], 'bomb.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ])).rejects.toMatchObject({
      name: 'PaperAssistedLayoutValidationError',
      issues: [expect.objectContaining({ message: expect.stringMatching(/DOCX.*suspicious compression ratio/i) })],
    });
  });

  it('strictly validates normalized ordering and aggregate character counts', () => {
    const bundle = makeSourceBundle();
    const invalid = {
      ...bundle,
      totalCharacters: 1,
      files: [{ ...bundle.files[0], order: 2, unexpected: 'not allowed' }],
    };
    const result = validatePaperAssistedLayoutSourceBundleV1(invalid);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.files[0].order',
      '$.files[0].unexpected',
      '$.totalCharacters',
    ]));
  });
});

describe('PaperAssistedLayoutPlanV1 validation', () => {
  it('accepts a bounded, fully declarative plan', () => {
    expect(validatePaperAssistedLayoutPlanV1(makePlan())).toMatchObject({ ok: true });
  });

  it('rejects unknown executable fields, URL content, unsafe fonts, and non-finite geometry', () => {
    const plan = makePlan() as PaperAssistedLayoutPlanV1 & { script?: string };
    plan.script = 'doSomething()';
    plan.document.fonts[0].family = 'Local Font; src: url(https://example.test/font.woff2)';
    plan.document.pages[0].frames[0].geometry.xMm = Number.POSITIVE_INFINITY;
    plan.document.pages[0].frames[1].content = {
      kind: 'literal',
      text: '<script src="https://example.test/payload.js"></script>',
    };

    const result = validatePaperAssistedLayoutPlanV1(plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.script',
      '$.document.fonts[0].family',
      '$.document.pages[0].frames[0].geometry.xMm',
      '$.document.pages[0].frames[1].content.text',
    ]));
  });

  it('rejects duplicate IDs, missing references, out-of-bounds frames, and invalid swatches', () => {
    const plan = makePlan();
    plan.document.pages[0].frames[1].id = 'frame-story';
    plan.document.pages[0].frames[1].geometry.xMm = 205;
    plan.document.pages[0].frames[1].geometry.widthMm = 20;
    plan.document.pages[0].frames[0].style!.typography!.fontId = 'font-missing';
    plan.document.pages[0].frames[0].style!.typography!.color = {
      kind: 'swatch',
      swatchId: 'swatch-missing',
    };
    plan.document.swatches[0].color = { model: 'rgb', hex: '#nothex' };

    const result = validatePaperAssistedLayoutPlanV1(plan);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      '$.document.pages[0].frames[1].id',
      '$.document.pages[0].frames[1].geometry',
      '$.document.pages[0].frames[0].style.typography.fontId',
      '$.document.pages[0].frames[0].style.typography.color.swatchId',
      '$.document.swatches[0].color.hex',
    ]));
  });
});

describe('assisted-layout plan conversion', () => {
  it('deterministically rebuilds a normal PaperDocument with source text, local fonts, and swatches', () => {
    const plan = makePlan();
    const sources = makeSourceBundle();
    const first = convertPaperAssistedLayoutPlanToDocument(plan, { sources, timestamp: 42 });
    const second = convertPaperAssistedLayoutPlanToDocument(plan, { sources, timestamp: 42 });

    expect(first).toStrictEqual(second);
    expect(first).toMatchObject({
      id: 'assisted-book',
      title: 'Assisted Book',
      page: { preset: 'custom', widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300 },
      parentPages: [{ id: 'assisted-book-parent', frames: [], guides: [] }],
      createdAt: 42,
      updatedAt: 42,
      pages: [{
        id: 'page-cover',
        pageNumber: 1,
        guides: [],
        frames: [
          {
            id: 'frame-story',
            text: 'A Beautiful Beginning\n\nBody copy from the source.',
            zIndex: 0,
            fillColor: 'transparent',
            typography: {
              fontFamily: '"Literata", serif',
              fontSizePt: 11,
              leadingPt: 15,
              colorSwatchId: 'swatch-ink',
            },
          },
          {
            id: 'frame-caption',
            text: 'Designed locally.',
            zIndex: 1,
            fillColor: 'rgb(255, 128, 128)',
            fillSwatchId: 'swatch-accent',
            fillTintPercent: 50,
          },
          {
            id: 'frame-image-placeholder',
            kind: 'image',
            zIndex: 2,
          },
        ],
      }],
    });
    expect(first.pages[0].frames[2].asset).toBeUndefined();
    expect(first.pages[0].frames.every((frame) => frame.hyperlink === undefined)).toBe(true);
    expect(first.swatches?.find((swatch) => swatch.id === 'swatch-ink')).toMatchObject({
      model: 'cmyk',
      cmyk: { c: 0, m: 0, y: 0, k: 100 },
      rgb: { r: 0, g: 0, b: 0 },
    });
  });

  it('fails closed when a plan references source content that was not supplied', () => {
    expect(() => convertPaperAssistedLayoutPlanToDocument(makePlan())).toThrow(PaperAssistedLayoutValidationError);
  });

  it('fails closed when the supplied bundle lacks a referenced block', () => {
    const sources = makeSourceBundle();
    sources.files[0].blocks.pop();
    sources.totalCharacters = sources.files[0].blocks[0].text.length;
    expect(() => convertPaperAssistedLayoutPlanToDocument(makePlan(), { sources })).toThrow(/missing source block/i);
  });
});
