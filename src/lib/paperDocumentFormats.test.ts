import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';
import {
  addFrameToPaperPage,
  computeEffectivePaperFrame,
  createDefaultPaperDocument,
  serializePaperDocument,
} from './paperDocument';
import { analyzePaperPreflight, collectPaperLinkedAssets } from './paperPreflight';
import {
  buildPaperCbzManifestExport,
  buildPaperCbzRasterExport,
  exportPaperIdmlInterchange,
  exportPaperStoryText,
  importPaperIdmlInterchange,
  importTextDocumentIntoPaper,
  inferPaperDocumentImportFormat,
  parsePaperDocumentImportFile,
  placeDocumentSourceOnPaperPage,
} from './paperDocumentFormats';

describe('paperDocumentFormats', () => {
  it('imports Markdown headings and paragraphs as Paper text frames', async () => {
    const file = new File(['# Page One\n\nPanel caption text.\n\n## Scene Two\n\nMore dialogue.'], 'script.md', { type: 'text/markdown' });
    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected text document import.');
    expect(imported.blocks.map((block) => block.role)).toEqual(['heading', 'paragraph', 'heading', 'paragraph']);

    const doc = await importTextDocumentIntoPaper(imported);
    expect(doc.title).toBe('script');
    expect(doc.pages.flatMap((page) => page.frames).map((frame) => frame.text)).toEqual(expect.arrayContaining(['Page One', 'Panel caption text.']));
    expect(doc.pages[0].frames[0].typography.fontWeight).toBe('700');
  });

  it('detects a real Adobe .idml package distinctly from the .sloom-idml.json interchange', () => {
    expect(inferPaperDocumentImportFormat('layout.idml')).toBe('idml-package');
    expect(inferPaperDocumentImportFormat('x', 'application/vnd.adobe.indesign-idml-package')).toBe('idml-package');
    expect(inferPaperDocumentImportFormat('layout.sloom-idml.json')).toBe('sloom-idml-json');
  });

  it('round-trips its own Paper JSON export through the import-file boundary', async () => {
    const source = createDefaultPaperDocument({ title: 'Round-trip layout' });
    const { document } = addFrameToPaperPage(source, source.pages[0].id, {
      kind: 'text',
      xMm: 11,
      yMm: 17,
      widthMm: 73,
      heightMm: 28,
      text: 'Keep this frame as layout data.',
      richText: [{ runs: [{ text: 'Keep this frame as layout data.', fontWeight: '700' }] }],
      typography: { writingMode: 'vertical-rl' },
    });
    const file = new File(
      [serializePaperDocument(document)],
      'round-trip.sloom-paper.json',
      { type: 'application/json' },
    );

    expect(inferPaperDocumentImportFormat(file.name, file.type)).toBe('sloom-paper-json');
    const imported = await parsePaperDocumentImportFile(file);

    expect('blocks' in imported).toBe(false);
    expect(imported).toMatchObject({
      id: document.id,
      title: 'Round-trip layout',
      pages: [{
        id: document.pages[0].id,
        frames: [{
          text: 'Keep this frame as layout data.',
          xMm: 11,
          yMm: 17,
          richText: [{ runs: [{ text: 'Keep this frame as layout data.', fontWeight: '700' }] }],
          typography: { writingMode: 'vertical-rl' },
        }],
      }],
    });
  });

  it('fails closed for a malformed real .idml archive instead of silently mis-parsing it as text', async () => {
    // A byte sequence that is NOT a complete ZIP — proves the real package path rejects it before any text fallback.
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'brand.idml', { type: 'application/vnd.adobe.indesign-idml-package' });
    await expect(parsePaperDocumentImportFile(file)).rejects.toThrow(/IDML.*(truncated|directory)/i);
  });

  it('extracts paragraph text from DOCX word/document.xml', async () => {
    const base = createDefaultPaperDocument({ title: 'Docx Source' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 25,
      text: 'First paragraph\nSecond paragraph',
    });
    const exported = exportPaperStoryText(document, 'docx');
    const file = new File([exported.blob], 'story.docx', { type: exported.mimeType });
    const imported = await parsePaperDocumentImportFile(file);

    expect('blocks' in imported ? imported.blocks.map((block) => block.text) : []).toEqual(expect.arrayContaining(['First paragraph', 'Second paragraph']));
  });

  it('preflights DOCX archive expansion before decompression', async () => {
    const zip = zipSync({
      'word/document.xml': strToU8('A'.repeat(1_000_000)),
    }, { level: 9 });
    const file = new File([zip], 'bomb.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await expect(parsePaperDocumentImportFile(file))
      .rejects.toThrow(/DOCX.*suspicious compression ratio/i);
  });

  it('preserves docx headings, alignment, whole-paragraph bold/italic, lists, and line breaks', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
      + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter One</w:t></w:r></w:p>`
      + `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Bold centered line</w:t></w:r></w:p>`
      + `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t>All italic</w:t></w:r></w:p>`
      + `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First bullet</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>`
      + `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Half bold </w:t></w:r><w:r><w:t>half normal</w:t></w:r></w:p>`
      + `<w:p></w:p>`
      + `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const file = new File([zip], 'chapter.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const blocks = imported.blocks;
    expect(blocks).toHaveLength(6); // the empty paragraph is dropped

    expect(blocks[0]).toMatchObject({ role: 'heading', level: 1, text: 'Chapter One' });
    expect(blocks[1]).toMatchObject({ role: 'paragraph', text: 'Bold centered line', align: 'center', bold: true });
    expect(blocks[2]).toMatchObject({ role: 'paragraph', text: 'All italic', italic: true });
    expect(blocks[3].text).toBe('•\tFirst bullet');
    expect(blocks[4].text).toBe('Line one\nline two');
    expect(blocks[5]).toMatchObject({ text: 'Half bold half normal' });
    expect(blocks[5].bold).toBeUndefined(); // not ALL runs are bold → no paragraph-level bold

    // The attributes flow into the created Paper frames — and, critically, into the EFFECTIVE typography
    // (no paragraph style silently overriding alignment/weight, which the old 'para-caption' default did).
    const doc = await importTextDocumentIntoPaper(imported);
    const frames = doc.pages.flatMap((page) => page.frames);
    const centered = frames.find((frame) => frame.text === 'Bold centered line');
    expect(centered?.paragraphStyleId).toBeUndefined();
    expect(computeEffectivePaperFrame(doc, centered!).typography.align).toBe('center');
    expect(computeEffectivePaperFrame(doc, centered!).typography.fontWeight).toBe('700');
    const italic = frames.find((frame) => frame.text === 'All italic');
    expect(computeEffectivePaperFrame(doc, italic!).typography.fontStyle).toBe('italic');
    // A plain body paragraph is clean body weight, not the old forced-bold caption.
    const body = frames.find((frame) => frame.text === 'Half bold half normal');
    expect(computeEffectivePaperFrame(doc, body!).typography.fontWeight).toBe('400');
  });

  it('preserves docx tables and embedded images as real frames instead of flattening them to text', async () => {
    // A 1x1 PNG so the drawing has real bytes to embed.
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>` +
      `<w:p><w:r><w:t>Intro paragraph</w:t></w:r></w:p>` +
      // A 2x2 table with a spanned header cell — must survive as a table, not four stray paragraphs.
      `<w:tbl><w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Header spans two</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      // An inline image referencing rId5 → media/image1.png.
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="x"><wp:extent cx="1828800" cy="914400"/><a:blip xmlns:a="y" r:embed="rId5"/></wp:inline></w:drawing></w:r></w:p>` +
      `</w:body></w:document>`;
    const rels =
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
      `</Relationships>`;
    const zip = zipSync({
      'word/document.xml': strToU8(doc),
      'word/_rels/document.xml.rels': strToU8(rels),
      'word/media/image1.png': pngBytes,
    });
    const file = new File([zip], 'rich.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const table = imported.blocks.find((block) => block.role === 'table');
    const image = imported.blocks.find((block) => block.role === 'image');
    expect(table?.table).toMatchObject({ rows: 2, cols: 2 });
    expect(table?.table?.cells[0]).toEqual(['Header spans two', '']); // spanned cell → blank continuation
    expect(table?.table?.cells[1]).toEqual(['A1', 'B1']);
    expect(image?.image?.mimeType).toBe('image/png');
    expect(image?.image?.bytes).toEqual(pngBytes);
    expect(image?.image?.widthMm).toBeCloseTo(50.8, 1); // 1828800 EMU ÷ 36000
    expect(imported.limitations?.some((note) => /table/i.test(note))).toBe(true);
    expect(imported.limitations?.some((note) => /image/i.test(note))).toBe(true);

    // …and they become a real table frame + a real image frame in the laid-out document.
    const built = await importTextDocumentIntoPaper(imported);
    const frames = built.pages.flatMap((page) => page.frames);
    expect(frames.some((frame) => frame.table && frame.table.rows === 2)).toBe(true);
    expect(frames.some((frame) => frame.kind === 'image' && frame.asset?.locator?.kind === 'managed')).toBe(true);

    // Imported document elements flow like a Word/LibreOffice document — no debug box around them. Every
    // imported paragraph, table, and image frame must be borderless (transparent stroke, zero width) rather
    // than inheriting the default #111827 / 0.35mm text-frame stroke.
    const paragraphFrame = frames.find((frame) => frame.text === 'Intro paragraph');
    const imageFrame = frames.find((frame) => frame.kind === 'image');
    expect(paragraphFrame?.strokeWidthMm).toBe(0);
    expect(paragraphFrame?.strokeColor).toBe('transparent');
    expect(paragraphFrame?.fillColor).toBe('transparent');
    expect(imageFrame?.strokeWidthMm).toBe(0);
    expect(imageFrame?.strokeColor).toBe('transparent');
  });

  it('imports docx table cell shading and border colour, not just plain cell text', async () => {
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:tbl>` +
      `<w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="4472C4"/><w:left w:val="single" w:sz="4" w:color="4472C4"/></w:tblBorders></w:tblPr>` +
      `<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>` +
      // Header row: both cells shaded blue.
      `<w:tr>` +
      `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="4472C4"/></w:tcPr><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="4472C4"/></w:tcPr><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      // Body row: left cell light-grey shaded, right cell unshaded ("auto" = no fill).
      `<w:tr>` +
      `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9E1F2"/></w:tcPr><w:p><w:r><w:t>Apples</w:t></w:r></w:p></w:tc>` +
      `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="auto"/></w:tcPr><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc>` +
      `</w:tr>` +
      `</w:tbl>` +
      `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(doc) });
    const file = new File([zip], 'shaded.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const table = imported.blocks.find((block) => block.role === 'table');
    expect(table?.table?.cells).toEqual([['Item', 'Qty'], ['Apples', '6']]);
    // Header shading + alternating body shading survive as per-cell fills; "auto" stays empty.
    expect(table?.table?.cellFills).toEqual([
      ['#4472c4', '#4472c4'],
      ['#d9e1f2', ''],
    ]);
    expect(table?.table?.borderColor).toBe('#4472c4');

    // …and the fills/border land on the built Paper table frame (normalized, still rows×cols).
    const built = await importTextDocumentIntoPaper(imported);
    const frame = built.pages.flatMap((page) => page.frames).find((f) => f.table);
    expect(frame?.table?.cellFills?.[0]).toEqual(['#4472c4', '#4472c4']);
    expect(frame?.table?.borderColor).toBe('#4472c4');
  });

  it('resolves list numbering from numbering.xml (numbers, bullets, multi-level) instead of a flat bullet', async () => {
    const numbering =
      `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:start w:val="1"/></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/></w:lvl></w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum>` +
      `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
      `<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>` +
      `<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>` +
      `</w:numbering>`;
    const li = (numId: number, ilvl: number, text: string) =>
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      li(1, 0, 'One') + li(1, 0, 'Two') + // decimal 1. 2.
      li(2, 0, 'Bullet') +                // bullet •
      // A ListParagraph-styled paragraph with NO numPr is NOT a list item (Word uses it for list intros).
      `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/></w:pPr><w:r><w:t>Not a list item</w:t></w:r></w:p>` +
      li(3, 0, 'Top') + li(3, 1, 'Sub') + // multi-level 1. then a.
      `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(doc), 'word/numbering.xml': strToU8(numbering) });
    const file = new File([zip], 'lists.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const markers = imported.blocks.map((b) => b.richText?.[0].listMarker);
    expect(markers).toEqual(['1.', '2.', '•', undefined, '1.', 'a.']);
    expect(imported.blocks[3].text).toBe('Not a list item'); // no bullet prefix on the non-list paragraph
    expect(imported.blocks[5].richText?.[0].leftIndentMm).toBeGreaterThan(0); // nested level is indented
  });

  it('merges a Word drop-cap frame paragraph into the following body paragraph (real first-letter drop cap)', async () => {
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around"/></w:pPr><w:r><w:rPr><w:sz w:val="116"/></w:rPr><w:t>D</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>rop caps emphasize the leading paragraph.</w:t></w:r></w:p>` +
      `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(doc) });
    const file = new File([zip], 'dropcap.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    // Exactly one paragraph — the standalone "D" is merged in, not left as its own giant character.
    expect(imported.blocks).toHaveLength(1);
    expect(imported.blocks[0].text).toBe('Drop caps emphasize the leading paragraph.');
    expect(imported.blocks[0].richText?.[0].dropCapLines).toBe(3);
    // The merged drop letter carries no oversized run size (the ::first-letter CSS does the enlarging).
    expect(imported.blocks[0].richText?.[0].runs[0].fontSizePt).toBeUndefined();
  });

  it('adopts the docx page margins (pgMar) as document margins + margin guides on every page', async () => {
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:p><w:r><w:t>Body</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
      `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(doc) });
    const file = new File([zip], 'margins.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    expect(imported.pageMarginsMm?.top).toBeCloseTo(25.4, 1); // 1440 twips = 1 inch
    const built = await importTextDocumentIntoPaper(imported);
    expect(built.layout.marginsMm.left).toBeCloseTo(25.4, 1);
    expect(built.view.showGuides).toBe(true);
    // Four margin guides on the page: left/right verticals + top/bottom horizontals.
    const guides = built.pages[0].guides;
    expect(guides.filter((g) => g.orientation === 'vertical').map((g) => Math.round(g.positionMm))).toEqual([25, Math.round(built.page.widthMm - 25.4)]);
    expect(guides.filter((g) => g.orientation === 'horizontal')).toHaveLength(2);
  });

  it('imports paragraph shading, borders, and hanging/left indents from pPr', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
      // A grey-shaded paragraph with a right border and 4pt inset — like the calibre demo's callout.
      + `<w:p><w:pPr><w:pBdr><w:right w:val="single" w:sz="4" w:space="4" w:color="auto"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="DDDDDD"/></w:pPr><w:r><w:t>Shaded callout with a right border</w:t></w:r></w:p>`
      // A hanging-indent paragraph (left 720 twips, hanging 720 twips) — the classic poetry/hanging layout.
      + `<w:p><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr><w:r><w:t>Hanging indent paragraph</w:t></w:r></w:p>`
      + `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const file = new File([zip], 'para.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const shaded = imported.blocks[0].richText?.[0];
    expect(shaded?.shading).toBe('#dddddd');
    expect(shaded?.borders?.right).toMatchObject({ color: 'currentColor', widthPt: 0.5 }); // sz 4 → 0.5pt, auto → currentColor
    expect(shaded?.borders?.paddingPt).toBe(4);
    expect(shaded?.borders?.top).toBeUndefined(); // only a right border in the source
    const hanging = imported.blocks[1].richText?.[0];
    expect(hanging?.leftIndentMm).toBeCloseTo(12.7, 1); // 720 twips = 0.5in = 12.7mm
    expect(hanging?.hangingIndentMm).toBeCloseTo(12.7, 1);
  });

  it('resolves table-style shading/borders (w:tblStyle + tblLook), not just inline cell shading', async () => {
    // Real Word tables (as in the calibre demo) get header/band shading from a referenced style in
    // styles.xml, not inline <w:shd> on every cell. The importer must resolve that to render as intended.
    const styles =
      `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:style w:type="table" w:styleId="GridTable">` +
      `<w:basedOn w:val="TableNormal"/>` +
      `<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="4472C4"/><w:left w:val="single" w:sz="8" w:color="4472C4"/></w:tblBorders></w:tblPr>` +
      `<w:tblStylePr w:type="firstRow"><w:rPr><w:b/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr>` +
      `<w:tblStylePr w:type="band1Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="D9E1F2"/></w:tcPr></w:tblStylePr>` +
      `</w:style></w:styles>`;
    const doc =
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
      `<w:tbl>` +
      // firstRow (0x20) + noVBand (0x400) enabled, horizontal banding ON → header shaded, alternating body rows.
      `<w:tblPr><w:tblStyle w:val="GridTable"/><w:tblLook w:val="0420"/></w:tblPr>` +
      `<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Apples</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>6</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Pears</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc></w:tr>` +
      `<w:tr><w:tc><w:p><w:r><w:t>Plums</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc></w:tr>` +
      `</w:tbl>` +
      `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(doc), 'word/styles.xml': strToU8(styles) });
    const file = new File([zip], 'styled-table.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const table = imported.blocks.find((block) => block.role === 'table');
    // Header row shaded from the style's firstRow part; body rows alternate band1Horz / (none).
    expect(table?.table?.cellFills).toEqual([
      ['#4472c4', '#4472c4'], // firstRow
      ['#d9e1f2', '#d9e1f2'], // first body row → band1Horz
      ['', ''], // second body row → band2 (undefined = no paint)
      ['#d9e1f2', '#d9e1f2'], // third body row → band1Horz again
    ]);
    expect(table?.table?.borderColor).toBe('#4472c4');
    expect(table?.table?.headerRow).toBe(true);
  });

  it('imports docx table cell shading and border colour, not just plain cell text', async () => {
    const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
      + `<w:p>`
      + `<w:r><w:t xml:space="preserve">Plain </w:t></w:r>`
      + `<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>`
      + `<w:r><w:t xml:space="preserve"> and </w:t></w:r>`
      + `<w:r><w:rPr><w:color w:val="FF0000"/><w:sz w:val="36"/></w:rPr><w:t>big red</w:t></w:r>`
      + `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>2</w:t></w:r>`
      + `</w:p>`
      + `</w:body></w:document>`;
    const zip = zipSync({ 'word/document.xml': strToU8(xml) });
    const file = new File([zip], 'inline.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    const para = imported.blocks[0];
    expect(para.text).toBe('Plain bold and big red2'); // flattened plaintext fallback stays intact
    const runs = para.richText?.[0].runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(['Plain ', 'bold', ' and ', 'big red', '2']);
    expect(runs[1]).toMatchObject({ text: 'bold', fontWeight: '700' });
    expect(runs[3]).toMatchObject({ text: 'big red', color: '#ff0000', fontSizePt: 18 });
    expect(runs[4]).toMatchObject({ text: '2', vertAlign: 'super' });
    // No 'mixed styling simplified' disclaimer anymore — the styling is actually preserved.
    expect((imported.limitations ?? []).some((note) => /simplified|dominant style/i.test(note))).toBe(false);

    // …and it lands on a real frame carrying the runs, with text kept as the flattened fallback.
    const doc = await importTextDocumentIntoPaper(imported);
    const frame = doc.pages.flatMap((page) => page.frames).find((f) => f.text === 'Plain bold and big red2');
    expect(frame?.richText?.[0].runs.length).toBe(5);
  });

  it('wraps a hyperlinked text frame in an <a> in the HTML story export', () => {
    const base = createDefaultPaperDocument({ title: 'Links' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 25,
      text: 'Visit the site',
      hyperlink: 'https://example.com/docs',
    });
    const exported = exportPaperStoryText(document, 'html');
    expect('text' in exported ? exported.text : '').toContain('<a href="https://example.com/docs">Visit the site</a>');
  });

  it('roundtrips IDML-like interchange with setup, pages, styles, links, and guides', () => {
    const item = pdfItem();
    const base = createDefaultPaperDocument({ title: 'Interchange' });
    const placed = placeDocumentSourceOnPaperPage(base, base.pages[0].id, item);
    const json = exportPaperIdmlInterchange(placed.document);
    const roundtripped = importPaperIdmlInterchange(json);
    const parsed = JSON.parse(json) as { manifest: { linkCount: number }; links: unknown[]; guides: unknown[] };

    expect(roundtripped.title).toBe('Interchange');
    expect(roundtripped.pages[0].frames[0].kind).toBe('document');
    expect(parsed.manifest.linkCount).toBe(1);
    expect(parsed.links).toHaveLength(1);
    expect(parsed.guides.length).toBeGreaterThan(0);
  });

  it('builds a CBZ package with zero-padded raster PNG page files', async () => {
    const base = createDefaultPaperDocument({ title: 'Comic Export' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'caption',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 20,
      text: 'Narration box',
    });
    const exported = await buildPaperCbzRasterExport(document, {
      rasterize: (page) => ({
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        label: page.label,
        widthMm: page.widthMm,
        heightMm: page.heightMm,
        widthPx: page.widthPx,
        heightPx: page.heightPx,
        scale: page.scale,
        includeBleed: page.includeBleed,
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      }),
    });
    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as { format: string; pages: Array<{ path: string }> };

    expect(exported.fileName).toBe('Comic-Export.cbz');
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(['manifest.json', 'ComicInfo.xml', 'pages/page-001.png']));
    expect(Object.keys(entries).some((entry) => entry.endsWith('.svg'))).toBe(false);
    expect(entries['pages/page-001.png']).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(manifest.format).toBe('sloom-cbz-raster');
    expect(manifest.pages[0].path).toBe('pages/page-001.png');
  });

  it('writes the manga right-to-left reading direction into CBZ ComicInfo.xml', async () => {
    const rasterStub = { rasterize: (page: { pageId: string; pageNumber: number; label: string; widthMm: number; heightMm: number; widthPx: number; heightPx: number; scale: number; includeBleed: boolean }) => ({ ...page, mimeType: 'image/png' as const, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }) };

    const rtl = createDefaultPaperDocument({ title: '右綴じ Comic' });
    rtl.view.rtlBinding = true;
    const rtlZip = unzipSync(new Uint8Array(await (await buildPaperCbzRasterExport(rtl, rasterStub)).blob.arrayBuffer()));
    expect(strFromU8(rtlZip['ComicInfo.xml'])).toContain('<Manga>YesAndRightToLeft</Manga>');

    const ltr = createDefaultPaperDocument({ title: 'Western Comic' });
    const ltrZip = unzipSync(new Uint8Array(await (await buildPaperCbzRasterExport(ltr, rasterStub)).blob.arrayBuffer()));
    expect(strFromU8(ltrZip['ComicInfo.xml'])).toContain('<Manga>No</Manga>');

    // Auto-derive: a vertical (縦書き) doc with nothing pinned exports right-to-left without touching the toggle.
    const autoBase = createDefaultPaperDocument({ title: '縦書き Auto' });
    const auto = addFrameToPaperPage(autoBase, autoBase.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 40, heightMm: 60, text: '縦書き', typography: { writingMode: 'vertical-rl' },
    }).document;
    expect(auto.view.rtlBinding).toBeUndefined();
    const autoZip = unzipSync(new Uint8Array(await (await buildPaperCbzRasterExport(auto, rasterStub)).blob.arrayBuffer()));
    expect(strFromU8(autoZip['ComicInfo.xml'])).toContain('<Manga>YesAndRightToLeft</Manga>');
  });

  it('keeps the legacy CBZ manifest helper with per-page SVG payloads', async () => {
    const document = createDefaultPaperDocument({ title: 'Legacy CBZ' });
    const exported = buildPaperCbzManifestExport(document);
    const entries = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));

    expect(Object.keys(entries)).toEqual(expect.arrayContaining(['manifest.json', 'pages/page-001.svg']));
  });

  it('places PDF documents as linked frames with preflight/link tracking', () => {
    const item = pdfItem();
    const base = createDefaultPaperDocument({ title: 'PDF Place' });
    const { document, frameId } = placeDocumentSourceOnPaperPage(base, base.pages[0].id, item, { xMm: 12, yMm: 18 });
    const frame = document.pages[0].frames.find((candidate) => candidate.id === frameId);
    const linked = collectPaperLinkedAssets(document, [item]);
    const report = analyzePaperPreflight(document, [item]);

    expect(frame).toEqual(expect.objectContaining({ kind: 'document', asset: expect.objectContaining({ mimeType: 'application/pdf', sourceBinItemId: item.id }) }));
    expect(linked[0]).toEqual(expect.objectContaining({ sourceId: item.id, status: 'unknown', frameId }));
    expect(report.issues.some((issue) => issue.title === 'Missing linked document')).toBe(false);
  });

  it('honors an explicit page break, running header/footer with page fields, footnotes, and multi-section geometry', async () => {
    const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>`
      + `<w:p><w:r><w:t>Intro on page one.</w:t></w:r></w:p>`
      + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
      + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading on page two</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t xml:space="preserve">A cited claim</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="2"/></w:r></w:p>`
      // Section 0 (this paragraph's sectPr) = portrait, titlePg, with default + first header/footer refs.
      + `<w:p><w:pPr><w:sectPr>`
      + `<w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/>`
      + `<w:headerReference w:type="first" r:id="rIdHF"/><w:titlePg/>`
      + `<w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>`
      + `</w:sectPr></w:pPr></w:p>`
      // Section 1 = landscape, single column.
      + `<w:p><w:r><w:t>Landscape body.</w:t></w:r></w:p>`
      + `<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840" w:orient="landscape"/>`
      + `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p>`
      // Section 2 (body-level sectPr, final) = portrait, two columns.
      + `<w:p><w:r><w:t>Column body one.</w:t></w:r></w:p>`
      + `<w:p><w:r><w:t>Column body two.</w:t></w:r></w:p>`
      + `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:cols w:num="2" w:space="432"/>`
      + `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>`
      + `</w:body></w:document>`;
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rIdH" Type="h" Target="header1.xml"/><Relationship Id="rIdF" Type="f" Target="footer1.xml"/>`
      + `<Relationship Id="rIdHF" Type="h" Target="header2.xml"/></Relationships>`;
    const header1 = `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>Running Header</w:t></w:r></w:p></w:hdr>`;
    const header2 = `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p></w:p></w:hdr>`; // empty first-page header
    const footer1 = `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr>`
      + `<w:r><w:t xml:space="preserve">Page </w:t></w:r>`
      + `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
      + `<w:r><w:t xml:space="preserve"> of </w:t></w:r>`
      + `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
      + `</w:p></w:ftr>`;
    const footnotes = `<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`
      + `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>`
      + `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> The note body.</w:t></w:r></w:p></w:footnote>`
      + `</w:footnotes>`;
    const zip = zipSync({
      'word/document.xml': strToU8(doc),
      'word/_rels/document.xml.rels': strToU8(rels),
      'word/header1.xml': strToU8(header1),
      'word/header2.xml': strToU8(header2),
      'word/footer1.xml': strToU8(footer1),
      'word/footnotes.xml': strToU8(footnotes),
    });
    const file = new File([zip], 'featured.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const imported = await parsePaperDocumentImportFile(file);
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');

    // Three sections parsed with their geometry, and a footnote captured.
    expect(imported.sections?.length).toBe(3);
    expect(imported.sections?.[0]).toEqual(expect.objectContaining({ landscape: false, columns: 1, titlePage: true }));
    expect(imported.sections?.[1]).toEqual(expect.objectContaining({ landscape: true, columns: 1 }));
    expect(imported.sections?.[2]).toEqual(expect.objectContaining({ landscape: false, columns: 2 }));
    expect(imported.sections?.[0].header?.paragraphs[0].text).toBe('Running Header');
    expect(imported.footnotes?.[0]).toEqual(expect.objectContaining({ number: 1 }));
    // The heading after the page break carries the page-break flag; the footnote paragraph got a superscript marker.
    expect(imported.blocks.find((b) => b.text.includes('Heading on page two'))?.pageBreakBefore).toBe(true);
    expect(imported.blocks.find((b) => b.footnoteRefs?.length)?.footnoteRefs).toEqual([1]);

    const built = await importTextDocumentIntoPaper(imported);
    const allFrames = built.pages.flatMap((page) => page.frames);
    // The page break puts the heading on its own (second) page, not page one.
    const introPage = built.pages.findIndex((p) => p.frames.some((f) => (f.text ?? '').includes('Intro on page one')));
    const headingPage = built.pages.findIndex((p) => p.frames.some((f) => (f.text ?? '').includes('Heading on page two')));
    expect(headingPage).toBeGreaterThan(introPage);
    // A running footer resolves the PAGE/NUMPAGES fields to the live page numbers.
    const footerFrame = allFrames.find((f) => f.label === 'Footer');
    expect(footerFrame?.text).toMatch(/Page \d+ of \d+/);
    // Footnote text is drawn on the page; the landscape section is rotated; the 2-column section is a real
    // multi-column frame.
    expect(allFrames.some((f) => f.label === 'Footnotes' && (f.text ?? '').includes('The note body.'))).toBe(true);
    expect(allFrames.some((f) => (f.text ?? '').includes('Landscape body.') && f.rotationDeg === 90)).toBe(true);
    expect(allFrames.some((f) => f.kind === 'text' && f.columns === 2 && f.rotationDeg === 0)).toBe(true);
  });
});

