// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyTypographyPatchToDomSelection } from '../features/paper/workspace/paperRichEditorSession';
import type { BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import type { PaperManagedFontFace, PaperTypography } from '../types/paper';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { createRichEditorBase, richTextToEditorHtml, serializeRichEditor } from './paperRichTextDom';
import { composePaperTextFrame } from './paperTextComposition';
import type { PaperTextShaper } from './paperTextShaper';

const TYPOGRAPHY: PaperTypography = {
  fontFamily: 'Fixture Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, fontKerning: 'auto', align: 'left',
  hyphenate: true, color: '#111111', fontWeight: '400', fontStyle: 'normal', numericStyle: 'normal',
};

function fixtureFace(): PaperManagedFontFace {
  const sha256 = '7'.repeat(64);
  const fontAsset: BinaryAssetRef = { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
  return {
    id: 'leading-fixture-400', familyId: 'fixture sans', familyName: 'Fixture Sans',
    postscriptName: 'FixtureSans-Regular', weight: 400, style: 'normal', stretchPercent: 100,
    collectionIndex: 0, variableAxes: {}, unicodeRanges: [{ start: 0, end: 0x10ffff }],
    format: 'truetype', fontAsset, embeddability: 'installable', canSubset: true,
    source: { kind: 'user-import' }, license: {},
  };
}

function fixtureShaper(): PaperTextShaper {
  return {
    shape(request) {
      let cluster = 0;
      const glyphs = Array.from(request.text).map((character) => {
        const glyph = {
          glyphId: character.codePointAt(0) ?? 1,
          cluster,
          xAdvance: request.fontSizePt / 2,
          yAdvance: 0,
          xOffset: 0,
          yOffset: 0,
        };
        cluster += character.length;
        return glyph;
      });
      return {
        direction: request.direction,
        glyphs,
        advanceX: glyphs.reduce((total, glyph) => total + glyph.xAdvance, 0),
        advanceY: 0,
      };
    },
    glyphPath: () => 'M 0 0 L 500 0 L 500 500 Z',
    destroy: () => undefined,
  };
}

describe('Paper run-leading editor pipeline', () => {
  it('extracts, edits, serializes, reopens, and composes a lower run override without materializing inheritance', async () => {
    const source = [{ leadingPt: 22, runs: [{ text: 'Before selected after' }] }];
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml(source, 1);
    const text = editor.querySelector('span')?.firstChild;
    if (!(text instanceof Text)) throw new Error('Expected editor text');
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 15);

    expect(applyTypographyPatchToDomSelection(editor, range, { leadingPt: 11 }, 1)?.applied).toBe(true);
    const serialized = serializeRichEditor(editor, createRichEditorBase(TYPOGRAPHY, 1));
    expect(serialized).toEqual([{
      leadingPt: 22,
      runs: [{ text: 'Before ' }, { text: 'selected', leadingPt: 11 }, { text: ' after' }],
    }]);

    const reopened = document.createElement('div');
    reopened.innerHTML = richTextToEditorHtml(serialized, 1);
    expect(serializeRichEditor(reopened, createRichEditorBase(TYPOGRAPHY, 1))).toEqual(serialized);

    let paper = createDefaultPaperDocument({ title: 'Leading pipeline' });
    const added = addFrameToPaperPage(paper, paper.pages[0].id, {
      id: 'leading-frame', kind: 'text', xMm: 0, yMm: 0, widthMm: 100, heightMm: 30,
    });
    paper = { ...added.document, importedFonts: [fixtureFace()] };
    const frame = {
      ...paper.pages[0].frames[0],
      text: 'Before selected after',
      richText: serialized,
      typography: { ...paper.pages[0].frames[0].typography, ...TYPOGRAPHY },
    };

    const composed = await composePaperTextFrame(frame, paper, async () => fixtureShaper());
    expect(composed.missingFaces).toEqual([]);
    expect(composed.lines).toHaveLength(1);
    // FBL-006 keeps the paragraph strut as the shared line-box floor even though the lower run is durable.
    expect(composed.lines[0].layoutBounds?.heightPt).toBeCloseTo(22);
  });
});
