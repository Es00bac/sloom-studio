import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { addFrameToPaperPage, createDefaultPaperDocument } from './paperDocument';
import { buildPaperIdmlPackage } from './paperIdmlExport';
import { importPaperIdmlPackage, PAPER_IDML_XML_LIMITS } from './paperIdmlImport';
import { parsePaperDocumentImportFile } from './paperDocumentFormats';

const MIMETYPE = 'application/vnd.adobe.indesign-idml-package';

function rectanglePath(width = 100, height = 60): string {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  return `<Properties><PathGeometry><GeometryPathType PathOpen="false"><PathPointArray>`
    + `<PathPointType Anchor="-${halfWidth} -${halfHeight}"/>`
    + `<PathPointType Anchor="-${halfWidth} ${halfHeight}"/>`
    + `<PathPointType Anchor="${halfWidth} ${halfHeight}"/>`
    + `<PathPointType Anchor="${halfWidth} -${halfHeight}"/>`
    + `</PathPointArray></GeometryPathType></PathGeometry></Properties>`;
}

function minimumIdml({
  frame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Swatch/None" StrokeWeight="1" PreviousTextFrame="n" NextTextFrame="n" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}</TextFrame>`,
  story = `<Story Self="story1"><ParagraphStyleRange Justification="CenterAlign"><CharacterStyleRange PointSize="14" FontStyle="Bold Italic"><Properties><AppliedFont type="string">Noto Sans</AppliedFont></Properties><Content>Hello &amp; layout</Content></CharacterStyleRange></ParagraphStyleRange></Story>`,
  includeStoryReference = true,
  includePreferences = true,
  mimetype = MIMETYPE,
  designmapExtra = '',
  pageAttributes = '',
  graphicXml,
  storyBytes,
  metadataBytes,
}: {
  frame?: string;
  story?: string;
  includeStoryReference?: boolean;
  includePreferences?: boolean;
  mimetype?: string;
  designmapExtra?: string;
  pageAttributes?: string;
  graphicXml?: string;
  storyBytes?: Uint8Array;
  metadataBytes?: Uint8Array;
} = {}): Uint8Array {
  const parts: Record<string, Uint8Array> = {
    mimetype: strToU8(mimetype),
    'designmap.xml': strToU8(`<Document xmlns:idPkg="urn:idpkg"><idPkg:Spread src="Spreads/Spread_1.xml"/>${includeStoryReference ? '<idPkg:Story src="Stories/Story_story1.xml"/>' : ''}${designmapExtra}</Document>`),
    'Spreads/Spread_1.xml': strToU8(`<idPkg:Spread xmlns:idPkg="urn:idpkg"><Spread Self="spread1"><Page Self="page1" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 -306 -396" ${pageAttributes}/>${frame}</Spread></idPkg:Spread>`),
    'Stories/Story_story1.xml': storyBytes ?? strToU8(`<idPkg:Story xmlns:idPkg="urn:idpkg">${story}</idPkg:Story>`),
  };
  if (includePreferences) {
    parts['Resources/Preferences.xml'] = strToU8('<idPkg:Preferences xmlns:idPkg="urn:idpkg"><DocumentPreference PageHeight="792" PageWidth="612"/></idPkg:Preferences>');
  }
  if (graphicXml) parts['Resources/Graphic.xml'] = strToU8(graphicXml);
  if (metadataBytes) parts['META-INF/metadata.xml'] = metadataBytes;
  return zipSync(parts, { level: 6 });
}

function invalidUtf8(value: string, marker = 'X'): Uint8Array {
  const bytes = strToU8(value);
  const index = bytes.indexOf(marker.charCodeAt(0));
  if (index < 0) throw new Error(`Missing invalid-UTF-8 test marker ${marker}`);
  bytes[index] = 0xff;
  return bytes;
}

