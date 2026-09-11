import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaperPdfx, type PdfxRasterPage, type PdfxStandard } from './paperPdfxExport';
import { validatePaperPdfx } from './paperPdfxValidate';
import { createRgbToCmykTransform } from './paperIccEngine';

const fogra39 = new Uint8Array(readFileSync('public/icc/FOGRA39L_coated.icc'));
const liberationSerif = new Uint8Array(readFileSync('public/fonts/liberation/LiberationSerif-Regular.ttf'));
const FRAME_TEXT = 'Sloom Studio prints real vector text';

function whitePageWithText(): PdfxRasterPage {
  const w = 96;
  const h = 96;
  const rgba = new Uint8Array(w * h * 4).fill(255); // white backdrop (text was excluded from the raster)
  return {
    rgba,
    widthPx: w,
    heightPx: h,
    trimWidthPt: 216,
    trimHeightPt: 216,
    bleedPt: 9,
    textFrames: [
      {
        text: FRAME_TEXT,
        fontId: 'LiberationSerif-Regular',
        fontBytes: liberationSerif,
        fontSizePt: 12,
        leadingPt: 16,
        align: 'left',
        cmyk: { c: 0, m: 0, y: 0, k: 1 }, // black
        xPt: 20,
        yTopPt: 20,
        widthPt: 180,
        heightPt: 120,
      },
    ],
  };
}

const profile = {
  iccBytes: fogra39,
  outputConditionIdentifier: 'FOGRA39',
  outputCondition: 'Coated FOGRA39 (ISO 12647-2:2004)',
};

function poppler(tool: string, args: string[]): string | null {
  try {
    return execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null; // tool not installed — skip the cross-check
  }
}

describe('buildPaperPdfx vector text (hybrid PDF/X)', () => {
  it.each<PdfxStandard>(['pdf-x-1a', 'pdf-x-4'])('embeds selectable vector text and stays conformant (%s)', async (standard) => {
    const transform = await createRgbToCmykTransform(fogra39, { intent: 'relative' });
    try {
      const result = await buildPaperPdfx([whitePageWithText()], {
      standard,
      profile,
      transform,
      title: 'Vector text test',
      docId: '0123456789abcdef0123456789abcdef',
      createdAt: new Date('2026-07-06T00:00:00Z'),
    });

      // Still a structurally conformant PDF/X after adding the font + text.
      const report = await validatePaperPdfx(result.bytes, { standard });
      const failed = report.checks.filter((c) => !c.pass).map((c) => c.label);
      expect(failed, `failed: ${failed.join('; ')}`).toEqual([]);
      expect(report.pass).toBe(true);

      // The font really travels in the file (embedded TrueType program + face name).
      const asText = Buffer.from(result.bytes).toString('latin1');
      expect(asText).toContain('/FontFile2');
      expect(asText).toMatch(/LiberationSerif/);

      // If poppler is available, prove the text is real (extractable) and the font is embedded+subset.
      const dir = mkdtempSync(join(tmpdir(), 'sloom-pdfx-'));
      const pdfPath = join(dir, `vec-${standard}.pdf`);
      writeFileSync(pdfPath, result.bytes);

      const extracted = poppler('pdftotext', [pdfPath, '-']);
      if (extracted !== null) {
        expect(extracted.replace(/\s+/g, ' ')).toContain(FRAME_TEXT);
      }
      const fonts = poppler('pdffonts', [pdfPath]);
      if (fonts !== null) {
        // Row columns: name | type | encoding | emb | sub | uni | object | id.
        // PDF/X requires the font EMBEDDED (emb=yes); we also map to Unicode (uni=yes → selectable).
        expect(fonts).toMatch(/LiberationSerif\S*\s+CID TrueType\s+Identity-H\s+yes\s+\S+\s+yes/);
      }
    } finally {
      transform.dispose?.();
    }
  });

  it('leaves a page with no textFrames as a pure flattened raster', async () => {
    const transform = await createRgbToCmykTransform(fogra39, { intent: 'relative' });
    try {
      const page: PdfxRasterPage = {
      rgba: new Uint8Array(48 * 48 * 4).fill(255),
      widthPx: 48,
      heightPx: 48,
      trimWidthPt: 144,
      trimHeightPt: 144,
      bleedPt: 0,
    };
      const result = await buildPaperPdfx([page], { standard: 'pdf-x-4', profile, transform, docId: '0123456789abcdef0123456789abcdef' });
      expect(Buffer.from(result.bytes).toString('latin1')).not.toContain('/FontFile2');
      expect((await validatePaperPdfx(result.bytes)).pass).toBe(true);
    } finally {
      transform.dispose?.();
    }
  });
});