describe('DOCX Japanese round-trip (furigana / 圏点 / 縦書き)', () => {
  const DOCX_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const docxFile = (bodyXml: string): File => {
    const xml = `<?xml version="1.0"?><w:document ${DOCX_NS}><w:body>${bodyXml}</w:body></w:document>`;
    return new File([zipSync({ 'word/document.xml': strToU8(xml) })], 'jp.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  };

  it('imports Word furigana (<w:ruby>) as inline ｜base《reading》 notation', async () => {
    const imported = await parsePaperDocumentImportFile(
      docxFile(
        '<w:p><w:r><w:ruby><w:rubyPr><w:hps w:val="10"/></w:rubyPr>' +
          '<w:rt><w:r><w:t>まほう</w:t></w:r></w:rt>' +
          '<w:rubyBase><w:r><w:t>魔法</w:t></w:r></w:rubyBase></w:ruby></w:r>' +
          '<w:r><w:t>の力</w:t></w:r></w:p>',
      ),
    );
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    expect(imported.blocks[0].text).toBe('｜魔法《まほう》の力');
    expect(imported.limitations ?? []).toEqual(expect.arrayContaining([expect.stringMatching(/Furigana/)]));
  });

  it('imports Word emphasis (<w:em>) as inline 《《…》》 notation', async () => {
    const imported = await parsePaperDocumentImportFile(
      docxFile('<w:p><w:r><w:rPr><w:em w:val="dot"/></w:rPr><w:t>重要</w:t></w:r><w:r><w:t>です</w:t></w:r></w:p>'),
    );
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    expect(imported.blocks[0].text).toBe('《《重要》》です');
  });

  it('imports a 縦書き section (<w:textDirection w:val="tbRl">) as vertical-rl text frames', async () => {
    const imported = await parsePaperDocumentImportFile(
      docxFile('<w:p><w:r><w:t>吾輩は猫である</w:t></w:r></w:p><w:sectPr><w:textDirection w:val="tbRl"/></w:sectPr>'),
    );
    if (!('blocks' in imported)) throw new Error('Expected a text-document import.');
    expect(imported.sections?.some((s) => s.vertical)).toBe(true);
    const doc = await importTextDocumentIntoPaper(imported);
    const frame = doc.pages.flatMap((p) => p.frames).find((f) => (f.text ?? '').includes('吾輩'));
    expect(computeEffectivePaperFrame(doc, frame!).typography.writingMode).toBe('vertical-rl');
  });

  const verticalRubyEmphasisDoc = () => {
    const base = createDefaultPaperDocument({ title: '縦書き Export' });
    return addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text', xMm: 10, yMm: 10, widthMm: 60, heightMm: 80,
      text: '魔法《まほう》の《《力》》だ',
      typography: { writingMode: 'vertical-rl' },
    }).document;
  };

  const docxDocumentXml = async (blob: Blob): Promise<string> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return strFromU8(unzipSync(bytes)['word/document.xml'] ?? new Uint8Array());
  };

  it('exports Paper inline notation to NATIVE Word ruby / emphasis / vertical direction', async () => {
    const exported = exportPaperStoryText(verticalRubyEmphasisDoc(), 'docx');
    if (!('entries' in exported)) throw new Error('Expected a zip export.');
    const xml = await docxDocumentXml(exported.blob);
    expect(xml).toContain('<w:ruby>');
    expect(xml).toContain('<w:rubyBase><w:r><w:t xml:space="preserve">魔法</w:t></w:r></w:rubyBase>');
    expect(xml).toContain('まほう'); // the reading lands in <w:rt>
    expect(xml).toContain('<w:em w:val="comma"/>'); // 圏点 (sesame) → Word emphasis
    expect(xml).toContain('<w:textDirection w:val="tbRl"/>'); // whole-vertical doc → vertical section
    expect(xml).not.toContain('《'); // the raw notation is resolved to native XML, not dumped as text
  });

  it('round-trips vertical + furigana + emphasis back through re-import', async () => {
    const exported = exportPaperStoryText(verticalRubyEmphasisDoc(), 'docx');
    if (!('entries' in exported)) throw new Error('Expected a zip export.');
    const reimported = await parsePaperDocumentImportFile(new File([exported.blob], 'rt.docx', { type: exported.mimeType }));
    if (!('blocks' in reimported)) throw new Error('Expected a text-document import.');
    const bodyText = reimported.blocks.map((b) => b.text).join('\n');
    expect(bodyText).toContain('魔法《まほう》'); // furigana survived (｜ delimiter prefix is harmless)
    expect(bodyText).toContain('《《力》》'); // 圏点 survived
    expect(reimported.sections?.some((s) => s.vertical)).toBe(true);
  });
});

function pdfItem(): SourceBinLibraryItem {
  return {
    id: 'pdf-1',
    label: 'Reference.pdf',
    kind: 'document',
    mimeType: 'application/pdf',
    assetUrl: 'blob:reference-pdf',
    createdAt: 1,
  };
}