describe('paperIdmlImport', () => {
  it('imports an independently authored, bounded single-page text-frame package', () => {
    const document = importPaperIdmlPackage(minimumIdml(), 'Manual fixture');
    const frame = document.pages[0]?.frames[0];

    expect(document.title).toBe('Manual fixture');
    expect(document.page).toMatchObject({ preset: 'custom', widthMm: 215.9, heightMm: 279.4 });
    expect(frame).toMatchObject({
      kind: 'text',
      text: 'Hello & layout',
      xMm: 7.056,
      yMm: 10.583,
      widthMm: 35.278,
      heightMm: 21.167,
      typography: { align: 'center', fontFamily: 'Noto Sans', fontSizePt: 14, fontWeight: '700', fontStyle: 'italic' },
      fillColor: 'transparent',
      strokeColor: 'transparent',
    });
  });

  it('imports the current IDML exporter’s plain text and basic rectangle subset', () => {
    let source = createDefaultPaperDocument({ title: 'Editable IDML source', preset: 'a4' });
    source = addFrameToPaperPage(source, source.pages[0].id, {
      kind: 'text',
      xMm: 16,
      yMm: 22,
      widthMm: 72,
      heightMm: 18,
      text: 'Two editable paragraphs\narrive intact.',
      typography: { fontFamily: 'Georgia', fontSizePt: 15, align: 'right' },
    }).document;
    source = addFrameToPaperPage(source, source.pages[0].id, {
      kind: 'panel',
      xMm: 95,
      yMm: 70,
      widthMm: 40,
      heightMm: 30,
      rotationDeg: 17,
      fillColor: '#ff8800',
      strokeColor: '#113355',
      strokeWidthMm: 0.8,
    }).document;

    const imported = importPaperIdmlPackage(buildPaperIdmlPackage(source), 'fallback');
    const [text, rectangle] = imported.pages[0]!.frames;
    expect(imported.title).toBe('Editable IDML source');
    expect(text).toMatchObject({ kind: 'text', text: 'Two editable paragraphs\narrive intact.', typography: { fontFamily: 'Georgia', fontSizePt: 15, align: 'right' } });
    expect(rectangle).toMatchObject({ kind: 'shape', fillColor: '#ff8800', strokeColor: '#113355', strokeWidthMm: 0.8 });
    expect(rectangle?.rotationDeg).toBeCloseTo(17, 2);
    expect(rectangle?.vertices).toEqual([
      { xPercent: 0, yPercent: 0 },
      { xPercent: 100, yPercent: 0 },
      { xPercent: 100, yPercent: 100 },
      { xPercent: 0, yPercent: 100 },
    ]);
  });

  it('uses the real import-file boundary without treating the package as plain text', async () => {
    const bytes = minimumIdml();
    const arrayBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(arrayBuffer).set(bytes);
    const file = new File([arrayBuffer], 'manual-layout.idml', { type: MIMETYPE });
    const imported = await parsePaperDocumentImportFile(file);

    expect('blocks' in imported).toBe(false);
    if ('blocks' in imported) throw new Error('Expected an editable Paper document.');
    expect(imported.pages[0]?.frames[0]?.text).toBe('Hello & layout');
  });

  it('fails closed for missing essential parts and undeclared stories', () => {
    expect(() => importPaperIdmlPackage(minimumIdml({ includePreferences: false })))
      .toThrow(/required package part "Resources\/Preferences\.xml" is missing/i);
    expect(() => importPaperIdmlPackage(minimumIdml({ includeStoryReference: false })))
      .toThrow(/missing or undeclared story/i);
    expect(() => importPaperIdmlPackage(minimumIdml({ mimetype: 'application/zip' })))
      .toThrow(/mimetype is not an Adobe IDML package/i);
  });

  it('refuses malformed UTF-8 in retained story text, font names, and optional metadata', () => {
    const contentStory = '<idPkg:Story xmlns:idPkg="urn:idpkg"><Story Self="story1"><ParagraphStyleRange><CharacterStyleRange><Content>X</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>';
    expect(() => importPaperIdmlPackage(minimumIdml({ storyBytes: invalidUtf8(contentStory) })))
      .toThrow(/Stories\/Story_story1\.xml contains invalid UTF-8 data/i);

    const fontStory = '<idPkg:Story xmlns:idPkg="urn:idpkg"><Story Self="story1"><ParagraphStyleRange><CharacterStyleRange><Properties><AppliedFont type="string">X</AppliedFont></Properties><Content>valid</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>';
    expect(() => importPaperIdmlPackage(minimumIdml({ storyBytes: invalidUtf8(fontStory) })))
      .toThrow(/Stories\/Story_story1\.xml contains invalid UTF-8 data/i);

    const metadata = '<rdf:RDF><dc:title><rdf:Alt><rdf:li>X</rdf:li></rdf:Alt></dc:title></rdf:RDF>';
    expect(() => importPaperIdmlPackage(minimumIdml({ metadataBytes: invalidUtf8(metadata) })))
      .toThrow(/META-INF\/metadata\.xml contains invalid UTF-8 data/i);
  });

  it('refuses linked graphics, mixed text styling, and archive expansion bombs instead of flattening them', () => {
    const linkedGraphic = `<Rectangle Self="g1" ContentType="GraphicType" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}<Image LinkResourceURI="file:///outside.png"/></Rectangle>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: linkedGraphic })))
      .toThrow(/linked or placed graphic frame/i);

    const mixedStory = `<Story Self="story1"><ParagraphStyleRange><CharacterStyleRange><Content>Plain</Content></CharacterStyleRange><CharacterStyleRange FontStyle="Bold"><Content> bold</Content></CharacterStyleRange></ParagraphStyleRange></Story>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ story: mixedStory })))
      .toThrow(/mixed or malformed character styles/i);

    const reflectedFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="-1 0 0 1 -236 -336">${rectanglePath()}</TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: reflectedFrame })))
      .toThrow(/reflected transform/i);

    const bomb = zipSync({ mimetype: strToU8(MIMETYPE), 'designmap.xml': strToU8('A'.repeat(1_000_000)) }, { level: 9 });
    expect(() => importPaperIdmlPackage(bomb)).toThrow(/IDML.*suspicious compression ratio/i);
  });

  it('uses a bounded linear XML scanner for an unterminated large element instead of searching every opening tag to EOF', () => {
    const unterminatedTag = `<Story ${'x'.repeat(PAPER_IDML_XML_LIMITS.maxTagCharacters + 64)}`;

    expect(() => importPaperIdmlPackage(minimumIdml({ story: unterminatedTag })))
      .toThrow(new RegExp(`XML tag exceeding ${PAPER_IDML_XML_LIMITS.maxTagCharacters} characters`, 'i'));
  });

  it('bounds XML part bytes and nesting before malformed XML can consume unbounded parser work', () => {
    const tooLargeStory = new Uint8Array(PAPER_IDML_XML_LIMITS.maxPartBytes + 1).fill(0x61);
    const oversizedPartPackage = zipSync({
      mimetype: strToU8(MIMETYPE),
      'designmap.xml': strToU8('<Document xmlns:idPkg="urn:idpkg"><idPkg:Spread src="Spreads/Spread_1.xml"/><idPkg:Story src="Stories/Story_1.xml"/></Document>'),
      'Resources/Preferences.xml': strToU8('<idPkg:Preferences xmlns:idPkg="urn:idpkg"><DocumentPreference PageHeight="792" PageWidth="612"/></idPkg:Preferences>'),
      'Spreads/Spread_1.xml': strToU8('<idPkg:Spread xmlns:idPkg="urn:idpkg"><Spread><Page Self="page1" GeometricBounds="0 0 792 612" ItemTransform="1 0 0 1 -306 -396"/></Spread></idPkg:Spread>'),
      'Stories/Story_1.xml': tooLargeStory,
    }, { level: 0 });
    expect(() => importPaperIdmlPackage(oversizedPartPackage))
      .toThrow(new RegExp(`Stories/Story_1\\.xml exceeds ${PAPER_IDML_XML_LIMITS.maxPartBytes} XML bytes`, 'i'));

    const tooDeepStory = `${'<Story>'.repeat(PAPER_IDML_XML_LIMITS.maxDepth + 1)}plain`;
    expect(() => importPaperIdmlPackage(minimumIdml({ story: tooDeepStory })))
      .toThrow(new RegExp(`exceeds ${PAPER_IDML_XML_LIMITS.maxDepth} XML nesting levels`, 'i'));
  });

  it('fails closed for master spreads, hidden layers, unrepresentable text-frame preferences, and Color/Black', () => {
    expect(() => importPaperIdmlPackage(minimumIdml({
      designmapExtra: '<idPkg:MasterSpread src="MasterSpreads/MasterSpread_1.xml"/>',
      pageAttributes: 'AppliedMaster="master1"',
    }))).toThrow(/master spreads/i);
    expect(() => importPaperIdmlPackage(minimumIdml({ pageAttributes: 'AppliedMaster="master1"' })))
      .toThrow(/applies a master spread/i);

    expect(() => importPaperIdmlPackage(minimumIdml({
      designmapExtra: '<Layer Self="Layer/hidden" Visible="false" Printable="true" Locked="false"/>',
    }))).toThrow(/hidden layer/i);
    const undeclaredLayerFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" ItemLayer="Layer/unknown" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}</TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: undeclaredLayerFrame })))
      .toThrow(/undeclared or unsupported layer/i);

    const multiColumnFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}<TextFramePreference TextColumnCount="3" TextColumnGutter="24" TextInset="4 4 4 4" VerticalJustification="CenterAlign"/></TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: multiColumnFrame })))
      .toThrow(/text-frame columns/i);
    const insetFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}<TextFramePreference TextColumnCount="1" TextInset="4 4 4 4"/></TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: insetFrame })))
      .toThrow(/text-frame insets/i);
    const verticalFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Swatch/None" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}<TextFramePreference TextColumnCount="1" VerticalJustification="CenterAlign"/></TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: verticalFrame })))
      .toThrow(/vertical text justification/i);

    const blackGraphic = '<idPkg:Graphic xmlns:idPkg="urn:idpkg"><Color Self="Color/Black" Model="Process" Space="CMYK" ColorValue="0 0 0 100"/></idPkg:Graphic>';
    const blackFrame = `<TextFrame Self="tf1" ParentStory="story1" ContentType="TextType" FillColor="Swatch/None" StrokeColor="Color/Black" ItemTransform="1 0 0 1 -236 -336">${rectanglePath()}</TextFrame>`;
    expect(() => importPaperIdmlPackage(minimumIdml({ frame: blackFrame, graphicXml: blackGraphic })))
      .toThrow(/Color\/Black CMYK process swatch/i);
  });
});
